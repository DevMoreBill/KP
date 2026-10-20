"""Шаблоны КП в папке templates: файлы шаблона, история версий, копирование, заводской сброс."""

import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from datetime import datetime

from config import BUNDLE, FROZEN, ROOT, SAFE_ID, UPDATE_DIR, read_text, write_bytes
from defaults import SrvVal

TEMPLATES_DIR = os.path.join(ROOT, 'templates') if FROZEN else os.path.join(BUNDLE, 'templates')
BUNDLED_DIR = os.path.join(BUNDLE, 'templates')  # заводские — в EXE или в обновлении
if UPDATE_DIR and os.path.isdir(os.path.join(UPDATE_DIR, 'templates')):
    BUNDLED_DIR = os.path.join(UPDATE_DIR, 'templates')
DEFAULT_ID = 'pnevmotekh'
IMAGE_RE = r'[A-Za-z0-9_-]+\.(jpg|jpeg|png)'
TPL_FILES = re.compile(rf'^(template\.json|base\.docx|skeleton\.js|editor\.json|{IMAGE_RE})$')
# нет в старых шаблонах — берутся из заводского
SHARED_FILES = ('skeleton.js', 'editor.json')
HISTORY = '_history'
HIST_RE = re.compile(r'^(template|base|skeleton|editor)-\d{8}-\d{6}(-\d+)?\.(json|docx|js)$')


class TemplateError(Exception):
    """Ошибка, понятная пользователю (показывается в программе как есть)."""


def _bundled(tid: str, name: str) -> str | None:
    for t in (tid, DEFAULT_ID):
        f = os.path.join(BUNDLED_DIR, t, name)
        if os.path.isfile(f):
            return f
    return None


def ensure_templates() -> None:
    """Запуск программы: раскладываем встроенные шаблоны рядом с программой (свои правки не перезаписываются)."""
    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    same = os.path.normcase(os.path.abspath(BUNDLED_DIR)) == os.path.normcase(os.path.abspath(TEMPLATES_DIR))
    if os.path.isdir(BUNDLED_DIR) and not same:
        for name in os.listdir(BUNDLED_DIR):
            src, dst = os.path.join(BUNDLED_DIR, name), os.path.join(TEMPLATES_DIR, name)
            if os.path.isdir(src) and not os.path.exists(dst):
                shutil.copytree(src, dst)
    for tid, d in template_dirs().items():
        for name in SHARED_FILES:
            f, src = os.path.join(d, name), _bundled(tid, name)
            if not src or os.path.normcase(src) == os.path.normcase(f):
                continue
            if not os.path.isfile(f):
                shutil.copyfile(src, f)
            elif _norm_md5(f) in OLD_FACTORY.get(name, ()) and _norm_md5(f) != _norm_md5(src):
                # заводской файл прошлой версии, который никто не правил, — обновляем (прежний — в историю)
                _backup(d, name)
                shutil.copyfile(src, f)


# отпечатки заводских скелета и формы редактора прошлых версий: такие файлы обновляются сами,
# изменённые пользователем — не трогаются
OLD_FACTORY = {
    'skeleton.js': (
        '5fbf889fa4d86dbd104efab151efe5cd',
        '318639067e897b8dab73293c9d992d68',
        'bc0c2a86f14f0c4d370130d395b26824',
        'af29a5feb11dd57092e059dcf1a25139',
        '09824be0014a7a0bf89db2432180702d',
        'b25ddfbef3a810deedb3c9d2716236d1',
        'd3336880b98d865de4c3f52861a27940',
        '8e2dd7b287610524eebdc53dbe7ccaeb',
        '4a040a94dcf49aacfcf35f431b3243b6',
        '875dbbef90aa8bf9000c6a3de3d44408',
        'ab8c92945129ccc788b3b89ffde89832',
        '0b4cd9d4f0d220311f5f0893a0784631',
    ),
    'editor.json': (
        '05add2124882dec245a673c9949a8e12',
        '989a6bcdabfed2bb0d2ef55ec242fc12',
        '59bbf5edc4966a5057382803bfb90945',
        'b0fa2e8c9160d3267e23e289869b08cd',
        'a000ceecf14d89ed64628a35bd1c4b67',
        'd9cdcd589e6092eeecba7641c22db0d2',
    ),
}


def _norm_md5(path: str) -> str:
    import hashlib

    with open(path, 'rb') as fh:
        return hashlib.md5(fh.read().replace(b'\r\n', b'\n')).hexdigest()


def template_dirs() -> list[str]:
    out = {}
    if os.path.isdir(TEMPLATES_DIR):
        for name in sorted(os.listdir(TEMPLATES_DIR)):
            d = os.path.join(TEMPLATES_DIR, name)
            if SAFE_ID.match(name) and not name.startswith('_') and os.path.isfile(os.path.join(d, 'template.json')):
                out[name] = d
    return out


def tpl_dir(tid: str) -> str:
    d = template_dirs().get(tid or '')
    if not d:
        raise TemplateError(f'Шаблон «{tid}» не найден')
    return d


def template_file(tid: str, name: str) -> str | None:
    """Путь к файлу шаблона для отдачи в браузер; скелет и форма редактора — из заводского, если своих нет."""
    d = template_dirs().get(tid)
    if not d or not TPL_FILES.match(name or ''):
        return None
    f = os.path.join(d, name)
    if os.path.isfile(f):
        return f
    return _bundled(tid, name) if name in SHARED_FILES else None


def list_templates() -> list[dict]:
    res = []
    for tid, d in template_dirs().items():
        try:
            j = json.loads(read_text(os.path.join(d, 'template.json')))
        except Exception as e:
            res.append({'id': tid, 'name': tid, 'error': f'Ошибка в template.json: {e}'})
            continue
        res.append(
            {
                'id': tid,
                'name': j.get('name') or tid,
                'description': j.get('description', ''),
                'filePrefix': j.get('filePrefix', ''),
                'fileName': j.get('fileName', ''),
                'hasBase': os.path.isfile(os.path.join(d, 'base.docx')),
                'factory': bool(_factory_dir(tid)),
                'clients': bool(j.get('clientsImage')) and os.path.isfile(os.path.join(d, j.get('clientsImage', ''))),
            }
        )
    return res


def _stamp() -> str:
    return datetime.now().strftime('%Y%m%d-%H%M%S')


def _backup(d: str, name: str) -> None:
    """Копия файла в _history перед изменением."""
    f = os.path.join(d, name)
    if not os.path.isfile(f):
        return
    h = os.path.join(d, HISTORY)
    os.makedirs(h, exist_ok=True)
    stem, ext = os.path.splitext(name)
    kind = stem if stem in ('template', 'base', 'skeleton', 'editor') else None
    if not kind:
        return
    dst, n = os.path.join(h, f'{kind}-{_stamp()}{ext}'), 1
    while os.path.exists(dst):
        n += 1
        dst = os.path.join(h, f'{kind}-{_stamp()}-{n}{ext}')
    shutil.copyfile(f, dst)
    files = sorted(x for x in os.listdir(h) if HIST_RE.match(x) and x.startswith(kind + '-'))
    for old in files[: -SrvVal.now('srv.tplHistory')]:
        try:
            os.remove(os.path.join(h, old))
        except OSError:
            pass


def list_history(tid: str) -> list[dict]:
    h = os.path.join(tpl_dir(tid), HISTORY)
    if not os.path.isdir(h):
        return []
    out = []
    for name in sorted(os.listdir(h), reverse=True):
        mm = re.match(r'^(template|base|skeleton|editor)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})', name)
        if HIST_RE.match(name) and mm:
            out.append(
                {
                    'name': name,
                    'kind': mm.group(1),
                    'time': f'{mm.group(4)}.{mm.group(3)}.{mm.group(2)} {mm.group(5)}:{mm.group(6)}:{mm.group(7)}',
                    'size': os.path.getsize(os.path.join(h, name)),
                }
            )
    return out


def restore_history(tid: str, name: str) -> str:
    d = tpl_dir(tid)
    if not HIST_RE.match(name or ''):
        raise TemplateError('Недопустимое имя версии')
    src = os.path.join(d, HISTORY, name)
    if not os.path.isfile(src):
        raise TemplateError('Версия не найдена')
    target = {'template': 'template.json', 'base': 'base.docx', 'skeleton': 'skeleton.js', 'editor': 'editor.json'}[
        name.split('-', maxsplit=1)[0]
    ]
    with open(src, 'rb') as fh:
        put_file(tid, target, fh.read())
    return target


def _check(name: str, data: bytes) -> bytes:
    if name in ('template.json', 'editor.json'):
        try:
            j = json.loads(data.decode('utf-8-sig'))
        except Exception as e:
            raise TemplateError(f'Ошибка в {name}: {e}') from e
        if not isinstance(j, dict):
            raise TemplateError(f'{name} должен содержать объект {{ … }}')
        return json.dumps(j, ensure_ascii=False, indent=2).encode('utf-8') + b'\n'
    if name == 'skeleton.js':
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise TemplateError('skeleton.js должен быть в кодировке UTF-8') from None
        if 'function kpSkeleton' not in text:
            raise TemplateError('В skeleton.js нет функции kpSkeleton(KP)')
        return text.encode('utf-8')
    if name == 'base.docx':
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                doc = z.read('word/document.xml').decode('utf-8', 'replace')
        except Exception:
            raise TemplateError('Это не документ Word (.docx)') from None
        if '<w:sectPr' not in doc:
            raise TemplateError('В документе не найдены параметры страницы')
        return data
    if re.match(f'^{IMAGE_RE}$', name or '', re.I):
        if not (data[:3] == b'\xff\xd8\xff' or data[:8] == b'\x89PNG\r\n\x1a\n'):
            raise TemplateError('Картинка должна быть в формате JPG или PNG')
        return data
    raise TemplateError(f'Недопустимое имя файла шаблона: {name}')


def put_file(tid: str, name: str, data: bytes) -> None:
    """Записать файл шаблона (прежняя версия — в _history)."""
    d = tpl_dir(tid)
    if not TPL_FILES.match(name or ''):
        raise TemplateError(f'Недопустимое имя файла шаблона: {name}')
    data = _check(name, data)
    _backup(d, name)
    tmp = os.path.join(d, name + '.tmp')
    write_bytes(tmp, data)
    os.replace(tmp, os.path.join(d, name))


def copy_template(tid: str, new_id: str, name: str) -> str:
    src = tpl_dir(tid)
    if not SAFE_ID.match(new_id or '') or new_id.startswith('_'):
        raise TemplateError('Код шаблона — латинские буквы, цифры, «-» и «_»')
    dst = os.path.join(TEMPLATES_DIR, new_id)
    if os.path.exists(dst):
        raise TemplateError(f'Шаблон с кодом «{new_id}» уже есть')
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(HISTORY, '*.tmp'))
    for f in SHARED_FILES:
        if not os.path.isfile(os.path.join(dst, f)) and _bundled(tid, f):
            shutil.copyfile(_bundled(tid, f), os.path.join(dst, f))
    f = os.path.join(dst, 'template.json')
    j = json.loads(read_text(f))
    j['name'] = name or (j.get('name', new_id) + ' (копия)')
    write_bytes(f, json.dumps(j, ensure_ascii=False, indent=2).encode('utf-8') + b'\n')
    return new_id


def delete_template(tid: str) -> None:
    d = tpl_dir(tid)
    if len(template_dirs()) < 2:
        raise TemplateError('Нельзя удалить единственный шаблон')
    trash = os.path.join(TEMPLATES_DIR, '_deleted')
    os.makedirs(trash, exist_ok=True)
    shutil.move(d, os.path.join(trash, f'{tid}-{_stamp()}'))


def _factory_dir(tid: str) -> str | None:
    f = os.path.join(BUNDLED_DIR, tid)
    d = template_dirs().get(tid)
    if not os.path.isdir(f) or (d and os.path.normcase(os.path.abspath(f)) == os.path.normcase(os.path.abspath(d))):
        return None
    return f


def reset_template(tid: str) -> None:
    """Вернуть заводской вариант шаблона (текущие файлы остаются в _history)."""
    d = tpl_dir(tid)
    f = _factory_dir(tid)
    if not f:
        raise TemplateError('Для этого шаблона нет заводского варианта — верните нужную версию из истории')
    for name in os.listdir(f):
        src = os.path.join(f, name)
        if os.path.isfile(src) and TPL_FILES.match(name):
            _backup(d, name)
            shutil.copyfile(src, os.path.join(d, name))


def open_template_file(tid: str, name: str) -> None:
    """Открыть файл шаблона на этом компьютере: base.docx — в Word, тексты — в Блокноте, иначе — папку."""
    from desktop import open_file, open_folder

    d = tpl_dir(tid)
    if not name:
        return open_folder(d)
    if not TPL_FILES.match(name):
        raise TemplateError('Недопустимое имя файла шаблона')
    f = os.path.join(d, name)
    if not os.path.isfile(f):
        raise TemplateError(f'Файл {name} не найден в папке шаблона')
    if name.endswith(('.js', '.json')) and os.name == 'nt':
        subprocess.Popen(['notepad.exe', f])  # .js нельзя открывать «по умолчанию»: Windows его запустит
    else:
        open_file(f)
    return None
