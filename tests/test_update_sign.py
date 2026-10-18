# -*- coding: utf-8 -*-
"""Подпись пакета обновления (update_sign.UpdateSign, ed25519.Ed25519): устанавливается только архив, подписанный
доверенным ключом; изменённый файл, лишний файл, чужой ключ и архив без подписи — отказ; «zip-бомба» — отказ."""
import io
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
from app_update import UpdateError, UpdatePackage
from ed25519 import Ed25519
from update_sign import UpdateSign


class UpdateSignTest(unittest.TestCase):
    SEED = bytes(range(32))

    def pkg(self, ver='9.9.9', extra=None, prefix='Обновление КП 9.9.9/'):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr(prefix + 'update/version.json', '{"version": "%s"}' % ver)
            z.writestr(prefix + 'update/app/kp_server.py', 'print(1)')
            z.writestr(prefix + 'update/app/web/index.html', '<html></html>')
            z.writestr(prefix + 'server-setup/kp-server.ps1', 'Write-Host 1')
            for n, t in (extra or {}).items():
                z.writestr(n, t)
        return b.getvalue()

    def keys(self):
        return [Ed25519.public_key(self.SEED).hex()]

    def test_signed_ok(self):
        data = UpdateSign.sign(self.pkg(), self.SEED)
        p = UpdatePackage(data, self.keys())
        self.assertEqual(p.version, '9.9.9')
        self.assertNotIn('kp-sign.json', [n for n, _ in p.files('update')])

    def test_refused(self):
        with self.assertRaisesRegex(UpdateError, 'не подписан'):
            UpdatePackage(self.pkg(), self.keys())
        with self.assertRaisesRegex(UpdateError, 'неизвестным ключом'):
            UpdatePackage(UpdateSign.sign(self.pkg(), os.urandom(32)), self.keys())
        signed = UpdateSign.sign(self.pkg(), self.SEED)
        # подменён один файл
        src = zipfile.ZipFile(io.BytesIO(signed))
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            for i in src.infolist():
                z.writestr(i.filename, b'evil' if i.filename.endswith('kp_server.py') else src.read(i))
        with self.assertRaisesRegex(UpdateError, 'изменён'):
            UpdatePackage(b.getvalue(), self.keys())
        # добавлен файл
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            for i in src.infolist():
                z.writestr(i.filename, src.read(i))
            z.writestr('Обновление КП 9.9.9/update/app/evil.py', 'x')
        with self.assertRaisesRegex(UpdateError, 'не те файлы'):
            UpdatePackage(b.getvalue(), self.keys())
        # подпись от другой версии
        with self.assertRaises(UpdateError):
            other = zipfile.ZipFile(io.BytesIO(UpdateSign.sign(self.pkg('9.9.8'), self.SEED)))
            b = io.BytesIO()
            with zipfile.ZipFile(b, 'w') as z:
                for i in src.infolist():
                    z.writestr(i.filename, other.read(i.filename) if i.filename.endswith('kp-sign.json') else src.read(i))
            UpdatePackage(b.getvalue(), self.keys())

    def test_zip_bomb(self):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('update/version.json', '{"version": "9.9.9"}')
            z.writestr('update/app/kp_server.py', 'x')
            z.writestr('update/app/web/index.html', 'x')
            z.writestr('update/big.bin', b'\0' * (UpdatePackage.MAX_UNPACKED + 1))
        with self.assertRaisesRegex(UpdateError, 'слишком большой объём'):
            UpdatePackage(b.getvalue())

    def test_local_keys_file(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        self.assertEqual(UpdateSign.keys(d), list(UpdateSign.PUBLIC_KEYS))
        with open(os.path.join(d, UpdateSign.LOCAL_KEYS), 'w') as f:
            f.write(self.keys()[0] + '\nмусор\n')
        self.assertIn(self.keys()[0], UpdateSign.keys(d))
        UpdatePackage(UpdateSign.sign(self.pkg(), self.SEED), UpdateSign.keys(d))

    def test_release_key_is_valid_point(self):
        for k in UpdateSign.PUBLIC_KEYS:
            self.assertIsNotNone(Ed25519._decompress(bytes.fromhex(k)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
