"""Связь кабинета с Битрикс24 через входящий вебхук: API, настройки, очередь, связи, журнал, обмен, пробный прогон, старые сделки."""

import base64
import hashlib
import json
import os
import re
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta, tzinfo
from enum import Enum
from pathlib import Path
from typing import Any

from bitrix_clients import BitrixClientOut, BitrixClients
from bitrix_comms import BitrixComms
from bitrix_companies import BitrixCompanyCheck, BitrixCompanyFind
from bitrix_docs import BitrixDealDocs
from bitrix_mirror import BitrixMirror
from bitrix_my import MyCompanies
from bitrix_rules import BitrixRules
from crm import DealBook, Stages, TaskBook
from crm_funnels import DealFields, Funnels
from deal_rules import DealRegs
from kp_track import Val


class BitrixError(RuntimeError):
    def __init__(self, text, code='') -> None:
        RuntimeError.__init__(self, text)
        self.code = code


class BitrixApi:
    """REST Битрикс24 через входящий вебхук."""

    URL = re.compile(
        r'^https?://[A-Za-z0-9.-]{1,200}(:\d{1,5})?(/[A-Za-z0-9._~%-]{1,100}){0,3}/rest/\d{1,9}/[A-Za-z0-9]{6,64}/?$'
    )
    TIMEOUT = 30

    PORTAL = re.compile(r'^(https?://[^/]+)')

    @classmethod
    def portal_of(cls, url: str) -> str:
        """Адрес портала (схема и хост) из адреса вебхука."""
        found = cls.PORTAL.match(url)
        return found.group(1) if found else ''

    def __init__(self, url, opener=None) -> None:
        url = str(url or '').strip()
        if not self.URL.match(url):
            raise BitrixError(
                'Адрес вебхука — вида https://bitrix24.kompr.ru/rest/1/ключ/ (в Битриксе: Разработчикам → '
                'Другое → Входящий вебхук)'
            )
        self.url = url.rstrip('/') + '/'
        self.host = self.portal_of(url)
        self.opener = opener or urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context())
        )

    @staticmethod
    def mask(url) -> str:
        """Адрес для показа: ключ скрыт."""
        match = re.match(r'^(https?://.+/rest/\d+/)([A-Za-z0-9]+)/?$', str(url or ''))
        return (match.group(1) + '••••' + match.group(2)[-3:] + '/') if match else ''

    def call(self, method, params=None) -> Any:
        """Результат метода (result); список — (result, next) через call_raw. BitrixError — понятным текстом."""
        return self.call_raw(method, params).get('result')

    def call_raw(self, method, params=None) -> dict:
        if not re.match(r'^[a-z][A-Za-z0-9_.]{2,80}$', method):
            raise BitrixError('Неверный метод')
        body = json.dumps(params or {}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            self.url + method + '.json',
            data=body,
            method='POST',
            headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'KP-PNEVMOTEH'},
        )
        try:
            with self.opener.open(req, timeout=self.TIMEOUT) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            raw = exc.read() or b''
            data = self._json(raw)
            if data.get('error'):
                raise self._error(data) from exc
            if exc.code in (401, 403):
                raise BitrixError(
                    f'Битрикс24 не принял вебхук (HTTP {exc.code}): проверьте адрес, ключ и права вебхука', 'AUTH'
                ) from exc
            raise BitrixError(f'Битрикс24 ответил ошибкой HTTP {exc.code}', 'HTTP') from exc
        except (urllib.error.URLError, OSError) as exc:
            why = getattr(exc, 'reason', exc)
            raise BitrixError(
                'Битрикс24 недоступен: {}'.format(str(why)[:160].replace(self.url, self.host + '/…')), 'NET'
            ) from exc
        data = self._json(raw)
        if data.get('error'):
            raise self._error(data)
        if 'result' not in data:
            raise BitrixError('Битрикс24 прислал непонятный ответ', 'BAD')
        return data

    @staticmethod
    def _json(raw) -> dict:
        try:
            data = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _error(data) -> 'BitrixError':
        code = str(data.get('error') or '')
        text = str(data.get('error_description') or code)[:300]
        human = {
            'ERROR_METHOD_NOT_FOUND': 'метод не найден (старая версия Битрикса или у вебхука нет прав на этот раздел)',
            'insufficient_scope': 'у вебхука нет прав на этот раздел — добавьте права CRM, Диск, Пользователи',
            'INVALID_CREDENTIALS': 'неверный ключ вебхука',
            'NO_AUTH_FOUND': 'неверный ключ вебхука',
            'QUERY_LIMIT_EXCEEDED': 'слишком много запросов — повторю позже',
        }.get(code)
        return BitrixError(f'Битрикс24: {human or text}', code)

    def list(self, method, params=None, limit: int = 5000) -> list:
        """Все строки списка (по 50 за запрос, не больше limit)."""
        out, start = [], 0
        while True:
            data = self.call_raw(method, dict(params or {}, start=start))
            res = data.get('result')
            if isinstance(res, dict):  # новые методы: {items: […]} или {categories: […]}
                res = next((v for k, v in res.items() if isinstance(v, list)), [])
            out += res if isinstance(res, list) else []
            nxt = data.get('next')
            if not nxt or len(out) >= limit:
                return out[:limit]
            start = nxt


class BitrixConf:
    """Настройка связи (kv «bitrix»)."""

    KEY = 'bitrix'
    POLL = (30, 3600, 90)  # опрос изменений: от, до, по умолчанию — секунды

    def __init__(self, store) -> None:
        self.store = store

    def get(self) -> dict:
        data = self.store.kv_get(self.KEY) or {}
        return data if isinstance(data, dict) else {}

    def enabled(self) -> bool:
        data = self.get()
        return bool(data.get('on') and data.get('url'))

    def api(self, opener=None) -> 'BitrixApi':
        data = self.get()
        if not data.get('url'):
            raise BitrixError('Адрес вебхука не задан — «Настройки → Связи → Битрикс24 → Связь и включение»')
        return BitrixApi(data['url'], opener)

    def poll(self) -> int:
        try:
            v = int(self.get().get('pollSec') or self.POLL[2])
        except (TypeError, ValueError):
            v = self.POLL[2]
        return min(max(v, self.POLL[0]), self.POLL[1])

    def view(self) -> dict:
        """Для «Настроек»: без ключа."""
        data = self.get()
        out = {
            k: data.get(k)
            for k in ('on', 'category', 'stages', 'users', 'since', 'lastPull', 'lastRun', 'at', 'by', 'portal')
        }
        out.update(
            url=BitrixApi.mask(data.get('url')),
            hasUrl=bool(data.get('url')),
            pollSec=self.poll(),
            rules=BitrixRules(data).view(),
        )
        return out

    def rules(self) -> BitrixRules:
        return BitrixRules(self.get())

    def save(self, data, author: str) -> dict:
        """Изменить настройку: url, on, category, stages, users, pollSec и правила обмена (BitrixRules.check). ValueError — понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет данных')
        cur = self.get()
        new = dict(cur)
        if 'url' in data:
            u = str(data.get('url') or '').strip()
            if u:
                BitrixApi(u)  # проверка вида адреса
                new['url'] = u
                new['portal'] = BitrixApi.portal_of(u)
            else:
                new.pop('url', None)
                new['on'] = False
        if 'category' in data:
            cat = str(data.get('category') if data.get('category') is not None else '')
            if cat and not re.match(r'^\d{1,9}$', cat):
                raise ValueError('Неверная воронка')
            old = str(cur.get('category') or '0')
            if (cat or '0') != old:  # этапы прежней основной воронки остаются за ней; у новой — свои (если были)
                stages_by = dict(new.get('stagesBy') or {})
                if cur.get('stages'):
                    stages_by.setdefault(old, cur['stages'])
                new['stagesBy'] = stages_by
                new['stages'] = stages_by.get(cat or '0', {})
            new['category'] = cat
        if 'stages' in data:
            stages = data.get('stages')
            if not isinstance(stages, dict):
                raise ValueError('Неверное соответствие этапов')
            keys = Stages.keys(self.store)
            new['stages'] = {
                k: str(v)[:60]
                for k, v in stages.items()
                if k in keys and v and re.match(r'^[A-Za-z0-9_:]{1,60}$', str(v))
            }
            new['stagesBy'] = dict(new.get('stagesBy') or {}, **{str(new.get('category') or '0'): new['stages']})
        if 'users' in data:
            users = data.get('users')
            if not isinstance(users, dict):
                raise ValueError('Неверное соответствие менеджеров')
            new['users'] = {
                str(k)[:64]: str(v)
                for k, v in users.items()
                if re.match(r'^[A-Za-z0-9_-]{1,64}$', str(k)) and re.match(r'^\d{1,9}$', str(v or ''))
            }
        if 'pollSec' in data:
            try:
                poll = int(data['pollSec'])
            except (TypeError, ValueError):
                raise ValueError('Как часто спрашивать изменения — число секунд') from None
            if not (self.POLL[0] <= poll <= self.POLL[1]):
                raise ValueError(f'Как часто спрашивать изменения — от {self.POLL[0]} до {self.POLL[1]} с')
            new['pollSec'] = poll
        mids = {row[0] for row in self.store.all('SELECT id FROM managers')}
        BitrixRules.check(
            new, data, mids, Stages.keys(self.store)
        )  # тонкая настройка: направления, менеджеры, поля, воронки…
        if 'on' in data:
            enabled = bool(data.get('on'))
            if enabled and not new.get('url'):
                raise ValueError('Сначала задайте адрес вебхука')
            if enabled and not new.get('category'):
                new['category'] = '0'
            if enabled and not cur.get('on'):
                new['since'] = new.get('since') or BitrixTime.now()  # новые сделки Битрикса — созданные после включения
            new['on'] = enabled
        new.update(at=Val.now(), by=str(author or '')[:120])
        self.store.kv_set(self.KEY, new)
        return new

    def mark(self, **kw) -> None:
        data = self.get()
        data.update(kw)
        self.store.kv_set(self.KEY, data)


class BitrixTime:
    """Время Битрикса: ISO с поясом ↔ местное время программы."""

    @staticmethod
    def now() -> str:
        return datetime.now(UTC).astimezone().isoformat(timespec='seconds')

    @staticmethod
    def local(text) -> str:
        """'2026-10-17T15:00:00+03:00' → местное 'ГГГГ-ММ-ДДTЧЧ:ММ:СС' (для сравнения с правками программы)."""
        try:
            moment = datetime.fromisoformat(str(text or '').strip())
            if moment.tzinfo:  # пояс сервера явно: astimezone() без него в Windows падает на датах до 1970 и после 3000
                moment = moment.astimezone(BitrixTime.zone()).replace(tzinfo=None)
        except (ValueError, OverflowError):
            return ''
        return moment.isoformat(timespec='seconds')

    @staticmethod
    def zone() -> tzinfo:
        """Пояс сервера программы (смещение от UTC сейчас)."""
        return datetime.now(UTC).astimezone().tzinfo or UTC

    @staticmethod
    def day(text) -> str:
        return str(text or '')[:10] if re.match(r'^\d{4}-\d{2}-\d{2}', str(text or '')) else ''


class BitrixLinks:
    """Соответствие записей программы и Битрикса: (вид, id в программе) ↔ id в Битриксе и согласованные значения полей."""

    def __init__(self, store) -> None:
        self.store = store

    def get(self, kind, local) -> dict | None:
        row = self.store.one('SELECT bx_id, sent, at FROM bx_link WHERE kind=? AND local_id=?', (kind, str(local)))
        if not row:
            return None
        try:
            sent = json.loads(row[1]) if row[1] else {}
        except ValueError:
            sent = {}
        return {'bx': row[0], 'sent': sent if isinstance(sent, dict) else {}, 'at': row[2]}

    def local(self, kind, bx_id) -> str | None:
        row = self.store.one('SELECT local_id FROM bx_link WHERE kind=? AND bx_id=?', (kind, str(bx_id)))
        return row[0] if row else None

    def put(self, kind, local, bx_id, sent=None) -> None:
        self.store.write(
            'INSERT OR REPLACE INTO bx_link (kind, local_id, bx_id, sent, at) VALUES (?,?,?,?,?)',
            (kind, str(local), str(bx_id), json.dumps(sent or {}, ensure_ascii=False), Val.now()),
        )

    def count(self, kind) -> int:
        return self.store.scalar('SELECT COUNT(*) FROM bx_link WHERE kind=?', (kind,))


class BitrixQueue:
    """Что отправить в Битрикс: (вид, id). Повтор с паузой; после 20 неудач — ждёт «Отправить снова» в «Настройках»."""

    MAX_TRIES = 20
    _quiet = threading.local()  # изменения, пришедшие из Битрикса, обратно не отправляются

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def quiet(cls) -> bool:
        return getattr(cls._quiet, 'on', False)

    @classmethod
    def touch(cls, store, kind, local) -> None:
        """Событие программы: поставить в очередь, если связь включена (ошибка здесь не мешает работе программы)."""
        if cls.quiet() or not local:
            return
        try:
            if not BitrixConf(store).enabled():
                return
            store.write(
                'INSERT INTO bx_queue (kind, local_id, added, tries, next_at) VALUES (?,?,?,0,?) '
                'ON CONFLICT(kind, local_id) DO UPDATE SET added=excluded.added, tries=0, error=NULL, next_at=excluded.next_at',
                (kind, str(local), Val.now(), Val.now()),
            )
        except Exception:
            pass

    def due(self, limit: int = 200, tries=None) -> list:
        return self.store.all(
            'SELECT kind, local_id, tries FROM bx_queue WHERE tries < ? AND (next_at IS NULL OR next_at <= ?) '
            "ORDER BY CASE kind WHEN 'deal' THEN 0 ELSE 1 END, added LIMIT ?",
            (tries or self.MAX_TRIES, Val.now(), limit),
        )

    def done(self, kind, local) -> None:
        self.store.write('DELETE FROM bx_queue WHERE kind=? AND local_id=?', (kind, str(local)))

    def fail(self, kind, local, tries, err) -> None:
        wait = min(60 * (2 ** min(tries, 6)), 3600)
        nxt = (datetime.now() + timedelta(seconds=wait)).isoformat(timespec='seconds')
        self.store.write(
            'UPDATE bx_queue SET tries=?, error=?, next_at=? WHERE kind=? AND local_id=?',
            (tries + 1, str(err)[:300], nxt, kind, str(local)),
        )

    def retry_all(self) -> None:
        self.store.write('UPDATE bx_queue SET tries=0, next_at=NULL, error=NULL')

    def retry(self, kind, local) -> bool:
        """Одну запись — отправить при следующем обмене. → была ли такая запись."""
        if not self.store.one('SELECT 1 FROM bx_queue WHERE kind=? AND local_id=?', (kind, str(local))):
            return False
        self.store.write(
            'UPDATE bx_queue SET tries=0, next_at=NULL, error=NULL WHERE kind=? AND local_id=?', (kind, str(local))
        )
        return True

    def failed(self, limit: int = 50) -> list[dict]:
        """Не отправленное с ошибкой: [{kind, id, title, error, tries, added}] — для «Повторить» в «Настройках»."""
        out = []
        for kind, local, tries, err, added in self.store.all(
            'SELECT kind, local_id, tries, error, added FROM bx_queue WHERE error IS NOT NULL '
            'ORDER BY added DESC LIMIT ?',
            (limit,),
        ):
            if kind == 'deal':
                deal = DealBook(self.store).get(local) or {}
                title = 'Сделка № {} «{}»'.format(
                    deal.get('number') or local, deal.get('title') or deal.get('client') or ''
                )
            else:
                task = TaskBook(self.store).get(int(local)) if str(local).isdigit() else None
                title = f'Дело «{(task or {}).get("title") or local}»'
            out.append(
                {
                    'kind': kind,
                    'id': local,
                    'title': title,
                    'error': err or '',
                    'tries': tries or 0,
                    'added': added or '',
                }
            )
        return out

    def stats(self) -> dict:
        count, bad = self.store.one('SELECT COUNT(*), SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) FROM bx_queue')
        last = self.store.one('SELECT error FROM bx_queue WHERE error IS NOT NULL ORDER BY added DESC LIMIT 1')
        return {'queued': count or 0, 'failed': bad or 0, 'lastError': last[0] if last else ''}


class BitrixLog:
    KEEP = 1000

    def __init__(self, store) -> None:
        self.store = store

    def add(self, text, level='info', mid: str | None = None) -> None:
        """Запись журнала; mid — менеджер сделки или дела (отбор журнала по менеджеру в «Настройках»)."""
        self.store.write(
            'INSERT INTO bx_log (at, level, text, mid) VALUES (?,?,?,?)',
            (Val.now(), level, str(text)[:600], str(mid or '') or None),
        )
        self.store.write(
            'DELETE FROM bx_log WHERE id NOT IN (SELECT id FROM bx_log ORDER BY id DESC LIMIT ?)', (self.KEEP,)
        )

    def tail(self, count=60) -> list:
        return [
            {'at': stamp, 'level': level, 'text': text, 'mid': meta or ''}
            for stamp, level, text, meta in self.store.all(
                'SELECT at, level, text, mid FROM bx_log ORDER BY id DESC LIMIT ?', (count,)
            )
        ]

    def last_id(self) -> int:
        return self.store.scalar('SELECT COALESCE(MAX(id), 0) FROM bx_log')

    def since(self, i) -> list:
        return [
            {'level': level, 'text': text}
            for level, text in self.store.all('SELECT level, text FROM bx_log WHERE id > ? ORDER BY id', (i,))
        ]


class BitrixFields:
    """Свои поля сделки в Битриксе для экономики и номеров КП (создаются программой один раз)."""

    LIST = (
        ('KP_NUMBER', 'string', 'КП (номера)'),
        ('KP_PRICE', 'double', 'Цена для заказчика с НДС, ₽'),
        ('KP_REVENUE', 'double', 'Выручка без НДС, ₽'),
        ('KP_COST', 'double', 'Себестоимость с финансированием, ₽'),
        ('KP_FINANCE', 'double', 'Финансирование, ₽'),
        ('KP_PROFIT', 'double', 'Прибыль до налога, ₽'),
        ('KP_NET', 'double', 'Чистая прибыль, ₽'),
        ('KP_MARGIN', 'double', 'Маржинальность, %'),
        ('KP_MARKUP', 'double', 'Наценка, %'),
        ('KP_ECON', 'string', 'Экономика сделки: структура затрат и график платежей'),
    )

    @staticmethod
    def name(code) -> str:
        return 'UF_CRM_' + code

    @classmethod
    def ensure(cls, api, want=None) -> int:
        """Создать недостающие свои поля сделки: want — [(код без UF_CRM_, тип, подпись)] (по умолчанию — поля экономики)."""
        have = {field.get('FIELD_NAME') for field in api.list('crm.deal.userfield.list', {'filter': {}})}
        made = 0
        for code, typ, label in cls.LIST if want is None else want:
            if cls.name(code) in have:
                continue
            field = {
                'FIELD_NAME': code,
                'USER_TYPE_ID': typ,
                'EDIT_FORM_LABEL': label,
                'LIST_COLUMN_LABEL': label,
                'LIST_FILTER_LABEL': label,
                'XML_ID': code,
            }
            if code == 'KP_ECON':
                field['SETTINGS'] = {'ROWS': 12}
            api.call('crm.deal.userfield.add', {'fields': field})
            made += 1
        return made


class Sides(Enum):
    """Стороны обмена с Битрикс24: обе, только отправка, только получение."""

    BOTH = 'both'
    SEND = 'send'
    RECEIVE = 'receive'


class KpNote:
    """Запись в ленте сделки Битрикса об одном КП: что предложено, итог, срок действия, краткая экономика — и файлы КП."""

    SHOWN = 8
    KOPECKS = 100

    @staticmethod
    def rub(value: Any) -> str:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return '—'
        return f'{number:,.0f} ₽'.replace(',', '\u00a0')

    @staticmethod
    def _day(value: Any) -> str:
        day = str(value or '')[:10]
        return '.'.join(reversed(day.split('-'))) if re.match(r'^\d{4}-\d{2}-\d{2}$', day) else ''

    @classmethod
    def full(cls, offer: dict, files: list[str]) -> str:
        """Текст записи с краткой экономикой; files — подписи приложенных файлов."""
        return cls._join([*cls._offer(offer), cls._econ((offer.get('meta') or {}).get('deal')), cls._files(files)])

    @classmethod
    def brief(cls, offer: dict, files: list[str]) -> str:
        """Текст записи без экономики (поля экономики в «Поля сделки» выключены)."""
        return cls._join([*cls._offer(offer), cls._files(files)])

    @classmethod
    def head(cls, offer: dict) -> str:
        return cls._head(offer, offer.get('meta') or {})

    @classmethod
    def _offer(cls, offer: dict) -> list[str]:
        meta = offer.get('meta') or {}
        return [cls._head(offer, meta), *cls._items(meta), cls._total(offer, meta)]

    @staticmethod
    def _files(files: list[str]) -> str:
        return 'Файлы: ' + ', '.join(dict.fromkeys(files)) if files else ''

    @staticmethod
    def _join(lines: list[str]) -> str:
        return '\n'.join(line for line in lines if line)

    @classmethod
    def _head(cls, offer: dict, meta: dict) -> str:
        when = cls._day(meta.get('date'))
        return 'КП № {}{}'.format(offer.get('number') or offer.get('id'), f' от {when}' if when else '')

    @classmethod
    def _items(cls, meta: dict) -> list[str]:
        rows = (meta.get('lines') or {}).get('rows') if isinstance(meta.get('lines'), dict) else None
        rate = float((meta.get('lines') or {}).get('rate') or 1) if rows else 1
        if not isinstance(rows, list) or not rows:
            names = [str(name) for name in meta.get('items') or [] if name]
            return ['Предложено: ' + '; '.join(names)] if names else []
        out = ['Предложено:']
        for row in rows[: cls.SHOWN]:
            qty = float(row.get('q') or 1)
            price = float(row.get('p') or 0) / cls.KOPECKS * rate
            amount = f'{qty:g}'
            out.append('• {} — {} {} × {}'.format(row.get('n'), amount, row.get('u') or 'шт', cls.rub(price)))
        if len(rows) > cls.SHOWN:
            out.append(f'• и ещё позиций: {len(rows) - cls.SHOWN}')
        return out

    @classmethod
    def _total(cls, offer: dict, meta: dict) -> str:
        total = offer.get('sum')
        if total is None:
            return ''
        until = cls._day(meta.get('validUntil'))
        valid = f' · действует до {until}' if until else ''
        vat = (meta.get('lines') or {}).get('vat') if isinstance(meta.get('lines'), dict) else None
        tax = f' (с НДС {vat:g} %)' if isinstance(vat, (int, float)) and vat > 0 else ''
        return f'Итого: {cls.rub(float(total) / cls.KOPECKS)}{tax}{valid}'

    @classmethod
    def _econ(cls, deal: Any) -> str:
        if not isinstance(deal, dict) or not isinstance(deal.get('full'), dict):
            return ''
        full = deal['full']
        parts = [f'выручка без НДС {cls.rub(full.get("revenue"))}', f'себестоимость {cls.rub(full.get("cost"))}']
        if deal.get('confirmed'):
            parts.append(f'прибыль до налога {cls.rub(deal.get("profit"))}')
            parts.append('маржинальность {:.1f} %'.format(float(deal.get('margin') or 0)).replace('.', ','))
            if deal.get('net') is not None:
                parts.append(f'чистая прибыль {cls.rub(deal.get("net"))}')
        else:
            low, high = cls.rub(deal.get('lo')), cls.rub(deal.get('hi'))
            parts.append(f'прибыль до налога {low} – {high} (не указан ввозной НДС к вычету)')
        return 'Экономика: ' + ' · '.join(parts)


class BitrixSync:
    """Обмен с Битрикс24: очередь отправки и опрос изменений."""

    TEXT_MAX = 40
    PEOPLE_KEEP = 500  # отметок «контакты уже подтягивали сегодня»
    PEOPLE_BATCH = 30  # сделок за фоновый проход

    LOCK = threading.Lock()
    KIND = BitrixRules.TASK_KINDS
    SHARED = BitrixRules.SHARED  # правка с обеих сторон: кто главный — по правилу поля (по умолчанию последняя правка)
    STD = {'title': 'TITLE', 'stage': 'STAGE_ID', 'expected': 'CLOSEDATE', 'manager': 'ASSIGNED_BY_ID'}
    WHO = 'Битрикс24'
    SEM_OURS = {'S': Funnels.WON, 'F': Funnels.LOST}

    def __init__(self, store, opener=None, files=None) -> None:
        self.store, self.conf = store, BitrixConf(store)
        self.links, self.queue, self.log = BitrixLinks(store), BitrixQueue(store), BitrixLog(store)
        self.opener = opener
        self.files = files or self._kp_files
        self._api: BitrixApi | BitrixDryApi | None = None
        self._rules: BitrixRules | None = None
        self.mirror = BitrixMirror(store)

    @property
    def rules(self) -> BitrixRules:
        """Правила обмена (bitrix_rules) — читаются один раз за обмен."""
        if self._rules is None:
            self._rules = self.conf.rules()
        return self._rules

    @property
    def api(self) -> 'BitrixApi | BitrixDryApi':
        if self._api is None:
            self._api = self.conf.api(self.opener)
        return self._api

    def check(self) -> dict:
        """Связь, воронки, стадии выбранной и загружаемых воронок, поля сделки, пользователи и подсказка «менеджер → пользователь»."""
        api = self.api
        prof = api.call('profile') or {}
        cats = self.categories()
        cat = str(self.conf.get().get('category') or '0')
        users = self.users()
        mgrs = self._managers()
        by_mail = {u['email'].lower(): u['id'] for u in users if u.get('email')}
        auto = {
            mgr['id']: by_mail[mgr['email'].lower()]
            for mgr in mgrs
            if mgr.get('email') and mgr['email'].lower() in by_mail
        }
        rules = self.conf.rules()
        stages_by = {
            category['id']: self.stage_list(category['id'])
            for category in cats
            if category['id'] in {*rules.pull_cats(), cat}
        }
        try:
            MyCompanies(self.store).load(api)
        except BitrixError as exc:
            self.log.add(f'Наши компании Битрикс24 не загружены: {exc}', 'warn')
        return {
            'ok': True,
            'user': ' '.join(x for x in (prof.get('NAME'), prof.get('LAST_NAME')) if x) or str(prof.get('ID') or ''),
            'admin': bool(prof.get('ADMIN')),
            'categories': cats,
            'stages': stages_by.get(cat) or self.stage_list(cat),
            'stagesBy': stages_by,
            'users': users,
            'managers': mgrs,
            'auto': auto,
            'portal': api.host,
            'fields': self.deal_fields(),
        }

    def deal_fields(self) -> list:
        """Поля сделки портала для карты полей: свои (UF_*) и текстовые стандартные — [{code, title, type}]."""
        try:
            raw = self.api.call('crm.deal.fields') or {}
        except BitrixError:
            return []
        out = []
        for code, field in raw.items() if isinstance(raw, dict) else []:
            if (
                not isinstance(field, dict)
                or field.get('isReadOnly')
                or not (code.startswith('UF_') or code in ('COMMENTS', 'SOURCE_DESCRIPTION', 'ADDITIONAL_INFO'))
            ):
                continue
            title = field.get('formLabel') or field.get('listLabel') or field.get('title') or code
            out.append({'code': code, 'title': str(title)[:120], 'type': str(field.get('type') or '')})
        return sorted(out, key=lambda x: x['title'].lower())

    def stages_all(self, cat) -> list:
        """Стадии воронки cat (для «Настроек», при выборе другой воронки)."""
        return self.stage_list(cat)

    def categories(self) -> list:
        try:
            rows = self.api.list('crm.category.list', {'entityTypeId': 2})
            out = [{'id': str(row.get('id')), 'name': row.get('name') or ''} for row in rows]
        except BitrixError as exc:
            if exc.code not in ('ERROR_METHOD_NOT_FOUND', 'NOT_FOUND'):
                raise
            out = [{'id': '0', 'name': 'Общая'}] + [
                {'id': str(row.get('ID')), 'name': row.get('NAME') or ''}
                for row in self.api.list('crm.dealcategory.list')
            ]
        if not any(cat['id'] == '0' for cat in out):
            out.insert(0, {'id': '0', 'name': 'Общая'})
        return out

    def stage_list(self, cat) -> list:
        ent = 'DEAL_STAGE' if str(cat or '0') == '0' else f'DEAL_STAGE_{cat}'
        rows = self.api.list('crm.status.list', {'filter': {'ENTITY_ID': ent}, 'order': {'SORT': 'ASC'}})
        out = []
        for row in (row for row in rows if row.get('STATUS_ID')):
            sem = (
                (row.get('EXTRA') or {}).get('SEMANTICS')
                if isinstance(row.get('EXTRA'), dict)
                else row.get('SEMANTICS')
            )
            out.append(
                {
                    'id': row.get('STATUS_ID'),
                    'name': row.get('NAME') or '',
                    'sem': {'success': 'S', 'failure': 'F'}.get(str(sem), sem if sem in ('S', 'F') else ''),
                }
            )
        marked = Funnels.closed_by_order([{'key': row['id'], 'sem': self.SEM_OURS.get(row['sem'], '')} for row in out])
        for row, stage in zip(out, marked, strict=True):
            row['sem'] = {Funnels.WON: 'S', Funnels.LOST: 'F'}.get(stage['sem'], '')
        return out

    def users(self) -> list:
        rows = self.api.list('user.get', {'FILTER': {'ACTIVE': True}}, limit=2000)
        return [
            {
                'id': str(u.get('ID')),
                'name': ' '.join(x for x in (u.get('LAST_NAME'), u.get('NAME')) if x)
                or u.get('EMAIL')
                or str(u.get('ID')),
                'email': u.get('EMAIL') or '',
            }
            for u in rows
        ]

    def _managers(self) -> list:
        out = []
        for mid, doc in self.store.all('SELECT id, doc FROM managers ORDER BY name COLLATE NOCASE'):
            try:
                card = json.loads(doc)
            except ValueError:
                continue
            if card.get('name'):
                out.append({'id': mid, 'name': card['name'], 'email': str(card.get('email') or '').strip()})
        return out

    def run(self, sides: Sides = Sides.BOTH) -> dict:
        """Плановый обмен — только в часы обмена из правил."""
        return self._exchange(sides, BitrixRules.in_hours)

    def run_now(self, sides: Sides = Sides.BOTH) -> dict:
        """Обмен по кнопке — в любое время."""
        return self._exchange(sides, lambda rules: True)

    def _exchange(self, sides: Sides, in_hours) -> dict:
        """Отправить очередь и забрать изменения (стороны — sides)."""
        if not self.conf.enabled():
            return {'off': True}
        self._rules = None
        if not in_hours(self.rules):
            return {'hours': True}
        push, pull = sides is not Sides.RECEIVE, sides is not Sides.SEND
        if not self.LOCK.acquire(blocking=False):
            return {'busy': True}
        try:
            res: dict[str, Any] = {'sent': 0, 'failed': 0, 'pulled': 0, 'created': 0, 'tasks': 0}
            try:
                self._prepare()
            except BitrixError as exc:
                self.log.add(f'Нет связи с Битрикс24: {exc}', 'error')
                res['error'] = str(exc)
                return res
            if push:
                self._company_check()
            sched = self.rules.sched()
            for kind, local, tries in self.queue.due(sched['batch'], sched['tries']) if push else []:
                try:
                    if kind == 'deal':
                        self.push_deal(local)
                    elif kind == 'task':
                        self.push_task(int(local))
                    self.queue.done(kind, local)
                    res['sent'] += 1
                except BitrixError as exc:
                    self.queue.fail(kind, local, tries, exc)
                    what = (
                        (f'Сделка № {(DealBook(self.store).get(local) or {}).get("number") or local}')
                        if kind == 'deal'
                        else f'Дело {local}'
                    )
                    self.log.add(
                        f'{what} не отправлена: {exc}' if kind == 'deal' else f'{what} не отправлено: {exc}',
                        'error',
                    )
                    res['failed'] += 1
                    if exc.code == 'NET':
                        res['error'] = str(exc)
                        return res
                except Exception as exc:  # ошибка не связи (этап убрали из списка и т. п.) — запись не держит очередь
                    self.queue.fail(kind, local, tries, exc)
                    self.log.add(
                        '{} {} не отправлено: {}'.format('Сделка' if kind == 'deal' else 'Дело', local, exc), 'error'
                    )
                    res['failed'] += 1
            if pull:
                try:
                    res.update(self.pull())
                except Exception as exc:
                    self.log.add(f'Изменения из Битрикс24 не получены: {exc}', 'error')
                    res['error'] = str(exc)
                else:
                    self._econ_list_in(res)
            return res
        finally:
            self.LOCK.release()

    def _company_check(self) -> None:
        """Раз в сутки — связанные компании не удалены в Битриксе (иначе сделки уходят к удалённой компании)."""
        check = BitrixCompanyCheck(self)
        if not check.due() or not self.rules.can('company', 'out'):
            return
        try:
            check.run()
        except BitrixError as exc:
            self.log.add(f'Проверка компаний в Битрикс24 не выполнена: {exc}', 'warn')

    def _prepare(self) -> None:
        """Свои поля сделки, включённые в карте полей, — создать в Битриксе один раз (новые — когда их включат)."""
        conf = self.conf.get()
        if not self.rules.can('deal', 'out'):
            return  # только из Битрикса — в Битриксе ничего не создаём
        want = self.rules.own_fields()
        codes = sorted(code for code, _title, _label in want)
        made: list = (
            listed
            if isinstance(listed := conf.get('fieldsMade'), list)
            else ([code for code, _title, _label in BitrixFields.LIST] if conf.get('fieldsOk') else [])
        )
        if set(codes) - set(made):
            count = BitrixFields.ensure(self.api, want)
            if count:
                self.log.add(f'В сделках Битрикс24 созданы поля программы: {count}')
            self.conf.mark(fieldsOk=True, fieldsMade=sorted(set(made) | set(codes)))

    def company(self, deal) -> str | None:
        """Компания сделки в Битриксе: по ИНН в реквизитах, по телефону и почте клиента (как контроль дублей портала),
        по названию без формы и кавычек; нет — создаётся (если правила разрешают)."""
        inn = re.sub(r'\D', '', str(deal.get('clientInn') or ''))
        name = str(deal.get('client') or '').strip()
        key = inn or name.lower()
        if not key:
            return None
        link = self.links.get('company', key)
        if link:
            return link['bx']
        comp_rules, find = self.rules.company(), BitrixCompanyFind(self.api)
        client = self._client_of(deal, inn)
        cid = find.by_inn(inn) if inn and comp_rules['find'] in ('inn', 'inn_name') else ''
        if not cid:
            cid, how = find.by_comm(client)
            if cid:
                self.log.add(
                    f'Компания «{name}» найдена в Битрикс24 по {how} — новая не создаётся', mid=deal.get('managerId')
                )
        if not cid and name and comp_rules['find'] in ('inn_name', 'name'):
            cid = find.by_name(client.get('name') or name) or find.by_name(name)
        if not cid:
            if not comp_rules['create'] or not self.rules.can(
                'company', 'out'
            ):  # создавать компании в Битриксе — нельзя
                return None
            cid = self._company_add(deal, client, inn, name)
            self.log.add(
                'В Битрикс24 создана компания «{}»{}'.format(name, f' (ИНН {inn})' if inn else ''),
                mid=deal.get('managerId'),
            )
        self.links.put('company', key, cid)
        return str(cid)

    def _client_of(self, deal: dict, inn: str) -> dict:
        """Клиент сделки из справочника: по карточке сделки, иначе по ИНН."""
        found = self.store.client_get(deal['clientId']) if deal.get('clientId') else None
        return found if isinstance(found, dict) else self._client(inn)

    def _client(self, inn) -> dict:
        doc = None
        if inn:
            doc = self.store.client_get('inn' + inn)
            if not doc:
                row = self.store.one('SELECT doc FROM clients WHERE inn=? LIMIT 1', (inn,))
                doc = json.loads(row[0]) if row and row[0] else None
        return doc if isinstance(doc, dict) else {}

    def _company_add(self, deal, client, inn, name) -> str:
        cons = [x for x in (client.get('contacts') or []) if isinstance(x, dict) and x.get('name')]
        phones = [x['phone'] for x in cons if x.get('phone')][:3]
        mails = [x['email'] for x in cons if x.get('email')][:3]
        fields = {
            'TITLE': client.get('name') or name,
            'OPENED': 'Y',
            'COMPANY_TYPE': 'CUSTOMER',
            'PHONE': [{'VALUE': phone, 'VALUE_TYPE': 'WORK'} for phone in [client.get('phone'), *phones] if phone][:3],
            'EMAIL': [{'VALUE': mail, 'VALUE_TYPE': 'WORK'} for mail in [client.get('email'), *mails] if mail][:3],
        }
        uid = self._user_of(deal.get('managerId'))
        if uid:
            fields['ASSIGNED_BY_ID'] = uid
        cid = self.api.call('crm.company.add', {'fields': fields})
        sent = {key: client[key] for key in ('phone', 'email') if client.get(key)}
        self.links.put('file', f'comm|{cid}', str(cid), sent)  # телефон и почта уже в новой компании
        comp_rules = self.rules.company()
        if inn and comp_rules['reqs']:
            preset = self._preset()
            req = {
                'ENTITY_TYPE_ID': 4,
                'ENTITY_ID': cid,
                'PRESET_ID': preset,
                'NAME': 'Реквизиты',
                'RQ_INN': inn,
                'RQ_KPP': client.get('kpp') or '',
                'RQ_OGRN': client.get('ogrn') or '',
                'RQ_COMPANY_NAME': client.get('name') or name,
                'RQ_COMPANY_FULL_NAME': client.get('full') or '',
                'RQ_DIRECTOR': client.get('director') or '',
            }
            rid = self.api.call('crm.requisite.add', {'fields': req})
            if client.get('address') and rid:
                try:
                    self.api.call(
                        'crm.address.add',
                        {
                            'fields': {
                                'TYPE_ID': 6,
                                'ENTITY_TYPE_ID': 8,
                                'ENTITY_ID': rid,
                                'ADDRESS_1': client['address'][:250],
                            }
                        },
                    )
                except BitrixError:
                    pass  # адрес — не главное: компания и реквизиты уже есть
        if self.rules.allow(
            comp_rules['contacts'], 'out'
        ):  # контакты — сначала поиск по телефону и почте, как у сделки
            BitrixClientOut(self).people(str(cid), client, deal.get('managerId'))
        return cid

    def _preset(self) -> Any:
        conf = self.conf.get()
        if conf.get('preset'):
            return conf['preset']
        rows = self.api.list('crm.requisite.preset.list', {'select': ['ID', 'NAME', 'ENTITY_TYPE_ID']}, limit=50)
        pid = next(
            (row['ID'] for row in rows if 'организац' in str(row.get('NAME') or '').lower()),
            rows[0]['ID'] if rows else 1,
        )
        self.conf.mark(preset=pid)
        return pid

    def bx_user(self, mid: str | None) -> Any:
        """Пользователь Битрикса менеджера программы (None — не сопоставлен)."""
        return self._user_of(mid)

    def bx_stage(self, deal: dict, cat) -> str:
        """Стадия Битрикса, в которой сделка должна стоять по программе."""
        return self._bx_stage(deal, cat)

    def _user_of(self, mid: str | None) -> Any:
        return (self.conf.get().get('users') or {}).get(str(mid or ''))

    def _mid_of(self, uid: str) -> str | None:
        return next((mid for mid, u in (self.conf.get().get('users') or {}).items() if str(u) == str(uid)), None)

    def _stage_of(self, key, cat=None) -> Any:
        return self.rules.stages(cat).get(key)

    def _bx_stage(self, deal, cat) -> str:
        """Стадия Битрикса сделки: в повторённой воронке — та же, иначе — по соответствию этапов."""
        if self.mirror.cat(deal):
            return str(deal.get('fstage') or deal.get('stage') or '')
        return self._stage_of(deal['stage'], cat) or ''

    def _shared(self) -> list:
        return [*self.SHARED, *self.mirror.shared()]

    def _field(self, key) -> dict:
        return self.mirror.field(key) or self.rules.field(key)

    def _pull_cats(self) -> list:
        cats = list(self.rules.pull_cats())
        return cats + [cat for cat in self.mirror.cats() if cat not in cats]

    def _key_of(self, stage_id, sem='', cat=None) -> str | None:
        if cat is None and ':' in str(stage_id or ''):
            cat = str(stage_id).split(':')[0][1:]  # «C3:NEW» — стадия воронки 3
        stages = self.rules.stages(cat if cat is not None else None)
        k = next((k for k, v in stages.items() if v == stage_id), None)
        if k:
            return k
        return {'S': 'won', 'F': 'lost'}.get(sem)

    @staticmethod
    def _econ(kps) -> dict:
        """Экономика последнего КП с расчётом сделки → поля UF (полностью, решение владельца 17.10)."""
        k = next((x for x in kps if isinstance(x.get('deal'), dict) and x['deal'].get('full')), None)
        if not k:
            return {}
        econ, full = k['deal'], k['deal']['full']

        def num(v) -> float | str:
            return round(float(v), 2) if isinstance(v, (int, float)) else ''

        lines = ['Экономика по КП № {}'.format(k['number'])]
        for name, sum_val in (full.get('parts') or [])[:30]:
            lines.append('{}: {} ₽'.format(name, f'{float(sum_val or 0):,.0f}'.replace(',', ' ')))
        if full.get('pays'):
            lines.append('')
            lines.append('График платежей:')
            for pay in full['pays'][:40]:
                lines.append(
                    '{} — {}: {} ₽'.format(
                        pay.get('d') or 'день {}'.format(pay.get('day')),
                        pay.get('t') or '',
                        '{:,.0f}'.format(float(pay.get('a') or 0)).replace(',', ' '),
                    )
                )
        if not econ.get('confirmed'):
            lines.append('')
            lines.append('Прибыль — диапазоном: не указан ввозной НДС к вычету')
        return {
            'KP_PRICE': num(full.get('price')),
            'KP_REVENUE': num(full.get('revenue')),
            'KP_COST': num(full.get('cost')),
            'KP_FINANCE': num(full.get('fin')),
            'KP_PROFIT': num(econ.get('profit') if econ.get('confirmed') else econ.get('lo')),
            'KP_NET': num(econ.get('net')),
            'KP_MARGIN': num(econ.get('margin') if econ.get('confirmed') else econ.get('marginLo')),
            'KP_MARKUP': num(econ.get('markup')),
            'KP_ECON': '\n'.join(lines)[:6000],
        }

    def _extra(self, deal, kps) -> dict:
        """Прочие поля программы для карты полей (по умолчанию не передаются): номер сделки, клиент, ИНН, оборудование…"""
        k = kps[0] if kps else {}
        meta = k.get('meta') or {}
        status = {'new': 'Новое', 'sent': 'Отправлено', 'talks': 'Переговоры', 'won': 'Выиграно', 'lost': 'Проиграно'}
        return {
            'dealNo': str(deal.get('number') or ''),
            'client': deal.get('client') or '',
            'inn': deal.get('clientInn') or '',
            'items': '; '.join(str(x) for x in (meta.get('items') or [])[:30])[:1000],
            'kpDate': str(meta.get('date') or '')[:10],
            'kpStatus': status.get(str(k.get('status')), k.get('status') or '') if k else '',
            'mgrName': deal.get('manager') or '',
        }

    def _kps(self, did) -> list:
        from admin import econ_rub

        out = []
        for kid, meta, track in self.store.all(
            'SELECT k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id '
            'WHERE l.deal_id=? AND k.meta IS NOT NULL',
            (did,),
        ):
            try:
                meta_obj = json.loads(meta)
            except ValueError:
                continue
            try:
                track_obj = json.loads(track) if track else {}
            except ValueError:
                track_obj = {}
            out.append(
                {
                    'id': kid,
                    'number': meta_obj.get('number') or kid,
                    'savedAt': meta_obj.get('savedAt') or meta_obj.get('date') or '',
                    'meta': meta_obj,
                    'status': (track_obj or {}).get('status') or 'new',
                    'deal': meta_obj.get('deal'),
                    'lines': meta_obj.get('lines'),
                    'sum': econ_rub(meta_obj)[0],
                }
            )
        out.sort(key=lambda x: (x['savedAt'], x['id']), reverse=True)
        return out

    @staticmethod
    def _rows(k) -> list | None:
        """Товары сделки: позиции последнего КП (цены — за единицу со скидкой, с НДС, в рублях по курсу КП)."""
        lines = picked if isinstance(picked := k.get('lines'), dict) else None
        if not lines or not isinstance(lines.get('rows'), list):
            return None
        rate = float(lines.get('rate') or 1) or 1
        vat = float(lines.get('vat') or 0)
        out = []
        for row in lines['rows'][:200]:
            if not isinstance(row, dict) or not row.get('n'):
                continue
            out.append(
                {
                    'PRODUCT_NAME': str(row['n'])[:250],
                    'PRICE': round(float(row.get('p') or 0) / 100 * rate, 2),
                    'QUANTITY': float(row.get('q') or 1),
                    'TAX_RATE': vat,
                    'TAX_INCLUDED': 'Y',
                    'MEASURE_NAME': str(row.get('u') or 'шт')[:20],
                }
            )
        return out

    def _ours(self, deal, kps) -> dict:
        mid = deal.get('managerId')
        return {
            'title': deal.get('title') or deal.get('client') or 'Сделка № {}'.format(deal.get('number')),
            'stage': deal.get('stage'),
            'expected': deal.get('expected') or '',
            'manager': self._user_of(mid) or '',
            'note': deal.get('note') or '',
            'lostReason': deal.get('lostReason') or '' if deal.get('stage') == 'lost' else '',
            **self.mirror.ours(deal),
        }

    def _bx_id(self, key) -> str:
        """Поле Битрикса для общего поля программы (по карте полей)."""
        return self.STD.get(key) or self._field(key)['bx']

    def _theirs(self, bx_deal) -> dict:
        return {
            'title': bx_deal.get('TITLE') or '',
            'stage': bx_deal.get('STAGE_ID') or '',
            'expected': BitrixTime.day(bx_deal.get('CLOSEDATE')),
            'manager': str(bx_deal.get('ASSIGNED_BY_ID') or ''),
            'note': str(bx_deal.get(self._bx_id('note')) or ''),
            'lostReason': str(bx_deal.get(self._bx_id('lostReason')) or ''),
            **self.mirror.theirs(bx_deal),
        }

    def push_deal(self, did) -> None:
        """Сделка программы → Битрикс: создать или обновить (общие поля — по последней правке), товары, экономика, файлы."""
        deal = DealBook(self.store).get(did)
        if not deal:
            return
        rules, mid = self.rules, deal.get('managerId')
        link = self.links.get('deal', did)
        if not rules.can('deal', 'out', mid):
            return  # обмен только из Битрикса (весь или у этого менеджера) — в Битрикс не пишем
        kps = self._kps(did)

        def out(k) -> bool:
            return rules.allow(self._field(k)['dir'], 'out')

        fields: dict = {}
        cid = None
        if out('sum'):
            fields.update(OPPORTUNITY=round((deal.get('sum') or 0) / 100, 2), CURRENCY_ID='RUB')
        if rules.flow('company') != 'off':
            cid = self.company(deal)
            if cid:
                fields['COMPANY_ID'] = cid
        econ_fields = self._econ(kps)
        if kps:
            econ_fields['KP_NUMBER'] = ', '.join(str(k['number']) for k in kps)[:250]
        econ_fields.update(self._extra(deal, kps))
        for k, v in econ_fields.items():
            x = rules.field(k)
            if x['dir'] == 'out' and x['bx']:
                fields[x['bx']] = v
        my_company = self._my_company(deal, link)
        if my_company:
            fields['MYCOMPANY_ID'] = int(my_company)
        cat = self.mirror.cat(deal) or str((link or {}).get('sent', {}).get('cat') or rules.cat_of(mid))
        ours = self._ours(deal, kps)
        ours['stage'] = self._bx_stage(deal, cat)
        if not link:
            fields.update(
                {
                    'CATEGORY_ID': int(cat),
                    'OPENED': 'Y',
                    'SOURCE_DESCRIPTION': 'Конструктор КП, сделка № {}'.format(deal.get('number')),
                }
            )
            sent = {'cat': cat, 'my': my_company}
            for k in self._shared():
                if out(k) and ours.get(k) and self._bx_id(k):
                    fields[self._bx_id(k)] = self.mirror.to_bx(k, ours[k])
                    sent[k] = ours[k]
            fields.setdefault('TITLE', ours['title'])  # без названия Битрикс сделку не создаст
            bid = str(self.api.call('crm.deal.add', {'fields': fields, 'params': {'REGISTER_SONET_EVENT': 'N'}}))
            self.links.put('deal', did, bid, sent)
            self.log.add(
                'Сделка № {} «{}» → Битрикс24 (сделка {})'.format(deal.get('number'), ours['title'], bid), mid=mid
            )
        else:
            bid = link['bx']
            bx_deal = self.api.call('crm.deal.get', {'id': bid}) or {}
            moved = self.mirror.cat(deal)
            if moved and moved != str(bx_deal.get('CATEGORY_ID') or '0'):
                bx_deal = self._move(deal, bid, bx_deal, moved)
            cat = str(bx_deal.get('CATEGORY_ID') or cat)
            ours['stage'] = self._bx_stage(deal, cat)
            sent, upd, back = self._merge(
                deal, ours, self._theirs(bx_deal), link['sent'], BitrixTime.local(bx_deal.get('DATE_MODIFY'))
            )
            sent.update(cat=cat, my=my_company or link['sent'].get('my') or '')
            for k, v in upd.items():
                fields[self._bx_id(k)] = self.mirror.to_bx(k, v)
            if upd:
                self.log.add(
                    'Сделка № {} → Битрикс24: {}'.format(deal.get('number'), self._said(upd, link['sent'], cat)),
                    mid=mid,
                )
            if fields:
                self._regs_people(
                    deal, cid, bid
                )  # контакт и его телефон — до смены стадии: её проверяют роботы Битрикса
                self.api.call('crm.deal.update', {'id': bid, 'fields': fields, 'params': {'REGISTER_SONET_EVENT': 'N'}})
            if back:
                self._apply(deal, back, bx_deal, link['sent'])
            self.links.put('deal', did, bid, sent)
        send_rules = rules.send()
        rows = (
            (self._rows(kps[0]) if send_rules['rowsHow'] == 'kp' else self._rows_sum(deal, kps[0]))
            if kps and send_rules['rows']
            else None
        )
        if rows is not None:
            digest = hashlib.sha1(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            rows_link = self.links.get('rows', did)
            if not rows_link or rows_link['sent'].get('h') != digest:
                self.api.call('crm.deal.productrows.set', {'id': bid, 'rows': rows})
                self.links.put('rows', did, bid, {'h': digest})
        for k in kps:
            self._files(bid, k)
        self._comments(bid, deal)
        BitrixDealDocs(self).push(deal, bid)
        self._econ_list_out(deal, bid)
        self._regs_out(deal, cid, bid, kps)
        for task in TaskBook(self.store).list(deal=did):
            if not self.links.get('task', task['id']):
                self.push_task(task['id'], bid)

    def _econ_list_out(self, deal: dict, bid: str) -> None:
        """Оплаты клиента — элементами списка «Оплаты» Битрикс24 (bitrix_econ_list): сбой не держит отправку сделки."""
        from bitrix_econ_list import EconList

        try:
            said = EconList(self.store).push(self.api, deal, bid)
        except BitrixError as exc:
            self.log.add(f'Сделка № {deal.get("number")}: оплаты в список Битрикс24 не записаны — {exc}', 'warn')
            return
        if said:
            self.log.add(f'Сделка № {deal.get("number")} → список оплат: {"; ".join(said)}')

    def _econ_list_in(self, res: dict) -> None:
        """Правки закупки, доставки и прочих в элементах списка «Оплаты» — поправками в экономику КП."""
        from bitrix_econ_list import EconList

        try:
            said = EconList(self.store).pull(self.api)
        except BitrixError as exc:
            self.log.add(f'Список оплат Битрикс24 не прочитан: {exc}', 'warn')
            return
        for line in said:
            self.log.add(line)
        res['econ'] = len(said)

    def _regs_out(self, deal: dict, cid: str | None, bid: str, kps: list) -> None:
        """Регламент оформления сделки: телефон и почта компании, контакты со связкой, файл КП в поле «ТКП / счёт»."""
        regs = DealRegs(self.store)
        if regs.conf().get('on', True) is False:
            return
        code = regs.codes().get('tkp')
        out = BitrixClientOut(self)
        try:
            out.push(deal, cid, bid)
            out.tkp(deal, bid, kps, DealFields(self.store).by_code().get(code) if code else None)
        except BitrixError as exc:
            self.log.add(f'Сделка № {deal.get("number")}: клиент и файл КП в Битрикс24 не отправлены — {exc}', 'warn')

    def _regs_people(self, deal: dict, cid: str | None, bid: str) -> None:
        """Телефон и почта компании, контакт сделки — в Битрикс (повтор после обновления сделки ничего не отправит)."""
        if DealRegs(self.store).conf().get('on', True) is False:
            return
        try:
            BitrixClientOut(self).push(deal, cid, bid)
        except BitrixError as exc:
            self.log.add(f'Сделка № {deal.get("number")}: контакт в Битрикс24 не отправлен — {exc}', 'warn')

    def _my_company(self, deal: dict, link: dict | None) -> str:
        """Наша компания сделки (MYCOMPANY_ID) — что отправить или пусто (не менять).

        Новая сделка — выбранная в карточке или по умолчанию; сделка программы, ушедшая раньше без неё, — один раз по
        умолчанию; сделку из Битрикса программа не трогает, пока менеджер не выберет компанию в карточке.
        """
        chosen = str(deal.get('myCompany') or '')
        sent = str(((link or {}).get('sent') or {}).get('my') or '')
        if chosen:
            return chosen if chosen != sent else ''
        if sent or (link and deal.get('createdBy') == self.WHO):
            return ''
        return self._my_default()

    def _my_default(self) -> str:
        companies = MyCompanies(self.store)
        if not companies.all():
            try:
                companies.load(self.api)
            except BitrixError as exc:
                self.log.add(f'Наши компании Битрикс24 не загружены: {exc}', 'warn')
        return companies.default(self.rules.company()['my'])

    def _move(self, deal, bid, bx_deal, cat) -> dict:
        """Сделку перенесли в другую воронку в программе — и в Битриксе (crm.item.update: смена воронки сделки)."""
        stage = self._bx_stage(deal, cat)
        try:
            self.api.call(
                'crm.item.update',
                {'entityTypeId': 2, 'id': int(bid), 'fields': {'categoryId': int(cat), 'stageId': stage}},
            )
        except BitrixError as exc:
            self.log.add(
                'Сделка № {}: воронка в Битрикс24 не изменена — {}'.format(deal.get('number'), exc),
                'error',
                deal.get('managerId'),
            )
            return bx_deal
        return dict(bx_deal, CATEGORY_ID=cat, STAGE_ID=stage)

    @staticmethod
    def _rows_sum(deal, k) -> list:
        """Товары сделки одной строкой: итог последнего КП (правило «товары — только итог»)."""
        lines = picked if isinstance(picked := k.get('lines'), dict) else {}
        return [
            {
                'PRODUCT_NAME': 'Оборудование по КП № {}'.format(k['number']),
                'PRICE': round((deal.get('sum') or 0) / 100, 2),
                'QUANTITY': 1,
                'TAX_RATE': float(lines.get('vat') or 0),
                'TAX_INCLUDED': 'Y',
                'MEASURE_NAME': 'компл',
            }
        ]

    def _said(self, vals, base, cat=None) -> str:
        """«этап: Переговоры → Договор, ожидаемая дата: — → 2026-11-01» — для журнала (значения Битрикса — понятными словами)."""
        names = {
            'title': 'название',
            'stage': 'этап',
            'expected': 'ожидаемая дата',
            'manager': 'ответственный',
            'note': 'заметка',
            'lostReason': 'причина',
        }
        stg = {v: k for k, v in self.rules.stages(cat).items()}
        labels = {stage['key']: stage['label'] for stage in Stages.all(self.store)}
        mgr_names = {mgr['id']: mgr['name'] for mgr in self._managers()}

        def show(k, v) -> str:
            if not v:
                return '—'
            if k == 'stage':
                return labels.get(stg.get(v, v)) or self.mirror.stage_label(str(v)) or str(v)
            if k == 'manager':
                return mgr_names.get(self._mid_of(v) or '', f'пользователь {v}')
            v = str(v)
            return v if len(v) <= self.TEXT_MAX else v[:38] + '…'

        return ', '.join(
            f'{names.get(k) or self._field(k)["label"]}: {show(k, (base or {}).get(k))} → {show(k, v)}'
            for k, v in vals.items()
        )

    def _merge(self, deal, ours, theirs, base, their_at) -> tuple:
        """Общие поля по карте полей: главная сторона — по направлению поля и правилу «кто главный»."""
        upd, back, agreed = {}, {}, dict(base)
        for k in self._shared():
            x = self._field(k)
            if x['dir'] == 'off' or not self._bx_id(k):
                continue
            if k.startswith(BitrixMirror.PREFIX) and k not in theirs:
                continue  # поля нет в ответе Битрикса — не сравнивать
            ours_val, theirs_val, base_val = ours.get(k) or '', theirs.get(k) or '', base.get(k) or ''
            if k == 'stage' and not ours_val:
                ours_val = theirs_val  # этап без соответствия стадии — стадию Битрикса не трогаем
            if k == 'manager' and not ours_val:
                ours_val = theirs_val  # менеджер без пользователя Битрикса — ответственного не трогаем
            if ours_val == theirs_val:
                agreed[k] = ours_val
                continue
            mine, their = ours_val != base_val, theirs_val != base_val
            if x['dir'] == 'out':
                upd[k], agreed[k] = ours_val, ours_val
            elif x['dir'] == 'in':
                if their:
                    back[k] = theirs_val
                agreed[k] = theirs_val
            elif mine and their:
                ours_win = x['win'] == 'ours' or (
                    x['win'] == 'last' and (deal.get('updated') or '') >= (their_at or '')
                )
                if ours_win:
                    upd[k], agreed[k] = ours_val, ours_val
                else:
                    back[k], agreed[k] = theirs_val, theirs_val
            elif mine:
                upd[k], agreed[k] = ours_val, ours_val
            else:
                back[k], agreed[k] = theirs_val, theirs_val
        return agreed, upd, back

    def _econ_back(self, deal, fields: dict) -> None:
        """Раздел «Экономика сделки», изменённый в Битриксе: статьи — поправкой в экономику КП (итоги уйдут обратно)."""
        from deal_econ import DealEcon
        from server_log import ServerLog

        try:
            said = DealEcon(self.store).from_bitrix(deal['id'], fields, self.WHO)
        except Exception as exc:  # сбой поправки не останавливает обмен
            ServerLog.failure(f'экономика сделки {deal.get("id")} из Битрикс24', exc)
            return
        if said:
            self.log.add('Сделка № {} ← Битрикс24, экономика: {}'.format(deal.get('number'), '; '.join(said)))
            BitrixQueue.touch(self.store, 'deal', deal['id'])  # пересчитанные итоги — в Битрикс

    def _apply(self, deal, back, bx_deal=None, base=None) -> None:
        """Значения из Битрикса — в сделку программы (без отправки обратно); в журнал — «поле: было → стало»."""
        if not self.rules.can('deal', 'in', deal.get('managerId')):
            return
        body = {}
        if back.get('title'):
            body['title'] = back['title']
        if 'note' in back:
            body['note'] = back['note']
        if 'expected' in back:
            body['expected'] = back['expected']
        if 'stage' in back and not self.mirror.stage_back(deal, back['stage'], bx_deal, body):
            key = self._key_of(
                back['stage'],
                (bx_deal or {}).get('STAGE_SEMANTIC_ID') or '',
                str((bx_deal or {}).get('CATEGORY_ID') or '') or None,
            )
            if key and key != deal.get('stage'):
                body['stage'] = key
                if key == 'lost':
                    body['lostReason'] = back.get('lostReason') or deal.get('lostReason') or 'Проиграно в Битрикс24'
        if back.get('lostReason') and (body.get('stage') or deal.get('stage')) == 'lost':
            body['lostReason'] = back['lostReason']
        fields = self.mirror.uf_back(back)
        mgr = None
        if 'manager' in back:
            mid = self._mid_of(back['manager'])
            if mid and mid != deal.get('managerId'):
                mgr_rec = next((x for x in self._managers() if x['id'] == mid), None)
                mgr = (mid, mgr_rec['name']) if mgr_rec else None
        if not body and not mgr and not fields:
            return
        BitrixQueue._quiet.on = True
        try:
            if body or mgr:
                DealBook(self.store).update(deal['id'], body, self.WHO, None, mgr)
            if mgr:
                TaskBook(self.store).move_deal(deal['id'], mgr[0])
            if fields:
                DealBook(self.store).put_uf(deal['id'], fields, self.WHO)
        finally:
            BitrixQueue._quiet.on = False
        if fields:
            self._econ_back(deal, fields)
        shown = {k: back[k] for k in back if k in body or (k == 'manager' and mgr) or k.startswith('uf:')}
        self.log.add(
            'Сделка № {} ← Битрикс24: {}'.format(
                deal.get('number'), self._said(shown, base, str((bx_deal or {}).get('CATEGORY_ID') or '') or None)
            ),
            mid=mgr[0] if mgr else deal.get('managerId'),
        )

    def _files(self, bid, k) -> None:
        """КП → одна запись в ленте сделки: что предложено, итог, экономика и файлы (Word, PDF, справочные, Excel).

        Новая запись — только когда КП изменилось; файлы прикладываются те, что новые или изменились.
        """
        attach, sent_files, names, names_by = [], {}, [], {}
        for name, data, what in self._kp_payload(k):
            names_by[name] = what
            digest = hashlib.sha1(data).hexdigest()
            key = '{}|{}'.format(k['id'], name)
            link = self.links.get('file', key)
            sent_files[key] = digest
            names.append(what)
            if not (link and link['sent'].get('h') == digest and link['bx'] == bid):
                attach.append((name, data, key, digest))
        note_text = KpNote.brief if self.rules.field('KP_PROFIT')['dir'] == 'off' else KpNote.full
        text = note_text(k, names)
        core = hashlib.sha1(note_text(k, []).encode()).hexdigest()  # КП без файлов: изменилось ли само предложение
        note_key = 'note|{}'.format(k['id'])
        note = self.links.get('file', note_key)
        digest = hashlib.sha1((text + json.dumps(sent_files, sort_keys=True)).encode()).hexdigest()
        same_place = note is not None and note['bx'] == bid
        was = note['sent'] if note is not None else {}
        if same_place and was.get('h') == digest:
            return
        if not note and not attach and sent_files:  # файлы КП уже в ленте прежними записями по файлу — не дублировать
            self.links.put('file', note_key, bid, {'h': digest, 'core': core})
            return
        if same_place and was.get('core') == core:
            if not attach:
                self.links.put('file', note_key, bid, dict(was, h=digest))
                return
            added = ', '.join(dict.fromkeys(names_by[row[0]] for row in attach))
            comment = f'{KpNote.head(k)} — добавлено: {added}'
        else:
            comment = text + ('\n(новая версия КП)' if note else '')
        fields: dict[str, Any] = {'ENTITY_ID': int(bid), 'ENTITY_TYPE': 'deal', 'COMMENT': comment}
        if attach:
            fields['FILES'] = [[name, base64.b64encode(data).decode('ascii')] for name, data, _key, _digest in attach]
        cid = self.api.call('crm.timeline.comment.add', {'fields': fields})
        for _name, _data, key, file_digest in attach:
            self.links.put('file', key, bid, {'h': file_digest, 'c': cid})
        self.links.put('file', note_key, bid, {'h': digest, 'core': core, 'c': cid})

    def _comments(self, bid, deal: dict) -> None:
        """Комментарии ленты сделки программы → лента сделки Битрикса (каждый — один раз)."""
        for row in deal.get('comments') or []:
            if not isinstance(row, dict):
                continue
            key = 'comment|{}|{}'.format(deal['id'], row.get('id'))
            if self.links.get('file', key):
                continue
            text = '{}: {}'.format(row.get('by') or 'Менеджер', row.get('text') or '')
            cid = self.api.call(
                'crm.timeline.comment.add', {'fields': {'ENTITY_ID': int(bid), 'ENTITY_TYPE': 'deal', 'COMMENT': text}}
            )
            self.links.put('file', key, bid, {'c': cid})

    def _kp_payload(self, k) -> list[tuple[str, bytes, str]]:
        """Файлы КП, включённые в «Что передаётся» и не больше предела, — (имя, данные, подпись)."""
        send_rules = self.rules.send()
        enabled = {v: send_rules['files'][key] for key, v in BitrixRules.FILES.items()}
        out = []
        for name, path_or_data, what in self.files(k['id']):
            if not enabled.get(what, True):
                continue
            try:
                data = path_or_data if isinstance(path_or_data, bytes) else Path(path_or_data).read_bytes()
            except OSError:
                continue
            if len(data) > send_rules['fileMB'] * 1024 * 1024:
                self.log.add(f'Файл «{name}» больше {send_rules["fileMB"]} МБ — в Битрикс24 не отправлен', 'warn')
                continue
            out.append((name, data, what))
        return out

    def _kp_files(self, kid: str) -> list:
        """[(имя, путь или байты, подпись)] — файлы КП для ленты сделки."""
        from config import docs_path
        from kp_files import KpFiles

        out = []
        rel = self.store.kp_get(kid, 'docx')
        if rel:
            try:
                path = docs_path(rel.strip())
            except ValueError:
                path = ''
            if path and os.path.isfile(path):
                out.append((os.path.basename(path), path, 'КП (Word)'))
                pdf = os.path.splitext(path)[0] + '.pdf'
                if os.path.isfile(pdf):
                    out.append((os.path.basename(pdf), pdf, 'КП (PDF)'))
        x = EconXlsx(self.store).path(kid)
        if x:
            out.append((f'Экономика_КП_{kid}.xlsx', x, 'Экономика сделки (Excel)'))
        files = KpFiles.of(self.store)
        for rec in files.list(kid):
            got = files.read(kid, rec['id'])
            if got:
                out.append((rec['name'], got[1], 'Справочный документ'))
        return out

    def push_task(self, tid: str | int, bid=None) -> None:
        task = TaskBook(self.store).get(tid)
        if not task or not task.get('deal'):
            return
        task_rules = self.rules.tasks()
        how = task_rules['kinds'].get(task['kind'], 'todo')
        if how == 'off' or not self.rules.can('task', 'out', task.get('managerId')):
            return  # этот вид дел (или дела этого менеджера) в Битрикс не передаются
        if task['state'] == 'cancel' and not task_rules['cancel'] and not self.links.get('task', tid):
            return
        if not bid:
            link = self.links.get('deal', task['deal'])
            if not link:
                self.push_deal(task['deal'])  # сделка ещё не в Битриксе — её дела уйдут вместе с ней
                return
            bid = link['bx']
        subj = '{}: {}'.format(self.KIND.get(task['kind'], 'Задача'), task['title'])
        if task['state'] == 'cancel':
            subj = 'Отменено — ' + subj
        when = '{}T{}:00'.format(task['due'], task.get('time') or '18:00')
        uid = self._user_of(task.get('managerId'))
        link = self.links.get('task', tid)
        done = 'Y' if task['state'] != 'open' else 'N'
        sent = {'subj': subj, 'when': when, 'done': done}
        if link:
            if link['sent'] == sent or (task['state'] == 'cancel' and not task_rules['cancel']):
                return
            if link['sent'].get('when') != when and link['sent'].get('done') != 'Y':
                self._move_todo(link['bx'], bid, when)
            self.api.call(
                'crm.activity.update',
                {
                    'id': link['bx'],
                    'fields': {
                        'SUBJECT': subj,
                        'DEADLINE': when,
                        'END_TIME': when,
                        'COMPLETED': done,
                        'DESCRIPTION': task.get('note') or '',
                    },
                },
            )
            self.links.put('task', tid, link['bx'], sent)
            return
        try:
            if how != 'todo':
                raise BitrixError('звонок или встреча', 'NOT_FOUND')  # по правилу — дело-звонок или дело-встреча
            aid = self.api.call(
                'crm.activity.todo.add',
                {
                    'ownerTypeId': 2,
                    'ownerId': int(bid),
                    'deadline': when,
                    'title': subj,
                    'description': task.get('note') or '',
                    **({'responsibleId': int(uid)} if uid else {}),
                },
            )
            aid = aid.get('id') if isinstance(aid, dict) else aid
        except BitrixError as exc:
            if exc.code not in ('ERROR_METHOD_NOT_FOUND', 'NOT_FOUND'):
                raise
            meet = how == 'meet' or (how == 'todo' and task['kind'] == 'meet')
            aid = self.api.call(
                'crm.activity.add',
                {
                    'fields': {  # старый Битрикс или правило: дело «встреча» / «звонок»
                        'OWNER_TYPE_ID': 2,
                        'OWNER_ID': int(bid),
                        'TYPE_ID': 1 if meet else 2,
                        'SUBJECT': subj,
                        'START_TIME': when,
                        'END_TIME': when,
                        'DEADLINE': when,
                        'COMPLETED': 'N',
                        'DESCRIPTION': task.get('note') or '',
                        'COMMUNICATIONS': [{'VALUE': '', 'ENTITY_TYPE_ID': 2, 'ENTITY_ID': int(bid)}],
                        **({'RESPONSIBLE_ID': int(uid)} if uid else {}),
                    }
                },
            )
        if done == 'Y':
            self.api.call('crm.activity.update', {'id': aid, 'fields': {'COMPLETED': 'Y'}})
        self.links.put('task', tid, aid, sent)

    def _move_todo(self, aid: str | int, bid: str | int, when: str) -> None:
        """Срок универсального дела Битрикс меняет только своим методом: crm.activity.update его не трогает, и следующий
        опрос вернул бы в программу прежнюю дату. Звонок или встреча старого вида — ошибка метода, срок меняет update."""
        try:
            self.api.call(
                'crm.activity.todo.updateDeadline',
                {'id': int(aid), 'ownerTypeId': 2, 'ownerId': int(bid), 'value': when},
            )
        except BitrixError:
            return

    def pull(self) -> dict:
        conf = self.conf.get()
        since = conf.get('lastPull') or conf.get('since') or BitrixTime.now()
        try:
            since_dt = datetime.fromisoformat(since) - timedelta(
                minutes=3
            )  # запас на разницу часов и запись в ту же секунду
        except ValueError:
            since_dt = datetime.now(UTC).astimezone() - timedelta(hours=1)
        rules = self.rules
        res = {'pulled': 0, 'created': 0, 'tasks': 0, 'skipped': 0}
        last = since
        if not rules.can('deal', 'in') and not rules.can('deal', 'out'):
            self.conf.mark(lastPull=last, lastRun=Val.now())
            return res
        deals = []
        for cat in self._pull_cats():  # воронки обмена: основная, отмеченные, менеджеров и повторённые в программе
            flt = {'CATEGORY_ID': int(cat), '>DATE_MODIFY': since_dt.isoformat(timespec='seconds')}
            deals += self.api.list(
                'crm.deal.list',
                {'filter': flt, 'select': self.mirror.select(), 'order': {'DATE_MODIFY': 'ASC'}},
                limit=2000,
            )
        for bx_deal in sorted(deals, key=lambda x: str(x.get('DATE_MODIFY') or '')):
            last = max(last, str(bx_deal.get('DATE_MODIFY') or ''))
            did = self.links.local('deal', bx_deal.get('ID'))
            if did:
                deal = DealBook(self.store).get(did)
                link = self.links.get('deal', did)
                if deal and link:
                    cat = str(bx_deal.get('CATEGORY_ID') or link['sent'].get('cat') or rules.category())
                    ours = self._ours(deal, [])
                    ours['stage'] = self._bx_stage(deal, cat)
                    agreed, upd, back = self._merge(
                        deal, ours, self._theirs(bx_deal), link['sent'], BitrixTime.local(bx_deal.get('DATE_MODIFY'))
                    )
                    agreed['cat'] = cat
                    if back and rules.can('deal', 'in', deal.get('managerId')):
                        self._apply(deal, back, bx_deal, link['sent'])
                        res['pulled'] += 1
                    self._pull_sum(deal, bx_deal)
                    self.links.put('deal', did, bx_deal['ID'], agreed)
                    if upd and rules.can('deal', 'out', deal.get('managerId')):
                        BitrixQueue.touch(self.store, 'deal', did)
            elif str(bx_deal.get('DATE_CREATE') or '') >= str(conf.get('since') or ''):
                mid = self._who(bx_deal)
                if mid is None:
                    res['skipped'] += 1
                    continue
                self._new_deal(bx_deal, mid)
                res['created'] += 1
        res['tasks'] = self._pull_tasks(since_dt)
        self.conf.mark(lastPull=last, lastRun=Val.now())
        return res

    def _who(self, bx_deal) -> str | None:
        """Менеджер новой сделки Битрикса: сопоставленный или по правилу; None — не загружать."""
        rules = self.rules
        if not rules.can('deal', 'in'):
            return None
        mid = self._mid_of(bx_deal.get('ASSIGNED_BY_ID'))
        if mid:
            return mid if rules.can('deal', 'in', mid) else None
        fallback = rules.fallback()
        if fallback == 'skip':
            return None
        return fallback if fallback and rules.can('deal', 'in', fallback) else ''

    def _pull_sum(self, deal, bx_deal) -> None:
        """Сумма из Битрикса: по умолчанию — только у сделки без КП; по правилу поля — всегда или никогда."""
        x = self.rules.field('sum')['dir']
        if x == 'off' or not self.rules.can('deal', 'in', deal.get('managerId')):
            return
        if x != 'in' and self.store.one('SELECT 1 FROM deal_kp WHERE deal_id=? LIMIT 1', (deal['id'],)):
            return
        try:
            rub = float(bx_deal.get('OPPORTUNITY') or 0)
        except (TypeError, ValueError):
            return
        if round(rub * 100) == int(deal.get('sum') or 0):
            return
        BitrixQueue._quiet.on = True
        try:
            DealBook(self.store).update(deal['id'], {'sum': rub}, self.WHO)
        finally:
            BitrixQueue._quiet.on = False

    def _new_deal(self, bx_deal, mid: str | None = None) -> dict:
        """Новая сделка воронки обмена; в кабинете — «Новые сделки из Битрикс24», пока ответственный не откроет."""
        deal = self._import_deal(bx_deal, mid)
        DealBook(self.store).flag(deal['id'], bxNew=True)
        return deal

    def _import_deal(self, bx_deal, mid: str | None = None, company: dict | None = None) -> dict:
        """Сделка Битрикса → сделка программы у ответственного (mid — по правилам, _who); company — уже известная компания."""
        company = BitrixClients(self).of_deal(bx_deal) if company is None else company
        mid = (self._mid_of(bx_deal.get('ASSIGNED_BY_ID')) or '') if mid is None else mid
        mgr: dict = next((x for x in self._managers() if x['id'] == mid), {})
        key = (
            self._key_of(
                bx_deal.get('STAGE_ID'),
                bx_deal.get('STAGE_SEMANTIC_ID') or '',
                str(bx_deal.get('CATEGORY_ID') or '') or None,
            )
            or Stages.keys(self.store)[0]
        )
        body = {
            'title': bx_deal.get('TITLE') or company.get('name') or 'Сделка из Битрикс24',
            'client': company.get('name') or '',
            'clientInn': company.get('inn') or '',
            'clientId': company.get('clientId') or '',
            'expected': BitrixTime.day(bx_deal.get('CLOSEDATE')),
            'note': bx_deal.get('COMMENTS') or '',
            'stage': key,
        }
        if key == 'lost':
            body['lostReason'] = 'Проиграно в Битрикс24'
        if company.get('pick'):
            body['clientPick'] = company['pick']
        body.update(self.mirror.place(bx_deal))
        if bx_deal.get('OPPORTUNITY'):
            body['sum'] = bx_deal['OPPORTUNITY']
        BitrixQueue._quiet.on = True
        try:
            deal = DealBook(self.store).create(body, mid, mgr.get('name') or '', self.WHO)
            values = self.mirror.uf_of(bx_deal)
            if values:
                DealBook(self.store).put_uf(deal['id'], values, self.WHO)
        finally:
            BitrixQueue._quiet.on = False
        self.links.put(
            'deal', deal['id'], bx_deal['ID'], dict(self._theirs(bx_deal), cat=str(bx_deal.get('CATEGORY_ID') or '0'))
        )
        if company.get('company') and company.get('inn'):
            self.links.put('company', company['inn'], company['company'])
        self.log.add(
            'Новая сделка из Битрикс24 «{}» → кабинет{}'.format(
                body['title'], ' ({})'.format(mgr['name']) if mgr else ' (ответственный не сопоставлен)'
            ),
            mid=mid,
        )
        return deal

    def _pull_tasks(self, since_dt) -> int:
        if not self.rules.can('task', 'in'):
            return 0
        task_rules = self.rules.tasks()
        rows = self.api.list(
            'crm.activity.list',
            {
                'filter': {'OWNER_TYPE_ID': 2, '>LAST_UPDATED': since_dt.isoformat(timespec='seconds')},
                'select': BitrixComms.fields(),
            },
            limit=2000,
        )
        BitrixComms(self).take(rows)
        tasks, count = TaskBook(self.store), 0
        for activity in rows:
            count += self._task_in(activity, tasks, task_rules)
        return count

    def _task_in(self, activity, tasks, task_rules) -> int:
        """Дело Битрикса по связанной сделке → дело программы (новое или изменённое). → 1, если записано."""
        did = self.links.local('deal', activity.get('OWNER_ID'))
        if not did:
            return 0
        deal_mgr = (DealBook(self.store).get(did) or {}).get('managerId')
        if not self.rules.can('task', 'in', self._mid_of(activity.get('RESPONSIBLE_ID')) or deal_mgr):
            return 0
        subj = str(activity.get('SUBJECT') or '').strip()
        cancel = subj.startswith('Отменено — ')
        subj = subj[len('Отменено — ') :] if cancel else subj
        kind = next((k for k, label in self.KIND.items() if subj.startswith(label + ': ')), None)
        title = subj[len(self.KIND[kind]) + 2 :] if kind else subj
        if not kind and not task_rules['other'] and not self.links.local('task', activity.get('ID')):
            return 0  # дела Битрикса, заведённые не программой, — по правилу не загружать
        kind = kind or {'1': 'meet', '2': 'call', '4': 'mail'}.get(str(activity.get('TYPE_ID')), 'task')
        if task_rules['kinds'].get(kind) == 'off':
            return 0
        due = BitrixTime.local(activity.get('DEADLINE')) or Val.now()
        time_text = due[11:16] if due[11:16] not in ('', '00:00', '18:00') else ''
        state = 'cancel' if cancel else ('done' if activity.get('COMPLETED') == 'Y' else 'open')
        body = {
            'kind': kind,
            'title': title[:200],
            'due': due[:10],
            'time': time_text,
            'note': str(activity.get('DESCRIPTION') or '')[:1000],
            'state': state,
        }
        when = '{}T{}:00'.format(body['due'], time_text or '18:00')
        sent = {
            'subj': str(activity.get('SUBJECT') or '').strip(),
            'when': when,
            'done': 'Y' if state != 'open' else 'N',
        }
        tid = self.links.local('task', activity.get('ID'))
        if tid:
            link = self.links.get('task', tid)
            if (
                link
                and link['sent'].get('subj') == sent['subj']
                and link['sent'].get('done') == sent['done']
                and link['sent'].get('when', '')[:16] == when[:16]
            ):
                return 0  # своё же дело вернулось без изменений
            cur = tasks.get(int(tid))
            if cur:
                tasks.update(int(tid), {k: v for k, v in body.items() if k != 'kind' or kind})
                self.links.put('task', tid, activity['ID'], sent)
                return 1
            return 0
        deal = DealBook(self.store).get(did) or {}
        mid = self._mid_of(activity.get('RESPONSIBLE_ID')) or deal.get('managerId') or ''
        task = tasks.add(dict(body), mid, self.WHO, did)
        if state != 'open':
            tasks.update(task['id'], {'state': state})
        self.links.put('task', task['id'], activity['ID'], sent)
        return 1

    def people(self, did) -> int:
        """Контакты сделки и её компании из Битрикса — в карточку клиента (сделка загружена раньше, контактов нет).
        → сколько контактов у клиента стало. Не чаще раза в сутки на сделку."""
        link = self.links.get('deal', did)
        if not link or not self.rules.can('company', 'in'):
            return 0
        tried = self.store.kv_get('bxPeopleAt') or {}
        today = datetime.now(UTC).date().isoformat()
        if tried.get(did) == today:
            return 0
        tried[did] = today
        self.store.kv_set('bxPeopleAt', dict(list(tried.items())[-self.PEOPLE_KEEP :]))
        bx_deal = self.api.call('crm.deal.get', {'id': link['bx']}) or {}
        company = BitrixClients(self).of_deal(bx_deal) if bx_deal else {}
        cid = company.get('clientId') or ''
        deal = DealBook(self.store).get(did) or {}
        if cid and not deal.get('clientId'):  # клиент сделки найден только сейчас — связать
            BitrixQueue._quiet.on = True
            try:
                DealBook(self.store).update(did, {'clientId': cid}, self.WHO)
            finally:
                BitrixQueue._quiet.on = False
        client = self.store.client_get(cid) if cid else None
        return len((client or {}).get('contacts') or [])

    def people_sweep(self) -> int:
        """Фоном: сделки из Битрикса, у клиентов которых нет контактов, — подтянуть контакты (не больше PEOPLE_BATCH за проход).
        → сколько сделок проверено."""
        if not self.conf.enabled() or not self.rules.can('company', 'in'):
            return 0
        rows = self.store.all(
            "SELECT d.id, json_extract(d.doc, '$.clientId') FROM bx_link l JOIN deals d ON d.id = l.local_id "
            "WHERE l.kind='deal' ORDER BY d.updated DESC"
        )
        tried = self.store.kv_get('bxPeopleAt') or {}
        today = datetime.now(UTC).date().isoformat()
        asked = 0
        for did, cid in rows:
            if asked >= self.PEOPLE_BATCH:
                break
            if tried.get(did) == today or self._has_people(cid):
                continue
            asked += 1
            self.people(did)
        return asked

    def _has_people(self, cid) -> bool:
        client = self.store.client_get(cid) if cid else None
        return bool((client or {}).get('contacts'))

    def card(self, did) -> dict | None:
        link = self.links.get('deal', did)
        if not link:
            queue_row = self.store.one("SELECT error FROM bx_queue WHERE kind='deal' AND local_id=?", (did,))
            return {'queued': True, 'error': queue_row[0] or ''} if queue_row else None
        portal = self.conf.get().get('portal') or ''
        return {
            'id': link['bx'],
            'at': link['at'],
            'url': '{}/crm/deal/details/{}/'.format(portal, link['bx']) if portal else '',
        }


class BitrixDryApi:
    """Пробный прогон: чтение — из настоящего Битрикса, запись — только описанием «что было бы сделано»."""

    WRITE = re.compile(r'\.(add|update|set|delete)$')
    FAKE = 900000000
    NAMES = {
        'TITLE': 'название',
        'STAGE_ID': 'стадия',
        'CLOSEDATE': 'ожидаемая дата',
        'ASSIGNED_BY_ID': 'ответственный',
        'COMMENTS': 'комментарий',
        'OPPORTUNITY': 'сумма',
        'COMPANY_ID': 'компания',
        'CATEGORY_ID': 'воронка',
    }

    def __init__(self, api, labels=None) -> None:
        self.api = api
        self.rec: list = []
        self.count = 0
        self.host = api.host
        self.labels = labels or {}

    def list(self, method, params=None, limit: int = 5000) -> list:
        return self.api.list(method, params, limit)

    def call(self, method, params=None) -> Any:
        if not self.WRITE.search(method):
            return self.api.call(method, params)
        self.count += 1
        self.rec.append(self.say(method, params or {}))
        i = self.FAKE + self.count
        return (
            {'id': i} if method.endswith('todo.add') else True if method.endswith(('.update', '.set', '.delete')) else i
        )

    def say(self, method, params) -> str:
        fields = params.get('fields') or {}

        def name(k) -> str:
            return self.NAMES.get(k) or self.labels.get(k) or k

        if method == 'crm.deal.add':
            return f'Создать сделку «{fields.get("TITLE") or ""}»' + (
                ': ' + ', '.join(name(k) for k in fields if k in self.NAMES or k in self.labels) if fields else ''
            )
        if method == 'crm.deal.update':
            return 'Сделка {}: изменить — {}'.format(params.get('id'), ', '.join(name(k) for k in fields) or 'ничего')
        if method == 'crm.deal.productrows.set':
            return f'Сделка {params.get("id")}: товары — {len(params.get("rows") or [])} стр.'
        if method == 'crm.timeline.comment.add':
            head = str(fields.get('COMMENT') or '').split('\n')[0]
            names = ', '.join(f'«{row[0]}»' for row in fields.get('FILES') or [])
            return 'Сделка {}: в ленту — {}{}'.format(
                fields.get('ENTITY_ID'), head, f', файлы {names}' if names else ''
            )
        if method == 'crm.company.add':
            return f'Создать компанию «{fields.get("TITLE") or ""}»'
        if method == 'crm.requisite.add':
            return f'Реквизиты компании (ИНН {fields.get("RQ_INN") or "—"})'
        if method == 'crm.contact.add':
            return 'Создать контакт «{}»'.format(
                ' '.join(x for x in (fields.get('LAST_NAME'), fields.get('NAME')) if x)
            )
        if method in ('crm.activity.todo.add', 'crm.activity.add'):
            return f'Дело «{params.get("title") or fields.get("SUBJECT") or ""}»'
        if method == 'crm.activity.update':
            return 'Дело {}: изменить — {}'.format(
                params.get('id'),
                ', '.join(
                    {'SUBJECT': 'тема', 'DEADLINE': 'срок', 'COMPLETED': 'выполнено'}.get(k, k.lower())
                    for k in fields
                    if k != 'END_TIME'
                ),
            )
        if method == 'crm.address.add':
            return 'Адрес компании'
        if method == 'crm.deal.userfield.add':
            return f'Создать поле сделки «{fields.get("EDIT_FORM_LABEL") or fields.get("FIELD_NAME")}»'
        return method


class BitrixDry:
    """«Пробный прогон»: обмен по текущим правилам на копии базы — что изменилось бы; ничего не пишется."""

    def __init__(self, store, opener=None) -> None:
        self.store, self.opener = store, opener

    def run(self) -> dict:
        import shutil
        import tempfile

        from storage import Store

        tmp = tempfile.mkdtemp(prefix='kp-bxdry-')
        st2 = None
        try:
            dst = os.path.join(tmp, 'dry.sqlite3')
            self.store.backup(dst)
            st2 = Store(dst)
            real = BitrixSync(self.store, self.opener)
            labels = {x['bx']: x['label'] for x in real.rules.view()['fields'].values()}
            sync = BitrixSync(st2, self.opener, files=real._kp_files)
            dry = BitrixDryApi(real.api, labels)
            sync._api = dry
            first_log = BitrixLog(st2).last_id()
            res = sync.run_now()
            log = BitrixLog(st2).since(first_log)
            prog = [x['text'] for x in log if '←' in x['text'] or x['text'].startswith('Новая сделка')]
            return {
                'result': res,
                'bitrix': dry.rec[:500],
                'program': prog[:500],
                'errors': [x['text'] for x in log if x['level'] == 'error'][:50],
                'more': max(0, len(dry.rec) - 500),
            }
        finally:
            if st2 is not None:
                try:
                    st2.conn().close()
                except Exception:
                    pass
            shutil.rmtree(tmp, ignore_errors=True)


class BitrixImport:
    """Старые сделки Битрикса с даты: предпросмотр (новая / связать по ИНН / пропустить) и загрузка."""

    MAX = 500

    def __init__(self, store, opener=None) -> None:
        self.store, self.sync = store, BitrixSync(store, opener)

    def preview(self, since, cats=None) -> dict:
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(since or '')):
            raise ValueError('Дата — ГГГГ-ММ-ДД')
        sync, rules = self.sync, self.sync.rules
        allowed = rules.pull_cats()
        cats = [str(code) for code in (cats or allowed) if str(code) in allowed] or allowed
        until = str(sync.conf.get().get('since') or BitrixTime.now())
        rows = []
        for cat in cats:
            rows += sync.api.list(
                'crm.deal.list',
                {
                    'filter': {'CATEGORY_ID': int(cat), '>DATE_CREATE': since + 'T00:00:00'},
                    'select': [
                        'ID',
                        'TITLE',
                        'STAGE_ID',
                        'STAGE_SEMANTIC_ID',
                        'CATEGORY_ID',
                        'OPPORTUNITY',
                        'ASSIGNED_BY_ID',
                        'COMPANY_ID',
                        'DATE_CREATE',
                        'CLOSEDATE',
                        'COMMENTS',
                    ],
                    'order': {'DATE_CREATE': 'ASC'},
                },
                limit=self.MAX * 2,
            )
        rows = [
            bx_deal
            for bx_deal in rows
            if str(bx_deal.get('DATE_CREATE') or '') < until and not sync.links.local('deal', bx_deal.get('ID'))
        ][: self.MAX]
        inns = self._inns([bx_deal.get('COMPANY_ID') for bx_deal in rows])
        mgr_names = {mgr['id']: mgr['name'] for mgr in sync._managers()}
        labels = {x['key']: x['label'] for x in Stages.all(self.store)}
        out = []
        for bx_deal in rows:
            mid = sync._who(bx_deal)
            inn = inns.get(str(bx_deal.get('COMPANY_ID') or ''), '')
            key = sync._key_of(
                bx_deal.get('STAGE_ID'),
                bx_deal.get('STAGE_SEMANTIC_ID') or '',
                str(bx_deal.get('CATEGORY_ID') or '') or None,
            )
            item = {
                'id': str(bx_deal['ID']),
                'title': bx_deal.get('TITLE') or '',
                'created': BitrixTime.day(bx_deal.get('DATE_CREATE')),
                'sum': bx_deal.get('OPPORTUNITY') or '',
                'stage': labels.get(key, '—'),
                'manager': mgr_names.get(mid or '', '—'),
                'inn': inn,
            }
            if mid is None:
                item.update(act='skip', why='ответственный не участвует в загрузке из Битрикса')
            else:
                same = self._open_unlinked(inn) if inn else []
                if len(same) == 1:
                    item.update(
                        act='link',
                        deal=same[0]['id'],
                        why='сделка № {} того же клиента (ИНН {})'.format(same[0].get('number'), inn),
                    )
                else:
                    item.update(
                        act='new',
                        why='новая сделка в программе'
                        + (' (у клиента несколько открытых сделок — не связываю)' if len(same) > 1 else ''),
                    )
            out.append(item)
        return {'items': out, 'cats': cats, 'until': until[:10], 'max': self.MAX}

    def _inns(self, cids) -> dict:
        ids = sorted({str(cid) for cid in cids if cid and str(cid) != '0'})
        out: dict = {}
        for i in range(0, len(ids), 50):
            for row in self.sync.api.list(
                'crm.requisite.list',
                {'filter': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': ids[i : i + 50]}, 'select': ['ENTITY_ID', 'RQ_INN']},
                limit=200,
            ):
                inn = re.sub(r'\D', '', str(row.get('RQ_INN') or ''))
                if inn:
                    out.setdefault(str(row.get('ENTITY_ID')), inn)
        return out

    def _open_unlinked(self, inn) -> list:
        out = []
        for (did,) in self.store.all("SELECT id FROM deals WHERE stage NOT IN ('won', 'lost')"):
            deal = DealBook(self.store).get(did) or {}
            if re.sub(r'\D', '', str(deal.get('clientInn') or '')) == inn and not self.sync.links.get('deal', did):
                out.append(deal)
        return out

    def run(self, since, cats, ids) -> dict:
        """Загрузить отмеченные (ids) из предпросмотра. → {created, linked, skipped}."""
        want = {str(i) for i in (ids or [])}
        preview = self.preview(since, cats)
        res = {'created': 0, 'linked': 0, 'skipped': 0}
        sync = self.sync
        for item in preview['items']:
            if item['id'] not in want:
                continue
            if item['act'] == 'skip':
                res['skipped'] += 1
                continue
            bx_deal = sync.api.call('crm.deal.get', {'id': item['id']}) or {}
            if not bx_deal or sync.links.local('deal', item['id']):
                res['skipped'] += 1
                continue
            if item['act'] == 'link':
                sync.links.put(
                    'deal',
                    item['deal'],
                    item['id'],
                    dict(sync._theirs(bx_deal), cat=str(bx_deal.get('CATEGORY_ID') or '0')),
                )
                BitrixQueue.touch(self.store, 'deal', item['deal'])
                sync.log.add(
                    'Сделка Битрикса {} «{}» связана со сделкой программы ({})'.format(
                        item['id'], item['title'], item['why']
                    )
                )
                res['linked'] += 1
            else:
                sync._import_deal(bx_deal, sync._who(bx_deal) or '')
                res['created'] += 1
        sync.log.add(
            f'Загрузка сделок Битрикс24 с {since}: новых {res["created"]}, связано {res["linked"]}, пропущено {res["skipped"]}'
        )
        return res


class EconXlsx:
    """Excel экономики сделки последнего сохранения КП (собирается в браузере автора) — для ленты сделки в Битриксе."""

    FOLDER = 'kp_econ'
    MAX = 15 * 1024 * 1024

    def __init__(self, store) -> None:
        self.dir = os.path.join(os.path.dirname(os.path.abspath(store.path)), self.FOLDER)

    def _file(self, kid: str) -> str:
        if not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(kid)):
            raise ValueError('Неверный номер КП')
        return os.path.join(self.dir, f'{kid}.xlsx')

    def save(self, kid: str, data) -> None:
        if not data or len(data) > self.MAX:
            raise ValueError('Файл экономики пустой или больше 15 МБ')
        if not data.startswith(b'PK'):
            raise ValueError('Нужен файл Excel (.xlsx)')
        os.makedirs(self.dir, exist_ok=True)
        path = self._file(kid)
        with open(path + '.tmp', 'wb') as handle:
            handle.write(data)
        os.replace(path + '.tmp', path)

    def path(self, kid: str) -> str | None:
        try:
            path = self._file(kid)
        except ValueError:
            return None
        return path if os.path.isfile(path) else None


class BitrixDesk:
    """«Настройки → Битрикс24» (/api/admin/bitrix…): только администратор, изменения — с CSRF."""

    def __init__(self, handler, store, log_fn, opener=None) -> None:
        self.handler, self.store, self.log_fn, self.opener = handler, store, log_fn, opener

    def send(self, obj, code=200) -> None:
        return self.handler.send(code, 'application/json; charset=utf-8', json.dumps(obj, ensure_ascii=False))

    def text(self, code, text) -> None:
        return self.handler.send(code, 'text/plain; charset=utf-8', text)

    def body(self) -> dict:
        try:
            data = json.loads(self.handler.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            data = None
        return data if isinstance(data, dict) else {}

    def view(self) -> dict:
        store = self.store
        return dict(
            BitrixConf(store).view(),
            queue=BitrixQueue(store).stats(),
            log=BitrixLog(store).tail(100),
            failed=BitrixQueue(store).failed(),
            linked={
                'deals': BitrixLinks(store).count('deal'),
                'companies': BitrixLinks(store).count('company'),
                'tasks': BitrixLinks(store).count('task'),
            },
            stagesOur=Stages.all(store),
            managers=BitrixSync(store, self.opener)._managers(),
            myCompanies=MyCompanies(store).all(),
        )

    def _diff(self, method, sub) -> None:
        from bitrix_diff import BitrixDiff
        from features import FeatureAccess

        if not FeatureAccess(self.store).is_on('bxDiff'):
            return self.text(403, 'Функция «Расхождения с Битрикс24» выключена')
        diff = BitrixDiff(self.store, BitrixSync(self.store, self.opener))
        try:
            if sub == 'bitrix/diff' and method == 'POST':
                return self.send(diff.report())
            if sub == 'bitrix/diff/align' and method == 'POST':
                did = str(self.body().get('deal') or '')[:40]
                diff.align(did)
                self.log_fn('edit_settings', 'deal', did, None, {'Битрикс24': 'выровнять по программе'})
                return self.send({'ok': True})
        except (BitrixError, LookupError) as exc:
            return self.text(422, str(exc))
        return self.text(404, 'Нет такого действия')

    def _econ_admin(self, method, sub) -> None:
        from bitrix_econ_list import EconList
        from deal_econ import DealEcon
        from features import FeatureAccess

        if not FeatureAccess(self.store).is_on('bxEcon'):
            return self.text(403, 'Функция «Экономика сделки в Битрикс24» выключена')

        econ, pays = DealEcon(self.store), EconList(self.store)
        try:
            if sub == 'bitrix/econ' and method == 'GET':
                return self.send(dict(econ.view(), list=pays.view()))
            if sub == 'bitrix/econ' and method == 'POST':
                body = self.body()
                view = econ.save(body)
                if 'listOn' in body:
                    pays.save_on(body['listOn'])
                self.log_fn('edit_settings', 'settings', 'bitrix-econ', None, {'экономика сделки': 'изменено'})
                return self.send(dict(view, list=pays.view()))
            if sub == 'bitrix/econ/find' and method == 'POST':
                sync = BitrixSync(self.store, self.opener)
                cats = list(dict.fromkeys([*sync.rules.pull_cats(), *sync.mirror.cats()]))
                api = BitrixConf(self.store).api(self.opener)
                econ.discover(api, cats)
                pays.discover(api)
                return self.send(dict(econ.view(), list=pays.view()))
        except ValueError as exc:
            return self.text(400, str(exc))
        except BitrixError as exc:
            return self.text(422, str(exc))
        return self.text(404, 'Нет такого действия')

    def route(self, method, sub, author: str) -> None:
        store = self.store
        if sub == 'bitrix' and method == 'GET':
            return self.send(self.view())
        if sub == 'bitrix' and method == 'POST':
            data = self.body()
            was = BitrixConf(store).get()
            try:
                new = BitrixConf(store).save(data, author)
            except (ValueError, BitrixError) as exc:
                return self.text(400, str(exc))
            info = {k: data[k] for k in ('on', 'category', 'pollSec', 'mode', 'fallback') if k in data}
            info.update(
                {
                    k: 'изменено'
                    for k in ('flow', 'mgr', 'cats', 'stagesBy', 'fields', 'send', 'company', 'tasks', 'sched')
                    if k in data
                }
            )
            if 'url' in data:
                info['url'] = 'изменён' if data.get('url') else 'удалён'
            if 'stages' in data:
                info['stages'] = len(new.get('stages') or {})
            if 'users' in data:
                info['users'] = len(new.get('users') or {})
            self.log_fn(
                'edit_settings', 'settings', 'bitrix', {k: was.get(k) for k in ('on', 'category') if k in info}, info
            )
            if new.get('on') and not was.get('on'):  # включили — открытые сделки программы уходят в Битрикс
                DealBook(store).adopt()
                for (did,) in store.all("SELECT id FROM deals WHERE stage NOT IN ('won', 'lost')"):
                    BitrixQueue.touch(store, 'deal', did)
            return self.send(self.view())
        if sub.startswith('bitrix/diff'):  # расхождения стадии, суммы, ответственного (bitrix_diff.py)
            return self._diff(method, sub)
        if sub == 'bitrix/regs' and method == 'GET':
            return self.send(DealRegs(store).view())
        if sub == 'bitrix/regs' and method == 'POST':
            try:
                view = DealRegs(store).save(self.body())
            except ValueError as exc:
                return self.text(400, str(exc))
            self.log_fn('edit_settings', 'settings', 'bitrix-regs', None, {'регламент': 'изменён'})
            return self.send(view)
        if sub.startswith('bitrix/econ'):  # раздел «Экономика сделки» карточки портала (deal_econ.py)
            return self._econ_admin(method, sub)
        if sub == 'bitrix/test' and method == 'POST':
            try:
                data = self.body()
                if data.get('category') is not None:
                    BitrixConf(store).save({'category': data['category']}, author)
                return self.send(BitrixSync(store, self.opener).check())
            except (BitrixError, ValueError) as exc:
                return self.text(422, str(exc))
        if sub == 'bitrix/my' and method == 'POST':  # «Обновить список» наших компаний
            try:
                MyCompanies(store).load(BitrixConf(store).api(self.opener))
            except BitrixError as exc:
                return self.text(422, str(exc))
            return self.send(self.view())
        if sub == 'bitrix/run' and method == 'POST':
            res = BitrixSync(store, self.opener).run_now()
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/pull' and method == 'POST':  # «Загрузить из Битрикса сейчас» — без отправки очереди
            res = BitrixSync(store, self.opener).run_now(Sides.RECEIVE)
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/push' and method == 'POST':  # «Выгрузить сделку № …» — сразу
            num = str(self.body().get('number') or '').strip()
            row = (
                store.one("SELECT id FROM deals WHERE CAST(json_extract(doc, '$.number') AS TEXT)=?", (num,))
                if num
                else None
            )
            if not row:
                return self.text(404, 'Сделки с таким номером нет')
            BitrixQueue.touch(store, 'deal', row[0])
            if not store.one("SELECT 1 FROM bx_queue WHERE kind='deal' AND local_id=?", (row[0],)):
                return self.text(400, 'Связь выключена — сделка не отправлена')
            res = BitrixSync(store, self.opener).run_now(Sides.SEND)
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/stages' and method == 'POST':  # стадии другой воронки — для соответствия этапов
            cat = str(self.body().get('category') or '0')
            if not re.match(r'^\d{1,9}$', cat):
                return self.text(400, 'Неверная воронка')
            try:
                return self.send({'category': cat, 'stages': BitrixSync(store, self.opener).stages_all(cat)})
            except BitrixError as exc:
                return self.text(422, str(exc))
        if sub == 'bitrix/dry' and method == 'POST':  # пробный прогон: ничего не записывается
            if not BitrixConf(store).enabled():
                return self.text(400, 'Сначала включите связь — пробный прогон идёт по её правилам')
            try:
                return self.send(BitrixDry(store, self.opener).run())
            except BitrixError as exc:
                return self.text(422, str(exc))
        if sub in ('bitrix/import/preview', 'bitrix/import') and method == 'POST':
            if not BitrixConf(store).enabled():
                return self.text(400, 'Сначала включите связь')
            data = self.body()
            cats = [str(x) for x in data.get('cats') or []] if isinstance(data.get('cats'), list) else None
            try:
                if sub == 'bitrix/import/preview':
                    return self.send(BitrixImport(store, self.opener).preview(data.get('from'), cats))
                ids = (
                    [str(x)[:20] for x in data.get('ids') or []][: BitrixImport.MAX]
                    if isinstance(data.get('ids'), list)
                    else []
                )
                res = BitrixImport(store, self.opener).run(data.get('from'), cats, ids)
                self.log_fn('edit_settings', 'settings', 'bitrix', None, dict(res, importFrom=data.get('from')))
                return self.send(dict(self.view(), result=res))
            except ValueError as exc:
                return self.text(400, str(exc))
            except BitrixError as exc:
                return self.text(422, str(exc))
        if sub == 'bitrix/resend' and method == 'POST':
            body = self.body()
            what = body.get('what')
            if body.get('kind') in ('deal', 'task') and body.get('id'):  # «Повторить» у одной записи
                if not BitrixQueue(store).retry(body['kind'], str(body['id'])[:64]):
                    return self.text(404, 'Записи уже нет в очереди — она отправлена')
                return self.send(dict(self.view(), result=BitrixSync(store, self.opener).run(Sides.SEND)))
            BitrixQueue(store).retry_all()
            count = 0
            if what == 'all':
                for (did,) in store.all('SELECT id FROM deals'):
                    BitrixQueue.touch(store, 'deal', did)
                    count += 1
            self.log_fn('edit_settings', 'settings', 'bitrix', None, {'resend': what or 'failed', 'deals': count})
            return self.send(dict(self.view(), queued=count))
        return self.text(404, 'not found')
