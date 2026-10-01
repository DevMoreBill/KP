# -*- coding: utf-8 -*-
"""Хранилище изображений оборудования (папка data/img) — по папкам, а не одной кучей:

  data/img/<Раздел>/<Категория>/<Производитель>/<Модель>__<отпечаток>.jpg   фото и изображения позиций
  data/img/Логотипы/<Производитель>__<отпечаток>.png                           логотипы производителей
  data/img/Прочее/…                                                          изображения без категории

Раздел и категория — как в справочнике типов («Компрессоры/Винтовые компрессоры/Dalgakiran»).
Отпечаток — начало md5 содержимого: одинаковое изображение хранится один раз, даже если загружено повторно
для другой позиции. Адрес изображения в программе — /img/<путь внутри data/img>.
"""
import hashlib
import os
import re
import threading

EXTS = ('.jpg', '.jpeg', '.png', '.webp')
LOGOS = 'Логотипы'
OTHER = 'Прочее'


def clean_part(s, maxlen=70):
    """Часть пути: без символов, запрещённых в Windows и адресах (#, ?, % …), без точек в конце."""
    s = re.sub(r'\s*[\\/]\s*', '-', str(s or ''))   # «ВК11/10» → «ВК11-10»
    s = re.sub(r'[:*?"<>|#%&{}$!\'@`=^~\[\];+]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' .')
    return s[:maxlen].strip(' .')


def clean_rel(rel):
    parts = [clean_part(p, 120) for p in re.split(r'[\\/]+', str(rel or '')) if p not in ('', '.', '..')]
    return '/'.join(p for p in parts if p)


def model_title(maker, model, name=''):
    """Название файла: «Производитель Модель» (без повтора производителя, если он уже в модели)."""
    maker, model = str(maker or '').strip(), str(model or '').strip()
    if model and maker and model.lower().startswith(maker.lower()):
        return model
    return ' '.join(x for x in (maker, model) if x) or str(name or '')


def folder_for(group, type_name, maker):
    return '/'.join(clean_part(x) or OTHER for x in (group or OTHER, type_name or OTHER, maker or 'Без производителя'))


def file_name(title, digest, ext):
    return '%s__%s%s' % (clean_part(title, 80) or 'Изображение', digest[:10], ext)


def digest_of_name(name):
    """Отпечаток из имени файла: «…__0123456789.jpg» (новые) или «<md5>.jpg» (прежние, одной папкой)."""
    stem = os.path.splitext(os.path.basename(name))[0]
    m = re.search(r'__([0-9a-f]{10})$', stem)
    if m:
        return m.group(1)
    return stem[:10].lower() if re.fullmatch(r'[0-9a-f]{32}', stem) else None


class ImageStore:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.lock = threading.Lock()
        self.index = None

    def _scan(self):
        idx = {}
        for dp, dn, fn in os.walk(self.root):
            for name in fn:
                if os.path.splitext(name)[1].lower() in EXTS:
                    d = digest_of_name(name)
                    if d:
                        idx.setdefault(d, os.path.relpath(os.path.join(dp, name), self.root).replace(os.sep, '/'))
        self.index = idx

    def path(self, rel):
        """Файл по адресу внутри data/img (без выхода за её пределы); None, если нет такого изображения."""
        parts = [p for p in re.split(r'[\\/]+', str(rel or '')) if p not in ('', '.', '..')]
        if not parts:
            return None
        f = os.path.abspath(os.path.join(self.root, *parts))
        if not os.path.normcase(f).startswith(os.path.normcase(self.root + os.sep)):
            return None
        return f if os.path.isfile(f) and os.path.splitext(f)[1].lower() in EXTS else None

    def put(self, data, ext, folder, title):
        """Сохранить изображение в папку категории; то же изображение повторно не записывается."""
        ext = ext if ext in EXTS else '.jpg'
        digest = hashlib.md5(data).hexdigest()
        with self.lock:
            if self.index is None:
                self._scan()
            rel = self.index.get(digest[:10])
            if rel and os.path.isfile(os.path.join(self.root, *rel.split('/'))):
                return rel
            folder = clean_rel(folder) or OTHER
            rel = folder + '/' + file_name(title, digest, ext)
            f = os.path.join(self.root, *rel.split('/'))
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'wb') as fh:
                fh.write(data)
            self.index[digest[:10]] = rel
            return rel

    def forget(self):
        with self.lock:
            self.index = None


# ---------------------------------------------------------------- раскладка прежних изображений по папкам
ORGANIZE_ID = 'images-folders-2026-10'
FLAT_RX = re.compile(r'/img/([0-9a-f]{32}\.(?:jpg|jpeg|png|webp))')
UNUSED = 'Не используются'


def _places_of(item, tmap):
    """(фото, логотип, изображения галереи) позиции каталога или КП → [(файл одной кучей, папка, название)]."""
    a = item.get('attrs') or {}
    t = tmap.get(a.get('cat')) or {}
    maker = str(a.get('maker') or '').strip()
    folder = folder_for(t.get('group'), t.get('name'), maker)
    model = model_title(maker, a.get('model'), item.get('name'))
    out = []

    def add(img, fld, title, prio):
        m = FLAT_RX.fullmatch(str((img or {}).get('src') or '')) if isinstance(img, dict) else None
        if m:
            out.append((prio, m.group(1), fld, title))
    add(item.get('logo'), LOGOS, maker or 'Логотип', 0)
    add(item.get('photo'), folder, model, 1)
    for g in item.get('gallery') or []:
        add(g, folder, '%s — %s' % (model, g.get('caption') or g.get('slot') or 'изображение'), 2)
    return out


def organize_existing(store, types, img_dir, backup_dir, backup=None, log=print):
    """Один раз: изображения, лежавшие одной папкой (data/img/<md5>.jpg), раскладываются по папкам
    «раздел / категория / производитель», логотипы — в «Логотипы»; ссылки в каталоге и журнале КП обновляются.
    Неиспользуемые файлы переносятся в «Не используются». Перед изменениями — копия базы (если её ещё нет)."""
    import json
    import shutil
    from datetime import datetime
    done = store.kv_get('migrations') or []
    if any(isinstance(m, dict) and m.get('id') == ORGANIZE_ID for m in done):
        return None
    flat = [n for n in (os.listdir(img_dir) if os.path.isdir(img_dir) else []) if re.fullmatch(r'[0-9a-f]{32}\.(jpg|jpeg|png|webp)', n)]
    if not flat:
        store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])
        return None
    if not backup:
        backup = os.path.join(backup_dir, 'kp-%s-до-раскладки-изображений.sqlite3' % datetime.now().strftime('%Y%m%d-%H%M%S'))
        store.backup(backup)
    tmap = {t['id']: t for t in types}
    docs = json.loads(store.catalog_full() or '[]')
    kps = []
    for (kid,) in store.all('SELECT id FROM kp WHERE state IS NOT NULL'):
        try:
            kps.append((kid, store.kp_get(kid, 'state')))
        except Exception:
            pass
    places = []
    for d in docs:
        places += _places_of(d, tmap)
    for kid, st in kps:
        try:
            for it in (json.loads(st).get('items') or []):
                places += [(p + 3, *rest) for p, *rest in _places_of(it, tmap)]   # КП — после каталога
        except Exception:
            pass
    target = {}
    for prio, name, fld, title in sorted(places, key=lambda x: x[0]):
        if name not in target and os.path.isfile(os.path.join(img_dir, name)):
            target[name] = fld + '/' + file_name(title, os.path.splitext(name)[0], os.path.splitext(name)[1].lower())
    for name in flat:   # остальное — в «Не используются» (ничего не удаляется)
        if name not in target:
            target[name] = UNUSED + '/' + name
    used = set()
    for name, rel in target.items():
        dst = os.path.join(img_dir, *rel.split('/'))
        if rel in used and not os.path.isfile(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.isfile(dst):
            shutil.copy2(os.path.join(img_dir, name), dst)
        used.add(rel)

    def fix(text):
        return FLAT_RX.sub(lambda m: '/img/' + target[m.group(1)] if m.group(1) in target else m.group(0), text)
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
    for name in target:   # прежние копии одной кучей — только после того, как ссылки обновлены
        try:
            os.remove(os.path.join(img_dir, name))
        except OSError:
            pass
    folders = sorted({os.path.dirname(r) for r in target.values()})
    report = {'files': len(target), 'unused': sum(1 for r in target.values() if r.startswith(UNUSED + '/')), 'folders': len(folders),
              'catalogUpdated': nd, 'kpUpdated': nk}
    store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'backup': backup, 'report': report}])
    log('Изображения разложены по папкам категорий: файлов %d, папок %d, позиций каталога %d, КП %d' % (len(target), len(folders), nd, nk))
    return report


def mark_organized(store):
    from datetime import datetime
    done = store.kv_get('migrations') or []
    if not any(isinstance(m, dict) and m.get('id') == ORGANIZE_ID for m in done):
        store.kv_set('migrations', done + [{'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])
