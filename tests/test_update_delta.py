# -*- coding: utf-8 -*-
"""Пакет обновления «только изменения» (app_update.UpdateDelta, .github/scripts/update_delta.py): в пакете — изменённые
файлы, новая папка update собирается из работающей версии (встроенной в EXE или прежнего обновления) и сверяется по SHA-256;
пакет к другой версии и испорченная основа — отказ с подсказкой про полный пакет; старая программа пакет изменений не
примет (нет update/); выбор пакета при скачивании с GitHub. Вымышленные файлы."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'app'))
sys.path.insert(0, os.path.join(HERE, '..', '.github', 'scripts'))
from app_update import ReleaseSource, UpdateError, UpdatePackage, Updater  # noqa: E402
from ed25519 import Ed25519  # noqa: E402
from update_delta import DeltaBuilder  # noqa: E402
from update_sign import UpdateSign  # noqa: E402

SEED = bytes(range(32))
KEYS = [Ed25519.public_key(SEED).hex()]


def tree(ver, changes=None):
    """Файлы версии ver (как в папке update): изменения — {путь: текст | None — удалить}."""
    files = {
        'version.json': '{"version": "%s"}' % ver,
        'app/version.py': "VERSION = '%s'\n" % ver,
        'app/kp_server.py': 'STARTED = False\n',
        'app/storage.py': 'class Store: pass\n',
        'app/web/index.html': '<html>%s</html>' % ver,
        'app/web/js/main.js': 'export class App {}\n',
        'app/web/css/app.css': 'body{}\n',
        'app/equipment_types.json': '[]',
        'templates/pnevmotekh/template.json': '{}',
    }
    for rel, text in (changes or {}).items():
        if text is None:
            files.pop(rel, None)
        else:
            files[rel] = text
    return files


def full_zip(path, files):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, text in files.items():
            z.writestr('Обновление КП/update/' + rel, text)
        z.writestr('Обновление КП/server-setup/kp-server.ps1', 'Write-Host 1')
    return path


def write_tree(folder, files):
    for rel, text in files.items():
        path = os.path.join(folder, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)


def read_tree(folder):
    out = {}
    for d, _, names in os.walk(folder):
        for n in names:
            p = os.path.join(d, n)
            with open(p, encoding='utf-8') as f:
                out[os.path.relpath(p, folder).replace(os.sep, '/')] = f.read()
    return out


class FakeStore:
    def __init__(self):
        self.kv = {}

    def kv_get(self, key):
        return self.kv.get(key)

    def kv_set(self, key, value):
        self.kv[key] = value

    def backup(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').close()


class Box(Updater):
    """Updater с работающей версией cur (в программе её даёт модуль version)."""

    def __init__(self, root, bundle, cur):
        super().__init__(FakeStore(), root, os.path.join(root, 'data'), bundle=bundle)
        self.cur = cur

    def current(self):
        return self.cur


class DeltaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='kp-delta-')
        self.root = os.path.join(self.tmp, 'KP')
        os.makedirs(self.root)
        # встроенное в EXE: интерфейс, справочник, шаблоны (модулей .py в EXE как файлов нет)
        self.bundle = os.path.join(self.tmp, 'bundle')
        write_tree(self.bundle, {k: v for k, v in tree('1.0.0').items() if not k.endswith('.py') and k != 'version.json'})

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def delta(self, old, new):
        a = full_zip(os.path.join(self.tmp, 'old.zip'), old)
        b = full_zip(os.path.join(self.tmp, 'new.zip'), new)
        path = DeltaBuilder.build(b, a, os.path.join(self.tmp, 'out'))
        with open(path, 'rb') as f:
            return path, UpdateSign.sign(f.read(), SEED)

    def install(self, box, data):
        with unittest.mock.patch('app_update.UpdateSign.keys', return_value=KEYS):
            return box.install(data, 'тест')

    def test_builder_only_changed(self):
        path, data = self.delta(tree('1.0.0'), tree('1.0.1', {'app/web/js/main.js': 'export class App { go() {} }\n'}))
        self.assertTrue(path.endswith('KP-Obnovlenie-1.0.1-ot-1.0.0.zip'))
        names = sorted(n for n in zipfile.ZipFile(io.BytesIO(data)).namelist() if n.startswith('delta/'))
        self.assertEqual(names, ['delta/app/kp_server.py', 'delta/app/version.py', 'delta/app/web/index.html',
                                 'delta/app/web/js/main.js', 'delta/delta.json', 'delta/version.json'])
        pkg = UpdatePackage(data, KEYS)
        self.assertEqual((pkg.version, pkg.base, pkg.delta), ('1.0.1', '1.0.0', True))
        self.assertIsNone(DeltaBuilder.build(full_zip(os.path.join(self.tmp, 'a.zip'), tree('1.0.1')),
                                             full_zip(os.path.join(self.tmp, 'b.zip'), tree('1.0.1')), self.tmp))

    def test_install_over_exe_then_over_update(self):
        new = tree('1.0.1', {'app/web/js/main.js': 'export class App { a() {} }\n', 'app/storage.py': 'class Store: x = 1\n',
                             'app/web/css/app.css': None, 'app/web/js/new.js': 'export class New {}\n'})
        _, data = self.delta(tree('1.0.0'), new)
        res = self.install(Box(self.root, self.bundle, '1.0.0'), data)
        self.assertEqual(res['version'], '1.0.1')
        got = read_tree(os.path.join(self.root, 'update'))
        self.assertNotIn('app/web/css/app.css', got, 'удалённый файл не переносится')
        self.assertEqual(got['app/web/js/new.js'], 'export class New {}\n')
        self.assertEqual(got['templates/pnevmotekh/template.json'], '{}', 'неизменённое — из EXE')
        self.assertEqual(got['app/storage.py'], 'class Store: x = 1\n')
        self.assertEqual(json.loads(got['version.json'])['version'], '1.0.1')
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update', 'delta.json')))
        # следующая версия — поверх установленного обновления; неизменённые модули .py остаются из папки
        newer = dict(new, **{'version.json': '{"version": "1.0.2"}', 'app/version.py': "VERSION = '1.0.2'\n",
                             'app/web/index.html': '<html>1.0.2</html>'})
        _, data = self.delta(new, newer)
        self.install(Box(self.root, self.bundle, '1.0.1'), data)
        self.assertEqual(read_tree(os.path.join(self.root, 'update')), newer)
        self.assertEqual(json.loads(read_tree(os.path.join(self.root, 'update.prev'))['version.json'])['version'], '1.0.1')

    def test_refusals(self):
        _, data = self.delta(tree('1.0.0'), tree('1.0.1'))
        with self.assertRaisesRegex(UpdateError, 'к версии 1.0.0, а работает 0.9.0 — загрузите полный пакет'):
            self.install(Box(self.root, self.bundle, '0.9.0'), data)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'data', 'backup')), 'до проверки версии копию базы не делаем')
        # основа отличается (файл EXE не тот) — отказ, папка update не создаётся
        write_tree(self.bundle, {'app/web/js/main.js': 'испорчено'})
        with self.assertRaisesRegex(UpdateError, r'отличаются от версии 1.0.0 \(main.js\).*KP-Obnovlenie-1.0.1.zip'):
            self.install(Box(self.root, self.bundle, '1.0.0'), data)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update')))
        # старая программа ищет update/ — пакет изменений для неё не обновление
        old_required = ('update/version.json', 'update/app/kp_server.py', 'update/app/web/index.html')
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        self.assertFalse(any(n.endswith(req) for n in names for req in old_required))

    def test_tampered_manifest(self):
        _, data = self.delta(tree('1.0.0'), tree('1.0.1'))
        src = zipfile.ZipFile(io.BytesIO(data))
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            for i in src.infolist():
                z.writestr(i.filename, src.read(i))
            z.writestr('delta/app/evil.py', 'x')
        with self.assertRaisesRegex(UpdateError, 'не те файлы'):
            UpdatePackage(b.getvalue(), KEYS)
        unsigned = io.BytesIO()
        with zipfile.ZipFile(unsigned, 'w') as z:
            for i in src.infolist():
                if not i.filename.endswith('kp-sign.json'):
                    z.writestr(i.filename, src.read(i))
            z.writestr('delta/app/evil.py', 'x')
        with self.assertRaisesRegex(UpdateError, 'лишний файл'):
            UpdatePackage(unsigned.getvalue())

    def test_release_assets(self):
        rel = {'tag_name': 'v1.0.2', 'assets': [
            {'id': 1, 'name': 'KP-Obnovlenie-1.0.2.zip', 'size': 4000000},
            {'id': 2, 'name': 'KP-Obnovlenie-1.0.2-ot-1.0.1.zip', 'size': 300000},
            {'id': 3, 'name': 'KP-Obnovlenie-1.0.1-ot-1.0.0.zip', 'size': 300000},
        ]}
        src = ReleaseSource('DevMoreBill/KP')
        resp = io.BytesIO(json.dumps(rel).encode())
        with unittest.mock.patch.object(ReleaseSource, '_open', return_value=resp):
            last = src.latest()
        self.assertEqual([d['base'] for d in last['deltas']], ['1.0.1'])
        box = Box(self.root, self.bundle, '1.0.1')
        self.assertEqual(box._delta_asset(last)['id'], 2)
        self.assertIsNone(Box(self.root, self.bundle, '1.0.0')._delta_asset(last), 'пропущена версия — полный пакет')
        web = {'version': '1.0.2', 'tag': 'v1.0.2', 'asset': {'id': 0, 'url': 'https://github.com/DevMoreBill/KP/x'}}
        self.assertTrue(box._delta_asset(web)['url'].endswith('/v1.0.2/KP-Obnovlenie-1.0.2-ot-1.0.1.zip'))
        box.store.kv_set('settings', {'features': {'updDelta': False}})
        self.assertIsNone(box._delta_asset(last), 'выключено — полный пакет')


if __name__ == '__main__':
    unittest.main()
