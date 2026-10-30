"""Правки каталога файлом (kp-catalog-patch, книга Excel): меняются только перечисленные поля, с проверкой «было»."""

import hashlib
import json
import re
from typing import Any

from clock import Clock
from data_file import Load


class CatalogPatch:
    LIST_MAX = 50
    ROWS_MAX = 300
    TEXT_MAX = 300
    FEATURE_TEXT_MAX = 20000
    PAIR = 2
    FORMAT = 'kp-catalog-patch'
    MAX_ITEMS = 50000
    MAX_TEXT = 4000
    ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
    KEY = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,40}$')
    SET = ('name', 'spec')

    def __init__(self, store) -> None:
        self.store = store

    @staticmethod
    def is_patch(data) -> bool:
        return isinstance(data, dict) and data.get('format') == CatalogPatch.FORMAT

    @staticmethod
    def digest(v) -> str:
        return hashlib.sha1(
            json.dumps(v if v is not None else [], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode(
                'utf-8'
            ),
            usedforsecurity=False,
        ).hexdigest()[:16]

    @staticmethod
    def norm(v):
        """Сравнение значений поля: 10 = 10.0 = «10», пусто = None."""
        if v is None:
            return ''
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return str(v).strip()

    def _scalar(self, v):
        return v is None or isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= self.MAX_TEXT)

    def _groups(self, v):
        if not isinstance(v, list) or len(v) > self.LIST_MAX:
            return False
        for group in v:
            if (
                not isinstance(group, dict)
                or not isinstance(group.get('name', ''), str)
                or not isinstance(group.get('rows'), list)
                or len(group['rows']) > self.ROWS_MAX
            ):
                return False
            for row in group['rows']:
                if (
                    not isinstance(row, dict)
                    or not isinstance(row.get('k'), str)
                    or not self._scalar(row.get('v'))
                    or len(row.get('k')) > self.TEXT_MAX
                ):
                    return False
        return True

    def _features(self, v):
        if not isinstance(v, list) or len(v) > self.LIST_MAX:
            return False
        return all(
            isinstance(feat, dict)
            and isinstance(feat.get('text', ''), str)
            and len(feat.get('text', '')) <= self.FEATURE_TEXT_MAX
            and isinstance(feat.get('label', ''), str)
            and len(feat.get('label', '')) <= self.TEXT_MAX
            for feat in v
        )

    def _item_ok(self, x) -> str:
        """Пусто — запись годится, иначе — что не так (для отчёта)."""
        if not isinstance(x, dict) or not self.ID_RE.match(str(x.get('id', ''))):
            return 'нет id позиции'
        attrs = x.get('attrs', {})
        if not isinstance(attrs, dict) or any(
            not self.KEY.match(str(k))
            or not isinstance(v, list)
            or len(v) != self.PAIR
            or not all(self._scalar(z) for z in v)
            for k, v in attrs.items()
        ):
            return 'поля категории в неверном виде'
        sets = x.get('set', {})
        if not isinstance(sets, dict) or any(
            k not in self.SET or not isinstance(v, list) or len(v) != self.PAIR or not all(self._scalar(z) for z in v)
            for k, v in sets.items()
        ):
            return 'название или строка характеристик в неверном виде'
        for k, test in (('groups', self._groups), ('features', self._features)):
            if k in x and (
                not isinstance(x[k], dict) or not isinstance(x[k].get('was'), str) or not test(x[k].get('new'))
            ):
                return 'таблицы или описание в неверном виде'
        return ''

    def plan(self, data: dict) -> dict:
        """→ {items: [(id, doc, changes)], errors, conflicts, same, missing}; changes — [(вид, ключ, новое)]."""
        if not self.is_patch(data) or data.get('version') != 1 or not isinstance(data.get('items'), list):
            raise ValueError('Это не файл правок каталога (нужен «КП_правки_каталога_….json»)')
        if len(data['items']) > self.MAX_ITEMS:
            raise ValueError('В файле правок слишком много позиций')
        out, errors, conflicts, same, missing = [], [], [], 0, 0
        for i, x in enumerate(data['items']):
            bad = self._item_ok(x)
            if bad:
                errors.append(f'Запись {i + 1}: {bad}')
                continue
            text = self.store.catalog_get(x['id'])
            if not text:
                missing += 1
                continue
            doc = json.loads(text)
            title = doc.get('name') or x.get('name') or x['id']
            change = []
            cur = doc.get('attrs') or {}
            for k, (old, new) in (x.get('attrs') or {}).items():
                norm_cur = self.norm(cur.get(k))
                if norm_cur == self.norm(new):
                    same += 1
                elif norm_cur == self.norm(old):
                    change.append(('attr', k, new))
                else:
                    conflicts.append(f'{title}: поле «{k}» изменено после выгрузки — пропущено')
            for k, (old, new) in (x.get('set') or {}).items():
                norm_cur = self.norm(doc.get(k))
                if norm_cur == self.norm(new):
                    same += 1
                elif norm_cur == self.norm(old):
                    change.append(('set', k, new))
                else:
                    conflicts.append(
                        '{}: «{}» изменено после выгрузки — пропущено'.format(
                            title, 'название' if k == 'name' else 'строка характеристик'
                        )
                    )
            for k in ('groups', 'features'):
                if k not in x:
                    continue
                norm_cur = self.digest(doc.get(k))
                if norm_cur == self.digest(x[k]['new']):
                    same += 1
                elif norm_cur == x[k]['was']:
                    change.append((k, k, x[k]['new']))
                else:
                    conflicts.append(
                        '{}: {} изменены после выгрузки — пропущено'.format(
                            title, 'характеристики' if k == 'groups' else 'описание'
                        )
                    )
            if change:
                out.append((x['id'], doc, change))
        return {'items': out, 'errors': errors, 'conflicts': conflicts, 'same': same, 'missing': missing}

    @staticmethod
    def change(doc: dict, change: dict) -> dict:
        """Правки → в карточку (на месте)."""
        attrs = doc.setdefault('attrs', {})
        for kind, k, v in change:
            if kind == 'attr':
                if v is None or v == '':
                    attrs.pop(k, None)
                else:
                    attrs[k] = v
            elif kind == 'set':
                doc[k] = v if v is not None else ''
            else:
                doc[k] = v
        return doc

    def run(self, data: dict, load: Load, author: str = '', backup=None) -> dict:
        """Предпросмотр или запись. backup() — копия базы перед записью. → отчёт для окна загрузки."""
        apply = load is Load.APPLY
        plan = self.plan(data)
        fields = sum(len(change) for _, _, change in plan['items'])
        written = 0
        if apply and plan['items']:
            if backup:
                backup()
            for cid, doc, change in plan['items']:
                self.store.catalog_put(cid, json.dumps(self.change(doc, change), ensure_ascii=False), author)
                written += 1
        return {
            'report': {'catalog': {'new': 0, 'updated': len(plan['items']), 'invalid': len(plan['errors'])}},
            'errors': plan['errors'][:20],
            'createdAt': data.get('createdAt'),
            'applied': bool(apply),
            'images': None,
            'patch': {
                'title': str(data.get('title') or '')[:200],
                'items': len(plan['items']),
                'fields': fields,
                'same': plan['same'],
                'missing': plan['missing'],
                'conflicts': plan['conflicts'][:30],
                'conflictCount': len(plan['conflicts']),
                'written': written,
            },
        }


class CatalogSheet:
    """Книга Excel «Каталог поставщика для правки»."""

    INT_EXACT = 1e15
    HEAD_ROWS = 2

    ORIG = '_было'
    MAX_ROWS = 50000

    def __init__(self, store) -> None:
        self.store = store

    @staticmethod
    def is_book(data: bytes) -> bool:
        import io
        import zipfile

        if not data or data[:2] != b'PK':
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                return 'xl/workbook.xml' in z.namelist()
        except zipfile.BadZipFile:
            return False

    def _nums(self) -> dict:
        """{категория: {поле с числом}} — из справочника категорий."""
        types = self.store.kv_get('types') or {}
        types = types.get('types') if isinstance(types, dict) else types
        return {
            x.get('id'): {field.get('key') for field in x.get('fields') or [] if field.get('num')}
            for x in types or []
            if isinstance(x, dict)
        }

    @staticmethod
    def _value(text, like, num):
        """Текст ячейки → значение поля: число, если поле числовое (или было числом), да/нет — если было да/нет."""
        text = str(text if text is not None else '').strip()
        if text == '':
            return None
        if isinstance(like, bool):
            low = text.lower()
            if low in ('да', 'true', '1', 'yes'):
                return True
            if low in ('нет', 'false', '0', 'no'):
                return False
        if num or (isinstance(like, (int, float)) and not isinstance(like, bool)):
            num_text = text.replace('\xa0', '').replace(' ', '').replace(',', '.')
            if re.match(r'^-?\d+(\.\d+)?$', num_text):
                v = float(f'{float(num_text):.12g}')  # Excel пишет 7,3 как 7.2999999999999998
                return int(v) if v.is_integer() and abs(v) < CatalogSheet.INT_EXACT else v
        return text[: CatalogPatch.MAX_TEXT]

    def patch(self, data: bytes, title: str = '') -> dict:
        from feed_xlsx import read_xlsx

        book = read_xlsx(data)
        orig, known = {}, set()  # known — позиции, у которых есть «было»: пустое поле в «было» не пишется
        for name, rows in book:
            if name == self.ORIG:
                for row in rows[1:]:
                    if row.get(0):
                        known.add(row[0])
                    if row.get(0) and row.get(1):
                        try:
                            orig[(row[0], row[1])] = json.loads(row.get(2) or 'null')
                        except ValueError:
                            pass
        nums, items, seen = self._nums(), [], 0
        for name, rows in book:
            if name == self.ORIG or len(rows) < self.HEAD_ROWS or str(rows[1].get(0, '')).strip() != 'id':
                continue
            keys = {cell: str(k).strip() for cell, k in rows[1].items() if cell > 0}
            for row in rows[2:]:
                cid = str(row.get(0, '')).strip()
                if not cid:
                    continue
                seen += 1
                if seen > self.MAX_ROWS:
                    raise ValueError('В книге слишком много строк')
                text = self.store.catalog_get(cid) if CatalogPatch.ID_RE.match(cid) else None
                if not text:
                    items.append({'id': cid})  # нет в базе — в отчёте «нет в базе»
                    continue
                doc = json.loads(text)
                attrs = doc.get('attrs') or {}
                num = nums.get(attrs.get('cat'), set())
                x: dict[str, Any] = {'id': cid, 'name': doc.get('name') or ''}
                for cell, k in keys.items():
                    if k in CatalogPatch.SET:
                        cur, field = doc.get(k), None
                    elif k.startswith('a:') and CatalogPatch.KEY.match(k[2:]) and k[2:] != 'cat':
                        field = k[2:]
                        cur = attrs.get(field)
                    else:
                        continue
                    old = orig.get((cid, k)) if cid in known else cur
                    new = self._value(row.get(cell), old if old is not None else cur, field in num if field else False)
                    if k == 'name' and new is None:
                        continue  # название не стирается
                    if CatalogPatch.norm(new) == CatalogPatch.norm(old):
                        continue
                    if field:
                        x.setdefault('attrs', {})[field] = [old, new]
                    else:
                        x.setdefault('set', {})[k] = [old, '' if new is None else str(new)]
                if 'attrs' in x or 'set' in x:
                    items.append(x)
        if not seen:
            raise ValueError(
                'Это не книга правок каталога: нужен файл «…_для_правки.xlsx», выгруженный из «Копий и базы»'
            )

        return {
            'format': CatalogPatch.FORMAT,
            'version': 1,
            'createdAt': Clock.now(),
            'title': (f'Правки из Excel «{title[:120]}»') if title else 'Правки из Excel',
            'items': items,
        }
