# -*- coding: utf-8 -*-
"""История изменений настроек с откатом.

Каждая запись настроек (kv: общие настройки, категории, тексты интерфейса, тарифы доставки, почта, фиды, инженерные
правила станций — своя версия файла), сделанная по запросу человека, сохраняет снимок «было — стало» и кто изменил. Фоновые записи (проверка фидов по расписанию,
обслуживание) и служебные поля (время проверки, итоги) в историю не попадают. Пароли и ключи — никогда:
ключи API хранятся отдельно (integrations), пароль почты из снимка убирается.

Откат возвращает только то, что изменила эта запись (по полям), — более поздние изменения других полей остаются.
"""
import json
import threading
from datetime import datetime

from defaults import SrvVal


class SettingsHistory:
    KEYS = {'settings': 'Общие настройки', 'types': 'Категории оборудования', 'uitexts': 'Тексты интерфейса',
            'logistics': 'Тарифы доставки', 'mail': 'Почта', 'feeds': 'Фиды поставщиков', 'stationRules': 'Инженерные правила станций'}
    # части общих настроек — для понятных подписей и поиска вкладки
    PARTS = {'defaults': ('Умолчания', 'defaults'), 'lists': ('Списки и выборы', 'lists'), 'features': ('Функции программы', 'features'),
             'userLogin': ('Вход менеджеров', 'access'), 'productEditModeration': ('Модерация правок', 'moderation'),
             'ai': ('Нейросеть', 'ai'), 'auditYears': ('Срок хранения журнала', 'backup'), 'backup2': ('Вторая папка копий', 'backup')}
    TAB = {'types': 'types', 'uitexts': 'texts', 'logistics': 'logistics', 'mail': 'mail', 'feeds': 'feeds', 'stationRules': 'rules'}
    SECRET = ('password', 'token', 'key', 'secret')
    # служебные поля: меняются сами (проверки, отметки времени) — не изменение настроек
    VOLATILE = ('last', 'checked', 'stats', 'report', 'log', 'result', 'run', '_saved')
    KEEP = 500          # предел смещения при просмотре; сколько хранить — srv.settingsHistory («Значения программы»)
    _ctx = threading.local()

    def __init__(self, store):
        self.store = store

    # ---------- кто действует (поток запроса) ----------
    @classmethod
    def actor(cls, name):
        """Запрос человека: его записи настроек идут в историю. None — фоновая работа, без истории."""
        cls._ctx.name = name

    @classmethod
    def who(cls):
        return getattr(cls._ctx, 'name', None)

    # ---------- запись ----------
    @classmethod
    def _volatile(cls, k, depth=0):
        """Служебное поле: отметки «когда/кто» (defaultsAt, updatedBy) верхнего уровня и итоги проверок."""
        k = str(k)
        return k in cls.VOLATILE or k in ('updatedAt', 'updatedBy') or (depth == 0 and k.endswith(('At', 'By')))

    @classmethod
    def _clean(cls, v):
        """Снимок без секретов (пароли, токены, ключи)."""
        if isinstance(v, dict):
            return {k: ('•••' if str(k).lower() in cls.SECRET and x else cls._clean(x)) for k, x in v.items()}
        if isinstance(v, list):
            return [cls._clean(x) for x in v]
        return v

    DEPTH = 2           # «Умолчания → срок КП», «Почта → сервер»: глубже — значение целиком

    @classmethod
    def changes(cls, before, after, path=()):
        """Изменённые поля: [[часть, часть]] без служебных; глубже DEPTH и списки сравниваются целиком."""
        if len(path) < cls.DEPTH and (isinstance(before, dict) or isinstance(after, dict)):
            before = {} if before is None else before
            after = {} if after is None else after
            if isinstance(before, dict) and isinstance(after, dict):
                out = []
                for k in sorted(set(before) | set(after), key=str):
                    if not cls._volatile(k, len(path)) and before.get(k) != after.get(k):
                        out += cls.changes(before.get(k), after.get(k), path + (str(k),))
                return out
        return [list(path)] if before != after else []

    def record(self, key, before, after):
        name = self.who()
        if key not in self.KEYS or name is None:
            return None
        b, a = self._clean(before), self._clean(after)
        ch = self.changes(b, a)
        if not ch:
            return None
        self.store.write('INSERT INTO settings_history (ts, key, by, paths, before, after) VALUES (?,?,?,?,?,?)',
                         (datetime.now().isoformat(timespec='seconds'), key, str(name)[:120], json.dumps(ch[:200], ensure_ascii=False),
                          json.dumps(b, ensure_ascii=False), json.dumps(a, ensure_ascii=False)))
        self.store.write('DELETE FROM settings_history WHERE id <= (SELECT MAX(id) FROM settings_history) - ?', (SrvVal.get(self.store, 'srv.settingsHistory'),))
        return ch

    def watches(self, key):
        return key in self.KEYS and self.who() is not None

    # ---------- просмотр ----------
    def title(self, key, paths):
        """«Общие настройки → Умолчания» по первому изменённому полю."""
        if key == 'settings' and paths and paths[0]:
            part = self.PARTS.get(paths[0][0])
            if part:
                return part[0]
        return self.KEYS.get(key, key)

    def tab(self, key, paths):
        if key == 'settings' and paths and paths[0]:
            part = self.PARTS.get(paths[0][0])
            return part[1] if part else 'defaults'
        return self.TAB.get(key, 'defaults')

    def items(self, key=None, limit=100, offset=0):
        sql, args = 'SELECT id, ts, key, by, paths, rolled FROM settings_history', ()
        if key:
            sql, args = sql + ' WHERE key = ?', (key,)
        rows = self.store.all(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?', args + (int(limit), int(offset)))
        out = []
        for i, ts, k, by, paths, rolled in rows:
            p = json.loads(paths or '[]')
            out.append({'id': i, 'ts': ts, 'key': k, 'by': by, 'paths': p, 'count': len(p), 'title': self.title(k, p),
                        'tab': self.tab(k, p), 'rolled': rolled})
        return out

    def get(self, hid):
        r = self.store.one('SELECT id, ts, key, by, paths, before, after, rolled FROM settings_history WHERE id = ?', (int(hid),))
        if not r:
            raise ValueError('Запись истории не найдена')
        i, ts, k, by, paths, b, a, rolled = r
        p, b, a = json.loads(paths or '[]'), json.loads(b), json.loads(a)
        cur = self._clean(self.store.kv_get(k))
        return {'id': i, 'ts': ts, 'key': k, 'by': by, 'title': self.title(k, p), 'tab': self.tab(k, p), 'rolled': rolled,
                'diff': [{'path': x, 'before': self._at(b, x), 'after': self._at(a, x), 'now': self._at(cur, x),
                          'later': self._at(cur, x) != self._at(a, x)} for x in p[:200]]}

    @staticmethod
    def _at(v, path):
        for part in path:
            if not isinstance(v, dict):
                return None
            v = v.get(part)
        return v

    # ---------- откат ----------
    @classmethod
    def _put(cls, v, path, x, delete):
        """Записать x в словарь v по пути path (недостающие уровни создаются); delete — убрать поле."""
        cur = v
        for part in path[:-1]:
            if not isinstance(cur.get(part), dict):
                cur[part] = {}
            cur = cur[part]
        if delete:
            cur.pop(path[-1], None)
        else:
            cur[path[-1]] = x

    def rollback(self, hid, by):
        """Вернуть поля этой записи к значениям «было». Секреты (•••) не трогаются. → запись, как в get()."""
        r = self.store.one('SELECT key, paths, before FROM settings_history WHERE id = ?', (int(hid),))
        if not r:
            raise ValueError('Запись истории не найдена')
        key, paths, before = r[0], json.loads(r[1] or '[]'), json.loads(r[2])
        cur = self.store.kv_get(key)
        if not paths or paths == [[]]:          # значение целиком (не словарь)
            new = before
        else:
            new = json.loads(json.dumps(cur if isinstance(cur, dict) else {}))
            for p in paths:
                old = self._at(before, p)
                if old == '•••':
                    continue
                self._put(new, p, old, delete=self._missing(before, p))
        self.actor(by)
        self.store.kv_set(key, new)
        self.store.write('UPDATE settings_history SET rolled = ? WHERE id = ?', (datetime.now().isoformat(timespec='seconds'), int(hid)))
        self.store.touch_data('types', 'settings')
        return self.get(hid)

    @staticmethod
    def _missing(v, path):
        for part in path:
            if not isinstance(v, dict) or part not in v:
                return True
            v = v[part]
        return False
