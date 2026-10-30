"""Цены фида: группы скидок поставщика, привод (частотный или нет), закупка, изменения цен и текст наличия."""

import functools
import re
from typing import Any

from feed_text import parse_number

PERCENT_MAX = 100
CUR_AT = 3
DRIVES = ('any', 'belt', 'direct')
VSD_RX = re.compile(r'\bVSD\b|\bVFD\b|инвертор|частотн|преобразовател\S*\s+частоты|\bINVERS', re.I)


def discount_rules(raw) -> list:
    """Сетка скидок из настроек: не больше 30 правил, у каждого — скидка 0…99 %, категории — id типов программы."""
    out = []
    for rule in raw[:30]:
        if not isinstance(rule, dict):
            continue
        pct = parse_number(rule.get('pct'))
        if pct is None or not 0 < pct < PERCENT_MAX:
            continue
        cats = [str(cat)[:40] for cat in (rule.get('cats') or []) if re.match(r'^[a-z0-9_-]{1,40}$', str(cat))][:40]
        lim = {k: parse_number(rule.get(k)) for k in ('kwMin', 'kwMax')}
        out.append(
            {
                'label': re.sub(r'\s+', ' ', str(rule.get('label') or '')).strip()[:80],
                'cats': cats,
                'kwUnknown': rule.get('kwUnknown') is True,
                'drive': rule.get('drive') if rule.get('drive') in DRIVES else 'any',
                'pct': round(pct, 2),
                'kwMin': lim['kwMin'] if lim['kwMin'] and lim['kwMin'] > 0 else None,
                'kwMax': lim['kwMax'] if lim['kwMax'] and lim['kwMax'] > 0 else None,
            }
        )
    return out


class DriveHints:
    """Подсказки привода из настроек фида (f.driveHints {belt, direct}): серии в названии / листе прайса."""

    @staticmethod
    @functools.lru_cache(maxsize=64)
    def pattern(words) -> re.Pattern | None:
        """«DVK D, IMPETUS» → регулярное выражение по целым словам (разбирается один раз)."""
        parts = [word.strip() for word in re.split(r'[,;\n]', words or '') if word.strip()]
        if not parts:
            return None
        alt = '|'.join(
            r'[\s-]*'.join(re.escape(x) for x in re.split(r'[\s-]+', part))
            for part in sorted(parts, key=len, reverse=True)
        )
        return re.compile(rf'(?<![A-Za-zА-Яа-я0-9])(?:{alt})(?![A-Za-zА-Яа-я])', re.I)

    @classmethod
    def kind(cls, feed, text) -> str:
        """'direct' | 'belt' | '' — прямые раньше ременных: «DVK D» точнее «DVK»."""
        hints = feed.get('driveHints') or {}
        for kind in ('direct', 'belt'):
            regex = cls.pattern(hints.get(kind))
            if regex and regex.search(text):
                return kind
        return ''


def drive_of(doc, feed) -> str:
    """Привод позиции: 'vsd' (частотник), 'direct', 'belt' или '' — не определён."""
    attrs = doc.get('attrs') or {}
    feed_info = doc.get('feed') or {}
    text = ' '.join(
        str(x or '')
        for x in (
            doc.get('name'),
            attrs.get('model'),
            attrs.get('series'),
            feed_info.get('sheet'),
            feed_info.get('path'),
        )
    )
    rows = [
        (str(row.get('k') or ''), str(row.get('v') or ''))
        for group in doc.get('groups') or []
        for row in group.get('rows') or []
    ]
    reg = ' '.join(v for k, v in rows if re.search(r'регулирован|управлени\S* производ|частот', k, re.I))
    if str(attrs.get('vsd') or '').lower() == 'да' or VSD_RX.search(text) or VSD_RX.search(reg):
        return 'vsd'
    kind = DriveHints.kind(feed, text)
    if kind:
        return kind
    drv = ' '.join(v for k, v in rows if re.search(r'привод|передач', k, re.I)).lower()
    if 'ремен' in drv and not re.search(r'прям|муфт|редукт|зубч', drv):
        return 'belt'
    if re.search(r'прям|муфт|редукт|зубч|соосн|коаксиал', drv):
        return 'direct'
    return ''


def _kw_of(doc) -> float | None:
    kw = parse_number((doc.get('attrs') or {}).get('kw'))
    if kw:
        return kw
    for group in doc.get('groups') or []:
        for row in group.get('rows') or []:
            if re.search(r'мощност', str(row.get('k') or ''), re.I) and not re.search(
                r'потребля|охлажд|вентил', str(row.get('k') or ''), re.I
            ):
                match = re.search(
                    r'(\d+(?:[.,]\d+)?)\s*(квт|kw)', str(row.get('v') or '') + ' ' + str(row.get('k') or ''), re.I
                )
                if match:
                    return parse_number(match.group(1))
    return None


def discount_for(feed, doc) -> tuple:
    """Скидка поставщика для позиции по сетке f.discounts (первое подходящее правило), иначе f.discount; → (pct | None, подпись)."""
    pct, label, _ = _disc_pick(feed, doc)
    return pct, label


def _disc_pick(feed, doc) -> tuple:
    """→ (pct | None, подпись, номер правила | None — «остальное»)."""
    attrs = doc.get('attrs') or {}
    cat = attrs.get('cat') or ''
    drive, kw = None, None
    for i, rule in enumerate(feed.get('discounts') or []):
        if rule.get('cats') and cat not in rule['cats']:
            continue
        if rule.get('drive') in ('belt', 'direct'):
            drive = drive_of(doc, feed) if drive is None else drive
            if (drive == 'belt') != (rule['drive'] == 'belt') or not drive:
                continue
        if rule.get('kwMin') or rule.get('kwMax'):
            kw = _kw_of(doc) if kw is None else kw
            if not kw and not rule.get('kwUnknown'):
                continue
            if kw and ((rule.get('kwMin') and kw < rule['kwMin']) or (rule.get('kwMax') and kw > rule['kwMax'])):
                continue
        return rule['pct'], rule.get('label') or '', i
    if feed.get('discount'):
        return feed['discount'], 'Остальное оборудование' if feed.get('discounts') else '', None
    return None, '', None


def _set_cost(doc, kop, cur, feed, changes, offer=None) -> None:
    """Закупка = цена × (1 − скидка по сетке); ручную закупку (costSrc = manual) не трогает; изменение — в список ch."""
    if doc.get('costSrc', 'feed') != 'feed':
        return
    if offer and offer.get('dealer'):
        new = round(offer['dealer'] * 100)
        disc: Any = {
            'pct': round((1 - new / kop) * 100, 1) if kop and new < kop else 0,
            'label': 'дилерская цена по прайсу',
        }
    else:
        pct, label = (
            (offer['disc'], 'скидка дилера по прайсу') if offer and offer.get('disc') else discount_for(feed, doc)
        )
        if pct is None:
            if feed.get('priceKind') != 'cost' or feed.get('kind') != 'files':
                return
            pct = 0
        new = round(kop * (1 - pct / 100))
        disc = {'pct': pct, 'label': label} if pct else None
    if doc.get('cost') and (doc.get('cost') != new or (doc.get('costCur') or 'RUB') != cur):
        changes.append(('cost', doc.get('cost'), new, cur))
    doc['cost'], doc['costCur'], doc['costSrc'] = new, cur, 'feed'
    doc['costDisc'] = disc


def _price_part(doc, offer, feed, today) -> list:
    """РРЦ, наличие, цена КП и закупка позиции по предложению фида; → список изменений [(поле, было, стало, валюта)]."""
    changes: list = []
    if not offer['price'] and offer.get('dealer'):  # в прайсе только цена для дилера (Tewatt)
        _set_cost(doc, 0, offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    elif offer['price'] and feed.get('priceKind') == 'cost':
        _set_cost(doc, round(offer['price'] * 100), offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    elif offer['price']:
        kop = round(offer['price'] * 100)
        rrc = doc.get('rrc') or {}
        if rrc.get('price') != kop or rrc.get('cur') != offer['cur']:
            if rrc.get('price'):
                changes.append(('rrc', rrc.get('price'), kop))
            doc['rrc'] = {
                'price': kop,
                'cur': offer['cur'],
                'at': today,
                'old': round(offer['oldprice'] * 100) if offer.get('oldprice') else None,
                'prev': rrc.get('price'),
                'prevAt': rrc.get('at'),
            }
        else:
            rrc['at'] = today
        if doc.get('priceSrc', 'rrc') == 'rrc' and (
            doc.get('price') != kop or (doc.get('priceCur') or 'RUB') != offer['cur']
        ):
            doc['price'], doc['priceCur'], doc['priceSrc'] = kop, offer['cur'], 'rrc'
        _set_cost(doc, kop, offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    if offer.get('nostock'):  # фид из файлов не знает наличия
        return changes
    stock = doc.get('stock') or {}
    stock_info = dict(
        offer.get('stockInfo') or {}, qty=offer['qty'], available=bool(offer['available']), at=today, gone=False
    )
    if (
        stock.get('qty'),
        bool(stock.get('available')),
        bool(stock.get('gone')),
        stock.get('transit'),
        stock.get('prod'),
    ) != (
        stock_info['qty'],
        stock_info['available'],
        False,
        stock_info.get('transit'),
        stock_info.get('prod'),
    ) and stock:
        changes.append(('stock', _stock_txt(stock), _stock_txt(stock_info)))
    doc['stock'] = stock_info
    return changes


def _change(cid, doc, change) -> dict:
    return {
        'id': cid,
        'name': doc.get('name'),
        'kind': change[0],
        'old': change[1],
        'new': change[2],
        'cur': change[3] if len(change) > CUR_AT else '',
    }


def _stock_txt(stock) -> str:
    if not stock:
        return '—'
    if stock.get('gone'):
        return 'нет в фиде'
    wait = ', '.join(
        part
        for part in (
            'в пути {}{}'.format(_fmt(stock['transit']), f' (до {stock["eta"]})' if stock.get('eta') else '')
            if stock.get('transit')
            else '',
            'в производстве {}'.format(_fmt(stock['prod'])) if stock.get('prod') else '',
        )
        if part
    )
    if stock.get('qty') is not None:
        base = 'в наличии {}'.format(_fmt(stock['qty'])) if stock['qty'] > 0 else 'нет в наличии'
        return base + ('; ' + wait if wait else '')
    return 'в наличии' if stock.get('available') else 'нет в наличии'


def _fmt(num) -> str:
    return str(int(num)) if float(num).is_integer() else str(num).replace('.', ',')
