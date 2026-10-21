"""Тонкая настройка обмена с Битрикс24: направления, поля, воронки, менеджеры, компании, дела, расписание."""

import re
from datetime import datetime
from typing import Any

from bitrix_my import MyCompanies

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
    MY_ID = re.compile(r'^\d{0,12}$')
    BX_FIELD = re.compile(r'^[A-Z][A-Z0-9_]{1,60}$')
    TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
    BATCH = (10, 2000, 200)
    TRIES = (1, 100, 20)
    FILE_MB = (1, 100, 20)

    def __init__(self, conf) -> None:
        self.conf = conf if isinstance(conf, dict) else {}

    def mode(self) -> str:
        mgr = self.conf.get('mode')
        return mgr if mgr in ('both', 'in', 'out') else 'both'

    def flow(self, kind: str) -> str:
        v = (self.conf.get('flow') or {}).get(kind)
        return v if v in DIRS else self.mode()

    @staticmethod
    def allow(data: str, way: str) -> bool:
        return data in ('both', way)

    def mgr(self, mid: str | None) -> dict:
        mgr = (self.conf.get('mgr') or {}).get(str(mid or '')) or {}
        return {
            'on': mgr.get('on', True) is not False,
            'dir': mgr.get('dir') if mgr.get('dir') in DIRS else '',
            'cat': str(mgr.get('cat') or ''),
        }

    def can(self, kind: str, way: str, mid: str | None = None) -> bool:
        """Передавать ли вид данных kind в сторону way ('out' — в Битрикс, 'in' — в программу) для менеджера mid."""
        if not self.allow(self.flow(kind), way):
            return False
        if mid:
            mgr = self.mgr(mid)
            if not mgr['on'] or not self.allow(mgr['dir'] or 'both', way):
                return False
        return True

    @classmethod
    def spec(cls, key: str) -> tuple | None:
        return next((field for field in cls.FIELDS if field[0] == key), None)

    def field(self, key: str) -> dict:
        """{bx, dir, win, label, own}: поле Битрикса, направление, кто главный при правке с обеих сторон."""
        spec = self.spec(key)
        if spec is None:
            raise ValueError(f'Неизвестное поле обмена: {key}')
        mine = (self.conf.get('fields') or {}).get(key) or {}
        bx_code = str(mine.get('bx') if spec[3] and mine.get('bx') else spec[2])
        direction = mine.get('dir') if mine.get('dir') in spec[4] else spec[5]
        win = mine.get('win') if mine.get('win') in self.WINS else 'last'
        return {
            'bx': bx_code,
            'dir': direction,
            'win': win,
            'label': spec[1],
            'own': bool(spec[6]) and bx_code.startswith('UF_CRM_KP_'),
        }

    def own_fields(self) -> list:
        """Свои поля сделки, которые программа создаёт в Битриксе: [(код без UF_CRM_, тип, подпись)] — только включённые."""
        out = []
        for field in self.FIELDS:
            if not field[6]:
                continue
            x = self.field(field[0])
            if x['dir'] != 'off' and x['own']:
                out.append((x['bx'][len('UF_CRM_') :], field[6], field[1]))
        return out

    def category(self):
        return str(self.conf.get('category') or '0')

    def cat_of(self, mid: str | None) -> str:
        return self.mgr(mid)['cat'] or self.category()

    def pull_cats(self) -> list:
        cats = [self.category()] + [str(x) for x in (self.conf.get('cats') or [])]
        cats += [
            mgr.get('cat') for mgr in (self.conf.get('mgr') or {}).values() if isinstance(mgr, dict) and mgr.get('cat')
        ]
        out = []
        for x in cats:
            if x not in out:
                out.append(x)
        return out

    def stages(self, cat=None) -> dict:
        cat = str(cat if cat is not None else self.category())
        stages_by = (self.conf.get('stagesBy') or {}).get(cat)
        if isinstance(stages_by, dict) and stages_by:
            return stages_by
        return (self.conf.get('stages') or {}) if cat == self.category() else {}

    def send(self) -> dict:
        send = self.conf.get('send') or {}
        files = picked if isinstance(picked := send.get('files'), dict) else {}
        return {
            'rows': send.get('rows', True) is not False,
            'rowsHow': send.get('rowsHow') if send.get('rowsHow') in ('kp', 'sum') else 'kp',
            'files': {k: files.get(k, True) is not False for k in self.FILES},
            'fileMB': self._int(send.get('fileMB'), self.FILE_MB),
        }

    def company(self) -> dict:
        company = self.conf.get('company') or {}
        return {
            'find': company.get('find') if company.get('find') in self.FIND else 'inn_name',
            'create': company.get('create', True) is not False,
            'contacts': company.get('contacts') if company.get('contacts') in DIRS else 'both',
            'reqs': company.get('reqs', True) is not False,
            'my': str(company.get('my') or '') if self.MY_ID.match(str(company.get('my') or '')) else '',
        }

    def tasks(self) -> dict:
        tasks = self.conf.get('tasks') or {}
        k = picked if isinstance(picked := tasks.get('kinds'), dict) else {}
        return {
            'kinds': {x: (k.get(x) if k.get(x) in self.TASK_AS else 'todo') for x in self.TASK_KINDS},
            'cancel': tasks.get('cancel', True) is not False,
            'other': tasks.get('other', True) is not False,
        }

    def sched(self) -> dict:
        sched = self.conf.get('sched') or {}
        return {
            'from': sched.get('from') if self.TIME.match(str(sched.get('from') or '')) else '',
            'to': sched.get('to') if self.TIME.match(str(sched.get('to') or '')) else '',
            'batch': self._int(sched.get('batch'), self.BATCH),
            'tries': self._int(sched.get('tries'), self.TRIES),
        }

    def in_hours(self, now=None) -> bool:
        sched = self.sched()
        if not sched['from'] or not sched['to'] or sched['from'] == sched['to']:
            return True
        hhmm = (now or datetime.now()).strftime('%H:%M')
        return (
            sched['from'] <= hhmm < sched['to']
            if sched['from'] < sched['to']
            else (hhmm >= sched['from'] or hhmm < sched['to'])
        )  # через полночь

    def fallback(self) -> str:
        return str(self.conf.get('fallback') or '')

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
            'flow': {k: (self.conf.get('flow') or {}).get(k) or '' for k in self.KINDS},
            'mgr': {k: self.mgr(k) for k in (self.conf.get('mgr') or {})},
            'fallback': self.fallback(),
            'cats': [str(x) for x in (self.conf.get('cats') or [])],
            'stagesBy': self.conf.get('stagesBy') or {},
            'fields': {field[0]: self.field(field[0]) for field in self.FIELDS},
            'send': self.send(),
            'company': self.company(),
            'tasks': self.tasks(),
            'sched': self.sched(),
            'spec': [
                {
                    'key': field[0],
                    'label': field[1],
                    'bx': field[2],
                    'pick': field[3],
                    'dirs': list(field[4]),
                    'def': field[5],
                    'shared': field[0] in self.SHARED,
                }
                for field in self.FIELDS
            ],
        }

    @classmethod
    def check(cls, new: dict, data: dict, managers, stage_keys) -> dict:
        """Проверить и записать в new правила из d (только известные ключи). ValueError — понятным текстом."""

        def pick(v, allowed, what):
            if v in (None, ''):
                return ''
            if v not in allowed:
                raise ValueError(f'Неверное значение: {what}')
            return v

        if 'mode' in data:
            new['mode'] = pick(data['mode'], ('both', 'in', 'out'), 'направление обмена') or 'both'
        if 'flow' in data:
            flow: Any = data['flow'] if isinstance(data['flow'], dict) else {}
            new['flow'] = {
                k: pick(flow.get(k), DIRS, f'направление «{v}»') for k, v in cls.KINDS.items() if flow.get(k)
            }
        if 'mgr' in data:
            mgr = data['mgr'] if isinstance(data['mgr'], dict) else {}
            out = {}
            for mid, x in mgr.items():
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
        if 'fallback' in data:
            fallback = str(data.get('fallback') or '')
            if fallback and fallback != 'skip' and fallback not in managers:
                raise ValueError('Неверный менеджер для сделок без ответственного')
            new['fallback'] = fallback
        if 'cats' in data:
            cats = data['cats'] if isinstance(data['cats'], list) else []
            if any(not re.match(r'^\d{1,9}$', str(x)) for x in cats):
                raise ValueError('Неверная воронка')
            new['cats'] = sorted({str(x) for x in cats})[:20]
        if 'stagesBy' in data:
            stages_by = data['stagesBy'] if isinstance(data['stagesBy'], dict) else {}
            out = {}
            for cat, stage in stages_by.items():
                if not re.match(r'^\d{1,9}$', str(cat)) or not isinstance(stage, dict):
                    raise ValueError('Неверное соответствие этапов воронки')
                out[str(cat)] = {
                    k: str(v)[:60]
                    for k, v in stage.items()
                    if k in stage_keys and v and re.match(r'^[A-Za-z0-9_:]{1,60}$', str(v))
                }
            new['stagesBy'] = out
            main = out.get(str(new.get('category') or '0'))
            if main is not None:
                new['stages'] = main  # основная воронка — и в прежнем поле (совместимость)
        if 'fields' in data:
            fields = data['fields'] if isinstance(data['fields'], dict) else {}
            out = {}
            for key, x in fields.items():
                flow = cls.spec(key)
                if not flow or not isinstance(x, dict):
                    continue
                y = {}
                if x.get('dir') not in (None, ''):
                    y['dir'] = pick(x['dir'], flow[4], f'направление поля «{flow[1]}»')
                if x.get('win') not in (None, ''):
                    y['win'] = pick(x['win'], cls.WINS, f'кто главный у поля «{flow[1]}»')
                if flow[3] and x.get('bx'):
                    bx_code = str(x['bx']).strip().upper()
                    if not cls.BX_FIELD.match(bx_code):
                        raise ValueError(f'Неверное поле Битрикса у «{flow[1]}»')
                    y['bx'] = bx_code
                out[key] = y
            new['fields'] = out
        if 'send' in data:
            send = data['send'] if isinstance(data['send'], dict) else {}
            files = picked if isinstance(picked := send.get('files'), dict) else {}
            new['send'] = {
                'rows': send.get('rows', True) is not False,
                'rowsHow': pick(send.get('rowsHow'), ('kp', 'sum'), 'товары') or 'kp',
                'files': {k: files.get(k, True) is not False for k in cls.FILES},
                'fileMB': cls._num(send.get('fileMB'), cls.FILE_MB, 'Предел файла, МБ'),
            }
        if 'company' in data:
            company = data['company'] if isinstance(data['company'], dict) else {}
            new['company'] = {
                'find': pick(company.get('find'), cls.FIND, 'поиск компании') or 'inn_name',
                'create': company.get('create', True) is not False,
                'contacts': pick(company.get('contacts'), DIRS, 'контакты') or 'both',
                'reqs': company.get('reqs', True) is not False,
                'my': MyCompanies.clean(company.get('my')),
            }
        if 'tasks' in data:
            tasks = data['tasks'] if isinstance(data['tasks'], dict) else {}
            kinds = picked if isinstance(picked := tasks.get('kinds'), dict) else {}
            new['tasks'] = {
                'kinds': {x: pick(kinds.get(x), cls.TASK_AS, 'вид дела') or 'todo' for x in cls.TASK_KINDS},
                'cancel': tasks.get('cancel', True) is not False,
                'other': tasks.get('other', True) is not False,
            }
        if 'sched' in data:
            send = data['sched'] if isinstance(data['sched'], dict) else {}
            for k in ('from', 'to'):
                if send.get(k) and not cls.TIME.match(str(send[k])):
                    raise ValueError('Время обмена — ЧЧ:ММ, например 08:00')
            new['sched'] = {
                'from': str(send.get('from') or ''),
                'to': str(send.get('to') or ''),
                'batch': cls._num(send.get('batch'), cls.BATCH, 'Записей за один обмен'),
                'tries': cls._num(send.get('tries'), cls.TRIES, 'Попыток отправки'),
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
