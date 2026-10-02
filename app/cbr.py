# -*- coding: utf-8 -*-
"""Курсы валют ЦБ РФ: cbr.ru, резерв — зеркало cbr-xml-daily.ru (системный прокси Windows используется автоматически)."""
import json
import re
import time
import urllib.request
from datetime import datetime, timedelta
import xml.etree.ElementTree as ET

CURRENCIES = ('USD', 'EUR', 'CNY')


def http_get(url, headers=None):
    # urllib берёт системный прокси Windows, а SSL-сертификаты — из хранилища Windows
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def cbr_rates():
    err = []
    # 1) официальный сайт ЦБ РФ
    try:
        root = ET.fromstring(http_get('https://www.cbr.ru/scripts/XML_daily.asp'))  # windows-1251 из заголовка XML
        d = root.get('Date')
        res = {'date': '%s-%s-%s' % (d[6:10], d[3:5], d[0:2]), 'src': 'ЦБ РФ (cbr.ru)'}
        for v in root.findall('Valute'):
            code = v.findtext('CharCode')
            if code in CURRENCIES:
                res[code] = float(v.findtext('Value').replace(',', '.')) / float(v.findtext('Nominal').replace(',', '.'))
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


# ---------- ключевая ставка ЦБ РФ (для стоимости денег в «Экономике сделки») ----------
_KEY_CACHE = {}


def parse_key_rate_xml(data):
    """Ответ веб-сервиса ЦБ KeyRateXML → (дата 'ГГГГ-ММ-ДД', ставка %) последнего значения или None."""
    best = None
    for kr in re.findall(r'<KR>(.*?)</KR>', data, re.S):
        dt = re.search(r'<DT>(\d{4}-\d{2}-\d{2})', kr)
        rt = re.search(r'<Rate>([\d.,]+)</Rate>', kr)
        if dt and rt:
            item = (dt.group(1), float(rt.group(1).replace(',', '.')))
            if not best or item[0] > best[0]:
                best = item
    return best


def parse_key_rate_html(html):
    """Таблица на странице cbr.ru/hd_base/KeyRate → (дата, ставка %) последнего значения или None."""
    best = None
    for d, m, y, rate in re.findall(r'<td>\s*(\d{2})\.(\d{2})\.(\d{4})\s*</td>\s*<td>\s*([\d,.]+)\s*</td>', html):
        item = ('%s-%s-%s' % (y, m, d), float(rate.replace(',', '.')))
        if not best or item[0] > best[0]:
            best = item
    return best


def cbr_key_rate():
    """Ключевая ставка ЦБ РФ: {'rate': 16.5, 'date': 'ГГГГ-ММ-ДД', 'src': …} или {'error': …}; кэш — 6 часов."""
    c = _KEY_CACHE.get('v')
    if c and time.time() - c[0] < 6 * 3600:
        return c[1]
    err = []
    today = datetime.now()
    frm = (today - timedelta(days=400)).strftime('%Y-%m-%d')
    to = today.strftime('%Y-%m-%d')
    # 1) веб-сервис ЦБ (SOAP)
    try:
        body = ('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
                '<soap:Body><KeyRateXML xmlns="http://web.cbr.ru/"><fromDate>%s</fromDate><ToDate>%s</ToDate></KeyRateXML>'
                '</soap:Body></soap:Envelope>' % (frm, to)).encode('utf-8')
        req = urllib.request.Request('https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', data=body, headers={
            'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"http://web.cbr.ru/KeyRateXML"', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            got = parse_key_rate_xml(r.read().decode('utf-8', 'replace'))
        if got:
            res = {'date': got[0], 'rate': got[1], 'src': 'ЦБ РФ (cbr.ru)'}
            _KEY_CACHE['v'] = (time.time(), res)
            return res
        err.append('веб-сервис ЦБ: нет данных')
    except Exception as e:
        err.append('веб-сервис ЦБ: %s' % e)
    # 2) страница ключевой ставки на сайте ЦБ
    try:
        url = ('https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=%s&UniDbQuery.To=%s'
               % (datetime.strptime(frm, '%Y-%m-%d').strftime('%d.%m.%Y'), today.strftime('%d.%m.%Y')))
        got = parse_key_rate_html(http_get(url).decode('utf-8', 'replace'))
        if got:
            res = {'date': got[0], 'rate': got[1], 'src': 'ЦБ РФ (cbr.ru/hd_base)'}
            _KEY_CACHE['v'] = (time.time(), res)
            return res
        err.append('страница ЦБ: нет данных')
    except Exception as e:
        err.append('страница ЦБ: %s' % e)
    return {'error': '; '.join(err)}
