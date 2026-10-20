"""Тонкая настройка обмена с Битрикс24: направления, поля, воронки, менеджеры, компании, дела, расписание."""

import re
from datetime import datetime

DIRS = ('both', 'in', 'out', 'off')
OUT = ('out', 'off')


class BitrixRules:
    """Действующие правила обмена по настройке связи (словарь kv «bitrix»)."""

    KINDS = {'deal': 'Сделки', 'task': 'Дела', 'company': 'Компании и контакты'}
    WINS = ('last', 'ours', 'theirs')
    # (ключ, подпись, поле Битрикса, своё поле можно, направления, направление по умолчанию, тип своего поля)
    FIELDS = (
        ('title', 'Название сделки', 'TITLE', False, DIRS, 'both', ''),
        ('stage', 'Этап → стадия воронки', 'STAGE_ID', False, DIRS, 'both', ''),
        ('expected', 'Ожидаемая дата', 'CLOSEDATE', False, DIRS, 'both', ''),
        ('manager', 'Ответственный', 'ASSIGNED_BY_ID', False, DIRS, 'both', ''),
        ('note', 'Заметка', 'COMMENTS', True, DIRS, 'both', 'string'),
        ('sum', 'Сумма сделки', 'OPPORTUNITY', False, DIRS, 'out', ''),
        ('lostReason', 'Причина проигрыша', 'UF_CRM_KP_LOST', True, DIRS, 'off', 'string'),
        ('KP_NUMBER', 'КП (номера)', 'UF_CRM_KP_NUMBER', True, OUT, 'out', 'string'),
        ('KP_PRICE', 'Цена для заказчика с НДС, ₽', 'UF_CRM_KP_PRICE', True, OUT, 'out', 'double'),
        ('KP_REVENUE', 'Выручка без НДС, ₽', 'UF_CRM_KP_REVENUE', True, OUT, 'out', 'double'),
        ('KP_COST', 'Себестоимость с финансированием, ₽', 'UF_CRM_KP_COST', True, OUT, 'out', 'double'),
        ('KP_FINANCE', 'Финансирование, ₽', 'UF_CRM_KP_FINANCE', True, OUT, 'out', 'double'),
        ('KP_PROFIT', 'Прибыль до налога, ₽', 'UF_CRM_KP_PROFIT', True, OUT, 'out', 'double'),
        ('KP_NET', 'Чистая прибыль, ₽', 'UF_CRM_KP_NET', True, OUT, 'out', 'double'),
        ('KP_MARGIN', 'Маржинальность, %', 'UF_CRM_KP_MARGIN', True, OUT, 'out', 'double'),
        ('KP_MARKUP', 'Наценка, %', 'UF_CRM_KP_MARKUP', True, OUT, 'out', 'double'),
        ('KP_ECON', 'Экономика: структура затрат и график платежей', 'UF_CRM_KP_ECON', True, OUT, 'out', 'string'),
        ('dealNo', 'Номер сделки программы', 'UF_CRM_KP_DEALNO', True, OUT, 'off', 'string'),
        ('client', 'Клиент (название)', 'UF_CRM_KP_CLIENT', True, OUT, 'off', 'string'),
        ('inn', 'ИНН клиента', 'UF_CRM_KP_INN', True, OUT, 'off', 'string'),
        ('items', 'Оборудование последнего КП', 'UF_CRM_KP_ITEMS', True, OUT, 'off', 'string'),
        ('kpDate', 'Дата последнего КП', 'UF_CRM_KP_DATE', True, OUT, 'off', 'string'),
        ('kpStatus', 'Статус последнего КП', 'UF_CRM_KP_STATUS', True, OUT, 'off', 'string'),
        ('mgrName', 'Менеджер (имя)', 'UF_CRM_KP_MANAGER', True, OUT, 'off', 'string'),
    )
    SHARED = ('title', 'stage', 'expected', 'manager', 'note', 'lostReason')  # правка с обеих сторон
    FILES = {'word': 'КП (Word)', 'pdf': 'КП (PDF)', 'refs': 'Справочный документ', 'econ': 'Экономика сделки (Excel)'}
    TASK_KINDS = {'call': 'Звонок', 'meet': 'Встреча', 'mail': 'Письмо', 'task': 'Задача'}
    TASK_AS = ('todo', 'call', 'meet', 'off')  # дело Битрикса: универсальное, звонок, встреча; не передавать
    FIND = ('inn', 'inn_name', 'name')
    BX_FIELD = re.compile(r'^[A-Z][A-Z0-9_]{1,60}$')
    TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
    BATCH = (10, 2000, 200)
    TRIES = (1, 100, 20)
    FILE_MB = (1, 100, 20)

    def __init__(self, conf) -> None:
        self.c = conf if isinstance(conf, dict) else {}

    def mode(self) -> str:
        m = self.c.get('mode')
        return m if m in ('both', 'in', 'out') else 'both'

    def flow(self, kind: str) -> str:
        v = (self.c.get('flow') or {}).get(kind)
        return v if v in DIRS else self.mode()

    @staticmethod
    def allow(d: str, way: str) -> bool:
        return d in ('both', way)

    def mgr(self, mid: str) -> dict:
        m = (self.c.get('mgr') or {}).get(str(mid or '')) or {}
        return {
            'on': m.get('on', True) is not False,
            'dir': m.get('dir') if m.get('dir') in DIRS else '',
            'cat': str(m.get('cat') or ''),
        }

    def can(self, kind: str, way: str, mid: str | None = None) -> bool:
        """Передавать ли вид данных kind в сторону way ('out' — в Битрикс, 'in' — в программу) для менеджера mid."""
        if not self.allow(self.flow(kind), way):
            return False
        if mid:
            m = self.mgr(mid)
            if not m['on'] or not self.allow(m['dir'] or 'both', way):
                return False
        return True

    @classmethod
    def spec(cls, key: str) -> tuple | None:
        return next((f for f in cls.FIELDS if f[0] == key), None)

    def field(self, key: str) -> dict:
        """{bx, dir, win, label, own}: поле Битрикса, направление, кто главный при правке с обеих сторон."""
        f = self.spec(key)
        mine = (self.c.get('fields') or {}).get(key) or {}
        bx = mine.get('bx') if f[3] and mine.get('bx') else f[2]
        d = mine.get('dir') if mine.get('dir') in f[4] else f[5]
        win = mine.get('win') if mine.get('win') in self.WINS else 'last'
        return {'bx': bx, 'dir': d, 'win': win, 'label': f[1], 'own': bool(f[6]) and bx.startswith('UF_CRM_KP_')}

    def own_fields(self) -> list:
        """Свои поля сделки, которые программа создаёт в Битриксе: [(код без UF_CRM_, тип, подпись)] — только включённые."""
        out = []
        for f in self.FIELDS:
            if not f[6]:
                continue
            x = self.field(f[0])
            if x['dir'] != 'off' and x['own']:
                out.append((x['bx'][len('UF_CRM_') :], f[6], f[1]))
        return out

    def category(self):
        return str(self.c.get('category') or '0')

    def cat_of(self, mid: str):
        return self.mgr(mid)['cat'] or self.category()

    def pull_cats(self) -> list:
        cats = [self.category()] + [str(x) for x in (self.c.get('cats') or [])]
        cats += [m.get('cat') for m in (self.c.get('mgr') or {}).values() if isinstance(m, dict) and m.get('cat')]
        out = []
        for x in cats:
            if x not in out:
                out.append(x)
        return out

    def stages(self, cat=None) -> dict:
        cat = str(cat if cat is not None else self.category())
        by = (self.c.get('stagesBy') or {}).get(cat)
        if isinstance(by, dict) and by:
            return by
        return (self.c.get('stages') or {}) if cat == self.category() else {}

    def send(self) -> dict:
        s = self.c.get('send') or {}
        files = s.get('files') if isinstance(s.get('files'), dict) else {}
        return {
            'rows': s.get('rows', True) is not False,
            'rowsHow': s.get('rowsHow') if s.get('rowsHow') in ('kp', 'sum') else 'kp',
            'files': {k: files.get(k, True) is not False for k in self.FILES},
            'fileMB': self._int(s.get('fileMB'), self.FILE_MB),
        }

    def company(self) -> dict:
        c = self.c.get('company') or {}
        return {
            'find': c.get('find') if c.get('find') in self.FIND else 'inn_name',
            'create': c.get('create', True) is not False,
            'contacts': c.get('contacts') if c.get('contacts') in DIRS else 'both',
            'reqs': c.get('reqs', True) is not False,
        }

    def tasks(self) -> dict:
        t = self.c.get('tasks') or {}
        k = t.get('kinds') if isinstance(t.get('kinds'), dict) else {}
        return {
            'kinds': {x: (k.get(x) if k.get(x) in self.TASK_AS else 'todo') for x in self.TASK_KINDS},
            'cancel': t.get('cancel', True) is not False,
            'other': t.get('other', True) is not False,
        }

    def sched(self) -> dict:
        s = self.c.get('sched') or {}
        return {
            'from': s.get('from') if self.TIME.match(str(s.get('from') or '')) else '',
            'to': s.get('to') if self.TIME.match(str(s.get('to') or '')) else '',
            'batch': self._int(s.get('batch'), self.BATCH),
            'tries': self._int(s.get('tries'), self.TRIES),
        }

    def in_hours(self, now=None) -> bool:
        s = self.sched()
        if not s['from'] or not s['to'] or s['from'] == s['to']:
            return True
        t = (now or datetime.now()).strftime('%H:%M')
        return s['from'] <= t < s['to'] if s['from'] < s['to'] else (t >= s['from'] or t < s['to'])  # через полночь

    def fallback(self) -> str:
        return str(self.c.get('fallback') or '')

    @staticmethod
    def _int(v, rng: tuple) -> int:
        try:
            v = int(v)
        except (TypeError, ValueError):
            return rng[2]
        return min(max(v, rng[0]), rng[1])

    def view(self) -> dict:
        """Для «Настроек»: все правила с умолчаниями (то, что действует сейчас)."""
        return {
            'mode': self.mode(),
            'flow': {k: (self.c.get('flow') or {}).get(k) or '' for k in self.KINDS},
            'mgr': {k: self.mgr(k) for k in (self.c.get('mgr') or {})},
            'fallback': self.fallback(),
            'cats': [str(x) for x in (self.c.get('cats') or [])],
            'stagesBy': self.c.get('stagesBy') or {},
            'fields': {f[0]: self.field(f[0]) for f in self.FIELDS},
            'send': self.send(),
            'company': self.company(),
            'tasks': self.tasks(),
            'sched': self.sched(),
            'spec': [
                {
                    'key': f[0],
                    'label': f[1],
                    'bx': f[2],
                    'pick': f[3],
                    'dirs': list(f[4]),
                    'def': f[5],
                    'shared': f[0] in self.SHARED,
                }
                for f in self.FIELDS
            ],
        }

    @classmethod
    def check(cls, new: dict, d: dict, managers, stage_keys) -> dict:
        """Проверить и записать в new правила из d (только известные ключи). ValueError — понятным текстом."""

        def pick(v, allowed, what):
            if v in (None, ''):
                return ''
            if v not in allowed:
                raise ValueError(f'Неверное значение: {what}')
            return v

        if 'mode' in d:
            new['mode'] = pick(d['mode'], ('both', 'in', 'out'), 'направление обмена') or 'both'
        if 'flow' in d:
            f = d['flow'] if isinstance(d['flow'], dict) else {}
            new['flow'] = {k: pick(f.get(k), DIRS, f'направление «{v}»') for k, v in cls.KINDS.items() if f.get(k)}
        if 'mgr' in d:
            m = d['mgr'] if isinstance(d['mgr'], dict) else {}
            out = {}
            for mid, x in m.items():
                if mid not in managers or not isinstance(x, dict):
                    continue
                cat = str(x.get('cat') or '')
                if cat and not re.match(r'^\d{1,9}$', cat):
                    raise ValueError('Неверная воронка у менеджера')
                out[mid] = {
                    'on': x.get('on', True) is not False,
                    'dir': pick(x.get('dir'), DIRS, 'направление менеджера'),
                    'cat': cat,
                }
            new['mgr'] = out
        if 'fallback' in d:
            fb = str(d.get('fallback') or '')
            if fb and fb != 'skip' and fb not in managers:
                raise ValueError('Неверный менеджер для сделок без ответственного')
            new['fallback'] = fb
        if 'cats' in d:
            cs = d['cats'] if isinstance(d['cats'], list) else []
            if any(not re.match(r'^\d{1,9}$', str(x)) for x in cs):
                raise ValueError('Неверная воронка')
            new['cats'] = sorted({str(x) for x in cs})[:20]
        if 'stagesBy' in d:
            sb = d['stagesBy'] if isinstance(d['stagesBy'], dict) else {}
            out = {}
            for cat, st in sb.items():
                if not re.match(r'^\d{1,9}$', str(cat)) or not isinstance(st, dict):
                    raise ValueError('Неверное соответствие этапов воронки')
                out[str(cat)] = {
                    k: str(v)[:60]
                    for k, v in st.items()
                    if k in stage_keys and v and re.match(r'^[A-Za-z0-9_:]{1,60}$', str(v))
                }
            new['stagesBy'] = out
            main = out.get(str(new.get('category') or '0'))
            if main is not None:
                new['stages'] = main  # основная воронка — и в прежнем поле (совместимость)
        if 'fields' in d:
            fs = d['fields'] if isinstance(d['fields'], dict) else {}
            out = {}
            for key, x in fs.items():
                f = cls.spec(key)
                if not f or not isinstance(x, dict):
                    continue
                y = {}
                if x.get('dir') not in (None, ''):
                    y['dir'] = pick(x['dir'], f[4], f'направление поля «{f[1]}»')
                if x.get('win') not in (None, ''):
                    y['win'] = pick(x['win'], cls.WINS, f'кто главный у поля «{f[1]}»')
                if f[3] and x.get('bx'):
                    bx = str(x['bx']).strip().upper()
                    if not cls.BX_FIELD.match(bx):
                        raise ValueError(f'Неверное поле Битрикса у «{f[1]}»')
                    y['bx'] = bx
                out[key] = y
            new['fields'] = out
        if 'send' in d:
            s = d['send'] if isinstance(d['send'], dict) else {}
            fl = s.get('files') if isinstance(s.get('files'), dict) else {}
            new['send'] = {
                'rows': s.get('rows', True) is not False,
                'rowsHow': pick(s.get('rowsHow'), ('kp', 'sum'), 'товары') or 'kp',
                'files': {k: fl.get(k, True) is not False for k in cls.FILES},
                'fileMB': cls._num(s.get('fileMB'), cls.FILE_MB, 'Предел файла, МБ'),
            }
        if 'company' in d:
            c = d['company'] if isinstance(d['company'], dict) else {}
            new['company'] = {
                'find': pick(c.get('find'), cls.FIND, 'поиск компании') or 'inn_name',
                'create': c.get('create', True) is not False,
                'contacts': pick(c.get('contacts'), DIRS, 'контакты') or 'both',
                'reqs': c.get('reqs', True) is not False,
            }
        if 'tasks' in d:
            t = d['tasks'] if isinstance(d['tasks'], dict) else {}
            k = t.get('kinds') if isinstance(t.get('kinds'), dict) else {}
            new['tasks'] = {
                'kinds': {x: pick(k.get(x), cls.TASK_AS, 'вид дела') or 'todo' for x in cls.TASK_KINDS},
                'cancel': t.get('cancel', True) is not False,
                'other': t.get('other', True) is not False,
            }
        if 'sched' in d:
            s = d['sched'] if isinstance(d['sched'], dict) else {}
            for k in ('from', 'to'):
                if s.get(k) and not cls.TIME.match(str(s[k])):
                    raise ValueError('Время обмена — ЧЧ:ММ, например 08:00')
            new['sched'] = {
                'from': str(s.get('from') or ''),
                'to': str(s.get('to') or ''),
                'batch': cls._num(s.get('batch'), cls.BATCH, 'Записей за один обмен'),
                'tries': cls._num(s.get('tries'), cls.TRIES, 'Попыток отправки'),
            }
        return new

    @staticmethod
    def _num(v, rng: tuple, what: str) -> int:
        if v in (None, ''):
            return rng[2]
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise ValueError(f'{what} — целое число') from None
        if not rng[0] <= v <= rng[1]:
            raise ValueError(f'{what} — от {rng[0]} до {rng[1]}')
        return v
