# -*- coding: utf-8 -*-
"""Текст из документа заказчика (ТЗ, опросный лист) — только стандартная библиотека.

PDF (pdf_text), Word DOCX, Excel XLSX, OpenDocument ODT и ODS, RTF, обычный текст (UTF-8 или Windows-1251). Таблицы —
строками «ячейка | ячейка». Старые двоичные .doc и .xls не читаются — ValueError с пояснением (сохранить как DOCX, XLSX
или PDF). Защита: размер файла, размер распакованных частей архива, XML без DOCTYPE и сущностей.
"""
import os
import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree as ET

import pdf_text


class DocText:
    MAX_BYTES = 40 * 1024 * 1024
    MAX_TEXT = 60000
    MAX_PART = 30 * 1024 * 1024       # распакованная часть архива — не больше
    KINDS = 'PDF, DOCX, XLSX, ODT, ODS, RTF или TXT'

    @classmethod
    def extract(cls, name, data):
        """{'text', 'kind', 'pages'}; ошибка — ValueError понятным текстом"""
        if not data:
            raise ValueError('файл пустой')
        if len(data) > cls.MAX_BYTES:
            raise ValueError('файл больше 40 МБ')
        ext = os.path.splitext(str(name or '').lower())[1]
        if data[:4] == b'%PDF' or ext == '.pdf':
            r = pdf_text.text(data)
            return {'text': r['text'], 'kind': 'pdf', 'pages': r.get('pages')}
        if data[:4] == b'\xd0\xcf\x11\xe0':
            raise ValueError('старый формат Word или Excel (.doc, .xls) — сохраните файл как DOCX, XLSX или PDF')
        if data[:2] == b'PK':
            return cls._zip(data)
        if data.lstrip()[:5] == b'{\\rtf':
            return cls._done(Rtf.text(data), 'rtf')
        if ext in ('', '.txt', '.csv', '.md') or cls._texty(data):
            return cls._done(cls._decode(data), 'txt')
        raise ValueError('формат не распознан — нужен ' + cls.KINDS)

    @classmethod
    def _done(cls, text, kind, pages=None):
        t = re.sub(r'[ \t\xa0]+', ' ', text.replace('\r\n', '\n').replace('\r', '\n'))
        t = re.sub(r'\n\s*\n\s*\n+', '\n\n', t).strip()
        if len(re.sub(r'\W', '', t)) < 20:
            raise ValueError('в документе нет текста')
        return {'text': t[:cls.MAX_TEXT], 'kind': kind, 'pages': pages}

    @staticmethod
    def _texty(data):
        sample = data[:4096]
        return b'\x00' not in sample

    @staticmethod
    def _decode(data):
        for enc in ('utf-8-sig', 'cp1251'):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
        return data.decode('utf-8', 'replace')

    # ---- архивы Office и OpenDocument
    @classmethod
    def _zip(cls, data):
        try:
            z = zipfile.ZipFile(BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('файл повреждён — не открывается как ' + cls.KINDS)
        names = set(z.namelist())

        def part(n):
            info = z.getinfo(n)
            if info.file_size > cls.MAX_PART:
                raise ValueError('слишком большая часть документа')
            return Xml.parse(z.read(n))
        if 'word/document.xml' in names:
            return cls._done(Xml.docx(part('word/document.xml')), 'docx')
        if 'xl/workbook.xml' in names:
            shared = Xml.shared(part('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in names else []
            sheets = sorted((n for n in names if re.match(r'xl/worksheets/sheet\d+\.xml$', n)), key=lambda n: int(re.findall(r'\d+', n)[-1]))
            return cls._done('\n\n'.join(Xml.sheet(part(n), shared) for n in sheets[:20]), 'xlsx')
        if 'content.xml' in names:
            return cls._done(Xml.odf(part('content.xml')), 'odt')
        raise ValueError('архив не похож на документ — нужен ' + cls.KINDS)


class Xml:
    """Разбор частей Office/OpenDocument: текст по порядку, таблицы — строками «ячейка | ячейка»."""

    @staticmethod
    def parse(raw):
        head = raw[:4096].upper()
        if b'<!DOCTYPE' in head or b'<!ENTITY' in head:
            raise ValueError('документ с недопустимой разметкой')
        try:
            return ET.fromstring(raw)
        except ET.ParseError:
            raise ValueError('документ повреждён — разметка не читается')

    @staticmethod
    def local(tag):
        return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''

    @classmethod
    def docx(cls, root):
        out = []

        def para(p):
            s = []
            for e in p.iter():
                t = cls.local(e.tag)
                if t == 't' and e.text:
                    s.append(e.text)
                elif t == 'tab':
                    s.append('\t')
                elif t in ('br', 'cr'):
                    s.append('\n')
            return ''.join(s)

        def walk(node):
            for e in node:
                t = cls.local(e.tag)
                if t == 'p':
                    out.append(para(e))
                elif t == 'tbl':
                    for tr in (x for x in e.iter() if cls.local(x.tag) == 'tr'):
                        cells = [' '.join(para(p) for p in tc.iter() if cls.local(p.tag) == 'p').strip()
                                 for tc in tr if cls.local(tc.tag) == 'tc']
                        if any(cells):
                            out.append(' | '.join(cells))
                    out.append('')
                else:
                    walk(e)
        body = next((e for e in root if cls.local(e.tag) == 'body'), root)
        walk(body)
        return '\n'.join(out)

    @classmethod
    def shared(cls, root):
        return [''.join(t.text or '' for t in si.iter() if cls.local(t.tag) == 't') for si in root if cls.local(si.tag) == 'si']

    @classmethod
    def sheet(cls, root, shared):
        rows = []
        for row in (e for e in root.iter() if cls.local(e.tag) == 'row'):
            cells = []
            for c in (x for x in row if cls.local(x.tag) == 'c'):
                typ, v = c.get('t'), None
                for e in c:
                    if cls.local(e.tag) == 'v':
                        v = e.text
                    elif cls.local(e.tag) == 'is':
                        v = ''.join(t.text or '' for t in e.iter() if cls.local(t.tag) == 't')
                if typ == 's' and v is not None:
                    try:
                        v = shared[int(v)]
                    except (ValueError, IndexError):
                        v = ''
                cells.append(str(v or '').strip())
            if any(cells):
                rows.append(' | '.join(x for x in cells if x))
        return '\n'.join(rows)

    @classmethod
    def odf(cls, root):
        out = []

        def text(e):
            s = [e.text or '']
            for ch in e:
                t = cls.local(ch.tag)
                s.append('\t' if t == 'tab' else '\n' if t == 'line-break' else ' ' if t == 's' else text(ch))
                s.append(ch.tail or '')
            return ''.join(s)

        def walk(node):
            for e in node:
                t = cls.local(e.tag)
                if t in ('p', 'h'):
                    out.append(text(e))
                elif t == 'table-row':
                    cells = [' '.join(text(p) for p in c.iter() if cls.local(p.tag) in ('p', 'h')).strip()
                             for c in e if cls.local(c.tag) == 'table-cell']
                    if any(cells):
                        out.append(' | '.join(x for x in cells if x))
                else:
                    walk(e)
        walk(root)
        return '\n'.join(out)


class Rtf:
    """RTF → текст: управляющие слова убираются, \\par — новая строка, \\'hh — Windows-1251, \\uN — Юникод; служебные
    группы ({\\*…}, шрифты, цвета, стили, картинки) пропускаются."""
    SKIP = {'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'listtable', 'listoverridetable',
            'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl'}
    TOKEN = re.compile(rb"\\([a-z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)|([{}])|([^\\{}]+)", re.S)

    @classmethod
    def text(cls, data):
        out, stack, skip, uc, pend = [], [], False, 1, 0
        for word, num, hexb, sym, brace, plain in cls.TOKEN.findall(data):
            if brace == b'{':
                stack.append((skip, uc))
                continue
            if brace == b'}':
                skip, uc = stack.pop() if stack else (False, 1)
                continue
            if skip:
                continue
            if word:
                w = word.decode('ascii')
                if w in cls.SKIP:
                    skip = True
                elif w in ('par', 'line', 'row', 'sect', 'page'):
                    out.append('\n')
                elif w in ('tab', 'cell'):
                    out.append(' | ' if w == 'cell' else '\t')
                elif w == 'uc':
                    uc = int(num or 1)
                elif w == 'u':
                    n = int(num or 0)
                    out.append(chr(n + 65536 if n < 0 else n))
                    pend = uc
                continue
            if sym:
                if sym == b'*':
                    skip = True
                elif sym in (b'\\', b'{', b'}'):
                    out.append(sym.decode('ascii'))
                elif sym == b'~':
                    out.append('\xa0')
                continue
            if hexb:
                if pend:
                    pend -= 1
                    continue
                out.append(bytes([int(hexb, 16)]).decode('cp1251', 'replace'))
                continue
            if plain:
                s = plain.replace(b'\r', b'').replace(b'\n', b'')
                if pend:
                    s, pend = s[pend:], 0
                out.append(s.decode('cp1251', 'replace'))
        return ''.join(out)
