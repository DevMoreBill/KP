"""Подпись пакета обновления: kp-sign.json — SHA-256 файлов архива и подпись Ed25519."""

import hashlib
import io
import json
import os
import re
import zipfile

from ed25519 import Ed25519


class UpdateSign:
    NAME = 'kp-sign.json'
    PUBLIC_KEYS = ('6e5339357c2dbf594deefbf0d8891415f781cbd26753de0bb4fa8b9ccb41b5f7',)
    LOCAL_KEYS = 'update-keys.txt'
    HEX = re.compile(r'^[0-9a-f]{64}\Z')

    @staticmethod
    def norm(name: str) -> str:
        name = name.replace('\\', '/')
        while name.startswith('./'):
            name = name[2:]
        return name

    @classmethod
    def prefix(cls, names: list[str]) -> str:
        for name in names:
            if name.endswith('update/version.json'):
                return name[: -len('update/version.json')]
        return ''

    @staticmethod
    def _message(version: str, files: dict) -> bytes:
        return json.dumps(
            {'v': 1, 'version': version, 'files': files}, sort_keys=True, ensure_ascii=False, separators=(',', ':')
        ).encode('utf-8')

    @staticmethod
    def _sha(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> str:
        digest = hashlib.sha256()
        with z.open(info) as file:
            for chunk in iter(lambda: file.read(1 << 20), b''):
                digest.update(chunk)
        return digest.hexdigest()

    @classmethod
    def keys(cls, root: str | None = None) -> list[str]:
        """Вшитые открытые ключи + update-keys.txt в папке программы."""
        out = list(cls.PUBLIC_KEYS)
        path = os.path.join(root, cls.LOCAL_KEYS) if root else None
        if path and os.path.isfile(path):
            with open(path, encoding='utf-8-sig') as file:
                out += [line.strip().lower() for line in file if cls.HEX.match(line.strip().lower())]
        return out

    @classmethod
    def sign(cls, data: bytes, seed: bytes) -> bytes:
        """Архив → тот же архив с kp-sign.json, подписанным закрытым ключом seed."""
        src = zipfile.ZipFile(io.BytesIO(data))
        infos = [
            i
            for i in src.infolist()
            if not i.is_dir() and not cls.norm(i.filename).endswith('/' + cls.NAME) and cls.norm(i.filename) != cls.NAME
        ]
        names = [cls.norm(i.filename) for i in infos]
        pre = cls.prefix(names)
        version = json.loads(src.read(infos[names.index(pre + 'update/version.json')]).decode('utf-8-sig'))['version']
        files = {cls.norm(i.filename): cls._sha(src, i) for i in infos}
        msg = cls._message(version, files)
        doc = {
            'v': 1,
            'version': version,
            'files': files,
            'key': Ed25519.public_key(seed).hex(),
            'sig': Ed25519.sign(seed, msg).hex(),
        }
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
            for i in infos:
                dst.writestr(i, src.read(i))
            dst.writestr(pre + cls.NAME, json.dumps(doc, ensure_ascii=False, indent=1))
        return out.getvalue()

    @classmethod
    def check(cls, z: zipfile.ZipFile, names: dict, prefix: str, version: str, keys: list[str]) -> None:
        """names — {нормализованное имя: ZipInfo}; ошибка — ValueError с текстом для администратора."""
        info = names.get(prefix + cls.NAME)
        if info is None:
            raise ValueError(
                'архив не подписан — устанавливаются только выпуски программы (KP-Obnovlenie-….zip с GitHub)'
            )
        try:
            doc = json.loads(z.read(info).decode('utf-8'))
            files, key, sig = doc['files'], str(doc['key']).lower(), bytes.fromhex(doc['sig'])
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            raise ValueError('подпись архива повреждена') from None
        if key not in keys:
            raise ValueError('архив подписан неизвестным ключом')
        if str(doc.get('version')) != version or not isinstance(files, dict):
            raise ValueError('подпись не от этой версии')
        if not Ed25519.verify(bytes.fromhex(key), cls._message(version, files), sig):
            raise ValueError('подпись архива неверна — файл изменён после выпуска')
        mine = {name for name in names if name != prefix + cls.NAME}
        if mine != set(files):
            raise ValueError('в архиве не те файлы, что подписаны при выпуске')
        for name in mine:
            if cls._sha(z, names[name]) != files[name]:
                raise ValueError(f'файл {name.split("/")[-1][:80]} изменён после выпуска')
