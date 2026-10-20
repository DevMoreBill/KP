"""История изменений настроек администратора с откатом (секреты маскируются)."""

import json
import threading
from datetime import datetime

from defaults import SrvVal


class SettingsHistory:
    KEYS = {
        'settings': 'Общие настройки',
        'types': 'Категории оборудования',
        'uitexts': 'Тексты интерфейса',
        'logistics': 'Тарифы доставки',
        'mail': 'Почта',
        'feeds': 'Фиды поставщиков',
        'stationRules': 'Инженерные правила станций',
    }
    # части общих настроек — для понятных подписей и поиска вкладки
    PARTS = {
        'defaults': ('Умолчания', 'defaults'),
        'lists': ('Списки и выборы', 'lists'),
        'features': ('Функции программы', 'features'),
        'userLogin': ('Вход менеджеров', 'access'),
        'productEditModeration': ('Модерация правок', 'moderation'),
        'ai': ('Нейросеть', 'ai'),
        'auditYears': ('Срок хранения журнала', 'backup'),
        'backup2': ('Вторая папка копий', 'backup'),
    }
    TAB = {
        'types': 'types',
        'uitexts': 'texts',
        'logistics': 'logistics',
        'mail': 'mail',
        'feeds': 'feeds',
        'stationRules': 'rules',
    }
    SECRET = ('password', 'token', 'secret', 'apikey')
    # «key» — секрет только у нейросети; в категориях и списках это код поля
    SECRET_AT = (('ai', 'key'),)
    VOLATILE = ('last', 'checked', 'stats', 'report', 'log', 'result', 'run', '_saved')
    KEEP = 500
    _ctx = threading.local()

    def __init__(self, store) -> None:
        self.store = store

    # ---------- кто действует (поток запроса) ----------
    @classmethod
    def actor(cls, name: str | None):
        """Запрос человека: его записи настроек идут в историю. None — фоновая работа, без истории."""
        cls._ctx.name = name

    @classmethod
    def who(cls) -> str | None:
        return getattr(cls._ctx, 'name', None)

    # ---------- запись ----------
    @classmethod
    def _volatile(cls, k: str, depth: int = 0) -> bool:
        """Служебное поле: отметки «когда/кто» (defaultsAt, updatedBy) верхнего уровня и итоги проверок."""
        k = str(k)
        return k in cls.VOLATILE or k in ('updatedAt', 'updatedBy') or (depth == 0 and k.endswith(('At', 'By')))

    @classmethod
    def _clean(cls, v, parent: str = ''):
        """Снимок без секретов (пароли, токены, ключ нейросети)."""
        if isinstance(v, dict):
            return {k: ('•••' if x and cls._secret(parent, k) else cls._clean(x, str(k))) for k, x in v.items()}
        if isinstance(v, list):
            return [cls._clean(x, parent) for x in v]
        return v

    @classmethod
    def _secret(cls, parent: str, k: str) -> bool:
        k = str(k).lower()
        return k in cls.SECRET or (parent, k) in cls.SECRET_AT

    DEPTH = 2  # «Умолчания → срок КП», «Почта → сервер»: глубже — значение целиком

    @classmethod
    def changes(cls, before, after, path: tuple = ()) -> list[list[str]]:
        """Изменённые поля: [[часть, часть]] без служебных; глубже DEPTH и списки сравниваются целиком."""
        if len(path) < cls.DEPTH and (isinstance(before, dict) or isinstance(after, dict)):
            before = {} if before is None else before
            after = {} if after is None else after
            if isinstance(before, dict) and isinstance(after, dict):
                out = []
                for k in sorted(set(before) | set(after), key=str):
                    if not cls._volatile(k, len(path)) and before.get(k) != after.get(k):
                        out += cls.changes(before.get(k), after.get(k), (*path, str(k)))
                return out
        return [list(path)] if before != after else []

    def record(self, key: str, before, after) -> list | None:
        name = self.who()
        if key not in self.KEYS or name is None:
            return None
        before_clean, after_clean = self._clean(before), self._clean(after)
        changes = self.changes(before_clean, after_clean)
        if not changes:
            return None
        self.store.write(
            'INSERT INTO settings_history (ts, key, by, paths, before, after) VALUES (?,?,?,?,?,?)',
            (
                datetime.now().isoformat(timespec='seconds'),
                key,
                str(name)[:120],
                json.dumps(changes[:200], ensure_ascii=False),
                json.dumps(before_clean, ensure_ascii=False),
                json.dumps(after_clean, ensure_ascii=False),
            ),
        )
        self.store.write(
            'DELETE FROM settings_history WHERE id <= (SELECT MAX(id) FROM settings_history) - ?',
            (SrvVal.get(self.store, 'srv.settingsHistory'),),
        )
        return changes

    def watches(self, key: str) -> bool:
        return key in self.KEYS and self.who() is not None

    # ---------- просмотр ----------
    def title(self, key: str, paths: list) -> str:
        """«Общие настройки → Умолчания» по первому изменённому полю."""
        if key == 'settings' and paths and paths[0]:
            part = self.PARTS.get(paths[0][0])
            if part:
                return part[0]
        return self.KEYS.get(key, key)

    def tab(self, key: str, paths: list) -> str:
        if key == 'settings' and paths and paths[0]:
            part = self.PARTS.get(paths[0][0])
            return part[1] if part else 'defaults'
        return self.TAB.get(key, 'defaults')

    def items(self, key: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
        sql = 'SELECT id, ts, key, by, paths, rolled FROM settings_history'
        args: tuple = ()
        if key:
            sql, args = sql + ' WHERE key = ?', (key,)
        rows = self.store.all(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?', (*args, int(limit), int(offset)))
        out = []
        for i, stamp, k, author, paths, rolled in rows:
            paths_list = json.loads(paths or '[]')
            out.append(
                {
                    'id': i,
                    'ts': stamp,
                    'key': k,
                    'by': author,
                    'paths': paths_list,
                    'count': len(paths_list),
                    'title': self.title(k, paths_list),
                    'tab': self.tab(k, paths_list),
                    'rolled': rolled,
                }
            )
        return out

    def get(self, hid) -> dict:
        row = self.store.one(
            'SELECT id, ts, key, by, paths, before, after, rolled FROM settings_history WHERE id = ?', (int(hid),)
        )
        if not row:
            raise ValueError('Запись истории не найдена')
        i, stamp, k, author, paths, before_raw, after_raw, rolled = row
        paths_list, before_raw, after_raw = json.loads(paths or '[]'), json.loads(before_raw), json.loads(after_raw)
        cur = self._clean(self.store.kv_get(k))
        return {
            'id': i,
            'ts': stamp,
            'key': k,
            'by': author,
            'title': self.title(k, paths_list),
            'tab': self.tab(k, paths_list),
            'rolled': rolled,
            'diff': [
                {
                    'path': x,
                    'before': self._stamp(before_raw, x),
                    'after': self._stamp(after_raw, x),
                    'now': self._stamp(cur, x),
                    'later': self._stamp(cur, x) != self._stamp(after_raw, x),
                }
                for x in paths_list[:200]
            ],
        }

    @staticmethod
    def _stamp(v, path: list):
        for part in path:
            if not isinstance(v, dict):
                return None
            v = v.get(part)
        return v

    # ---------- откат ----------
    @classmethod
    def _put(cls, v: dict, path: list, x, delete: bool) -> None:
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

    def rollback(self, hid, author: str) -> dict:
        """Вернуть поля этой записи к значениям «было». Секреты (•••) не трогаются. → запись, как в get()."""
        row = self.store.one('SELECT key, paths, before FROM settings_history WHERE id = ?', (int(hid),))
        if not row:
            raise ValueError('Запись истории не найдена')
        key, paths, before = row[0], json.loads(row[1] or '[]'), json.loads(row[2])
        cur = self.store.kv_get(key)
        if not paths or paths == [[]]:  # значение целиком (не словарь)
            new = before
        else:
            new = json.loads(json.dumps(cur if isinstance(cur, dict) else {}))
            for path in paths:
                old = self._stamp(before, path)
                if old == '•••':
                    continue
                self._put(new, path, old, delete=self._missing(before, path))
        self.actor(author)
        self.store.kv_set(key, new)
        self.store.write(
            'UPDATE settings_history SET rolled = ? WHERE id = ?',
            (datetime.now().isoformat(timespec='seconds'), int(hid)),
        )
        self.store.touch_data('types', 'settings')
        return self.get(hid)

    @staticmethod
    def _missing(v, path: list) -> bool:
        for part in path:
            if not isinstance(v, dict) or part not in v:
                return True
            v = v[part]
        return False
