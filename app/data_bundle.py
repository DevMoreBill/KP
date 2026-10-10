# -*- coding: utf-8 -*-
"""Выгрузка и загрузка данных архивом: резервная копия JSON + изображения, на которые в ней есть ссылки.

Архив «КП_выгрузка_….zip»:
  kp-backup.json            — та же резервная копия, что и «.json» (format kp-backup, version 1)
  img/<путь внутри data/img> — фото, галереи, логотипы выгруженных позиций и КП (адрес в программе — /img/<путь>)

При загрузке изображения кладутся на свои места в data/img; уже имеющиеся файлы не перезаписываются,
пути наружу из data/img и не картинки отбрасываются.
"""
import io
import json
import os
import re
import zipfile

from images import EXTS, ImageStore


class DataBundle:
    JSON_NAME = 'kp-backup.json'
    IMG_PREFIX = 'img/'
    MAX_IMAGE = 30 * 1024 * 1024
    MAX_IMAGES = 50000
    # адрес /img/… в тексте копии; в КП (состояние хранится строкой JSON) кавычка после адреса экранирована — \"
    REF = re.compile(r'/img/([^"\\?#]+?\.(?:jpg|jpeg|png|webp))(?=\\?")', re.I)

    def __init__(self, img_dir):
        self.images = ImageStore(img_dir)

    # ---------- выгрузка ----------
    @classmethod
    def refs(cls, text):
        """Адреса изображений (путь внутри data/img), на которые ссылается текст резервной копии."""
        return sorted(set(m.group(1) for m in cls.REF.finditer(text)))

    def pack(self, body):
        """zip: kp-backup.json + изображения из ссылок. → (байты архива, сколько изображений вошло, сколько не найдено)."""
        buf, found, missing = io.BytesIO(), 0, 0
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr(self.JSON_NAME, body)
            for rel in self.refs(body):
                f = self.images.path(rel)
                if not f:
                    missing += 1
                    continue
                z.write(f, self.IMG_PREFIX + rel, compress_type=zipfile.ZIP_STORED)   # jpg/png/webp уже сжаты
                found += 1
        return buf.getvalue(), found, missing

    # ---------- загрузка ----------
    @staticmethod
    def is_image(data):
        """JPEG, PNG или WebP по содержимому, а не только по расширению."""
        return data[:3] == b'\xff\xd8\xff' or data[:8] == b'\x89PNG\r\n\x1a\n' or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')

    @staticmethod
    def is_zip(data):
        return data[:2] == b'PK'

    def read(self, data):
        """Файл .json или .zip → (резервная копия dict, открытый архив или None, список изображений архива)."""
        if not data:
            raise ValueError('Файл пустой')
        if not self.is_zip(data):
            try:
                return json.loads(data.decode('utf-8-sig')), None, []
            except (ValueError, UnicodeDecodeError):
                raise ValueError('Это не резервная копия программы: нужен файл «КП_резервная_копия_….json» или «КП_выгрузка_….zip»')
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('Архив повреждён')
        names = z.namelist()
        doc = self.JSON_NAME if self.JSON_NAME in names else next((n for n in names if n.lower().endswith('.json') and '/' not in n), None)
        if not doc:
            raise ValueError('В архиве нет резервной копии (kp-backup.json)')
        try:
            d = json.loads(z.read(doc).decode('utf-8-sig'))
        except (ValueError, UnicodeDecodeError):
            raise ValueError('Резервная копия в архиве повреждена')
        imgs = [i for i in z.infolist() if i.filename.startswith(self.IMG_PREFIX) and not i.is_dir()][:self.MAX_IMAGES]
        return d, z, imgs

    def _target(self, name):
        rel = name[len(self.IMG_PREFIX):]
        if '..' in rel.replace('\\', '/').split('/') or not rel.lower().endswith(EXTS):
            return None, None
        return rel, self.images.target(rel)

    def plan(self, imgs):
        """Сколько изображений добавится, сколько уже есть, сколько отброшено."""
        new = have = bad = 0
        for i in imgs:
            rel, f = self._target(i.filename)
            if not f or i.file_size > self.MAX_IMAGE:
                bad += 1
            elif self.images.path(rel):
                have += 1
            else:
                new += 1
        return {'new': new, 'exist': have, 'invalid': bad}

    def write(self, z, imgs):
        """Записать недостающие изображения → сколько записано."""
        n = 0
        for i in imgs:
            rel, f = self._target(i.filename)
            if not f or i.file_size > self.MAX_IMAGE or self.images.path(rel):
                continue
            data = z.read(i)
            if len(data) > self.MAX_IMAGE or not self.is_image(data):
                continue
            os.makedirs(os.path.dirname(f), exist_ok=True)
            tmp = f + '.part'
            with open(tmp, 'wb') as fh:
                fh.write(data)
            os.replace(tmp, f)
            n += 1
        return n
