"""Кабинет менеджера: сделки (DealBook), дела (TaskBook), воронка отдела; сделки собираются из КП."""

import json
import re
from datetime import date, datetime, timedelta
from typing import Any

from bitrix_my import MyCompanies
from clock import Clock
from crm_funnels import DealFields, Funnels
from deal_autofill import DealAutoFill
from deal_econ import DealEcon
from defaults import SrvVal
from inn import Inn
from kp_track import Val


def _obj(text) -> dict:
    try:
        data = json.loads(text) if text else {}
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class Stages:
    """Этапы воронки: [{key, label, closed}] — свои у администратора или встроенные."""

    LIST = 'crm.stages'
    BASE = (
        ('lead', 'Запрос'),
        ('sent', 'КП отправлено'),
        ('talks', 'Переговоры'),
        ('contract', 'Договор и оплата'),
        ('delivery', 'Поставка'),
    )
    CLOSED = (('won', 'Выиграно'), ('lost', 'Проиграно'))
    # статус КП (ход сделки) → этап сделки, до которого она продвигается сама
    BY_TRACK = {'new': 'lead', 'sent': 'sent', 'work': 'talks', 'won': 'contract'}
    ID_RE = re.compile(r'^[a-z0-9_-]{1,30}$')

    @classmethod
    def all(cls, store) -> list[dict]:
        from lists import ListStore

        rows = ListStore(store).all().get(cls.LIST)
        names, order = {}, []
        for row in rows if isinstance(rows, list) else []:
            k = str(row.get('id') or '').strip().lower() if isinstance(row, dict) else ''
            if cls.ID_RE.match(k) and k not in names:
                names[k] = str(row.get('name') or '').strip()[:60]
                order.append(k)
        closed = dict(cls.CLOSED)
        if not [k for k in order if k not in closed]:
            order = [k for k, _ in cls.BASE]
        base = dict(cls.BASE)
        out = [{'key': k, 'label': names.get(k) or base.get(k) or k} for k in order if k not in closed]
        return out + [{'key': k, 'label': names.get(k) or label, 'closed': True} for k, label in cls.CLOSED]

    @classmethod
    def keys(cls, store) -> list:
        return [stage['key'] for stage in cls.all(store)]


class ClientPick:
    """Компании на выбор в сделке (клиент из Битрикс24 совпал по контакту с несколькими клиентами программы)."""

    MAX = 8
    TEXT = 300
    SHORT = 120
    CONTACT = ('name', 'post', 'phone', 'email')

    @classmethod
    def clean(cls, rows) -> list[dict]:
        out = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict) or not row.get('id'):
                continue
            contact = picked if isinstance(picked := row.get('contact'), dict) else {}
            out.append(
                {
                    'id': re.sub(r'[^A-Za-z0-9_-]', '', str(row['id']))[:64],
                    'name': str(row.get('name') or '')[: cls.TEXT],
                    'inn': Inn.key(row.get('inn')),
                    'by': str(row.get('by') or '')[:20],
                    'contact': {key: str(contact.get(key) or '')[: cls.SHORT] for key in cls.CONTACT},
                }
            )
        return out[: cls.MAX]


class DealBook:
    """Сделки одного хранилища."""

    RUB_MAX = 1e12
    REASON_MAX = 200
    SOURCES = ('ad', 'repeat', 'own')  # заявка: рекламная, повторная, личная (регламент Битрикс24)

    HISTORY_MAX = 60
    GROUP_DAYS = 30  # КП одного клиента у одного менеджера с промежутком до 30 дней — одна сделка (adopt)
    WON_DAYS = 60  # выигранное КП старше — сделка «Выиграно» (adopt), моложе — «Договор и оплата»
    STALE_DAYS = 180  # незакрытые КП без движения дольше — сделка «Проиграно» с понятной причиной (adopt)
    STALE_REASON = 'Нет движения больше 180 дней (закрыта при переходе на сделки)'
    COLS = 'id, doc, manager_id, stage, updated, rev, funnel'

    def __init__(self, store) -> None:
        self.store = store
        self._filler: DealAutoFill | None = None

    @staticmethod
    def _out(row) -> dict:
        deal = _obj(row[1])
        deal.update(
            id=row[0],
            managerId=row[2] or '',
            stage=row[3] or 'lead',
            updated=row[4] or '',
            rev=row[5] or 0,
            funnel=row[6] or Funnels.MAIN,
        )
        return deal

    def get(self, did) -> dict | None:
        row = self.store.one(f'SELECT {self.COLS} FROM deals WHERE id=?', (str(did or '')[:40],))
        return self._out(row) if row else None

    def _require(self, did) -> dict:
        found = self.get(did)
        if found is None:
            raise LookupError('Сделка не найдена')
        return found

    def deals(self, managers=None, closed_days: int | None = None) -> list:
        """Сделки менеджеров (None — все): незакрытые и закрытые за последние closed_days дней (по умолчанию —
        «Значения программы», crm.closedDays)."""
        days = SrvVal.get(self.store, 'crm.closedDays') if closed_days is None else closed_days
        since = (date.today() - timedelta(days=days)).isoformat()
        sql = f"SELECT {self.COLS} FROM deals WHERE (stage NOT IN ('won', 'lost') OR updated >= ?)"
        args = [since]
        if managers is not None:
            sql += ' AND manager_id IN ({})'.format(','.join('?' * len(managers))) if managers else ' AND 0'
            args += list(managers)
        return [self._out(row) for row in self.store.all(sql + ' ORDER BY updated DESC', tuple(args))]

    def kps(self, ids) -> dict[str, list[dict]]:
        """{id сделки: [КП кратко]} — КП из журнала (КП в корзине не показываются)."""
        out: dict[str, list[dict]] = {i: [] for i in ids}
        if not ids:
            return out
        from admin import econ_rub

        for i in range(0, len(ids), 500):
            part = ids[i : i + 500]
            for did, kid, meta, track in self.store.all(
                'SELECT l.deal_id, k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id '
                'WHERE k.meta IS NOT NULL AND l.deal_id IN ({})'.format(','.join('?' * len(part))),
                tuple(part),
            ):
                out[did].append(self._kp_card(kid, _obj(meta), _obj(track), econ_rub))
        for items in out.values():
            items.sort(key=lambda x: (x['savedAt'] or x['date'] or '', x['id']), reverse=True)
        return out

    @staticmethod
    def _kp_card(kid: str, meta, track, econ_rub) -> dict:
        rub = econ_rub(meta)[0]
        econ = picked if isinstance(picked := meta.get('econ'), dict) else {}
        plan = picked if isinstance(picked := meta.get('plan'), dict) else None
        return {
            'id': kid,
            'number': meta.get('number') or kid,
            'date': str(meta.get('date') or '')[:10],
            'savedAt': str(meta.get('savedAt') or '')[:40],
            'sum': rub,
            'sumCur': econ.get('sum') if econ.get('cur') not in (None, 'RUB') else None,
            'cur': econ.get('cur') or 'RUB',
            'status': track.get('status') or 'new',
            'reason': track.get('reason') or '',
            'validUntil': str(meta.get('validUntil') or '')[:10],
            'items': (meta.get('items') or [])[:2] if isinstance(meta.get('items'), list) else [],
            'positions': meta.get('positions') or 0,
            'client': meta.get('client') or '',
            'plan': plan,
            'followUp': picked if isinstance(picked := track.get('followUp'), dict) else None,
        }

    @staticmethod
    def _next_number(conn) -> int:
        """Следующий номер сделки; номер, уже занятый сделкой (счётчик из старой копии базы), пропускается."""
        while True:
            conn.execute(
                "INSERT INTO kv (key, value) VALUES ('crm.seq', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
            )
            num = int(conn.execute("SELECT value FROM kv WHERE key='crm.seq'").fetchone()[0])
            if not conn.execute('SELECT 1 FROM deals WHERE id=?', (f'd{num}',)).fetchone():
                return num

    def _log(self, deal, author: str, **what) -> None:
        hist = picked if isinstance(picked := deal.get('history'), list) else []
        hist.append(dict(what, at=Clock.now(), by=author))
        deal['history'] = hist[-self.HISTORY_MAX :]

    def _save(self, conn, did, deal, author: str, base_rev=None, when=None) -> int:
        """Записать сделку (в открытой транзакции c). → номер правки."""
        rev = self.store._next_rev(conn, 'deals', did, base_rev)
        doc = {
            k: v
            for k, v in deal.items()
            if k not in ('id', 'managerId', 'stage', 'updated', 'rev', 'kps', 'next', 'tasks', 'funnel')
        }
        conn.execute(
            'INSERT OR REPLACE INTO deals (id, doc, manager_id, stage, client, inn, updated, rev, updated_by, funnel) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            (
                did,
                json.dumps(doc, ensure_ascii=False),
                deal.get('managerId') or '',
                deal.get('stage') or 'lead',
                str(deal.get('client') or '')[:300],
                Inn.key(deal.get('clientInn')),
                when or Clock.now(),
                rev,
                str(author or '')[:120],
                deal.get('funnel') or Funnels.MAIN,
            ),
        )
        return rev

    def _new(self, conn, data, author: str, when=None) -> str:
        num = self._next_number(conn)
        did = f'd{num}'
        data = dict(data, number=num, created=when or Clock.now(), createdBy=author)
        data.setdefault('stageAt', data['created'])
        self._save(conn, did, data, author, when=when)
        return did

    def create(self, data, manager_id, manager, author: str) -> dict:
        """Новая сделка вручную (без КП). ValueError — с понятным текстом."""
        funnel = self._funnel_of(data, Funnels(self.store).for_new(manager_id))
        x = self._clean(data, {'funnel': funnel})
        if not (x.get('title') or x.get('client')):
            raise ValueError('Укажите клиента или название сделки')
        x.setdefault('title', x.get('client'))
        x.update(managerId=manager_id or '', manager=manager or '', funnel=funnel)
        if 'stage' not in x:
            x.update(self._stage(funnel, Funnels(self.store).first(funnel)))
        if not x.get('expected'):
            x['expected'] = (date.today() + timedelta(days=30)).isoformat()
        self._log(x, author, what='create')
        with self.store.lock:
            conn = self.store.conn()
            did = self._new(conn, x, author)
            conn.commit()
        self.autofill(did, author)  # поля регламента, известные сразу (источник заявки, сумма)
        return self._require(did)

    def _funnel_of(self, data, default) -> str:
        if not isinstance(data, dict) or 'funnel' not in data:
            return default
        fid = str(data.get('funnel') or '')
        if not Funnels(self.store).known(fid):
            raise ValueError('Неизвестная воронка')
        return fid

    def _stage(self, funnel, key) -> dict:
        """Стадия воронки → {stage (столбец), fstage (точная стадия воронки Битрикса)}."""
        found = Funnels(self.store).resolve(funnel, key)
        if not found:
            raise ValueError('Неизвестный этап сделки')
        out: dict[str, Any] = {'stage': found[0]}
        if funnel != Funnels.MAIN:
            out['fstage'] = found[1]
        return out

    def _clean(self, data, cur) -> dict:
        """Поля сделки из запроса → изменения (cur — сделка, её воронка). ValueError — с понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет данных сделки')
        funnel = cur.get('funnel') or Funnels.MAIN
        out: dict[str, Any] = {}
        for k, field in (('title', 200), ('client', 300), ('note', 3000)):
            if k in data:
                out[k] = Val.text(data.get(k), field)
        if 'clientInn' in data:
            out['clientInn'] = Inn.key(data.get('clientInn'))
        if 'clientId' in data:
            out['clientId'] = re.sub(r'[^A-Za-z0-9_-]', '', str(data.get('clientId') or ''))[:64]
        if 'myCompany' in data:
            out['myCompany'] = MyCompanies.clean(data.get('myCompany'))
        if 'source' in data:
            source = str(data.get('source') or '')
            if source not in self.SOURCES:
                raise ValueError('Источник заявки: рекламная, повторная или личная')
            out['source'] = source
        if 'clientPick' in data:
            out['clientPick'] = ClientPick.clean(data.get('clientPick'))
        elif 'clientId' in data or 'client' in data:
            out['clientPick'] = []
        if 'expected' in data:
            v = data.get('expected')
            day = Val.day(v) if v else None
            if v and not day:
                raise ValueError('Ожидаемая дата — в формате ГГГГ-ММ-ДД')
            out['expected'] = day.isoformat() if day else ''
        if 'pausedUntil' in data:  # «отложить до»: сделка скрыта с доски до даты, потом — дело «вернуться к сделке»
            v = data.get('pausedUntil')
            day = Val.day(v) if v else None
            if v and (not day or day <= date.today()):
                raise ValueError('Отложить можно до даты позже сегодняшней')
            out['pausedUntil'] = day.isoformat() if day else ''
        if 'sum' in data:  # ввод — в рублях, хранится в копейках; пусто — по последнему КП сделки
            v = data.get('sum')
            if v in (None, ''):
                out.update(sumOwn=False)
            else:
                try:
                    rub = float(str(v).replace(' ', '').replace(',', '.'))
                except ValueError:
                    raise ValueError('Сумма сделки — число в рублях') from None
                if not (0 <= rub < self.RUB_MAX):
                    raise ValueError('Сумма сделки — от 0 до 999 млрд руб.')
                out.update(sum=round(rub * 100), sumOwn=True)
        if 'stage' in data:
            out.update(self._stage(funnel, str(data.get('stage') or '')))
            if out['stage'] == Funnels.LOST:
                out['lostReason'] = self._reason(data, cur, funnel, out.get('fstage'))
        if 'uf' in data:
            out['uf'] = DealFields(self.store).clean(funnel, data.get('uf'))
        return out

    def _reason(self, data, cur, funnel, exact) -> str:
        """Причина проигрыша: своя; у воронки Битрикса без своей — название стадии провала («Высокая цена»)."""
        reason = Val.text(data.get('lostReason') if 'lostReason' in data else cur.get('lostReason'), self.REASON_MAX)
        if not reason and exact:
            reason = Funnels(self.store).label(funnel, exact)
        if not reason:
            raise ValueError('Укажите причину проигрыша')
        return reason

    def update(self, did, data, author: str, base_rev=None, manager=None) -> dict:
        """Правка сделки (поля, этап, сумма, ответственный) → сделка; Conflict — сделку успели изменить."""
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                raise LookupError('Сделка не найдена')
            funnel = self._funnel_of(data, cur['funnel'])
            moved = funnel != cur['funnel']
            if moved and 'stage' not in data:
                data = dict(data, stage=Funnels(self.store).first(funnel))
            x = self._clean(data, dict(cur, funnel=funnel))
            conn = self.store.conn()
            new = dict(cur, **x, funnel=funnel)
            if moved:
                if funnel == Funnels.MAIN:
                    new.pop('fstage', None)
                self._log(new, author, what='funnel', **{'from': cur['funnel'], 'to': funnel})
            self._stage_change(new, cur, x, author)
            if manager and manager[0] != cur.get('managerId'):
                new.update(managerId=manager[0], manager=manager[1])
                self._log(new, author, what='manager', to=manager[1])
            changed = [
                k for k in ('title', 'client', 'expected', 'sum', 'note', 'myCompany') if k in x and x[k] != cur.get(k)
            ]
            if changed:
                self._log(new, author, what='edit', fields=changed)
            if 'uf' in x:
                old_uf = cur.get('uf') or {}
                new['uf'] = {
                    code: value for code, value in dict(old_uf, **x['uf']).items() if value not in ('', [], None)
                }
                fields = [code for code, value in x['uf'].items() if value != old_uf.get(code)]
                if fields:
                    self._log(new, author, what='fields', fields=fields)
            self._sum(conn, new)
            self._save(conn, did, new, author, base_rev)
            conn.commit()
        return self._require(did)

    def put_uf(self, did, values: dict, author: str) -> None:
        """Значения полей Битрикса (из обмена) — без проверки ввода: пришли с портала как есть."""
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                return
            old = cur.get('uf') or {}
            new = {code: value for code, value in dict(old, **values).items() if value not in ('', [], None)}
            if new == old:
                return
            cur['uf'] = new
            conn = self.store.conn()
            self._save(conn, did, cur, author)
            conn.commit()

    COMMENT_MAX = 2000
    COMMENTS_KEPT = 300

    def comment(self, did, text: Any, author: str) -> dict:
        """Комментарий в ленту сделки → запись {id, at, by, text}. ValueError — пустой или слишком длинный."""
        body = str(text or '').strip()
        if not body:
            raise ValueError('Напишите комментарий')
        if len(body) > self.COMMENT_MAX:
            raise ValueError(f'Комментарий — до {self.COMMENT_MAX} знаков')
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                raise LookupError('Сделка не найдена')
            comments = [row for row in cur.get('comments') or [] if isinstance(row, dict)]
            number = max([int(row.get('id') or 0) for row in comments] + [0]) + 1
            row = {'id': number, 'at': Clock.now(), 'by': str(author or '')[:120], 'text': body}
            cur['comments'] = [*comments, row][-self.COMMENTS_KEPT :]
            conn = self.store.conn()
            self._save(conn, did, cur, author)
            conn.commit()
        return row

    def put_exec(self, did, state: dict, author: str, what: dict) -> None:
        """Отметки исполнения сделки (crm_exec) — с записью в историю."""
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                raise LookupError('Сделка не найдена')
            cur['exec'] = state
            self._log(cur, author, what='exec', **what)
            conn = self.store.conn()
            self._save(conn, did, cur, author)
            conn.commit()

    def _stage_change(self, new, cur, x, author: str) -> None:
        exact = x.get('fstage') or x.get('stage')
        if not x.get('stage') or (x['stage'], exact) == (cur['stage'], cur.get('fstage') or cur['stage']):
            return
        new.update(stageAt=Clock.now(), lostAuto=False)
        if x['stage'] != Funnels.LOST:
            new.pop('lostReason', None)
        self._log(new, author, what='stage', **{'from': cur.get('fstage') or cur['stage'], 'to': exact})

    def remove(self, did: str, author: str) -> dict:
        """Сделка — в корзину «Настроек» (восстановит администратор). Дела, документы и связи с КП остаются в базе и
        возвращаются вместе со сделкой; пока она в корзине, её дела не видны. → удалённая сделка."""
        deal = self._require(did)
        title = ' — '.join(
            part for part in (f'Сделка № {deal.get("number") or did}', deal.get('title'), deal.get('client')) if part
        )
        self.store.trash_put('deal', did, title[:300], author)
        return deal

    UNDO_MIN = 10  # «Восстановить» после удаления — сам удаливший, в эти минуты; позже — администратор в корзине

    def restore(self, did: str, viewer: Any) -> dict:
        """Вернуть только что удалённую сделку из корзины; viewer — features.Viewer (admin — любую, иначе свою, uid).
        LookupError — нет в корзине, PermissionError — чужая или поздно."""
        row = self.store.one(
            "SELECT id, data, deleted_at FROM trash WHERE entity_type='deal' AND entity_id=? ORDER BY id DESC LIMIT 1",
            (str(did),),
        )
        if not row:
            raise LookupError('Сделки нет в корзине')
        owner = str(_obj(row[1]).get('manager_id') or '')
        fresh = str(row[2] or '') >= (datetime.now() - timedelta(minutes=self.UNDO_MIN)).isoformat(timespec='seconds')
        if not viewer.admin and (owner != viewer.uid or not fresh):
            raise PermissionError('Вернуть сделку может администратор: «Настройки → Корзина»')
        self.store.trash_restore(row[0])
        return self._require(did)

    def deal_of(self, kid: str) -> str | None:
        row = self.store.one('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,))
        return row[0] if row else None

    def link(self, did, kid: str, author: str) -> str | None:
        """КП — в сделку (из прежней сделки КП уходит). → прежняя сделка или None."""
        with self.store.lock:
            conn = self.store.conn()
            old = (conn.execute('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,)).fetchone() or [None])[0]
            if old == did:
                return None
            conn.execute(
                'INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (kid, did, Clock.now())
            )
            deal = self.get(did)
            self._log(deal, author, what='kp', kp=kid)
            self._sync(conn, deal, author)
            if old:
                old_deal = self.get(old)
                if old_deal:
                    self._log(old_deal, author, what='kpOut', kp=kid)
                    self._sync(conn, old_deal, author)
            conn.commit()
        return old

    def on_kp(self, kid: str, meta, author: str, want=None) -> str | None:
        """КП сохранено: в сделку want («new» — новую), прежнюю или новую по КП; пересчёт суммы и этапа → id."""
        meta_obj = meta if isinstance(meta, dict) else _obj(meta)
        with self.store.lock:
            conn = self.store.conn()
            cur = (conn.execute('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,)).fetchone() or [None])[0]
            if want == 'new' and cur:  # «Отдельная новая сделка» для КП, которое уже в сделке
                old = self.get(cur)
                did = self._from_kp(
                    conn,
                    kid,
                    meta_obj,
                    _obj((conn.execute('SELECT track FROM kp WHERE id=?', (kid,)).fetchone() or [''])[0]),
                    author,
                )
                if old:
                    self._log(old, author, what='kpOut', kp=kid)
                    self._sync(conn, old, author)
                self._sync(conn, self.get(did), author)
                conn.commit()
                return did
            if want and want not in ('new', cur) and self.get(want):
                self.link(want, kid, author)
                return want
            if cur and not self.get(cur) and not self._in_trash(cur):
                cur = None  # сделку удалили навсегда — КП снова в работе: новая сделка
            did = cur or self._from_kp(
                conn,
                kid,
                meta_obj,
                _obj((conn.execute('SELECT track FROM kp WHERE id=?', (kid,)).fetchone() or [''])[0]),
                author,
            )
            deal = self.get(did)
            if deal:
                if not deal.get('client') and meta_obj.get('client'):
                    deal.update(
                        client=str(meta_obj['client'])[:300],
                        clientInn=Inn.key(meta_obj.get('clientInn')),
                    )
                self._sync(conn, deal, author)
            conn.commit()
        return did

    def _from_kp(self, conn, kid: str, meta, track, author: str, when=None, manager=None) -> str:
        items = picked if isinstance(picked := meta.get('items'), list) else []
        tnd = picked if isinstance(picked := meta.get('tender'), dict) else {}
        title = (
            ('Закупка № {}'.format(tnd['number']))
            if tnd.get('number')
            else (str(items[0]) if items else f'КП № {meta.get("number") or kid}')
        )
        mid, mname = manager or (
            str(meta.get('authorId') or meta.get('managerId') or ''),
            str(meta.get('manager') or ''),
        )
        exp = Val.day(meta.get('validUntil')) or ((Val.day(meta.get('date')) or date.today()) + timedelta(days=30))
        deal = {
            'title': title[:200],
            'client': str(meta.get('client') or '')[:300],
            'clientInn': Inn.key(meta.get('clientInn')),
            'managerId': mid[:64],
            'manager': mname[:120],
            'expected': exp.isoformat(),
            'auto': True,
        }
        funnel = Funnels(self.store).for_new(mid)
        deal.update(funnel=funnel, **self._stage(funnel, self._kp_stage(funnel, track.get('status') or 'new')))
        self._log(deal, author, what='create', kp=kid)
        did = self._new(conn, deal, author, when=when)
        conn.execute(
            'INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (kid, did, when or Clock.now())
        )
        return did

    def _in_trash(self, did: str) -> bool:
        return bool(self.store.one("SELECT 1 FROM trash WHERE entity_type='deal' AND entity_id=?", (did,)))

    def _kp_stage(self, funnel, status) -> str:
        """Стадия новой сделки по ходу КП: этап хода КП или ближайший ниже, у которого есть стадия воронки."""
        want = Stages.BY_TRACK.get(status, 'lead')
        order = list(Funnels.TRACK)
        funnels = Funnels(self.store)
        for key in reversed(order[: order.index(want) + 1]):
            target = funnels.track(funnel, key)
            if target in funnels.open_keys(funnel):
                return target
        return funnels.first(funnel)

    @classmethod
    def kp_moved(cls, store, kid: str, author: str) -> str | None:
        """КП ушло в корзину или вернулось из неё — сумма и этап его сделки заново (и в очередь Битрикс24)."""
        try:
            did = cls(store).refresh(kid, author)
            if did:
                from bitrix import BitrixQueue

                BitrixQueue.touch(store, 'deal', did)
            return did
        except Exception as econ:
            from server_log import ServerLog

            ServerLog.failure(f'сделка КП {kid} после корзины', econ)
            return None

    def refresh(self, kid: str, author: str) -> str | None:
        """Ход сделки КП изменился — этап и сумма его сделки."""
        did = self.deal_of(kid)
        if not did:
            return None
        with self.store.lock:
            conn = self.store.conn()
            deal = self.get(did)
            if deal:
                self._sync(conn, deal, author)
                conn.commit()
        return did

    def _rows(self, conn, did) -> list:
        from admin import econ_rub

        return [
            self._kp_card(k, _obj(meta_raw), _obj(track_raw), econ_rub)
            for k, meta_raw, track_raw in conn.execute(
                'SELECT k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id WHERE l.deal_id=? AND k.meta IS NOT NULL',
                (did,),
            ).fetchall()
        ]

    def _sum(self, conn, deal, rows=None) -> None:
        """Сумма сделки — по последнему незакрытому проигрышем КП (своя сумма менеджера — как есть)."""
        if deal.get('sumOwn'):
            return
        rows = self._rows(conn, deal['id']) if rows is None else rows
        live = [row for row in rows if row['status'] != 'lost'] or rows
        live.sort(key=lambda rec: (rec['savedAt'] or rec['date'] or '', rec['id']), reverse=True)
        deal['sum'] = (live[0]['sum'] or 0) if live else (deal.get('sum') or 0)

    def _sync(self, conn, deal, author: str, when=None) -> None:
        """Сумма по КП и этап только вперёд по ходу КП (в любой воронке); все КП проиграны — «Проиграно»."""
        rows = self._rows(conn, deal['id'])
        self._sum(conn, deal, rows)
        funnels, funnel = Funnels(self.store), deal.get('funnel') or Funnels.MAIN
        stage = deal.get('fstage') or deal.get('stage') or 'lead'
        target = self._auto_target(funnels, funnel, deal, rows, stage)
        if target and target != stage:
            found = funnels.resolve(funnel, target)
            if found:
                deal.update(stage=found[0], stageAt=when or Clock.now())
                if funnel != Funnels.MAIN:
                    deal['fstage'] = found[1]
                if found[0] != Funnels.LOST:
                    deal.pop('lostReason', None)
                    deal['lostAuto'] = False
                self._log(deal, author, what='stage', auto=True, **{'from': stage, 'to': found[1]})
        self._autofill(deal, self._fill_order(rows), author)
        self._save(conn, deal['id'], deal, author, when=when)

    @staticmethod
    def _fill_order(rows: list) -> list[str]:
        """КП сделки для полей Битрикс24: свежие первыми; проигранные — только если других нет."""
        live = [row for row in rows if row['status'] != 'lost'] or rows
        live = sorted(live, key=lambda rec: (rec['savedAt'] or rec['date'] or '', rec['id']), reverse=True)
        return [row['id'] for row in live]

    def _autofill(self, deal: dict, kp_ids: list[str], author: str) -> bool:
        """Поля Битрикс24 из КП: раздел «Экономика сделки» — по экономике, пустые остальные — по КП (сбой подсказки не
        мешает сохранению сделки); выключено — ничего."""
        from features import FeatureAccess

        changed: list[str] = []
        econ = DealEcon(self.store)
        try:
            changed += econ.fill(deal, kp_ids)
            if FeatureAccess(self.store).is_on('ufAuto'):
                if self._filler is None:
                    self._filler = DealAutoFill(self.store)
                skip = frozenset(econ.owned()) if econ.enabled() else frozenset()
                changed += self._filler.apply(deal, kp_ids, skip)
        except Exception as exc:
            from server_log import ServerLog

            ServerLog.failure(f'поля Битрикс24 сделки {deal.get("id")} из КП', exc)
            return False
        if changed:
            self._log(deal, author, what='fields', fields=changed, auto=True)
        return bool(changed)

    def kp_order(self, did) -> list[str]:
        """КП сделки для полей Битрикс24 — свежие первыми (проигранные — только если других нет)."""
        return self._fill_order(self._rows(self.store.conn(), did))

    def put_econ_list(self, did, have: dict) -> None:
        """Элементы списка «Оплаты» Битрикс24 по оплатам сделки: {ключ оплаты: {id, sent, share}} (bitrix_econ_list)."""
        with self.store.lock:
            cur = self.get(did)
            if not cur or cur.get('econList') == have:
                return
            cur['econList'] = have
            conn = self.store.conn()
            self._save(conn, did, cur, 'Битрикс24')
            conn.commit()

    def put_econ(self, did, notes: dict, author: str, said: list[str]) -> None:
        """Экономика из Битрикса: пометки об изменённых итогах и запись в историю о поправках статей."""
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                return
            if cur.get('econNotes') == notes and not said:
                return
            cur['econNotes'] = notes
            if said:
                self._log(cur, author, what='econ', said=said)
            conn = self.store.conn()
            self._save(conn, did, cur, author)
            conn.commit()

    def autofill(self, did, author: str) -> bool:
        """Дозаполнить поля Битрикс24 сделки по её КП (карточку открыли). → изменилось ли."""
        with self.store.lock:
            deal = self.get(did)
            if not deal:
                return False
            conn = self.store.conn()
            kp_ids = self._fill_order(self._rows(conn, did))
            if not self._autofill(deal, kp_ids, author):
                return False
            self._save(conn, did, deal, author)
            conn.commit()
        return True

    @staticmethod
    def _auto_target(funnels, funnel, deal, rows, stage) -> str | None:
        keys = funnels.open_keys(funnel)
        if rows and all(row['status'] == 'lost' for row in rows):
            if deal.get('stage') in Funnels.CLOSED:
                return None
            last = max(rows, key=lambda rec: rec['savedAt'] or rec['date'] or '')
            deal['lostReason'], deal['lostAuto'] = last['reason'] or 'КП проиграно', True
            return Funnels.LOST
        best = [funnels.track(funnel, Stages.BY_TRACK.get(row['status'])) for row in rows if row['status'] != 'lost']
        best = [k for k in best if k in keys]
        top = max(best, key=keys.index) if best else None
        if not top:
            return None
        if deal.get('stage') == Funnels.LOST and deal.get('lostAuto'):
            return top
        return top if stage in keys and keys.index(top) > keys.index(stage) else None

    def adopt(self) -> int:
        """КП журнала без сделки — в сделки (после перехода на сделки, восстановления и загрузки копии). → сколько КП."""
        if not self.store.one(
            'SELECT 1 FROM kp k WHERE k.meta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deal_kp l WHERE l.kp_id = k.id) LIMIT 1'
        ):
            return 0
        with self.store.lock:
            conn = self.store.conn()
            count = self._adopt(conn)
            conn.commit()
        return count

    def _adopt(self, conn) -> int:
        names: dict = {}
        for mid, doc in conn.execute('SELECT id, doc FROM managers').fetchall():
            name = str(_obj(doc).get('name') or '').strip().lower()
            if name:
                names.setdefault(name, mid)
        rows = []
        for kid, meta, track in conn.execute(
            'SELECT k.id, k.meta, k.track FROM kp k WHERE k.meta IS NOT NULL AND '
            'NOT EXISTS (SELECT 1 FROM deal_kp l WHERE l.kp_id = k.id)'
        ).fetchall():
            meta_obj, track_obj = _obj(meta), _obj(track)
            day = Val.day(meta_obj.get('date')) or Val.day(meta_obj.get('savedAt')) or date.today()
            mid = str(
                meta_obj.get('authorId')
                or meta_obj.get('managerId')
                or names.get(str(meta_obj.get('manager') or '').strip().lower())
                or ''
            )
            who = mid or str(meta_obj.get('manager') or '').strip().lower()
            client = Inn.digits(meta_obj.get('clientInn')) or str(meta_obj.get('client') or '').strip().lower()
            rows.append((who, client, day, kid, meta_obj, track_obj, mid))
        rows.sort(key=lambda rec: (rec[0], rec[1], rec[2], rec[3]))
        groups: list = []
        last = None
        for row in rows:
            group = groups[-1] if groups else None
            if (
                group
                and last
                and row[0] == last[0]
                and row[1]
                and row[1] == last[1]
                and (row[2] - last[2]).days <= self.GROUP_DAYS
            ):
                group.append(row)
            else:
                groups.append([row])
            last = row
        today = date.today()
        for group in groups:
            first, end = group[0], group[-1]
            when = first[2].isoformat() + 'T09:00:00'
            did = self._from_kp(
                conn,
                first[3],
                first[4],
                first[5],
                'переход на сделки',
                when=when,
                manager=(first[6], str(first[4].get('manager') or '')),
            )
            for row in group[1:]:
                conn.execute(
                    'INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (row[3], did, when)
                )
            deal = self.get_c(conn, did)
            stamp = end[2].isoformat() + 'T09:00:00'
            self._sync(conn, deal, 'переход на сделки', when=stamp)
            deal = self.get_c(conn, did)
            if deal is None:
                continue
            close = self._old_close(deal, (today - end[2]).days)
            if close:
                deal.update(self._stage(deal['funnel'], close), stageAt=stamp)
                if close == Funnels.LOST:
                    deal.update(lostReason=self.STALE_REASON, lostAuto=False)
                self._save(conn, did, deal, 'переход на сделки', when=stamp)
        return len(rows)

    def _old_close(self, deal, age: int) -> str | None:
        """Давнее КП при переходе на сделки: выигранное — «Выиграно», без движения — «Проиграно»."""
        funnel = deal['funnel']
        stage = deal.get('fstage') or deal['stage']
        if stage == Funnels(self.store).track(funnel, 'contract') and age > self.WON_DAYS:
            return Funnels.WON
        if deal['stage'] not in Funnels.CLOSED and age > self.STALE_DAYS:
            return Funnels.LOST
        return None

    def flag(self, did, **kw) -> None:
        """Служебная отметка сделки без правки и истории; None — снять."""
        with self.store.lock:
            row = self.store.one('SELECT doc FROM deals WHERE id=?', (did,))
            if not row:
                return
            deal = _obj(row[0])
            for k, v in kw.items():
                if v is None:
                    deal.pop(k, None)
                else:
                    deal[k] = v
            self.store.write('UPDATE deals SET doc=? WHERE id=?', (json.dumps(deal, ensure_ascii=False), did))

    def get_c(self, conn, did) -> dict | None:
        row = conn.execute(f'SELECT {self.COLS} FROM deals WHERE id=?', (did,)).fetchone()
        return self._out(row) if row else None


class TaskBook:
    """Дела менеджера (звонок, встреча, письмо, задача) со сроком; open / done / cancel, не удаляются."""

    KINDS = (('call', 'Звонок'), ('meet', 'Встреча'), ('mail', 'Письмо'), ('task', 'Задача'))
    STATES = ('open', 'done', 'cancel')
    AUTO_STEP = 'auto:'  # дела, которые кабинет ставит сам (crm_auto.AutoTasks)
    TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
    COLS = 'id, deal_id, manager_id, kind, due, time, title, note, state, done_at, created, created_by, step'
    CHUNK = 500  # сделок в одном запросе (предел параметров SQLite)

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def _out(cls, row) -> dict:
        return dict(
            zip(
                (
                    'id',
                    'deal',
                    'managerId',
                    'kind',
                    'due',
                    'time',
                    'title',
                    'note',
                    'state',
                    'doneAt',
                    'created',
                    'by',
                    'step',
                ),
                row,
                strict=False,
            )
        )

    def get(self, tid: str | int) -> dict | None:
        row = self.store.one(f'SELECT {self.COLS} FROM crm_tasks WHERE id=?', (int(tid),))
        return self._out(row) if row else None

    CALLS_SHOWN = 8

    def client_calls(self, deal: dict, managers: list[str] | None = None) -> list[dict]:
        """Сделанные звонки по всем сделкам этого клиента (по ИНН, иначе по названию) — последние сверху; managers — только
        звонки этих менеджеров (кому не открыты КП коллег), None — всех."""
        inn = Inn.digits(deal.get('clientInn'))
        client = str(deal.get('client') or '').strip()
        if not inn and not client:
            return []
        where, args = ('d.inn = ?', [inn]) if inn else ('d.client = ?', [client])
        if managers is not None:
            where += ' AND t.manager_id IN ({})'.format(','.join('?' * len(managers))) if managers else ' AND 0'
            args += managers
        cols = ', '.join(f't.{col.strip()}' for col in self.COLS.split(','))
        rows = self.store.all(
            f"SELECT {cols} FROM crm_tasks t JOIN deals d ON d.id = t.deal_id WHERE t.kind = 'call' AND t.state = 'done' "
            f'AND {where} ORDER BY t.done_at DESC LIMIT {self.CALLS_SHOWN}',
            tuple(args),
        )
        return [self._out(row) for row in rows]

    def _require(self, tid) -> dict:
        found = self.get(tid)
        if found is None:
            raise LookupError('Дело не найдено')
        return found

    def twin(self, did: str, data: Any) -> dict | None:
        """Открытое дело сделки с тем же названием на тот же день (повтор по ошибке) или None."""
        if not isinstance(data, dict):
            return None
        title = ' '.join(str(data.get('title') or '').lower().split())
        due = str(data.get('due') or '')
        for task in self.list(deal=did):
            same = ' '.join(str(task.get('title') or '').lower().split()) == title
            if task.get('state') == 'open' and same and task.get('due') == due:
                return task
        return None

    def next_open(self, deal_ids: list[str]) -> dict[str, dict]:
        """Ближайшее открытое дело каждой сделки — чьё бы оно ни было: дело коллеги по сделке — тоже следующий шаг."""
        ids = [did for did in deal_ids if did]
        found: dict[str, dict] = {}
        for start in range(0, len(ids), self.CHUNK):
            part = ids[start : start + self.CHUNK]
            marks = ','.join('?' * len(part))
            rows = self.store.all(
                f"SELECT {self.COLS} FROM crm_tasks WHERE state = 'open' AND deal_id IN ({marks}) ORDER BY due, time, id",
                tuple(part),
            )
            for task in (self._out(row) for row in rows):
                found.setdefault(task['deal'], task)
        return found

    def list(self, managers=None, deal=None, days=14) -> list:
        """Незакрытые дела и закрытые за последние days дней: менеджеров (None — всех) или одной сделки (все её дела)."""
        if deal:
            rows = self.store.all(f'SELECT {self.COLS} FROM crm_tasks WHERE deal_id=? ORDER BY due, time, id', (deal,))
            return [self._out(row) for row in rows]
        since = (date.today() - timedelta(days=days)).isoformat()
        sql, args = (
            f"SELECT {self.COLS} FROM crm_tasks WHERE (state = 'open' OR done_at >= ?) "
            "AND (deal_id IS NULL OR deal_id = '' OR deal_id IN (SELECT id FROM deals))",  # дела сделки в корзине не видны
            [since],
        )
        if managers is not None:
            sql += ' AND manager_id IN ({})'.format(','.join('?' * len(managers))) if managers else ' AND 0'
            args += list(managers)
        return [self._out(row) for row in self.store.all(sql + ' ORDER BY due, time, id', tuple(args))]

    def _clean(self, data, cur) -> dict:
        if not isinstance(data, dict):
            raise ValueError('Нет данных дела')
        x = {}
        if 'kind' in data or not cur:
            k = data.get('kind') or 'task'
            if k not in dict(self.KINDS):
                raise ValueError('Неизвестный вид дела')
            x['kind'] = k
        if 'due' in data or not cur:
            day = Val.day(data.get('due'))
            if not day:
                raise ValueError('Укажите дату дела')
            x['due'] = day.isoformat()
        if 'time' in data:
            time_text = str(data.get('time') or '').strip()
            if time_text and not self.TIME.match(time_text):
                raise ValueError('Время — в формате ЧЧ:ММ')
            x['time'] = time_text
        for k, field in (('title', 200), ('note', 1000)):
            if k in data:
                x[k] = Val.text(data.get(k), field)
        if 'state' in data:
            if data.get('state') not in self.STATES:
                raise ValueError('Неизвестное состояние дела')
            x['state'] = data['state']
        return x

    def add(self, data, manager_id, author: str, deal=None, step: str = '') -> dict:
        """Новое дело; step — точка исполнения сделки, на которую дело поставила программа (crm_exec)."""
        x = self._clean(data, None)
        title = x.get('title') or dict(self.KINDS)[x['kind']]
        with self.store.lock:
            conn = self.store.conn()
            cur = conn.execute(
                'INSERT INTO crm_tasks (deal_id, manager_id, kind, due, time, title, note, state, created, created_by, step) '
                "VALUES (?,?,?,?,?,?,?,'open',?,?,?)",
                (
                    deal or None,
                    manager_id or '',
                    x['kind'],
                    x['due'],
                    x.get('time') or '',
                    title,
                    x.get('note') or '',
                    Clock.now(),
                    str(author or '')[:120],
                    str(step or '')[:80] or None,
                ),
            )
            conn.commit()
            tid = cur.lastrowid
        return self._require(tid)

    def update(self, tid: str | int, data, author: str = '') -> dict:
        cur = self.get(tid)
        if not cur:
            raise LookupError('Дело не найдено')
        x = self._clean(data, cur)
        new = dict(cur, **x)
        if 'state' in x and x['state'] != cur['state']:
            new['doneAt'] = Clock.now() if x['state'] != 'open' else None
        if not new.get('title'):
            new['title'] = dict(self.KINDS)[new['kind']]
        self.store.write(
            'UPDATE crm_tasks SET kind=?, due=?, time=?, title=?, note=?, state=?, done_at=? WHERE id=?',
            (
                new['kind'],
                new['due'],
                new['time'] or '',
                new['title'],
                new['note'] or '',
                new['state'],
                new['doneAt'],
                int(tid),
            ),
        )
        exec_step = new.get('step') and not str(new['step']).startswith(
            self.AUTO_STEP
        )  # дела «сами» — не точки исполнения
        if exec_step and new['deal'] and x.get('state') == 'done' and cur['state'] != 'done':
            from crm_exec import ExecBook  # дело точки исполнения сделано — точка отмечена

            ExecBook(self.store).mark(
                new['deal'], new['step'], date.today().isoformat(), author or 'по сделанному делу'
            )
        return self._require(tid)

    def move_deal(self, did, manager_id) -> None:
        """Ответственный по сделке сменился — незакрытые дела сделки переходят к нему."""
        self.store.write("UPDATE crm_tasks SET manager_id=? WHERE deal_id=? AND state='open'", (manager_id or '', did))


class CrmBoard:
    """Кабинет одним ответом: этапы, сделки (с КП и ближайшим делом), дела, менеджеры."""

    def __init__(self, store) -> None:
        self.store = store

    def managers(self) -> list[dict]:
        out = []
        for mid, doc in self.store.all('SELECT id, doc FROM managers ORDER BY name COLLATE NOCASE'):
            card = _obj(doc)
            if card.get('name') and not card.get('hidden'):
                out.append({'id': mid, 'name': str(card['name'])})
        return out

    def build(self, managers) -> dict:
        book, tasks = DealBook(self.store), TaskBook(self.store)
        book.adopt()
        deals = book.deals(managers)
        kps = book.kps([deal['id'] for deal in deals])
        task_list = tasks.list(managers)
        nxt = tasks.next_open([deal['id'] for deal in deals])
        from crm_exec import ExecPlan
        from deal_files import DealClosing, DealFiles

        clients = self.store.clients_get(cid for deal in deals if (cid := self._client_id(deal)))
        docs = DealFiles.of(self.store).kinds([deal['id'] for deal in deals])
        for deal in deals:
            deal['who'] = self._who(deal, clients)
            deal['kps'] = kps.get(deal['id'], [])
            deal['next'] = nxt.get(deal['id'])
            deal['execSum'] = ExecPlan(deal).summary()
            deal['docs'] = docs.get(deal['id'], [])
            deal['closingDue'] = DealClosing.shipped(deal) and not set(deal['docs']) & set(DealFiles.CLOSING)
            ExecPlan.strip(deal['kps'])
            for key in ('history', 'uf', 'exec'):
                deal.pop(key, None)
        return {
            'stages': Stages.all(self.store),
            'funnels': Funnels(self.store).all(),
            'deals': deals,
            'tasks': task_list,
            'kinds': [{'key': k, 'label': label} for k, label in TaskBook.KINDS],
            'odds': self._odds(),
            'today': date.today().isoformat(),
            'now': datetime.now().isoformat(timespec='minutes'),
        }

    def _odds(self) -> dict[str, float]:
        from crm_time import StageOdds  # crm_time подключает crm

        return StageOdds(self.store).odds()

    @staticmethod
    def _client_id(deal: dict) -> str:
        return deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')

    def _who(self, deal: dict, clients: dict) -> dict | None:
        """Кому звонить или писать по сделке: компания и первый контакт клиента из справочника (clients — {id: карточка})."""
        client = clients.get(self._client_id(deal))
        if not client:
            return None
        contact = next((row for row in client.get('contacts') or [] if isinstance(row, dict)), {})
        return {
            'company': str(client.get('name') or ''),
            **{key: str(contact.get(key) or '') for key in ClientPick.CONTACT},
        }

    def find(self, managers, query, limit: int = 8) -> list[dict]:
        """Сделки по словам (название, клиент, ИНН, номер) — единый поиск программы; сначала незакрытые и свежие."""
        words = [
            word for word in re.sub(r'\s+', ' ', str(query or '').lower().replace('ё', 'е')).strip().split(' ') if word
        ][:6]
        if not words:
            return []
        sql, args = f'SELECT {DealBook.COLS} FROM deals', []
        if managers is not None:
            sql += ' WHERE manager_id IN ({})'.format(','.join('?' * len(managers))) if managers else ' WHERE 0'
            args += list(managers)
        out = []
        for deal in (
            DealBook._out(row)
            for row in self.store.all(sql + " ORDER BY stage IN ('won', 'lost'), updated DESC", tuple(args))
        ):
            hay = (
                ' '.join(str(deal.get(k) or '') for k in ('title', 'client', 'inn', 'number')).lower().replace('ё', 'е')
            )
            if all(word in hay for word in words):
                out.append(
                    {
                        k: deal.get(k)
                        for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')
                    }
                )
                if len(out) >= limit:
                    break
        return out

    def pick(self, managers, inn, name) -> list:
        """Незакрытые сделки клиента (по ИНН или названию) — выбор сделки при сохранении КП."""
        sql, args = f"SELECT {DealBook.COLS} FROM deals WHERE stage NOT IN ('won', 'lost')", []
        if inn:
            sql, args = sql + ' AND inn=?', [inn]
        if managers is not None:
            sql += ' AND manager_id IN ({})'.format(','.join('?' * len(managers))) if managers else ' AND 0'
            args += list(managers)
        key = name.strip().lower()  # lower() базы не знает русских букв — название сравнивается здесь
        rows = [DealBook._out(row) for row in self.store.all(sql + ' ORDER BY updated DESC', tuple(args))]
        rows = [deal for deal in rows if inn or str(deal.get('client') or '').strip().lower() == key][:20]
        return [
            {
                k: deal.get(k)
                for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')
            }
            for deal in rows
        ]


class KpFollowUp:
    """КП, по которым с клиентом уже работают: у сделки КП есть открытое дело (например, «Обратная связь по КП № …») или
    дело сделано после отправки КП. Напоминание «отправлено — ответа нет?» по таким КП не нужно."""

    CHUNK = TaskBook.CHUNK
    DAY = 10  # ГГГГ-ММ-ДД в начале отметки времени

    def __init__(self, store) -> None:
        self.store = store

    def handled(self, tracks: dict[str, dict]) -> set[str]:
        """tracks — {КП: ход сделки по КП} → отправленные КП, у сделки которых дело запланировано или сделано после отправки."""
        sent = {
            kid: day.isoformat()
            for kid, track in tracks.items()
            if kid and track.get('status') == 'sent' and (day := Val.day(track.get('at')))
        }
        kids = list(sent)
        out: set[str] = set()
        for start in range(0, len(kids), self.CHUNK):
            part = kids[start : start + self.CHUNK]
            marks = ','.join('?' * len(part))
            rows = self.store.all(
                'SELECT l.kp_id, t.state, t.done_at FROM deal_kp l JOIN deals d ON d.id = l.deal_id '
                f"JOIN crm_tasks t ON t.deal_id = l.deal_id WHERE l.kp_id IN ({marks}) AND t.state IN ('open', 'done')",
                tuple(part),
            )
            for kid, state, done_at in rows:
                if state == 'open' or str(done_at or '')[: self.DAY] >= sent[kid]:
                    out.add(kid)
        return out


class DealLinks:
    """Сделка каждого КП журнала: номер, стадия и ближайшее открытое дело — одной выборкой на страницу журнала."""

    COLS = ', '.join(f'd.{col.strip()}' for col in DealBook.COLS.split(','))

    def __init__(self, store) -> None:
        self.store = store

    def for_kps(self, kids: list[str]) -> dict[str, dict]:
        """{номер КП: {id, number, stage, closed, task: {title, due, time}}} — только КП, привязанные к сделке."""
        kids = [str(kid) for kid in kids if kid]
        if not kids:
            return {}
        marks = ','.join('?' * len(kids))
        rows = self.store.all(
            f'SELECT l.kp_id, {self.COLS} FROM deal_kp l JOIN deals d ON d.id = l.deal_id WHERE l.kp_id IN ({marks})',
            tuple(kids),
        )
        deals = {row[0]: DealBook._out(row[1:]) for row in rows}
        tasks = self._next_tasks({deal['id'] for deal in deals.values()})
        funnels = Funnels(self.store)
        return {kid: self._link(deal, funnels, tasks.get(deal['id'])) for kid, deal in deals.items()}

    def _next_tasks(self, ids: set) -> dict[str, dict]:
        if not ids:
            return {}
        marks = ','.join('?' * len(ids))
        found: dict[str, dict] = {}
        for did, title, due, clock in self.store.all(
            f"SELECT deal_id, title, due, time FROM crm_tasks WHERE state='open' AND deal_id IN ({marks}) "
            'ORDER BY due, time',
            tuple(ids),
        ):
            found.setdefault(did, {'title': title or '', 'due': due or '', 'time': clock or ''})
        return found

    @staticmethod
    def _link(deal: dict, funnels: Funnels, task: dict | None) -> dict:
        closed = deal['stage'] in ('won', 'lost')
        label = funnels.label(deal['funnel'], deal.get('fstage') or deal['stage'])
        return {
            'id': deal['id'],
            'number': deal.get('number') or '',
            'stage': label,
            'closed': deal['stage'] if closed else '',
            'task': None if closed else task,
        }
