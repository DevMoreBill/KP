# -*- coding: utf-8 -*-
"""Функции программы через API на стенде (сервер отдела, вымышленные данные): справочники, каталог и синхронизация,
поиск, КП (ревизии, версии, Word, ход сделки, письмо клиенту), карточка клиента, черновики и заготовки, личные настройки,
настройки отдела с историей и откатом, копии базы, выгрузка и загрузка, журнал сервера, письма о проблемах, обновления.
Шаги выполняются по порядку (test_01 … test_99) на одном стенде."""
import io
import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.parse
import zipfile

from kit import Http, Net, SampleData, SmtpSink, Stand
import version


class ApiTest(unittest.TestCase):
    MAIL_PW = 'Mail-Secret-52'

    @classmethod
    def setUpClass(cls):
        cls.sink = SmtpSink()
        cls.sample = SampleData()
        cls.stand = Stand(sample=cls.sample)
        cls.stand.kv_set('mail', cls.sink.mail_settings(password=cls.MAIL_PW))     # пароль почты не должен попасть в выгрузку
        cls.stand.start()
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        cls.ctx = {}                  # то, что шаги передают друг другу (номер КП, метки синхронизации)

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()
        cls.sink.stop()

    def J(self, method, path, body=None, who='m1', raw=False, extra=None):
        """Запрос менеджера m1 (подпись запроса программы) или администратора (сессия + CSRF) с компьютера-сервера."""
        h = Stand.as_manager(self.M1 if who == 'm1' else self.M2) if who in ('m1', 'm2') else dict(self.A) if who == 'adm' else {}
        h.update(extra or {})
        return self.stand.http.req(method, path, body, headers=h, cookie=self.adm if who == 'adm' else None, raw=raw)

    def ok_json(self, method, path, body=None, who='m1', code=200):
        st, b, _ = self.J(method, path, body, who)
        self.assertEqual(st, code, '%s %s → %s %s' % (method, path, st, b[:300]))
        return Http.js(b)

    # ---------------------------------------------------------------- 1. справочники
    def test_01_references(self):
        for p in ['/', '/api/version', '/api/types', '/api/lists', '/api/defaults', '/api/features', '/api/managers', '/api/suppliers',
                  '/api/customs', '/api/uitexts', '/api/logos', '/api/catalog/sources', '/api/catalog/pending', '/api/templates',
                  '/api/ai/status', '/api/mail/status', '/api/logistics', '/api/logistics/status', '/api/pdf', '/api/me/prefs', '/api/drafts',
                  '/api/presets', '/api/reminders', '/api/history?limit=20', '/api/clients?q=%D0%BE%D0%BE%D0%BE&limit=20', '/api/check/quota',
                  '/api/auth/status']:
            with self.subTest(p):
                st, b, _ = self.J('GET', p)
                self.assertEqual(st, 200, b[:200])
                if p != '/':
                    self.assertIsNotNone(Http.js(b), b[:200])
        self.assertEqual(self.ok_json('GET', '/api/version')['version'], version.VERSION)
        mg = self.ok_json('GET', '/api/managers')
        self.assertEqual(sorted(x['id'] for x in mg), sorted(m[0] for m in SampleData.MANAGERS))

    # ---------------------------------------------------------------- 2. каталог
    def test_02_catalog_sync(self):
        st, b, hd = self.J('GET', '/api/catalog', raw=True)
        cat = json.loads(b)
        self.assertEqual(len(cat), len(self.sample.items))
        self.assertTrue(all(x.get('_light') for x in cat), 'список — облегчённые карточки')
        et = hd.get('ETag')
        self.assertTrue(et)
        self.assertEqual(self.J('GET', '/api/catalog', extra={'If-None-Match': et}, raw=True)[0], 304)
        s0 = self.ok_json('GET', '/api/catalog/sync?since=0')
        self.assertTrue(s0['full'] and len(s0['items']) == len(cat) and s0['epoch'] and s0['seq'] > 0)
        ep, seq = s0['epoch'], s0['seq']
        d = self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=%s' % (seq, ep))
        self.assertEqual((d['full'], d['items'], d['gone'], d['seq']), (False, [], [], seq))
        one = cat[7]
        doc = self.ok_json('GET', '/api/catalog/' + urllib.parse.quote(one['id']))
        self.assertEqual(doc['id'], one['id'])
        rev = doc.pop('_rev')
        doc['price'] = 1234567
        st, b, _ = self.J('PUT', '/api/catalog/' + one['id'], doc, who='adm', extra={'X-KP-Rev': str(rev)})
        self.assertTrue(st == 200 and Http.js(b).get('ok'), (st, b[:200]))
        st, b, _ = self.J('PUT', '/api/catalog/' + one['id'], doc, who='adm', extra={'X-KP-Rev': str(rev)})
        self.assertEqual(st, 409, 'правка со старой ревизией не затирает чужую')
        d = self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=%s' % (seq, ep))
        self.assertEqual([x['id'] for x in d['items']], [one['id']])
        self.assertEqual(d['items'][0]['price'], 1234567)
        seq2 = d['seq']
        self.assertTrue(self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=other' % seq2)['full'], 'чужая метка базы — весь каталог')
        self.assertTrue(self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=%s' % (seq2 + 1000, ep))['full'], 'номер новее сервера — весь каталог')
        self.assertTrue(self.ok_json('GET', '/api/catalog/sync?since=abc&epoch=%s' % ep)['full'])
        # корзина: удалить → в gone; восстановить → снова в изменениях
        victim = cat[12]['id']
        self.assertEqual(self.ok_json('POST', '/api/admin/delete', {'type': 'catalog', 'ids': [victim]}, who='adm').get('deleted'), 1)
        d = self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=%s' % (seq2, ep))
        self.assertIn(victim, d['gone'])
        seq3 = d['seq']
        tid = next(x['id'] for x in self.ok_json('GET', '/api/admin/trash', who='adm')['items'] if x['entityId'] == victim)
        self.ok_json('POST', '/api/admin/trash/%s/restore' % tid, {}, who='adm')
        for since in (seq3, seq2):
            d = self.ok_json('GET', '/api/catalog/sync?since=%d&epoch=%s' % (since, ep))
            self.assertIn(victim, [x['id'] for x in d['items']])
            self.assertNotIn(victim, d['gone'])

    def test_03_catalog_search(self):
        sample = next(x for x in self.sample.items if len(x['attrs']['model']) >= 5)
        for q, need in [(sample['attrs']['model'], sample['id']), ('компрессор', None), ('ВинтОвой   КОМПРЕССОР', None), ('a', None), ('%_%', None),
                        ("'; DROP TABLE catalog;--", None), ('х' * 500, None)]:
            with self.subTest(q[:30]):
                d = self.ok_json('GET', '/api/catalog/search?q=' + urllib.parse.quote(q))
                self.assertIsInstance(d.get('ids'), list)
                if need:
                    self.assertIn(need, d['ids'])
        self.assertLess(len(self.ok_json('GET', '/api/catalog/search?q=%25_%25')['ids']), len(self.sample.items), 'LIKE экранирован')
        n1 = len(self.ok_json('GET', '/api/catalog/search?q=' + urllib.parse.quote('компрессор'))['ids'])
        n2 = len(self.ok_json('GET', '/api/catalog/search?q=' + urllib.parse.quote('компрессор винтовой'))['ids'])
        self.assertTrue(0 < n2 <= n1, (n1, n2))
        self.assertEqual(self.J('GET', '/api/catalog/zzz-missing')[0], 404)
        self.assertIn(self.J('GET', '/api/catalog/' + urllib.parse.quote('нет/../x', safe=''))[0], (400, 404))

    # ---------------------------------------------------------------- 3. КП
    def test_04_kp_save_revisions(self):
        kid = self.ok_json('POST', '/api/kp/new', {})['id']
        self.assertTrue(kid)
        self.ctx['kid'] = kid
        state = {'client': 'ООО «Тест Прогона»', 'clientInn': self.sample.clients[0]['inn'], 'number': kid, 'kpId': kid, 'authorId': self.M1[0],
                 'items': [{'name': 'Компрессор тестовый', 'qty': 2, 'price': 1000000, 'cost': 600000}],
                 'contact': {'email': 'client@example.com', 'name': 'Иван'}, 'manager': {'name': self.M1[1], 'email': self.M1[2]}, 'deal': {'x': 1}}
        meta = {'id': kid, 'number': kid, 'client': state['client'], 'clientInn': state['clientInn'], 'date': time.strftime('%Y-%m-%d'),
                'authorId': self.M1[0], 'manager': self.M1[1], 'sum': 2000000, 'cur': 'RUB', 'items': ['Компрессор тестовый']}
        r1 = self.ok_json('PUT', '/api/kp/%s/state' % kid, state)['rev']
        self.ok_json('PUT', '/api/kp/%s/meta' % kid, meta)
        st, b, _ = self.J('PUT', '/api/kp/%s/state' % kid, dict(state, client='ООО «Тест Прогона 2»'), extra={'X-KP-Rev': str(r1)})
        r2 = Http.js(b)['rev']
        self.assertEqual(r2, r1 + 1)
        st, b, _ = self.J('PUT', '/api/kp/%s/state' % kid, dict(state, client='затрёт'), extra={'X-KP-Rev': str(r1)})
        self.assertEqual(st, 409, 'старая ревизия не затирает чужие изменения')
        d = self.ok_json('GET', '/api/kp/%s/state' % kid)
        self.assertEqual((d['client'], d['_rev']), ('ООО «Тест Прогона 2»', r2))
        self.assertEqual(self.ok_json('GET', '/api/kp/%s/rev' % kid)['rev'], r2)
        vers = self.ok_json('GET', '/api/kp/%s/versions' % kid)
        self.assertTrue(isinstance(vers, list) and vers)
        self.assertIsNotNone(self.ok_json('GET', '/api/kp/%s/versions/%s' % (kid, vers[-1]['id'])))
        self.assertEqual(self.J('PUT', '/api/kp/%s/state' % kid, '[1,2,3]')[0], 400)
        self.assertEqual(self.J('GET', '/api/kp/%s/state' % kid, who='m2')[0], 200, 'без входа по паролю КП открывается всем')
        self.assertTrue(Http.js(self.J('GET', '/api/kp/%s/state' % kid, who='m2')[1]).get('locked'), 'экономика чужого КП скрыта')

    def test_05_kp_word_and_deal(self):
        kid = self.ctx['kid']
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
            z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>')
        docx = buf.getvalue()
        q = lambda name: '/api/kp/%s/docx?name=%s&dir=%s' % (kid, urllib.parse.quote(name), urllib.parse.quote('Иванова'))
        st, b, _ = self.J('PUT', q('%s КП Тест.docx' % kid), docx, extra={'Content-Type': 'application/octet-stream'})
        self.assertTrue(st == 200 and (Http.js(b) or {}).get('rel', '').startswith('Иванова/'), (st, b[:200]))
        st, b, hd = self.J('GET', '/api/kp/%s/docx' % kid, raw=True)
        self.assertTrue(st == 200 and b[:2] == b'PK' and 'attachment' in hd.get('Content-Disposition', ''))
        self.J('PUT', q('%s КП Тест новое имя.docx' % kid), docx, extra={'Content-Type': 'application/octet-stream'})
        folder = os.path.join(self.stand.app, 'Коммерческие предложения', 'Иванова')
        self.assertEqual(sorted(os.listdir(folder)), ['%s КП Тест новое имя.docx' % kid], 'старый файл убран при новом имени')
        self.assertIn(self.J('POST', '/api/kp/%s/pdf' % kid, {})[0], (200, 422), 'без Word и LibreOffice — понятный ответ')
        tr = self.ok_json('PUT', '/api/kp/%s/track' % kid, {'status': 'work', 'followUp': {'date': time.strftime('%Y-%m-%d'), 'note': 'перезвонить'}})
        self.assertEqual(tr['track']['status'], 'work')
        self.assertEqual(self.J('PUT', '/api/kp/%s/track' % kid, {'status': 'nonsense'})[0], 400)
        self.assertTrue(any(x.get('id') == kid for x in self.ok_json('GET', '/api/reminders')['items']))
        d = self.ok_json('GET', '/api/history?limit=10&q=' + urllib.parse.quote('Тест Прогона'))
        self.assertTrue(any(x.get('id') == kid for x in d['items']))
        d = self.ok_json('GET', '/api/history?limit=10&status=work')
        self.assertTrue(d['items'] and all((x.get('track') or {}).get('status') == 'work' for x in d['items']))
        self.assertTrue(any(x.get('id') == kid for x in self.ok_json('GET', '/api/report?from=2000-01-01&to=2100-01-01')['items']))

    def test_06_kp_mail(self):
        kid = self.ctx['kid']
        d = self.ok_json('GET', '/api/kp/%s/mailform' % kid)
        self.assertTrue(d.get('to') == 'client@example.com' and d.get('word'), d)
        n = len(self.sink.messages)
        self.ok_json('POST', '/api/kp/%s/send' % kid, {'to': 'client@example.com', 'cc': 'boss@example.com', 'subject': 'КП №' + kid,
                                                         'body': 'Добрый день!', 'word': True})
        self.assertEqual(len(self.sink.messages), n + 1)
        subject, text, files, rcpt, msg = self.sink.message()
        self.assertTrue(set(rcpt) >= {'client@example.com', 'boss@example.com'}, rcpt)
        self.assertIn('КП', subject)
        self.assertTrue(any(f.endswith('.docx') for f in files), files)
        self.assertIn(self.M1[2], msg.get('Reply-To') or '', 'ответ клиента — на адрес менеджера')
        self.assertTrue(self.ok_json('GET', '/api/kp/%s/mailform' % kid).get('sent'), 'отправка отмечена в ходе сделки')
        self.ok_json('POST', '/api/admin/mail', {'port': Net.free_port()}, who='adm')
        st, b, _ = self.J('POST', '/api/kp/%s/send' % kid, {'to': 'client@example.com', 'subject': 'КП', 'body': 'текст', 'word': True})
        self.assertEqual(st, 422, 'почтовый сервер недоступен — понятный отказ')
        self.ok_json('POST', '/api/admin/mail', {'port': self.sink.port}, who='adm')
        self.assertEqual(self.J('POST', '/api/kp/%s/send' % kid, {'to': 'не адрес', 'word': True})[0], 400)

    # ---------------------------------------------------------------- 4. клиент, черновики, заготовки, личные настройки
    def test_07_client_drafts_presets(self):
        kid = self.ctx['kid']
        d = self.ok_json('GET', '/api/clientcard?inn=' + self.sample.clients[0]['inn'])
        self.assertTrue(any(x.get('id') == kid for x in d.get('kps', [])), d)
        r = self.ok_json('PUT', '/api/drafts/tstd1', {'state': {'client': 'Черновик прогона', 'items': [{}, {}]}, 'sum': 100, 'cur': 'RUB'})
        self.assertEqual(r['row']['positions'], 2)
        self.assertTrue(any(x['id'] == 'tstd1' for x in self.ok_json('GET', '/api/drafts')['items']))
        self.assertEqual(self.ok_json('GET', '/api/drafts/tstd1')['data']['state']['client'], 'Черновик прогона')
        self.assertFalse(any(x['id'] == 'tstd1' for x in self.ok_json('GET', '/api/drafts', who='m2')['items']), 'черновик виден только автору')
        self.ok_json('POST', '/api/drafts/tstd1/delete', {})
        self.assertFalse(any(x['id'] == 'tstd1' for x in self.ok_json('GET', '/api/drafts')['items']))
        self.assertEqual(self.J('PUT', '/api/presets/tstp1', {'state': {'items': [{}]}, 'title': ''})[0], 400)
        self.ok_json('PUT', '/api/presets/tstp1', {'state': {'items': [{}]}, 'title': 'Заготовка прогона'})
        self.assertTrue(any(x['id'] == 'tstp1' for x in self.ok_json('GET', '/api/presets', who='adm')['items']), 'заготовка видна всем')
        self.ok_json('POST', '/api/presets/tstp1/delete', {})

    def test_08_personal_prefs(self):
        p = self.ok_json('PUT', '/api/me/prefs', {'theme': 'dark', 'start': 'journal', 'template': 'pnevmotekh', 'mailSign': 'С уважением,\nАнна',
                                                  'mailCopy': False, 'defaults': {'kp.city': 'Казань', 'kp.cur': 'EUR', 'cond.pay': '50/50',
                                                                                  'kp.vat': '0', 'x.y': '1'}})['prefs']
        self.assertEqual((p.get('theme'), p.get('start'), p.get('mailCopy')), ('dark', 'journal', False))
        self.assertEqual(set(p.get('defaults', {})), {'kp.city', 'kp.cur', 'cond.pay'}, 'свои умолчания — только город, валюта и условия')
        d = self.ok_json('GET', '/api/me/prefs')
        self.assertEqual((d['prefs']['defaults']['kp.city'], d['id']), ('Казань', self.M1[0]))
        self.assertEqual(self.ok_json('GET', '/api/me/prefs', who='m2')['prefs'], {}, 'у другого менеджера свои настройки')
        for bad in ({'defaults': {'kp.cur': 'BTC'}}, {'template': '../../x'}, '[1]'):
            with self.subTest(bad):
                self.assertEqual(self.J('PUT', '/api/me/prefs', bad)[0], 400)
        p = self.ok_json('PUT', '/api/me/prefs', {'theme': 'purple', 'start': 'x', 'mailSign': 'я' * 5000})['prefs']
        self.assertTrue('theme' not in p and 'start' not in p and len(p.get('mailSign', '')) == 2000, p)
        self.assertEqual(self.J('PUT', '/api/me/prefs', {'theme': 'dark'}, who='nobody')[0], 400, 'без выбранного менеджера')

    # ---------------------------------------------------------------- 5. настройки отдела, история, откат
    def test_09_settings_history_rollback(self):
        lists = self.ok_json('GET', '/api/admin/lists', who='adm')['values']
        lk, new = 'deal.countries', [{'name': 'Китай'}, {'name': 'Страна прогона'}]
        self.assertEqual(self.ok_json('POST', '/api/admin/lists', {'values': {lk: new}}, who='adm')['values'][lk], new)
        h1 = self.ok_json('GET', '/api/admin/history', who='adm')['items'][0]
        self.assertEqual((h1.get('key'), h1.get('title')), ('settings', 'Списки и выборы'))
        d = self.ok_json('GET', '/api/admin/history/%s' % h1['id'], who='adm')
        self.assertEqual(d['diff'][0]['after'], new)
        dk = 'kp.city'
        self.ok_json('POST', '/api/admin/defaults', {'values': {dk: {'on': True, 'v': 'значение прогона'}}}, who='adm')
        self.ok_json('POST', '/api/admin/history/%s/rollback' % h1['id'], {}, who='adm')
        self.assertEqual(self.ok_json('GET', '/api/admin/lists', who='adm')['values'].get(lk), lists.get(lk), 'откат вернул список')
        self.assertEqual((self.ok_json('GET', '/api/admin/defaults', who='adm')['values'].get(dk) or {}).get('v'), 'значение прогона',
                         'более позднее изменение осталось')
        self.ok_json('POST', '/api/admin/features', {'values': {'clientCard': {'on': False}}}, who='adm')
        self.assertEqual(self.J('GET', '/api/clientcard?inn=7707083893')[0], 403, 'выключенная функция закрыта')
        self.ok_json('POST', '/api/admin/features', {'values': {'clientCard': None}}, who='adm')
        self.assertEqual(self.J('GET', '/api/clientcard?inn=7707083893')[0], 200)
        self.ok_json('PUT', '/api/uitexts', {'Сохранить': 'Записать'}, who='adm')
        self.assertEqual(self.ok_json('GET', '/api/uitexts').get('Сохранить'), 'Записать')
        self.ok_json('PUT', '/api/uitexts', {}, who='adm')
        items = self.ok_json('GET', '/api/admin/history?key=uitexts', who='adm')['items']
        self.assertTrue(len(items) >= 2 and all(x['key'] == 'uitexts' for x in items))

    # ---------------------------------------------------------------- 6. копии базы
    def test_10_backups(self):
        mir = tempfile.mkdtemp(prefix='kp-mirror-')
        self.addCleanup(shutil.rmtree, mir, True)
        self.assertTrue(self.ok_json('POST', '/api/admin/maint/mirror/check', {'path': mir}, who='adm').get('ok'))
        self.assertEqual(self.J('POST', '/api/admin/maint/mirror/check', {'path': self.stand.data}, who='adm')[0], 400, 'вторая папка внутри папки данных')
        self.assertEqual(self.J('POST', '/api/admin/maint/mirror/check', {'path': 'относительный/путь'}, who='adm')[0], 400)
        self.assertTrue(self.ok_json('POST', '/api/admin/maint/mirror', {'on': True, 'path': mir, 'keep': 3, 'images': True}, who='adm').get('on'))
        self.assertTrue(self.ok_json('POST', '/api/admin/maint/mirror/run', {}, who='adm').get('running'))
        t = time.time()
        while time.time() - t < 120:
            s = self.ok_json('GET', '/api/admin/maint/mirror', who='adm')
            if not s.get('running'):
                break
            time.sleep(0.5)
        self.assertTrue(s.get('last', {}).get('ok'), s)
        zips = [f for f in os.listdir(mir) if f.startswith('kp-') and f.endswith('.zip')]
        self.assertEqual(len(zips), 1, os.listdir(mir))
        with zipfile.ZipFile(os.path.join(mir, zips[0])) as z:
            self.assertEqual(z.namelist(), ['kp.sqlite3'])
        self.ok_json('POST', '/api/admin/maint/mirror', {'on': False, 'path': ''}, who='adm')
        self.assertIsNotNone(self.ok_json('GET', '/api/admin/maint', who='adm'))
        d = self.ok_json('POST', '/api/backup', {}, who='adm')
        self.assertTrue(d.get('ok') and os.path.isfile(d.get('path', '')) and zipfile.is_zipfile(d['path']), d)

    # ---------------------------------------------------------------- 7. выгрузка и загрузка
    def test_11_export_import(self):
        st, b, _ = self.J('GET', '/api/admin/export?sections=settings', who='adm', raw=True)
        d = json.loads(b)
        sec = d['sections']['settings']
        self.assertTrue(d.get('format') == 'kp-backup' and 'settings' in sec and 'mail' in sec, list(sec))
        self.assertNotIn(self.MAIL_PW, b.decode('utf-8'), 'пароль почты не выгружается')
        flat = json.dumps(sec, ensure_ascii=False).lower()
        self.assertEqual([k for k in ('deepseekkey', 'dadatakey', 'checkokey', 'githubtoken', '"password"', '"pw"') if k in flat], [],
                         'в выгрузке настроек нет ключей API и паролей')
        st, b2, _ = self.J('POST', '/api/admin/import/file/preview', b, who='adm', extra={'Content-Type': 'application/octet-stream'})
        self.assertTrue(st == 200 and Http.js(b2)['report'].get('settings'), b2[:200])
        st, b, _ = self.J('GET', '/api/admin/export?sections=clients', who='adm', raw=True)
        self.assertEqual(len(json.loads(b)['sections']['clients']), len(self.sample.clients))
        cats = self.ok_json('GET', '/api/admin/export/cats', who='adm')
        c1 = next(x['cat'] for x in cats if x['cat'])
        st, b, hd = self.J('GET', '/api/admin/export?sections=catalog&cats=%s&images=1' % c1, who='adm', raw=True)
        self.assertTrue(st == 200 and b[:2] == b'PK' and hd.get('Content-Type') == 'application/zip', (st, hd.get('Content-Type')))
        with zipfile.ZipFile(io.BytesIO(b)) as z:
            body = json.loads(z.read('kp-backup.json'))
        self.assertTrue(body['sections']['catalog'] and all((x.get('attrs') or {}).get('cat') == c1 for x in body['sections']['catalog']))
        st, b2, _ = self.J('POST', '/api/admin/import/file/preview', b, who='adm', extra={'Content-Type': 'application/zip'})
        r = Http.js(b2)
        self.assertEqual((r['report']['catalog']['new'], r['report']['catalog']['updated']), (0, len(body['sections']['catalog'])))
        # архив с путями ../ и не-картинкой
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('kp-backup.json', json.dumps({'format': 'kp-backup', 'version': 1, 'sections': {'catalog': []}}))
            z.writestr('img/../../evil.jpg', b'\xff\xd8\xff' + b'0' * 100)
            z.writestr('img/x/../../../../evil2.jpg', b'\xff\xd8\xff' + b'0' * 100)
            z.writestr('img/ok/new-tst.jpg', b'\xff\xd8\xff' + b'0' * 100)
            z.writestr('img/ok/not-image.jpg', b'MZ' + b'0' * 100)
        st, b, _ = self.J('POST', '/api/admin/import/file', buf.getvalue(), who='adm', extra={'Content-Type': 'application/zip'})
        r = Http.js(b) or {}
        self.assertTrue(st == 200 and r.get('images', {}).get('invalid') == 2 and r['images'].get('written') == 1, (st, b[:300]))
        for p in (self.stand.app, self.stand.data, self.stand.dir):
            self.assertFalse(os.path.exists(os.path.join(p, 'evil.jpg')) or os.path.exists(os.path.join(p, 'evil2.jpg')), p)
        for bad in (b'', b'{"format":"x"}', b'PK\x03\x04garbage', b'\x00\x01\x02'):
            with self.subTest(bad[:10]):
                self.assertEqual(self.J('POST', '/api/admin/import/file/preview', bad, who='adm', extra={'Content-Type': 'application/octet-stream'})[0], 400)
        self.assertEqual(self.J('POST', '/api/admin/import/sqlite', b'not sqlite', who='adm', extra={'Content-Type': 'application/octet-stream'})[0], 400)

    # ---------------------------------------------------------------- 8. система: журнал, письма о проблемах, обновления
    def test_12_server_log(self):
        d = self.ok_json('GET', '/api/admin/log', who='adm')
        self.assertTrue(isinstance(d['errors'], list) and d['bytes'] > 0 and d['local'], d)
        st, b, hd = self.J('GET', '/api/admin/log/download', who='adm')
        self.assertEqual(st, 200)
        self.assertIn('attachment', hd.get('Content-Disposition', ''))
        self.assertIn('Запуск: версия %s' % version.VERSION, b)
        self.assertEqual(self.J('GET', '/api/admin/log')[0], 401, 'журнал — только администратору')

    def test_13_alerts(self):
        self.assertEqual(self.J('POST', '/api/admin/alerts', {'on': True, 'to': ''}, who='adm')[0], 400)
        self.assertEqual(self.J('POST', '/api/admin/alerts', {'on': True, 'to': 'admin@example.com'})[0], 401, 'без сессии администратора')
        d = self.ok_json('POST', '/api/admin/alerts', {'on': True, 'to': 'admin@example.com'}, who='adm')
        self.assertTrue(d['on'] and d['mailOn'], d)
        n = len(self.sink.messages)
        self.assertTrue(self.ok_json('POST', '/api/admin/alerts/test', {}, who='adm')['ok'])
        self.assertEqual(len(self.sink.messages), n + 1)
        subject, text, _, rcpt, _ = self.sink.message()
        self.assertIn('пробное письмо', subject)
        self.assertEqual(rcpt, ['admin@example.com'])
        self.assertTrue(self.ok_json('GET', '/api/admin/alerts', who='adm')['last']['ok'])
        self.ok_json('POST', '/api/admin/alerts', {'on': False}, who='adm')

    def test_14_update_settings(self):
        st = self.ok_json('GET', '/api/admin/update', who='adm')
        self.assertEqual(st['current'], version.VERSION)
        self.assertEqual((st['nightly'], st['nightSupported']), ('off', False), 'из исходников ночные обновления не работают')
        self.ok_json('POST', '/api/admin/update', {'nightly': 'patch', 'nightHour': 4}, who='adm')
        st = self.ok_json('GET', '/api/admin/update', who='adm')
        self.assertEqual((st['nightly'], st['nightHour']), ('patch', 4))
        for bad in ({'nightly': 'всегда'}, {'nightHour': 30}):
            self.assertEqual(self.J('POST', '/api/admin/update', bad, who='adm')[0], 422, bad)
        att = self.ok_json('GET', '/api/admin/attention', who='adm')
        self.assertTrue(any('Ночные обновления' in (x.get('text') or '') for x in att.get('items', [])), att)
        self.ok_json('POST', '/api/admin/update', {'nightly': 'off'}, who='adm')

    def test_15_system_and_stats(self):
        self.assertIsNotNone(self.ok_json('GET', '/api/admin/system', who='adm'))
        self.assertGreaterEqual(self.ok_json('GET', '/api/admin/stats', who='adm')['kp']['total'], self.sample.n_kps)
        self.assertTrue(self.ok_json('GET', '/api/admin/audit?page=0', who='adm')['items'])
        d = self.ok_json('GET', '/api/admin/migrations', who='adm')
        self.assertEqual(set(d['all']) - set(d['applied']), set(), 'все миграции применены')

    def test_99_no_request_errors(self):
        """Ни один запрос за прогон не закончился внутренней ошибкой сервера (запись в журнале сервера)."""
        self.assertEqual([r['text'] for r in self.stand.request_errors()], [])


if __name__ == '__main__':
    unittest.main()
