"""Курсы валют ЦБ РФ: cbr.ru, резерв — зеркало cbr-xml-daily.ru (системный прокси Windows используется автоматически)."""

import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

from net import Net

CURRENCIES = ('USD', 'EUR', 'CNY')


def http_get(url: str, headers: dict | None = None) -> bytes:
    return Net.request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'}, timeout=15, limit=Net.LIMIT)


def cbr_rates() -> dict:
    err = []
    # 1) официальный сайт ЦБ РФ
    try:
        root = ET.fromstring(http_get('https://www.cbr.ru/scripts/XML_daily.asp'))
        d = root.get('Date')
        res = {'date': f'{d[6:10]}-{d[3:5]}-{d[0:2]}', 'src': 'ЦБ РФ (cbr.ru)'}
        for v in root.findall('Valute'):
            code = v.findtext('CharCode')
            if code in CURRENCIES:
                res[code] = float(v.findtext('Value').replace(',', '.')) / float(
                    v.findtext('Nominal').replace(',', '.')
                )
        return res
    except Exception as e:
        err.append(str(e))
    # 2) зеркало данных ЦБ
    try:
        j = json.loads(http_get('https://www.cbr-xml-daily.ru/daily_json.js').decode('utf-8-sig'))
        res = {'date': j['Date'][:10], 'src': 'ЦБ РФ (зеркало cbr-xml-daily.ru)'}
        for c in CURRENCIES:
            v = j.get('Valute', {}).get(c)
            if v:
                res[c] = float(v['Value']) / float(v['Nominal'])
        return res
    except Exception as e:
        err.append(str(e))
    return {'error': '; '.join(err)}


_KEY_CACHE: dict = {}
KEY_TTL = 6 * 3600
KEY_HISTORY_DAYS = 400


def parse_key_rate_xml(data: str) -> tuple[str, float] | None:
    """Ответ KeyRateXML → (дата, ставка %) последнего значения."""
    best = None
    for kr in re.findall(r'<KR>(.*?)</KR>', data, re.S):
        dt = re.search(r'<DT>(\d{4}-\d{2}-\d{2})', kr)
        rt = re.search(r'<Rate>([\d.,]+)</Rate>', kr)
        if dt and rt:
            item = (dt.group(1), float(rt.group(1).replace(',', '.')))
            if not best or item[0] > best[0]:
                best = item
    return best


def parse_key_rate_html(html: str) -> tuple[str, float] | None:
    """Таблица cbr.ru/hd_base/KeyRate → (дата, ставка %) последнего значения."""
    best = None
    for d, m, y, rate in re.findall(r'<td>\s*(\d{2})\.(\d{2})\.(\d{4})\s*</td>\s*<td>\s*([\d,.]+)\s*</td>', html):
        item = (f'{y}-{m}-{d}', float(rate.replace(',', '.')))
        if not best or item[0] > best[0]:
            best = item
    return best


def cbr_key_rate() -> dict:
    """{rate, date, src} или {error}; кэш — KEY_TTL."""
    c = _KEY_CACHE.get('v')
    if c and time.time() - c[0] < KEY_TTL:
        return c[1]
    err = []
    today = datetime.now()
    since = today - timedelta(days=KEY_HISTORY_DAYS)
    frm, to = since.strftime('%Y-%m-%d'), today.strftime('%Y-%m-%d')
    # 1) веб-сервис ЦБ (SOAP)
    try:
        body = (
            '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
            f'<soap:Body><KeyRateXML xmlns="http://web.cbr.ru/"><fromDate>{frm}</fromDate><ToDate>{to}</ToDate></KeyRateXML>'
            '</soap:Body></soap:Envelope>'
        ).encode()
        raw = Net.request(
            'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx',
            data=body,
            timeout=15,
            retries=1,
            headers={
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '"http://web.cbr.ru/KeyRateXML"',
                'User-Agent': 'Mozilla/5.0',
            },
        )
        got = parse_key_rate_xml(raw.decode('utf-8', 'replace'))
        if got:
            res = {'date': got[0], 'rate': got[1], 'src': 'ЦБ РФ (cbr.ru)'}
            _KEY_CACHE['v'] = (time.time(), res)
            return res
        err.append('веб-сервис ЦБ: нет данных')
    except Exception as e:
        err.append(f'веб-сервис ЦБ: {e}')
    # 2) страница ключевой ставки на сайте ЦБ
    try:
        a, b = since.strftime('%d.%m.%Y'), today.strftime('%d.%m.%Y')
        url = f'https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From={a}&UniDbQuery.To={b}'
        got = parse_key_rate_html(http_get(url).decode('utf-8', 'replace'))
        if got:
            res = {'date': got[0], 'rate': got[1], 'src': 'ЦБ РФ (cbr.ru/hd_base)'}
            _KEY_CACHE['v'] = (time.time(), res)
            return res
        err.append('страница ЦБ: нет данных')
    except Exception as e:
        err.append(f'страница ЦБ: {e}')
    return {'error': '; '.join(err)}
