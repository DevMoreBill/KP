# -*- coding: utf-8 -*-
"""«Проверить все подключения» — одна кнопка вместо проверки в каждой вкладке.

Каждая проверка — лёгкий запрос к сервису (без отправки писем и без трат платных лимитов, где можно):
почта — вход на SMTP-сервер; нейросеть — короткий запрос; ЦБ — курсы; контрагенты — ФНС и DaData по ИНН Сбербанка
(Checko — только остаток лимита); перевозчики — пробный расчёт Москва → Санкт-Петербург; GitHub — последняя версия;
фиды — доступность адреса прайса; PDF — Word, LibreOffice или ConvertAPI. Проверки идут параллельно, у каждой — свой
предел времени. Результат: [{id, group, name, status: ok | warn | fail | off, msg, ms, tab}].
"""
import smtplib
import ssl
import threading
import time
import urllib.request
from datetime import datetime

SAMPLE_INN = '7707083893'          # ПАО Сбербанк — для проверки сервисов реквизитов
SAMPLE_PLACE = {'l': 1.2, 'w': 1.0, 'h': 1.0, 'm': 0.3, 'qty': 1}


class ConnectionCheck:
    TIMEOUT = 45
    FEED_TIMEOUT = 20

    def __init__(self, store, data_dir, root):
        self.store, self.data_dir, self.root = store, data_dir, root

    def run(self):
        jobs = [('mail', 'Почта', 'Почтовый сервер (SMTP)', 'mail', self._mail),
                ('ai', 'Нейросеть', 'Нейросеть для «Заполнить с ИИ»', 'ai', self._ai),
                ('cbr', 'Курсы и ставки', 'ЦБ РФ — курсы валют', 'defaults', self._cbr),
                ('fns', 'Контрагенты', 'ФНС (реквизиты без ключа)', 'keys', self._fns),
                ('dadata', 'Контрагенты', 'DaData', 'keys', self._dadata),
                ('checko', 'Контрагенты', 'Checko', 'keys', self._checko),
                ('carriers', 'Доставка', 'Перевозчики — пробный расчёт Москва → Санкт-Петербург', 'keys', self._carriers),
                ('github', 'Обновления', 'GitHub — новая версия программы', 'updates', self._github),
                ('pdf', 'Документы', 'Сохранение КП в PDF', 'keys', self._pdf)]
        jobs += [('feed:' + f['id'], 'Фиды поставщиков', f['name'], 'feeds', (lambda f=f: self._feed(f)))
                 for f in (self.store.kv_get('feeds') or {}).get('items', []) if f.get('id') and f.get('url')]
        res = {}

        def one(jid, fn):
            t = time.time()
            try:
                st, msg = fn()
            except Exception as e:
                st, msg = 'fail', self._err(e)
            res[jid] = (st, msg, int((time.time() - t) * 1000))
        th = [threading.Thread(target=one, args=(j[0], j[4]), daemon=True) for j in jobs]
        for t in th:
            t.start()
        end = time.time() + self.TIMEOUT
        for t in th:
            t.join(max(0.1, end - time.time()))
        out = []
        for jid, group, name, tab, _fn in jobs:
            st, msg, ms = res.get(jid, ('fail', 'нет ответа за %d с' % self.TIMEOUT, self.TIMEOUT * 1000))
            out.append({'id': jid, 'group': group, 'name': name, 'status': st, 'msg': msg, 'ms': ms, 'tab': tab})
        rec = {'at': datetime.now().isoformat(timespec='seconds'), 'items': out}
        self.store.kv_set('connCheck', rec)
        return rec

    def last(self):
        return self.store.kv_get('connCheck') or {}

    @staticmethod
    def _err(e):
        s = str(e) or type(e).__name__
        if hasattr(e, 'code') and hasattr(e, 'reason'):
            s = 'HTTP %s %s' % (e.code, e.reason)
        return s[:240]

    def _keys(self):
        return self.store.kv_get('integrations') or {}

    # ---------- проверки ----------
    def _mail(self):
        m = self.store.kv_get('mail') or {}
        if not m.get('host'):
            return 'off', 'не настроена — «Подключения → Почта»'
        host, port, sec = m['host'], int(m.get('port') or 465), m.get('security') or 'ssl'
        srv = smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) if sec == 'ssl' else smtplib.SMTP(host, port, timeout=20)
        with srv:
            if sec == 'starttls':
                srv.starttls(context=ssl.create_default_context())
            if m.get('login'):
                try:
                    srv.login(m['login'], m.get('password') or '')
                except smtplib.SMTPAuthenticationError:
                    return 'fail', 'сервер %s не принял логин или пароль' % host
        return 'ok', 'вход на %s:%d выполнен (письмо не отправлялось)' % (host, port)

    def _ai(self):
        import ai_llm
        s = ai_llm.status(self.store)
        if not ai_llm._key(self.store):
            return 'off', 'ключ не задан — «Подключения → Нейросеть»'
        r = ai_llm.ask(self.store, 'Ответь одним словом: да', force=True)
        return ('ok' if s.get('enabled') else 'warn'), 'модель %s отвечает%s' % (r.get('model') or '', '' if s.get('enabled') else '; у менеджеров выключена')

    def _cbr(self):
        import cbr
        r = cbr.cbr_rates() or {}
        if r.get('error'):
            return 'fail', r['error'][:240]
        usd = r.get('USD')
        return ('ok', 'USD %s ₽ на %s · %s' % (('%.2f' % usd).replace('.', ','), r.get('date'), r.get('src'))) if usd else ('warn', 'ответ без курса USD')

    def _fns(self):
        from counterparty import Counterparties
        r = Counterparties(self.store)._lookup_egrul(SAMPLE_INN, self._keys())
        return ('ok', 'отвечает') if r else ('warn', 'ответ пустой')

    def _dadata(self):
        k = self._keys()
        if not k.get('dadataKey'):
            return 'off', 'ключ не задан (реквизиты берутся из ФНС)'
        from counterparty import Counterparties
        r = Counterparties(self.store)._lookup_dadata(SAMPLE_INN, k)
        return ('ok', 'ключ действует') if r else ('warn', 'ответ пустой')

    def _checko(self):
        if not self._keys().get('checkoKey'):
            return 'off', 'ключ не задан (проверка контрагентов — бесплатная по ФНС)'
        from counterparty import Counterparties
        q = Counterparties(self.store).quota()
        st = 'ok' if q.get('left', 0) > 0 else 'warn'
        return st, 'сегодня использовано %s из %s запросов (лимит не тратится на проверку)' % (q.get('used'), q.get('limit'))

    def _carriers(self):
        import logistics_api
        r = logistics_api.quote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Санкт-Петербург'}, 'places': [SAMPLE_PLACE]})
        ok = ['%s %s ₽' % (o['src'], '{:,.0f}'.format(o['price']).replace(',', ' ')) for o in r['offers'] if o.get('kind') == 'ltl']
        bad = ['%s: %s' % (e['src'], e['msg']) for e in r['errors'] if not e.get('skip')]
        if not ok:
            return 'fail', '; '.join(bad)[:400] or 'ни один перевозчик не ответил'
        return ('warn' if bad else 'ok'), ('отвечают: ' + ', '.join(ok) + ('. Ошибки: ' + '; '.join(bad) if bad else ''))[:600]

    def _github(self):
        from app_update import Updater
        up = Updater(self.store, self.root, self.data_dir)
        rel = up.source().latest()
        import version
        v = rel.get('version') if isinstance(rel, dict) else None
        if not v:
            return 'warn', 'выпусков не найдено'
        return 'ok', 'последняя версия %s, работает %s%s' % (v, version.VERSION, '' if up.token() else ' (без токена — репозиторий открыт)')

    def _pdf(self):
        import pdf_convert
        a = pdf_convert.available(self._keys().get('convertapiKey'))
        ways = [n for k, n in (('word', 'Word'), ('libreoffice', 'LibreOffice'), ('cloud', 'ConvertAPI')) if a.get(k)]
        return ('ok', 'чем сохраняется: ' + ', '.join(ways)) if ways else ('warn', 'нет Word, LibreOffice и ключа ConvertAPI — PDF не сохранится')

    def _feed(self, f):
        req = urllib.request.Request(f['url'], headers={'User-Agent': 'Mozilla/5.0 KP-Konstruktor', 'Range': 'bytes=0-1023'})
        with urllib.request.urlopen(req, timeout=self.FEED_TIMEOUT) as r:
            r.read(1024)
            code = r.status
        last = ((f.get('last') or {}).get('check') or (f.get('last') or {}).get('import') or {}).get('at') or ''
        return 'ok', 'адрес отвечает (%s)%s' % (code, ', последняя проверка ' + last[:10] if last else '')
