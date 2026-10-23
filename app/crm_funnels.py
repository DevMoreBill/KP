"""Воронки сделок кабинета: своя воронка программы и воронки, повторяющие Битрикс24 (стадии, цвета), поля сделки Битрикса."""

import re
from datetime import date
from typing import Any

from kp_track import Val


class Funnels:
    """Воронки: «main» — своя воронка программы (этапы — Stages), «b<номер>» — воронка Битрикс24 со своими стадиями.

    Стадия сделки воронки Битрикса хранится как в Битриксе (STATUS_ID); закрытые стадии («успех» и «провал» — их у
    воронки бывает несколько, провал — по причине) в столбце этапа сводятся к «won» и «lost», точная — в описании сделки.
    """

    KEY = 'crm.funnels'
    MAIN = 'main'
    MAIN_NAME = 'Сделки по КП'
    PREFIX = 'b'
    WON = 'won'
    LOST = 'lost'
    CLOSED = (WON, LOST)
    TRACK = ('lead', 'sent', 'talks', 'contract')
    ID_RE = re.compile(r'^b\d{1,6}$')
    NAME_MAX = 80
    COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')

    def __init__(self, store) -> None:
        self.store = store

    def conf(self) -> dict:
        data = self.store.kv_get(self.KEY) or {}
        return data if isinstance(data, dict) else {}

    def mirror(self) -> list[dict]:
        """Воронки Битрикса в порядке портала (со скрытыми)."""
        rows = self.conf().get('list')
        return (
            [
                dict(row, stages=self.closed_by_order(row.get('stages') or []))
                for row in rows
                if isinstance(row, dict) and self.ID_RE.match(str(row.get('id')))
            ]
            if isinstance(rows, list)
            else []
        )

    @classmethod
    def closed_by_order(cls, stages: list) -> list[dict]:
        """Закрытые стадии, если портал не прислал их вид: «…:WON» — успех, «…:LOSE» и всё после успеха — провал (как в Битриксе)."""
        out = [dict(stage) for stage in stages if isinstance(stage, dict) and stage.get('key')]
        for stage in out:
            if not stage.get('sem'):
                stage['sem'] = cls._sem_of_key(str(stage['key']))
        won = next((i for i, stage in enumerate(out) if stage.get('sem') == cls.WON), None)
        if won is not None:
            for stage in out[won + 1 :]:
                stage['sem'] = stage.get('sem') or cls.LOST
        return out

    @classmethod
    def _sem_of_key(cls, key: str) -> str:
        code = key.rsplit(':', 1)[-1].upper()
        return {'WON': cls.WON, 'LOSE': cls.LOST}.get(code, '')

    def all(self) -> list[dict]:
        """Все воронки: своя программы и Битрикса — [{id, name, bx, stages, hidden}]."""
        from crm import Stages

        main = {
            'id': self.MAIN,
            'name': str(self.conf().get('mainName') or self.MAIN_NAME),
            'bx': None,
            'hidden': bool(self.conf().get('mainHidden')),
            'stages': [
                {'key': stage['key'], 'label': stage['label'], 'sem': stage['key'] if stage.get('closed') else ''}
                for stage in Stages.all(self.store)
            ],
        }
        return [main, *self.mirror()]

    def get(self, fid) -> dict | None:
        return next((row for row in self.all() if row['id'] == str(fid or self.MAIN)), None)

    def known(self, fid) -> bool:
        return self.get(fid) is not None

    def of_bx(self, cat) -> str | None:
        """Воронка программы для воронки Битрикса cat (или None — не повторяется)."""
        fid = f'{self.PREFIX}{cat}'
        return fid if any(row['id'] == fid for row in self.mirror()) else None

    def stages(self, fid) -> list[dict]:
        funnel = self.get(fid)
        return list(funnel['stages']) if funnel else []

    def open_keys(self, fid) -> list[str]:
        return [stage['key'] for stage in self.stages(fid) if not stage.get('sem')]

    def stage(self, fid, key) -> dict | None:
        return next((stage for stage in self.stages(fid) if stage['key'] == key), None)

    def label(self, fid, key) -> str:
        found = self.stage(fid, key)
        return found['label'] if found else str(key or '')

    def resolve(self, fid, key) -> tuple[str, str] | None:
        """Стадия из запроса → (значение столбца этапа, точная стадия); общие «won» / «lost» — первая такая стадия воронки."""
        stages = self.stages(fid)
        exact = next((stage for stage in stages if stage['key'] == key), None)
        if exact is None and key in self.CLOSED:
            exact = next((stage for stage in stages if stage.get('sem') == key), None)
        if exact is None:
            return None
        return (exact.get('sem') or exact['key'], exact['key'])

    def first(self, fid) -> str:
        keys = self.open_keys(fid)
        return keys[0] if keys else self.LOST

    def track(self, fid, prog_key) -> str | None:
        """Стадия воронки для этапа хода КП (lead, sent, talks, contract): своя воронка — сам этап, Битрикса — по настройке."""
        if fid == self.MAIN:
            return prog_key
        funnel = self.get(fid) or {}
        target = (funnel.get('track') or {}).get(prog_key)
        return target if target in self.open_keys(fid) else None

    def for_new(self, mid) -> str:
        """Воронка новой сделки менеджера (из КП или кнопкой «＋ Сделка»)."""
        conf = self.conf()
        fid = (conf.get('byManager') or {}).get(str(mid or '')) or conf.get('newDeals') or self.MAIN
        funnel = self.get(fid)
        return fid if funnel and not funnel.get('hidden') else self.MAIN

    def save_mirror(self, funnels: list[dict]) -> None:
        """Воронки Битрикса (из структуры портала): настройки прежних (скрыта, ход КП) сохраняются."""
        old = {row['id']: row for row in self.mirror()}
        conf = self.conf()
        conf['list'] = [
            dict(row, hidden=bool(old.get(row['id'], {}).get('hidden')), track=self._track(row, old.get(row['id'], {})))
            for row in funnels
        ]
        conf['at'] = Val.now()
        self.store.kv_set(self.KEY, conf)

    def _track(self, row, old) -> dict:
        keys = {stage['key'] for stage in row['stages'] if not stage.get('sem')}
        return {k: v for k, v in (old.get('track') or row.get('track') or {}).items() if k in self.TRACK and v in keys}

    def options(self, data: Any) -> dict:
        """Настройки воронок из «Настроек»: скрытые, ход КП → стадии, воронка новых сделок. ValueError — с понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет настроек воронок')
        conf = self.conf()
        known = {row['id']: row for row in self.all()}
        for fid, opts in (data.get('funnels') or {}).items() if isinstance(data.get('funnels'), dict) else []:
            if fid not in known or not isinstance(opts, dict):
                raise ValueError('Неизвестная воронка')
            self._apply_options(conf, known[fid], opts)
        if 'newDeals' in data:
            conf['newDeals'] = self._fid(data['newDeals'], known)
        if 'byManager' in data:
            conf['byManager'] = {
                str(mid)[:64]: self._fid(fid, known) for mid, fid in (data['byManager'] or {}).items() if fid
            }
        if 'mainName' in data:
            conf['mainName'] = Val.text(data['mainName'], self.NAME_MAX)
        self.store.kv_set(self.KEY, conf)
        return conf

    def _apply_options(self, conf, funnel, opts) -> None:
        if funnel['id'] == self.MAIN:
            if 'hidden' in opts:
                conf['mainHidden'] = bool(opts['hidden'])
            return
        row = next(item for item in conf.get('list', []) if item.get('id') == funnel['id'])
        if 'hidden' in opts:
            row['hidden'] = bool(opts['hidden'])
        if 'track' in opts:
            keys = set(self.open_keys(funnel['id']))
            track = opts['track'] if isinstance(opts['track'], dict) else {}
            bad = [v for k, v in track.items() if k in self.TRACK and v and v not in keys]
            if bad:
                raise ValueError('Стадия хода КП — не из этой воронки')
            row['track'] = {k: v for k, v in track.items() if k in self.TRACK and v}

    def _fid(self, fid, known) -> str:
        if str(fid) not in known:
            raise ValueError('Неизвестная воронка')
        return str(fid)


class UfValue:
    """Значение поля сделки Битрикса: к виду программы (сравнение, показ) и обратно — для отправки в Битрикс."""

    EDIT = frozenset(
        {
            'string',
            'double',
            'integer',
            'money',
            'date',
            'datetime',
            'enumeration',
            'boolean',
            'url',
            'crm_status',
            'iblock_element',
            'employee',
        }
    )
    TEXT_MAX = 3000
    NUMBER_MAX = 1e15
    DAY_LEN = 10
    MINUTE_LEN = 16

    @classmethod
    def norm(cls, field: dict, raw: Any) -> Any:
        """Вид программы: строка, список строк (несколько значений) или файлы [{id, name}]."""
        if field.get('type') == 'file':
            return cls._files(raw)
        if isinstance(raw, list) or field.get('multiple'):
            values = raw if isinstance(raw, list) else ([] if raw in (None, '') else [raw])
            return [one for one in (cls._one(field, value) for value in values) if one != '']
        return cls._one(field, raw)

    @classmethod
    def _one(cls, field: dict, raw: Any) -> str:
        if raw is None or raw is False:
            return '0' if field.get('type') == 'boolean' else ''
        kind = field.get('type')
        text = str(raw).strip()
        if kind == 'boolean':
            return '1' if text in ('1', 'Y', 'true', 'True') else '0'
        if kind == 'date':
            return text[: cls.DAY_LEN]
        if kind == 'datetime':
            return text[: cls.MINUTE_LEN]
        if kind in ('double', 'integer'):
            return cls._number(text)
        return text[: cls.TEXT_MAX]

    @staticmethod
    def _number(text: str) -> str:
        try:
            number = float(text.replace(' ', '').replace(',', '.'))
        except ValueError:
            return ''
        return str(int(number)) if number == int(number) else repr(number)

    @staticmethod
    def _files(raw: Any) -> list:
        items = raw if isinstance(raw, list) else [raw]
        return [
            {'id': str(item.get('id') or ''), 'name': str(item.get('name') or item.get('NAME') or '')}
            for item in items
            if isinstance(item, dict) and item.get('id')
        ]

    @classmethod
    def same(cls, field: dict, one: Any, two: Any) -> bool:
        return cls.norm(field, one) == cls.norm(field, two)

    @classmethod
    def to_bx(cls, field: dict, value: Any) -> Any:
        """Значение программы → поле Битрикса."""
        if isinstance(value, list):
            return [cls._out(field, one) for one in value]
        return cls._out(field, value)

    @staticmethod
    def _out(field: dict, value: Any) -> Any:
        if field.get('type') == 'boolean':
            return 1 if str(value) == '1' else 0
        return value

    @classmethod
    def clean(cls, field: dict, value: Any) -> Any:
        """Ввод менеджера → значение программы. ValueError — с понятным текстом."""
        label = str(field.get('label') or field.get('code') or '')
        if field.get('type') not in cls.EDIT:
            raise ValueError(f'Поле «{label}» правится только в Битрикс24')
        if isinstance(value, list):
            if not field.get('multiple'):
                raise ValueError(f'«{label}» — одно значение')
            return [cls._check(field, one, label) for one in value if str(one).strip()]
        return cls._check(field, value, label)

    @classmethod
    def _check(cls, field: dict, value: Any, label: str) -> str:
        text = str(value if value is not None else '').strip()
        if not text:
            return '0' if field.get('type') == 'boolean' else ''
        kind = str(field.get('type') or '')
        checks = {
            'double': cls._check_number,
            'integer': cls._check_number,
            'date': cls._check_day,
            'datetime': cls._check_minute,
            'enumeration': cls._check_item,
            'iblock_element': cls._check_item,
            'boolean': cls._check_flag,
        }
        check = checks.get(kind)
        return check(field, text, label) if check else text[: cls.TEXT_MAX]

    @classmethod
    def _check_number(cls, field: dict, text: str, label: str) -> str:
        number = cls._number(text)
        if not number or abs(float(number)) >= cls.NUMBER_MAX:
            raise ValueError(f'«{label}» — число')
        if field.get('type') == 'integer' and float(number) != int(float(number)):
            raise ValueError(f'«{label}» — целое число')
        return number

    @staticmethod
    def _check_day(_field: dict, text: str, label: str) -> str:
        day = Val.day(text)
        if not day:
            raise ValueError(f'«{label}» — дата ГГГГ-ММ-ДД')
        return day.isoformat()

    @classmethod
    def _check_minute(cls, _field: dict, text: str, label: str) -> str:
        if not re.match(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$', text) or not Val.day(text[: cls.DAY_LEN]):
            raise ValueError(f'«{label}» — дата и время ГГГГ-ММ-ДДTЧЧ:ММ')
        return text

    @staticmethod
    def _check_item(field: dict, text: str, label: str) -> str:
        if text not in {str(item['id']) for item in field.get('items') or []}:
            raise ValueError(f'«{label}»: такого значения в списке нет')
        return text

    @staticmethod
    def _check_flag(_field: dict, text: str, _label: str) -> str:
        return '1' if text in ('1', 'Y', 'true') else '0'


class DealFields:
    """Поля сделки Битрикса в карточке: описание (название, вид, значения списка), по каким воронкам показывать."""

    KEY = 'crm.dealFields'
    LIST_MAX = 400
    LABEL_MAX = 120
    # служебные поля портала — в карточку не берутся (их заполняют роботы Битрикса)
    SERVICE = re.compile(
        r'служебн|системн|сист\.|сист |\(не используется\)|удалить|отключено|calltouch|^id |стадия сделки \(сист|^utm',
        re.IGNORECASE,
    )
    FILL_MIN = 0.1
    # виды полей, которые карточка сделки умеет заполнять; списки — если варианты загружены
    EDIT = UfValue.EDIT
    CHOICE = frozenset(('enumeration', 'crm_status', 'iblock_element'))

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def fillable(cls, field: dict | None, users: dict | None = None) -> bool:
        """Поле можно заполнить в программе: известный вид, у списка есть варианты (сотрудник — есть пользователи)."""
        kind = str((field or {}).get('type') or '')
        if kind == 'employee':
            return bool(users)
        if kind not in cls.EDIT:
            return False
        return kind not in cls.CHOICE or bool((field or {}).get('items'))

    def all(self) -> list[dict]:
        rows = (self.store.kv_get(self.KEY) or {}).get('list')
        return [row for row in rows if isinstance(row, dict) and row.get('code')] if isinstance(rows, list) else []

    def users(self) -> dict:
        """Пользователи портала {id: имя} — для полей «сотрудник» (загружаются вместе с полями)."""
        users = (self.store.kv_get(self.KEY) or {}).get('users')
        return users if isinstance(users, dict) else {}

    def by_code(self) -> dict:
        return {row['code']: row for row in self.all()}

    def shown(self, fid) -> list[dict]:
        """Поля карточки сделки воронки fid (по порядку); поля регламента оформления сделки — во всех воронках."""
        return [row for row in self.all() if fid in (row.get('on') or []) or row.get('reg')]

    def codes(self) -> list[str]:
        """Поля, значения которых хранятся в программе (включены хоть в одной воронке)."""
        return [row['code'] for row in self.all() if row.get('on') or row.get('reg')]

    def save_rows(self, rows: list[dict]) -> None:
        self._put(rows)

    def _put(self, rows: list[dict], **extra: Any) -> None:
        conf = self.store.kv_get(self.KEY) or {}
        conf = conf if isinstance(conf, dict) else {}
        conf.update(extra, list=rows, at=Val.now())
        self.store.kv_set(self.KEY, conf)

    def save_defs(self, defs: list[dict], users: dict) -> None:
        """Описания полей портала: прежний выбор администратора (воронки, своё название) сохраняется."""
        old = self.by_code()
        rows = []
        for row in defs[: self.LIST_MAX]:
            prev = old.get(row['code'])
            keep = (
                {
                    'on': prev.get('on') or [],
                    'label': prev.get('label') or row['label'],
                    'own': prev.get('own'),
                    'reg': prev.get('reg'),
                }
                if prev
                else {}
            )
            rows.append(dict(row, **keep))
        self._put(rows, users=users)

    def choose(self, fill: dict, picked_at: date | None = None) -> int:
        """Включить поля по заполненности за год: {воронка: {код: доля}}; поля, выбранные администратором, не трогаются."""
        rows = self.all()
        changed = 0
        for row in rows:
            row['fill'] = {
                fid: round(share.get(row['code'], 0), 2) for fid, share in fill.items() if share.get(row['code'])
            }
            if row.get('own') or self.SERVICE.search(row.get('title') or '') or row.get('type') == 'iblock_element':
                continue
            want = sorted(fid for fid, share in fill.items() if share.get(row['code'], 0) >= self.FILL_MIN)
            if want != sorted(row.get('on') or []):
                row['on'] = want
                changed += 1
        self._put(rows, picked=(picked_at or date.today()).isoformat())
        return changed

    def options(self, data: Any, funnels: list[str]) -> list[dict]:
        """Выбор администратора: {код: {on: [воронки], label}}. ValueError — с понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет настроек полей')
        rows = self.all()
        index = {row['code']: row for row in rows}
        for code, opts in data.items():
            if code not in index or not isinstance(opts, dict):
                raise ValueError('Неизвестное поле Битрикс24')
            row = index[code]
            if 'on' in opts:
                row['on'] = [fid for fid in opts['on'] or [] if fid in funnels]
            if 'label' in opts:
                row['label'] = Val.text(opts['label'], self.LABEL_MAX) or row.get('title') or code
            row['own'] = True
        self._put(rows)
        return rows

    def clean(self, fid, data: Any) -> dict:
        """Правка полей карточки: {код: значение} → значения программы (только поля этой воронки)."""
        if not isinstance(data, dict):
            raise ValueError('Нет значений полей')
        fields = {row['code']: row for row in self.shown(fid)}
        out = {}
        for code, value in data.items():
            field = fields.get(code)
            if not field:
                raise ValueError('Поле не показывается в этой воронке')
            out[code] = UfValue.clean(field, value)
        return out

    @staticmethod
    def label(title: str) -> str:
        """Название поля без хвоста «1» копий полей портала («Регион1» → «Регион»)."""
        text = str(title or '').strip()
        text = re.sub(r'\?+$', '', text).strip()
        return re.sub(r'(?<=[а-яА-ЯёЁa-zA-Z)])1$', '', text).strip()
