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


def power(handler, key, method='GET') -> bool:
    """Особое право (auth_users.STRICT): администратор — всегда; менеджер — только вошедший по паролю и с этим правом."""
    if is_admin(handler, need_csrf=(method != 'GET')):
        return True
    u = getattr(handler, '_kp_user', None)
    return bool(
        getattr(handler, '_kp_login', False) and session(handler, touch=False) is None and u and u['perms'].get(key)
    )


class ModerationDesk:
    ATTR = 'attrs.'  # поле-параметр категории: «attrs.<ключ>»

    def __init__(self, store, author: str, log_fn) -> None:
        self.store, self.author, self.log = store, author, log_fn

    @classmethod
    def fields(cls, before, after) -> list:
        """Изменённые поля [{key, label, before, after}]; параметры категории (attrs) — каждый своей строкой."""
        before_diff, after_diff = diff(before, after, AUTO_KEYS)
        out = []
        for k in after_diff:
            before_attrs, after_attrs = (before or {}).get('attrs'), (after or {}).get('attrs')
            if k == 'attrs' and isinstance(before_attrs or {}, dict) and isinstance(after_attrs or {}, dict):
                before_spec, after_spec = diff(before_attrs or {}, after_attrs or {})
                out += [
                    {
                        'key': cls.ATTR + key,
                        'label': key,
                        'attr': key,
                        'before': before_spec[key],
                        'after': after_spec[key],
                    }
                    for key in after_spec
                ]
            else:
                out.append({'key': k, 'label': LABELS.get(k, k), 'before': before_diff[k], 'after': after_diff[k]})
        return out

    def items(self, status, limit: int | None = None) -> list[dict]:
        """Правки со статусом status, новые первыми: название, изменённые поля, устарела ли (товар изменён после отправки)."""
        out = []
        for pend in self.store.pending_list(status, with_docs=True)[:limit]:
            after = _loads(pend['after']) or {}
            pend['name'] = after.get('name', pend['productId'])
            pend['cat'] = (after.get('attrs') or {}).get('cat') or ''
            pend['fields'] = [field['label'] for field in self.fields(_loads(pend['before']), after)]
            pend['stale'] = status == 'pending' and (self.store.catalog_get(pend['productId']) or None) != (
                pend['before'] or None
            )
            pend.pop('before'), pend.pop('after')
            out.append(pend)
        return out

    def view(self, eid) -> dict:
        """Правка для окна сравнения: поля «было / стало», обе карточки (для вида карточкой), есть ли товар сейчас."""
        pend = self.store.pending_get(eid)
        if not pend:
            raise ValueError('Правка не найдена')
        before, after = _loads(pend['before']), _loads(pend['after']) or {}
        pend['diff'] = self.fields(before, after)
        pend['current'] = self.store.catalog_get(pend['productId']) is not None
        pend['beforeDoc'], pend['afterDoc'] = before, after
        pend['stale'] = pend['status'] == 'pending' and (self.store.catalog_get(pend['productId']) or None) != (
            pend['before'] or None
        )
        pend.pop('before'), pend.pop('after')
        return pend

    def _merge(self, pend, keys) -> tuple:
        """Карточка с выбранными полями правки поверх текущей (товара нет — поверх прежней)."""
        before, after = _loads(pend['before']), _loads(pend['after']) or {}
        known = {field['key'] for field in self.fields(before, after)}
        keys = [k for k in keys if k in known]
        if not keys:
            raise ValueError('Отметьте хотя бы одно изменённое поле')
        new = dict(_loads(self.store.catalog_get(pend['productId'])) or before or {})
        new.pop('_rev', None)
        for k in keys:
            if k.startswith(self.ATTR):
                merged_attrs, attrs = k[len(self.ATTR) :], dict(new.get('attrs') or {})
                v = (after.get('attrs') or {}).get(merged_attrs)
                if v in (None, ''):
                    attrs.pop(merged_attrs, None)
                else:
                    attrs[merged_attrs] = v
                new['attrs'] = attrs
            elif after.get(k) is None:
                new.pop(k, None)
            else:
                new[k] = after[k]
        return new, keys

    def review(self, eid, act, reason='', keys=None) -> dict:
        """Принять (целиком или поля keys) или отклонить правку. → {ok, message?}"""
        pend = self.store.pending_get(eid)
        if not pend or pend['status'] != 'pending':
            return {'ok': False, 'message': 'Правка уже рассмотрена'}
        reason = str(reason or '').strip()[:500]
        if act == 'approve':
            if keys is None and (pend['kind'] == 'create' or not self.store.catalog_get(pend['productId'])):
                text, part = pend['after'], None
            elif keys is None:  # целиком — изменённые в правке поля поверх текущей карточки (цены, остатки и фото
                picked = [
                    field['key'] for field in self.fields(_loads(pend['before']), _loads(pend['after']))
                ]  # с тех пор — не откатываются)
                new, part = (
                    self._merge(pend, picked)
                    if picked
                    else (dict(_loads(self.store.catalog_get(pend['productId'])) or {}), [])
                )
                new.pop('_rev', None)
                text, part = json.dumps(new, ensure_ascii=False), None
            else:
                if pend['kind'] == 'create':
                    raise ValueError('Новый товар принимается только целиком')
                new, part = self._merge(pend, [str(k) for k in keys if isinstance(k, str)])
                text = json.dumps(new, ensure_ascii=False)
            before_diff, after_diff = diff(
                _loads(self.store.catalog_get(pend['productId'])) or _loads(pend['before']), _loads(text), AUTO_KEYS
            )
            if not self.store.pending_claim(eid):  # двойное «Принять» — второе нажатие ничего не пишет
                return {'ok': False, 'message': 'Правка уже рассмотрена'}
            try:
                self.store.catalog_put(pend['productId'], text)
            except Exception:
                self.store.pending_set(eid, 'pending', '', '')  # не записалось — правка снова ждёт решения
                raise
            note = ''
            if part is not None and len(part) < len(self.fields(_loads(pend['before']), _loads(pend['after']))):
                note = 'принято частично: ' + ', '.join(part)
            self.store.pending_set(eid, 'approved', self.author, note)
            self.log(
                'approve_edit',
                'product',
                pend['productId'],
                before_diff,
                dict(after_diff, __part__=note) if note else after_diff,
            )
        else:
            before_diff, after_diff = diff(_loads(pend['before']), _loads(pend['after']), AUTO_KEYS)
            self.store.pending_set(eid, 'rejected', self.author, reason)
            self.log('reject_edit', 'product', pend['productId'], before_diff, dict(after_diff, __reason__=reason))
        return {'ok': True}


class TrashBin:
    TYPES = ('kp', 'catalog', 'manager', 'client', 'supplier')

    def __init__(self, store, log_fn) -> None:
        self.store, self.log = store, log_fn

    def items(self, etype='') -> dict:
        rows = self.store.trash_list()
        counts: dict = {}
        for row in rows:
            counts[row['entityType']] = counts.get(row['entityType'], 0) + 1
        return {'items': [row for row in rows if not etype or row['entityType'] == etype], 'counts': counts}

    def restore(self, tid: str | int) -> None:
        etype, eid = self.store.trash_restore(tid)
        if etype == 'kp':
            from crm import DealBook

            DealBook.kp_moved(self.store, eid, 'Корзина')
        self.log('restore', etype, eid, None, None)

    def drop(self, tid: str | int) -> None:
        """Удалить навсегда одну запись корзины."""
        rec = self.store.trash_drop(tid)
        if not rec:
            raise ValueError('Нет такой записи в корзине')
        self.log('purge_trash', rec['entityType'], rec['entityId'], {'title': rec['title']}, None)

    def clear(self, etype='') -> int:
        """«Очистить корзину» — всё или записи одного вида. → сколько удалено навсегда."""
        if etype and etype not in self.TYPES:
            raise ValueError('Неизвестный вид записей')
        count = self.store.trash_clear(etype or None)
        self.log('purge_trash', 'trash', etype or 'all', None, {'deleted': count})
        return count


class XlsxBook:
    """Книга Excel из таблиц (лист — заголовок и строки): шапка жирная и закреплена, ширина столбцов по содержимому."""

    BAD = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f]')

    def __init__(self) -> None:
        self.sheets: list = []

    def add(self, title, head, rows) -> None:
        name = re.sub(r'[\[\]:*?/\\]', ' ', str(title or 'Лист')).strip()[:31] or 'Лист'
        base, k = name, 2
        while any(sheet[0].lower() == name.lower() for sheet in self.sheets):
            name = (base[:27] + f' ({k})')[:31]
            k += 1
        self.sheets.append((name, head, rows))

    @staticmethod
    def col(i) -> str:
        label = ''
        i += 1
        while i:
            i, rest = divmod(i - 1, 26)
            label = chr(65 + rest) + label
        return label

    def _cell(self, ref, v, style=0) -> str:
        style_attr = f' s="{style}"' if style else ''
        if isinstance(v, bool):
            v = 'да' if v else 'нет'
        if isinstance(v, (int, float)) and not math.isnan(v) and abs(v) < 1e15:
            return f'<c r="{ref}"{style_attr}><v>{repr(v) if isinstance(v, float) else v}</v></c>'
        text = self.BAD.sub('', str(v))[:32000]
        return f'<c r="{ref}" t="inlineStr"{style_attr}><is><t xml:space="preserve">{xml_escape(text)}</t></is></c>'

    def _sheet(self, head, rows) -> str:
        widths = [min(60, max(8, len(str(head_cell)) + 2)) for head_cell in head]
        for row in rows[:300]:
            for i, v in enumerate(row[: len(widths)]):
                widths[i] = min(60, max(widths[i], len(str(v if v is not None else '').split('\n')[0]) + 2))
        cols = ''.join(
            f'<col min="{i + 1}" max="{i + 1}" width="{width}" customWidth="1"/>' for i, width in enumerate(widths)
        )
        out = [
            '<row r="1">'
            + ''.join(self._cell(self.col(i) + '1', head_cell, 1) for i, head_cell in enumerate(head))
            + '</row>'
        ]
        for row_no, row in enumerate(rows, 2):
            out.append(
                f'<row r="{row_no}">'
                + ''.join(self._cell(f'{self.col(i)}{row_no}', v, 2) for i, v in enumerate(row) if v not in (None, ''))
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
        count = len(self.sheets)
        content_types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + ''.join(
                f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for i in range(count)
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
            + ''.join(
                f'<sheet name={quoteattr(sheet[0])} sheetId="{i + 1}" r:id="rId{i + 1}"/>'
                for i, sheet in enumerate(self.sheets)
            )
            + '</sheets></workbook>'
        )
        wrels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                for i in range(count)
            )
            + f'<Relationship Id="rId{count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
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
            z.writestr('[Content_Types].xml', content_types)
            z.writestr('_rels/.rels', rels)
            z.writestr('xl/workbook.xml', workbook)
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
        self.store, self.images, self.base = store, images, base_url.rstrip('/')  # images — ImageStore папки data/img

    def docs(self, ids) -> list:
        ids = [str(i) for i in ids if isinstance(i, str) and 0 < len(i) <= 64][: self.MAX_ITEMS]
        out = {}
        for k in range(0, len(ids), 500):
            part = ids[k : k + 500]
            for cid, doc in self.store.all(
                'SELECT id, doc FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))), tuple(part)
            ):
                parsed = _loads(doc)
                if isinstance(parsed, dict):
                    out[cid] = parsed
        return [out[i] for i in ids if i in out]

    @staticmethod
    def stock_text(stock) -> str:
        if not isinstance(stock, dict):
            return ''
        if stock.get('gone'):
            return 'нет в фиде'
        qty = stock.get('qty')
        if qty is not None:
            if qty > 0:
                return f'в наличии {qty} шт.'
            if stock.get('transit'):
                return 'в пути {} шт.'.format(stock['transit'])
            return 'под заказ' if stock.get('available') else 'нет в наличии'
        return 'в наличии' if stock.get('available') else 'нет в наличии'

    def pics(self, x) -> list:
        """Изображения позиции: главное фото, затем галерея (без выключенных), без повторов."""
        out = []
        for pic in [x.get('photo'), *list(x.get('gallery') or [])]:
            src = (pic or {}).get('src') if isinstance(pic, dict) else None
            if src and isinstance(src, str) and (pic.get('on', True) is not False) and src not in out:
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
        cols = [col for col, _ in self.COLS if col in (opts.get('cols') or [])]
        want = opts.get('params') or []
        allp = '*' in want
        want = {str(want_key) for want_key in want if isinstance(want_key, str)}
        price, rrc, stock = bool(opts.get('price')), bool(opts.get('rrc')), bool(opts.get('stock'))
        cost = bool(opts.get('cost')) and admin  # закупку выгружает только администратор
        img = opts.get('images') if opts.get('images') in ('links', 'files') else 'none'
        docs = self.docs(opts.get('ids') if ids is None else ids)
        if not docs:
            raise ValueError('Нет позиций для выгрузки — отберите позиции в каталоге')
        types = {tdef.get('id'): tdef for tdef in load_types()['types']}
        scope = SupplierScope(self.store) if 'sup' in cols else None
        items = []
        for x in docs:
            attrs = x.get('attrs') or {}
            tdef = types.get(attrs.get('cat')) or {}
            params = []
            for field in tdef.get('fields') or []:
                k = field.get('key')
                if k in self.BASE_ATTRS or not (allp or k in want):
                    continue
                v = attrs.get(k)
                if v not in (None, ''):
                    params.append(
                        {'key': k, 'label': field.get('label') or k, 'unit': field.get('unit') or '', 'value': v}
                    )
            rec = {
                'id': x.get('id'),
                'name': x.get('name') or '',
                'catId': attrs.get('cat') or '',
                'cat': tdef.get('name') or attrs.get('cat') or '',
                'maker': attrs.get('maker') or '',
                'series': attrs.get('series') or '',
                'model': attrs.get('model') or '',
                'art': x.get('art') or (x.get('feed') or {}).get('sku') or attrs.get('article') or '',
                'sup': scope.name_of(x.get('src') or (x.get('feed') or {}).get('id'), attrs.get('maker'))
                if scope
                else '',
                'spec': x.get('spec') or '',
                'desc': '\n'.join(
                    (
                        '{}. {}'.format(field.get('label'), field.get('text') or '')
                        if field.get('label')
                        else str(field.get('text') or '')
                    ).strip()
                    for field in (x.get('features') or [])
                    if isinstance(field, dict) and (field.get('label') or field.get('text'))
                ),
                'specs': '\n'.join(
                    '{}: {}'.format(row2.get('k') or '', row2.get('v') or '')
                    for group in (x.get('groups') or [])
                    if isinstance(group, dict)
                    for row2 in (group.get('rows') or [])
                    if isinstance(row2, dict) and (row2.get('k') or row2.get('v'))
                ),
                'url': (x.get('feed') or {}).get('url')
                if re.match(r'^https?://', str((x.get('feed') or {}).get('url') or ''), re.I)
                else '',
                'params': params,
            }
            if price:
                rec['price'], rec['priceCur'] = x.get('price') or None, x.get('priceCur') or 'RUB'
            if rrc:
                rrc_obj = got_value if isinstance(got_value := x.get('rrc'), dict) else {}
                rec['rrc'], rec['rrcCur'] = rrc_obj.get('price') or None, rrc_obj.get('cur') or 'RUB'
            if cost:
                rec['cost'], rec['costCur'] = x.get('cost') or None, x.get('costCur') or 'RUB'
            if stock:
                stock_obj = got_value if isinstance(got_value := x.get('stock'), dict) else None
                rec['stock'], rec['stockQty'] = self.stock_text(stock_obj), (stock_obj or {}).get('qty')
            if img != 'none':
                rec['images'] = [u for u in (self.pic_ref(pic, img) for pic in self.pics(x)) if u]
            items.append(rec)
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
            buf, count = io.BytesIO(), 0
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr(name + ext, data)
                seen = set()
                for x in docs:
                    for pic in self.pics(x):
                        if not pic.startswith('/img/') or pic in seen:
                            continue
                        seen.add(pic)
                        field = self.images.path(pic[5:]) if self.images else None
                        if field:
                            z.write(field, 'images/' + pic[5:], compress_type=zipfile.ZIP_STORED)
                            count += 1
            info['files'] = count
            return name + '.zip', buf.getvalue(), 'application/zip', info
        return name + ext, data, ctype, info

    def _head(self, cols, items) -> list:
        """Столбцы таблицы: (подпись, функция значения)."""
        lab = dict(self.COLS)
        out = [('Наименование', lambda rec: rec['name'])] + [
            (lab[col_def], lambda rec, col=col_def: rec[col]) for col_def in cols
        ]
        keys = []
        for entry in items:
            for param in entry['params']:
                if (param['key'], param['label'], param['unit']) not in keys:
                    keys.append((param['key'], param['label'], param['unit']))
        for k, label, unit in keys:
            out.append(
                (
                    f'{label}, {unit}' if unit else label,
                    lambda rec, k=k: next((param['value'] for param in rec['params'] if param['key'] == k), None),
                )
            )
        if items and 'price' in items[0]:
            out += [
                ('Цена КП', lambda rec: rec['price']),
                ('Валюта цены', lambda rec: rec['priceCur'] if rec['price'] else ''),
            ]
        if items and 'rrc' in items[0]:
            out += [('РРЦ', lambda rec: rec['rrc']), ('Валюта РРЦ', lambda rec: rec['rrcCur'] if rec['rrc'] else '')]
        if items and 'cost' in items[0]:
            out += [
                ('Закупка', lambda rec: rec['cost']),
                ('Валюта закупки', lambda rec: rec['costCur'] if rec['cost'] else ''),
            ]
        if items and 'stock' in items[0]:
            out += [('Наличие', lambda rec: rec['stock']), ('Остаток, шт.', lambda rec: rec['stockQty'])]
        if items and 'images' in items[0]:
            out.append(('Изображения', lambda rec: '\n'.join(rec['images'])))
        out.append(('Код позиции', lambda rec: rec['id']))
        return out

    def _xlsx(self, items, cols, opts) -> tuple:
        book = XlsxBook()
        groups: dict = {}
        for rec in items:
            groups.setdefault(rec['cat'] or 'Без категории', []).append(rec)
        for cat, rows in sorted(groups.items(), key=lambda pair: pair[0]):
            head = self._head(cols, rows)
            book.add(cat, [head_name for head_name, _ in head], [[getter(rec) for _, getter in head] for rec in rows])
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
        out = [{k: v for k, v in rec.items() if k in keep and v not in (None, '', [])} for rec in items]
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
    def _tag(tag, v, attrs='') -> str:
        return (
            '<{}{}>{}</{}>'.format(tag, attrs, xml_escape(XlsxBook.BAD.sub('', str(v))), tag)
            if v not in (None, '')
            else ''
        )

    def _xml(self, items, cols, opts) -> tuple:
        lab, tag = dict(self.COLS), self._tag
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<catalog date={}>'.format(quoteattr(datetime.now().isoformat(timespec='seconds'))),
        ]
        for rec in items:
            out.append(
                '<item id={}>'.format(quoteattr(str(rec['id'])))
                + tag('name', rec['name'])
                + ''.join(tag(col, rec[col], f' title={quoteattr(lab[col])}') for col in cols)
                + ''.join(
                    tag(
                        'param',
                        param['value'],
                        ' key={} name={}{}'.format(
                            quoteattr(param['key']),
                            quoteattr(param['label']),
                            ' unit={}'.format(quoteattr(param['unit'])) if param['unit'] else '',
                        ),
                    )
                    for param in rec['params']
                )
                + (
                    tag('price', rec.get('price'), ' currency={}'.format(quoteattr(rec['priceCur'])))
                    if rec.get('price')
                    else ''
                )
                + (
                    tag('rrc', rec.get('rrc'), ' currency={}'.format(quoteattr(rec['rrcCur'])))
                    if rec.get('rrc')
                    else ''
                )
                + (
                    tag('cost', rec.get('cost'), ' currency={}'.format(quoteattr(rec['costCur'])))
                    if rec.get('cost')
                    else ''
                )
                + (
                    tag(
                        'stock',
                        rec.get('stock'),
                        ' qty={}'.format(quoteattr(str(rec['stockQty']))) if rec.get('stockQty') is not None else '',
                    )
                    if rec.get('stock')
                    else ''
                )
                + ''.join(tag('picture', u) for u in rec.get('images') or [])
                + '</item>'
            )
        out.append('</catalog>')
        return '\n'.join(out).encode('utf-8'), 'application/xml; charset=utf-8', '.xml'

    def _yml(self, items, cols, opts) -> tuple:
        """Яндекс YML (yml_catalog): категории, предложения с vendor, model, price, picture, description, param."""
        tag = self._tag

        def cur(code) -> str:
            return 'RUR' if code in ('RUB', 'RUR', '', None) else code

        cats = []
        for rec in items:
            if (rec['catId'], rec['cat']) not in cats:
                cats.append((rec['catId'], rec['cat']))
        cid = {cat[0]: i + 1 for i, cat in enumerate(cats)}
        curs = sorted({cur(rec.get('priceCur')) for rec in items if rec.get('price')} | {'RUR'})
        out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<yml_catalog date={}><shop>'.format(quoteattr(datetime.now().strftime('%Y-%m-%dT%H:%M'))),
            tag('name', opts.get('shop') or 'Каталог'),
            tag('company', opts.get('shop') or 'Каталог'),
            tag('url', self.base or 'http://localhost'),
            '<currencies>'
            + ''.join(
                '<currency id={} rate={}/>'.format(quoteattr(cat), quoteattr('1' if cat == 'RUR' else 'CBRF'))
                for cat in curs
            )
            + '</currencies>',
            '<categories>'
            + ''.join(tag('category', name or i or 'Без категории', f' id="{cid[i]}"') for i, name in cats)
            + '</categories>',
            '<offers>',
        ]
        for rec in items:
            avail = (
                'true'
                if (rec.get('stockQty') or 0) > 0 or (rec.get('stock') or '').startswith('в наличии')
                else 'false'
            )
            desc = '\n'.join(
                x for x in (rec.get('spec') if 'spec' in cols else '', rec.get('desc') if 'desc' in cols else '') if x
            )
            out.append(
                '<offer id={}{}>'.format(quoteattr(str(rec['id'])), f' available="{avail}"' if 'stock' in rec else '')
                + tag('name', rec['name'])
                + tag('vendor', rec['maker'])
                + tag('model', rec['model'] or rec['name'])
                + tag('vendorCode', rec['art'] if 'art' in cols else '')
                + tag('url', rec['url'] if 'url' in cols else '')
                + (tag('price', rec['price']) + tag('currencyId', cur(rec['priceCur'])) if rec.get('price') else '')
                + tag('categoryId', cid[rec['catId']])
                + ''.join(tag('picture', u) for u in rec.get('images') or [])
                + tag('description', desc)
                + ''.join(
                    tag(
                        'param',
                        param['value'],
                        ' name={}{}'.format(
                            quoteattr(param['label']),
                            ' unit={}'.format(quoteattr(param['unit'])) if param['unit'] else '',
                        ),
                    )
                    for param in rec['params']
                )
                + (tag('param', rec['sup'], ' name="Поставщик"') if 'sup' in cols else '')
                + (
                    tag('param', rec['rrc'], ' name="РРЦ" unit={}'.format(quoteattr(rec['rrcCur'])))
                    if rec.get('rrc')
                    else ''
                )
                + (
                    tag('param', rec['cost'], ' name="Закупка" unit={}'.format(quoteattr(rec['costCur'])))
                    if rec.get('cost')
                    else ''
                )
                + (
                    tag('param', rec['stockQty'], ' name="Остаток" unit="шт."')
                    if rec.get('stockQty') is not None
                    else ''
                )
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
        self.store = store

    def rows(self) -> list:
        out = []
        for client in self.store.clients_all():
            k = (client.get('contacts') or [{}])[0] or {}
            out.append(
                {
                    'name': client.get('name') or '',
                    'full': client.get('full') or '',
                    'inn': client.get('inn') or '',
                    'kpp': client.get('kpp') or '',
                    'ogrn': client.get('ogrn') or '',
                    'address': client.get('address') or '',
                    'contact': k.get('name') or '',
                    'post': k.get('post') or '',
                    'phone': k.get('phone') or '',
                    'email': k.get('email') or '',
                    'objects': '\n'.join(
                        ' — '.join(v for v in (obj.get('purpose'), obj.get('address')) if v)
                        for obj in (client.get('objects') or [])
                        if isinstance(obj, dict)
                    ),
                    'kpCount': client.get('kpCount') or None,
                    'lastKp': client.get('lastKp') or '',
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
                'items': [{k: v for k, v in row.items() if v not in (None, '')} for row in rows],
            }
            return (
                name + '.json',
                json.dumps(body, ensure_ascii=False, indent=1).encode('utf-8'),
                'application/json; charset=utf-8',
                len(rows),
            )
        book = XlsxBook()
        book.add('Клиенты', [col for _, col in self.COLS], [[row[k] for k, _ in self.COLS] for row in rows])
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

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store

    @classmethod
    def handles(cls, path) -> bool:
        return bool(cls.PATHS.match(path))

    def _log(self, action, etype=None, eid=None, before=None, after=None, result='success') -> None:
        log(
            self.handler,
            self.store,
            action,
            etype,
            eid,
            before,
            after,
            result=result,
            admin=is_admin(self.handler, need_csrf=False) or None,
        )

    def _deny(self, what, action=None) -> bool:
        if action:
            self._log(action, 'product', None, result='failed')
        self.handler.send(403, 'text/plain; charset=utf-8', f'Нет права {what} — обратитесь к администратору')
        return True

    def _body(self) -> dict:
        try:
            data = json.loads(self.handler.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            data = None
        if not isinstance(data, dict):
            raise ValueError('Неверный запрос: нужен объект JSON')
        return data

    def route(self, method, path) -> bool | None:
        handler = self.handler
        try:
            if path == '/api/clients/export':
                return self._clients(method)
            return self._route(method, path[len('/api/catalog/') :])
        except ValueError as exc:
            handler.send(400, 'text/plain; charset=utf-8', str(exc))
            return True

    def _clients(self, method) -> bool | None:
        handler = self.handler
        if method != 'POST':
            return handler.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
        if not power(handler, 'export', method):
            return self._deny('выгружать клиентов', 'export_clients')
        name, data, ctype, packed = ClientsExport(self.store).build(self._body().get('fmt'))
        self._log('export_clients', 'client', None, None, {'items': packed})
        handler.send(200, ctype, data, handler.attachment(name))
        return True

    def _route(self, method, sub) -> bool | None:
        handler, store = self.handler, self.store
        if sub == 'trash':
            if method != 'POST':
                return handler.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
            if not power(handler, 'catDelete', method):
                return self._deny('удалять товары', 'delete_catalog')
            ids = [str(i) for i in (self._body().get('ids') or []) if isinstance(i, str) and 0 < len(i) <= 64][:5000]
            if not ids:
                raise ValueError('Не выбрано, что удалить')
            names = {}
            for k in range(0, len(ids), 500):
                part = ids[k : k + 500]
                names.update(
                    dict(
                        store.all(
                            'SELECT id, name FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))),
                            tuple(part),
                        )
                    )
                )
            count = store.trash_put_many('catalog', [(i, names[i] or i) for i in ids if i in names], actor(handler)[1])
            self._log(
                'delete_catalog',
                'catalog',
                ids[0] if len(ids) == 1 else f'items:{len(ids)}',
                None,
                {'deleted': count, 'names': [names.get(i) for i in ids[:20]]},
            )
            handler.send_json({'ok': True, 'deleted': count})
            return True
        if sub == 'export':
            if method != 'POST':
                return handler.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
            if not power(handler, 'export', method):
                return self._deny('выгружать каталог', 'export_catalog')
            import web_api

            payload = self._body()
            host = re.sub(r'[^A-Za-z0-9.:\-\[\]]', '', handler.headers.get('Host') or '')
            exporter = CatalogExport(store, web_api.IMAGES, 'http://' + host if host else '')
            name, data, ctype, info = exporter.build(payload.get('ids') or [], payload, is_admin(handler))
            self._log('export_catalog', 'catalog', None, None, info)
            handler.send(200, ctype, data, handler.attachment(name))
            return True
        # модерация: очередь, просмотр, решение
        if not power(handler, 'catSelfMod', method):
            return self._deny('принимать правки других', 'approve_edit' if method == 'POST' else None)
        desk = ModerationDesk(store, actor(handler)[1], self._log)
        if sub == 'moderation':
            handler.send_json({'pending': desk.items('pending')})
            return True
        match = re.match(r'^moderation/(\d+)(?:/(approve|reject))?$', sub)
        if match is None:
            return False
        if not match.group(2):
            handler.send_json(desk.view(int(match.group(1))))
            return True
        if method != 'POST':
            return handler.send(405, 'text/plain; charset=utf-8', 'Нужен POST') or True
        payload = self._body()
        keys = got_value if isinstance(got_value := payload.get('fields'), list) else None
        if match.group(2) == 'reject' and not str(payload.get('reason') or '').strip():
            raise ValueError('Укажите причину отклонения')
        handler.send_json(desk.review(int(match.group(1)), match.group(2), payload.get('reason') or '', keys))
        return True
