"""Текст из документа заказчика (PDF, DOCX, XLSX, ODT, ODS, RTF, TXT, сканы — OCR Windows) с оценкой качества."""

import os
import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree as ET

import pdf_text
from defaults import SrvVal
from ocr_win import WinOcr


class TextQuality:
    """Качество текста 0…1: доля «нормальных» символов и слов одного алфавита; ниже LOW — нужен другой способ."""

    LOW = 0.6
    GOOD_CH = re.compile(r'[0-9A-Za-zА-Яа-яЁё.,:;!?()«»"\'%№°+\-–—/×*=<>\[\]|]')
    WORD = re.compile(r'\S+')

    @classmethod
    def score(cls, text) -> float:
        t = str(text or '')
        chars = [c for c in t if not c.isspace()]
        if len(chars) < 20:
            return 0.0
        good = sum(1 for c in chars if cls.GOOD_CH.match(c)) / len(chars)
        words = [w.strip('.,:;!?()«»"\'') for w in cls.WORD.findall(t)]
        words = [w for w in words if len(w) >= 3 and not re.search(r'\d', w)]
        clean = sum(1 for w in words if re.fullmatch(r'[А-Яа-яЁё-]+|[A-Za-z-]+', w)) / len(words) if words else 0.0
        return round(0.5 * good + 0.5 * clean, 3)


class DocText:
    MAX_TEXT = 60000
    MAX_PART = 30 * 1024 * 1024  # распакованная часть архива — не больше
    KINDS = 'PDF, DOCX, XLSX, ODT, ODS, RTF или TXT'

    IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp')

    @classmethod
    def extract(cls, name, data, ocr=None) -> dict:
        """→ {text, kind, pages, quality, methods}; ocr — класс распознавания (в проверках — заглушка)."""
        if not data:
            raise ValueError('файл пустой')
        mb = SrvVal.now('cat.docMaxMB')
        if len(data) > mb * 1024 * 1024:
            raise ValueError(f'файл больше {mb} МБ')
        ocr = ocr or WinOcr
        ext = os.path.splitext(str(name or '').lower())[1]
        if data[:4] == b'%PDF' or ext == '.pdf':
            return cls._pdf(data, ocr)
        if WinOcr.image_ext(data) or ext in cls.IMAGE_EXT:
            return cls._image(data, ocr)
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
    def _done(cls, text, kind, pages=None, methods=None) -> dict:
        t = re.sub(r'[ \t\xa0]+', ' ', text.replace('\r\n', '\n').replace('\r', '\n'))
        t = re.sub(r'\n[ \t\xa0]*\n[ \t\xa0]*\n+', '\n\n', t).strip()  # \f — граница страниц — остаётся
        if len(re.sub(r'\W', '', t)) < 20:
            raise ValueError('в документе нет текста')
        q = TextQuality.score(t)
        methods = methods or [{'id': 'text', 'name': 'Текст документа', 'chars': len(t), 'quality': q}]
        return {
            'text': t[: cls.MAX_TEXT],
            'kind': kind,
            'pages': pages,
            'quality': q,
            'low': q < TextQuality.LOW,
            'methods': methods,
        }

    @staticmethod
    def _pages(per) -> str:
        return '\n\f\n'.join(p.strip() for p in per)

    @classmethod
    def _pdf(cls, data, ocr) -> dict:
        """текстовый слой; если его нет или он плохой — распознавание Windows; лучший по качеству"""
        r = pdf_text.text(data, need_text=False)
        per = r.get('per') or []
        t0 = cls._pages(per)
        q0 = TextQuality.score(t0)
        methods = [{'id': 'pdf', 'name': 'Текстовый слой PDF', 'chars': len(t0.replace('\f', '')), 'quality': q0}]
        best, kind = per, 'pdf'
        empty = sum(1 for p in per if len(p.strip()) < 30)
        if q0 < TextQuality.LOW or (
            per and empty * 2 >= len(per)
        ):  # скан или нечитаемые шрифты (половина страниц пустые)
            if ocr.available():
                try:
                    o = ocr.recognize(data, 'pdf')
                    t1 = cls._pages(o['pages'])
                    q1 = TextQuality.score(t1)
                    methods.append(
                        {
                            'id': 'ocr',
                            'name': f'Распознавание Windows (OCR, {o.get("lang") or "язык профиля"})',
                            'chars': len(t1.replace('\f', '')),
                            'quality': q1,
                            'pages': len(o['pages']),
                        }
                    )
                    if q1 > q0:
                        best, kind = o['pages'], 'pdf-ocr'
                except ValueError as e:
                    methods.append({'id': 'ocr', 'name': 'Распознавание Windows (OCR)', 'error': str(e)[:300]})
            else:
                methods.append(
                    {
                        'id': 'ocr',
                        'name': 'Распознавание Windows (OCR)',
                        'error': 'доступно на сервере под Windows 10/11',
                    }
                )
        text = cls._pages(best)
        if len(re.sub(r'\W', '', text)) < 20:
            err = next((m.get('error') for m in methods if m.get('error')), '')
            raise ValueError(
                'в PDF нет текста — похоже на скан'
                + ('; распознавание: ' + err if err else '')
                + '. Пришлите текстовый PDF или DOCX либо скопируйте текст вручную'
            )
        for m in methods:
            m['used'] = (m['id'] == 'ocr') == (kind == 'pdf-ocr') and not m.get('error')
        return cls._done(text, kind, r.get('pages'), methods)

    @classmethod
    def _image(cls, data, ocr) -> dict:
        """картинка (фото или скан ТЗ) — распознавание Windows"""
        if not ocr.available():
            raise ValueError(
                'картинка ТЗ распознаётся на сервере под Windows 10/11 (встроенное распознавание текста) — '
                'здесь недоступно: пришлите PDF с текстом, DOCX или скопируйте текст'
            )
        o = ocr.recognize(data, 'image')
        text = cls._pages(o['pages'])
        q = TextQuality.score(text)
        return cls._done(
            text,
            'image',
            1,
            [
                {
                    'id': 'ocr',
                    'name': f'Распознавание Windows (OCR, {o.get("lang") or "язык профиля"})',
                    'chars': len(text),
                    'quality': q,
                    'used': True,
                }
            ],
        )

    @staticmethod
    def _texty(data) -> bool:
        sample = data[:4096]
        return b'\x00' not in sample

    @staticmethod
    def _decode(data) -> str:
        for enc in ('utf-8-sig', 'cp1251'):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
        return data.decode('utf-8', 'replace')

    # ---- архивы Office и OpenDocument
    @classmethod
    def _zip(cls, data) -> dict:
        try:
            z = zipfile.ZipFile(BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('файл повреждён — не открывается как ' + cls.KINDS) from None
        names = set(z.namelist())

        def part(n) -> ET.Element:
            info = z.getinfo(n)
            if info.file_size > cls.MAX_PART:
                raise ValueError('слишком большая часть документа')
            return Xml.parse(z.read(n))

        if 'word/document.xml' in names:
            return cls._done(Xml.docx(part('word/document.xml')), 'docx')
        if 'xl/workbook.xml' in names:
            shared = Xml.shared(part('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in names else []
            sheets = sorted(
                (n for n in names if re.match(r'xl/worksheets/sheet\d+\.xml$', n)),
                key=lambda n: int(re.findall(r'\d+', n)[-1]),
            )
            return cls._done('\n\n'.join(Xml.sheet(part(n), shared) for n in sheets[:20]), 'xlsx')
        if 'content.xml' in names:
            return cls._done(Xml.odf(part('content.xml')), 'odt')
        raise ValueError('архив не похож на документ — нужен ' + cls.KINDS)


class Xml:
    """Разбор частей Office/OpenDocument: текст по порядку, таблицы — строками «ячейка | ячейка»."""

    @staticmethod
    def parse(raw) -> ET.Element:
        head = raw[:4096].upper()
        if b'<!DOCTYPE' in head or b'<!ENTITY' in head:
            raise ValueError('документ с недопустимой разметкой')
        try:
            return ET.fromstring(raw)
        except ET.ParseError:
            raise ValueError('документ повреждён — разметка не читается') from None

    @staticmethod
    def local(tag) -> str:
        return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''

    @classmethod
    def docx(cls, root) -> str:
        out = []

        def para(p) -> str:
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

        def walk(node) -> None:
            for e in node:
                t = cls.local(e.tag)
                if t == 'p':
                    out.append(para(e))
                elif t == 'tbl':
                    for tr in (x for x in e.iter() if cls.local(x.tag) == 'tr'):
                        cells = [
                            ' '.join(para(p) for p in tc.iter() if cls.local(p.tag) == 'p').strip()
                            for tc in tr
                            if cls.local(tc.tag) == 'tc'
                        ]
                        if any(cells):
                            out.append(' | '.join(cells))
                    out.append('')
                else:
                    walk(e)

        body = next((e for e in root if cls.local(e.tag) == 'body'), root)
        walk(body)
        return '\n'.join(out)

    @classmethod
    def shared(cls, root) -> list:
        return [
            ''.join(t.text or '' for t in si.iter() if cls.local(t.tag) == 't')
            for si in root
            if cls.local(si.tag) == 'si'
        ]

    @classmethod
    def sheet(cls, root, shared) -> str:
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
    def odf(cls, root) -> str:
        out = []

        def text(e) -> str:
            s = [e.text or '']
            for ch in e:
                t = cls.local(ch.tag)
                s.append('\t' if t == 'tab' else '\n' if t == 'line-break' else ' ' if t == 's' else text(ch))
                s.append(ch.tail or '')
            return ''.join(s)

        def walk(node) -> None:
            for e in node:
                t = cls.local(e.tag)
                if t in ('p', 'h'):
                    out.append(text(e))
                elif t == 'table-row':
                    cells = [
                        ' '.join(text(p) for p in c.iter() if cls.local(p.tag) in ('p', 'h')).strip()
                        for c in e
                        if cls.local(c.tag) == 'table-cell'
                    ]
                    if any(cells):
                        out.append(' | '.join(x for x in cells if x))
                else:
                    walk(e)

        walk(root)
        return '\n'.join(out)


class Rtf:
    """RTF → текст: управляющие слова и служебные группы убираются, \\par — перевод строки."""

    SKIP = {
        'fonttbl',
        'colortbl',
        'stylesheet',
        'info',
        'pict',
        'object',
        'header',
        'footer',
        'listtable',
        'listoverridetable',
        'rsidtbl',
        'generator',
        'themedata',
        'colorschememapping',
        'datastore',
        'latentstyles',
        'xmlnstbl',
    }
    TOKEN = re.compile(rb"\\([a-z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)|([{}])|([^\\{}]+)", re.S)

    @classmethod
    def text(cls, data) -> str:
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
