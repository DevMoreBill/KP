# -*- coding: utf-8 -*-
"""Один и тот же документ программы — в любом формате выгрузки (решение владельца 18.10: у каждого варианта выгрузки
одинаковый список форматов, и любой выгруженный файл загружается обратно).

Документ — словарь JSON: резервная копия (format kp-backup, sections — разделы базы) или файл настроек (kp-settings).
  • json — как есть; zip — тот же JSON и изображения, на которые он ссылается (data_bundle.DataBundle);
  • xlsx — лист «Сведения», лист на раздел: строка 1 — названия, строка 2 — служебные ключи («attrs.maker» — поле
    вложенного объекта, «…:json» — значение JSON), дальше — записи; скрытые листы «_kp» (описание документа и листов)
    и «_long» (значения длиннее ячейки Excel, частями);
  • xml — <kp_data>: значения с типами (t: n — число, b — да/нет, o — объект, a — список, z — пусто, e — строка JSON);
  • yml — Яндекс YML (yml_catalog: предложения каталога для сайтов и маркетплейсов) и тот же <kp_data> — для загрузки.
Загрузка (DataFile.load) распознаёт формат по содержимому, а не по расширению файла.
"""
import hashlib
import io
import json
import math
import re
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape, quoteattr


class XmlTree:
    """Значение JSON ↔ элемент XML с типом: обратно получается ровно то же значение."""
    RAW = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\r￾￿]')     # такое XML не хранит как есть — строкой JSON

    @classmethod
    def el(cls, tag, v, attrs='', depth=0):
        nl = '\n' if depth < 3 else ''
        if v is None:
            return '<%s%s t="z"/>' % (tag, attrs)
        if isinstance(v, bool):
            return '<%s%s t="b">%s</%s>' % (tag, attrs, 'true' if v else 'false', tag)
        if isinstance(v, (int, float)):
            return '<%s%s t="n">%s</%s>' % (tag, attrs, json.dumps(v), tag)
        if isinstance(v, dict):
            inner = ''.join(cls.el('f', x, ' n=%s' % quoteattr(str(k)), depth + 1) + nl for k, x in v.items())
            return '<%s%s t="o">%s%s</%s>' % (tag, attrs, nl, inner, tag)
        if isinstance(v, (list, tuple)):
            inner = ''.join(cls.el('i', x, '', depth + 1) + nl for x in v)
            return '<%s%s t="a">%s%s</%s>' % (tag, attrs, nl, inner, tag)
        s = str(v)
        if cls.RAW.search(s):
            return '<%s%s t="e">%s</%s>' % (tag, attrs, escape(json.dumps(s)), tag)
        return '<%s%s>%s</%s>' % (tag, attrs, escape(s), tag)

    @classmethod
    def value(cls, e):
        t = e.get('t')
        if t == 'z':
            return None
        if t == 'b':
            return (e.text or '').strip() == 'true'
        if t in ('n', 'e'):
            v = json.loads(e.text or 'null', parse_constant=lambda x: None)      # NaN, Infinity — не числа
            if isinstance(v, float) and not math.isfinite(v):
                return None
            return v
        if t == 'o':
            return {c.get('n') or '': cls.value(c) for c in e}
        if t == 'a':
            return [cls.value(c) for c in e]
        return e.text or ''

    @staticmethod
    def parse(data):
        import xml.etree.ElementTree as ET
        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
            raise ValueError('Файл XML с объявлениями DOCTYPE/ENTITY не принимается')
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            raise ValueError('Файл XML повреждён: %s' % e)
        node = root if root.tag == 'kp_data' else root.find('kp_data')
        if node is None:
            raise ValueError('В файле нет данных программы (<kp_data>): загрузить можно только файл, выгруженный из программы')
        return XmlTree.value(node)


class XlsxData:
    """Документ ↔ книга Excel с типами ячеек (число, текст, да/нет); длинные значения — частями на скрытом листе."""
    CELL = 32000                       # Excel хранит в ячейке до 32 767 знаков
    MAX_ROWS = 1000000
    LONG = '⟦long:%d⟧'
    LONG_RE = re.compile(r'^⟦long:(\d+)⟧$')
    KEY = re.compile(r'^[^.:]{1,80}$')
    INFO, META, LONG_SHEET = 'Сведения', '_kp', '_long'
    SECTION = {'catalog': 'Каталог', 'kp': 'КП', 'managers': 'Менеджеры', 'clients': 'Клиенты', 'suppliers': 'Поставщики',
               'settings': 'Настройки', 'audit': 'Журнал действий', 'customs': 'ТН ВЭД'}
    LABELS = {'id': 'Код (не менять)', 'name': 'Наименование', 'spec': 'Кратко', 'kind': 'Вид', 'unit': 'Ед.', 'short': 'Короткое название',
              'price': 'Цена КП', 'priceCur': 'Валюта цены', 'cost': 'Закупка', 'costCur': 'Валюта закупки', 'margin': 'Наценка',
              'rrc.price': 'РРЦ', 'rrc.cur': 'Валюта РРЦ', 'stock.qty': 'Остаток, шт.', 'stock.available': 'В наличии',
              'attrs.cat': 'Категория (код)', 'attrs.maker': 'Производитель', 'attrs.series': 'Серия', 'attrs.model': 'Модель',
              'attrs.article': 'Артикул', 'photo.src': 'Главное фото', 'features:json': 'Описание (блоки)',
              'groups:json': 'Характеристики (таблицы)', 'gallery:json': 'Галерея', 'updatedAt': 'Изменено', 'updated': 'Изменено',
              'number': '№', 'state': 'Состояние', 'inn': 'ИНН', 'kpp': 'КПП', 'ogrn': 'ОГРН', 'full': 'Полное наименование',
              'address': 'Адрес', 'phone': 'Телефон', 'email': 'E-mail', 'country': 'Страна', 'timestamp': 'Время',
              'action': 'Действие', 'userName': 'Пользователь'}

    def __init__(self, labels=None):
        self.labels = dict(self.LABELS, **(labels or {}))

    # ---------- запись
    @staticmethod
    def col(i):
        s, i = '', i + 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    @staticmethod
    def _num_ok(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) < 1e15

    def _plain(self, v):
        """Значение можно положить в ячейку как есть (число, да/нет, непустой текст без служебных знаков); пустая строка и
        null — только значением JSON, иначе пустая ячейка при загрузке стала бы «поля нет»."""
        if isinstance(v, bool) or self._num_ok(v):
            return True
        return isinstance(v, str) and v != '' and not XmlTree.RAW.search(v)

    def _columns(self, rows):
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
                continue                          # ключ с «.» или «:» — в общем столбце «_more:json»
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
                    out.append(('%s.%s%s' % (k, s, ':json' if js else ''), (k, s), js))
            else:
                js = not all(self._plain(x) for x in vs)
                out.append(('%s%s' % (k, ':json' if js else ''), (k,), js))
        if any(not self.KEY.match(str(k)) for k in order):
            out.append(('_more:json', ('_more',), True))
        return out

    def _cell(self, ref, v, style=0):
        st = ' s="%d"' % style if style else ''
        if isinstance(v, bool):
            return '<c r="%s" t="b"%s><v>%d</v></c>' % (ref, st, 1 if v else 0)
        if self._num_ok(v):
            return '<c r="%s"%s><v>%s</v></c>' % (ref, st, repr(v) if isinstance(v, float) else v)
        s = str(v)
        if len(s) > self.CELL:
            self.long.append(s)
            s = self.LONG % (len(self.long) - 1)
        return '<c r="%s" t="inlineStr"%s><is><t xml:space="preserve">%s</t></is></c>' % (ref, st, escape(s))

    def _sheet(self, rows, freeze=2, widths=None, file_no=None):
        """Лист в архив книги — построчно, без строки XML всего листа (20 000 позиций занимали сотни МБ памяти).
        rows — [[значение | None]] или генератор; строка 1 — жирная, строка 2 — серая (служебные ключи). → номер файла листа."""
        if file_no is None:
            self.files += 1
            file_no = self.files
        cols = ''.join('<col min="%d" max="%d" width="%d" customWidth="1"/>' % (i + 1, i + 1, w) for i, w in enumerate(widths or []))
        pane = ('<sheetViews><sheetView workbookViewId="0"><pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/>'
                '</sheetView></sheetViews>' % (freeze, freeze + 1)) if freeze else ''
        with self.z.open('xl/worksheets/sheet%d.xml' % file_no, 'w', force_zip64=True) as f:
            f.write(('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                     '%s%s<sheetData>' % (pane, '<cols>%s</cols>' % cols if cols else '')).encode('utf-8'))
            for n, r in enumerate(rows, 1):
                style = 1 if n == 1 else 2 if n == 2 and freeze == 2 else 0
                f.write(('<row r="%d">%s</row>' % (n, ''.join(self._cell('%s%d' % (self.col(i), n), v, style) for i, v in enumerate(r)
                                                              if v is not None and v != ''))).encode('utf-8'))
            f.write(b'</sheetData></worksheet>')
        return file_no

    def _name(self, title):
        n = re.sub(r'[\[\]:*?/\\]', ' ', str(title)).strip()[:31] or 'Лист'
        base, k = n, 2
        while n.lower() in self.used:
            n = (base[:26] + ' (%d)' % k)[:31]
            k += 1
        self.used.add(n.lower())
        return n

    def _table(self, title, path, recs):
        cols = self._columns(recs)
        if len(recs) > self.MAX_ROWS:
            raise ValueError('Раздел «%s»: %d записей — больше, чем помещается в Excel; выберите JSON или архив .zip' % (title, len(recs)))
        head = [self.labels.get(k, k.replace(':json', '')) for k, _, _ in cols]
        keys = [k for k, _, _ in cols]

        def rows():
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
                        row.append(None)                  # поля нет — пустая ячейка
                        continue
                    v = r[p[0]] if len(p) == 1 else r[p[0]][p[1]]
                    row.append(json.dumps(v, ensure_ascii=False) if js else v)
                yield row
        widths = [min(50, max(10, len(str(h)) + 2)) for h in head]
        name = self._name(title)
        self.sheets.append((name, self._sheet(rows(), 2, widths), False))
        self.map.append(['table', name, path])

    def _kv(self, title, path, d):
        name = self._name(title)
        rows = [['Ключ', 'Значение'], ['_key', '_value:json']] + [[k, json.dumps(v, ensure_ascii=False)] for k, v in d.items()]
        self.sheets.append((name, self._sheet(rows, 2, [30, 80]), False))
        self.map.append(['kv', name, path])

    @staticmethod
    def _records(v):
        return isinstance(v, list) and all(isinstance(x, dict) for x in v)

    def dump(self, doc):
        """Документ → байты .xlsx."""
        self.sheets, self.map, self.long, self.used = [], [], [], {self.INFO.lower(), self.META.lower(), self.LONG_SHEET.lower()}
        buf = io.BytesIO()
        self.z, self.files = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED), 1      # лист 1 — «Сведения» (пишется последним)
        with self.z:
            self._dump(doc)
        return buf.getvalue()

    def _dump(self, doc):
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
                        self._table('%s · %s' % (title, self.SECTION.get(k, k)) if k != s else title, [s, k], x)
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
            [m[0], m[1], json.dumps(m[2], ensure_ascii=False)] for m in self.map]
        kp_no = self._sheet(kp, 0)
        info = self._sheet(self._info(doc), 0, [28, 90], file_no=1)
        long_no = self._sheet(([i, n, s[j:j + self.CELL]] for i, s in enumerate(self.long) for n, j in enumerate(range(0, len(s), self.CELL))), 0)
        self._book([(self.INFO, info, False)] + self.sheets + [(self.META, kp_no, True), (self.LONG_SHEET, long_no, True)])

    def _info(self, doc):
        what = {'kp-backup': 'Данные программы «Конструктор КП»', 'kp-settings': 'Настройки программы «Конструктор КП»'}.get(doc.get('format'), doc.get('format'))
        rows = [['Файл', what or ''], ['Выгружено', str(doc.get('createdAt') or '').replace('T', ' ')]]
        if doc.get('supplier'):
            rows.append(['Поставщик', doc['supplier']])
        for kind, name, path in self.map:
            if kind == 'table':
                rows.append(['Лист «%s»' % name, 'записей: %d' % self._count(doc, path)])
        rows += [[], ['Как править', '1. Строку 2 (серые служебные ключи) и столбец «Код (не менять)» не меняйте.'],
                 ['', '2. Пустая ячейка — значение поля убирается; «да/нет» — ИСТИНА/ЛОЖЬ; столбцы «…:json» — значение в формате JSON.'],
                 ['', '3. Новая строка с новым кодом — новая запись. Строки и листы не удаляются из программы, если их удалить здесь.'],
                 ['', '4. Загрузить: «Настройки → База и копии → Загрузить» — программа сначала покажет, что изменится.'],
                 ['', '5. Скрытые листы «_kp» и «_long» не трогайте: по ним файл собирается обратно.']]
        return rows

    @staticmethod
    def _count(doc, path):
        v = doc.get('sections') or {}
        for p in path:
            v = v.get(p) if isinstance(v, dict) else None
        return len(v) if isinstance(v, list) else 0

    def _book(self, sheets):
        """Служебные части книги; sheets — [(имя, номер файла листа, скрыт)] в порядке листов."""
        n = len(sheets)
        ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
              '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
              + ''.join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % no for _, no, _ in sheets)
              + '</Types>')
        rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
              'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
              + ''.join('<sheet name="%s" sheetId="%d"%s r:id="rId%d"/>' % (escape(nm, {'"': '&quot;'}), i + 1, ' state="hidden"' if hid else '', i + 1)
                        for i, (nm, _, hid) in enumerate(sheets)) + '</sheets></workbook>')
        wrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 + ''.join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, no) for i, (_, no, _) in enumerate(sheets))
                 + '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' % (n + 1))
        styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>'
                  '<font><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font></fonts>'
                  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                  '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
                  '<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>')
        z = self.z
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wrels)
        z.writestr('xl/styles.xml', styles)

    # ---------- чтение
    @staticmethod
    def _text(s):
        import html
        return html.unescape(s)

    @classmethod
    def sheets(cls, z):
        """{имя листа: {номер строки: {номер столбца: значение с типом}}}."""
        names = set(z.namelist())
        ss = []
        if 'xl/sharedStrings.xml' in names:
            x = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
            for si in re.findall(r'<si>(.*?)</si>', x, re.S):
                ss.append(cls._text(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))
        wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
        rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace') if 'xl/_rels/workbook.xml.rels' in names else ''
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
    def _ci(letters):
        n = 0
        for ch in letters:
            n = n * 26 + ord(ch) - 64
        return n - 1

    @staticmethod
    def _number(s):
        s = s.strip()
        if re.match(r'^-?\d{1,15}$', s):
            return int(s)
        try:
            f = float(s)
        except ValueError:
            return s
        if not math.isfinite(f):         # «nan», «inf» в ячейке — текст, а не число
            return s
        return int(f) if f.is_integer() and abs(f) < 1e15 and not re.search(r'[.eE]', s) else f

    def load(self, data):
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('Файл Excel повреждён')
        with z:
            book = self.sheets(z)
        if self.META not in book:
            raise ValueError('Это не книга, выгруженная из программы: нет служебного листа «_kp» (не удаляйте скрытые листы)')
        longs = {}
        for r in sorted(book.get(self.LONG_SHEET, {}).items()):
            c = r[1]
            if isinstance(c.get(0), int) and isinstance(c.get(1), int):
                longs.setdefault(c[0], {})[c[1]] = str(c.get(2, ''))
        longs = {i: ''.join(p[k] for k in sorted(p)) for i, p in longs.items()}

        def full(v):
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
                maps.append((kind, full(c.get(1)), json.loads(full(c.get(2)) or '[]', parse_constant=DataFile.no_const)))
        if not isinstance(meta, dict):
            raise ValueError('Служебный лист «_kp» повреждён')
        doc = dict(meta, sections={})
        for kind, name, path in maps:
            rows = book.get(name)
            if rows is None:
                raise ValueError('В книге нет листа «%s» — не переименовывайте и не удаляйте листы' % name)
            keys = {c: str(k).strip() for c, k in (rows.get(2) or {}).items() if str(k).strip()}
            recs = []
            for rn in sorted(r for r in rows if r > 2):
                rec = {}
                for c, k in keys.items():
                    if c not in rows[rn]:
                        continue
                    v = full(rows[rn][c])
                    js = k.endswith(':json')
                    k = k[:-5] if js else k
                    if js and isinstance(v, str):
                        try:
                            v = json.loads(v, parse_constant=DataFile.no_const)
                        except ValueError:
                            raise ValueError('Лист «%s», ячейка %s%d: значение не в формате JSON' % (name, self.col(c), rn))
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
    def _get(root, path):
        v = root
        for p in path:
            v = v.get(p) if isinstance(v, dict) else None
        return v

    @staticmethod
    def _put(root, path, v):
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

    def __init__(self, base_url='', types=None):
        self.base, self.types = (base_url or '').rstrip('/'), types or {}

    @staticmethod
    def _t(tag, v, attrs=''):
        if v in (None, ''):
            return ''
        return '<%s%s>%s</%s>' % (tag, attrs, escape(XmlTree.RAW.sub(' ', str(v))), tag)

    def _pic(self, src):
        if not isinstance(src, str):
            return ''
        if src.startswith('/img/'):
            return (self.base or 'http://localhost') + src
        return src if re.match(r'^https?://', src, re.I) else ''

    def dump(self, doc):
        t = self._t
        items = (doc.get('sections') or {}).get('catalog')
        items = items if isinstance(items, list) else []
        cats, cur = {}, lambda c: 'RUR' if c in ('RUB', 'RUR', '', None) else str(c)
        for x in items:
            c = str(((x.get('attrs') or {}) if isinstance(x, dict) else {}).get('cat') or '')
            cats.setdefault(c, len(cats) + 1)
        curs = sorted({cur(x.get('priceCur')) for x in items if isinstance(x, dict) and x.get('price')} | {'RUR'})
        out = ['<?xml version="1.0" encoding="UTF-8"?>', '<yml_catalog date=%s><shop>' % quoteattr(datetime.now().strftime('%Y-%m-%dT%H:%M')),
               t('name', 'Каталог'), t('company', 'Каталог'), t('url', self.base or 'http://localhost'),
               '<currencies>' + ''.join('<currency id=%s rate=%s/>' % (quoteattr(c), quoteattr('1' if c == 'RUR' else 'CBRF')) for c in curs) + '</currencies>',
               '<categories>' + ''.join(t('category', (self.types.get(c) or {}).get('name') or c or 'Без категории', ' id="%d"' % i) for c, i in cats.items()) + '</categories>',
               '<offers>']
        for x in items:
            if not isinstance(x, dict) or not x.get('id'):
                continue
            a = x.get('attrs') if isinstance(x.get('attrs'), dict) else {}
            fields = {f.get('key'): f for f in (self.types.get(a.get('cat')) or {}).get('fields') or [] if isinstance(f, dict)}
            st = x.get('stock') if isinstance(x.get('stock'), dict) else None
            q = st.get('qty') if st and isinstance(st.get('qty'), (int, float)) and not isinstance(st.get('qty'), bool) else None
            avail = '' if st is None else ' available="%s"' % ('true' if (q or 0) > 0 or (q is None and st.get('available')) else 'false')
            pics = [p for p in [self._pic((x.get('photo') or {}).get('src') if isinstance(x.get('photo'), dict) else '')]
                    + [self._pic(g.get('src')) for g in (x.get('gallery') or []) if isinstance(g, dict)] if p]
            params = ''.join(t('param', v, ' name=%s%s' % (quoteattr((fields.get(k) or {}).get('label') or k),
                                                          ' unit=%s' % quoteattr(fields[k]['unit']) if (fields.get(k) or {}).get('unit') else ''))
                             for k, v in a.items() if k not in ('cat', 'maker', 'model', 'series', 'article') and isinstance(v, (str, int, float)) and not isinstance(v, bool))
            rrc = x.get('rrc') if isinstance(x.get('rrc'), dict) else {}
            out.append('<offer id=%s%s>' % (quoteattr(str(x['id'])), avail) + t('name', x.get('name')) + t('vendor', a.get('maker'))
                       + t('model', a.get('model') or x.get('name')) + t('vendorCode', a.get('article'))
                       + (t('price', x.get('price')) + t('currencyId', cur(x.get('priceCur'))) if x.get('price') else '')
                       + t('categoryId', cats.get(str(a.get('cat') or '')))
                       + ''.join(t('picture', p) for p in dict.fromkeys(pics)) + t('description', x.get('spec')) + params
                       + (t('param', rrc.get('price'), ' name="РРЦ" unit=%s' % quoteattr(rrc.get('cur') or 'RUB')) if rrc.get('price') else '')
                       + '</offer>')
        out.append('</offers></shop>')
        out.append(XmlTree.el('kp_data', doc))
        out.append('</yml_catalog>')
        return '\n'.join(out).encode('utf-8')


class DataFile:
    """Форматы выгрузки и загрузки документа программы (общий список для всех вариантов выгрузки)."""
    @staticmethod
    def no_const(name):
        """json.loads(parse_constant=...): NaN и Infinity в загружаемом файле — отказ."""
        raise ValueError('В файле недопустимое число: %s' % name)

    FORMATS = (('xlsx', 'Excel (.xlsx)'), ('json', 'JSON'), ('xml', 'XML'), ('yml', 'YML'), ('zip', 'Архив .zip (данные и фото)'))
    TYPES = {'xlsx': ('.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'json': ('.json', 'application/json; charset=utf-8'),
             'xml': ('.xml', 'application/xml; charset=utf-8'), 'yml': ('.yml', 'application/xml; charset=utf-8'), 'zip': ('.zip', 'application/zip')}
    TECH = ('_light', 'st', 'pricesCount', '_rev')        # служебное — в сравнение записей не входит

    def __init__(self, img_dir=None, base_url='', labels=None, types=None):
        self.img_dir, self.base, self.labels, self.types = img_dir, base_url, labels, types

    @classmethod
    def fmt(cls, v, default='json'):
        return v if v in cls.TYPES else default

    def dump(self, body, fmt, doc=None):
        """body — текст JSON документа (или уже разобранный doc — для xlsx, xml, yml) → (байты, расширение, тип содержимого,
        сведения для журнала)."""
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
            return ('<?xml version="1.0" encoding="UTF-8"?>\n' + XmlTree.el('kp_data', doc)).encode('utf-8'), ext, ctype, {}
        return YmlData(self.base, self.types).dump(doc), ext, ctype, {}

    @staticmethod
    def sniff(data):
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
                raise ValueError('Архив повреждён или это не архив ZIP')
            if any(n.lower().endswith(('.sqlite3', '.sqlite', '.db')) for n in names) and not any(n.lower().endswith('.json') for n in names):
                return 'sqlite-zip'
            return 'zip'
        head = data[:2048].lstrip(b'\xef\xbb\xbf \t\r\n')
        return 'xml' if head[:1] == b'<' else 'json'

    def load(self, data):
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

    # ---------- сравнение записей («только изменённое в файле»)
    @classmethod
    def _norm(cls, v, top=True):
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
    def digest(cls, rec, skip=()):
        """Отпечаток записи: без служебных полей и skip; пустые поля и 10 = 10.0 — одинаково во всех форматах."""
        if isinstance(rec, dict):
            rec = {k: (cls._norm(v, True) if isinstance(v, dict) else cls._norm(v, False)) for k, v in rec.items()
                   if k not in cls.TECH and k not in skip and v is not None and v != ''}
        return hashlib.sha1(json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()[:12]
