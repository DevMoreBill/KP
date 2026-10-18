# -*- coding: utf-8 -*-
"""Подписать архив обновления (app/update_sign.UpdateSign) — для сборки на GitHub.

  python .github/scripts/sign_update.py sign <архив.zip>       закрытый ключ — переменная KP_UPDATE_KEY (64 hex-знака)
  python .github/scripts/sign_update.py sign <архив.zip> <файл ключа>
  python .github/scripts/sign_update.py gen <папка>             временный ключ проверок сборки: key.txt и public.txt
  python .github/scripts/sign_update.py check <архив.zip>       подпись ключом выпусков верна (иначе код 1)

Закрытый ключ выпусков хранится только в секретах репозитория (Settings → Secrets and variables → Actions → KP_UPDATE_KEY),
открытый — в UpdateSign.PUBLIC_KEYS. Ключ в журнал сборки не выводится.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'app'))
from ed25519 import Ed25519  # noqa: E402
from update_sign import UpdateSign  # noqa: E402


class SignTool:
    @staticmethod
    def seed(text):
        t = (text or '').strip().lower()
        if not UpdateSign.HEX.match(t):
            raise SystemExit('Нет закрытого ключа подписи (KP_UPDATE_KEY — 64 шестнадцатеричных знака)')
        return bytes.fromhex(t)

    @classmethod
    def sign(cls, path, key_file=None):
        if key_file:
            with open(key_file, encoding='utf-8') as f:
                seed = cls.seed(f.read())
        else:
            seed = cls.seed(os.environ.get('KP_UPDATE_KEY'))
        with open(path, 'rb') as f:
            data = UpdateSign.sign(f.read(), seed)
        with open(path, 'wb') as f:
            f.write(data)
        print('Подписан: %s (ключ %s…)' % (os.path.basename(path), Ed25519.public_key(seed).hex()[:12]))

    @staticmethod
    def check(path):
        import zipfile
        from app_update import UpdatePackage, UpdateError
        with open(path, 'rb') as f:
            data = f.read()
        try:
            pkg = UpdatePackage(data, list(UpdateSign.PUBLIC_KEYS))
        except (UpdateError, zipfile.BadZipFile) as e:
            raise SystemExit('Подпись не прошла проверку: %s' % e)
        print('Подпись верна: %s, версия %s' % (os.path.basename(path), pkg.version))

    @staticmethod
    def gen(folder):
        os.makedirs(folder, exist_ok=True)
        seed = os.urandom(32)
        with open(os.path.join(folder, 'key.txt'), 'w', encoding='utf-8') as f:
            f.write(seed.hex())
        with open(os.path.join(folder, 'public.txt'), 'w', encoding='utf-8') as f:
            f.write(Ed25519.public_key(seed).hex() + '\n')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == 'sign':
        SignTool.sign(a[1], a[2] if len(a) > 2 else None)
    elif len(a) == 2 and a[0] == 'check':
        SignTool.check(a[1])
    elif len(a) == 2 and a[0] == 'gen':
        SignTool.gen(a[1])
    else:
        raise SystemExit(__doc__)
