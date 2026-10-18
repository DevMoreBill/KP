# -*- coding: utf-8 -*-
"""Подпись пакета обновления «KP-Obnovlenie-….zip».

В архиве рядом с папкой update лежит kp-sign.json: версия, SHA-256 каждого файла архива и подпись Ed25519 этого списка.
Выпуск подписывает сборка (секрет KP_UPDATE_KEY, .github/scripts/sign_update.py); программа устанавливает из «Настроек»
и ночью только архив с верной подписью ключом из PUBLIC_KEYS (или из файла update-keys.txt в папке программы — его
может положить только тот, у кого есть доступ к папке программы на сервере; так делают проверки сборки).
"""
import hashlib
import io
import json
import os
import re
import zipfile

from ed25519 import Ed25519


class UpdateSign:
    NAME = 'kp-sign.json'
    PUBLIC_KEYS = ('6e5339357c2dbf594deefbf0d8891415f781cbd26753de0bb4fa8b9ccb41b5f7',)     # ключ выпусков (открытый)
    LOCAL_KEYS = 'update-keys.txt'
    HEX = re.compile(r'^[0-9a-f]{64}\Z')

    @staticmethod
    def norm(n):
        n = n.replace('\\', '/')
        while n.startswith('./'):
            n = n[2:]
        return n

    @classmethod
    def prefix(cls, names):
        for n in names:
            if n.endswith('update/version.json'):
                return n[:-len('update/version.json')]
        return ''

    @staticmethod
    def _message(version, files):
        return json.dumps({'v': 1, 'version': version, 'files': files}, sort_keys=True, ensure_ascii=False,
                          separators=(',', ':')).encode('utf-8')

    @staticmethod
    def _sha(z, info):
        h = hashlib.sha256()
        with z.open(info) as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        return h.hexdigest()

    @classmethod
    def keys(cls, root=None):
        """Доверенные открытые ключи: вшитые + из update-keys.txt в папке программы."""
        out = list(cls.PUBLIC_KEYS)
        p = os.path.join(root, cls.LOCAL_KEYS) if root else None
        if p and os.path.isfile(p):
            with open(p, encoding='utf-8-sig') as f:
                out += [ln.strip().lower() for ln in f if cls.HEX.match(ln.strip().lower())]
        return out

    @classmethod
    def sign(cls, data, seed):
        """Архив data (bytes) → тот же архив с kp-sign.json, подписанным закрытым ключом seed (32 байта)."""
        src = zipfile.ZipFile(io.BytesIO(data))
        infos = [i for i in src.infolist() if not i.is_dir() and not cls.norm(i.filename).endswith('/' + cls.NAME)
                 and cls.norm(i.filename) != cls.NAME]
        names = [cls.norm(i.filename) for i in infos]
        pre = cls.prefix(names)
        version = json.loads(src.read(infos[names.index(pre + 'update/version.json')]).decode('utf-8-sig'))['version']
        files = {cls.norm(i.filename): cls._sha(src, i) for i in infos}
        msg = cls._message(version, files)
        doc = {'v': 1, 'version': version, 'files': files, 'key': Ed25519.public_key(seed).hex(), 'sig': Ed25519.sign(seed, msg).hex()}
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
            for i in infos:
                dst.writestr(i, src.read(i))
            dst.writestr(pre + cls.NAME, json.dumps(doc, ensure_ascii=False, indent=1))
        return out.getvalue()

    @classmethod
    def check(cls, z, names, prefix, version, keys):
        """Проверить подпись архива; names — {нормализованное имя: ZipInfo}. Ошибка — ValueError с текстом для администратора."""
        info = names.get(prefix + cls.NAME)
        if info is None:
            raise ValueError('архив не подписан — устанавливаются только выпуски программы (KP-Obnovlenie-….zip с GitHub)')
        try:
            doc = json.loads(z.read(info).decode('utf-8'))
            files, key, sig = doc['files'], str(doc['key']).lower(), bytes.fromhex(doc['sig'])
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            raise ValueError('подпись архива повреждена')
        if key not in keys:
            raise ValueError('архив подписан неизвестным ключом')
        if str(doc.get('version')) != version or not isinstance(files, dict):
            raise ValueError('подпись не от этой версии')
        if not Ed25519.verify(bytes.fromhex(key), cls._message(version, files), sig):
            raise ValueError('подпись архива неверна — файл изменён после выпуска')
        mine = {n for n in names if n != prefix + cls.NAME}
        if mine != set(files):
            raise ValueError('в архиве не те файлы, что подписаны при выпуске')
        for n in mine:
            if cls._sha(z, names[n]) != files[n]:
                raise ValueError('файл %s изменён после выпуска' % n.split('/')[-1][:80])
