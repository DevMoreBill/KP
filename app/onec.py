"""1С по OData (стандартный интерфейс публикации базы): поступления на расчётный счёт → «оплата заказчика получена» в
исполнении сделки. Совпадение — по ИНН плательщика и номеру КП / счёта в назначении платежа, иначе по сумме оплаты."""

import base64
import json
import re
import urllib.parse
from datetime import date, timedelta
from typing import Any, ClassVar

from crm import DealBook
from crm_exec import ExecBook, ExecPlan, Sums
from net import Net


class OneCConf:
    """Подключение к 1С: адрес публикации, логин, пароль (только в базе программы), включение, автозагрузка, глубина."""

    KEY = 'onec'
    URL = re.compile(r'^https?://[^\s/?#]+(/[^\s?#]*)?$')
    TEXT_MAX = 200
    DAYS = 30
    DAYS_MAX = 365
    MASK = '••••••'

    def __init__(self, store) -> None:
        self.store = store

    def get(self) -> dict:
        own = self.store.kv_get(self.KEY) or {}
        own = own if isinstance(own, dict) else {}
        return {
            'url': str(own.get('url') or ''),
            'login': str(own.get('login') or ''),
            'password': str(own.get('password') or ''),
            'on': bool(own.get('on')),
            'auto': bool(own.get('auto')),
            'days': int(own.get('days') or self.DAYS),
            'last': own.get('last') or None,
        }

    def public(self) -> dict:
        """Для «Настроек»: пароль не уходит из сервера — только «задан»."""
        conf = self.get()
        conf['password'] = self.MASK if conf['password'] else ''
        return conf

    def save(self, data: dict) -> dict:
        if not isinstance(data, dict):
            raise ValueError('Нужны настройки подключения')
        conf = self.get()
        url = str(data.get('url') or '').strip().rstrip('/')
        if url and not self.URL.match(url):
            raise ValueError('Адрес публикации 1С — вида http://сервер/база (как в браузере)')
        password = str(data.get('password') or '')
        days = data.get('days', conf['days'])
        if not isinstance(days, int) or not 1 <= days <= self.DAYS_MAX:
            raise ValueError(f'Глубина загрузки — от 1 до {self.DAYS_MAX} дней')
        conf.update(
            url=url[: self.TEXT_MAX],
            login=str(data.get('login') or '').strip()[: self.TEXT_MAX],
            on=bool(data.get('on')) and bool(url),
            auto=bool(data.get('auto')),
            days=days,
        )
        if password and password != self.MASK:
            conf['password'] = password[: self.TEXT_MAX]
        self.store.kv_set(self.KEY, conf)
        return self.public()

    def last(self, result: dict) -> None:
        conf = self.get()
        conf['last'] = result
        self.store.kv_set(self.KEY, conf)


class OneCApi:
    """Запросы к стандартному интерфейсу OData публикации 1С (только чтение)."""

    ODATA = '/odata/standard.odata/'
    PAYMENTS = 'Document_ПоступлениеНаРасчетныйСчет'
    PARTNERS = 'Catalog_Контрагенты'
    BATCH = 20
    TIMEOUT = 30

    def __init__(self, conf: dict, request=None) -> None:
        self.conf = conf
        self.request = request or Net.request

    def _root(self) -> str:
        url = self.conf['url'].rstrip('/')
        return url + '/' if url.endswith('/standard.odata') else url + self.ODATA

    def get(self, entity: str, params: dict) -> list:
        query = urllib.parse.urlencode({**params, '$format': 'json'}, quote_via=urllib.parse.quote)
        url = self._root() + urllib.parse.quote(entity) + '?' + query
        token = base64.b64encode('{}:{}'.format(self.conf['login'], self.conf['password']).encode()).decode()
        raw = self.request(
            url, headers={'Authorization': 'Basic ' + token, 'Accept': 'application/json'}, timeout=self.TIMEOUT
        )
        data = json.loads(raw.decode('utf-8-sig'))
        return data.get('value') or [] if isinstance(data, dict) else []

    def check(self) -> None:
        self.get(self.PARTNERS, {'$top': '1', '$select': 'Ref_Key'})

    def payments(self, since: date) -> list:
        stamp = since.isoformat() + 'T00:00:00'
        return self.get(
            self.PAYMENTS,
            {
                '$filter': f"Date ge datetime'{stamp}' and Posted eq true",
                '$select': 'Ref_Key,Number,Date,СуммаДокумента,Контрагент_Key,НазначениеПлатежа',
            },
        )

    def inns(self, keys: list) -> dict:
        """{Ref_Key контрагента: ИНН}."""
        out: dict = {}
        unique = [key for key in dict.fromkeys(keys) if re.match(r'^[0-9a-f-]{36}$', str(key or ''))]
        for start in range(0, len(unique), self.BATCH):
            part = unique[start : start + self.BATCH]
            flt = ' or '.join(f"Ref_Key eq guid'{key}'" for key in part)
            for row in self.get(self.PARTNERS, {'$filter': flt, '$select': 'Ref_Key,ИНН'}):
                out[row.get('Ref_Key')] = str(row.get('ИНН') or '').strip()
        return out


class OneCSync:
    """Загрузка поступлений: каждое — один раз (помнит номера), совпавшее с оплатой клиента отмечает её полученной."""

    SEEN = 'onecSeen'
    SEEN_MAX = 5000
    AUTHOR = '1С'
    TOLERANCE = 0.005
    SKIP: ClassVar[tuple] = ('lost',)

    def __init__(self, store, api: OneCApi | None = None) -> None:
        self.store = store
        self.conf = OneCConf(store)
        self.api = api or OneCApi(self.conf.get())

    def run(self) -> dict:
        conf = self.conf.get()
        if not conf['url']:
            raise ValueError('Не задан адрес публикации 1С')
        seen = set(self.store.kv_get(self.SEEN) or [])
        pays = [
            pay
            for pay in self.api.payments(date.today() - timedelta(days=conf['days']))
            if pay.get('Ref_Key') not in seen
        ]
        inns = self.api.inns([pay.get('Контрагент_Key') for pay in pays])
        matched: list[dict] = []
        unmatched: list[dict] = []
        for pay in pays:
            hit = self._match(pay, inns.get(pay.get('Контрагент_Key'), ''))
            (matched if hit else unmatched).append(self._brief(pay, inns, hit))
            if hit:
                seen.add(pay['Ref_Key'])
        self.store.kv_set(self.SEEN, list(seen)[-self.SEEN_MAX :])
        result = {'at': date.today().isoformat(), 'checked': len(pays), 'matched': matched, 'unmatched': unmatched[:50]}
        self.conf.last({key: result[key] for key in ('at', 'checked')} | {'matched': len(matched)})
        return result

    def _match(self, pay: dict, inn: str) -> dict | None:
        if not inn:
            return None
        book = DealBook(self.store)
        deals = [
            deal for deal in book.deals(None) if deal.get('clientInn') == inn and deal.get('stage') not in self.SKIP
        ]
        kps = book.kps([deal['id'] for deal in deals])
        purpose = str(pay.get('НазначениеПлатежа') or '')
        amount = float(pay.get('СуммаДокумента') or 0)
        for deal in deals:
            deal['kps'] = kps.get(deal['id'], [])
            step = self._step(deal, purpose, amount)
            if step:
                day = str(pay.get('Date') or '')[:10] or date.today().isoformat()
                ExecBook(self.store).mark(deal['id'], step['key'], day, self.AUTHOR)
                return {'deal': deal['id'], 'title': deal.get('title') or '', 'step': step['label']}
        return None

    def _step(self, deal: dict, purpose: str, amount: float) -> dict | None:
        open_steps = [
            step for step in ExecPlan(deal).steps(Sums.SALES) if step['kind'] == 'cust' and step['state'] != 'done'
        ]
        if not open_steps:
            return None
        numbers = [offer.get('number') for offer in deal['kps'] if offer.get('number')]
        if any(re.search(r'(?<![\w-])' + re.escape(str(num)) + r'(?![\w-])', purpose) for num in numbers):
            return open_steps[0]
        return next(
            (
                step
                for step in open_steps
                if step.get('amount') and abs(step['amount'] - amount) <= step['amount'] * self.TOLERANCE
            ),
            None,
        )

    @staticmethod
    def _brief(pay: dict, inns: dict, hit: dict | None) -> dict[str, Any]:
        return {
            'number': str(pay.get('Number') or '').strip(),
            'date': str(pay.get('Date') or '')[:10],
            'sum': pay.get('СуммаДокумента'),
            'inn': inns.get(pay.get('Контрагент_Key'), ''),
            'purpose': str(pay.get('НазначениеПлатежа') or '')[:200],
            **(hit or {}),
        }

    @classmethod
    def scheduled(cls, store) -> None:
        """Фоновая загрузка — если связь и автозагрузка включены."""
        from features import FeatureAccess

        conf = OneCConf(store).get()
        if conf['on'] and conf['auto'] and FeatureAccess(store).is_on('onec'):
            cls(store).run()
