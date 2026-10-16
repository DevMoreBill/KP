# -*- coding: utf-8 -*-
"""Правки каталога файлом («Настройки → Резервные копии → Загрузить»): format kp-catalog-patch.

В отличие от резервной копии, позиция каталога не заменяется целиком: меняются только перечисленные поля, цены,
закупка, остатки, фото и связь с фидом остаются как есть. Каждое изменение несёт прежнее значение — если поле после
выгрузки копии уже изменили (вручную или фидом), правка этого поля пропускается и попадает в отчёт.

  {"format": "kp-catalog-patch", "version": 1, "createdAt": "…", "base": "…", "title": "…",
   "items": [{"id": "…", "name": "…", "why": "…",
              "attrs": {"stage": ["было", "стало"], …},      — поле категории; «стало» null — убрать
              "set": {"name": ["было", "стало"], "spec": [...]},
              "groups": {"was": "<отпечаток прежних>", "new": [...]},     — таблицы характеристик целиком
              "features": {"was": "<отпечаток прежних>", "new": [...]}}]}   — блоки описания целиком

Отпечаток — CatalogPatch.digest(значение): sha1 JSON с сортировкой ключей, первые 16 знаков.
"""
import hashlib
import json
import re


class CatalogPatch:
    FORMAT = 'kp-catalog-patch'
    MAX_ITEMS = 50000
    MAX_TEXT = 4000
    ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
    KEY = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,40}$')
    SET = ('name', 'spec')

    def __init__(self, store):
        self.st = store

    @staticmethod
    def is_patch(d):
        return isinstance(d, dict) and d.get('format') == CatalogPatch.FORMAT

    @staticmethod
    def digest(v):
        return hashlib.sha1(json.dumps(v if v is not None else [], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()[:16]

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

    # ---------- проверка файла ----------
    def _scalar(self, v):
        return v is None or isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= self.MAX_TEXT)

    def _groups(self, v):
        if not isinstance(v, list) or len(v) > 50:
            return False
        for g in v:
            if not isinstance(g, dict) or not isinstance(g.get('name', ''), str) or not isinstance(g.get('rows'), list) or len(g['rows']) > 300:
                return False
            for r in g['rows']:
                if not isinstance(r, dict) or not isinstance(r.get('k'), str) or not self._scalar(r.get('v')) or len(r.get('k')) > 300:
                    return False
        return True

    def _features(self, v):
        if not isinstance(v, list) or len(v) > 50:
            return False
        return all(isinstance(f, dict) and isinstance(f.get('text', ''), str) and len(f.get('text', '')) <= 20000
                   and isinstance(f.get('label', ''), str) and len(f.get('label', '')) <= 300 for f in v)

    def _item_ok(self, x):
        """Пусто — запись годится, иначе — что не так (для отчёта)."""
        if not isinstance(x, dict) or not self.ID.match(str(x.get('id', ''))):
            return 'нет id позиции'
        a = x.get('attrs', {})
        if not isinstance(a, dict) or any(not self.KEY.match(str(k)) or not isinstance(v, list) or len(v) != 2 or not all(self._scalar(z) for z in v)
                                          for k, v in a.items()):
            return 'поля категории в неверном виде'
        s = x.get('set', {})
        if not isinstance(s, dict) or any(k not in self.SET or not isinstance(v, list) or len(v) != 2 or not all(self._scalar(z) for z in v) for k, v in s.items()):
            return 'название или строка характеристик в неверном виде'
        for k, test in (('groups', self._groups), ('features', self._features)):
            if k in x and (not isinstance(x[k], dict) or not isinstance(x[k].get('was'), str) or not test(x[k].get('new'))):
                return 'таблицы или описание в неверном виде'
        return ''

    # ---------- план и применение ----------
    def plan(self, d):
        """→ {items: [(id, doc, changes)], errors, conflicts, same, missing}; changes — [(вид, ключ, новое)]."""
        if not self.is_patch(d) or d.get('version') != 1 or not isinstance(d.get('items'), list):
            raise ValueError('Это не файл правок каталога (нужен «КП_правки_каталога_….json»)')
        if len(d['items']) > self.MAX_ITEMS:
            raise ValueError('В файле правок слишком много позиций')
        out, errors, conflicts, same, missing = [], [], [], 0, 0
        for i, x in enumerate(d['items']):
            bad = self._item_ok(x)
            if bad:
                errors.append('Запись %d: %s' % (i + 1, bad))
                continue
            text = self.st.catalog_get(x['id'])
            if not text:
                missing += 1
                continue
            doc = json.loads(text)
            title = doc.get('name') or x.get('name') or x['id']
            ch = []
            cur = doc.get('attrs') or {}
            for k, (old, new) in (x.get('attrs') or {}).items():
                c = self.norm(cur.get(k))
                if c == self.norm(new):
                    same += 1
                elif c == self.norm(old):
                    ch.append(('attr', k, new))
                else:
                    conflicts.append('%s: поле «%s» изменено после выгрузки — пропущено' % (title, k))
            for k, (old, new) in (x.get('set') or {}).items():
                c = self.norm(doc.get(k))
                if c == self.norm(new):
                    same += 1
                elif c == self.norm(old):
                    ch.append(('set', k, new))
                else:
                    conflicts.append('%s: «%s» изменено после выгрузки — пропущено' % (title, 'название' if k == 'name' else 'строка характеристик'))
            for k in ('groups', 'features'):
                if k not in x:
                    continue
                c = self.digest(doc.get(k))
                if c == self.digest(x[k]['new']):
                    same += 1
                elif c == x[k]['was']:
                    ch.append((k, k, x[k]['new']))
                else:
                    conflicts.append('%s: %s изменены после выгрузки — пропущено' % (title, 'характеристики' if k == 'groups' else 'описание'))
            if ch:
                out.append((x['id'], doc, ch))
        return {'items': out, 'errors': errors, 'conflicts': conflicts, 'same': same, 'missing': missing}

    @staticmethod
    def change(doc, ch):
        """Правки → в карточку (на месте)."""
        a = doc.setdefault('attrs', {})
        for kind, k, v in ch:
            if kind == 'attr':
                if v is None or v == '':
                    a.pop(k, None)
                else:
                    a[k] = v
            elif kind == 'set':
                doc[k] = v if v is not None else ''
            else:
                doc[k] = v
        return doc

    def run(self, d, apply, by='', backup=None):
        """Предпросмотр или запись. backup() — копия базы перед записью. → отчёт для окна загрузки."""
        p = self.plan(d)
        fields = sum(len(ch) for _, _, ch in p['items'])
        written = 0
        if apply and p['items']:
            if backup:
                backup()
            for cid, doc, ch in p['items']:
                self.st.catalog_put(cid, json.dumps(self.change(doc, ch), ensure_ascii=False), by)
                written += 1
        return {'report': {'catalog': {'new': 0, 'updated': len(p['items']), 'invalid': len(p['errors'])}},
                'errors': p['errors'][:20], 'createdAt': d.get('createdAt'), 'applied': bool(apply), 'images': None,
                'patch': {'title': str(d.get('title') or '')[:200], 'items': len(p['items']), 'fields': fields, 'same': p['same'],
                          'missing': p['missing'], 'conflicts': p['conflicts'][:30], 'conflictCount': len(p['conflicts']), 'written': written}}


class CatalogSheet:
    """Книга Excel «Каталог поставщика для правки» → файл правок каталога (kp-catalog-patch).

    Лист категории: строка 1 — названия столбцов, строка 2 — служебные ключи (A2 = «id»; «name», «spec», «a:<поле>»),
    дальше — позиции. Скрытый лист «_было» — значения на момент выгрузки (id, ключ, JSON): по нему правка поля,
    изменённого в базе после выгрузки, пропускается, как в файле правок (пустые поля в «_было» не пишутся, у позиции есть
    строка «id» без ключа). Без «_было» сравнивается с текущим значением.
    """
    ORIG = '_было'
    MAX_ROWS = 50000

    def __init__(self, store):
        self.st = store

    @staticmethod
    def is_book(data):
        import io
        import zipfile
        if not data or data[:2] != b'PK':
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                return 'xl/workbook.xml' in z.namelist()
        except zipfile.BadZipFile:
            return False

    def _nums(self):
        """{категория: {поле с числом}} — из справочника категорий."""
        t = self.st.kv_get('types') or {}
        t = t.get('types') if isinstance(t, dict) else t
        return {x.get('id'): {f.get('key') for f in x.get('fields') or [] if f.get('num')} for x in t or [] if isinstance(x, dict)}

    @staticmethod
    def _value(s, like, num):
        """Текст ячейки → значение поля: число, если поле числовое (или было числом), да/нет — если было да/нет."""
        s = str(s if s is not None else '').strip()
        if s == '':
            return None
        if isinstance(like, bool):
            low = s.lower()
            if low in ('да', 'true', '1', 'yes'):
                return True
            if low in ('нет', 'false', '0', 'no'):
                return False
        if num or (isinstance(like, (int, float)) and not isinstance(like, bool)):
            t = s.replace('\xa0', '').replace(' ', '').replace(',', '.')
            if re.match(r'^-?\d+(\.\d+)?$', t):
                v = float('%.12g' % float(t))     # Excel пишет 7,3 как 7.2999999999999998
                return int(v) if v.is_integer() and abs(v) < 1e15 else v
        return s[:CatalogPatch.MAX_TEXT]

    def patch(self, data, title=''):
        from feed_files import read_xlsx
        book = read_xlsx(data)
        orig, known = {}, set()          # known — позиции, у которых есть «было»: пустое поле в «было» не пишется
        for name, rows in book:
            if name == self.ORIG:
                for r in rows[1:]:
                    if r.get(0):
                        known.add(r[0])
                    if r.get(0) and r.get(1):
                        try:
                            orig[(r[0], r[1])] = json.loads(r.get(2) or 'null')
                        except ValueError:
                            pass
        nums, items, seen = self._nums(), [], 0
        for name, rows in book:
            if name == self.ORIG or len(rows) < 2 or str(rows[1].get(0, '')).strip() != 'id':
                continue
            keys = {c: str(k).strip() for c, k in rows[1].items() if c > 0}
            for r in rows[2:]:
                cid = str(r.get(0, '')).strip()
                if not cid:
                    continue
                seen += 1
                if seen > self.MAX_ROWS:
                    raise ValueError('В книге слишком много строк')
                text = self.st.catalog_get(cid) if CatalogPatch.ID.match(cid) else None
                if not text:
                    items.append({'id': cid})          # нет в базе — в отчёте «нет в базе»
                    continue
                doc = json.loads(text)
                a = doc.get('attrs') or {}
                num = nums.get(a.get('cat'), set())
                x = {'id': cid, 'name': doc.get('name') or ''}
                for c, k in keys.items():
                    if k in CatalogPatch.SET:
                        cur, field = doc.get(k), None
                    elif k.startswith('a:') and CatalogPatch.KEY.match(k[2:]) and k[2:] != 'cat':
                        field = k[2:]
                        cur = a.get(field)
                    else:
                        continue
                    old = orig.get((cid, k)) if cid in known else cur
                    new = self._value(r.get(c), old if old is not None else cur, field in num if field else False)
                    if k == 'name' and new is None:
                        continue                        # название не стирается
                    if CatalogPatch.norm(new) == CatalogPatch.norm(old):
                        continue
                    if field:
                        x.setdefault('attrs', {})[field] = [old, new]
                    else:
                        x.setdefault('set', {})[k] = [old, '' if new is None else str(new)]
                if 'attrs' in x or 'set' in x:
                    items.append(x)
        if not seen:
            raise ValueError('Это не книга правок каталога: нужен файл «…_для_правки.xlsx», выгруженный из «Копий и базы»')
        from datetime import datetime
        return {'format': CatalogPatch.FORMAT, 'version': 1, 'createdAt': datetime.now().isoformat(timespec='seconds'),
                'title': ('Правки из Excel «%s»' % title[:120]) if title else 'Правки из Excel', 'items': items}
