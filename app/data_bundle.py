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
from datetime import datetime

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


class ProgramSettings:
    """Раздел «Настройки программы» резервной копии: категории, общие настройки (умолчания, списки, функции, вход),
    тексты интерфейса, тарифы доставки, фиды, почта. Без секретов: пароль почты, ключи API (integrations),
    учётные записи администраторов и пароли менеджеров (mgrAccess) не выгружаются и при загрузке не затираются."""
    KEYS = ('types', 'settings', 'uitexts', 'logistics', 'feeds', 'mail')
    SECRET = {'mail': ('password',)}

    def __init__(self, store):
        self.store = store

    def export(self):
        out = {}
        for k in self.KEYS:
            v = self.store.kv_get(k)
            if isinstance(v, dict) and k in self.SECRET:
                v = {a: b for a, b in v.items() if a not in self.SECRET[k]}
            if v is not None:
                out[k] = v
        return out

    def count(self, d):
        return sum(1 for k in self.KEYS if isinstance(d, dict) and d.get(k) is not None)

    def apply(self, d):
        """Записать настройки из копии; секреты текущей базы сохраняются. → сколько разделов настроек записано."""
        n = 0
        for k in self.KEYS:
            v = d.get(k) if isinstance(d, dict) else None
            if v is None:
                continue
            if isinstance(v, dict) and k in self.SECRET:
                cur = self.store.kv_get(k) or {}
                v = dict({a: b for a, b in v.items() if a not in self.SECRET[k]},
                         **{a: cur[a] for a in self.SECRET[k] if isinstance(cur, dict) and a in cur})
            self.store.kv_set(k, v)
            n += 1
        self.store.touch_data('types', 'settings')
        return n


class SettingsFile:
    """«Все настройки в файл» и обратно (Настройки → Файл, изменения, откат): все настройки программы одним файлом
    kp-settings (.json). Ключи API (integrations, ключ нейросети) — только по галочке «с ключами API»; пароли — никогда
    (пароль почты, учётные записи администраторов, пароли менеджеров). Права менеджеров — без логинов и паролей.
    Загрузка — с предпросмотром по разделам; выбранные разделы заменяются, секреты текущей базы сохраняются (если в
    файле нет ключей — остаются свои); правила станций проходят ту же проверку, что и при загрузке во вкладке."""
    FORMAT = 'kp-settings'
    # ключ раздела → подпись
    PARTS = (('settings', 'Общие настройки: значения программы, списки, функции, вход менеджеров, модерация, нейросеть'),
             ('types', 'Категории оборудования и их характеристики'), ('uitexts', 'Тексты интерфейса'),
             ('logistics', 'Тарифы доставки по России'), ('carrierApi', 'Перевозчики: включение и адреса API'),
             ('chinaRates', 'Доставка из Китая: ставки экспедиторов'), ('stationRules', 'Инженерные правила станций (своя версия)'),
             ('feeds', 'Фиды поставщиков: адреса, категории, скидки'), ('mail', 'Почта для отправки КП (без пароля)'),
             ('alerts', 'Письма администратору о проблемах'), ('makerLogos', 'Логотипы производителей'),
             ('update', 'Обновления программы: репозиторий, ночная установка'), ('userPrefs', 'Личные настройки менеджеров'),
             ('access', 'Права менеджеров (без логинов и паролей)'),
             ('bitrix', 'Битрикс24: воронка, этапы, менеджеры (адрес вебхука — только «с ключами API»)'),
             ('integrations', 'Ключи API (только «с ключами API»)'))
    UPDATE_KEYS = ('repo', 'auto', 'nightly', 'nightHour')

    def __init__(self, store, by=''):
        self.store, self.by = store, by

    @classmethod
    def label(cls, k):
        return dict(cls.PARTS).get(k, k)

    def _get(self, k, keys):
        st = self.store
        if k == 'access':
            from auth_users import access, perms_of
            return {mid: {'perms': perms_of(r), 'blocked': bool(r.get('blocked'))} for mid, r in access(st).items() if isinstance(r, dict)} or None
        if k == 'integrations':
            v = st.kv_get('integrations')
            return v if keys and v else None
        v = st.kv_get(k)
        if v is None:
            return None
        if k == 'mail' and isinstance(v, dict):
            v = {a: b for a, b in v.items() if a != 'password'}
        if k == 'bitrix' and isinstance(v, dict):         # служебное (время опроса, поля созданы) — не настройка
            v = {a: b for a, b in v.items() if a in ('url', 'on', 'category', 'stages', 'users', 'pollSec', 'portal') and (keys or a != 'url')}
        if k == 'settings' and isinstance(v, dict) and isinstance(v.get('ai'), dict) and not keys:
            v = dict(v, ai={a: b for a, b in v['ai'].items() if a != 'key'})
        if k == 'update' and isinstance(v, dict):
            v = {a: v[a] for a in self.UPDATE_KEYS if a in v} or None
        return v

    def export(self, keys=False):
        """→ (имя файла, байты JSON)."""
        from version import VERSION
        sec = {}
        for k, _ in self.PARTS:
            v = self._get(k, keys)
            if v not in (None, {}, []):
                sec[k] = v
        body = {'format': self.FORMAT, 'version': 1, 'app': VERSION, 'createdAt': datetime.now().isoformat(timespec='seconds'),
                'keys': bool(keys), 'sections': sec}
        name = 'КП_настройки%s_%s.json' % ('_с_ключами' if keys else '', datetime.now().strftime('%Y-%m-%d_%H%M'))
        return name, json.dumps(body, ensure_ascii=False, indent=1).encode('utf-8')

    def read(self, data):
        """Файл настроек: байты JSON или уже разобранный документ (другие форматы — admin.settings_doc через DataFile)."""
        if isinstance(data, dict):
            d = data
        else:
            try:
                d = json.loads((data or b'').decode('utf-8-sig'))
            except (ValueError, UnicodeDecodeError):
                d = None
        if not isinstance(d, dict) or d.get('format') != self.FORMAT or not isinstance(d.get('sections'), dict):
            raise ValueError('Это не файл настроек программы: нужен файл «КП_настройки_…», выгруженный в «База и копии → Выгрузить → Настройки программы»')
        return d

    def preview(self, data):
        """Разделы файла: что в нём есть и отличается ли от текущего."""
        d = self.read(data)
        out = []
        for k, label in self.PARTS:
            if k not in d['sections']:
                continue
            same = json.dumps(d['sections'][k], sort_keys=True, ensure_ascii=False) == json.dumps(self._get(k, True), sort_keys=True, ensure_ascii=False)
            out.append({'key': k, 'label': label, 'same': same})
        return {'app': d.get('app') or '', 'createdAt': d.get('createdAt') or '', 'keys': bool(d.get('keys')), 'sections': out}

    def apply(self, data, picked=None):
        """Записать выбранные разделы (picked — список ключей; None — все). → {applied: [...], errors: [...]}"""
        d = self.read(data)
        st, applied, errors = self.store, [], []
        for k, label in self.PARTS:
            v = d['sections'].get(k)
            if v is None or (picked is not None and k not in picked):
                continue
            try:
                self._put(k, v)
                applied.append(label)
            except (ValueError, TypeError) as e:
                errors.append('%s: %s' % (label, e))
        st.touch_data('types', 'settings')
        from defaults import SrvVal
        SrvVal.forget()
        return {'applied': applied, 'errors': errors}

    def _put(self, k, v):
        st = self.store
        if k == 'stationRules':
            from station_rules import StationRules
            StationRules(st).save(json.dumps(v, ensure_ascii=False).encode('utf-8'), self.by or 'файл настроек')
            return
        if k == 'access':
            from auth_users import PERM_KEYS, AccessRecord, access
            if not isinstance(v, dict):
                raise ValueError('неверный формат')
            have = access(st)
            for mid, rec in v.items():         # только менеджеры этой базы: чужие записи не создаются
                if mid in have and isinstance(rec, dict) and isinstance(rec.get('perms'), dict):
                    AccessRecord.update(st, mid, lambda r, _a, rec=rec: dict(r, perms={p: bool(rec['perms'].get(p)) for p in PERM_KEYS},
                                                                           **({'blocked': bool(rec['blocked'])} if 'blocked' in rec else {})))
            return
        cur = st.kv_get(k)
        if k == 'mail' and isinstance(v, dict) and isinstance(cur, dict) and 'password' in cur:
            v = dict(v, password=cur['password'])
        if k == 'settings' and isinstance(v, dict) and isinstance(cur, dict):
            ai_cur = cur.get('ai') if isinstance(cur.get('ai'), dict) else {}
            if isinstance(v.get('ai'), dict) and 'key' not in v['ai'] and ai_cur.get('key'):
                v = dict(v, ai=dict(v['ai'], key=ai_cur['key']))
        if k == 'update':
            v = dict(cur if isinstance(cur, dict) else {}, **{a: v[a] for a in self.UPDATE_KEYS if isinstance(v, dict) and a in v})
        if k == 'integrations' and isinstance(v, dict) and isinstance(cur, dict):
            v = dict(cur, **v)
        if k == 'bitrix' and isinstance(v, dict):         # адреса вебхука в файле нет — остаётся свой; служебное — своё
            v = dict(cur if isinstance(cur, dict) else {}, **{a: b for a, b in v.items() if a in ('url', 'on', 'category', 'stages', 'users', 'pollSec', 'portal')})
            if v.get('on') and not v.get('url'):
                v['on'] = False
        if not isinstance(v, (dict, list)):
            raise ValueError('неверный формат')
        st.kv_set(k, v)
