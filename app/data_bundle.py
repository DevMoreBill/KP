"""Выгрузка и загрузка архивом: резервная копия JSON с изображениями; файл всех настроек программы."""

import io
import json
import os
import re
import zipfile
from datetime import datetime
from enum import Enum

from images import EXTS, ImageStore


class StrictJson:
    """JSON из загруженного файла: NaN и Infinity — отказ (в базе они сломали бы JSON.parse каталога у всех браузеров)."""

    @staticmethod
    def _bad(name: str) -> None:
        raise ValueError(f'В файле недопустимое число: {name}')

    @classmethod
    def loads(cls, text: str) -> dict:
        return json.loads(text, parse_constant=cls._bad)


class DataBundle:
    JSON_NAME = 'kp-backup.json'
    IMG_PREFIX = 'img/'
    MAX_IMAGE = 30 * 1024 * 1024
    MAX_IMAGES = 50000
    # адрес /img/… в тексте копии; в КП (состояние хранится строкой JSON) кавычка после адреса экранирована — \"
    REF = re.compile(r'/img/([^"\\?#]+?\.(?:jpg|jpeg|png|webp))(?=\\?")', re.I)

    def __init__(self, img_dir: str) -> None:
        self.images = ImageStore(img_dir)

    @classmethod
    def refs(cls, text: str) -> list[str]:
        """Адреса изображений (путь внутри data/img), на которые ссылается текст резервной копии."""
        return sorted({match.group(1) for match in cls.REF.finditer(text)})

    def pack(self, body: str) -> tuple:
        """zip: kp-backup.json + изображения из ссылок. → (байты архива, сколько изображений вошло, сколько не найдено)."""
        buf, found, missing = io.BytesIO(), 0, 0
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr(self.JSON_NAME, body)
            for rel in self.refs(body):
                path = self.images.path(rel)
                if not path:
                    missing += 1
                    continue
                z.write(path, self.IMG_PREFIX + rel, compress_type=zipfile.ZIP_STORED)  # jpg/png/webp уже сжаты
                found += 1
        return buf.getvalue(), found, missing

    @staticmethod
    def is_image(data: bytes) -> bool:
        """JPEG, PNG или WebP по содержимому, а не только по расширению."""
        return (
            data[:3] == b'\xff\xd8\xff'
            or data[:8] == b'\x89PNG\r\n\x1a\n'
            or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')
        )

    @staticmethod
    def is_zip(data: bytes) -> bool:
        return data[:2] == b'PK'

    def read(self, data: bytes):
        """Файл .json или .zip → (резервная копия dict, открытый архив или None, список изображений архива)."""
        if not data:
            raise ValueError('Файл пустой')
        if not self.is_zip(data):
            try:
                return StrictJson.loads(data.decode('utf-8-sig')), None, []
            except (ValueError, UnicodeDecodeError):
                raise ValueError(
                    'Это не резервная копия программы: нужен файл «КП_резервная_копия_….json» или «КП_выгрузка_….zip»'
                ) from None
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('Архив повреждён') from None
        names = z.namelist()
        doc = (
            self.JSON_NAME
            if self.JSON_NAME in names
            else next((name for name in names if name.lower().endswith('.json') and '/' not in name), None)
        )
        if not doc:
            raise ValueError('В архиве нет резервной копии (kp-backup.json)')
        try:
            backup = StrictJson.loads(z.read(doc).decode('utf-8-sig'))
        except (ValueError, UnicodeDecodeError):
            raise ValueError('Резервная копия в архиве повреждена') from None
        imgs = [i for i in z.infolist() if i.filename.startswith(self.IMG_PREFIX) and not i.is_dir()][: self.MAX_IMAGES]
        return backup, z, imgs

    def _target(self, name: str) -> tuple:
        rel = name[len(self.IMG_PREFIX) :]
        if '..' in rel.replace('\\', '/').split('/') or not rel.lower().endswith(EXTS):
            return None, None
        return rel, self.images.target(rel)

    def plan(self, imgs) -> dict:
        """Сколько изображений добавится, сколько уже есть, сколько отброшено."""
        new = have = bad = 0
        for i in imgs:
            rel, path = self._target(i.filename)
            if not path or i.file_size > self.MAX_IMAGE:
                bad += 1
            elif self.images.path(rel):
                have += 1
            else:
                new += 1
        return {'new': new, 'exist': have, 'invalid': bad}

    def write(self, z, imgs) -> int:
        """Записать недостающие изображения → сколько записано."""
        count = 0
        for i in imgs:
            rel, path = self._target(i.filename)
            if not path or i.file_size > self.MAX_IMAGE or self.images.path(rel):
                continue
            data = z.read(i)
            if len(data) > self.MAX_IMAGE or not self.is_image(data):
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + '.part'
            with open(tmp, 'wb') as handle:
                handle.write(data)
            os.replace(tmp, path)
            count += 1
        return count


class SettingsSecrets:
    """Секреты внутри настройки «settings»: пароль Яндекс Диска второй папки — никогда в файл, ключ нейросети — только «с ключами»."""

    @staticmethod
    def strip(value: dict, with_keys: bool) -> dict:
        out = dict(value)
        mirror = out.get('backup2')
        if isinstance(mirror, dict) and isinstance(mirror.get('dav'), dict):
            out['backup2'] = dict(mirror, dav={key: val for key, val in mirror['dav'].items() if key != 'password'})
        if not with_keys and isinstance(out.get('ai'), dict):
            out['ai'] = {key: val for key, val in out['ai'].items() if key != 'key'}
        return out

    @staticmethod
    def keep(value: dict, cur: object) -> dict:
        """Загрузка: пароль диска и ключ нейросети, которых нет в файле, — из текущей базы."""
        cur = cur if isinstance(cur, dict) else {}
        out = dict(value)
        ai_cur, ai_new = cur.get('ai'), out.get('ai')
        if isinstance(ai_new, dict) and 'key' not in ai_new and isinstance(ai_cur, dict) and ai_cur.get('key'):
            out['ai'] = dict(ai_new, key=ai_cur['key'])
        dav_cur = (cur.get('backup2') or {}).get('dav') if isinstance(cur.get('backup2'), dict) else None
        mirror = picked if isinstance(picked := out.get('backup2'), dict) else {}
        dav_new = mirror.get('dav')
        if (
            isinstance(dav_new, dict)
            and 'password' not in dav_new
            and isinstance(dav_cur, dict)
            and dav_cur.get('password')
        ):
            out['backup2'] = dict(mirror, dav=dict(dav_new, password=dav_cur['password']))
        return out


class ProgramSettings:
    """Раздел «Настройки программы»."""

    KEYS = ('types', 'settings', 'uitexts', 'logistics', 'feeds', 'mail')
    SECRET = {'mail': ('password',)}

    def __init__(self, store) -> None:
        self.store = store

    def export(self) -> dict:
        out = {}
        for k in self.KEYS:
            v = self.store.kv_get(k)
            if isinstance(v, dict) and k in self.SECRET:
                v = {key: val for key, val in v.items() if key not in self.SECRET[k]}
            if isinstance(v, dict) and k == 'settings':
                v = SettingsSecrets.strip(v, with_keys=False)
            if v is not None:
                out[k] = v
        return out

    def count(self, data: dict) -> int:
        return sum(1 for k in self.KEYS if isinstance(data, dict) and data.get(k) is not None)

    def apply(self, data):
        """Записать настройки из копии; секреты текущей базы сохраняются. → сколько разделов настроек записано."""
        count = 0
        for k in self.KEYS:
            v = data.get(k) if isinstance(data, dict) else None
            if v is None:
                continue
            if isinstance(v, dict) and k in self.SECRET:
                cur = self.store.kv_get(k) or {}
                v = dict(
                    {key: val for key, val in v.items() if key not in self.SECRET[k]},
                    **{key: cur[key] for key in self.SECRET[k] if isinstance(cur, dict) and key in cur},
                )
            if isinstance(v, dict) and k == 'settings':
                v = SettingsSecrets.keep(v, self.store.kv_get(k))
            self.store.kv_set(k, v)
            count += 1
        self.store.touch_data('types', 'settings')
        return count


class Keys(Enum):
    """Настройки в файл: без ключей API и пароля почты или с ними."""

    WITHOUT = 'without'
    WITH = 'with'


class SettingsFile:
    """«Все настройки в файл»."""

    FORMAT = 'kp-settings'
    # ключ раздела → подпись
    PARTS = (
        ('settings', 'Общие настройки: значения программы, списки, функции, вход менеджеров, модерация, нейросеть'),
        ('types', 'Категории оборудования и их характеристики'),
        ('uitexts', 'Тексты интерфейса'),
        ('logistics', 'Тарифы доставки по России'),
        ('carrierApi', 'Перевозчики: включение и адреса API'),
        ('chinaRates', 'Доставка из Китая: ставки экспедиторов'),
        ('stationRules', 'Инженерные правила станций (своя версия)'),
        ('feeds', 'Фиды поставщиков: адреса, категории, скидки'),
        ('mail', 'Почта для отправки КП (без пароля)'),
        ('alerts', 'Письма администратору о проблемах'),
        ('makerLogos', 'Логотипы производителей'),
        ('update', 'Обновления программы: репозиторий, ночная установка'),
        ('userPrefs', 'Личные настройки менеджеров'),
        ('access', 'Права менеджеров (без логинов и паролей)'),
        ('bitrix', 'Битрикс24: воронка, этапы, менеджеры (адрес вебхука — только «с ключами API»)'),
        ('integrations', 'Ключи API (только «с ключами API»)'),
    )
    UPDATE_KEYS = ('repo', 'auto', 'nightly', 'nightHour')
    BITRIX_KEYS = (
        'url',
        'on',
        'category',
        'stages',
        'users',
        'pollSec',
        'portal',
        'mode',
        'flow',
        'mgr',
        'fallback',
        'cats',
        'stagesBy',
        'fields',
        'send',
        'company',
        'tasks',
        'sched',
    )  # служебное (время опроса, созданные поля) — не настройка

    def __init__(self, store, author: str = '') -> None:
        self.store, self.author = store, author

    @classmethod
    def label(cls, k: str) -> str:
        return dict(cls.PARTS).get(k, k)

    def _get(self, k, keys: Keys):
        store = self.store
        if k == 'access':
            from auth_users import access, perms_of

            return {
                mid: {'perms': perms_of(rec), 'blocked': bool(rec.get('blocked'))}
                for mid, rec in access(store).items()
                if isinstance(rec, dict)
            } or None
        if k == 'integrations':
            v = store.kv_get('integrations')
            return v if keys is Keys.WITH and v else None
        v = store.kv_get(k)
        if v is None:
            return None
        if k == 'mail' and isinstance(v, dict):
            v = {key: val for key, val in v.items() if key != 'password'}
        if k == 'bitrix' and isinstance(v, dict):  # служебное (время опроса, поля созданы) — не настройка
            v = {key: val for key, val in v.items() if key in self.BITRIX_KEYS and (keys is Keys.WITH or key != 'url')}
        if k == 'settings' and isinstance(v, dict):
            v = SettingsSecrets.strip(v, with_keys=keys is Keys.WITH)
        if k == 'update' and isinstance(v, dict):
            v = {key: v[key] for key in self.UPDATE_KEYS if key in v} or None
        return v

    def export(self, keys: Keys = Keys.WITHOUT) -> tuple:
        """→ (имя файла, байты JSON)."""
        from version import VERSION

        sec = {}
        for k, _ in self.PARTS:
            v = self._get(k, keys)
            if v not in (None, {}, []):
                sec[k] = v
        body = {
            'format': self.FORMAT,
            'version': 1,
            'app': VERSION,
            'createdAt': datetime.now().isoformat(timespec='seconds'),
            'keys': keys is Keys.WITH,
            'sections': sec,
        }
        name = 'КП_настройки{}_{}.json'.format(
            '_с_ключами' if keys is Keys.WITH else '', datetime.now().strftime('%Y-%m-%d_%H%M')
        )
        return name, json.dumps(body, ensure_ascii=False, indent=1).encode('utf-8')

    def read(self, data: bytes):
        """Файл настроек: байты JSON или уже разобранный документ (другие форматы — admin.settings_doc через DataFile)."""
        if isinstance(data, dict):
            parsed = data
        else:
            try:
                parsed = StrictJson.loads((data or b'').decode('utf-8-sig'))
            except (ValueError, UnicodeDecodeError):
                parsed = None
        if (
            not isinstance(parsed, dict)
            or parsed.get('format') != self.FORMAT
            or not isinstance(parsed.get('sections'), dict)
        ):
            raise ValueError(
                'Это не файл настроек программы: нужен файл «КП_настройки_…», выгруженный в «Копии и база → Выгрузить → Настройки программы»'
            )
        return parsed

    def preview(self, data: bytes) -> dict:
        """Разделы файла: что в нём есть и отличается ли от текущего."""
        parsed = self.read(data)
        out = []
        for k, label in self.PARTS:
            if k not in parsed['sections']:
                continue
            same = json.dumps(parsed['sections'][k], sort_keys=True, ensure_ascii=False) == json.dumps(
                self._get(k, Keys.WITH), sort_keys=True, ensure_ascii=False
            )
            out.append({'key': k, 'label': label, 'same': same})
        return {
            'app': parsed.get('app') or '',
            'createdAt': parsed.get('createdAt') or '',
            'keys': bool(parsed.get('keys')),
            'sections': out,
        }

    def apply(self, data: bytes, picked=None) -> dict:
        """Записать выбранные разделы (picked — список ключей; None — все). → {applied: [...], errors: [...]}"""
        parsed = self.read(data)
        store, applied, errors = self.store, [], []
        for k, label in self.PARTS:
            v = parsed['sections'].get(k)
            if v is None or (picked is not None and k not in picked):
                continue
            try:
                self._put(k, v)
                applied.append(label)
            except (ValueError, TypeError) as exc:
                errors.append(f'{label}: {exc}')
        store.touch_data('types', 'settings')
        from defaults import SrvVal

        SrvVal.forget()
        return {'applied': applied, 'errors': errors}

    def _put(self, k: str, v) -> None:
        store = self.store
        if k == 'stationRules':
            from station_rules import StationRules

            StationRules(store).save(json.dumps(v, ensure_ascii=False).encode('utf-8'), self.author or 'файл настроек')
            return
        if k == 'access':
            from auth_users import PERM_KEYS, AccessRecord, access

            if not isinstance(v, dict):
                raise ValueError('неверный формат')
            have = access(store)
            for mid, rec in v.items():  # только менеджеры этой базы: чужие записи не создаются
                if mid in have and isinstance(rec, dict) and isinstance(rec.get('perms'), dict):
                    AccessRecord.update(
                        store,
                        mid,
                        lambda old, _access, rec=rec: dict(
                            old,
                            perms={perm: bool(rec['perms'].get(perm)) for perm in PERM_KEYS},
                            **({'blocked': bool(rec['blocked'])} if 'blocked' in rec else {}),
                        ),
                    )
            return
        cur = store.kv_get(k)
        if k == 'mail' and isinstance(v, dict) and isinstance(cur, dict) and 'password' in cur:
            v = dict(v, password=cur['password'])
        if k == 'settings' and isinstance(v, dict):
            v = SettingsSecrets.keep(v, cur)
        if k == 'update':
            v = dict(
                cur if isinstance(cur, dict) else {},
                **{key: v[key] for key in self.UPDATE_KEYS if isinstance(v, dict) and key in v},
            )
        if k == 'integrations' and isinstance(v, dict) and isinstance(cur, dict):
            v = dict(cur, **v)
        if k == 'bitrix' and isinstance(v, dict):  # адреса вебхука в файле нет — остаётся свой; служебное — своё
            v = dict(
                cur if isinstance(cur, dict) else {}, **{key: val for key, val in v.items() if key in self.BITRIX_KEYS}
            )
            from bitrix_rules import BitrixRules
            from crm import Stages

            BitrixRules.check(
                v, dict(v), {row[0] for row in store.all('SELECT id FROM managers')}, Stages.keys(store)
            )  # правила — та же проверка, что в «Настройках»
            if v.get('on') and not v.get('url'):
                v['on'] = False
        if not isinstance(v, (dict, list)):
            raise ValueError('неверный формат')
        store.kv_set(k, v)
