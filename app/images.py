"""Хранилище изображений data/img: пути латиницей «раздел/категория/производитель», имена с отпечатком."""

import hashlib
import json
import os
import re
import shutil
import threading
from datetime import datetime

EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.pdf')  # .pdf — буклет цветовых решений заказчика (станция в контейнере)
LOGOS = 'logos'
OTHER = 'other'
UNUSED = 'unused'
GROUPS = {
    'генераторы': 'generators',
    'компрессоры': 'compressors',
    'подготовка воздуха': 'air-treatment',
    'вспомогательное оборудование': 'auxiliary',
    'насосы': 'pumps',
    'запасные части': 'spare-parts',
    'прочее': 'other',
    'холодоснабжение': 'cooling',
    'комплектующие': 'accessories',
}
TRANSLIT = dict(
    zip(
        'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
        [
            'a',
            'b',
            'v',
            'g',
            'd',
            'e',
            'e',
            'zh',
            'z',
            'i',
            'y',
            'k',
            'l',
            'm',
            'n',
            'o',
            'p',
            'r',
            's',
            't',
            'u',
            'f',
            'kh',
            'ts',
            'ch',
            'sh',
            'shch',
            '',
            'y',
            '',
            'e',
            'yu',
            'ya',
        ],
        strict=False,
    )
)


def slug(text, maxlen: int = 60) -> str:
    """Латиницей, строчными, слова через «-»: «АСО-ВК11/10» → «aso-vk11-10»."""
    text = ''.join(TRANSLIT.get(char, char) for char in str(text or '').lower())
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    return text[:maxlen].strip('-')


def model_title(maker: str, model: str, name: str = '') -> str:
    """«Производитель Модель» без повтора производителя, если он уже в модели."""
    maker, model = str(maker or '').strip(), str(model or '').strip()
    if model and maker and model.lower().startswith(maker.lower()):
        return model
    return ' '.join(x for x in (maker, model) if x) or str(name or '')


def type_folder(tdef: dict | None) -> str:
    """«раздел/категория» латиницей для типа оборудования из справочника."""
    tdef = tdef or {}
    group = GROUPS.get(str(tdef.get('group') or '').strip().lower()) or slug(tdef.get('group')) or OTHER
    cat = tdef.get('folder') or slug(str(tdef.get('id') or '').replace('_', '-')) or slug(tdef.get('name')) or OTHER
    return f'{group}/{cat}'


def place(tdef, maker: str, model: str, name: str = '', kind: str = 'photo', caption: str = '') -> tuple[str, str]:
    """(папка, имя без отпечатка) для изображения позиции: фото, логотип или изображение галереи."""
    if kind == 'logo':
        return LOGOS, slug(maker) or 'logo'
    title = slug(model_title(maker, model, name), 70) or 'item'
    folder = '{}/{}'.format(type_folder(tdef), slug(maker) or 'no-maker')
    if kind == 'gallery':
        title = '{}--{}'.format(title, slug(caption, 40) or 'image')
    return folder, title


def digest_of_name(name: str) -> str:
    """Отпечаток из имени файла: «…__0123456789.jpg» или прежнее «<md5>.jpg»."""
    stem = os.path.splitext(os.path.basename(name))[0]
    match = re.search(r'__([0-9a-f]{10})$', stem)
    if match:
        return match.group(1)
    return stem[:10].lower() if re.fullmatch(r'[0-9a-f]{32}', stem) else None


def safe_rel(folder: str) -> str:
    return '/'.join(part for part in (slug(x, 70) for x in re.split(r'[\\/]+', str(folder or ''))) if part) or OTHER


class ImageStore:
    def __init__(self, root: str) -> None:
        self.root = os.path.abspath(root)
        self.lock = threading.Lock()
        self.index = None

    def _scan(self):
        idx = {}
        for folder, _, files in os.walk(self.root):
            for name in files:
                if os.path.splitext(name)[1].lower() in EXTS:
                    digest = digest_of_name(name)
                    if digest:
                        idx.setdefault(
                            digest, os.path.relpath(os.path.join(folder, name), self.root).replace(os.sep, '/')
                        )
        self.index = idx

    def target(self, rel: str) -> str | None:
        """Полный путь изображения по адресу внутри data/img (без выхода за её пределы); None — недопустимый адрес."""
        parts = [part for part in re.split(r'[\\/]+', str(rel or '')) if part not in ('', '.', '..')]
        if not parts:
            return None
        path = os.path.abspath(os.path.join(self.root, *parts))
        if not os.path.normcase(path).startswith(os.path.normcase(self.root + os.sep)):
            return None
        return path if os.path.splitext(path)[1].lower() in EXTS else None

    def path(self, rel: str) -> str | None:
        """Файл по адресу внутри data/img; None, если нет такого изображения."""
        path = self.target(rel)
        return path if path and os.path.isfile(path) else None

    def put(self, data: bytes, ext: str, folder: str, title: str) -> str:
        """Сохранить изображение (папка и название — латиницей); то же изображение повторно не записывается."""
        ext = ext if ext in EXTS else '.jpg'
        digest = hashlib.md5(data).hexdigest()
        with self.lock:
            if self.index is None:
                self._scan()
            rel = self.index.get(digest[:10])
            if rel and os.path.isfile(os.path.join(self.root, *rel.split('/'))):
                return rel
            rel = '{}/{}__{}{}'.format(safe_rel(folder), slug(title, 110) or 'image', digest[:10], ext)
            path = os.path.join(self.root, *rel.split('/'))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as handle:
                handle.write(data)
            self.index[digest[:10]] = rel
            return rel


ORGANIZE_ID = 'images-ascii-2026-10'
REF_RX = re.compile(r'/img/([^"\\?#]+?\.(?:jpg|jpeg|png|webp|pdf))(?=")', re.I)


def _wanted(item: dict, tmap: dict) -> list[tuple]:
    """Изображения позиции каталога или КП → [(приоритет, путь сейчас, папка, название)]."""
    attrs = item.get('attrs') or {}
    tdef = tmap.get(attrs.get('cat')) or {}
    maker, model, name = attrs.get('maker'), attrs.get('model'), item.get('name')
    out = []

    def add(img, prio, kind, caption=''):
        src = str((img or {}).get('src') or '') if isinstance(img, dict) else ''
        if src.startswith('/img/'):
            out.append((prio, src[5:], *place(tdef, maker, model, name, kind, caption)))

    add(item.get('logo'), 0, 'logo')
    add(item.get('photo'), 1, 'photo')
    for gal in item.get('gallery') or []:
        add(gal, 2, 'gallery', gal.get('caption') or gal.get('slot') or '')
    return out


def _conforms(rel: str) -> bool:
    return re.fullmatch(r'[a-z0-9_./-]+', rel) is not None and '/' in rel


def organize_existing(store, types: list, img_dir: str, backup_dir: str, backup=None, log=print) -> dict | None:
    """Один раз: все изображения — по папкам «раздел/категория/производитель»."""
    done = store.kv_get('migrations') or []
    if any(isinstance(move, dict) and move.get('id') == ORGANIZE_ID for move in done):
        return None
    files = []
    for dir_path, _, names in os.walk(img_dir):
        for name in names:
            if os.path.splitext(name)[1].lower() in EXTS:
                files.append(os.path.relpath(os.path.join(dir_path, name), img_dir).replace(os.sep, '/'))
    if not any(not _conforms(rel_name) for rel_name in files):
        store.kv_set(
            'migrations',
            [*done, {'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}],
        )
        return None
    if not backup:
        backup = os.path.join(backup_dir, 'kp-{}-before-images.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S')))
        store.backup(backup)
    tmap = {tdef['id']: tdef for tdef in types}
    docs = json.loads(store.catalog_full() or '[]')
    kps = []
    for (kid,) in store.all('SELECT id FROM kp WHERE state IS NOT NULL'):
        state = store.kp_get(kid, 'state')
        if state:
            kps.append((kid, state))
    wanted = []
    for doc in docs:
        wanted += _wanted(doc, tmap)
    for _kid, state in kps:
        try:
            for item in json.loads(state).get('items') or []:
                wanted += [(want[0] + 3, *want[1:]) for want in _wanted(item, tmap)]  # КП — после каталога
        except Exception:
            pass
    exists = set(files)
    target = {}
    for _prio, rel, folder, title in sorted(wanted, key=lambda want: want[0]):
        if rel in target or rel not in exists:
            continue
        if _conforms(rel):
            target[rel] = rel  # уже по правилам — не трогаем
            continue
        digest = digest_of_name(rel)
        if not digest:
            with open(os.path.join(img_dir, *rel.split('/')), 'rb') as handle:
                digest = hashlib.md5(handle.read()).hexdigest()
        target[rel] = f'{folder}/{title}__{digest[:10]}{os.path.splitext(rel)[1].lower()}'
    for rel in files:  # без ссылок и не по правилам — в unused
        if rel not in target and not _conforms(rel):
            target[rel] = '{}/{}'.format(
                UNUSED,
                slug(os.path.splitext(rel)[0].replace('/', '-'), 110) + os.path.splitext(rel)[1].lower(),
            )
    moves = {rel_name: tdef for rel_name, tdef in target.items() if rel_name != tdef}
    for rel, dst_rel in moves.items():
        dst = os.path.join(img_dir, *dst_rel.split('/'))
        if not os.path.isfile(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(img_dir, *rel.split('/')), dst)

    def fix(text):
        return REF_RX.sub(lambda match: '/img/' + moves.get(match.group(1), match.group(1)), text)

    docs_fixed = kp_fixed = 0
    for doc in docs:
        text_doc = json.dumps(doc, ensure_ascii=False)
        fixed = fix(text_doc)
        if fixed != text_doc:
            doc2 = json.loads(fixed)
            for k in ('_light', 'pricesCount', 'st'):
                doc2.pop(k, None)
            store.catalog_put(doc2['id'], json.dumps(doc2, ensure_ascii=False))
            docs_fixed += 1
    for kid, state in kps:
        fixed = fix(state)
        if fixed != state:
            store.kp_set(kid, 'state', fixed)
            kp_fixed += 1
    keep = set(moves.values())
    for rel in moves:  # прежние файлы — только после того, как ссылки обновлены
        if rel not in keep:
            try:
                os.remove(os.path.join(img_dir, *rel.split('/')))
            except OSError:
                pass
    for dir_path, _, _ in sorted(os.walk(img_dir), key=lambda x: -len(x[0])):  # опустевшие папки
        if dir_path != img_dir and not os.listdir(dir_path):
            try:
                os.rmdir(dir_path)
            except OSError:
                pass
    folders = {os.path.dirname(tdef) for tdef in target.values()}
    report = {
        'files': len(moves),
        'unused': sum(1 for tdef in moves.values() if tdef.startswith(UNUSED + '/')),
        'folders': len(folders),
        'catalogUpdated': docs_fixed,
        'kpUpdated': kp_fixed,
    }
    store.kv_set(
        'migrations',
        [
            *done,
            {'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'backup': backup, 'report': report},
        ],
    )
    log(
        f'Изображения разложены по папкам (латиницей): файлов {len(moves)}, папок {len(folders)}, '
        f'позиций каталога {docs_fixed}, КП {kp_fixed}'
    )
    return report


def mark_organized(store) -> None:
    done = store.kv_get('migrations') or []
    if not any(isinstance(move, dict) and move.get('id') == ORGANIZE_ID for move in done):
        store.kv_set(
            'migrations',
            [*done, {'id': ORGANIZE_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}],
        )
