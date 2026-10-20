"""Каталог для администратора и особых прав: модерация по полям, корзина товаров, выгрузка."""

import io
import json
import math
import re
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape as xml_escape
from xml.sax.saxutils import quoteattr

from admin import AUTO_KEYS, LABELS, _loads, actor, diff, is_admin, log, session


def power(h, key, method='GET') -> bool:
    """Особое право (auth_users.STRICT): администратор — всегда; менеджер — только вошедший по паролю и с этим правом."""
    if is_admin(h, need_csrf=(method != 'GET')):
        return True
    u = getattr(h, '_kp_user', None)
    return bool(getattr(h, '_kp_login', False) and session(h, touch=False) is None and u and u['perms'].get(key))


class ModerationDesk:
    ATTR = 'attrs.'  # поле-параметр категории: «attrs.<ключ>»

    def __init__(self, store, by: str, log_fn) -> None:
        self.st, self.by, self.log = store, by, log_fn

    @classmethod
    def fields(cls, before, after) -> list:
        """Изменённые поля [{key, label, before, after}]; параметры категории (attrs) — каждый своей строкой."""
        b, a = diff(before, after, AUTO_KEYS)
        out = []
        for k in a:
            ba, aa = (before or {}).get('attrs'), (after or {}).get('attrs')
            if k == 'attrs' and isinstance(ba or {}, dict) and isinstance(aa or {}, dict):
                sb, sa = diff(ba or {}, aa or {})
                out += [{'key': cls.ATTR + s, 'label': s, 'attr': s, 'before': sb[s], 'after': sa[s]} for s in sa]
            else:
                out.append({'key': k, 'label': LABELS.get(k, k), 'before': b[k], 'after': a[k]})
        return out

    def items(self, status, limit: int | None = None) -> list[dict]:
        """Правки со статусом status, новые первыми: название, изменённые поля, устарела ли (товар изменён после отправки)."""
        out = []
        for p in self.st.pending_list(status, with_docs=True)[:limit]:
            after = _loads(p['after']) or {}
            p['name'] = after.get('name', p['productId'])
            p['cat'] = (after.get('attrs') or {}).get('cat') or ''
            p['fields'] = [f['label'] for f in self.fields(_loads(p['before']), after)]
            p['stale'] = status == 'pending' and (self.st.catalog_get(p['productId']) or None) != (p['before'] or None)
            p.pop('before'), p.pop('after')
            out.append(p)
        return out

    def view(self, eid) -> dict:
        """Правка для окна сравнения: поля «было / стало», обе карточки (для вида карточкой), есть ли товар сейчас."""
        p = self.st.pending_get(eid)
        if not p:
            raise ValueError('Правка не найдена')
        before, after = _loads(p['before']), _loads(p['after']) or {}
        p['diff'] = self.fields(before, after)
        p['current'] = self.st.catalog_get(p['productId']) is not None
        p['beforeDoc'], p['afterDoc'] = before, after
        p['stale'] = p['status'] == 'pending' and (self.st.catalog_get(p['productId']) or None) != (p['before'] or None)
        p.pop('before'), p.pop('after')
        return p

    def _merge(self, p, keys) -> tuple:
        """Карточка с выбранными полями правки поверх текущей (товара нет — поверх прежней)."""
        before, after = _loads(p['before']), _loads(p['after']) or {}
        known = {f['key'] for f in self.fields(before, after)}
        keys = [k for k in keys if k in known]
        if not keys:
            raise ValueError('Отметьте хотя бы одно изменённое поле')
        new = dict(_loads(self.st.catalog_get(p['productId'])) or before or {})
        new.pop('_rev', None)
        for k in keys:
            if k.startswith(self.ATTR):
                s, attrs = k[len(self.ATTR) :], dict(new.get('attrs') or {})
                v = (after.get('attrs') or {}).get(s)
                if v in (None, ''):
                    attrs.pop(s, None)
                else:
                    attrs[s] = v
                new['attrs'] = attrs
            elif after.get(k) is None:
                new.pop(k, None)
            else:
                new[k] = after[k]
        return new, keys

    def review(self, eid, act, reason='', keys=None) -> dict:
        """Принять (целиком или поля keys) или отклонить правку. → {ok, message?}"""
        p = self.st.pending_get(eid)
        if not p or p['status'] != 'pending':
            return {'ok': False, 'message': 'Правка уже рассмотрена'}
        reason = str(reason or '').strip()[:500]
        if act == 'approve':
            if keys is None and (p['kind'] == 'create' or not self.st.catalog_get(p['productId'])):
                text, part = p['after'], None
            elif keys is None:  # целиком — изменённые в правке поля поверх текущей карточки (цены, остатки и фото
                ks = [
                    f['key'] for f in self.fields(_loads(p['before']), _loads(p['after']))
                ]  # с тех пор — не откатываются)
                new, part = self._merge(p, ks) if ks else (dict(_loads(self.st.catalog_get(p['productId'])) or {}), [])
                new.pop('_rev', None)
                text, part = json.dumps(new, ensure_ascii=False), None
            else:
                if p['kind'] == 'create':
                    raise ValueError('Новый товар принимается только целиком')
                new, part = self._merge(p, [str(k) for k in keys if isinstance(k, str)])
                text = json.dumps(new, ensure_ascii=False)
            b, a = diff(_loads(self.st.catalog_get(p['productId'])) or _loads(p['before']), _loads(text), AUTO_KEYS)
            if not self.st.pending_claim(eid):  # двойное «Принять» — второе нажатие ничего не пишет
                return {'ok': False, 'message': 'Правка уже рассмотрена'}
            try:
                self.st.catalog_put(p['productId'], text)
            except Exception:
                self.st.pending_set(eid, 'pending', '', '')  # не записалось — правка снова ждёт решения
                raise
            note = ''
            if part is not None and len(part) < len(self.fields(_loads(p['before']), _loads(p['after']))):
                note = 'принято частично: ' + ', '.join(part)
            self.st.pending_set(eid, 'approved', self.by, note)
            self.log('approve_edit', 'product', p['productId'], b, dict(a, __part__=note) if note else a)
        else:
            b, a = diff(_loads(p['before']), _loads(p['after']), AUTO_KEYS)
            self.st.pending_set(eid, 'rejected', self.by, reason)
            self.log('reject_edit', 'product', p['productId'], b, dict(a, __reason__=reason))
        return {'ok': True}


class TrashBin:
    TYPES = ('kp', 'catalog', 'manager', 'client', 'supplier')

    def __init__(self, store, log_fn) -> None:
        self.st, self.log = store, log_fn

    def items(self, etype='') -> dict:
        rows = self.st.trash_list()
        counts = {}
        for r in rows:
            counts[r['entityType']] = counts.get(r['entityType'], 0) + 1
        return {'items': [r for r in rows if not etype or r['entityType'] == etype], 'counts': counts}

    def restore(self, tid: str) -> None:
        etype, eid = self.st.trash_restore(tid)
        if etype == 'kp':
            from crm import DealBook

            DealBook.kp_moved(self.st, eid, 'Корзина')
        self.log('restore', etype, eid, None, None)

    def drop(self, tid: str) -> None:
        """Удалить навсегда одну запись корзины."""
        rec = self.st.trash_drop(tid)
        if not rec:
            raise ValueError('Нет такой записи в корзине')
        self.log('purge_trash', rec['entityType'], rec['entityId'], {'title': rec['title']}, None)

    def clear(self, etype='') -> int:
        """«Очистить корзину» — всё или записи одного вида. → сколько удалено навсегда."""
        if etype and etype not in self.TYPES:
            raise ValueError('Неизвестный вид записей')
        n = self.st.trash_clear(etype or None)
        self.log('purge_trash', 'trash', etype or 'all', None, {'deleted': n})
        return n


class XlsxBook:
    """Книга Excel из таблиц (лист — заголовок и строки): шапка жирная и закреплена, ширина столбцов по содержимому."""

    BAD = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f]')

    def __init__(self) -> None:
        self.sheets = []

    def add(self, title, head, rows) -> None:
        name = re.sub(r'[\[\]:*?/\\]', ' ', str(title or 'Лист')).strip()[:31] or 'Лист'
        base, k = name, 2
        while any(s[0].lower() == name.lower() for s in self.sheets):
            name = (base[:27] + f' ({k})')[:31]
            k += 1
        self.sheets.append((name, head, rows))

    @staticmethod
    def col(i) -> str:
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    def _cell(self, ref, v, style=0) -> str:
        st = f' s="{style}"' if style else ''
        if isinstance(v, bool):
            v = 'да' if v else 'нет'
        if isinstance(v, (int, float)) and not math.isnan(v) and abs(v) < 1e15:
            return f'<c r="{ref}"{st}><v>{repr(v) if isinstance(v, float) else v}</v></c>'
        t = self.BAD.sub('', str(v))[:32000]
        return f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{xml_escape(t)}</t></is></c>'

    def _sheet(self, head, rows) -> str:
        widths = [min(60, max(8, len(str(h)) + 2)) for h in head]
        for r in rows[:300]:
            for i, v in enumerate(r[: len(widths)]):
                widths[i] = min(60, max(widths[i], len(str(v if v is not None else '').split('\n')[0]) + 2))
        cols = ''.join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
        out = ['<row r="1">' + ''.join(self._cell(self.col(i) + '1', h, 1) for i, h in enumerate(head)) + '</row>']
        for n, r in enumerate(rows, 2):
            out.append(
                f'<row r="{n}">'
                + ''.join(self._cell(f'{self.col(i)}{n}', v, 2) for i, v in enumerate(r) if v not in (None, ''))
                + '</row>'
            )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            '<cols>{}</cols><sheetData>{}</sheetData>{}</worksheet>'
        ).format(
            cols,
            ''.join(out),
            f'<autoFilter ref="A1:{self.col(len(head) - 1)}{len(rows) + 1}"/>' if head else '',
        )

    def bytes(self) -> bytes:
        n = len(self.sheets)
        ct = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + ''.join(
                f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for i in range(n)
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
            + ''.join(
                f'<sheet name={quoteattr(s[0])} sheetId="{i + 1}" r:id="rId{i + 1}"/>'
                for i, s in enumerate(self.sheets)
            )
            + '</sheets></workbook>'
        )
        wrels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                for i in range(n)
            )
            + f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
        )
        styles = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>'
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
        )
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('[Content_Types].xml', ct)
            z.writestr('_rels/.rels', rels)
            z.writestr('xl/workbook.xml', wb)
            z.writestr('xl/_rels/workbook.xml.rels', wrels)
            z.writestr('xl/styles.xml', styles)
            for i, (_, head, rows) in enumerate(self.sheets):
                z.writestr(f'xl/worksheets/sheet{i + 1}.xml', self._sheet(head, rows))
        return buf.getvalue()


class CatalogExport:
    """Выгрузка отобранных позиций."""

    FORMATS = ('xlsx', 'json', 'xml', 'yml')
    # основные столбцы: ключ → подпись
    COLS = (
        ('cat', 'Категория'),
        ('maker', 'Производитель'),
        ('series', 'Серия'),
        ('model', 'Модель'),
        ('art', 'Артикул'),
        ('sup', 'Поставщик'),
        ('spec', 'Краткие характеристики'),
        ('desc', 'Описание'),
        ('specs', 'Характеристики'),
        ('url', 'Страница товара'),
    )
    BASE_ATTRS = ('cat', 'maker', 'series', 'model', 'article')
    MAX_ITEMS = 50000

    def __init__(self, store, images=None, base_url='') -> None:
        self.st, self.images, self.base = store, images, base_url.rstrip('/')  # images — ImageStore папки data/img

    def docs(self, ids) -> list:
        ids = [str(i) for i in ids if isinstance(i, str) and 0 < len(i) <= 64][: self.MAX_ITEMS]
        out = {}
        for k in range(0, len(ids), 500):
            part = ids[k : k + 500]
            for cid, doc in self.st.all(
                'SELECT id, doc FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))), tuple(part)
            ):
                d = _loads(doc)
                if isinstance(d, dict):
                    out[cid] = d
        return [out[i] for i in ids if i in out]

    @staticmethod
    def stock_text(st) -> str:
        if not isinstance(st, dict):
            return ''
        if st.get('gone'):
            return 'нет в фиде'
        q = st.get('qty')
        if q is not None:
            if q > 0:
                return f'в наличии {q} шт.'
            if st.get('transit'):
                return 'в пути {} шт.'.format(st['transit'])
            return 'под заказ' if st.get('available') else 'нет в наличии'
        return 'в наличии' if st.get('available') else 'нет в наличии'

    def pics(self, x) -> list:
        """Изображения позиции: главное фото, затем галерея (без выключенных), без повторов."""
        out = []
        for p in [x.get('photo'), *list(x.get('gallery') or [])]:
            src = (p or {}).get('src') if isinstance(p, dict) else None
            if src and isinstance(src, str) and (p.get('on', True) is not False) and src not in out:
                out.append(src)
        return out

    def pic_ref(self, src, mode) -> str:
        if src.startswith('/img/'):
            return 'images/' + src[5:] if mode == 'files' else self.base + src
        return src if re.match(r'^https?://', src, re.I) else ''

    def build(self, ids, opts, admin) -> tuple:
        """→ (имя файла, байты, тип содержимого, сведения для журнала)."""
        from equipment_types import load_types
        from supplier_scope import SupplierScope

        fmt = opts.get('fmt') if opts.get('fmt') in self.FORMATS else 'xlsx'
        cols = [c for c, _ in self.COLS if c in (opts.get('cols') or [])]
        want = opts.get('params') or []
        allp = '*' in want
        want = {str(w) for w in want if isinstance(w, str)}
        price, rrc, stock = bool(opts.get('price')), bool(opts.get('rrc')), bool(opts.get('stock'))
        cost = bool(opts.get('cost')) and admin  # закупку выгружает только администратор
        img = opts.get('images') if opts.get('images') in ('links', 'files') else 'none'
        docs = self.docs(opts.get('ids') if ids is None else ids)
        if not docs:
            raise ValueError('Нет позиций для выгрузки — отберите позиции в каталоге')
        types = {t.get('id'): t for t in load_types()['types']}
        scope = SupplierScope(self.st) if 'sup' in cols else None
        items = []
        for x in docs:
            a = x.get('attrs') or {}
            t = types.get(a.get('cat')) or {}
            params = []
            for f in t.get('fields') or []:
                k = f.get('key')
                if k in self.BASE_ATTRS or not (allp or k in want):
                    continue
                v = a.get(k)
                if v not in (None, ''):
                    params.append({'key': k, 'label': f.get('label') or k, 'unit': f.get('unit') or '', 'value': v})
            r = {
                'id': x.get('id'),
                'name': x.get('name') or '',
                'catId': a.get('cat') or '',
                'cat': t.get('name') or a.get('cat') or '',
                'maker': a.get('maker') or '',
                'series': a.get('series') or '',
                'model': a.get('model') or '',
                'art': x.get('art') or (x.get('feed') or {}).get('sku') or a.get('article') or '',
                'sup': scope.name_of(x.get('src') or (x.get('feed') or {}).get('id'), a.get('maker')) if scope else '',
                'spec': x.get('spec') or '',
                'desc': '\n'.join(
                    (
                        '{}. {}'.format(f.get('label'), f.get('text') or '')
                        if f.get('label')
                        else str(f.get('text') or '')
                    ).strip()
                    for f in (x.get('features') or [])
                    if isinstance(f, dict) and (f.get('label') or f.get('text'))
                ),
                'specs': '\n'.join(
                    '{}: {}'.format(r2.get('k') or '', r2.get('v') or '')
                    for g in (x.get('groups') or [])
                    if isinstance(g, dict)
                    for r2 in (g.get('rows') or [])
                    if isinstance(r2, dict) and (r2.get('k') or r2.get('v'))
                ),
                'url': (x.get('feed') or {}).get('url')
                if re.match(r'^https?://', str((x.get('feed') or {}).get('url') or ''), re.I)
                else '',
                'params': params,
            }
            if price:
                r['price'], r['priceCur'] = x.get('price') or None, x.get('priceCur') or 'RUB'
            if rrc:
                rr = x.get('rrc') if isinstance(x.get('rrc'), dict) else {}
                r['rrc'], r['rrcCur'] = rr.get('price') or None, rr.get('cur') or 'RUB'
            if cost:
                r['cost'], r['costCur'] = x.get('cost') or None, x.get('costCur') or 'RUB'
            if stock:
                s = x.get('stock') if isinstance(x.get('stock'), dict) else None
                r['stock'], r['stockQty'] = self.stock_text(s), (s or {}).get('qty')
            if img != 'none':
                r['images'] = [u for u in (self.pic_ref(s, img) for s in self.pics(x)) if u]
            items.append(r)
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        name = f'Каталог_{len(items)}_поз_{stamp}'
        data, ctype, ext = getattr(self, '_' + fmt)(items, cols, opts)
        info = {
            'items': len(items),
            'fmt': fmt,
            'images': img,
            'price': price,
            'rrc': rrc,
            'cost': cost,
            'stock': stock,
            'params': 'все' if allp else len(want),
        }
        if img == 'files':
            buf, n = io.BytesIO(), 0
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr(name + ext, data)
                seen = set()
                for x in docs:
                    for s in self.pics(x):
                        if not s.startswith('/img/') or s in seen:
                            continue
                        seen.add(s)
                        f = self.images.path(s[5:]) if self.images else None
                        if f:
                            z.write(f, 'images/' + s[5:], compress_type=zipfile.ZIP_STORED)
                            n += 1
            info['files'] = n
            return name + '.zip', buf.getvalue(), 'application/zip', info
        return name + ext, data, ctype, info

    def _head(self, cols, items) -> list:
        """Столбцы таблицы: (подпись, функция значения)."""
        lab = dict(self.COLS)
        out = [('Наименование', lambda r: r['name'])] + [(lab[c], lambda r, c=c: r[c]) for c in cols]
        keys = []
        for r in items:
            for p in r['params']:
                if (p['key'], p['label'], p['unit']) not in keys:
                    keys.append((p['key'], p['label'], p['unit']))
        for k, label, unit in keys:
            out.append(
                (
                    f'{label}, {unit}' if unit else label,
                    lambda r, k=k: next((p['value'] for p in r['params'] if p['key'] == k), None),
                )
            )
        if items and 'price' in items[0]:
            out += [('Цена КП', lambda r: r['price']), ('Валюта цены', lambda r: r['priceCur'] if r['price'] else '')]
        if items and 'rrc' in items[0]:
            out += [('РРЦ', lambda r: r['rrc']), ('Валюта РРЦ', lambda r: r['rrcCur'] if r['rrc'] else '')]
        if items and 'cost' in items[0]:
            out += [('Закупка', lambda r: r['cost']), ('Валюта закупки', lambda r: r['costCur'] if r['cost'] else '')]
        if items and 'stock' in items[0]:
            out += [('Наличие', lambda r: r['stock']), ('Остаток, шт.', lambda r: r['stockQty'])]
        if items and 'images' in items[0]:
            out.append(('Изображения', lambda r: '\n'.join(r['images'])))
        out.append(('Код позиции', lambda r: r['id']))
        return out

    def _xlsx(self, items, cols, opts) -> tuple:
        book, groups = XlsxBook(), {}
        for r in items:
            groups.setdefault(r['cat'] or 'Без категории', []).append(r)
        for cat, rows in sorted(groups.items(), key=lambda g: g[0]):
            head = self._head(cols, rows)
            book.add(cat, [h for h, _ in head], [[fn(r) for _, fn in head] for r in rows])
        return book.bytes(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'

    def _json(self, items, cols, opts) -> tuple:
        keep = {
            'id',
            'name',
            'catId',
            'params',
            'price',
            'priceCur',
            'rrc',
            'rrcCur',
            'cost',
            'costCur',
            'stock',
            'stockQty',
            'images',
        } | set(cols)
        out = [{k: v for k, v in r.items() if k in keep and v not in (None, '', [])} for r in items]
        body = {
            'format': 'kp-catalog-export',
            'version': 1,
            'createdAt': datetime.now().isoformat(timespec='seconds'),
            'items': out,
        }
        return (
            json.dumps(body, ensure_ascii=False, indent=1).encode('utf-8'),
            'application/json; charset=utf-8',
            '.json',
        )

    @staticmethod
    def _t(tag, v, attrs='') -> str:
        return (
            '<{}{}>{}</{}>'.format(tag, attrs, xml_escape(XlsxBook.BAD.sub('', str(v))), tag)
            if v not in (None, '')
            else ''
        )

    def _xml(self, items, cols, opts) -> tuple:
        lab, t = dict(self.COLS), self._t
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<catalog date={}>'.format(quoteattr(datetime.now().isoformat(timespec='seconds'))),
        ]
        for r in items:
            out.append(
                '<item id={}>'.format(quoteattr(str(r['id'])))
                + t('name', r['name'])
                + ''.join(t(c, r[c], f' title={quoteattr(lab[c])}') for c in cols)
                + ''.join(
                    t(
                        'param',
                        p['value'],
                        ' key={} name={}{}'.format(
                            quoteattr(p['key']),
                            quoteattr(p['label']),
                            ' unit={}'.format(quoteattr(p['unit'])) if p['unit'] else '',
                        ),
                    )
                    for p in r['params']
                )
                + (
                    t('price', r.get('price'), ' currency={}'.format(quoteattr(r['priceCur'])))
                    if r.get('price')
                    else ''
                )
                + (t('rrc', r.get('rrc'), ' currency={}'.format(quoteattr(r['rrcCur']))) if r.get('rrc') else '')
                + (t('cost', r.get('cost'), ' currency={}'.format(quoteattr(r['costCur']))) if r.get('cost') else '')
                + (
                    t(
                        'stock',
                        r.get('stock'),
                        ' qty={}'.format(quoteattr(str(r['stockQty']))) if r.get('stockQty') is not None else '',
                    )
                    if r.get('stock')
                    else ''
                )
                + ''.join(t('picture', u) for u in r.get('images') or [])
                + '</item>'
            )
        out.append('</catalog>')
        return '\n'.join(out).encode('utf-8'), 'application/xml; charset=utf-8', '.xml'

    def _yml(self, items, cols, opts) -> tuple:
        """Яндекс YML (yml_catalog): категории, предложения с vendor, model, price, picture, description, param."""
        t = self._t

        def cur(c) -> str:
            return 'RUR' if c in ('RUB', 'RUR', '', None) else c

        cats = []
        for r in items:
            if (r['catId'], r['cat']) not in cats:
                cats.append((r['catId'], r['cat']))
        cid = {c[0]: i + 1 for i, c in enumerate(cats)}
        curs = sorted({cur(r.get('priceCur')) for r in items if r.get('price')} | {'RUR'})
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<yml_catalog date={}><shop>'.format(quoteattr(datetime.now().strftime('%Y-%m-%dT%H:%M'))),
            t('name', opts.get('shop') or 'Каталог'),
            t('company', opts.get('shop') or 'Каталог'),
            t('url', self.base or 'http://localhost'),
            '<currencies>'
            + ''.join(
                '<currency id={} rate={}/>'.format(quoteattr(c), quoteattr('1' if c == 'RUR' else 'CBRF')) for c in curs
            )
            + '</currencies>',
            '<categories>'
            + ''.join(t('category', n or i or 'Без категории', f' id="{cid[i]}"') for i, n in cats)
            + '</categories>',
            '<offers>',
        ]
        for r in items:
            avail = (
                'true' if (r.get('stockQty') or 0) > 0 or (r.get('stock') or '').startswith('в наличии') else 'false'
            )
            desc = '\n'.join(
                x for x in (r.get('spec') if 'spec' in cols else '', r.get('desc') if 'desc' in cols else '') if x
            )
            out.append(
                '<offer id={}{}>'.format(quoteattr(str(r['id'])), f' available="{avail}"' if 'stock' in r else '')
                + t('name', r['name'])
                + t('vendor', r['maker'])
                + t('model', r['model'] or r['name'])
                + t('vendorCode', r['art'] if 'art' in cols else '')
                + t('url', r['url'] if 'url' in cols else '')
                + (t('price', r['price']) + t('currencyId', cur(r['priceCur'])) if r.get('price') else '')
                + t('categoryId', cid[r['catId']])
                + ''.join(t('picture', u) for u in r.get('images') or [])
                + t('description', desc)
                + ''.join(
                    t(
                        'param',
                        p['value'],
                        ' name={}{}'.format(
                            quoteattr(p['label']), ' unit={}'.format(quoteattr(p['unit'])) if p['unit'] else ''
                        ),
                    )
                    for p in r['params']
                )
                + (t('param', r['sup'], ' name="Поставщик"') if 'sup' in cols else '')
                + (t('param', r['rrc'], ' name="РРЦ" unit={}'.format(quoteattr(r['rrcCur']))) if r.get('rrc') else '')
                + (
                    t('param', r['cost'], ' name="Закупка" unit={}'.format(quoteattr(r['costCur'])))
                    if r.get('cost')
                    else ''
                )
                + (t('param', r['stockQty'], ' name="Остаток" unit="шт."') if r.get('stockQty') is not None else '')
                + '</offer>'
            )
        out.append('</offers></shop></yml_catalog>')
        return '\n'.join(out).encode('utf-8'), 'application/xml; charset=utf-8', '.yml'


class ClientsExport:
    """Клиенты в файл: реквизиты, адрес, первый контакт и объекты."""

    COLS = (
        ('name', 'Наименование'),
        ('full', 'Полное наименование'),
        ('inn', 'ИНН'),
        ('kpp', 'КПП'),
        ('ogrn', 'ОГРН'),
        ('address', 'Адрес'),
        ('contact', 'Контакт'),
        ('post', 'Должность'),
        ('phone', 'Телефон'),
        ('email', 'E-mail'),
        ('objects', 'Объекты'),
        ('kpCount', 'КП'),
        ('lastKp', 'Последнее КП'),
    )

    def __init__(self, store) -> None:
        self.st = store

    def rows(self) -> list:
        out = []
        for c in self.st.clients_all():
            k = (c.get('contacts') or [{}])[0] or {}
            out.append(
                {
                    'name': c.get('name') or '',
                    'full': c.get('full') or '',
                    'inn': c.get('inn') or '',
                    'kpp': c.get('kpp') or '',
                    'ogrn': c.get('ogrn') or '',
                    'address': c.get('address') or '',
                    'contact': k.get('name') or '',
                    'post': k.get('post') or '',
                    'phone': k.get('phone') or '',
                    'email': k.get('email') or '',
                    'objects': '\n'.join(
                        ' — '.join(v for v in (o.get('purpose'), o.get('address')) if v)
                        for o in (c.get('objects') or [])
                        if isinstance(o, dict)
                    ),
                    'kpCount': c.get('kpCount') or None,
                    'lastKp': c.get('lastKp') or '',
                }
            )
        return out

    def build(self, fmt) -> tuple:
        rows, stamp = self.rows(), datetime.now().strftime('%Y-%m-%d_%H%M')
        name = f'Клиенты_{len(rows)}_{stamp}'
        if fmt == 'json':
            body = {
                'format': 'kp-clients-export',
                'version': 1,
                'createdAt': datetime.now().isoformat(timespec='seconds'),
                'items': [{k: v for k, v in r.items() if v not in (None, '')} for r in rows],
            }
            return (
                name + '.json',
                json.dumps(body, ensure_ascii=False, indent=1).encode('utf-8'),
                'application/json; charset=utf-8',
                len(rows),
            )
        book = XlsxBook()
        book.add('Клиенты', [t for _, t in self.COLS], [[r[k] for k, _ in self.COLS] for r in rows])
        return (
            name + '.xlsx',
            book.bytes(),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            len(rows),
        )


class CatalogDesk:
    """Адреса каталога для особых прав менеджеров (администратор — тоже): в корзину, модерация, выгрузка."""

    PATHS = re.compile(
        r'^/api/(?:catalog/(?:trash|export|moderation|moderation/\d{1,9}|moderation/\d{1,9}/(?:approve|reject))|clients/export)$'
    )

    def __init__(self, h, store) -> None:
        self.h, self.st = h, store

    @classmethod
    def handles(cls, path) -> bool:
        return bool(cls.PATHS.match(path))

    def _log(self, action, etype=None, eid=None, before=None, after=None, result='success') -> None:
        log(
            self.h,
            self.st,
            action,
            etype,
            eid,
            before,
            after,
            result=result,
            admin=is_admin(self.h, need_csrf=False) or None,
        )

    def _deny(self, what, action=None) -> bool:
        if action:
            self._log(action, 'product', None, result='failed')
        self.h.send(403, 'text/plain; charset=utf-8', f'Нет права {what} — обратитесь к администратору')
        return True

    def _body(self) -> dict:
        try:
            d = json.loads(self.h.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            d = None
        if not isinstance(d, dict):
            raise ValueError('Неверный запрос: нужен объект JSON')
        return d

    def route(self, m, path) -> bool | None:
        h = self.h
        try:
            if path == '/api/clients/export':
                return self._clients(m)
            return self._route(m, path[len('/api/catalog/') :])
        except ValueError as e:
            h.send(400, 'text/plain; charset=utf-8', str(e))
            return True

    def _clients(self, m) -> bool | None:
        h = self.h
        if m != 'POST':
            return h.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
        if not power(h, 'export', m):
            return self._deny('выгружать клиентов', 'export_clients')
        name, data, ctype, n = ClientsExport(self.st).build(self._body().get('fmt'))
        self._log('export_clients', 'client', None, None, {'items': n})
        h.send(200, ctype, data, h.attachment(name))
        return True

    def _route(self, m, sub) -> bool | None:
        h, st = self.h, self.st
        if sub == 'trash':
            if m != 'POST':
                return h.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
            if not power(h, 'catDelete', m):
                return self._deny('удалять товары', 'delete_catalog')
            ids = [str(i) for i in (self._body().get('ids') or []) if isinstance(i, str) and 0 < len(i) <= 64][:5000]
            if not ids:
                raise ValueError('Не выбрано, что удалить')
            names = {}
            for k in range(0, len(ids), 500):
                part = ids[k : k + 500]
                names.update(
                    dict(
                        st.all(
                            'SELECT id, name FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))),
                            tuple(part),
                        )
                    )
                )
            n = st.trash_put_many('catalog', [(i, names[i] or i) for i in ids if i in names], actor(h)[1])
            self._log(
                'delete_catalog',
                'catalog',
                ids[0] if len(ids) == 1 else f'items:{len(ids)}',
                None,
                {'deleted': n, 'names': [names.get(i) for i in ids[:20]]},
            )
            h.send_json({'ok': True, 'deleted': n})
            return True
        if sub == 'export':
            if m != 'POST':
                return h.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
            if not power(h, 'export', m):
                return self._deny('выгружать каталог', 'export_catalog')
            import web_api

            d = self._body()
            host = re.sub(r'[^A-Za-z0-9.:\-\[\]]', '', h.headers.get('Host') or '')
            ex = CatalogExport(st, web_api.IMAGES, 'http://' + host if host else '')
            name, data, ctype, info = ex.build(d.get('ids') or [], d, is_admin(h))
            self._log('export_catalog', 'catalog', None, None, info)
            h.send(200, ctype, data, h.attachment(name))
            return True
        # модерация: очередь, просмотр, решение
        if not power(h, 'catSelfMod', m):
            return self._deny('принимать правки других', 'approve_edit' if m == 'POST' else None)
        desk = ModerationDesk(st, actor(h)[1], self._log)
        if sub == 'moderation':
            h.send_json({'pending': desk.items('pending')})
            return True
        r = re.match(r'^moderation/(\d+)(?:/(approve|reject))?$', sub)
        if not r.group(2):
            h.send_json(desk.view(int(r.group(1))))
            return True
        if m != 'POST':
            return h.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
        d = self._body()
        keys = d.get('fields') if isinstance(d.get('fields'), list) else None
        if r.group(2) == 'reject' and not str(d.get('reason') or '').strip():
            raise ValueError('Укажите причину отклонения')
        h.send_json(desk.review(int(r.group(1)), r.group(2), d.get('reason') or '', keys))
        return True
