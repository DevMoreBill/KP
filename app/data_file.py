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
        newline = '\n' if depth < 3 else ''
        if v is None:
            return f'<{tag}{attrs} t="z"/>'
        if isinstance(v, bool):
            return '<{}{} t="b">{}</{}>'.format(tag, attrs, 'true' if v else 'false', tag)
        if isinstance(v, (int, float)):
            return f'<{tag}{attrs} t="n">{json.dumps(v)}</{tag}>'
        if isinstance(v, dict):
            inner = ''.join(cls.el('f', x, f' n={quoteattr(str(k))}', depth + 1) + newline for k, x in v.items())
            return f'<{tag}{attrs} t="o">{newline}{inner}</{tag}>'
        if isinstance(v, (list, tuple)):
            inner = ''.join(cls.el('i', x, '', depth + 1) + newline for x in v)
            return f'<{tag}{attrs} t="a">{newline}{inner}</{tag}>'
        text = str(v)
        if cls.RAW.search(text):
            return f'<{tag}{attrs} t="e">{escape(json.dumps(text))}</{tag}>'
        return f'<{tag}{attrs}>{escape(text)}</{tag}>'

    @classmethod
    def value(cls, elem) -> object:
        type_attr = elem.get('t')
        if type_attr == 'z':
            return None
        if type_attr == 'b':
            return (elem.text or '').strip() == 'true'
        if type_attr in ('n', 'e'):
            v = json.loads(elem.text or 'null', parse_constant=lambda x: None)  # NaN, Infinity — не числа
            if isinstance(v, float) and not math.isfinite(v):
                return None
            return v
        if type_attr == 'o':
            return {child.get('n') or '': cls.value(child) for child in elem}
        if type_attr == 'a':
            return [cls.value(child) for child in elem]
        return elem.text or ''

    @staticmethod
    def parse(data) -> object:
        from xml.etree import ElementTree

        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
            raise ValueError('Файл XML с объявлениями DOCTYPE/ENTITY не принимается')
        try:
            root = ElementTree.fromstring(data)
        except ElementTree.ParseError as elem:
            raise ValueError(f'Файл XML повреждён: {elem}') from elem
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
        label, i = '', i + 1
        while i:
            i, rest = divmod(i - 1, 26)
            label = chr(65 + rest) + label
        return label

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
        for rec in rows:
            for k, v in rec.items():
                if k not in vals:
                    order.append(k)
                    vals[k] = []
                vals[k].append(v)
        order.sort(key=lambda k: (k != 'id', k != 'name'))
        out = []
        for k in order:
            if not self.KEY.match(str(k)):
                continue  # ключ с «.» или «:» — в общем столбце «_more:json»
            values = vals[k]
            subs = {}
            flat = all(isinstance(v, dict) and v for v in values) and all(
                self.KEY.match(str(key)) for v in values for key in v
            )
            if flat:
                for v in values:
                    for key in v:
                        subs.setdefault(key, None)
                flat = len(subs) <= 300
            if flat:
                for key in subs:
                    is_json = not all(self._plain(v[key]) for v in values if key in v)
                    out.append(('{}.{}{}'.format(k, key, ':json' if is_json else ''), (k, key), is_json))
            else:
                is_json = not all(self._plain(x) for x in values)
                out.append(('{}{}'.format(k, ':json' if is_json else ''), (k,), is_json))
        if any(not self.KEY.match(str(k)) for k in order):
            out.append(('_more:json', ('_more',), True))
        return out

    def _cell(self, ref, v, style=0) -> str:
        style_attr = f' s="{style}"' if style else ''
        if isinstance(v, bool):
            return f'<c r="{ref}" t="b"{style_attr}><v>{1 if v else 0}</v></c>'
        if self._num_ok(v):
            return f'<c r="{ref}"{style_attr}><v>{repr(v) if isinstance(v, float) else v}</v></c>'
        text = str(v)
        if len(text) > self.CELL:
            self.long.append(text)
            text = self.LONG % (len(self.long) - 1)
        return f'<c r="{ref}" t="inlineStr"{style_attr}><is><t xml:space="preserve">{escape(text)}</t></is></c>'

    def _sheet(self, rows, freeze=2, widths=None, file_no=None) -> int:
        """Лист в архив книги — построчно, без строки XML всего листа (20 000 позиций занимали сотни МБ памяти)."""
        if file_no is None:
            self.files += 1
            file_no = self.files
        cols = ''.join(
            f'<col min="{i + 1}" max="{i + 1}" width="{width}" customWidth="1"/>'
            for i, width in enumerate(widths or [])
        )
        pane = (
            (
                f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{freeze}" topLeftCell="A{freeze + 1}" '
                'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            )
            if freeze
            else ''
        )
        with self.z.open(f'xl/worksheets/sheet{file_no}.xml', 'w', force_zip64=True) as handle:
            handle.write(
                (
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    + pane
                    + (f'<cols>{cols}</cols>' if cols else '')
                    + '<sheetData>'
                ).encode('utf-8')
            )
            for row_no, row in enumerate(rows, 1):
                style = 1 if row_no == 1 else 2 if row_no == 2 and freeze == 2 else 0
                handle.write(
                    (
                        f'<row r="{row_no}">'
                        + ''.join(
                            self._cell(f'{self.col(i)}{row_no}', v, style)
                            for i, v in enumerate(row)
                            if v is not None and v != ''
                        )
                        + '</row>'
                    ).encode('utf-8')
                )
            handle.write(b'</sheetData></worksheet>')
        return file_no

    def _name(self, title) -> str:
        name = re.sub(r'[\[\]:*?/\\]', ' ', str(title)).strip()[:31] or 'Лист'
        base, k = name, 2
        while name.lower() in self.used:
            name = (base[:26] + f' ({k})')[:31]
            k += 1
        self.used.add(name.lower())
        return name

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
            for rec in recs:
                row = []
                for _, col_path, is_json in cols:
                    if col_path == ('_more',):
                        more = {k: v for k, v in rec.items() if not self.KEY.match(str(k))}
                        row.append(json.dumps(more, ensure_ascii=False) if more else None)
                        continue
                    if col_path[0] not in rec or (
                        len(col_path) == 2
                        and (not isinstance(rec[col_path[0]], dict) or col_path[1] not in rec[col_path[0]])
                    ):
                        row.append(None)  # поля нет — пустая ячейка
                        continue
                    v = rec[col_path[0]] if len(col_path) == 1 else rec[col_path[0]][col_path[1]]
                    row.append(json.dumps(v, ensure_ascii=False) if is_json else v)
                yield row

        widths = [min(50, max(10, len(str(head_cell)) + 2)) for head_cell in head]
        name = self._name(title)
        self.sheets.append((name, self._sheet(rows(), 2, widths), False))
        self.map.append(['table', name, path])

    def _pairs(self, title, path, data) -> None:
        name = self._name(title)
        rows = [['Ключ', 'Значение'], ['_key', '_value:json']] + [
            [k, json.dumps(v, ensure_ascii=False)] for k, v in data.items()
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
        for sec_key, v in sec.items():
            title = self.SECTION.get(sec_key, sec_key)
            if self._records(v):
                self._table(title, [sec_key], v)
            elif isinstance(v, dict):
                rest = {}
                for k, x in v.items():
                    if self._records(x) and x:
                        self._table(f'{title} · {self.SECTION.get(k, k)}' if k != sec_key else title, [sec_key, k], x)
                    else:
                        rest[k] = x
                if rest or not any(item[2][:1] == [sec_key] for item in self.map):
                    self._pairs(
                        title if not any(item[2][:1] == [sec_key] for item in self.map) else title + ' · прочее',
                        [sec_key],
                        rest,
                    )
            else:
                loose[sec_key] = v
        if loose:
            self._pairs('Прочее', [], loose)
        meta = {k: v for k, v in doc.items() if k != 'sections'}
        meta_rows = [['что', 'лист', 'путь'], ['meta', '', json.dumps(meta, ensure_ascii=False)]] + [
            [item[0], item[1], json.dumps(item[2], ensure_ascii=False)] for item in self.map
        ]
        kp_no = self._sheet(meta_rows, 0)
        info = self._sheet(self._info(doc), 0, [28, 90], file_no=1)
        long_no = self._sheet(
            (
                [i, part_no, sec_key[j : j + self.CELL]]
                for i, sec_key in enumerate(self.long)
                for part_no, j in enumerate(range(0, len(sec_key), self.CELL))
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
        for step in path:
            v = v.get(step) if isinstance(v, dict) else None
        return len(v) if isinstance(v, list) else 0

    @staticmethod
    def _sheet_tag(num: int, name: str, hidden: bool) -> str:
        name = escape(name, {'"': '&quot;'})
        state = ' state="hidden"' if hidden else ''
        return f'<sheet name="{name}" sheetId="{num}"{state} r:id="rId{num}"/>'

    def _book(self, sheets) -> None:
        """Служебные части книги; sheets — [(имя, номер файла листа, скрыт)] в порядке листов."""
        count = len(sheets)
        content_types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + ''.join(
                f'<Override PartName="/xl/worksheets/sheet{num}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for _, num, _ in sheets
            )
            + '</Types>'
        )
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        )
        workbook = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + ''.join(self._sheet_tag(i + 1, name_match, hid) for i, (name_match, _, hid) in enumerate(sheets))
            + '</sheets></workbook>'
        )
        wrels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{num}.xml"/>'
                for i, (_, num, _) in enumerate(sheets)
            )
            + f'<Relationship Id="rId{count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
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
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', workbook)
        z.writestr('xl/_rels/workbook.xml.rels', wrels)
        z.writestr('xl/styles.xml', styles)

    @staticmethod
    def _text(text) -> str:
        import html

        return html.unescape(text)

    @classmethod
    def sheets(cls, z) -> list:
        """{имя листа: {номер строки: {номер столбца: значение с типом}}}."""
        names = set(z.namelist())
        strings = []
        if 'xl/sharedStrings.xml' in names:
            x = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
            for item in re.findall(r'<si>(.*?)</si>', x, re.S):
                strings.append(cls._text(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S))))
        workbook = z.read('xl/workbook.xml').decode('utf-8', 'replace')
        rels = (
            z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace')
            if 'xl/_rels/workbook.xml.rels' in names
            else ''
        )
        rid = {}
        for rel in re.findall(r'<Relationship [^>]*>', rels):
            i, id_match = re.search(r'\bId="([^"]+)"', rel), re.search(r'\bTarget="([^"]+)"', rel)
            if i and id_match:
                rid[i.group(1)] = id_match.group(1)
        out = {}
        for part in re.finditer(r'<sheet\b[^>]*>', workbook):
            name_match, rel_id = (
                re.search(r'\bname="([^"]*)"', part.group(0)),
                re.search(r'\br:id="([^"]+)"', part.group(0)),
            )
            if not name_match or not rel_id:
                continue
            target = rid.get(rel_id.group(1), '')
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + re.sub(r'^(\./)?(xl/)?', '', target)
            if path not in names:
                continue
            x = z.read(path).decode('utf-8', 'replace')
            rows = {}
            for row_match in re.finditer(r'<row\b([^>]*?)(?:/>|>(.*?)</row>)', x, re.S):
                row_num = re.search(r'\br="(\d+)"', row_match.group(1))
                row_num = int(row_num.group(1)) if row_num else len(rows) + 1
                cells = {}
                for cell_match in re.finditer(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', row_match.group(2) or '', re.S):
                    attrs, inner = cell_match.group(1), cell_match.group(2) or ''
                    ref = re.search(r'\br="([A-Z]+)\d*"', attrs)
                    col_ix = cls._col_index(ref.group(1)) if ref else len(cells)
                    id_match = re.search(r'\bt="(\w+)"', attrs)
                    id_match = id_match.group(1) if id_match else 'n'
                    if id_match == 'inlineStr':
                        v = cls._text(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))
                    else:
                        val_match = re.search(r'<v>(.*?)</v>', inner, re.S)
                        if not val_match:
                            continue
                        v = cls._text(val_match.group(1))
                        if id_match == 's':
                            try:
                                v = strings[int(v)]
                            except (ValueError, IndexError):
                                continue
                        elif id_match == 'b':
                            v = v.strip() == '1'
                        elif id_match == 'n':
                            v = cls._number(v)
                    if v != '':
                        cells[col_ix] = v
                rows[row_num] = cells
            out[cls._text(name_match.group(1))] = rows
        return out

    @staticmethod
    def _col_index(letters) -> int:
        num = 0
        for char in letters:
            num = num * 26 + ord(char) - 64
        return num - 1

    @staticmethod
    def _number(text) -> int | float | str:
        text = text.strip()
        if re.match(r'^-?\d{1,15}$', text):
            return int(text)
        try:
            num = float(text)
        except ValueError:
            return text
        if not math.isfinite(num):  # «nan», «inf» в ячейке — текст, а не число
            return text
        return int(num) if num.is_integer() and abs(num) < 1e15 and not re.search(r'[.eE]', text) else num

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
        for long_row in sorted(book.get(self.LONG_SHEET, {}).items()):
            cell = long_row[1]
            if isinstance(cell.get(0), int) and isinstance(cell.get(1), int):
                longs.setdefault(cell[0], {})[cell[1]] = str(cell.get(2, ''))
        longs = {i: ''.join(part[k] for k in sorted(part)) for i, part in longs.items()}

        def full(v) -> str:
            if isinstance(v, str):
                part = self.LONG_RE.match(v)
                if part:
                    return longs.get(int(part.group(1)), '')
            return v

        meta, maps = None, []
        for _, cell in sorted(book[self.META].items()):
            kind = cell.get(0)
            if kind == 'meta':
                meta = json.loads(full(cell.get(2)) or '{}', parse_constant=DataFile.no_const)
            elif kind in ('table', 'kv'):
                maps.append(
                    (kind, full(cell.get(1)), json.loads(full(cell.get(2)) or '[]', parse_constant=DataFile.no_const))
                )
        if not isinstance(meta, dict):
            raise ValueError('Служебный лист «_kp» повреждён')
        doc = dict(meta, sections={})
        for kind, name, path in maps:
            rows = book.get(name)
            if rows is None:
                raise ValueError(f'В книге нет листа «{name}» — не переименовывайте и не удаляйте листы')
            keys = {cell: str(k).strip() for cell, k in (rows.get(2) or {}).items() if str(k).strip()}
            recs = []
            for row_num in sorted(long_row for long_row in rows if long_row > 2):
                rec = {}
                for cell, key in keys.items():
                    if cell not in rows[row_num]:
                        continue
                    v = full(rows[row_num][cell])
                    is_json = key.endswith(':json')
                    k = key[:-5] if is_json else key
                    if is_json and isinstance(v, str):
                        try:
                            v = json.loads(v, parse_constant=DataFile.no_const)
                        except ValueError:
                            raise ValueError(
                                f'Лист «{name}», ячейка {self.col(cell)}{row_num}: значение не в формате JSON'
                            ) from None
                    if k == '_more' and isinstance(v, dict):
                        rec.update(v)
                        continue
                    if '.' in k and kind == 'table':
                        head, tail = k.split('.', 1)
                        if not isinstance(rec.get(head), dict):
                            rec[head] = {}
                        rec[head][tail] = v
                    else:
                        rec[k] = v
                recs.append(rec)
            if kind == 'table':
                self._put(doc['sections'], path, recs)
            else:
                target = {}
                for rec in recs:
                    if '_key' in rec:
                        target[str(rec['_key'])] = rec.get('_value')
                if path:
                    cur = self._get(doc['sections'], path)
                    if isinstance(cur, dict):
                        cur.update(target)
                    else:
                        self._put(doc['sections'], path, target)
                else:
                    doc['sections'].update(target)
        return doc

    @staticmethod
    def _get(root, path) -> object:
        v = root
        for step in path:
            v = v.get(step) if isinstance(v, dict) else None
        return v

    @staticmethod
    def _put(root, path, v) -> None:
        cur = root
        for step in path[:-1]:
            if not isinstance(cur.get(step), dict):
                cur[step] = {}
            cur = cur[step]
        if isinstance(cur.get(path[-1]), dict) and isinstance(v, dict):
            cur[path[-1]].update(v)
        else:
            cur[path[-1]] = v


class YmlData:
    """Яндекс YML: предложения каталога (для сайтов и маркетплейсов) + <kp_data> со всем документом (для загрузки обратно)."""

    def __init__(self, base_url='', types=None) -> None:
        self.base, self.types = (base_url or '').rstrip('/'), types or {}

    @staticmethod
    def _tag(tag, v, attrs='') -> str:
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
        tag = self._tag
        items = (doc.get('sections') or {}).get('catalog')
        items = items if isinstance(items, list) else []
        cats, cur = {}, lambda code: 'RUR' if code in ('RUB', 'RUR', '', None) else str(code)
        for x in items:
            cur_code = str(((x.get('attrs') or {}) if isinstance(x, dict) else {}).get('cat') or '')
            cats.setdefault(cur_code, len(cats) + 1)
        curs = sorted({cur(x.get('priceCur')) for x in items if isinstance(x, dict) and x.get('price')} | {'RUR'})
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<yml_catalog date={}><shop>'.format(quoteattr(datetime.now().strftime('%Y-%m-%dT%H:%M'))),
            tag('name', 'Каталог'),
            tag('company', 'Каталог'),
            tag('url', self.base or 'http://localhost'),
            '<currencies>'
            + ''.join(
                '<currency id={} rate={}/>'.format(quoteattr(cur_code), quoteattr('1' if cur_code == 'RUR' else 'CBRF'))
                for cur_code in curs
            )
            + '</currencies>',
            '<categories>'
            + ''.join(
                tag(
                    'category',
                    (self.types.get(cur_code) or {}).get('name') or cur_code or 'Без категории',
                    f' id="{i}"',
                )
                for cur_code, i in cats.items()
            )
            + '</categories>',
            '<offers>',
        ]
        for x in items:
            if not isinstance(x, dict) or not x.get('id'):
                continue
            attrs = x.get('attrs') if isinstance(x.get('attrs'), dict) else {}
            fields = {
                field.get('key'): field
                for field in (self.types.get(attrs.get('cat')) or {}).get('fields') or []
                if isinstance(field, dict)
            }
            stock = x.get('stock') if isinstance(x.get('stock'), dict) else None
            qty = (
                stock.get('qty')
                if stock and isinstance(stock.get('qty'), (int, float)) and not isinstance(stock.get('qty'), bool)
                else None
            )
            avail = (
                ''
                if stock is None
                else f' available="{"true" if (qty or 0) > 0 or (qty is None and stock.get("available")) else "false"}"'
            )
            pics = [
                pic
                for pic in [self._pic((x.get('photo') or {}).get('src') if isinstance(x.get('photo'), dict) else '')]
                + [self._pic(gal.get('src')) for gal in (x.get('gallery') or []) if isinstance(gal, dict)]
                if pic
            ]
            params = ''.join(
                tag(
                    'param',
                    v,
                    ' name={}{}'.format(
                        quoteattr((fields.get(k) or {}).get('label') or k),
                        ' unit={}'.format(quoteattr(fields[k]['unit'])) if (fields.get(k) or {}).get('unit') else '',
                    ),
                )
                for k, v in attrs.items()
                if k not in ('cat', 'maker', 'model', 'series', 'article')
                and isinstance(v, (str, int, float))
                and not isinstance(v, bool)
            )
            rrc = x.get('rrc') if isinstance(x.get('rrc'), dict) else {}
            out.append(
                '<offer id={}{}>'.format(quoteattr(str(x['id'])), avail)
                + tag('name', x.get('name'))
                + tag('vendor', attrs.get('maker'))
                + tag('model', attrs.get('model') or x.get('name'))
                + tag('vendorCode', attrs.get('article'))
                + (tag('price', x.get('price')) + tag('currencyId', cur(x.get('priceCur'))) if x.get('price') else '')
                + tag('categoryId', cats.get(str(attrs.get('cat') or '')))
                + ''.join(tag('picture', pic) for pic in dict.fromkeys(pics))
                + tag('description', x.get('spec'))
                + params
                + (
                    tag('param', rrc.get('price'), ' name="РРЦ" unit={}'.format(quoteattr(rrc.get('cur') or 'RUB')))
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

            data, packed, missing = DataBundle(self.img_dir or '.').pack(body)
            return data, ext, ctype, {'images': packed, 'missing': missing}
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
                        workbook = z.read('xl/workbook.xml').decode('utf-8', 'replace')
                        return 'xlsx' if re.search(r'<sheet\b[^>]*\bname="_kp"', workbook) else 'xlsx-patch'
            except zipfile.BadZipFile:
                raise ValueError('Архив повреждён или это не архив ZIP') from None
            if any(name.lower().endswith(('.sqlite3', '.sqlite', '.db')) for name in names) and not any(
                name.lower().endswith('.json') for name in names
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
