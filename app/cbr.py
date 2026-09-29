# -*- coding: utf-8 -*-
"""Курсы валют ЦБ РФ: cbr.ru, резерв — зеркало cbr-xml-daily.ru (системный прокси Windows используется автоматически)."""
import json
import urllib.request
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
