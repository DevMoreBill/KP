# -*- coding: utf-8 -*-
"""Копии базы в ZIP (storage.DbZip, maintenance.DbCopy, backup_mirror.MirrorBackup) на сгенерированной базе:
ежедневная копия и её проверка, распаковка, хранение 7 дней + 4 недели + 12 месяцев, перепаковка прежних копий без
сжатия, вторая папка, остатки прерванных копий, одновременные копии."""
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
import zipfile
from datetime import date, timedelta

from kit import SampleData
import maintenance
from backup_mirror import MirrorBackup
from maintenance import DbCopy
from storage import DbZip, Store


class BackupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.mkdtemp(prefix='kp-backup-')
        cls.data = os.path.join(cls.work, 'data')
        os.makedirs(os.path.join(cls.data, 'backup', 'auto'))
        cls.st = Store(os.path.join(cls.data, 'kp.sqlite3'))
        SampleData(items=1500, clients=300, kps=40).fill(cls.st)
        cls.auto = maintenance.auto_dir(cls.data)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.st.conn().close()
        except Exception:
            pass
        shutil.rmtree(cls.work, ignore_errors=True)

    def touch(self, folder, name, data=b'x', age=0):
        p = os.path.join(folder, name)
        with open(p, 'wb') as f:
            f.write(data)
        if age:
            t = time.time() - age
            os.utime(p, (t, t))
        return p

    def test_1_daily_copy(self):
        rec = DbCopy.daily(self.st, self.data)
        self.assertTrue(rec.get('ok') and rec.get('zip'), rec)
        self.assertTrue(rec['file'].endswith('.zip') and os.path.isfile(rec['file']))
        self.assertEqual([f for f in os.listdir(self.auto) if not f.endswith('.zip')], [], 'нет временных файлов')
        with zipfile.ZipFile(rec['file']) as z:
            self.assertEqual(z.namelist(), ['kp.sqlite3'])
            self.assertIsNone(z.testzip())
        self.assertLess(rec['bytes'], rec['db'] / 3, 'архив заметно меньше базы')
        self.assertEqual(DbCopy.daily(self.st, self.data).get('at'), rec.get('at'), 'повтор в тот же день не копирует')
        x = os.path.join(self.work, 'x.sqlite3')
        DbZip.unpack(rec['file'], x)
        self.assertEqual(DbZip.quick_check(x), 'ok')
        c = sqlite3.connect(x)
        try:
            self.assertEqual(c.execute('select count(*) from catalog').fetchone()[0], self.st.catalog_count())
        finally:
            c.close()

    def test_2_rotation(self):
        DbCopy.daily(self.st, self.data)
        today = date.today()
        for k in range(1, 400, 3):
            self.touch(self.auto, 'kp-%s.%s' % ((today - timedelta(days=k)).isoformat(), 'sqlite3' if k % 2 else 'zip'))
        DbCopy.rotate(self.auto)
        lst = DbCopy.listing(self.auto)
        keep = DbCopy.keep_set([b['date'] for b in lst])
        self.assertTrue(all(b['date'] in keep for b in lst) and len(lst) <= 1 + 7 + 4 + 12, len(lst))
        self.assertTrue(lst[0]['date'] == today.isoformat() and lst[0]['zip'], lst[0])
        d2 = (today - timedelta(days=1)).isoformat()
        for ext in ('zip', 'sqlite3'):
            self.touch(self.auto, 'kp-%s.%s' % (d2, ext), b'y')
        r2 = [b for b in DbCopy.listing(self.auto) if b['date'] == d2][0]
        self.assertTrue(len(r2['files']) == 2 and r2['zip'] and r2['file'].endswith('.zip'), r2)
        for f in os.listdir(self.auto):
            if not f.startswith('kp-%s' % today.isoformat()):
                os.remove(os.path.join(self.auto, f))

    def test_3_compress_old(self):
        today = date.today()
        db = os.path.join(self.data, 'kp.sqlite3')
        old_daily = os.path.join(self.auto, 'kp-%s.sqlite3' % (today - timedelta(days=2)).isoformat())
        old_once = os.path.join(self.data, 'backup', 'kp-20261001-120000-before-update-3.49.0.sqlite3')
        tmp_import = os.path.join(self.data, 'backup', 'import-abcd.sqlite3')        # служебный временный файл — не трогать
        for f in (old_daily, old_once, tmp_import):
            self.st.backup(f)
        size = os.path.getsize(old_daily)
        cr = DbCopy.compress_old(self.st, self.data)
        self.assertTrue(cr and cr['files'] == 2, cr)
        self.assertTrue(os.path.isfile(old_daily[:-8] + '.zip') and not os.path.exists(old_daily))
        self.assertTrue(os.path.isfile(old_once[:-8] + '.zip') and not os.path.exists(old_once))
        self.assertTrue(os.path.isfile(tmp_import))
        self.assertGreater(cr['saved'], 2 * size * 0.6, cr)
        self.assertIsNone(DbCopy.compress_old(self.st, self.data), 'повторно — нечего')
        self.assertEqual(DbCopy.others(self.data)['count'], 1)
        s = maintenance.summary(self.st, self.data)
        self.assertTrue(s['others']['count'] == 1 and s['compressed']['files'] == 2 and s['dbBytes'] > 0, s)
        os.remove(tmp_import)
        self.assertTrue(os.path.getsize(db) > 0)

    def test_4_second_folder(self):
        today = date.today()
        DbCopy.daily(self.st, self.data)
        second = os.path.join(self.work, 'second')
        os.makedirs(second)
        self.touch(second, 'kp-%s.sqlite3' % today.isoformat(), b'old')
        for k in range(1, 20):
            self.touch(second, 'kp-%s.zip' % (today - timedelta(days=k)).isoformat(), b'z')
        cfg = self.st.kv_get('settings') or {}
        cfg['backup2'] = {'on': True, 'path': second, 'keep': 5, 'images': False}
        self.st.kv_set('settings', cfg)
        mr = MirrorBackup(self.st, self.data).run()
        self.assertTrue(mr and mr.get('ok'), mr)
        names = sorted(os.listdir(second))
        self.assertIn('kp-%s.zip' % today.isoformat(), names)
        self.assertNotIn('kp-%s.sqlite3' % today.isoformat(), names, 'прежняя копия за сегодня без сжатия убрана')
        self.assertEqual(len([n for n in names if n.startswith('kp-')]), 5, names)

    def test_5_store_backup(self):
        z = self.st.backup_checked(os.path.join(self.work, 'one.zip'))
        self.assertTrue(zipfile.is_zipfile(z))
        s = self.st.backup(os.path.join(self.work, 'one.sqlite3'))
        with open(s, 'rb') as f:
            self.assertEqual(f.read(16), b'SQLite format 3\x00')
        dst = os.path.join(self.work, 'two.zip')
        self.touch(self.work, 'two.zip.tmp', b'garbage' * 100)
        self.st.backup_checked(dst)
        self.assertTrue(zipfile.is_zipfile(dst) and not os.path.exists(dst + '.tmp'), 'копия поверх остатка прерванной')

    def test_6_leftovers(self):
        stale = ['kp-2026-10-01.zip.tmp', 'kp-2026-10-01.zip.tmp-journal', 'kp-2026-10-01.zip.part']
        for n in stale:
            self.touch(self.auto, n, age=7200)
        self.touch(self.auto, 'kp-2026-10-02.zip.tmp')
        bk = os.path.join(self.data, 'backup')
        for n in ('export-abcd1234.zip', 'export-abcd1234.zip.tmp', 'import-abcd1234.sqlite3', 'import-abcd1234.sqlite3-wal',
                  'kp-20261001-120000-before-update-3.49.0.zip.part', 'notes.txt'):
            self.touch(bk, n, age=7200)
        DbCopy.rotate(self.auto)
        left = os.listdir(self.auto)
        self.assertFalse(any(n in left for n in stale), left)
        self.assertIn('kp-2026-10-02.zip.tmp', left, 'свежий временный файл остаётся: копия могла ещё идти')
        os.remove(os.path.join(self.auto, 'kp-2026-10-02.zip.tmp'))
        self.assertEqual(DbCopy.sweep(bk), 5)
        self.assertIn('notes.txt', os.listdir(bk))

    def test_7_parallel_copies(self):
        res = []
        ts = [threading.Thread(target=lambda: res.append(DbCopy.daily(self.st, self.data, force=True))) for _ in range(2)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertTrue(len(res) == 2 and all(r.get('ok') for r in res), res)
        self.assertEqual([f for f in os.listdir(self.auto) if f.endswith(('.tmp', '.part'))], [])


class DbZipTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='kp-zip-')
        self.addCleanup(shutil.rmtree, self.d, True)

    def archive(self, name, members):
        p = os.path.join(self.d, name)
        with zipfile.ZipFile(p, 'w') as z:
            for n, data in members.items():
                z.writestr(n, data)
        return p

    def test_member_path_is_ignored(self):
        """Имя файла внутри архива (../evil.sqlite3) не задаёт, куда распаковывать: только в указанный файл."""
        src = self.archive('evil.zip', {'../evil.sqlite3': b'SQLite format 3\x00'})
        out = os.path.join(self.d, 'out.sqlite3')
        DbZip.unpack(src, out)
        self.assertTrue(os.path.isfile(out))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.d), 'evil.sqlite3')))

    def test_bad_archives(self):
        with self.assertRaises(ValueError):
            DbZip.unpack(self.archive('empty.zip', {'readme.txt': b'x'}), os.path.join(self.d, 'o.sqlite3'))
        with self.assertRaises(ValueError):
            DbZip.verify(self.archive('nodb.zip', {'readme.txt': b'x'}))
        broken = os.path.join(self.d, 'broken.zip')
        with open(broken, 'wb') as f:
            f.write(b'PK\x03\x04 not a zip')
        with self.assertRaises(ValueError):
            DbZip.verify(broken)


if __name__ == '__main__':
    unittest.main()
