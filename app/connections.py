"""«Проверить все подключения»: лёгкий запрос к каждому внешнему сервису без трат платных лимитов."""

import functools
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

import imgfetch

SAMPLE_INN = '7707083893'  # ПАО Сбербанк — для проверки сервисов реквизитов
SAMPLE_BO_INN = '7713140469'  # АО «Лаборатория Касперского» — для ГИР БО (банков там нет: они отчитываются в ЦБ)
SAMPLE_PLACE = {'l': 1.2, 'w': 1.0, 'h': 1.0, 'm': 0.3, 'qty': 1}


class ConnectionCheck:
    TIMEOUT = 45
    FEED_TIMEOUT = 20
    CHECKO = 'https://api.checko.ru/'
    OFDATA = 'https://api.ofdata.ru/'

    def __init__(self, store, data_dir: str, root: str) -> None:
        self.store, self.data_dir, self.root = store, data_dir, root

    def run(self) -> dict:
        jobs = [
            ('mail', 'Почта', 'Почтовый сервер (SMTP)', 'mail', self._mail),
            ('ai', 'Нейросеть', 'Нейросеть для «Заполнить с ИИ»', 'ai', self._neural),
            ('cbr', 'Курсы и ставки', 'ЦБ РФ — курсы валют', 'defaults', self._cbr),
            ('fns', 'Контрагенты', 'ФНС (реквизиты без ключа)', 'keys', self._fns),
            ('dadata', 'Контрагенты', 'DaData', 'keys', self._dadata),
            ('checko', 'Контрагенты', 'Checko', 'keys', self._checko),
            ('ofdata', 'Контрагенты', 'OFData — резерв Checko', 'keys', self._ofdata),
            ('girbo', 'Контрагенты', 'ГИР БО ФНС — бухотчётность без ключа', 'keys', self._girbo),
            ('carriers', 'Доставка', 'Перевозчики — пробный расчёт Москва → Санкт-Петербург', 'keys', self._carriers),
            ('github', 'Обновления', 'GitHub — новая версия программы', 'updates', self._github),
            ('pdf', 'Документы', 'Сохранение КП в PDF', 'keys', self._pdf),
            ('bitrix', 'CRM', 'Битрикс24 — сделки и дела', 'services', self._bitrix),
        ]
        jobs += [
            ('feed:' + entry['id'], 'Фиды поставщиков', entry['name'], 'feeds', functools.partial(self._feed, entry))
            for entry in (self.store.kv_get('feeds') or {}).get('items', [])
            if entry.get('id') and entry.get('url')
        ]
        res = {}

        def one(jid, func):
            started = time.time()
            try:
                status, msg = func()
            except Exception as exc:
                status, msg = 'fail', self._err(exc)
            res[jid] = (status, msg, int((time.time() - started) * 1000))

        threads = [threading.Thread(target=one, args=(j[0], j[4]), daemon=True) for j in jobs]
        for thread in threads:
            thread.start()
        end = time.time() + self.TIMEOUT
        for thread in threads:
            thread.join(max(0.1, end - time.time()))
        out = []
        for jid, group, name, tab, _func in jobs:
            state, msg, took_ms = res.get(jid, ('fail', f'нет ответа за {self.TIMEOUT} с', self.TIMEOUT * 1000))
            out.append(
                {'id': jid, 'group': group, 'name': name, 'status': state, 'msg': msg, 'ms': took_ms, 'tab': tab}
            )
        rec = {'at': datetime.now().isoformat(timespec='seconds'), 'items': out}
        self.store.kv_set('connCheck', rec)
        return rec

    def last(self) -> dict:
        return self.store.kv_get('connCheck') or {}

    @staticmethod
    def _err(exc: BaseException) -> str:
        text = str(exc) or type(exc).__name__
        if hasattr(exc, 'code') and hasattr(exc, 'reason'):
            text = f'HTTP {exc.code} {exc.reason}'
        return text[:240]

    def _keys(self) -> dict:
        return self.store.kv_get('integrations') or {}

    # ---------- проверки ----------
    def _mail(self):
        mail = self.store.kv_get('mail') or {}
        if not mail.get('host'):
            return 'off', 'не настроена — «КП и документы → Почта для отправки КП»'
        host, port, sec = mail['host'], int(mail.get('port') or 465), mail.get('security') or 'ssl'
        srv = (
            smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context())
            if sec == 'ssl'
            else smtplib.SMTP(host, port, timeout=20)
        )
        with srv:
            if sec == 'starttls':
                srv.starttls(context=ssl.create_default_context())
            if mail.get('login'):
                try:
                    srv.login(mail['login'], mail.get('password') or '')
                except smtplib.SMTPAuthenticationError:
                    return 'fail', f'сервер {host} не принял логин или пароль'
        return 'ok', f'вход на {host}:{port} выполнен (письмо не отправлялось)'

    def _bitrix(self):
        from bitrix import BitrixConf, BitrixQueue

        conf = BitrixConf(self.store)
        if not conf.get().get('url'):
            return 'off', 'не настроен — «Подключения и ключи → Битрикс24»'
        profile = conf.api().call('profile') or {}
        queue = BitrixQueue(self.store).stats()
        if not conf.enabled():
            return 'warn', f'связь есть ({profile.get("NAME") or "вебхук"}), обмен выключен'
        failed = f', с ошибкой {queue["failed"]}' if queue['failed'] else ''
        return ('warn' if queue['failed'] else 'ok'), f'связь есть; в очереди {queue["queued"]}{failed}'

    def _neural(self):
        import ai_llm

        status = ai_llm.status(self.store)
        if not ai_llm.api_key(self.store):
            return 'off', 'ключ не задан — «Внешние сервисы → Нейросеть»'
        reply = ai_llm.ask(self.store, 'Ответь одним словом: да', force=True)
        return ('ok' if status.get('enabled') else 'warn'), 'модель {} отвечает{}'.format(
            reply.get('model') or '',
            '' if status.get('enabled') else '; у менеджеров выключена',
        )

    def _cbr(self):
        import cbr

        res = cbr.cbr_rates() or {}
        if res.get('error'):
            return 'fail', res['error'][:240]
        usd = res.get('USD')
        return (
            ('ok', 'USD {} ₽ на {} · {}'.format((f'{usd:.2f}').replace('.', ','), res.get('date'), res.get('src')))
            if usd
            else ('warn', 'ответ без курса USD')
        )

    def _fns(self):
        from counterparty import Counterparties

        res = Counterparties(self.store)._lookup_egrul(SAMPLE_INN, self._keys())
        return ('ok', 'отвечает') if res else ('warn', 'ответ пустой')

    def _dadata(self):
        k = self._keys()
        if not k.get('dadataKey'):
            return 'off', 'ключ не задан (реквизиты берутся из ФНС)'
        from counterparty import Counterparties

        res = Counterparties(self.store)._lookup_dadata(SAMPLE_INN, k)
        return ('ok', 'ключ действует') if res else ('warn', 'ответ пустой')

    def _checko(self):
        from counterparty import CheckoApi

        return self._check_api(
            CheckoApi(self.store), self.CHECKO, 'ключ не задан (проверка контрагентов — бесплатная по ФНС)'
        )

    def _ofdata(self):
        from counterparty import OfDataApi

        return self._check_api(
            OfDataApi(self.store), self.OFDATA, 'ключ не задан — резерв не используется (необязательно)'
        )

    def _check_api(self, api: Any, url: str, nokey: str) -> tuple:
        if not api.key():
            return 'off', nokey
        # без ключа: любой ответ сервера значит «доступен», лимит не тратится
        try:
            urllib.request.urlopen(
                urllib.request.Request(url, headers={'User-Agent': 'KP-Konstruktor'}), timeout=self.FEED_TIMEOUT
            ).close()
        except urllib.error.HTTPError:
            pass
        quota = api.quota()
        status = 'ok' if quota.get('left', 0) > 0 else 'warn'
        return status, 'сервис доступен; сегодня использовано {} из {} запросов (лимит не тратится на проверку)'.format(
            quota.get('used'),
            quota.get('limit'),
        )

    def _girbo(self):
        from counterparty import GirBo

        res = GirBo.load(SAMPLE_BO_INN)
        fin = (res.get('finances') or [None])[0]
        if not fin or fin.get('revenue') is None:
            return 'warn', 'отвечает, но отчётности пробной организации нет — бухотчётность возьмётся из Checko'
        return 'ok', 'отвечает: выручка пробной организации за {} — {} млн ₽'.format(
            fin['year'],
            '{:,.0f}'.format(fin['revenue'] / 1e6).replace(',', ' '),
        )

    def _carriers(self):
        import logistics_api

        res = logistics_api.DeliveryQuote(
            self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Санкт-Петербург'}, 'places': [SAMPLE_PLACE]}
        ).run()
        ok = [
            '{} {} ₽'.format(offer['src'], '{:,.0f}'.format(offer['price']).replace(',', ' '))
            for offer in res['offers']
            if offer.get('kind') == 'ltl'
        ]
        bad = ['{}: {}'.format(err['src'], err['msg']) for err in res['errors'] if not err.get('skip')]
        if not ok:
            return 'fail', '; '.join(bad)[:400] or 'ни один перевозчик не ответил'
        return ('warn' if bad else 'ok'), (
            'отвечают: ' + ', '.join(ok) + ('. Ошибки: ' + '; '.join(bad) if bad else '')
        )[:600]

    def _github(self):
        import version
        from app_update import Updater

        updater = Updater(self.store, self.root, self.data_dir)
        rel = updater.source().latest()
        v = rel.get('version') if isinstance(rel, dict) else None
        if not v:
            return 'warn', 'выпусков не найдено'
        return 'ok', 'последняя версия {}, работает {}{}'.format(
            v,
            version.VERSION,
            '' if updater.token() else ' (без токена — репозиторий открыт)',
        )

    def _pdf(self):
        import pdf_convert

        avail = pdf_convert.available(self._keys().get('convertapiKey'))
        ways = [
            name
            for k, name in (('word', 'Word'), ('libreoffice', 'LibreOffice'), ('cloud', 'ConvertAPI'))
            if avail.get(k)
        ]
        return (
            ('ok', 'чем сохраняется: ' + ', '.join(ways))
            if ways
            else ('warn', 'нет Word, LibreOffice и ключа ConvertAPI — PDF не сохранится')
        )

    def _feed(self, feed: dict) -> tuple:
        url = imgfetch.web_url(feed['url'])
        imgfetch._check_url(url)  # фид — только в интернете, как при загрузке (feeds.download)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 KP-Konstruktor', 'Range': 'bytes=0-1023'})
        with imgfetch.SafeWeb.opener().open(req, timeout=self.FEED_TIMEOUT) as resp:
            resp.read(1024)
            code = resp.status
        last = ((feed.get('last') or {}).get('check') or (feed.get('last') or {}).get('import') or {}).get('at') or ''
        return 'ok', 'адрес отвечает ({}){}'.format(code, ', последняя проверка ' + last[:10] if last else '')
