# -*- coding: utf-8 -*-
"""Текст из PDF для автозаполнения (паспорт, каталог, ТЗ) — только стандартная библиотека.

Читает обычные «текстовые» PDF: потоки FlateDecode / ASCIIHex / ASCII85, потоки объектов (PDF 1.5+), шрифты с ToUnicode
(в том числе двухбайтные CID-шрифты — так устроены почти все русские PDF из Word и САПР), простые шрифты — как cp1252/cp1251.
Страницы — по дереву /Pages; формы (XObject Form) внутри страницы тоже читаются. Строки определяются по смене положения
текста (Td, TD, T*, Tm), пробелы — по сдвигам в TJ. Сканы (только картинки) и защищённые паролем PDF — ValueError с пояснением.
"""
import base64
import re
import zlib

from defaults import SrvVal

# наибольший файл — cat.docMaxMB («Значения программы», встроенное 40 МБ)
MAX_TEXT = 60000
MAX_STREAM = 64 * 1024 * 1024        # распакованный поток — не больше

_OBJ_RX = re.compile(rb'(\d+)\s+(\d+)\s+obj\b')
_NUM_RX = re.compile(rb'[+-]?(\d+\.?\d*|\.\d+)')        # число (токены разбираются в цикле — выражения собраны заранее)
_INT_RX = re.compile(rb'\d+')
_REF_RX = re.compile(rb'\s+(\d+)\s+R(?=[\s/<>\[\]()%]|$)')
_NOT_HEX = re.compile(rb'[^0-9A-Fa-f]')
_ESC = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}    # \n \r \t \b \f в строке PDF
_WS = b' \t\r\n\x0c\x00'
_DELIM = b'()<>[]{}/%'


# ---------------------------------------------------------------- разбор объектов PDF
class Ref:
    __slots__ = ('n',)

    def __init__(self, n):
        self.n = n


class Name(str):
    pass


class Op(str):
    pass


class _Lexer:
    def __init__(self, data, pos=0):
        self.d, self.p, self.n = data, pos, len(data)

    def skip(self):
        d, n = self.d, self.n
        while self.p < n:
            c = d[self.p]
            if c in _WS:
                self.p += 1
            elif c == 0x25:                          # % комментарий
                while self.p < n and d[self.p] not in b'\r\n':
                    self.p += 1
            else:
                break

    def token(self):
        """Следующий объект: число, строка (bytes), Name, list, dict, Ref, Op или None в конце."""
        self.skip()
        d, n = self.d, self.n
        if self.p >= n:
            return None
        c = d[self.p]
        if c == 0x28:                                # ( строка )
            return self._lit()
        if c == 0x3C:                                # < hex > или << словарь >>
            if d[self.p + 1:self.p + 2] == b'<':
                self.p += 2
                return self._dict()
            e = d.find(b'>', self.p)
            e = n if e < 0 else e
            h = _NOT_HEX.sub(b'', d[self.p + 1:e])
            self.p = e + 1
            if len(h) % 2:
                h += b'0'
            return bytes.fromhex(h.decode('ascii'))
        if c == 0x5B:                                # [ массив ]
            self.p += 1
            out = []
            while True:
                self.skip()
                if self.p >= n:
                    return out
                if d[self.p] == 0x5D:
                    self.p += 1
                    return out
                t = self.token()
                if t is None:
                    return out
                out.append(t)
        if c == 0x2F:                                # /Имя
            s = self.p + 1
            self.p = s
            while self.p < n and d[self.p] not in _WS and d[self.p] not in _DELIM:
                self.p += 1
            raw = d[s:self.p]
            raw = re.sub(rb'#([0-9A-Fa-f]{2})', lambda m: bytes([int(m.group(1), 16)]), raw)
            return Name(raw.decode('latin-1'))
        if c in b')>]}':
            self.p += 1
            return Op(chr(c))
        s = self.p
        while self.p < n and d[self.p] not in _WS and d[self.p] not in _DELIM:
            self.p += 1
        if self.p == s:
            self.p += 1
            return Op(chr(c))
        w = d[s:self.p]
        if _NUM_RX.fullmatch(w):
            # «12 0 R» — ссылка
            if _INT_RX.fullmatch(w):
                m = _REF_RX.match(d[self.p:self.p + 24])
                if m:
                    self.p += m.end()
                    return Ref(int(w))
            try:
                return int(w)
            except ValueError:
                return float(w)
        return Op(w.decode('latin-1'))

    def _lit(self):
        d, n = self.d, self.n
        self.p += 1
        out, depth = bytearray(), 1
        while self.p < n:
            c = d[self.p]
            self.p += 1
            if c == 0x5C:                            # \ экранирование
                if self.p >= n:
                    break
                e = d[self.p]
                self.p += 1
                if e in _ESC:
                    out.append(_ESC[e])
                elif 0x30 <= e <= 0x37:
                    o = chr(e)
                    for _ in range(2):
                        if self.p < n and 0x30 <= d[self.p] <= 0x37:
                            o += chr(d[self.p])
                            self.p += 1
                    out.append(int(o, 8) & 255)
                elif e in b'\r\n':
                    if e == 0x0D and self.p < n and d[self.p] == 0x0A:
                        self.p += 1
                else:
                    out.append(e)
            elif c == 0x28:
                depth += 1
                out.append(c)
            elif c == 0x29:
                depth -= 1
                if depth == 0:
                    break
                out.append(c)
            else:
                out.append(c)
        return bytes(out)

    def _dict(self):
        out = {}
        while True:
            self.skip()
            if self.p >= self.n:
                return out
            if self.d[self.p:self.p + 2] == b'>>':
                self.p += 2
                return out
            k = self.token()
            if k is None:
                return out
            v = self.token()
            if isinstance(k, Name):
                out[str(k)] = v


def _decode_stream(dic, raw):
    f = dic.get('Filter')
    fl = f if isinstance(f, list) else [f] if f else []
    data = raw
    for x in fl:
        x = str(x)
        if x in ('FlateDecode', 'Fl'):
            # предел на поток: «сжатая бомба» в PDF не займёт всю память; повреждённый конец — берём, что распаковалось
            d = zlib.decompressobj()
            try:
                data = d.decompress(data, MAX_STREAM)
            except zlib.error:
                return None
        elif x in ('ASCIIHexDecode', 'AHx'):
            h = _NOT_HEX.sub(b'', data.split(b'>')[0])
            data = bytes.fromhex((h + b'0' * (len(h) % 2)).decode('ascii'))
        elif x in ('ASCII85Decode', 'A85'):
            s = data.strip()
            s = s[2:] if s.startswith(b'<~') else s
            data = base64.a85decode(s.split(b'~>')[0] + b'~>', adobe=True) if s else b''
        else:
            return None                              # картинки (DCT, JBIG2…) и прочее — не текст
    dp = dic.get('DecodeParms')
    if isinstance(dp, dict) and (dp.get('Predictor') or 1) >= 10:
        data = _png_unpredict(data, int(dp.get('Columns') or 1))
    return data


def _png_unpredict(data, cols):
    """Предиктор PNG (бывает у потоков перекрёстных ссылок) — для потоков объектов не нужен, но и не мешает."""
    out, prev, row = bytearray(), bytearray(cols), cols + 1
    for i in range(0, len(data) - row + 1, row):
        ft, line = data[i], bytearray(data[i + 1:i + row])
        for k in range(cols):
            if ft == 2:
                line[k] = (line[k] + prev[k]) & 255
        out += line
        prev = line
    return bytes(out)


class Doc:
    def __init__(self, data):
        if not data.startswith(b'%PDF') and b'%PDF' not in data[:1024]:
            raise ValueError('это не PDF')
        self.data, self.objs = data, {}
        for m in _OBJ_RX.finditer(data):
            n = int(m.group(1))
            lx = _Lexer(data, m.end())
            try:
                v = lx.token()
            except (IndexError, ValueError):
                continue
            if isinstance(v, dict):
                lx.skip()
                if data[lx.p:lx.p + 6] == b'stream':
                    s = lx.p + 6
                    s += 2 if data[s:s + 2] == b'\r\n' else 1 if data[s:s + 1] in b'\r\n' else 0
                    ln = v.get('Length')
                    e = s + ln if isinstance(ln, int) and data[s + ln:s + ln + 30].lstrip().startswith(b'endstream') else data.find(b'endstream', s)
                    v = ('stream', v, data[s:e if e > 0 else len(data)])
            self.objs[n] = v                         # более поздняя версия объекта (инкрементальное сохранение) заменяет раннюю
        for n, v in list(self.objs.items()):         # потоки объектов (PDF 1.5+)
            if isinstance(v, tuple) and str(v[1].get('Type')) == 'ObjStm':
                self._objstm(v)
        self.trailers = self._trailers()
        if any(isinstance(v, dict) and 'Encrypt' in v for v in self.trailers):
            raise ValueError('PDF защищён паролем — снимите защиту или скопируйте текст вручную')

    def _trailers(self):
        out = []
        for m in re.finditer(rb'trailer\s*<<', self.data):
            lx = _Lexer(self.data, m.end() - 2)
            t = lx.token()
            if isinstance(t, dict):
                out.append(t)
        out += [v[1] for v in self.objs.values() if isinstance(v, tuple) and str(v[1].get('Type')) == 'XRef']
        return out

    def _objstm(self, v):
        data = _decode_stream(v[1], v[2])
        if not data:
            return
        first, cnt = int(v[1].get('First') or 0), int(v[1].get('N') or 0)
        lx, hdr = _Lexer(data[:first]), []
        for _ in range(cnt):
            a, b = lx.token(), lx.token()
            if not isinstance(a, int) or not isinstance(b, int):
                break
            hdr.append((a, b))
        for n, off in hdr:
            if n in self.objs and not isinstance(self.objs[n], tuple):
                continue
            try:
                self.objs.setdefault(n, _Lexer(data, first + off).token())
            except (IndexError, ValueError):
                pass

    def get(self, v, depth=0):
        while isinstance(v, Ref) and depth < 20:
            v = self.objs.get(v.n)
            depth += 1
        return v

    def stream(self, v):
        v = self.get(v)
        if isinstance(v, tuple):
            try:
                return _decode_stream(v[1], v[2]) or b''
            except (ValueError, zlib.error):
                return b''
        return b''

    def pages(self):
        root = None
        for t in self.trailers:
            if isinstance(t.get('Root'), Ref):
                root = self.get(t['Root'])
        out = []
        if isinstance(root, dict):
            self._walk(self.get(root.get('Pages')), {}, out, 0)
        if not out:                                  # нет дерева страниц — по порядку объектов
            out = [(v, v.get('Resources')) for n, v in sorted(self.objs.items()) if isinstance(v, dict) and str(v.get('Type')) == 'Page']
        return out

    def _walk(self, node, inh, out, depth):
        if not isinstance(node, dict) or depth > 30:
            return
        res = node.get('Resources', inh.get('Resources'))
        if str(node.get('Type')) == 'Page' or 'Kids' not in node:
            out.append((node, res))
            return
        for k in self.get(node.get('Kids')) or []:
            self._walk(self.get(k), {'Resources': res}, out, depth + 1)


# ---------------------------------------------------------------- шрифты: коды → текст
def _cmap(data):
    """ToUnicode: {код (bytes): текст}, длины кодов."""
    m, lens = {}, set()

    def uni(h):
        b = bytes.fromhex(h.decode('ascii'))
        try:
            return b.decode('utf-16-be')
        except UnicodeDecodeError:
            return ''
    for blk in re.findall(rb'begincodespacerange(.*?)endcodespacerange', data, re.S):
        for a in re.findall(rb'<([0-9A-Fa-f]+)>', blk):
            lens.add(len(a) // 2)
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', data, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>', blk):
            m[bytes.fromhex(a.decode('ascii'))] = uni(b)
            lens.add(len(a) // 2)
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', data, re.S):
        for a, b, c in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])', blk):
            lo, hi, w = int(a, 16), int(b, 16), len(a) // 2
            lens.add(w)
            if hi - lo > 65535:
                continue
            if c.startswith(b'['):
                for k, h in enumerate(re.findall(rb'<([0-9A-Fa-f]*)>', c)):
                    m[(lo + k).to_bytes(w, 'big')] = uni(h)
            else:
                base = bytes.fromhex(c[1:-1].decode('ascii'))
                for k in range(hi - lo + 1):
                    t = base[:-2] + (int.from_bytes(base[-2:], 'big') + k).to_bytes(2, 'big') if len(base) >= 2 else bytes([base[-1] + k & 255]) if base else b''
                    try:
                        m[(lo + k).to_bytes(w, 'big')] = t.decode('utf-16-be')
                    except UnicodeDecodeError:
                        pass
    return m, sorted(lens) or [1]


class Font:
    def __init__(self, doc, f):
        f = doc.get(f) or {}
        self.map, self.lens = {}, [1]
        tu = f.get('ToUnicode') if isinstance(f, dict) else None
        if tu is not None:
            self.map, self.lens = _cmap(doc.stream(tu))
        sub = str(f.get('Subtype')) if isinstance(f, dict) else ''
        self.two = sub == 'Type0' and not self.map
        enc = doc.get(f.get('Encoding')) if isinstance(f, dict) else None
        self.cp = 'cp1251' if 'Cyr' in str(f.get('BaseFont', '')) or 'cp1251' in str(enc).lower() else 'cp1252'
        self.diff = {}
        if isinstance(enc, dict) and isinstance(enc.get('Differences'), list):
            code = 0
            for x in enc['Differences']:
                if isinstance(x, int):
                    code = x
                elif isinstance(x, Name):
                    u = _GLYPH.get(str(x)) or (chr(int(str(x)[3:7], 16)) if re.fullmatch(r'uni[0-9A-Fa-f]{4}', str(x)) else '')
                    if u:
                        self.diff[code] = u
                    code += 1

    def text(self, b):
        if self.map:
            out, i, L = [], 0, self.lens
            while i < len(b):
                for w in L:
                    c = b[i:i + w]
                    if c in self.map:
                        out.append(self.map[c])
                        i += w
                        break
                else:
                    i += L[0]
            return ''.join(out)
        if self.two:
            return ''                                # CID-шрифт без ToUnicode — текст не восстановить
        if self.diff:
            return ''.join(self.diff.get(c) or bytes([c]).decode(self.cp, 'replace') for c in b)
        return b.decode(self.cp, 'replace')


_GLYPH = {'space': ' ', 'hyphen': '-', 'period': '.', 'comma': ',', 'colon': ':', 'semicolon': ';', 'quotedbl': '"', 'quoteright': '’',
          'parenleft': '(', 'parenright': ')', 'slash': '/', 'percent': '%', 'degree': '°', 'multiply': '×', 'endash': '–', 'emdash': '—',
          'guillemotleft': '«', 'guillemotright': '»', 'numero': '№', 'plusminus': '±', 'bullet': '•'}
_GLYPH.update({str(d): str(d) for d in range(10)})
_GLYPH.update({n: str(d) for d, n in enumerate(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])})


# ---------------------------------------------------------------- содержимое страницы → строки
def _run(doc, data, res, out, fonts, depth=0):
    res = doc.get(res) or {}
    fdict = doc.get(res.get('Font')) or {} if isinstance(res, dict) else {}
    xobj = doc.get(res.get('XObject')) or {} if isinstance(res, dict) else {}
    lx, stack, font = _Lexer(data), [], None
    line = []
    last_y = None
    pos = {'fs': 10.0, 'run': 0}                     # размер шрифта; знаков, выведенных с последнего сдвига (Td)

    def nl():
        if line:
            out.append(''.join(line))
            line.clear()

    def show(b):
        if font is not None and isinstance(b, bytes):
            t = font.text(b)
            line.append(t)
            pos['run'] += len(t)
    while True:
        try:
            t = lx.token()
        except (IndexError, ValueError):
            break
        if t is None:
            break
        if not isinstance(t, Op):
            stack.append(t)
            if len(stack) > 64:
                del stack[:32]
            continue
        op = str(t)
        if op == 'BI':                               # встроенная картинка — пропустить до EI
            e = re.search(rb'\sEI[\s]', data[lx.p:])
            lx.p += e.end() if e else len(data)
        elif op == 'Tf' and len(stack) >= 2:
            key = str(stack[-2])
            if key not in fonts.setdefault(id(fdict), {}):
                fonts[id(fdict)][key] = Font(doc, fdict.get(key) if isinstance(fdict, dict) else None)
            font = fonts[id(fdict)][key]
            if isinstance(stack[-1], (int, float)) and stack[-1] > 0:
                pos['fs'] = float(stack[-1])
        elif op in ('Tj', "'", '"') and stack:
            if op != 'Tj':
                nl()
            show(stack[-1])
        elif op == 'TJ' and stack and isinstance(stack[-1], list):
            for x in stack[-1]:
                if isinstance(x, bytes):
                    show(x)
                elif isinstance(x, (int, float)) and x < -180 and line and not line[-1].endswith(' '):
                    line.append(' ')
        elif op in ('Td', 'TD') and len(stack) >= 2:
            ty = stack[-1]
            if isinstance(ty, (int, float)) and abs(ty) > 0.5:
                nl()
            elif line and not line[-1].endswith(' ') and isinstance(stack[-2], (int, float)):
                # сдвиг по строке: пробел, только если он заметно больше ширины уже выведенного текста
                # (многие программы ставят Td внутри слова — между частями с разным кернингом)
                if stack[-2] > pos['run'] * pos['fs'] * 0.62 + pos['fs'] * 0.45:
                    line.append(' ')
            pos['run'] = 0
        elif op == 'Tm' and len(stack) >= 6:
            y = stack[-1]
            if last_y is not None and isinstance(y, (int, float)) and abs(y - last_y) > 0.5:
                nl()
            elif line and not line[-1].endswith(' '):
                line.append(' ')
            last_y = y if isinstance(y, (int, float)) else last_y
            pos['run'] = 0
        elif op == 'T*':
            nl()
        elif op == 'Do' and stack and depth < 4 and isinstance(xobj, dict):
            xo = doc.get(xobj.get(str(stack[-1])))
            if isinstance(xo, tuple) and str(xo[1].get('Subtype')) == 'Form':
                nl()
                _run(doc, doc.stream(xo), xo[1].get('Resources', res), out, fonts, depth + 1)
        stack.clear()
    nl()


def text(data, need_text=True):
    """Текст PDF (строки, страницы через пустую строку) и текст каждой страницы (per — '' у страницы без текста, скана).
    need_text=False — PDF без текста не ошибка (дальше — распознавание скана). ValueError — понятным текстом."""
    mb = SrvVal.now('cat.docMaxMB')
    if len(data) > mb * 1024 * 1024:
        raise ValueError('файл больше %d МБ' % mb)
    doc = Doc(data)
    pages, fonts, parts, per, size = doc.pages(), {}, [], [], 0
    for pg, res in pages:
        c = pg.get('Contents')
        cs = doc.get(c)
        refs = cs if isinstance(cs, list) else [c]
        data = b'\n'.join(doc.stream(r) for r in refs)
        lines = []
        try:
            _run(doc, data, res, lines, fonts)
        except RecursionError:
            pass
        t = '\n'.join(re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in lines)
        t = re.sub(r'\n{2,}', '\n', t).strip().replace('\x00', '')
        per.append(t)
        if t:
            parts.append(t)
            size += len(t)
        if size > MAX_TEXT:
            break
    out = '\n\n'.join(parts)
    if need_text and len(re.sub(r'\W', '', out)) < 20:
        raise ValueError('в PDF нет текста — похоже на скан (картинки). Приложите PDF прямо в окне ИИ-чата или скопируйте текст вручную')
    return {'text': out[:MAX_TEXT], 'pages': len(pages), 'per': per}
