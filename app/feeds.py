# -*- coding: utf-8 -*-
"""Товарные фиды поставщиков (формат YML — «Яндекс.Маркет», его выгружают Bitrix, InSales, 1С и др.).

Фид — как API поставщика: по кнопке позиции фида становятся позициями каталога (название, характеристики,
описание, фото, производитель, модель, категория программы), а раз в день программа сверяет РРЦ и наличие.

  • Настройки фидов — kv «feeds»: [{id, name, url, maker, discount, auto, cats:{категория фида: тип программы | "skip"}}].
  • Позиция каталога из фида: doc.feed = {id, oid, url, sku, barcode, orig:{…}} — связь с предложением фида;
    doc.rrc = {price (коп.), cur, at, prev, prevAt} — рекомендованная розничная цена;
    doc.stock = {qty, available, at, gone} — наличие у поставщика (qty — если фид даёт остаток).
    Цена КП позиции (doc.price) берётся из РРЦ, пока её не изменили вручную (doc.priceSrc = "rrc");
    закупка (doc.cost) — РРЦ минус скидка поставщика, если скидка задана (doc.costSrc = "feed").
  • Повторная загрузка не затирает ручные правки: название, описание и таблица характеристик обновляются,
    только если их не меняли после прошлой загрузки (сравнение с doc.feed.orig).
  • Журнал — kv «feedlog:<id>»: последние 30 загрузок и проверок (что добавлено, изменения РРЦ и наличия).
"""
import hashlib
import json
import re
import struct
import threading
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import catalog_migrate
import images
import imgfetch

MAX_FEED = 150 * 1024 * 1024
KV = 'feeds'
IMAGE_STORE = None      # хранилище изображений data/img (images.ImageStore) — задаёт kp_server при запуске
JOBS = {}               # id фида → {kind, state, done, total, msg, startedAt, result}
_CACHE = {}             # id фида → (время, url, разобранный фид) — предпросмотр и загрузка без повторного скачивания
_LOCK = threading.Lock()
STOCK_TAGS = ('count', 'quantity', 'stock_quantity', 'stock', 'amount', 'qty', 'instock', 'in_stock')
STOCK_PARAM = re.compile(r'^(остаток|остатки|наличие|в наличии|количество( на складе)?|склад)$', re.I)


def _now():
    return datetime.now().isoformat(timespec='seconds')


def _num(v):
    try:
        return float(re.sub(r'[\s\xa0]', '', str(v)).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _txt(el, tag):
    x = el.find(tag)
    return re.sub(r'\s+', ' ', x.text).strip() if x is not None and x.text else ''


def _html_text(s):
    """Описание из фида (часто HTML) → обычный текст с абзацами."""
    s = re.sub(r'(?i)<\s*(br|/p|/div|/li|/h\d)\s*/?>', '\n', str(s or ''))
    s = re.sub(r'(?i)<li[^>]*>', '• ', s)
    s = re.sub(r'<[^>]+>', '', s)
    for a, b in (('&nbsp;', ' '), ('&laquo;', '«'), ('&raquo;', '»'), ('&mdash;', '—'), ('&ndash;', '–'), ('&quot;', '"'),
                 ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'), ('&#039;', "'")):
        s = s.replace(a, b)
    lines = [re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in s.split('\n')]
    return '\n'.join(x for x in lines if x)[:6000]


# ---------------------------------------------------------------- настройки
def feeds(store):
    return (store.kv_get(KV) or {}).get('items') or []


def feed_get(store, fid):
    return next((f for f in feeds(store) if f.get('id') == fid), None)


def feed_save(store, f):
    url = str(f.get('url') or '').strip()
    if not re.match(r'^https?://', url, re.I):
        raise ValueError('Укажите адрес фида (http или https)')
    items = feeds(store)
    fid = f.get('id') or images.slug(f.get('name') or urllib.parse.urlsplit(url).hostname or 'feed', 30) or 'feed'
    old = next((x for x in items if x.get('id') == fid), None) or {}
    if not f.get('id') and any(x.get('id') == fid for x in items):
        fid = '%s-%d' % (fid, len(items) + 1)
    disc = _num(f.get('discount'))
    rec = dict(old, id=fid, name=str(f.get('name') or old.get('name') or fid).strip()[:80], url=url,
               maker=str(f.get('maker') or '').strip()[:60], discount=disc if disc and 0 < disc < 100 else None,
               auto=f.get('auto', True) is not False, cats=f.get('cats') if isinstance(f.get('cats'), dict) else old.get('cats') or {},
               supplier=str(f.get('supplier') or old.get('supplier') or '')[:64], updatedAt=_now())
    items = [x for x in items if x.get('id') != fid] + [rec]
    store.kv_set(KV, {'items': items})
    return rec


def feed_delete(store, fid):
    store.kv_set(KV, {'items': [x for x in feeds(store) if x.get('id') != fid]})


def log_of(store, fid):
    return store.kv_get('feedlog:' + fid) or []


def _log_add(store, fid, rec):
    lg = [rec] + log_of(store, fid)
    store.kv_set('feedlog:' + fid, lg[:30])


# ---------------------------------------------------------------- загрузка и разбор YML
def fetch(url):
    imgfetch._check_url(url)        # только http(s) и не адреса локальной сети
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh feed)', 'Accept': 'application/xml,text/xml,*/*'})
    with urllib.request.build_opener(imgfetch._SafeRedirect).open(req, timeout=120) as r:
        data = r.read(MAX_FEED + 1)
    if len(data) > MAX_FEED:
        raise ValueError('Фид больше 150 МБ')
    return data


def parse(data):
    """YML → {shop, date, cats:{id:{name, parent, path}}, offers:[…]}."""
    data = data.lstrip(b'\xef\xbb\xbf \t\r\n')
    if b'<!ENTITY' in data[:4096].upper():
        raise ValueError('В фиде объявлены сущности XML — такой файл не загружается')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ValueError('Фид не читается как XML (YML): %s' % e)
    shop = root.find('shop') if root.tag != 'shop' else root
    if shop is None:
        raise ValueError('Это не фид YML: нет раздела <shop>')
    cats = {}
    for c in shop.iter('category'):
        cid = (c.get('id') or '').strip()
        if cid:
            cats[cid] = {'id': cid, 'name': re.sub(r'\s+', ' ', c.text or '').strip(), 'parent': (c.get('parentId') or '').strip()}
    for c in cats.values():
        path, p, seen = [c['name']], c['parent'], set()
        while p and p in cats and p not in seen:
            seen.add(p)
            path.insert(0, cats[p]['name'])
            p = cats[p]['parent']
        c['path'] = ' / '.join(x for x in path if x)
    offers = []
    for el in shop.iter('offer'):
        oid = (el.get('id') or '').strip()
        if not oid:
            continue
        vendor, model, prefix = _txt(el, 'vendor'), _txt(el, 'model'), _txt(el, 'typePrefix')
        name = _txt(el, 'name') or ' '.join(x for x in (prefix, vendor, model) if x)
        params = []
        qty = None
        for p in el.findall('param'):
            pn, pv = (p.get('name') or '').strip(), re.sub(r'\s+', ' ', p.text or '').strip()
            if not pn or not pv:
                continue
            if STOCK_PARAM.match(pn) and _num(pv) is not None:
                qty = _num(pv)
                continue
            params.append({'k': pn, 'u': (p.get('unit') or '').strip(), 'v': pv})
        for tag in STOCK_TAGS:
            v = _num(_txt(el, tag))
            if v is not None:
                qty = v
                break
        outs = [_num(o.get('instock')) for o in el.iter('outlet') if o.get('instock') is not None]
        if outs and any(x is not None for x in outs):
            qty = sum(x for x in outs if x is not None)
        avail_attr = (el.get('available') or '').strip().lower()
        available = avail_attr not in ('false', '0', 'no') if avail_attr else (qty is None or qty > 0)
        cur = (_txt(el, 'currencyId') or 'RUB').upper()
        offers.append({'oid': oid, 'name': name[:300], 'cat': _txt(el, 'categoryId'), 'url': _txt(el, 'url'),
                       'price': _num(_txt(el, 'price')), 'oldprice': _num(_txt(el, 'oldprice')), 'cur': 'RUB' if cur in ('RUR', 'RUB') else cur,
                       'vendor': vendor, 'model': model, 'sku': _txt(el, 'vendorCode'), 'barcode': _txt(el, 'barcode'),
                       'pictures': [re.sub(r'\s+', '', p.text) for p in el.findall('picture') if p.text and p.text.strip()][:12],
                       'desc': _html_text((el.find('description').text if el.find('description') is not None else '') or ''),
                       'params': params, 'available': available, 'qty': qty,
                       'weight': _num(_txt(el, 'weight')), 'dims': _txt(el, 'dimensions'), 'notes': _txt(el, 'sales_notes')})
    if not offers:
        raise ValueError('В фиде нет товаров (<offer>)')
    return {'shop': _txt(shop, 'name') or _txt(shop, 'company'), 'date': root.get('date') or '', 'cats': cats, 'offers': offers}


def load(store, f, fresh=False):
    with _LOCK:
        c = _CACHE.get(f['id'])
        if c and not fresh and c[1] == f['url'] and (datetime.now() - c[0]).total_seconds() < 1800:
            return c[2]
    feed = parse(fetch(f['url']))
    with _LOCK:
        _CACHE[f['id']] = (datetime.now(), f['url'], feed)
    return feed


# ---------------------------------------------------------------- категории фида → типы программы
def guess_cat(types, cat_path, sample_names):
    for text in [cat_path] + list(sample_names[:3]):
        cat = catalog_migrate.detect({'name': text}, types)
        if cat:
            return cat
    return ''


def preview(store, f, types):
    feed = load(store, f, fresh=True)
    by = {}
    for o in feed['offers']:
        by.setdefault(o['cat'], []).append(o)
    linked = {d.get('feed', {}).get('oid') for d in _feed_docs(store, f['id'])}
    cats = []
    for cid, offs in sorted(by.items(), key=lambda x: (feed['cats'].get(x[0]) or {}).get('path') or x[0]):
        c = feed['cats'].get(cid) or {'path': 'Без категории' if not cid else 'Категория %s' % cid}
        g = guess_cat(types, c['path'], [o['name'] for o in offs])
        cats.append({'id': cid, 'path': c['path'], 'count': len(offs), 'guess': g, 'map': (f.get('cats') or {}).get(cid, g),
                     'inCatalog': sum(1 for o in offs if o['oid'] in linked)})
    pn = {}
    for o in feed['offers']:
        for p in o['params']:
            pn[p['k']] = pn.get(p['k'], 0) + 1
    offs = feed['offers']
    return {'shop': feed['shop'], 'date': feed['date'], 'total': len(offs), 'cats': cats,
            'available': sum(1 for o in offs if o['available']), 'withPrice': sum(1 for o in offs if o['price']),
            'withQty': sum(1 for o in offs if o['qty'] is not None), 'withPhoto': sum(1 for o in offs if o['pictures']),
            'inCatalog': len(linked & {o['oid'] for o in offs}), 'params': sorted(pn.items(), key=lambda x: -x[1])[:40],
            'sample': [dict({k: o[k] for k in ('oid', 'name', 'price', 'cur', 'available', 'qty', 'vendor', 'model', 'sku')},
                            pics=len(o['pictures']), params=len(o['params'])) for o in offs[:8]]}


# ---------------------------------------------------------------- позиция фида → позиция каталога
def _img_size(data):
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', data[16:24])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8X':
                return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
            if data[12:16] == b'VP8 ':
                w, h = struct.unpack('<HH', data[26:30])
                return w & 0x3fff, h & 0x3fff
        if data[:2] == b'\xff\xd8':
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                mk = data[i + 1]
                if mk in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack('>HH', data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    except Exception:
        pass
    return None, None


def _cid(fid, oid):
    return ('%s-%s' % (images.slug(fid, 20) or 'feed', images.slug(oid, 40) or hashlib.md5(oid.encode()).hexdigest()[:10]))[:64]


def _rows(o):
    rows = []
    for p in o['params']:
        v = p['v'] if not p['u'] or p['v'].lower().endswith(p['u'].lower()) else '%s %s' % (p['v'], p['u'])
        rows.append({'k': p['k'], 'v': v[:300], 'hl': False})
    if o.get('dims') and not any(re.search(r'габарит', r['k'], re.I) for r in rows):
        rows.append({'k': 'Габариты упаковки (Д × Ш × В), см', 'v': o['dims'].replace('/', ' × '), 'hl': False})
    if o.get('weight') and not any(re.search(r'^вес|масса', r['k'], re.I) for r in rows):
        rows.append({'k': 'Масса с упаковкой', 'v': '%s кг' % str(o['weight']).rstrip('0').rstrip('.'), 'hl': False})
    return rows


def _hash(x):
    return hashlib.md5(json.dumps(x, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:12]


def _feed_docs(store, fid):
    out = []
    for (doc,) in store.all("SELECT doc FROM catalog WHERE doc LIKE ?", ('%"feed": {%' + json.dumps(fid) + '%',)):
        try:
            d = json.loads(doc)
        except ValueError:
            continue
        if (d.get('feed') or {}).get('id') == fid:
            out.append(d)
    return out


def _price_part(doc, o, f, today):
    """РРЦ, наличие, цена КП и закупка позиции по предложению фида; → список изменений [(поле, было, стало)]."""
    ch = []
    if o['price']:
        kop = int(round(o['price'] * 100))
        r = doc.get('rrc') or {}
        if r.get('price') != kop or r.get('cur') != o['cur']:
            if r.get('price'):
                ch.append(('rrc', r.get('price'), kop))
            doc['rrc'] = {'price': kop, 'cur': o['cur'], 'at': today, 'old': int(round(o['oldprice'] * 100)) if o.get('oldprice') else None,
                          'prev': r.get('price'), 'prevAt': r.get('at')}
        else:
            r['at'] = today
        if doc.get('priceSrc', 'rrc') == 'rrc' and (doc.get('price') != kop or (doc.get('priceCur') or 'RUB') != o['cur']):
            doc['price'], doc['priceCur'], doc['priceSrc'] = kop, o['cur'], 'rrc'
        if f.get('discount') and doc.get('costSrc', 'feed') == 'feed':
            doc['cost'], doc['costCur'], doc['costSrc'] = int(round(kop * (1 - f['discount'] / 100))), o['cur'], 'feed'
    s = doc.get('stock') or {}
    st = {'qty': o['qty'], 'available': bool(o['available']), 'at': today, 'gone': False}
    if (s.get('qty'), bool(s.get('available')), bool(s.get('gone'))) != (st['qty'], st['available'], False) and s:
        ch.append(('stock', _stock_txt(s), _stock_txt(st)))
    doc['stock'] = st
    return ch


def _stock_txt(s):
    if not s:
        return '—'
    if s.get('gone'):
        return 'нет в фиде'
    if s.get('qty') is not None:
        return 'в наличии %s' % _fmt(s['qty']) if s['qty'] > 0 else 'нет в наличии'
    return 'в наличии' if s.get('available') else 'нет в наличии'


def _fmt(n):
    return str(int(n)) if float(n).is_integer() else str(n).replace('.', ',')


def build(o, f, types, old=None, put_image=None):
    """Позиция каталога из предложения фида; old — та же позиция в каталоге (ручные правки сохраняются)."""
    today = date.today().isoformat()
    doc = json.loads(json.dumps(old)) if old else {'prices': []}
    cat_id = (f.get('cats') or {}).get(o['cat']) or ''
    tmap = {t.get('id'): t for t in types}
    maker = o['vendor'] or f.get('maker') or ''
    model = o['model'] or o['sku'] or ''
    if not model and maker:             # «Рефрижераторный осушитель Remeza RFD 12» → «RFD 12»
        m = re.search(re.escape(maker) + r'\s+(.+)$', o['name'], re.I)
        model = m.group(1).strip()[:80] if m else ''
    rows = _rows(o)
    orig = (doc.get('feed') or {}).get('orig') or {}
    desc = o['desc']
    new_orig = {'name': o['name'], 'desc': _hash(desc), 'rows': _hash(rows)}
    if not old or doc.get('name') == orig.get('name'):
        doc['name'] = o['name']
    feats = doc.get('features') or []
    fd = next((x for x in feats if x.get('feed')), None)
    if desc and (not fd or _hash(fd.get('text') or '') == orig.get('desc')):
        if fd:
            fd['text'] = desc
        else:
            feats.insert(0, {'id': hashlib.md5((o['oid'] + 'd').encode()).hexdigest()[:8], 'label': 'Описание', 'text': desc, 'feed': True})
    doc['features'] = feats
    groups = doc.get('groups') or []
    gi = next((i for i, g in enumerate(groups) if g.get('feed')), None)
    if rows and (gi is None or _hash(groups[gi].get('rows') or []) == orig.get('rows')):
        g = {'name': 'Характеристики', 'rows': rows, 'feed': True}
        if gi is None:
            groups.insert(0, g)
        else:
            groups[gi] = g
    doc['groups'] = groups
    a = doc.get('attrs') or {}
    if not a.get('cat'):
        a['cat'] = cat_id or catalog_migrate.detect(doc, types) or 'other'
    a.setdefault('maker', maker)
    if not a.get('maker'):
        a['maker'] = maker
    if not a.get('model'):
        a['model'] = model
    t = tmap.get(a['cat'])
    if t:
        catalog_migrate.fill_from_name(doc, a['cat'], a)
        catalog_migrate.fill_attrs(doc, t, a)
    doc['attrs'] = a
    if not doc.get('spec'):
        doc['spec'] = ' · '.join(r['v'] for r in rows[:4])[:200]
    if not doc.get('unit'):
        doc['unit'] = 'шт.'
    doc['feed'] = {'id': f['id'], 'oid': o['oid'], 'url': o['url'], 'sku': o['sku'], 'barcode': o['barcode'], 'cat': o['cat'],
                   'orig': new_orig, 'at': today}
    changes = _price_part(doc, o, f, today)
    if put_image and o['pictures']:
        if not (doc.get('photo') or {}).get('src'):
            ph = put_image(o['pictures'][0], t, maker, model, o['name'], 'photo', '')
            if ph:
                doc['photo'] = ph
                doc['photoSource'] = o['pictures'][0]
        have = {g.get('source') for g in doc.get('gallery') or []}
        gal = doc.get('gallery') or []
        for k, u in enumerate(o['pictures'][1:9]):
            if u in have:
                continue
            g = put_image(u, t, maker, model, o['name'], 'gallery', 'foto-%d' % (k + 2))
            if g:
                gal.append(dict(g, id=hashlib.md5(u.encode()).hexdigest()[:8], caption='', on=True, source=u))
        doc['gallery'] = gal
    doc['updatedAt'] = _now()
    return doc, changes


def _image_putter(store, image_store):
    cache = store.kv_get('feedimg') or {}
    lock = threading.Lock()

    def put(url, t, maker, model, name, kind, caption):
        with lock:
            hit = cache.get(url)
        if hit and image_store.path(hit['rel']):
            return {'src': '/img/' + hit['rel'], 'w': hit.get('w'), 'h': hit.get('h')}
        try:
            ctype, data = imgfetch.fetch_image(url)
        except Exception:
            return None
        ext = {'image/png': '.png', 'image/webp': '.webp'}.get(ctype, '.jpg')
        folder, title = images.place(t, maker, model, name, kind, caption)
        rel = image_store.put(data, ext, folder, title)
        w, h = _img_size(data)
        with lock:
            cache[url] = {'rel': rel, 'w': w, 'h': h}
        return {'src': '/img/' + rel, 'w': w, 'h': h}

    def save():
        with lock:
            store.kv_set('feedimg', dict(list(cache.items())[-20000:]))
    return put, save


# ---------------------------------------------------------------- загрузка в каталог и проверка цен
def _job(fid, kind, total=0):
    j = {'kind': kind, 'state': 'run', 'done': 0, 'total': total, 'msg': '', 'startedAt': _now(), 'result': None}
    JOBS[fid] = j
    return j


def busy(fid):
    j = JOBS.get(fid)
    return bool(j and j['state'] == 'run')


def import_feed(store, f, types, image_store, by='', only=None, log=print):
    """Загрузка фида в каталог: новые позиции создаются, связанные обновляются (ручные правки сохраняются).
    only — множество id предложений (иначе все, кроме категорий «skip»)."""
    j = _job(f['id'], 'import')
    try:
        feed = load(store, f)
        skip = {k for k, v in (f.get('cats') or {}).items() if v == 'skip'}
        offs = [o for o in feed['offers'] if o['cat'] not in skip and (not only or o['oid'] in only)]
        j['total'] = len(offs)
        existing = {(d.get('feed') or {}).get('oid'): d for d in _feed_docs(store, f['id'])}
        put, save = _image_putter(store, image_store)
        added, updated, same, price_ch, stock_ch, errors = 0, 0, 0, [], [], []

        def one(o):
            old = existing.get(o['oid'])
            if not old:
                cid = _cid(f['id'], o['oid'])
                prev = store.catalog_get(cid)
                old = json.loads(prev) if prev else None
            doc, ch = build(o, f, types, old, put)
            return o, old, doc, ch

        with ThreadPoolExecutor(6) as ex:
            for o, old, doc, ch in ex.map(one, offs):
                try:
                    cid = (old or {}).get('id') or _cid(f['id'], o['oid'])
                    norm = lambda x: json.dumps({k: v for k, v in (x or {}).items() if k not in ('updatedAt', '_rev', 'id')}, sort_keys=True, ensure_ascii=False)
                    if old and norm(old) == norm(doc):
                        same += 1
                    else:
                        store.catalog_put(cid, json.dumps(doc, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
                        added += 0 if old else 1
                        updated += 1 if old else 0
                    for c in ch:
                        (price_ch if c[0] == 'rrc' else stock_ch).append({'id': cid, 'name': doc.get('name'), 'old': c[1], 'new': c[2]})
                except Exception as e:
                    errors.append('%s: %s' % (o['name'][:60], e))
                j['done'] += 1
        save()
        res = {'at': _now(), 'kind': 'import', 'by': by, 'total': len(offs), 'added': added, 'updated': updated, 'same': same,
               'price': price_ch[:300], 'stock': stock_ch[:300], 'errors': errors[:50]}
        _log_add(store, f['id'], res)
        _mark(store, f['id'], 'import', res)
        j.update(state='done', result=res, msg='Добавлено %d, обновлено %d' % (added, updated))
        return res
    except Exception as e:
        j.update(state='error', msg=str(e)[:300])
        _log_add(store, f['id'], {'at': _now(), 'kind': 'import', 'by': by, 'error': str(e)[:300]})
        log('Фид %s: %s' % (f['id'], e))
        raise


def check_feed(store, f, by='', log=print):
    """Ежедневная проверка: РРЦ и наличие связанных позиций каталога; позиции, пропавшие из фида, — «нет в фиде»."""
    j = _job(f['id'], 'check')
    try:
        feed = load(store, f, fresh=True)
        by_oid = {o['oid']: o for o in feed['offers']}
        docs = _feed_docs(store, f['id'])
        j['total'] = len(docs)
        today = date.today().isoformat()
        price_ch, stock_ch, gone, upd = [], [], [], 0
        for d in docs:
            o = by_oid.get(d['feed'].get('oid'))
            before = json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost')], sort_keys=True)
            if o:
                ch = _price_part(d, o, f, today)
                for c in ch:
                    (price_ch if c[0] == 'rrc' else stock_ch).append({'id': d['id'], 'name': d.get('name'), 'old': c[1], 'new': c[2]})
            else:
                s = d.get('stock') or {}
                if not s.get('gone'):
                    gone.append({'id': d['id'], 'name': d.get('name')})
                d['stock'] = dict(s, available=False, gone=True, at=today)
            if json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost')], sort_keys=True) != before:
                d['updatedAt'] = _now()
                store.catalog_put(d['id'], json.dumps(d, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
                upd += 1
            j['done'] += 1
        linked = {d['feed'].get('oid') for d in docs}
        skip = {k for k, v in (f.get('cats') or {}).items() if v == 'skip'}
        new = [o for o in feed['offers'] if o['oid'] not in linked and o['cat'] not in skip]
        res = {'at': _now(), 'kind': 'check', 'by': by, 'checked': len(docs), 'updated': upd, 'price': price_ch[:300], 'stock': stock_ch[:300],
               'gone': gone[:300], 'new': len(new), 'newSample': [o['name'] for o in new[:10]]}
        _log_add(store, f['id'], res)
        _mark(store, f['id'], 'check', res)
        j.update(state='done', result=res, msg='РРЦ изменилась: %d, наличие: %d' % (len(price_ch), len(stock_ch)))
        return res
    except Exception as e:
        j.update(state='error', msg=str(e)[:300])
        _log_add(store, f['id'], {'at': _now(), 'kind': 'check', 'by': by, 'error': str(e)[:300]})
        log('Фид %s: %s' % (f['id'], e))
        raise


def _mark(store, fid, kind, res):
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.setdefault('last', {})[kind] = {k: res.get(k) for k in ('at', 'added', 'updated', 'same', 'checked', 'new', 'total')}
            x['last'][kind]['priceChanges'] = len(res.get('price') or [])
            x['last'][kind]['stockChanges'] = len(res.get('stock') or [])
            x['last'][kind]['gone'] = len(res.get('gone') or [])
    store.kv_set(KV, {'items': items})


def run_bg(fn, *a, **k):
    t = threading.Thread(target=lambda: _safe(fn, *a, **k), daemon=True, name='feed')
    t.start()
    return t


def _safe(fn, *a, **k):
    try:
        fn(*a, **k)
    except Exception:
        pass


def auto_check(store, log=print):
    """Раз в день (после 6 утра): РРЦ и наличие по всем фидам с автопроверкой."""
    if datetime.now().hour < 6:
        return
    today = date.today().isoformat()
    for f in feeds(store):
        if not f.get('auto') or busy(f['id']):
            continue
        if ((f.get('last') or {}).get('check') or {}).get('at', '')[:10] == today:
            continue
        if not _feed_docs(store, f['id']):
            continue
        try:
            check_feed(store, f, 'автопроверка', log)
        except Exception:
            pass


def status(store):
    out = []
    for f in feeds(store):
        j = JOBS.get(f['id'])
        out.append(dict(f, job=j, linked=len(_feed_docs(store, f['id']))))
    return out
