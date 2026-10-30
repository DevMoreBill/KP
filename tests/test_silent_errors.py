# -*- coding: utf-8 -*-
"""Сбои, которые раньше пропадали молча (аудит 30.10): перенос данных прежних версий, испорченный settings.json,
журнал действий, проверки «Главной», очередь Битрикс24, настройка карточки сделки, размер обрезанной картинки."""
import json
import os
import shutil
import sqlite3
import struct
import tempfile
import types
import unittest

from kit import FakeConfig, Quiet, TempStore
from server_log import ServerLog


class LogCase(unittest.TestCase):
    """Журнал сервера этого процесса — во временной папке на время проверки."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='kp-silent-')
        self.addCleanup(shutil.rmtree, self.dir, True)
        Quiet.stderr(self)
        self.addCleanup(setattr, ServerLog, 'current', ServerLog.current)
        self.log = ServerLog(os.path.join(self.dir, 'logs'))
        self.addCleanup(self.log.close)
        ServerLog.current = self.log

    def texts(self, level):
        return [rec['text'] for rec in self.log.records() if rec['level'] == level]


class LegacyImport(unittest.TestCase):
    """Перенос из JSON-файлов прежних версий: испорченный файл пропускается, но называется (раньше — молча)."""

    def write(self, rel, text):
        path = os.path.join(self.data, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(text)

    def test_broken_files_named(self):
        store = TempStore(self).store
        self.data = tempfile.mkdtemp(prefix='kp-legacy-')
        self.addCleanup(shutil.rmtree, self.data, True)
        self.write('clients/good.json', json.dumps({'name': 'ООО «Ромашка»'}, ensure_ascii=False))
        self.write('clients/bad.json', '{')
        self.write('checks/bad.json', '[')
        self.write('counter-2025.txt', 'не число')
        self.write('integrations.json', '{')
        said = []
        self.assertEqual(store.migrate_json(self.data, said.append), 1)
        self.assertEqual(len(said), 4, said)
        joined = '\n'.join(said)
        for name in ('client bad.json', 'check bad.json', 'counter counter-2025.txt', 'integrations.json'):
            self.assertIn(name, joined)
        self.assertEqual(store.client_get('good')['name'], 'ООО «Ромашка»')


class SettingsFileTest(unittest.TestCase):
    """settings.json: нет файла — создаётся как раньше; испорченный — папки по умолчанию и причина для журнала."""

    def setUp(self):
        from config import SettingsFile

        self.cls = SettingsFile
        self.root = tempfile.mkdtemp(prefix='kp-settings-')
        self.addCleanup(shutil.rmtree, self.root, True)
        self.addCleanup(setattr, SettingsFile, 'error', SettingsFile.error)
        SettingsFile.error = ''
        self.default = (os.path.join(self.root, 'data'), os.path.join(self.root, 'Коммерческие предложения'))

    def path(self):
        return os.path.join(self.root, 'settings.json')

    def put(self, text):
        with open(self.path(), 'w', encoding='utf-8') as handle:
            handle.write(text)

    def test_missing_created_as_before(self):
        into = {}
        self.assertEqual(self.cls.dirs(self.root, into), self.default)
        with open(self.path(), encoding='utf-8') as handle:
            self.assertEqual(handle.read(), '{\n  "mode": "local",\n  "port": 17845,\n  "dataDir": "",\n  "docsShare": ""\n}\n')
        self.assertEqual((into, self.cls.error), ({}, ''))

    def test_data_dir(self):
        share = os.path.join(self.root, 'share')
        self.put(json.dumps({'mode': 'server', 'dataDir': share}))
        into = {}
        self.assertEqual(self.cls.dirs(self.root, into),
                         (os.path.join(share, 'data'), os.path.join(share, 'Коммерческие предложения')))
        self.assertEqual((into['mode'], self.cls.error), ('server', ''))

    def test_broken_reported(self):
        self.put('{"mode": "server", "dataDir": "D:\\\\KP",')
        into = {}
        self.assertEqual(self.cls.dirs(self.root, into), self.default)
        self.assertEqual(into, {})
        self.assertTrue(self.cls.error.startswith('JSONDecodeError'), self.cls.error)


class ActionJournal(LogCase):
    def test_lost_record_logged(self):
        import admin

        class Locked:
            def audit_add(self, rec):
                raise sqlite3.OperationalError('database is locked')

        handler = types.SimpleNamespace(headers={}, client_address=('127.0.0.1', 0))
        admin.log(handler, Locked(), 'edit_product', 'catalog', 'x1')  # работа продолжается
        found = [text for text in self.texts(ServerLog.ERROR) if 'edit_product' in text]
        self.assertEqual(len(found), 1, self.texts(ServerLog.ERROR))
        self.assertIn('database is locked', found[0])


class OverviewChecks(LogCase):
    def test_failed_check_logged_others_shown(self):
        from admin_overview import Attention

        store = TempStore(self).store
        attention = Attention(store, FakeConfig.make(self.dir))

        def _catalog():
            raise KeyError('нет поля')

        attention._catalog = _catalog
        self.assertIsInstance(attention.items(), list)
        self.assertTrue(any('проверка _catalog' in text for text in self.texts(ServerLog.ERROR)),
                        self.texts(ServerLog.ERROR))


class BitrixQueueMark(LogCase):
    def test_failed_mark_logged(self):
        from bitrix import BitrixQueue

        store = TempStore(self).store
        store.kv_set('bitrix', {'on': True, 'url': 'https://example.bitrix24.ru/rest/1/test/'})

        def locked(*_args):
            raise sqlite3.OperationalError('database is locked')

        store.write = locked
        BitrixQueue.touch(store, 'deal', 'd-1')  # сохранение сделки не прерывается
        self.assertTrue(any('очередь Битрикс24: deal d-1' in text for text in self.texts(ServerLog.ERROR)),
                        self.texts(ServerLog.ERROR))


class DealCardSections(LogCase):
    def test_refused_section_noted(self):
        from deal_econ import DealEcon

        class Refusing:
            def call(self, method, params):
                raise RuntimeError('insufficient_scope')

        conf = DealEcon(TempStore(self).store).discover(Refusing(), ['3'])
        self.assertEqual(conf['codes'], [])
        noted = [text for text in self.texts(ServerLog.INFO) if 'настройка карточки сделки' in text]
        self.assertEqual(len(noted), 2, noted)  # общая и воронка 3


class ImageSize(unittest.TestCase):
    def test_truncated_and_whole(self):
        import feeds

        png = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 640, 480)
        self.assertEqual(feeds._img_size(png), (640, 480))
        self.assertEqual(feeds._img_size(png[:20]), (None, None))
        self.assertEqual(feeds._img_size(b'\xff\xd8\xff\xc0\x00'), (None, None))


if __name__ == '__main__':
    unittest.main()
