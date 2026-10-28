# -*- coding: utf-8 -*-
"""Администрирование 3.201.0: расхождения с Битрикс24 (подставной Битрикс), проверка регламента по отделу, ночная проверка
базы, копии на Яндекс Диск (подставной WebDAV: загрузка со сверкой размера, хранение последних, пароль не уходит наружу),
индексы скорости, клиент из карточки предприятия (правила, без сети). Временная база, вымышленные данные."""
import json
import os
import tempfile
import unittest
import urllib.error

from kit import TempStore


class FakeDav:
    """WebDAV в памяти: MKCOL, PUT, PROPFIND (Depth 1), DELETE."""

    def __init__(self, free=None):
        self.files, self.calls, self.free = {}, [], free

    def upload(self, url, path, headers, timeout):
        assert headers.get('Authorization', '').startswith('Basic ')
        size = os.path.getsize(path)
        if self.free is not None and size > self.free - sum(self.files.values()):
            raise urllib.error.HTTPError(url, 507, 'full', {}, None)
        self.files[url.rsplit('/', 1)[-1]] = size

    def __call__(self, url, data=None, headers=None, method='GET', timeout=None):
        self.calls.append((method, url))
        assert headers.get('Authorization', '').startswith('Basic ')
        name = url.rsplit('/', 1)[-1]
        if method == 'MKCOL':
            if self.calls.count(('MKCOL', url)) > 1:
                raise urllib.error.HTTPError(url, 405, 'exists', {}, None)
            return b''
        if method == 'PUT':
            self.files[name] = len(data)
            return b''
        if method == 'DELETE':
            self.files.pop(name, None)
            return b''
        if headers.get('Depth') == '0':
            return b'<d:multistatus/>'  # места не сообщает — отказ придёт кодом 507 на загрузке
        rows = ''.join(f'<d:response><d:href>/Копии/{n}</d:href><d:getcontentlength>{size}</d:getcontentlength></d:response>'
                       for n, size in self.files.items())
        return f'<d:multistatus><d:response><d:href>/Копии/</d:href></d:response>{rows}</d:multistatus>'.encode()


class WebDavTest(unittest.TestCase):
    CONF = {'url': 'https://webdav.yandex.ru', 'folder': 'Копии КП', 'login': 'user', 'password': 'app-pass'}

    def test_put_listing_prune(self):
        from backup_webdav import WebDavStore
        fake = FakeDav()
        disk = WebDavStore(self.CONF, fake, fake.upload)
        disk.ensure()
        disk.ensure()  # папка уже есть — 405 не ошибка
        folder = tempfile.mkdtemp()
        for day in ('2026-10-20', '2026-10-21', '2026-10-22'):
            path = os.path.join(folder, f'kp-{day}.zip')
            with open(path, 'wb') as file:
                file.write(b'x' * 100)
            self.assertEqual(disk.put(path), 100)
        self.assertEqual([name for name, _size in disk.listing()][0], 'kp-2026-10-22.zip', 'новые первыми')
        disk.prune(2)
        self.assertEqual(sorted(fake.files), ['kp-2026-10-21.zip', 'kp-2026-10-22.zip'])

    def test_disk_full_prunes_and_retries(self):
        """Нет места (507) — понятная причина; копия по расписанию удаляет старые сверх «Хранить» и пробует ещё раз."""
        from backup_mirror import MirrorBackup
        from backup_webdav import DiskFull, WebDavStore
        fake = FakeDav(free=300)
        disk = WebDavStore(self.CONF, fake, fake.upload)
        folder = tempfile.mkdtemp()
        paths = []
        for day in ('2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'):
            paths.append(os.path.join(folder, f'kp-{day}.zip'))
            with open(paths[-1], 'wb') as file:
                file.write(b'x' * 100)
        for path in paths[:3]:
            disk.put(path)
        with self.assertRaises(DiskFull) as caught:
            disk.put(paths[3])
        self.assertIn('нет места', str(caught.exception))
        self.assertEqual(MirrorBackup._dav_put(disk, paths[3], 3), 100)
        self.assertEqual(sorted(fake.files), ['kp-2026-10-21.zip', 'kp-2026-10-22.zip', 'kp-2026-10-23.zip'])

    def test_upload_answer_before_file(self):
        """«Expect: 100-continue»: отказ диска читается до отправки архива, «100 Continue» и молчание — отправлять."""
        import socket
        from backup_webdav import DavUpload
        for answer, code in ((b'HTTP/1.1 507 Insufficient Storage\r\nContent-Length: 0\r\n\r\n', 507),
                             (b'HTTP/1.1 100 Continue\r\n\r\n', None), (b'', None)):
            client, server = socket.socketpair()
            with client, server:
                server.sendall(answer)
                DavUpload.WAIT_CONTINUE, saved = 0.2, DavUpload.WAIT_CONTINUE
                try:
                    self.assertEqual(DavUpload._early(client, client.makefile('rb')), code, answer)
                finally:
                    DavUpload.WAIT_CONTINUE = saved
        client, server = socket.socketpair()
        with client, server:
            server.sendall(b'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 201 Created\r\n\r\n')
            self.assertEqual(DavUpload._status(client.makefile('rb')), 201, 'промежуточный 100 пропускается')

    def test_clean(self):
        from backup_webdav import WebDavStore
        with self.assertRaises(ValueError):
            WebDavStore.clean({'login': 'user'}, {})
        with self.assertRaises(ValueError):
            WebDavStore.clean(dict(self.CONF, url='http://plain'), {})
        kept = WebDavStore.clean({'login': 'user', 'folder': 'Копии'}, {'login': 'user', 'password': 'old'})
        self.assertEqual(kept['password'], 'old', 'пустой пароль — прежний')

    def test_mirror_masks_password(self):
        from backup_mirror import MirrorBackup
        st = TempStore(self).store
        settings = {'backup2': {'on': True, 'kind': 'dav', 'keep': 5, 'dav': self.CONF}}
        st.kv_set('settings', settings)
        public = MirrorBackup(st, tempfile.mkdtemp()).public()
        self.assertEqual(public['dav']['password'], MirrorBackup.MASK)
        self.assertNotIn('app-pass', json.dumps(MirrorBackup(st, tempfile.mkdtemp()).status(), ensure_ascii=False))

    def test_feature_off(self):
        from backup_mirror import MirrorBackup
        from features import FeatureAccess
        st = TempStore(self).store
        FeatureAccess(st).save({'davBackup': False})
        with self.assertRaises(ValueError):
            MirrorBackup(st, tempfile.mkdtemp()).save({'kind': 'dav', 'on': True, 'dav': self.CONF})


class SecretsTest(unittest.TestCase):
    def test_settings_file_without_dav_password(self):
        from data_bundle import Keys, ProgramSettings, SettingsFile
        st = TempStore(self).store
        st.kv_set('settings', {'backup2': {'kind': 'dav', 'dav': dict(WebDavTest.CONF)}, 'ai': {'key': 'AI-KEY'}})
        for keys in (Keys.WITHOUT, Keys.WITH):
            _name, raw = SettingsFile(st).export(keys)
            self.assertNotIn('app-pass', raw.decode('utf-8'))
        self.assertNotIn('AI-KEY', SettingsFile(st).export(Keys.WITHOUT)[1].decode('utf-8'))
        dump = json.dumps(ProgramSettings(st).export(), ensure_ascii=False)
        self.assertNotIn('app-pass', dump)
        self.assertNotIn('AI-KEY', dump)
        ProgramSettings(st).apply(json.loads(dump))
        kept = st.kv_get('settings')
        self.assertEqual(kept['backup2']['dav']['password'], 'app-pass', 'загрузка без пароля — пароль базы остаётся')
        self.assertEqual(kept['ai']['key'], 'AI-KEY')

    def test_new_address_needs_password(self):
        from backup_webdav import WebDavStore
        from onec import OneCConf
        with self.assertRaises(ValueError):
            WebDavStore.clean(dict(WebDavTest.CONF, url='https://other.example', password=''), WebDavTest.CONF)
        st = TempStore(self).store
        conf = OneCConf(st)
        conf.save({'url': 'http://srv/base', 'login': 'u', 'password': 'p1'})
        conf.save({'url': 'http://srv/base', 'login': 'u', 'password': OneCConf.MASK, 'on': True})
        with self.assertRaises(ValueError):
            conf.save({'url': 'http://evil/base', 'login': 'u', 'password': OneCConf.MASK})


class NightCheckTest(unittest.TestCase):
    def test_run_and_attention(self):
        from db_health import NightCheck
        st = TempStore(self).store
        night = NightCheck(st, tempfile.mkdtemp())
        res = night.run()
        self.assertEqual(res['integrity'], 'ok')
        self.assertGreater(res['bytes'], 0)
        rows = night.attention()
        self.assertEqual(rows[0]['level'], 'bad', 'копий нет — тревога утром')
        self.assertIn('свежей копии нет', rows[0]['text'])
        night.run()
        self.assertEqual(len(night.history()), 2)


class SpeedIndexTest(unittest.TestCase):
    def test_indexes(self):
        st = TempStore(self).store
        names = {row[0] for row in st.all("SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertTrue({'crm_tasks_state', 'deals_updated'} <= names)


class RegAuditTest(unittest.TestCase):
    def test_off(self):
        from deal_reg_audit import RegAudit
        st = TempStore(self).store
        self.assertEqual(RegAudit(st).report()['on'], False)


class StubSync:
    def __init__(self, rows):
        self.rows = rows
        self.api = self

    def list(self, method, params, limit=50):
        return [row for row in self.rows if row['ID'] in params['filter']['ID']]

    def bx_stage(self, deal, cat):
        return 'C0:NEW'

    def bx_user(self, mid):
        return {'m1': 7}.get(mid)


class BitrixDiffTest(unittest.TestCase):
    def test_report_and_align(self):
        from bitrix_diff import BitrixDiff
        from crm import DealBook
        st = TempStore(self).store
        did = DealBook(st).create({'title': 'Станция', 'client': 'ООО «А»', 'sum': 1500000}, 'm1', 'Иванова', 'тест')
        did = did['id'] if isinstance(did, dict) else did
        st.write("INSERT INTO bx_link (kind, local_id, bx_id) VALUES ('deal', ?, '55')", (did,))
        sync = StubSync([{'ID': '55', 'STAGE_ID': 'C0:NEW', 'OPPORTUNITY': '20000.00', 'ASSIGNED_BY_ID': '9', 'CATEGORY_ID': '0'}])
        report = BitrixDiff(st, sync).report()
        self.assertEqual(report['checked'], 1)
        fields = {diff['field'] for diff in report['rows'][0]['diffs']}
        self.assertEqual(fields, {'sum', 'manager'}, 'стадия совпала; сумма 15 000 ≠ 20 000, ответственный 7 ≠ 9')
        BitrixDiff(st, sync).align(did)
        with self.assertRaises(LookupError):
            BitrixDiff(st, sync).align('d999')


class CompanyCardTest(unittest.TestCase):
    TEXT = """Карточка предприятия
Полное наименование: Общество с ограниченной ответственностью «Ромашка»
ООО «Ромашка»
ИНН/КПП 7707083893/770701001
ОГРН 1027700132195
Юридический адрес: 123456, г. Москва, ул. Тестовая, д. 1
Генеральный директор: Петров Пётр Петрович
Р/с 40702810900000000001
Банк: ПАО «Тестбанк»
БИК 044525225
К/с 30101810400000000225
Тел.: 8 (495) 123-45-67, e-mail: info@romashka.test"""

    def test_parse_and_create(self):
        from company_card import CompanyCard
        st = TempStore(self).store
        card = CompanyCard(st)
        card._fns = lambda fields: ({}, [])  # без сети
        found = card.parse(self.TEXT)['fields']
        self.assertEqual(found['inn'], '7707083893')
        self.assertEqual(found['kpp'], '770701001')
        self.assertEqual(found['ogrn'], '1027700132195')
        self.assertEqual(found['bik'], '044525225')
        self.assertEqual(found['account'], '40702810900000000001')
        self.assertEqual(found['corr'], '30101810400000000225')
        self.assertEqual(found['name'], 'ООО «Ромашка»')
        self.assertEqual(found['email'], 'info@romashka.test')
        self.assertTrue(found['phone'].startswith('+7 (495)'))
        self.assertIn('Москва', found['address'])
        doc = card.create(found, 'тест')
        self.assertEqual(st.client_get('inn7707083893')['kpp'], '770701001')
        self.assertEqual(doc['bik'], '044525225')
        with self.assertRaises(ValueError):
            card.create(dict(found, inn='1234567890'), 'тест')

    def test_bad_inn_warning(self):
        from company_card import CompanyCard
        st = TempStore(self).store
        res = CompanyCard(st).parse('ИНН 1234567890')
        self.assertIn('контрольная сумма', res['warnings'][0])


if __name__ == '__main__':
    unittest.main()
