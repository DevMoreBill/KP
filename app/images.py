# -*- coding: utf-8 -*-
"""Хранилище изображений оборудования (папка data/img). Пути — только латиница, цифры и «-» (без русских букв,
пробелов и спецсимволов, чтобы не было проблем с архивами, сетевыми папками и резервным копированием):

  data/img/<раздел>/<категория>/<производитель>/<модель>__<отпечаток>.jpg        фото позиции
  data/img/<раздел>/<категория>/<производитель>/<модель>--<подпись>__<отпечаток>.jpg   изображения галереи
  data/img/logos/<производитель>__<отпечаток>.png                                логотипы
  data/img/unused/…                                                              изображения, на которые нет ссылок

Пример: data/img/compressors/screw-compressors/dalgakiran/dalgakiran-tidy-n-3__1a2b3c4d5e.jpg
Раздел и категория — английские названия (поле folder в equipment_types.json), производитель и модель —
латиницей (русские буквы переводятся в латиницу). Отпечаток — начало md5 содержимого: одинаковое изображение
хранится один раз. Адрес изображения в программе — /img/<путь внутри data/img>.
"""
import hashlib
import json
import os
import re
import shutil
import threading
from datetime import datetime

EXTS = ('.jpg', '.jpeg', '.png', '.webp')
LOGOS = 'logos'
OTHER = 'other'
UNUSED = 'unused'
GROUPS = {'генераторы': 'generators', 'компрессоры': 'compressors', 'подготовка воздуха': 'air-treatment',
          'вспомогательное оборудование': 'auxiliary', 'насосы': 'pumps', 'запасные части': 'spare-parts',
          'прочее': 'other', 'холодоснабжение': 'cooling', 'комплектующие': 'accessories'}
TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
              ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f',
               'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya']))


def slug(s, maxlen=60):
    """Латиницей, строчными, слова через «-»: «АСО-ВК11/10» → «aso-vk11-10»."""
    s = ''.join(TR.get(c, c) for c in str(s or '').lower())
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:maxlen].strip('-')


def model_title(maker, model, name=''):
    """«Производитель Модель» без повтора производителя, если он уже в модели."""
    maker, model = str(maker or '').strip(), str(model or '').strip()
    if model and maker and model.lower().startswith(maker.lower()):
        return model
    return ' '.join(x for x in (maker, model) if x) or str(name or '')


def type_folder(t):
    """«раздел/категория» латиницей для типа оборудования из справочника."""
    t = t or {}
    group = GROUPS.get(str(t.get('group') or '').strip().lower()) or slug(t.get('group')) or OTHER
    cat = t.get('folder') or slug(str(t.get('id') or '').replace('_', '-')) or slug(t.get('name')) or OTHER
    return '%s/%s' % (group, cat)


def place(t, maker, model, name='', kind='photo', caption=''):
    """(папка, имя без отпечатка) для изображения позиции: фото, логотип или изображение галереи."""
    if kind == 'logo':
        return LOGOS, slug(maker) or 'logo'
    title = slug(model_title(maker, model, name), 70) or 'item'
    folder = '%s/%s' % (type_folder(t), slug(maker) or 'no-maker')
    if kind == 'gallery':
        title = '%s--%s' % (title, slug(caption, 40) or 'image')
    return folder, title


def digest_of_name(name):
    """Отпечаток из имени файла: «…__0123456789.jpg» или прежнее «<md5>.jpg»."""
    stem = os.path.splitext(os.path.basename(name))[0]
    m = re.search(r'__([0-9a-f]{10})$', stem)
    if m:
        return m.group(1)
    return stem[:10].lower() if re.fullmatch(r'[0-9a-f]{32}', stem) else None


def safe_rel(folder):
    return '/'.join(p for p in (slug(x, 70) for x in re.split(r'[\\/]+', str(folder or ''))) if p) or OTHER


class ImageStore:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.lock = threading.Lock()
        self.index = None

    def _scan(self):
        idx = {}
        for dp, _, files in os.walk(self.root):
            for name in files:
                if os.path.splitext(name)[1].lower() in EXTS:
                    d = digest_of_name(name)
                    if d:
                        idx.setdefault(d, os.path.relpath(os.path.join(dp, name), self.root).replace(os.sep, '/'))
        self.index = idx

    def target(self, rel):
        """Полный путь изображения по адресу внутри data/img (без выхода за её пределы); None — недопустимый адрес."""
        parts = [p for p in re.split(r'[\\/]+', str(rel or '')) if p not in ('', '.', '..')]
        if not parts:
            return None
        f = os.path.abspath(os.path.join(self.root, *parts))
        if not os.path.normcase(f).startswith(os.path.normcase(self.root + os.sep)):
            return None
        return f if os.path.splitext(f)[1].lower() in EXTS else None

    def path(self, rel):
        """Файл по адресу внутри data/img; None, если нет такого изображения."""
        f = self.target(rel)
        return f if f and os.path.isfile(f) else None

    def put(self, data, ext, folder, title):
        """Сохранить изображение (папка и название — латиницей); то же изображение повторно не записывается."""
        ext = ext if ext in EXTS else '.jpg'
        digest = hashlib.md5(data).hexdigest()
        with self.lock:
            if self.index is None:
                self._scan()
            rel = self.index.get(digest[:10])
            if rel and os.path.isfile(os.path.join(self.root, *rel.split('/'))):
                return rel
            rel = '%s/%s__%s%s' % (safe_rel(folder), slug(title, 110) or 'image', digest[:10], ext)
            f = os.path.join(self.root, *rel.split('/'))
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'wb') as fh:
                fh.write(data)
            self.index[digest[:10]] = rel
            return rel


# ---------------------------------------------------------------- раскладка имеющихся изображений
ORGANIZE_ID = 'images-ascii-2026-10'
REF_RX = re.compile(r'/img/([^"\\?#]+?\.(?:jpg|jpeg|png|webp))(?=")', re.I)


def _wanted(item, tmap):
    """Изображения позиции каталога или КП → [(приоритет, путь сейчас, папка, название)]."""
    a = item.get('attrs') or {}
    t = tmap.get(a.get('cat')) or {}
    maker, model, name = a.get('maker'), a.get('model'), item.get('name')
    out = []

    def add(img, prio, kind, caption=''):
        src = str((img or {}).get('src') or '') if isinstance(img, dict) else ''
        if src.startswith('/img/'):
            out.append((prio, src[5:]) + place(t, maker, model, name, kind, caption))
    add(item.get('logo'), 0, 'logo')
    add(item.get('photo'), 1, 'photo')
    for g in item.get('gallery') or []:
        add(g, 2, 'gallery', g.get('caption') or g.get('slot') or '')
    return out


def _conforms(rel):
    return re.fullmatch(r'[a-z0-9_./-]+', rel) is not None and '/' in rel


def organize_existing(store, types, img_dir, backup_dir, backup=None, log=print):
    """Один раз: все изображения — по папкам «раздел/категория/производитель» латиницей, логотипы — в logos.
    Касается и прежней кучи «<md5>.jpg», и папок с русскими названиями. Ссылки в каталоге и в журнале КП
    обновляются; изображения без ссылок переносятся в unused (ничего не удаляется). Перед изменениями — копия базы."""
    done = store.kv_get('migrations') or []
    if any(isinstance(m, dict) and m.get('id') == ORGANIZE_ID for m in done):
        return None
    files = []
    for dp, _, names in os.walk(img_dir):
        for name in names:
            if os.path.splitext(name)[1].lower() in EXTS:
                files.append(os.path.relpath(os.path.join(dp, name), img_dir).replace(os.sep, '/'))
    if not any(not _conforms(r) for r in files):
        store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])
        return None
    if not backup:
        backup = os.path.join(backup_dir, 'kp-%s-before-images.zip' % datetime.now().strftime('%Y%m%d-%H%M%S'))
        store.backup(backup)
    tmap = {t['id']: t for t in types}
    docs = json.loads(store.catalog_full() or '[]')
    kps = []
    for (kid,) in store.all('SELECT id FROM kp WHERE state IS NOT NULL'):
        st = store.kp_get(kid, 'state')
        if st:
            kps.append((kid, st))
    wanted = []
    for d in docs:
        wanted += _wanted(d, tmap)
    for kid, st in kps:
        try:
            for it in (json.loads(st).get('items') or []):
                wanted += [(w[0] + 3,) + w[1:] for w in _wanted(it, tmap)]   # КП — после каталога
        except Exception:
            pass
    exists = set(files)
    target = {}
    for prio, rel, folder, title in sorted(wanted, key=lambda w: w[0]):
        if rel in target or rel not in exists:
            continue
        if _conforms(rel):
            target[rel] = rel          # уже по правилам — не трогаем
            continue
        digest = digest_of_name(rel)
        if not digest:
            with open(os.path.join(img_dir, *rel.split('/')), 'rb') as f:
                digest = hashlib.md5(f.read()).hexdigest()
        target[rel] = '%s/%s__%s%s' % (folder, title, digest[:10], os.path.splitext(rel)[1].lower())
    for rel in files:              # без ссылок и не по правилам — в unused
        if rel not in target and not _conforms(rel):
            target[rel] = '%s/%s' % (UNUSED, slug(os.path.splitext(rel)[0].replace('/', '-'), 110) + os.path.splitext(rel)[1].lower())
    moves = {r: t for r, t in target.items() if r != t}
    for rel, dst_rel in moves.items():
        dst = os.path.join(img_dir, *dst_rel.split('/'))
        if not os.path.isfile(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(img_dir, *rel.split('/')), dst)

    def fix(text):
        return REF_RX.sub(lambda m: '/img/' + moves.get(m.group(1), m.group(1)), text)
    nd = nk = 0
    for d in docs:
        s = json.dumps(d, ensure_ascii=False)
        s2 = fix(s)
        if s2 != s:
            d2 = json.loads(s2)
            for k in ('_light', 'pricesCount', 'st'):
                d2.pop(k, None)
            store.catalog_put(d2['id'], json.dumps(d2, ensure_ascii=False))
            nd += 1
    for kid, st in kps:
        s2 = fix(st)
        if s2 != st:
            store.kp_set(kid, 'state', s2)
            nk += 1
    keep = set(moves.values())
    for rel in moves:             # прежние файлы — только после того, как ссылки обновлены
        if rel not in keep:
            try:
                os.remove(os.path.join(img_dir, *rel.split('/')))
            except OSError:
                pass
    for dp, _, _ in sorted(os.walk(img_dir), key=lambda x: -len(x[0])):   # опустевшие папки
        if dp != img_dir and not os.listdir(dp):
            try:
                os.rmdir(dp)
            except OSError:
                pass
    folders = {os.path.dirname(t) for t in target.values()}
    report = {'files': len(moves), 'unused': sum(1 for t in moves.values() if t.startswith(UNUSED + '/')),
              'folders': len(folders), 'catalogUpdated': nd, 'kpUpdated': nk}
    store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'backup': backup, 'report': report}])
    log('Изображения разложены по папкам (латиницей): файлов %d, папок %d, позиций каталога %d, КП %d' % (len(moves), len(folders), nd, nk))
    return report


def mark_organized(store):
    done = store.kv_get('migrations') or []
    if not any(isinstance(m, dict) and m.get('id') == ORGANIZE_ID for m in done):
        store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])
