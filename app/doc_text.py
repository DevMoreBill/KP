"""Текст из документа заказчика (PDF, DOCX, XLSX, ODT, ODS, RTF, TXT, сканы — OCR Windows) с оценкой качества."""

import os
import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree

import pdf_text
from defaults import SrvVal
from ocr_win import WinOcr


class TextQuality:
    """Качество текста 0…1: доля «нормальных» символов и слов одного алфавита; ниже LOW — нужен другой способ."""

    TEXT_MIN = 20
    WORD_MIN = 3

    LOW = 0.6
    GOOD_CH = re.compile(r'[0-9A-Za-zА-Яа-яЁё.,:;!?()«»"\'%№°+\-–—/×*=<>\[\]|]')
    WORD = re.compile(r'\S+')

    @classmethod
    def score(cls, text) -> float:
        text1 = str(text or '')
        chars = [char for char in text1 if not char.isspace()]
        if len(chars) < cls.TEXT_MIN:
            return 0.0
        good = sum(1 for char in chars if cls.GOOD_CH.match(char)) / len(chars)
        words = [word.strip('.,:;!?()«»"\'') for word in cls.WORD.findall(text1)]
        words = [word for word in words if len(word) >= cls.WORD_MIN and not re.search(r'\d', word)]
        clean = (
            sum(1 for word in words if re.fullmatch(r'[А-Яа-яЁё-]+|[A-Za-z-]+', word)) / len(words) if words else 0.0
        )
        return round(0.5 * good + 0.5 * clean, 3)


class DocText:
    TEXT_MIN = 20
    PAGE_TEXT_MIN = 30
    MAX_TEXT = 60000
    MAX_PART = 30 * 1024 * 1024  # распакованная часть архива — не больше
    KINDS = 'PDF, DOCX, XLSX, ODT, ODS, RTF или TXT'

    IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp')

    @classmethod
    def extract(cls, name, data, ocr=None) -> dict:
        """→ {text, kind, pages, quality, methods}; ocr — класс распознавания (в проверках — заглушка)."""
        if not data:
            raise ValueError('файл пустой')
        max_mb = SrvVal.now('cat.docMaxMB')
        if len(data) > max_mb * 1024 * 1024:
            raise ValueError(f'файл больше {max_mb} МБ')
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
        clean = re.sub(r'[ \t\xa0]+', ' ', text.replace('\r\n', '\n').replace('\r', '\n'))
        clean = re.sub(r'\n[ \t\xa0]*\n[ \t\xa0]*\n+', '\n\n', clean).strip()  # \f — граница страниц — остаётся
        if len(re.sub(r'\W', '', clean)) < cls.TEXT_MIN:
            raise ValueError('в документе нет текста')
        quality = TextQuality.score(clean)
        methods = methods or [{'id': 'text', 'name': 'Текст документа', 'chars': len(clean), 'quality': quality}]
        return {
            'text': clean[: cls.MAX_TEXT],
            'kind': kind,
            'pages': pages,
            'quality': quality,
            'low': quality < TextQuality.LOW,
            'methods': methods,
        }

    @staticmethod
    def _pages(per) -> str:
        return '\n\f\n'.join(page.strip() for page in per)

    @classmethod
    def _pdf(cls, data, ocr) -> dict:
        """текстовый слой; если его нет или он плохой — распознавание Windows; лучший по качеству"""
        res = pdf_text.PdfText.read(data)
        per = res.get('per') or []
        text_layer = cls._pages(per)
        quality_layer = TextQuality.score(text_layer)
        methods = [
            {
                'id': 'pdf',
                'name': 'Текстовый слой PDF',
                'chars': len(text_layer.replace('\f', '')),
                'quality': quality_layer,
            }
        ]
        best, kind = per, 'pdf'
        empty = sum(1 for page in per if len(page.strip()) < cls.PAGE_TEXT_MIN)
        if quality_layer < TextQuality.LOW or (
            per and empty * 2 >= len(per)
        ):  # скан или нечитаемые шрифты (половина страниц пустые)
            if ocr.available():
                try:
                    ocr_res = ocr.recognize(data, 'pdf')
                    text_ocr = cls._pages(ocr_res['pages'])
                    quality_ocr = TextQuality.score(text_ocr)
                    methods.append(
                        {
                            'id': 'ocr',
                            'name': f'Распознавание Windows (OCR, {ocr_res.get("lang") or "язык профиля"})',
                            'chars': len(text_ocr.replace('\f', '')),
                            'quality': quality_ocr,
                            'pages': len(ocr_res['pages']),
                        }
                    )
                    if quality_ocr > quality_layer:
                        best, kind = ocr_res['pages'], 'pdf-ocr'
                except ValueError as elem:
                    methods.append({'id': 'ocr', 'name': 'Распознавание Windows (OCR)', 'error': str(elem)[:300]})
            else:
                methods.append(
                    {
                        'id': 'ocr',
                        'name': 'Распознавание Windows (OCR)',
                        'error': 'доступно на сервере под Windows 10/11',
                    }
                )
        text = cls._pages(best)
        if len(re.sub(r'\W', '', text)) < cls.TEXT_MIN:
            err = str(next((method.get('error') for method in methods if method.get('error')), ''))
            raise ValueError(
                'в PDF нет текста — похоже на скан'
                + ('; распознавание: ' + err if err else '')
                + '. Пришлите текстовый PDF или DOCX либо скопируйте текст вручную'
            )
        for method in methods:
            method['used'] = (method['id'] == 'ocr') == (kind == 'pdf-ocr') and not method.get('error')
        return cls._done(text, kind, res.get('pages'), methods)

    @classmethod
    def _image(cls, data, ocr) -> dict:
        """картинка (фото или скан ТЗ) — распознавание Windows"""
        if not ocr.available():
            raise ValueError(
                'картинка ТЗ распознаётся на сервере под Windows 10/11 (встроенное распознавание текста) — '
                'здесь недоступно: пришлите PDF с текстом, DOCX или скопируйте текст'
            )
        ocr_res = ocr.recognize(data, 'image')
        text = cls._pages(ocr_res['pages'])
        quality = TextQuality.score(text)
        return cls._done(
            text,
            'image',
            1,
            [
                {
                    'id': 'ocr',
                    'name': f'Распознавание Windows (OCR, {ocr_res.get("lang") or "язык профиля"})',
                    'chars': len(text),
                    'quality': quality,
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

        def part(name) -> ElementTree.Element:
            info = z.getinfo(name)
            if info.file_size > cls.MAX_PART:
                raise ValueError('слишком большая часть документа')
            return Xml.parse(z.read(name))

        if 'word/document.xml' in names:
            return cls._done(Xml.docx(part('word/document.xml')), 'docx')
        if 'xl/workbook.xml' in names:
            shared = Xml.shared(part('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in names else []
            sheets = sorted(
                (entry for entry in names if re.match(r'xl/worksheets/sheet\d+\.xml$', entry)),
                key=lambda entry: int(re.findall(r'\d+', entry)[-1]),
            )
            return cls._done('\n\n'.join(Xml.sheet(part(entry), shared) for entry in sheets[:20]), 'xlsx')
        if 'content.xml' in names:
            return cls._done(Xml.odf(part('content.xml')), 'odt')
        raise ValueError('архив не похож на документ — нужен ' + cls.KINDS)


class Xml:
    """Разбор частей Office/OpenDocument: текст по порядку, таблицы — строками «ячейка | ячейка»."""

    @staticmethod
    def parse(raw) -> ElementTree.Element:
        head = raw[:4096].upper()
        if b'<!DOCTYPE' in head or b'<!ENTITY' in head:
            raise ValueError('документ с недопустимой разметкой')
        try:
            return ElementTree.fromstring(raw)
        except ElementTree.ParseError:
            raise ValueError('документ повреждён — разметка не читается') from None

    @staticmethod
    def local(tag) -> str:
        return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''

    @classmethod
    def docx(cls, root) -> str:
        out = []

        def para(page) -> str:
            parts = []
            for elem in page.iter():
                tag = cls.local(elem.tag)
                if tag == 't' and elem.text:
                    parts.append(elem.text)
                elif tag == 'tab':
                    parts.append('\t')
                elif tag in ('br', 'cr'):
                    parts.append('\n')
            return ''.join(parts)

        def walk(node) -> None:
            for elem in node:
                tag = cls.local(elem.tag)
                if tag == 'p':
                    out.append(para(elem))
                elif tag == 'tbl':
                    for row in (x for x in elem.iter() if cls.local(x.tag) == 'tr'):
                        cells = [
                            ' '.join(para(page) for page in cell.iter() if cls.local(page.tag) == 'p').strip()
                            for cell in row
                            if cls.local(cell.tag) == 'tc'
                        ]
                        if any(cells):
                            out.append(' | '.join(cells))
                    out.append('')
                else:
                    walk(elem)

        body = next((child for child in root if cls.local(child.tag) == 'body'), root)
        walk(body)
        return '\n'.join(out)

    @classmethod
    def shared(cls, root) -> list:
        return [
            ''.join(node.text or '' for node in item.iter() if cls.local(node.tag) == 't')
            for item in root
            if cls.local(item.tag) == 'si'
        ]

    @classmethod
    def sheet(cls, root, shared) -> str:
        rows = []
        for row in (elem for elem in root.iter() if cls.local(elem.tag) == 'row'):
            cells = []
            for cell in (x for x in row if cls.local(x.tag) == 'c'):
                typ, v = cell.get('t'), None
                for elem in cell:
                    if cls.local(elem.tag) == 'v':
                        v = elem.text
                    elif cls.local(elem.tag) == 'is':
                        v = ''.join(node.text or '' for node in elem.iter() if cls.local(node.tag) == 't')
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

        def text(elem) -> str:
            parts = [elem.text or '']
            for child in elem:
                tag = cls.local(child.tag)
                parts.append(
                    '\t' if tag == 'tab' else '\n' if tag == 'line-break' else ' ' if tag == 's' else text(child)
                )
                parts.append(child.tail or '')
            return ''.join(parts)

        def walk(node) -> None:
            for elem in node:
                tag = cls.local(elem.tag)
                if tag in ('p', 'h'):
                    out.append(text(elem))
                elif tag == 'table-row':
                    cells = [
                        ' '.join(text(page) for page in child.iter() if cls.local(page.tag) in ('p', 'h')).strip()
                        for child in elem
                        if cls.local(child.tag) == 'table-cell'
                    ]
                    if any(cells):
                        out.append(' | '.join(x for x in cells if x))
                else:
                    walk(elem)

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
        out, stack, skip, skip_count, pend = [], [], False, 1, 0
        for word, num, hexb, sym, brace, plain in cls.TOKEN.findall(data):
            if brace == b'{':
                stack.append((skip, skip_count))
                continue
            if brace == b'}':
                skip, skip_count = stack.pop() if stack else (False, 1)
                continue
            if skip:
                continue
            if word:
                ctrl_word = word.decode('ascii')
                if ctrl_word in cls.SKIP:
                    skip = True
                elif ctrl_word in ('par', 'line', 'row', 'sect', 'page'):
                    out.append('\n')
                elif ctrl_word in ('tab', 'cell'):
                    out.append(' | ' if ctrl_word == 'cell' else '\t')
                elif ctrl_word == 'uc':
                    skip_count = int(num or 1)
                elif ctrl_word == 'u':
                    num_val = int(num or 0)
                    out.append(chr(num_val + 65536 if num_val < 0 else num_val))
                    pend = skip_count
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
                plain_text = plain.replace(b'\r', b'').replace(b'\n', b'')
                if pend:
                    plain_text, pend = plain_text[pend:], 0
                out.append(plain_text.decode('cp1251', 'replace'))
        return ''.join(out)
