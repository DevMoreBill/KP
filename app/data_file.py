"""Документ программы в любом формате выгрузки (JSON, Excel, XML, YML, ZIP) и обратно."""

import hashlib
import io
import json
import math
import re
import zipfile
from collections.abc import Iterator
from datetime import datetime
from xml.sax.saxutils import escape, quoteattr


class XmlTree:
    """Значение JSON ↔ элемент XML с типом: обратно получается ровно то же значение."""

    RAW = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\r￾￿]')  # такое XML не хранит как есть — строкой JSON

    @classmethod
    def el(cls, tag, v, attrs='', depth=0) -> str:
        nl = '\n' if depth < 3 else ''
        if v is None:
            return f'<{tag}{attrs} t="z"/>'
        if isinstance(v, bool):
            return '<{}{} t="b">{}</{}>'.format(tag, attrs, 'true' if v else 'false', tag)
        if isinstance(v, (int, float)):
            return f'<{tag}{attrs} t="n">{json.dumps(v)}</{tag}>'
        if isinstance(v, dict):
            inner = ''.join(cls.el('f', x, f' n={quoteattr(str(k))}', depth + 1) + nl for k, x in v.items())
            return f'<{tag}{attrs} t="o">{nl}{inner}</{tag}>'
        if isinstance(v, (list, tuple)):
            inner = ''.join(cls.el('i', x, '', depth + 1) + nl for x in v)
            return f'<{tag}{attrs} t="a">{nl}{inner}</{tag}>'
        s = str(v)
        if cls.RAW.search(s):
            return f'<{tag}{attrs} t="e">{escape(json.dumps(s))}</{tag}>'
        return f'<{tag}{attrs}>{escape(s)}</{tag}>'

    @classmethod
    def value(cls, e) -> object:
        t = e.get('t')
        if t == 'z':
            return None
        if t == 'b':
            return (e.text or '').strip() == 'true'
        if t in ('n', 'e'):
            v = json.loads(e.text or 'null', parse_constant=lambda x: None)  # NaN, Infinity — не числа
            if isinstance(v, float) and not math.isfinite(v):
                return None
            return v
        if t == 'o':
            return {c.get('n') or '': cls.value(c) for c in e}
        if t == 'a':
            return [cls.value(c) for c in e]
        return e.text or ''

    @staticmethod
    def parse(data) -> object:
        import xml.etree.ElementTree as ET

        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
            raise ValueError('Файл XML с объявлениями DOCTYPE/ENTITY не принимается')
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            raise ValueError(f'Файл XML повреждён: {e}') from e
        node = root if root.tag == 'kp_data' else root.find('kp_data')
        if node is None:
            raise ValueError(
                'В файле нет данных программы (<kp_data>): загрузить можно только файл, выгруженный из программы'
            )
        return XmlTree.value(node)


class XlsxData:
    """Документ ↔ книга Excel с типами ячеек (число, текст, да/нет); длинные значения — частями на скрытом листе."""

    CELL = 32000  # Excel хранит в ячейке до 32 767 знаков
    MAX_ROWS = 1000000
    LONG = '⟦long:%d⟧'
    LONG_RE = re.compile(r'^⟦long:(\d+)⟧$')
    KEY = re.compile(r'^[^.:]{1,80}$')
    INFO, META, LONG_SHEET = 'Сведения', '_kp', '_long'
    SECTION = {
        'catalog': 'Каталог',
        'kp': 'КП',
        'managers': 'Менеджеры',
        'clients': 'Клиенты',
        'suppliers': 'Поставщики',
        'settings': 'Настройки',
        'audit': 'Журнал действий',
        'customs': 'ТН ВЭД',
    }
    LABELS = {
        'id': 'Код (не менять)',
        'name': 'Наименование',
        'spec': 'Кратко',
        'kind': 'Вид',
        'unit': 'Ед.',
        'short': 'Короткое название',
        'price': 'Цена КП',
        'priceCur': 'Валюта цены',
        'cost': 'Закупка',
        'costCur': 'Валюта закупки',
        'margin': 'Наценка',
        'rrc.price': 'РРЦ',
        'rrc.cur': 'Валюта РРЦ',
        'stock.qty': 'Остаток, шт.',
        'stock.available': 'В наличии',
        'attrs.cat': 'Категория (код)',
        'attrs.maker': 'Производитель',
        'attrs.series': 'Серия',
        'attrs.model': 'Модель',
        'attrs.article': 'Артикул',
        'photo.src': 'Главное фото',
        'features:json': 'Описание (блоки)',
        'groups:json': 'Характеристики (таблицы)',
        'gallery:json': 'Галерея',
        'updatedAt': 'Изменено',
        'updated': 'Изменено',
        'number': '№',
        'state': 'Состояние',
        'inn': 'ИНН',
        'kpp': 'КПП',
        'ogrn': 'ОГРН',
        'full': 'Полное наименование',
        'address': 'Адрес',
        'phone': 'Телефон',
        'email': 'E-mail',
        'country': 'Страна',
        'timestamp': 'Время',
        'action': 'Действие',
        'userName': 'Пользователь',
    }

    def __init__(self, labels=None) -> None:
        self.labels = dict(self.LABELS, **(labels or {}))

    @staticmethod
    def col(i) -> str:
        s, i = '', i + 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    @staticmethod
    def _num_ok(v) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) < 1e15

    def _plain(self, v) -> bool:
        """Значение пишется в ячейку как есть; пустая строка и null — только JSON-значением."""
        if isinstance(v, bool) or self._num_ok(v):
            return True
        return isinstance(v, str) and v != '' and not XmlTree.RAW.search(v)

    def _columns(self, rows) -> list:
        """Столбцы таблицы: [(ключ строки 2, путь (k,) или (k, sub), json?)]; вложенные объекты — раскрыты одним уровнем."""
        order, vals = [], {}
        for r in rows:
            for k, v in r.items():
                if k not in vals:
                    order.append(k)
                    vals[k] = []
                vals[k].append(v)
        order.sort(key=lambda k: (k != 'id', k != 'name'))
        out = []
        for k in order:
            if not self.KEY.match(str(k)):
                continue  # ключ с «.» или «:» — в общем столбце «_more:json»
            vs = vals[k]
            subs = {}
            flat = all(isinstance(v, dict) and v for v in vs) and all(self.KEY.match(str(s)) for v in vs for s in v)
            if flat:
                for v in vs:
                    for s in v:
                        subs.setdefault(s, None)
                flat = len(subs) <= 300
            if flat:
                for s in subs:
                    js = not all(self._plain(v[s]) for v in vs if s in v)
                    out.append(('{}.{}{}'.format(k, s, ':json' if js else ''), (k, s), js))
            else:
                js = not all(self._plain(x) for x in vs)
                out.append(('{}{}'.format(k, ':json' if js else ''), (k,), js))
        if any(not self.KEY.match(str(k)) for k in order):
            out.append(('_more:json', ('_more',), True))
        return out

    def _cell(self, ref, v, style=0) -> str:
        st = f' s="{style}"' if style else ''
        if isinstance(v, bool):
            return f'<c r="{ref}" t="b"{st}><v>{1 if v else 0}</v></c>'
        if self._num_ok(v):
            return f'<c r="{ref}"{st}><v>{repr(v) if isinstance(v, float) else v}</v></c>'
        s = str(v)
        if len(s) > self.CELL:
            self.long.append(s)
            s = self.LONG % (len(self.long) - 1)
        return f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{escape(s)}</t></is></c>'

    def _sheet(self, rows, freeze=2, widths=None, file_no=None) -> int:
        """Лист в архив книги — построчно, без строки XML всего листа (20 000 позиций занимали сотни МБ памяти)."""
        if file_no is None:
            self.files += 1
            file_no = self.files
        cols = ''.join(
            f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths or [])
        )
        pane = (
            (
                f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{freeze}" topLeftCell="A{freeze + 1}" '
                'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            )
            if freeze
            else ''
        )
        with self.z.open(f'xl/worksheets/sheet{file_no}.xml', 'w', force_zip64=True) as f:
            f.write(
                (
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    + pane
                    + (f'<cols>{cols}</cols>' if cols else '')
                    + '<sheetData>'
                ).encode('utf-8')
            )
            for n, r in enumerate(rows, 1):
                style = 1 if n == 1 else 2 if n == 2 and freeze == 2 else 0
                f.write(
                    (
                        f'<row r="{n}">'
                        + ''.join(
                            self._cell(f'{self.col(i)}{n}', v, style)
                            for i, v in enumerate(r)
                            if v is not None and v != ''
                        )
                        + '</row>'
                    ).encode('utf-8')
                )
            f.write(b'</sheetData></worksheet>')
        return file_no

    def _name(self, title) -> str:
        n = re.sub(r'[\[\]:*?/\\]', ' ', str(title)).strip()[:31] or 'Лист'
        base, k = n, 2
        while n.lower() in self.used:
            n = (base[:26] + f' ({k})')[:31]
            k += 1
        self.used.add(n.lower())
        return n

    def _table(self, title, path, recs) -> None:
        cols = self._columns(recs)
        if len(recs) > self.MAX_ROWS:
            raise ValueError(
                f'Раздел «{title}»: {len(recs)} записей — больше, чем помещается в Excel; выберите JSON или архив .zip'
            )
        head = [self.labels.get(k, k.replace(':json', '')) for k, _, _ in cols]
        keys = [k for k, _, _ in cols]

        def rows() -> Iterator[list]:
            yield head
            yield keys
            for r in recs:
                row = []
                for _, p, js in cols:
                    if p == ('_more',):
                        more = {k: v for k, v in r.items() if not self.KEY.match(str(k))}
                        row.append(json.dumps(more, ensure_ascii=False) if more else None)
                        continue
                    if p[0] not in r or (len(p) == 2 and (not isinstance(r[p[0]], dict) or p[1] not in r[p[0]])):
                        row.append(None)  # поля нет — пустая ячейка
                        continue
                    v = r[p[0]] if len(p) == 1 else r[p[0]][p[1]]
                    row.append(json.dumps(v, ensure_ascii=False) if js else v)
                yield row

        widths = [min(50, max(10, len(str(h)) + 2)) for h in head]
        name = self._name(title)
        self.sheets.append((name, self._sheet(rows(), 2, widths), False))
        self.map.append(['table', name, path])

    def _kv(self, title, path, d) -> None:
        name = self._name(title)
        rows = [['Ключ', 'Значение'], ['_key', '_value:json']] + [
            [k, json.dumps(v, ensure_ascii=False)] for k, v in d.items()
        ]
        self.sheets.append((name, self._sheet(rows, 2, [30, 80]), False))
        self.map.append(['kv', name, path])

    @staticmethod
    def _records(v) -> bool:
        return isinstance(v, list) and all(isinstance(x, dict) for x in v)

    def dump(self, doc) -> bytes:
        """Документ → байты .xlsx."""
        self.sheets, self.map, self.long, self.used = (
            [],
            [],
            [],
            {self.INFO.lower(), self.META.lower(), self.LONG_SHEET.lower()},
        )
        buf = io.BytesIO()
        self.z, self.files = (
            zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED),
            1,
        )  # лист 1 — «Сведения» (пишется последним)
        with self.z:
            self._dump(doc)
        return buf.getvalue()

    def _dump(self, doc) -> None:
        sec = doc.get('sections') if isinstance(doc.get('sections'), dict) else {}
        loose = {}
        for s, v in sec.items():
            title = self.SECTION.get(s, s)
            if self._records(v):
                self._table(title, [s], v)
            elif isinstance(v, dict):
                rest = {}
                for k, x in v.items():
                    if self._records(x) and x:
                        self._table(f'{title} · {self.SECTION.get(k, k)}' if k != s else title, [s, k], x)
                    else:
                        rest[k] = x
                if rest or not any(m[2][:1] == [s] for m in self.map):
                    self._kv(title if not any(m[2][:1] == [s] for m in self.map) else title + ' · прочее', [s], rest)
            else:
                loose[s] = v
        if loose:
            self._kv('Прочее', [], loose)
        meta = {k: v for k, v in doc.items() if k != 'sections'}
        kp = [['что', 'лист', 'путь'], ['meta', '', json.dumps(meta, ensure_ascii=False)]] + [
            [m[0], m[1], json.dumps(m[2], ensure_ascii=False)] for m in self.map
        ]
        kp_no = self._sheet(kp, 0)
        info = self._sheet(self._info(doc), 0, [28, 90], file_no=1)
        long_no = self._sheet(
            (
                [i, n, s[j : j + self.CELL]]
                for i, s in enumerate(self.long)
                for n, j in enumerate(range(0, len(s), self.CELL))
            ),
            0,
        )
        self._book([(self.INFO, info, False), *self.sheets, (self.META, kp_no, True), (self.LONG_SHEET, long_no, True)])

    def _info(self, doc) -> list:
        what = {
            'kp-backup': 'Данные программы «Конструктор КП»',
            'kp-settings': 'Настройки программы «Конструктор КП»',
        }.get(doc.get('format'), doc.get('format'))
        rows = [['Файл', what or ''], ['Выгружено', str(doc.get('createdAt') or '').replace('T', ' ')]]
        if doc.get('supplier'):
            rows.append(['Поставщик', doc['supplier']])
        for kind, name, path in self.map:
            if kind == 'table':
                rows.append([f'Лист «{name}»', f'записей: {self._count(doc, path)}'])
        rows += [
            [],
            ['Как править', '1. Строку 2 (серые служебные ключи) и столбец «Код (не менять)» не меняйте.'],
            [
                '',
                '2. Пустая ячейка — значение поля убирается; «да/нет» — ИСТИНА/ЛОЖЬ; столбцы «…:json» — значение в формате JSON.',
            ],
            [
                '',
                '3. Новая строка с новым кодом — новая запись. Строки и листы не удаляются из программы, если их удалить здесь.',
            ],
            ['', '4. Загрузить: «Настройки → База и копии → Загрузить» — программа сначала покажет, что изменится.'],
            ['', '5. Скрытые листы «_kp» и «_long» не трогайте: по ним файл собирается обратно.'],
        ]
        return rows

    @staticmethod
    def _count(doc, path) -> int:
        v = doc.get('sections') or {}
        for p in path:
            v = v.get(p) if isinstance(v, dict) else None
        return len(v) if isinstance(v, list) else 0

    @staticmethod
    def _sheet_tag(no: int, name: str, hidden: bool) -> str:
        name = escape(name, {'"': '&quot;'})
        state = ' state="hidden"' if hidden else ''
        return f'<sheet name="{name}" sheetId="{no}"{state} r:id="rId{no}"/>'

    def _book(self, sheets) -> None:
        """Служебные части книги; sheets — [(имя, номер файла листа, скрыт)] в порядке листов."""
        n = len(sheets)
        ct = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + ''.join(
                f'<Override PartName="/xl/worksheets/sheet{no}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for _, no, _ in sheets
            )
            + '</Types>'
        )
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        )
        wb = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + ''.join(self._sheet_tag(i + 1, nm, hid) for i, (nm, _, hid) in enumerate(sheets))
            + '</sheets></workbook>'
        )
        wrels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{no}.xml"/>'
                for i, (_, no, _) in enumerate(sheets)
            )
            + f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
        )
        styles = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>'
            '<font><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
            '<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>'
        )
        z = self.z
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wrels)
        z.writestr('xl/styles.xml', styles)

    @staticmethod
    def _text(s) -> str:
        import html

        return html.unescape(s)

    @classmethod
    def sheets(cls, z) -> list:
        """{имя листа: {номер строки: {номер столбца: значение с типом}}}."""
        names = set(z.namelist())
        ss = []
        if 'xl/sharedStrings.xml' in names:
            x = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
            for si in re.findall(r'<si>(.*?)</si>', x, re.S):
                ss.append(cls._text(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))
        wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
        rels = (
            z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace')
            if 'xl/_rels/workbook.xml.rels' in names
            else ''
        )
        rid = {}
        for rel in re.findall(r'<Relationship [^>]*>', rels):
            i, t = re.search(r'\bId="([^"]+)"', rel), re.search(r'\bTarget="([^"]+)"', rel)
            if i and t:
                rid[i.group(1)] = t.group(1)
        out = {}
        for m in re.finditer(r'<sheet\b[^>]*>', wb):
            nm, ri = re.search(r'\bname="([^"]*)"', m.group(0)), re.search(r'\br:id="([^"]+)"', m.group(0))
            if not nm or not ri:
                continue
            target = rid.get(ri.group(1), '')
            p = target.lstrip('/') if target.startswith('/') else 'xl/' + re.sub(r'^(\./)?(xl/)?', '', target)
            if p not in names:
                continue
            x = z.read(p).decode('utf-8', 'replace')
            rows = {}
            for rm in re.finditer(r'<row\b([^>]*?)(?:/>|>(.*?)</row>)', x, re.S):
                rn = re.search(r'\br="(\d+)"', rm.group(1))
                rn = int(rn.group(1)) if rn else len(rows) + 1
                cells = {}
                for cm in re.finditer(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', rm.group(2) or '', re.S):
                    attrs, inner = cm.group(1), cm.group(2) or ''
                    ref = re.search(r'\br="([A-Z]+)\d*"', attrs)
                    ci = cls._ci(ref.group(1)) if ref else len(cells)
                    t = re.search(r'\bt="(\w+)"', attrs)
                    t = t.group(1) if t else 'n'
                    if t == 'inlineStr':
                        v = cls._text(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))
                    else:
                        vm = re.search(r'<v>(.*?)</v>', inner, re.S)
                        if not vm:
                            continue
                        v = cls._text(vm.group(1))
                        if t == 's':
                            try:
                                v = ss[int(v)]
                            except (ValueError, IndexError):
                                continue
                        elif t == 'b':
                            v = v.strip() == '1'
                        elif t == 'n':
                            v = cls._number(v)
                    if v != '':
                        cells[ci] = v
                rows[rn] = cells
            out[cls._text(nm.group(1))] = rows
        return out

    @staticmethod
    def _ci(letters) -> int:
        n = 0
        for ch in letters:
            n = n * 26 + ord(ch) - 64
        return n - 1

    @staticmethod
    def _number(s) -> int | float | str:
        s = s.strip()
        if re.match(r'^-?\d{1,15}$', s):
            return int(s)
        try:
            f = float(s)
        except ValueError:
            return s
        if not math.isfinite(f):  # «nan», «inf» в ячейке — текст, а не число
            return s
        return int(f) if f.is_integer() and abs(f) < 1e15 and not re.search(r'[.eE]', s) else f

    def load(self, data) -> dict:
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('Файл Excel повреждён') from None
        with z:
            book = self.sheets(z)
        if self.META not in book:
            raise ValueError(
                'Это не книга, выгруженная из программы: нет служебного листа «_kp» (не удаляйте скрытые листы)'
            )
        longs = {}
        for r in sorted(book.get(self.LONG_SHEET, {}).items()):
            c = r[1]
            if isinstance(c.get(0), int) and isinstance(c.get(1), int):
                longs.setdefault(c[0], {})[c[1]] = str(c.get(2, ''))
        longs = {i: ''.join(p[k] for k in sorted(p)) for i, p in longs.items()}

        def full(v) -> str:
            if isinstance(v, str):
                m = self.LONG_RE.match(v)
                if m:
                    return longs.get(int(m.group(1)), '')
            return v

        meta, maps = None, []
        for _, c in sorted(book[self.META].items()):
            kind = c.get(0)
            if kind == 'meta':
                meta = json.loads(full(c.get(2)) or '{}', parse_constant=DataFile.no_const)
            elif kind in ('table', 'kv'):
                maps.append(
                    (kind, full(c.get(1)), json.loads(full(c.get(2)) or '[]', parse_constant=DataFile.no_const))
                )
        if not isinstance(meta, dict):
            raise ValueError('Служебный лист «_kp» повреждён')
        doc = dict(meta, sections={})
        for kind, name, path in maps:
            rows = book.get(name)
            if rows is None:
                raise ValueError(f'В книге нет листа «{name}» — не переименовывайте и не удаляйте листы')
            keys = {c: str(k).strip() for c, k in (rows.get(2) or {}).items() if str(k).strip()}
            recs = []
            for rn in sorted(r for r in rows if r > 2):
                rec = {}
                for c, key in keys.items():
                    if c not in rows[rn]:
                        continue
                    v = full(rows[rn][c])
                    js = key.endswith(':json')
                    k = key[:-5] if js else key
                    if js and isinstance(v, str):
                        try:
                            v = json.loads(v, parse_constant=DataFile.no_const)
                        except ValueError:
                            raise ValueError(
                                f'Лист «{name}», ячейка {self.col(c)}{rn}: значение не в формате JSON'
                            ) from None
                    if k == '_more' and isinstance(v, dict):
                        rec.update(v)
                        continue
                    if '.' in k and kind == 'table':
                        a, b = k.split('.', 1)
                        if not isinstance(rec.get(a), dict):
                            rec[a] = {}
                        rec[a][b] = v
                    else:
                        rec[k] = v
                recs.append(rec)
            if kind == 'table':
                self._put(doc['sections'], path, recs)
            else:
                d = {}
                for rec in recs:
                    if '_key' in rec:
                        d[str(rec['_key'])] = rec.get('_value')
                if path:
                    cur = self._get(doc['sections'], path)
                    if isinstance(cur, dict):
                        cur.update(d)
                    else:
                        self._put(doc['sections'], path, d)
                else:
                    doc['sections'].update(d)
        return doc

    @staticmethod
    def _get(root, path) -> object:
        v = root
        for p in path:
            v = v.get(p) if isinstance(v, dict) else None
        return v

    @staticmethod
    def _put(root, path, v) -> None:
        cur = root
        for p in path[:-1]:
            if not isinstance(cur.get(p), dict):
                cur[p] = {}
            cur = cur[p]
        if isinstance(cur.get(path[-1]), dict) and isinstance(v, dict):
            cur[path[-1]].update(v)
        else:
            cur[path[-1]] = v


class YmlData:
    """Яндекс YML: предложения каталога (для сайтов и маркетплейсов) + <kp_data> со всем документом (для загрузки обратно)."""

    def __init__(self, base_url='', types=None) -> None:
        self.base, self.types = (base_url or '').rstrip('/'), types or {}

    @staticmethod
    def _t(tag, v, attrs='') -> str:
        if v in (None, ''):
            return ''
        return '<{}{}>{}</{}>'.format(tag, attrs, escape(XmlTree.RAW.sub(' ', str(v))), tag)

    def _pic(self, src) -> str:
        if not isinstance(src, str):
            return ''
        if src.startswith('/img/'):
            return (self.base or 'http://localhost') + src
        return src if re.match(r'^https?://', src, re.I) else ''

    def dump(self, doc) -> bytes:
        t = self._t
        items = (doc.get('sections') or {}).get('catalog')
        items = items if isinstance(items, list) else []
        cats, cur = {}, lambda c: 'RUR' if c in ('RUB', 'RUR', '', None) else str(c)
        for x in items:
            c = str(((x.get('attrs') or {}) if isinstance(x, dict) else {}).get('cat') or '')
            cats.setdefault(c, len(cats) + 1)
        curs = sorted({cur(x.get('priceCur')) for x in items if isinstance(x, dict) and x.get('price')} | {'RUR'})
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<yml_catalog date={}><shop>'.format(quoteattr(datetime.now().strftime('%Y-%m-%dT%H:%M'))),
            t('name', 'Каталог'),
            t('company', 'Каталог'),
            t('url', self.base or 'http://localhost'),
            '<currencies>'
            + ''.join(
                '<currency id={} rate={}/>'.format(quoteattr(c), quoteattr('1' if c == 'RUR' else 'CBRF')) for c in curs
            )
            + '</currencies>',
            '<categories>'
            + ''.join(
                t('category', (self.types.get(c) or {}).get('name') or c or 'Без категории', f' id="{i}"')
                for c, i in cats.items()
            )
            + '</categories>',
            '<offers>',
        ]
        for x in items:
            if not isinstance(x, dict) or not x.get('id'):
                continue
            a = x.get('attrs') if isinstance(x.get('attrs'), dict) else {}
            fields = {
                f.get('key'): f for f in (self.types.get(a.get('cat')) or {}).get('fields') or [] if isinstance(f, dict)
            }
            st = x.get('stock') if isinstance(x.get('stock'), dict) else None
            q = (
                st.get('qty')
                if st and isinstance(st.get('qty'), (int, float)) and not isinstance(st.get('qty'), bool)
                else None
            )
            avail = (
                ''
                if st is None
                else f' available="{"true" if (q or 0) > 0 or (q is None and st.get("available")) else "false"}"'
            )
            pics = [
                p
                for p in [self._pic((x.get('photo') or {}).get('src') if isinstance(x.get('photo'), dict) else '')]
                + [self._pic(g.get('src')) for g in (x.get('gallery') or []) if isinstance(g, dict)]
                if p
            ]
            params = ''.join(
                t(
                    'param',
                    v,
                    ' name={}{}'.format(
                        quoteattr((fields.get(k) or {}).get('label') or k),
                        ' unit={}'.format(quoteattr(fields[k]['unit'])) if (fields.get(k) or {}).get('unit') else '',
                    ),
                )
                for k, v in a.items()
                if k not in ('cat', 'maker', 'model', 'series', 'article')
                and isinstance(v, (str, int, float))
                and not isinstance(v, bool)
            )
            rrc = x.get('rrc') if isinstance(x.get('rrc'), dict) else {}
            out.append(
                '<offer id={}{}>'.format(quoteattr(str(x['id'])), avail)
                + t('name', x.get('name'))
                + t('vendor', a.get('maker'))
                + t('model', a.get('model') or x.get('name'))
                + t('vendorCode', a.get('article'))
                + (t('price', x.get('price')) + t('currencyId', cur(x.get('priceCur'))) if x.get('price') else '')
                + t('categoryId', cats.get(str(a.get('cat') or '')))
                + ''.join(t('picture', p) for p in dict.fromkeys(pics))
                + t('description', x.get('spec'))
                + params
                + (
                    t('param', rrc.get('price'), ' name="РРЦ" unit={}'.format(quoteattr(rrc.get('cur') or 'RUB')))
                    if rrc.get('price')
                    else ''
                )
                + '</offer>'
            )
        out.append('</offers></shop>')
        out.append(XmlTree.el('kp_data', doc))
        out.append('</yml_catalog>')
        return '\n'.join(out).encode('utf-8')


class DataFile:
    """Форматы выгрузки и загрузки документа программы (общий список для всех вариантов выгрузки)."""

    @staticmethod
    def no_const(name) -> None:
        """json.loads(parse_constant=...): NaN и Infinity в загружаемом файле — отказ."""
        raise ValueError(f'В файле недопустимое число: {name}')

    FORMATS = (
        ('xlsx', 'Excel (.xlsx)'),
        ('json', 'JSON'),
        ('xml', 'XML'),
        ('yml', 'YML'),
        ('zip', 'Архив .zip (данные и фото)'),
    )
    TYPES = {
        'xlsx': ('.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        'json': ('.json', 'application/json; charset=utf-8'),
        'xml': ('.xml', 'application/xml; charset=utf-8'),
        'yml': ('.yml', 'application/xml; charset=utf-8'),
        'zip': ('.zip', 'application/zip'),
    }
    TECH = ('_light', 'st', 'pricesCount', '_rev')  # служебное — в сравнение записей не входит

    def __init__(self, img_dir: str | None = None, base_url='', labels=None, types=None) -> None:
        self.img_dir, self.base, self.labels, self.types = img_dir, base_url, labels, types

    @classmethod
    def fmt(cls, v, default='json') -> str:
        return v if v in cls.TYPES else default

    def dump(self, body, fmt, doc=None) -> tuple:
        """Документ (текст JSON или разобранный) → (байты, расширение, тип, сведения для журнала)."""
        ext, ctype = self.TYPES[fmt]
        if doc is not None and fmt in ('json', 'zip'):
            body, doc = json.dumps(doc, ensure_ascii=False), None
        if fmt == 'json':
            return body.encode('utf-8'), ext, ctype, {}
        if fmt == 'zip':
            from data_bundle import DataBundle

            data, n, missing = DataBundle(self.img_dir or '.').pack(body)
            return data, ext, ctype, {'images': n, 'missing': missing}
        if doc is None:
            doc = json.loads(body)
        if fmt == 'xlsx':
            return XlsxData(self.labels).dump(doc), ext, ctype, {}
        if fmt == 'xml':
            return (
                ('<?xml version="1.0" encoding="UTF-8"?>\n' + XmlTree.el('kp_data', doc)).encode('utf-8'),
                ext,
                ctype,
                {},
            )
        return YmlData(self.base, self.types).dump(doc), ext, ctype, {}

    @staticmethod
    def sniff(data) -> str:
        """Что за файл: sqlite, sqlite-zip, xlsx, xlsx-patch (книга «для правки» 3.98), zip, xml, json."""
        if not data:
            raise ValueError('Файл пустой')
        if data[:16] == b'SQLite format 3\x00':
            return 'sqlite'
        if data[:2] == b'PK':
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    names = z.namelist()
                    if 'xl/workbook.xml' in names:
                        wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
                        return 'xlsx' if re.search(r'<sheet\b[^>]*\bname="_kp"', wb) else 'xlsx-patch'
            except zipfile.BadZipFile:
                raise ValueError('Архив повреждён или это не архив ZIP') from None
            if any(n.lower().endswith(('.sqlite3', '.sqlite', '.db')) for n in names) and not any(
                n.lower().endswith('.json') for n in names
            ):
                return 'sqlite-zip'
            return 'zip'
        head = data[:2048].lstrip(b'\xef\xbb\xbf \t\r\n')
        return 'xml' if head[:1] == b'<' else 'json'

    def load(self, data) -> tuple:
        """Файл любого формата → (документ, открытый архив .zip или None, изображения архива)."""
        kind = self.sniff(data)
        if kind in ('json', 'zip'):
            from data_bundle import DataBundle

            return DataBundle(self.img_dir or '.').read(data)
        if kind == 'xlsx':
            return XlsxData().load(data), None, []
        if kind == 'xml':
            return XmlTree.parse(data), None, []
        raise ValueError('Этот файл загружается не здесь')

    @classmethod
    def _norm(cls, v, top=True) -> object:
        if isinstance(v, bool) or v is None:
            return v
        if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
            return int(v)
        if isinstance(v, dict):
            return {k: cls._norm(x, False) for k, x in v.items() if not (top and (x is None or x == ''))}
        if isinstance(v, list):
            return [cls._norm(x, False) for x in v]
        return v

    @classmethod
    def digest(cls, rec, skip=()) -> str:
        """Отпечаток записи: без служебных полей и skip; пустые поля и 10 = 10.0 — одинаково во всех форматах."""
        if isinstance(rec, dict):
            rec = {
                k: (cls._norm(v, True) if isinstance(v, dict) else cls._norm(v, False))
                for k, v in rec.items()
                if k not in cls.TECH and k not in skip and v is not None and v != ''
            }
        return hashlib.sha1(
            json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        ).hexdigest()[:12]
