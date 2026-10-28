"""Картинки из документа (PDF, Word, Excel) для карточки оборудования — как фото со страницы товара."""

import base64
import hashlib
import re
import struct
import zipfile
import zlib
from io import BytesIO
from typing import Any

from pdf_text import Doc, Name


class DocImages:
    """Картинки документа по порядку страниц: крупные, не однотонные, без повторов → data:-адреса для окна выбора фото."""

    MEDIA = re.compile(
        r'^(word|xl|ppt)/media/[^/]+\.(png|jpe?g|gif|bmp|webp)$|^Pictures/[^/]+\.(png|jpe?g|gif|bmp|webp)$', re.I
    )
    MIME = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'bmp': 'image/bmp',
        'webp': 'image/webp',
    }
    PDF_KINDS = {'DeviceRGB': 3, 'DeviceGray': 1, 'CalRGB': 3, 'CalGray': 1}
    BITS = 8
    PNG_TYPE = {1: 0, 3: 2}  # число цветов → тип PNG: серый, RGB
    TOTAL_MAX = 30 * 1024 * 1024  # все картинки ответа — не больше (data:-адреса идут в браузер)
    PIXELS_MAX = 40_000_000  # одна картинка из PDF без сжатия — не больше (защита от «бомбы»)
    FORM_DEPTH = 2

    def __init__(self, opts: dict) -> None:
        self.opts = opts
        self.seen: set = set()
        self.out: list[dict] = []
        self.size = 0
        self.skipped = 0

    @classmethod
    def extract(cls, name: str, data: bytes, opts: dict) -> dict:
        """{imgs: [{src, w, h}], skipped} — картинки PDF, DOCX, XLSX, PPTX, ODT; прочее — пусто."""
        box = cls(opts)
        low = str(name or '').lower()
        if data[:4] == b'%PDF' or low.endswith('.pdf'):
            box._pdf(data)
        elif data[:2] == b'PK':
            box._zip(data)
        return {'imgs': box.out, 'skipped': box.skipped}

    # ---------------------------------------------------------------- Word, Excel, PowerPoint, ODT
    def _zip(self, data: bytes) -> None:
        try:
            box = zipfile.ZipFile(BytesIO(data))
        except zipfile.BadZipFile:
            return
        for info in box.infolist():
            if not self.MEDIA.match(info.filename) or info.file_size > self.TOTAL_MAX:
                continue
            ext = info.filename.rsplit('.', 1)[-1].lower()
            self._add(box.read(info), self.MIME[ext])
            if self._full():
                return

    # ---------------------------------------------------------------- PDF
    def _pdf(self, data: bytes) -> None:
        try:
            doc = Doc(data)
            pages = doc.pages()
        except (ValueError, IndexError):
            return
        done: set = set()
        for _page, res in pages:
            self._xobjects(doc, res, done, 0)
            if self._full():
                return

    def _xobjects(self, doc: Doc, res: Any, done: set, depth: int) -> None:
        res = doc.get(res)
        xobj = doc.get(res.get('XObject')) if isinstance(res, dict) else None
        if not isinstance(xobj, dict):
            return
        for ref in xobj.values():
            key = getattr(ref, 'num', id(ref))
            if key in done:
                continue
            done.add(key)
            obj = doc.get(ref)
            if not isinstance(obj, tuple):
                continue
            dic = obj[1]
            kind = str(dic.get('Subtype'))
            if kind == 'Image':
                self._pdf_image(doc, dic, obj[2])
            elif kind == 'Form' and depth < self.FORM_DEPTH:
                self._xobjects(doc, dic.get('Resources'), done, depth + 1)
            if self._full():
                return

    def _pdf_image(self, doc: Doc, dic: dict, raw: bytes) -> None:
        filters = dic.get('Filter')
        names = [str(x) for x in (filters if isinstance(filters, list) else [filters] if filters else [])]
        if names in (['DCTDecode'], ['DCT']):
            self._add(raw, 'image/jpeg')
            return
        if names not in (['FlateDecode'], ['Fl']) or dic.get('DecodeParms') or dic.get('BitsPerComponent') != self.BITS:
            return  # JPEG 2000, JBIG2, палитра, предиктор — не разбираем
        colors = self._colors(doc, dic.get('ColorSpace'))
        width, height = dic.get('Width'), dic.get('Height')
        if not colors or not isinstance(width, int) or not isinstance(height, int) or width * height > self.PIXELS_MAX:
            return
        if min(width, height) < (self.opts.get('minPx') or 0):
            self.skipped += 1
            return
        try:
            pixels = zlib.decompressobj().decompress(raw, width * height * colors + 1)
        except zlib.error:
            return
        if len(pixels) < width * height * colors:
            return
        self._add(self._png(pixels, width, height, colors), 'image/png')

    def _colors(self, doc: Doc, space: Any) -> int:
        space = doc.get(space)
        if isinstance(space, (Name, str)):
            return self.PDF_KINDS.get(str(space), 0)
        if isinstance(space, list) and space and str(space[0]) == 'ICCBased':
            stream = doc.get(space[1]) if len(space) > 1 else None
            count = stream[1].get('N') if isinstance(stream, tuple) else None
            return count if count in (1, 3) else 0
        return 0

    @classmethod
    def _png(cls, pixels: bytes, width: int, height: int, colors: int) -> bytes:
        row = width * colors
        lines = b''.join(b'\x00' + pixels[i * row : (i + 1) * row] for i in range(height))
        color_type = cls.PNG_TYPE[colors]

        def chunk(tag: bytes, body: bytes) -> bytes:
            return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)

        head = struct.pack('>IIBBBBB', width, height, cls.BITS, color_type, 0, 0, 0)
        return (
            b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + chunk(b'IDAT', zlib.compress(lines, 6)) + chunk(b'IEND', b'')
        )

    # ---------------------------------------------------------------- отбор
    def _full(self) -> bool:
        return len(self.out) >= (self.opts.get('maxCount') or 1) or self.size >= self.TOTAL_MAX

    def _add(self, data: bytes, mime: str) -> None:
        import feeds

        digest = hashlib.sha1(data).hexdigest()
        if digest in self.seen:
            return
        self.seen.add(digest)
        width, height = feeds._img_size(data)
        min_px, min_b = self.opts.get('minPx') or 0, (self.opts.get('minKB') or 0) * 1024
        small = len(data) < min_b or (width and height and min(width, height) < min_px)
        blank = (
            self.opts.get('skipBlank')
            and width
            and height
            and width * height >= feeds.BLANK_AREA
            and len(data) / (width * height) < feeds.BLANK_DENSITY
        )
        if small or blank or self.size + len(data) > self.TOTAL_MAX:
            self.skipped += 1
            return
        self.size += len(data)
        src = f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')
        self.out.append({'src': src, 'w': width or 0, 'h': height or 0})
