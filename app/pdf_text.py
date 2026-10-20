"""Текст из «текстовых» PDF на стандартной библиотеке: потоки, ToUnicode и CID-шрифты, страницы, строки и пробелы."""

import base64
import re
import zlib
from typing import Any

from defaults import SrvVal

# наибольший файл — cat.docMaxMB («Значения программы», встроенное 40 МБ)
MAX_TEXT = 60000
MAX_STREAM = 64 * 1024 * 1024  # распакованный поток — не больше

_OBJ_RX = re.compile(rb'(\d+)\s+(\d+)\s+obj\b')
_NUM_RX = re.compile(rb'[+-]?(\d+\.?\d*|\.\d+)')  # число (токены разбираются в цикле — выражения собраны заранее)
_INT_RX = re.compile(rb'\d+')
_REF_RX = re.compile(rb'\s+(\d+)\s+R(?=[\s/<>\[\]()%]|$)')
_NOT_HEX = re.compile(rb'[^0-9A-Fa-f]')
_ESC = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}  # \n \r \t \b \f в строке PDF
_WHITESPACE = b' \t\r\n\x0c\x00'
_DELIM = b'()<>[]{}/%'


class Ref:
    __slots__ = ('num',)

    def __init__(self, num) -> None:
        self.num = num


class Name(str):
    pass


class Operator(str):
    pass


class _Lexer:
    def __init__(self, data, pos=0) -> None:
        self.data, self.pos, self.size = data, pos, len(data)

    def skip(self) -> None:
        data, size = self.data, self.size
        while self.pos < size:
            char = data[self.pos]
            if char in _WHITESPACE:
                self.pos += 1
            elif char == 0x25:  # % комментарий
                while self.pos < size and data[self.pos] not in b'\r\n':
                    self.pos += 1
            else:
                break

    def token(self) -> Any:
        """Следующий объект: число, строка (bytes), Name, list, dict, Ref, Op или None в конце."""
        self.skip()
        data, size = self.data, self.size
        if self.pos >= size:
            return None
        char = data[self.pos]
        if char == 0x28:  # ( строка )
            return self._lit()
        if char == 0x3C:  # < hex > или << словарь >>
            if data[self.pos + 1 : self.pos + 2] == b'<':
                self.pos += 2
                return self._dict()
            end = data.find(b'>', self.pos)
            end = size if end < 0 else end
            hex_digits = _NOT_HEX.sub(b'', data[self.pos + 1 : end])
            self.pos = end + 1
            if len(hex_digits) % 2:
                hex_digits += b'0'
            return bytes.fromhex(hex_digits.decode('ascii'))
        if char == 0x5B:  # [ массив ]
            self.pos += 1
            out: list = []
            while True:
                self.skip()
                if self.pos >= size:
                    return out
                if data[self.pos] == 0x5D:
                    self.pos += 1
                    return out
                tok = self.token()
                if tok is None:
                    return out
                out.append(tok)
        if char == 0x2F:  # /Имя
            start = self.pos + 1
            self.pos = start
            while self.pos < size and data[self.pos] not in _WHITESPACE and data[self.pos] not in _DELIM:
                self.pos += 1
            raw = data[start : self.pos]
            raw = re.sub(rb'#([0-9A-Fa-f]{2})', lambda hex_match: bytes([int(hex_match.group(1), 16)]), raw)
            return Name(raw.decode('latin-1'))
        if char in b')>]}':
            self.pos += 1
            return Operator(chr(char))
        start = self.pos
        while self.pos < size and data[self.pos] not in _WHITESPACE and data[self.pos] not in _DELIM:
            self.pos += 1
        if self.pos == start:
            self.pos += 1
            return Operator(chr(char))
        word = data[start : self.pos]
        if _NUM_RX.fullmatch(word):
            # «12 0 R» — ссылка
            if _INT_RX.fullmatch(word):
                match = _REF_RX.match(data[self.pos : self.pos + 24])
                if match:
                    self.pos += match.end()
                    return Ref(int(word))
            try:
                return int(word)
            except ValueError:
                return float(word)
        return Operator(word.decode('latin-1'))

    def _lit(self) -> bytes:
        data, size = self.data, self.size
        self.pos += 1
        out, depth = bytearray(), 1
        while self.pos < size:
            char = data[self.pos]
            self.pos += 1
            if char == 0x5C:  # \ экранирование
                if self.pos >= size:
                    break
                esc = data[self.pos]
                self.pos += 1
                if esc in _ESC:
                    out.append(_ESC[esc])
                elif 0x30 <= esc <= 0x37:
                    esc_char = chr(esc)
                    for _ in range(2):
                        if self.pos < size and 0x30 <= data[self.pos] <= 0x37:
                            esc_char += chr(data[self.pos])
                            self.pos += 1
                    out.append(int(esc_char, 8) & 255)
                elif esc in b'\r\n':
                    if esc == 0x0D and self.pos < size and data[self.pos] == 0x0A:
                        self.pos += 1
                else:
                    out.append(esc)
            elif char == 0x28:
                depth += 1
                out.append(char)
            elif char == 0x29:
                depth -= 1
                if depth == 0:
                    break
                out.append(char)
            else:
                out.append(char)
        return bytes(out)

    def _dict(self) -> dict:
        out: dict = {}
        while True:
            self.skip()
            if self.pos >= self.size:
                return out
            if self.data[self.pos : self.pos + 2] == b'>>':
                self.pos += 2
                return out
            k = self.token()
            if k is None:
                return out
            v = self.token()
            if isinstance(k, Name):
                out[str(k)] = v


def _decode_stream(dic, raw) -> bytes | None:
    filter_raw = dic.get('Filter')
    filters = filter_raw if isinstance(filter_raw, list) else [filter_raw] if filter_raw else []
    data = raw
    for name in filters:
        x = str(name)
        if x in ('FlateDecode', 'Fl'):
            # предел на поток — защита от «сжатой бомбы»; повреждённый конец — что распаковалось
            decomp = zlib.decompressobj()
            try:
                data = decomp.decompress(data, MAX_STREAM)
            except zlib.error:
                return None
        elif x in ('ASCIIHexDecode', 'AHx'):
            hex_digits = _NOT_HEX.sub(b'', data.split(b'>')[0])
            data = bytes.fromhex((hex_digits + b'0' * (len(hex_digits) % 2)).decode('ascii'))
        elif x in ('ASCII85Decode', 'A85'):
            stripped = data.strip()
            stripped = stripped[2:] if stripped.startswith(b'<~') else stripped
            data = base64.a85decode(stripped.split(b'~>')[0] + b'~>', adobe=True) if stripped else b''
        else:
            return None  # картинки (DCT, JBIG2…) и прочее — не текст
    params = dic.get('DecodeParms')
    if isinstance(params, dict) and (params.get('Predictor') or 1) >= 10:
        data = _png_unpredict(data, int(params.get('Columns') or 1))
    return data


def _png_unpredict(data, cols) -> bytes:
    """Предиктор PNG (бывает у потоков перекрёстных ссылок) — для потоков объектов не нужен, но и не мешает."""
    out, prev, row = bytearray(), bytearray(cols), cols + 1
    for i in range(0, len(data) - row + 1, row):
        filter_type, line = data[i], bytearray(data[i + 1 : i + row])
        for k in range(cols):
            if filter_type == 2:
                line[k] = (line[k] + prev[k]) & 255
        out += line
        prev = line
    return bytes(out)


class Doc:
    def __init__(self, data) -> None:
        if not data.startswith(b'%PDF') and b'%PDF' not in data[:1024]:
            raise ValueError('это не PDF')
        self.data, self.objs = data, {}
        for match in _OBJ_RX.finditer(data):
            num = int(match.group(1))
            lexer = _Lexer(data, match.end())
            try:
                v = lexer.token()
            except (IndexError, ValueError):
                continue
            if isinstance(v, dict):
                lexer.skip()
                if data[lexer.pos : lexer.pos + 6] == b'stream':
                    start = lexer.pos + 6
                    start += 2 if data[start : start + 2] == b'\r\n' else 1 if data[start : start + 1] in b'\r\n' else 0
                    length = v.get('Length')
                    end = (
                        start + length
                        if isinstance(length, int)
                        and data[start + length : start + length + 30].lstrip().startswith(b'endstream')
                        else data.find(b'endstream', start)
                    )
                    v = ('stream', v, data[start : end if end > 0 else len(data)])
            self.objs[num] = v  # более поздняя версия объекта (инкрементальное сохранение) заменяет раннюю
        for v in list(self.objs.values()):  # потоки объектов (PDF 1.5+)
            if isinstance(v, tuple) and str(v[1].get('Type')) == 'ObjStm':
                self._objstm(v)
        self.trailers = self._trailers()
        if any(isinstance(v, dict) and 'Encrypt' in v for v in self.trailers):
            raise ValueError('PDF защищён паролем — снимите защиту или скопируйте текст вручную')

    def _trailers(self) -> list:
        out = []
        for match in re.finditer(rb'trailer\s*<<', self.data):
            lexer = _Lexer(self.data, match.end() - 2)
            tok = lexer.token()
            if isinstance(tok, dict):
                out.append(tok)
        out += [v[1] for v in self.objs.values() if isinstance(v, tuple) and str(v[1].get('Type')) == 'XRef']
        return out

    def _objstm(self, v) -> None:
        data = _decode_stream(v[1], v[2])
        if not data:
            return
        first, cnt = int(v[1].get('First') or 0), int(v[1].get('N') or 0)
        lexer, hdr = _Lexer(data[:first]), []
        for _ in range(cnt):
            obj_num, offset = lexer.token(), lexer.token()
            if not isinstance(obj_num, int) or not isinstance(offset, int):
                break
            hdr.append((obj_num, offset))
        for num, off in hdr:
            if num in self.objs and not isinstance(self.objs[num], tuple):
                continue
            try:
                self.objs.setdefault(num, _Lexer(data, first + off).token())
            except (IndexError, ValueError):
                pass

    def get(self, v, depth=0) -> Any:
        while isinstance(v, Ref) and depth < 20:
            v = self.objs.get(v.num)
            depth += 1
        return v

    def stream(self, v) -> bytes:
        v = self.get(v)
        if isinstance(v, tuple):
            try:
                return _decode_stream(v[1], v[2]) or b''
            except (ValueError, zlib.error):
                return b''
        return b''

    def pages(self) -> list:
        root = None
        for trailer in self.trailers:
            if isinstance(trailer.get('Root'), Ref):
                root = self.get(trailer['Root'])
        out: list = []
        if isinstance(root, dict):
            self._walk(self.get(root.get('Pages')), {}, out, 0)
        if not out:  # нет дерева страниц — по порядку объектов
            out = [
                (v, v.get('Resources'))
                for num, v in sorted(self.objs.items())
                if isinstance(v, dict) and str(v.get('Type')) == 'Page'
            ]
        return out

    def _walk(self, node, inh, out, depth) -> None:
        if not isinstance(node, dict) or depth > 30:
            return
        res = node.get('Resources', inh.get('Resources'))
        if str(node.get('Type')) == 'Page' or 'Kids' not in node:
            out.append((node, res))
            return
        for k in self.get(node.get('Kids')) or []:
            self._walk(self.get(k), {'Resources': res}, out, depth + 1)


def _cmap(data) -> tuple:
    """ToUnicode: {код (bytes): текст}, длины кодов."""
    mapping, lens = {}, set()

    def uni(hex_text) -> str:
        raw = bytes.fromhex(hex_text.decode('ascii'))
        try:
            return raw.decode('utf-16-be')
        except UnicodeDecodeError:
            return ''

    for blk in re.findall(rb'begincodespacerange(.*?)endcodespacerange', data, re.S):
        for code in re.findall(rb'<([0-9A-Fa-f]+)>', blk):
            lens.add(len(code) // 2)
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', data, re.S):
        for code, pair in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>', blk):
            mapping[bytes.fromhex(code.decode('ascii'))] = uni(pair)
            lens.add(len(code) // 2)
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', data, re.S):
        for code, pair, rng in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])', blk):
            low, high, width = int(code, 16), int(pair, 16), len(code) // 2
            lens.add(width)
            if high - low > 65535:
                continue
            if rng.startswith(b'['):
                for k, hex_dst in enumerate(re.findall(rb'<([0-9A-Fa-f]*)>', rng)):
                    mapping[(low + k).to_bytes(width, 'big')] = uni(hex_dst)
            else:
                base = bytes.fromhex(rng[1:-1].decode('ascii'))
                for k in range(high - low + 1):
                    code_bytes = (
                        base[:-2] + (int.from_bytes(base[-2:], 'big') + k).to_bytes(2, 'big')
                        if len(base) >= 2
                        else bytes([base[-1] + k & 255])
                        if base
                        else b''
                    )
                    try:
                        mapping[(low + k).to_bytes(width, 'big')] = code_bytes.decode('utf-16-be')
                    except UnicodeDecodeError:
                        pass
    return mapping, sorted(lens) or [1]


class Font:
    def __init__(self, doc, font) -> None:
        font = doc.get(font) or {}
        self.map, self.lens = {}, [1]
        to_unicode = font.get('ToUnicode') if isinstance(font, dict) else None
        if to_unicode is not None:
            self.map, self.lens = _cmap(doc.stream(to_unicode))
        sub = str(font.get('Subtype')) if isinstance(font, dict) else ''
        self.two = sub == 'Type0' and not self.map
        enc = doc.get(font.get('Encoding')) if isinstance(font, dict) else None
        self.codepage = 'cp1251' if 'Cyr' in str(font.get('BaseFont', '')) or 'cp1251' in str(enc).lower() else 'cp1252'
        self.diff = {}
        if isinstance(enc, dict) and isinstance(enc.get('Differences'), list):
            code = 0
            for x in enc['Differences']:
                if isinstance(x, int):
                    code = x
                elif isinstance(x, Name):
                    u = _GLYPH.get(str(x)) or (
                        chr(int(str(x)[3:7], 16)) if re.fullmatch(r'uni[0-9A-Fa-f]{4}', str(x)) else ''
                    )
                    if u:
                        self.diff[code] = u
                    code += 1

    def text(self, raw) -> str:
        if self.map:
            out, i, lens = [], 0, self.lens
            while i < len(raw):
                for width in lens:
                    chunk = raw[i : i + width]
                    if chunk in self.map:
                        out.append(self.map[chunk])
                        i += width
                        break
                else:
                    i += lens[0]
            return ''.join(out)
        if self.two:
            return ''  # CID-шрифт без ToUnicode — текст не восстановить
        if self.diff:
            return ''.join(self.diff.get(chunk) or bytes([chunk]).decode(self.codepage, 'replace') for chunk in raw)
        return raw.decode(self.codepage, 'replace')


_GLYPH = {
    'space': ' ',
    'hyphen': '-',
    'period': '.',
    'comma': ',',
    'colon': ':',
    'semicolon': ';',
    'quotedbl': '"',
    'quoteright': '’',
    'parenleft': '(',
    'parenright': ')',
    'slash': '/',
    'percent': '%',
    'degree': '°',
    'multiply': '×',
    'endash': '–',
    'emdash': '—',
    'guillemotleft': '«',
    'guillemotright': '»',
    'numero': '№',
    'plusminus': '±',
    'bullet': '•',
}
_GLYPH.update({str(digit): str(digit) for digit in range(10)})
_GLYPH.update(
    {
        name: str(digit)
        for digit, name in enumerate(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])
    }
)


def _run(doc, data, res, out, fonts, depth=0) -> None:
    res = doc.get(res) or {}
    fdict = doc.get(res.get('Font')) or {} if isinstance(res, dict) else {}
    xobj = doc.get(res.get('XObject')) or {} if isinstance(res, dict) else {}
    lexer, stack, font = _Lexer(data), [], None
    line: list = []
    last_y = None
    pos = {'fs': 10.0, 'run': 0}  # размер шрифта; знаков, выведенных с последнего сдвига (Td)

    def newline() -> None:
        if line:
            out.append(''.join(line))
            line.clear()

    def show(raw) -> None:
        if font is not None and isinstance(raw, bytes):
            piece = font.text(raw)
            line.append(piece)
            pos['run'] += len(piece)

    while True:
        try:
            tok = lexer.token()
        except (IndexError, ValueError):
            break
        if tok is None:
            break
        if not isinstance(tok, Operator):
            stack.append(tok)
            if len(stack) > 64:
                del stack[:32]
            continue
        op_name = str(tok)
        if op_name == 'BI':  # встроенная картинка — пропустить до EI
            end_match = re.search(rb'\sEI[\s]', data[lexer.pos :])
            lexer.pos += end_match.end() if end_match else len(data)
        elif op_name == 'Tf' and len(stack) >= 2:
            key = str(stack[-2])
            if key not in fonts.setdefault(id(fdict), {}):
                fonts[id(fdict)][key] = Font(doc, fdict.get(key) if isinstance(fdict, dict) else None)
            font = fonts[id(fdict)][key]
            if isinstance(stack[-1], (int, float)) and stack[-1] > 0:
                pos['fs'] = float(stack[-1])
        elif op_name in ('Tj', "'", '"') and stack:
            if op_name != 'Tj':
                newline()
            show(stack[-1])
        elif op_name == 'TJ' and stack and isinstance(stack[-1], list):
            for x in stack[-1]:
                if isinstance(x, bytes):
                    show(x)
                elif isinstance(x, (int, float)) and x < -180 and line and not line[-1].endswith(' '):
                    line.append(' ')
        elif op_name in ('Td', 'TD') and len(stack) >= 2:
            kind = stack[-1]
            if isinstance(kind, (int, float)) and abs(kind) > 0.5:
                newline()
            elif (
                line
                and not line[-1].endswith(' ')
                and isinstance(stack[-2], (int, float))
                # пробел — только при сдвиге заметно больше выведенного текста: Td бывает и внутри слова (кернинг)
                and stack[-2] > pos['run'] * pos['fs'] * 0.62 + pos['fs'] * 0.45
            ):
                line.append(' ')
            pos['run'] = 0
        elif op_name == 'Tm' and len(stack) >= 6:
            y = stack[-1]
            if last_y is not None and isinstance(y, (int, float)) and abs(y - last_y) > 0.5:
                newline()
            elif line and not line[-1].endswith(' '):
                line.append(' ')
            last_y = y if isinstance(y, (int, float)) else last_y
            pos['run'] = 0
        elif op_name == 'T*':
            newline()
        elif op_name == 'Do' and stack and depth < 4 and isinstance(xobj, dict):
            xobject = doc.get(xobj.get(str(stack[-1])))
            if isinstance(xobject, tuple) and str(xobject[1].get('Subtype')) == 'Form':
                newline()
                _run(doc, doc.stream(xobject), xobject[1].get('Resources', res), out, fonts, depth + 1)
        stack.clear()
    newline()


class PdfText:
    """Текст PDF и текст каждой страницы: {text, pages, per}."""

    MIN_LETTERS = 20

    @classmethod
    def require(cls, data) -> dict:
        """PDF без текста (скан) — ошибка с подсказкой."""
        res = cls.read(data)
        if len(re.sub(r'\W', '', res['text'])) < cls.MIN_LETTERS:
            raise ValueError(
                'в PDF нет текста — похоже на скан (картинки). Приложите PDF прямо в окне ИИ-чата или скопируйте текст вручную'
            )
        return res

    @staticmethod
    def read(data) -> dict:
        """PDF без текста — не ошибка (дальше — распознавание)."""
        max_mb = SrvVal.now('cat.docMaxMB')
        if len(data) > max_mb * 1024 * 1024:
            raise ValueError(f'файл больше {max_mb} МБ')
        doc = Doc(data)
        pages = doc.pages()
        fonts: dict = {}
        parts = []
        per = []
        size = 0
        for page, res in pages:
            contents = page.get('Contents')
            streams = doc.get(contents)
            refs = streams if isinstance(streams, list) else [contents]
            data = b'\n'.join(doc.stream(ref) for ref in refs)
            lines: list = []
            try:
                _run(doc, data, res, lines, fonts)
            except RecursionError:
                pass
            result = '\n'.join(re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in lines)
            result = re.sub(r'\n{2,}', '\n', result).strip().replace('\x00', '')
            per.append(result)
            if result:
                parts.append(result)
                size += len(result)
            if size > MAX_TEXT:
                break
        out = '\n\n'.join(parts)
        return {'text': out[:MAX_TEXT], 'pages': len(pages), 'per': per}
