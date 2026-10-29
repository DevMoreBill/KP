# -*- coding: utf-8 -*-
"""Пакет обновления «только изменения» (app/app_update.UpdatePackage, папка delta) — для сборки на GitHub.

  python .github/scripts/update_delta.py <новый полный.zip> <полный пакет прошлого выпуска.zip> <папка для пакета>

В пакет — файлы, которые отличаются от прошлого выпуска (по SHA-256), всегда — version.json, app/version.py,
app/kp_server.py и app/web/index.html (их ищет загрузчик EXE), delta.json со списком SHA-256 всех файлов новой версии и
файлы server-setup. Имя — KP-Obnovlenie-<версия>-ot-<прошлая версия>.zip; подпись — sign_update.py, как у полного.
Прошлый выпуск не старше нового — пакета нет (код 0, сообщение).
"""
import hashlib
import io
import json
import os
import sys
import zipfile


class FullPackage:
    """Полный пакет обновления: файлы папки update и server-setup."""

    SIGN = 'kp-sign.json'

    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        names = [i.filename.replace('\\', '/') for i in self.zip.infolist() if not i.is_dir()]
        head = next((n for n in names if n == 'update/version.json' or n.endswith('/update/version.json')), None)
        if head is None:
            raise SystemExit('%s — не полный пакет обновления (нет update/version.json)' % path)
        self.prefix = head[: -len('update/version.json')]
        self.infos = {i.filename.replace('\\', '/'): i for i in self.zip.infolist() if not i.is_dir()}
        self.version = json.loads(self.read('update', 'version.json').decode('utf-8-sig'))['version']

    def files(self, folder):
        """{путь внутри folder: ZipInfo}."""
        start = self.prefix + folder + '/'
        return {name[len(start):]: info for name, info in self.infos.items()
                if name.startswith(start) and '__pycache__' not in name and not name.endswith('/' + self.SIGN)}

    def read(self, folder, rel):
        return self.zip.read(self.infos[self.prefix + folder + '/' + rel])

    def shas(self):
        return {rel: hashlib.sha256(self.zip.read(info)).hexdigest() for rel, info in self.files('update').items()}


class DeltaBuilder:
    ALWAYS = ('version.json', 'app/version.py', 'app/kp_server.py', 'app/web/index.html')

    @staticmethod
    def newer(a, b):
        return tuple(int(x) for x in a.split('.')) > tuple(int(x) for x in b.split('.'))

    @classmethod
    def build(cls, new_path, old_path, out_dir):
        new, old = FullPackage(new_path), FullPackage(old_path)
        if not cls.newer(new.version, old.version):
            print('Пакета изменений нет: прошлый выпуск %s не старше %s' % (old.version, new.version))
            return None
        shas, before = new.shas(), old.shas()
        changed = sorted(rel for rel, sha in shas.items() if before.get(rel) != sha or rel in cls.ALWAYS)
        doc = {'version': new.version, 'base': old.version, 'files': shas}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            for rel in changed:
                z.writestr('delta/' + rel, new.read('update', rel))
            z.writestr('delta/delta.json', json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True))
            for rel in sorted(new.files('server-setup')):
                z.writestr('server-setup/' + rel, new.read('server-setup', rel))
        path = os.path.join(out_dir, 'KP-Obnovlenie-%s-ot-%s.zip' % (new.version, old.version))
        os.makedirs(out_dir, exist_ok=True)
        with open(path, 'wb') as f:
            f.write(buf.getvalue())
        gone = sorted(set(before) - set(shas))
        print('Пакет изменений %s → %s: файлов %d из %d, удалено %d, %d КБ' % (
            old.version, new.version, len(changed), len(shas), len(gone), len(buf.getvalue()) // 1024))
        return path


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    DeltaBuilder.build(*sys.argv[1:])
