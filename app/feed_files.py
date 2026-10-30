"""Фид поставщика из файлов (без YML): парс сайта (CSV / JSON) + прайсы (XLSX) + остатки — в предложения фида."""

import hashlib
import os
import re
from datetime import datetime

import images
from defaults import SrvVal
from feed_desc import clean_desc, merge_specs, spec_class
from feed_match import PRESSURE_ALIAS, _num_attr, match_prices, model_cfg, page_cfg, unique_names
from feed_price_file import parse_price
from feed_site import parse_extra, parse_pages
from feed_stock import apply_stock, parse_stock
from genset_sheets import GensetMatch

STD_PRESSURE_MAX = 13
SLUG_MAX = 40

DIR_NAME = 'feeds'


def feed_dir(data_dir: str, fid: str) -> str:
    return os.path.join(data_dir, DIR_NAME, images.slug(fid, 40) or 'feed')


FILE_NAMES = {'pages': 'pages.csv', 'price': 'price.xlsx', 'stock': 'stock.xlsx', 'extra': 'extra.json'}


def file_path(data_dir: str, fid: str, kind, slot=None) -> str:
    """Прайсов у фида может быть несколько — каждый в своём слоте по имени файла."""
    if kind == 'price' and slot and slot != 'price':
        return os.path.join(feed_dir(data_dir, fid), f'price-{images.slug(slot, 40) or "x"}.xlsx')
    return os.path.join(feed_dir(data_dir, fid), FILE_NAMES[kind])


def price_slot(name) -> str:
    """Слот прайса — имя файла без даты и служебных слов."""
    base = re.sub(r'\.[a-z0-9]{2,5}$', '', str(name or '').lower()).replace('_', ' ')
    base = re.sub(r'\d{1,4}[._-]\d{1,2}[._-]\d{1,4}', ' ', base)
    base = re.sub(r'\b(ai|prajs|prais|price|прайс|копия|copy|new|final|rasprodazha|распродажа)\b|\(\d+\)', ' ', base)
    base = re.sub(r'[^a-zа-яё]+', '-', base).strip('-')
    return images.slug(base, 40) or 'price'


def save_file(data_dir: str, fid: str, kind, data, name, slot=None) -> dict:
    """Сохранить файл фида; → мета {name, size, at, …} с итогом разбора (ValueError — файл не читается)."""
    if kind not in FILE_NAMES:
        raise ValueError('Неизвестный вид файла')
    if not data:
        raise ValueError('Файл пустой')
    max_mb = SrvVal.now('cat.feedFileMB')
    if len(data) > max_mb * 1024 * 1024:
        raise ValueError(f'Файл больше {max_mb} МБ (предел — «Настройки → Значения программы»)')
    meta = {'name': str(name or '')[:120], 'size': len(data), 'at': datetime.now().isoformat(timespec='seconds')}
    if kind == 'pages':
        rows = parse_pages(data)
        meta.update(rows=len(rows), cats=len({row['cat'] for row in rows}))
    elif kind == 'extra':
        extra = parse_extra(data)
        meta.update(rows=len(extra['items']), series=len(extra['series']), logos=len(extra['logos']))
    elif kind == 'stock':
        rows = parse_stock(data)
        meta.update(
            rows=len(rows),
            inStock=sum(1 for row in rows if row['qty'] > 0),
            units=sum(row['qty'] for row in rows),
            whs=sorted({wh_name for row in rows for wh_name in (row.get('wh') or {})})[:20],
        )
    else:
        rows, sheets = parse_price(data)
        meta.update(
            rows=len(rows),
            sheets=len(sheets),
            withPrice=sum(1 for row in rows if row['price'] or row.get('dealer')),
            cur=next((row['cur'] for row in rows if row.get('cur')), ''),
            slot=slot or 'price',
            sheetCurs=[{'name': x['name'], 'rows': x['rows'], 'cur': x['cur']} for x in sheets][:40],
        )
    folder = feed_dir(data_dir, fid)
    os.makedirs(folder, exist_ok=True)
    path = file_path(data_dir, fid, kind, slot)
    with open(path + '.tmp', 'wb') as handle:
        handle.write(data)
    os.replace(path + '.tmp', path)
    return meta


def read_file(data_dir: str, fid: str, kind, slot=None) -> bytes | None:
    path = file_path(data_dir, fid, kind, slot)
    if not os.path.exists(path):
        return None
    with open(path, 'rb') as handle:
        return handle.read()


def drop_file(data_dir: str, fid: str, kind, slot=None) -> None:
    try:
        os.remove(file_path(data_dir, fid, kind, slot))
    except OSError:
        pass


def remove_files(data_dir: str, fid: str) -> None:
    folder = feed_dir(data_dir, fid)
    names = os.listdir(folder) if os.path.isdir(folder) else []
    for name in names:
        if re.match(r'^(pages\.csv|price(-[a-z0-9_-]+)?\.xlsx|stock\.xlsx|extra\.json)(\.tmp)?$', name):
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
    try:
        os.rmdir(folder)
    except OSError:
        pass


def _param(k) -> tuple:
    """«Давление (бар)» → («Давление», «бар»); «Мощность, кВт» разберёт feeds._param_name."""
    match = re.match(r'^(.*\S)\s*\(([^()]{1,12})\)$', k)
    return (match.group(1), match.group(2)) if match else (k, '')


def _price_specs_ok(page, price) -> list:
    """Характеристики строки прайса без явных ошибок (давление не из названия и т. п.)."""
    if not price:
        return []
    pressure = page_cfg(page)['p']
    out = []
    for k, v in price['specs']:
        if pressure and spec_class(k) == 'pressure':
            num = _num_attr(re.sub(r'[^\d,.]', '', str(v)).replace(',', '.') or None)
            if num and PRESSURE_ALIAS.get(num, num) != PRESSURE_ALIAS.get(pressure, pressure):
                continue
        out.append((k, v))
    return out


def build_feed(feed, pages, prices, param_name, stock=None) -> dict:
    """→ {shop, date, cats, offers} как у feeds.parse(): позиции парса с ценой из прайса."""
    pages = unique_names(pages)
    if prices and prices[0].get('genset'):  # прайс-склад ДГУ: по модели, исполнению и альтернатору
        hit, stats = GensetMatch.pages(pages, prices)
    else:
        hit, stats = (
            match_prices(pages, prices) if prices else ({}, {'matched': 0, 'how': {}, 'priceOnly': len(prices)})
        )
    cats: dict = {}
    offers: dict = {}
    maker = (
        re.split(r'[,;]', feed.get('maker') or '')[0]
    ).strip()  # «EXELUTE, LUPAMAT» — у позиции своя марка из парса
    cur0 = (feed.get('cur') or '').upper()
    for page in pages:
        cid = 'site-' + (images.slug(page['cat'], 40) or 'other')
        cats.setdefault(cid, {'id': cid, 'name': page['cat'], 'parent': '', 'path': page['cat']})
        price = hit.get(page['url'])
        params = []
        for k, v in merge_specs(page['chars'], _price_specs_ok(page, price)):
            param_key, u = _param(k)
            param_key, u = param_name(param_key, u)
            if u == 'дюйм' and re.search(
                r'["“”\']|\bDN\b|\bG\s*\d', v
            ):  # «2"», «DN 50», «G 1/2» — единица уже в значении
                u = ''
            params.append({'k': param_key[:60], 'u': u, 'v': v})
        oid = _oid(page['url'].rstrip('/').rsplit('/', 1)[-1] or page['name'], page['url'], offers)
        offer = _offer(
            oid,
            page['name'],
            cid,
            page['cat'],
            page['url'],
            page['pictures'],
            clean_desc(page['desc']),
            params,
            page.get('brand') or maker,
            page['model'],
            price,
            cur0,
        )
        # начало описания называет вид («Адсорбционный осушитель …») — по нему точнее определяется категория программы
        offer['crumbs'] = page['cat'] + ' / ' + re.sub(r'[|/]', ' ', page['desc'][:120])
        offers[oid] = offer
    if feed.get('priceOnly') and prices:
        used = {id(price_rec) for price_rec in hit.values()}
        for price_rec in prices:
            if id(price_rec) in used or not price_rec['price']:
                continue
            cid = 'price-' + (images.slug(price_rec['sheet'], 40) or 'sheet')
            cats.setdefault(
                cid,
                {
                    'id': cid,
                    'name': price_rec['sheet'],
                    'parent': '',
                    'path': 'Прайс / ' + (price_rec['title'] or price_rec['sheet']),
                },
            )
            oid = _oid(
                'p-' + (price_rec['sku'] or price_rec['name']), price_rec['sheet'] + '|' + price_rec['name'], offers
            )
            params = []
            for k, v in merge_specs([], price_rec['specs']):
                param_key, u = param_name(k, '')
                params.append({'k': param_key[:60], 'u': u, 'v': v})
            offers[oid] = _offer(
                oid,
                price_rec['name'],
                cid,
                price_rec['sheet'],
                '',
                [],
                '',
                params,
                maker,
                price_rec['short'],
                price_rec,
                cur0,
            )
    offs = list(offers.values())
    logos: dict = {}  # логотипы марок из JSON-парса: {марка: kpa:…}
    for page in pages:
        if page.get('logo'):
            logos.setdefault(page.get('brand') or maker, page['logo'])
    genset = bool(prices and prices[0].get('genset'))
    if stock:  # загруженный файл остатков — всем, кроме позиций, наличие которых дал сам прайс-склад ДГУ
        stats['stock'] = apply_stock([offer for offer in offs if not (genset and offer.get('stockInfo'))], stock)
    if genset:
        GensetMatch.unpriced(offs)
    return {
        'shop': feed.get('name') or '',
        'date': '',
        'cats': cats,
        'offers': offs,
        'match': stats,
        'prices': prices,
        'stock': stock,
        'logos': logos,
    }


def card_attrs(cfg, attrs) -> dict:
    """Исполнение карточки каталога (model_cfg) дополняется её полями: частотник, осушитель, объём ресивера; → cfg."""
    attr_map = attrs or {}
    if str(attr_map.get('vsd') or '').lower() == 'да':
        cfg['vsd'] = True
    if str(attr_map.get('dryer') or '').lower() == 'да':
        cfg['dry'] = True
    rec = _num_attr(re.sub(r'[\s\xa0]', '', str(attr_map.get('receiver'))))  # «1 000» л
    if rec and cfg['rec'] in (None, -1):
        cfg['rec'] = int(rec)
    return cfg


def match_card(name, model, attrs, prices) -> tuple:
    """Ручная карточка → строки прайса того же исполнения; → (строки, причина-если-нет)."""
    if prices and prices[0].get('genset'):
        return GensetMatch.card(name, model, attrs or {}, prices)
    cfg = card_attrs(model_cfg(model or name, name), attrs)
    attr_map = attrs or {}
    if not cfg['ser'] or cfg['size'] is None:
        return [], 'не понятна модель'
    cand = []
    for price in prices:
        price_col = price.get(
            '_cfg'
        )  # исполнение строки прайса разбирается один раз (match_prices или первая карточка)
        if price_col is None:
            price_col = price['_cfg'] = model_cfg(price['name'] or price['short'])
        if (
            price_col['ser'] != cfg['ser']
            or price_col['size'] != cfg['size']
            or price_col['vsd'] != cfg['vsd']
            or price_col['w'] != cfg['w']
            or price_col['dry'] != cfg['dry']
        ):
            continue
        if (cfg['rec'] is None) != (price_col['rec'] is None) or (
            cfg['rec'] not in (None, -1) and price_col['rec'] != cfg['rec']
        ):
            continue
        cand.append((price, price_col))
    if not cand:
        return [], 'нет в прайсе'
    pressure_val = cfg.get('p') or _num_attr(attr_map.get('pressure'))
    std = [(price, price_col) for price, price_col in cand if not price_col['p'] or price_col['p'] <= STD_PRESSURE_MAX]
    if std and not (pressure_val and pressure_val > STD_PRESSURE_MAX):
        cand = std
    priced = [(price, price_col) for price, price_col in cand if price['price']]
    if not priced:
        return [price for price, _ in cand], 'в прайсе без цены'
    if len({price['price'] for price, _ in priced}) > 1:
        by_p = [(price, price_col) for price, price_col in priced if pressure_val and price_col['p'] == pressure_val]
        if len({price['price'] for price, _ in by_p}) == 1:
            return [price for price, _ in by_p], ''
        return [price for price, _ in priced], 'разные цены у исполнений'
    return [price for price, _ in priced], ''


def _oid(base, uniq, offers) -> str:
    """Идентификатор предложения ≤ 40 знаков (feeds._cid режет длиннее) и без повторов: длинные похожие ссылки — с хвостом-хэшем."""
    oid = images.slug(base, 40) or 'item'
    if oid in offers or len(images.slug(base, 60)) > SLUG_MAX:
        oid = (
            images.slug(base, 32) + '-' + hashlib.md5(uniq.encode('utf-8'), usedforsecurity=False).hexdigest()[:7]
        ).strip('-')
    return oid


def _offer(oid, name, cid, path, url, pictures, desc, params, maker, model, price, cur0) -> dict:
    return {
        'oid': oid,
        'name': name[:300],
        'cat': cid,
        'path': path,
        'url': url,
        'price': price['price'] if price else None,
        'oldprice': None,
        'cur': (price['cur'] if price and price.get('cur') else cur0) or 'EUR',
        'vendor': maker,
        'dealer': price.get('dealer') if price else None,
        'disc': price.get('disc') if price else None,
        'priceFile': price.get('file') if price else '',
        'model': model or (price['short'] if price else '') or '',
        'sku': price['sku'] if price else '',
        'barcode': '',
        'pictures': pictures,
        'desc': desc,
        'params': params,
        'available': True,
        'qty': None,
        'nostock': True,
        'authoritative': True,
        'weight': None,
        'dims': '',
        'notes': '',
        'opts': [{'name': opt_name, 'price': v} for opt_name, v in (price['opts'] if price else [])],
        'sheet': price['sheet'] if price else '',
        **_row_stock(price),
    }


def _row_stock(price) -> dict:
    """Наличие из самой строки прайса (прайс-склад ДГУ); без файла остатков."""
    info = price.get('stockInfo') if price else None
    return {'stockInfo': info, 'qty': info['qty'], 'available': info['available'], 'nostock': False} if info else {}
