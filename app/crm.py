# -*- coding: utf-8 -*-
"""Кабинет менеджера: сделки, дела, воронка отдела.

• Сделка — клиент и его задача (объект, закупка): все КП по ней, сумма, этап, ожидаемая дата, заметка, дела, история.
  Таблицы deals (описание — JSON в doc), deal_kp (КП → сделка), crm_tasks (миграция «2027-10-crm», app/storage.py).
• Stages — этапы воронки: «Настройки → Списки и тексты → Этапы сделки» (список crm.stages: код, название, порядок);
  «Выиграно» и «Проиграно» есть всегда и стоят в конце.
• DealBook(store) — сделки: создание и правка (номер правки rev, заголовок X-KP-Rev → 409), привязка КП, автосвязь при
  сохранении КП (on_kp), этап — вперёд по ходу сделки КП (refresh), КП без сделки — в сделки (adopt: миграция, старые и
  восстановленные КП). Сделки не удаляются: закрываются этапом «Выиграно» / «Проиграно».
• TaskBook(store) — дела: звонок, встреча, письмо, задача; выполнить, перенести, отменить (не удаляются).
• CrmBoard — всё для кабинета одним ответом: этапы, сделки с КП и ближайшим делом, дела, менеджеры.
"""
import json
import re
from datetime import date, datetime, timedelta

from kp_track import Val


def _obj(text):
    try:
        d = json.loads(text) if text else {}
    except (TypeError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


class Stages:
    """Этапы воронки: [{key, label, closed}] — свои у администратора или встроенные."""
    LIST = 'crm.stages'
    BASE = (('lead', 'Запрос'), ('sent', 'КП отправлено'), ('talks', 'Переговоры'), ('contract', 'Договор и оплата'), ('delivery', 'Поставка'))
    CLOSED = (('won', 'Выиграно'), ('lost', 'Проиграно'))
    # статус КП (ход сделки) → этап сделки, до которого она продвигается сама
    BY_TRACK = {'new': 'lead', 'sent': 'sent', 'work': 'talks', 'won': 'contract'}
    ID = re.compile(r'^[a-z0-9_-]{1,30}$')

    @classmethod
    def all(cls, store):
        from lists import ListStore
        rows = ListStore(store).all().get(cls.LIST)
        names, order = {}, []
        for r in rows if isinstance(rows, list) else []:
            k = str(r.get('id') or '').strip().lower() if isinstance(r, dict) else ''
            if cls.ID.match(k) and k not in names:
                names[k] = str(r.get('name') or '').strip()[:60]
                order.append(k)
        closed = dict(cls.CLOSED)
        if not [k for k in order if k not in closed]:
            order = [k for k, _ in cls.BASE]
        base = dict(cls.BASE)
        out = [{'key': k, 'label': names.get(k) or base.get(k) or k} for k in order if k not in closed]
        return out + [{'key': k, 'label': names.get(k) or lb, 'closed': True} for k, lb in cls.CLOSED]

    @classmethod
    def keys(cls, store):
        return [s['key'] for s in cls.all(store)]


class DealBook:
    """Сделки одного хранилища."""
    HISTORY_MAX = 60
    GROUP_DAYS = 30        # КП одного клиента у одного менеджера с промежутком до 30 дней — одна сделка (adopt)
    WON_DAYS = 60          # выигранное КП старше — сделка «Выиграно» (adopt), моложе — «Договор и оплата»
    STALE_DAYS = 180       # незакрытые КП без движения дольше — сделка «Проиграно» с понятной причиной (adopt)
    STALE_REASON = 'Нет движения больше 180 дней (закрыта при переходе на сделки)'
    COLS = 'id, doc, manager_id, stage, updated, rev'

    def __init__(self, store):
        self.store = store

    # ---------- чтение
    @staticmethod
    def _out(r):
        d = _obj(r[1])
        d.update(id=r[0], managerId=r[2] or '', stage=r[3] or 'lead', updated=r[4] or '', rev=r[5] or 0)
        return d

    def get(self, did):
        r = self.store.one('SELECT %s FROM deals WHERE id=?' % self.COLS, (str(did or '')[:40],))
        return self._out(r) if r else None

    def deals(self, managers=None):
        """Сделки менеджеров (None — все): незакрытые и закрытые за последние 120 дней."""
        since = (date.today() - timedelta(days=120)).isoformat()
        sql = 'SELECT %s FROM deals WHERE (stage NOT IN (\'won\', \'lost\') OR updated >= ?)' % self.COLS
        args = [since]
        if managers is not None:
            sql += ' AND manager_id IN (%s)' % ','.join('?' * len(managers)) if managers else ' AND 0'
            args += list(managers)
        return [self._out(r) for r in self.store.all(sql + ' ORDER BY updated DESC', tuple(args))]

    def kps(self, ids):
        """{id сделки: [КП кратко]} — КП из журнала (КП в корзине не показываются)."""
        out = {i: [] for i in ids}
        if not ids:
            return out
        from admin import econ_rub
        for i in range(0, len(ids), 500):
            part = ids[i:i + 500]
            for did, kid, meta, track in self.store.all(
                    'SELECT l.deal_id, k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id '
                    'WHERE k.meta IS NOT NULL AND l.deal_id IN (%s)' % ','.join('?' * len(part)), tuple(part)):
                out[did].append(self._kp(kid, _obj(meta), _obj(track), econ_rub))
        for L in out.values():
            L.sort(key=lambda x: (x['savedAt'] or x['date'] or '', x['id']), reverse=True)
        return out

    @staticmethod
    def _kp(kid, m, tr, econ_rub):
        rub = econ_rub(m)[0]
        e = m.get('econ') if isinstance(m.get('econ'), dict) else {}
        plan = m.get('plan') if isinstance(m.get('plan'), dict) else None
        return {'id': kid, 'number': m.get('number') or kid, 'date': str(m.get('date') or '')[:10], 'savedAt': str(m.get('savedAt') or '')[:40],
                'sum': rub, 'sumCur': e.get('sum') if e.get('cur') not in (None, 'RUB') else None, 'cur': e.get('cur') or 'RUB',
                'status': tr.get('status') or 'new', 'reason': tr.get('reason') or '', 'validUntil': str(m.get('validUntil') or '')[:10],
                'items': (m.get('items') or [])[:2] if isinstance(m.get('items'), list) else [], 'positions': m.get('positions') or 0,
                'client': m.get('client') or '', 'plan': plan, 'followUp': tr.get('followUp') if isinstance(tr.get('followUp'), dict) else None}

    # ---------- запись
    @staticmethod
    def _next_number(c):
        c.execute("INSERT INTO kv (key, value) VALUES ('crm.seq', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
        return int(c.execute("SELECT value FROM kv WHERE key='crm.seq'").fetchone()[0])

    def _log(self, d, by, **what):
        h = d.get('history') if isinstance(d.get('history'), list) else []
        h.append(dict(what, at=Val.now(), by=by))
        d['history'] = h[-self.HISTORY_MAX:]

    def _save(self, c, did, d, by, base_rev=None, when=None):
        """Записать сделку (в открытой транзакции c). → номер правки."""
        rev = self.store._next_rev(c, 'deals', did, base_rev)
        doc = {k: v for k, v in d.items() if k not in ('id', 'managerId', 'stage', 'updated', 'rev', 'kps', 'next', 'tasks')}
        c.execute('INSERT OR REPLACE INTO deals (id, doc, manager_id, stage, client, inn, updated, rev, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
                  (did, json.dumps(doc, ensure_ascii=False), d.get('managerId') or '', d.get('stage') or 'lead', str(d.get('client') or '')[:300],
                   re.sub(r'\D', '', str(d.get('clientInn') or ''))[:12], when or Val.now(), rev, str(by or '')[:120]))
        return rev

    def _new(self, c, d, by, when=None):
        n = self._next_number(c)
        did = 'd%d' % n
        d = dict(d, number=n, created=when or Val.now(), createdBy=by)
        d.setdefault('stageAt', d['created'])
        self._save(c, did, d, by, when=when)
        return did

    def create(self, d, manager_id, manager, by):
        """Новая сделка вручную (без КП). ValueError — с понятным текстом."""
        x = self._clean(d, {}, Stages.keys(self.store))
        if not (x.get('title') or x.get('client')):
            raise ValueError('Укажите клиента или название сделки')
        x.setdefault('title', x.get('client'))
        x.update(managerId=manager_id or '', manager=manager or '', stage=x.get('stage') or 'lead')
        if not x.get('expected'):
            x['expected'] = (date.today() + timedelta(days=30)).isoformat()
        self._log(x, by, what='create')
        with self.store.lock:
            c = self.store.conn()
            did = self._new(c, x, by)
            c.commit()
        return self.get(did)

    def _clean(self, d, cur, keys):
        """Поля сделки из запроса → изменения. ValueError — с понятным текстом."""
        if not isinstance(d, dict):
            raise ValueError('Нет данных сделки')
        out = {}
        for k, n in (('title', 200), ('client', 300), ('note', 3000)):
            if k in d:
                out[k] = Val.text(d.get(k), n)
        if 'clientInn' in d:
            out['clientInn'] = re.sub(r'\D', '', str(d.get('clientInn') or ''))[:12]
        if 'clientId' in d:
            out['clientId'] = re.sub(r'[^A-Za-z0-9_-]', '', str(d.get('clientId') or ''))[:64]
        if 'expected' in d:
            v = d.get('expected')
            dt = Val.day(v) if v else None
            if v and not dt:
                raise ValueError('Ожидаемая дата — в формате ГГГГ-ММ-ДД')
            out['expected'] = dt.isoformat() if dt else ''
        if 'sum' in d:                        # ввод — в рублях, хранится в копейках; пусто — по последнему КП сделки
            v = d.get('sum')
            if v in (None, ''):
                out.update(sumOwn=False)
            else:
                try:
                    rub = float(str(v).replace(' ', '').replace(',', '.'))
                except ValueError:
                    raise ValueError('Сумма сделки — число в рублях')
                if not (0 <= rub < 1e12):
                    raise ValueError('Сумма сделки — от 0 до 999 млрд руб.')
                out.update(sum=int(round(rub * 100)), sumOwn=True)
        if 'stage' in d:
            st = str(d.get('stage') or '')
            if st not in keys:
                raise ValueError('Неизвестный этап сделки')
            out['stage'] = st
            if st == 'lost':
                reason = Val.text(d.get('lostReason') if 'lostReason' in d else cur.get('lostReason'), 200)
                if not reason:
                    raise ValueError('Укажите причину проигрыша')
                out['lostReason'] = reason
        return out

    def update(self, did, d, by, base_rev=None, manager=None):
        """Правка сделки: поля, этап (вручную), сумма (своя или по КП), ответственный (manager = (id, имя) — только
        тем, кому можно). → сделка. ValueError — с понятным текстом; Conflict — сделку успели изменить."""
        with self.store.lock:
            cur = self.get(did)
            if not cur:
                raise LookupError('Сделка не найдена')
            x = self._clean(d, cur, Stages.keys(self.store))
            c = self.store.conn()
            new = dict(cur, **x)
            if x.get('stage') and x['stage'] != cur['stage']:
                new.update(stageAt=Val.now(), lostAuto=False)
                if x['stage'] != 'lost':
                    new.pop('lostReason', None)
                self._log(new, by, what='stage', **{'from': cur['stage'], 'to': x['stage']})
            if manager and manager[0] != cur.get('managerId'):
                new.update(managerId=manager[0], manager=manager[1])
                self._log(new, by, what='manager', to=manager[1])
            changed = [k for k in ('title', 'client', 'expected', 'sum', 'note') if k in x and x[k] != cur.get(k)]
            if changed:
                self._log(new, by, what='edit', fields=changed)
            self._sum(c, new)
            self._save(c, did, new, by, base_rev)
            c.commit()
        return self.get(did)

    # ---------- КП и сделка
    def deal_of(self, kid):
        r = self.store.one('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,))
        return r[0] if r else None

    def link(self, did, kid, by):
        """КП — в сделку (из прежней сделки КП уходит). → прежняя сделка или None."""
        with self.store.lock:
            c = self.store.conn()
            old = (c.execute('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,)).fetchone() or [None])[0]
            if old == did:
                return None
            c.execute('INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (kid, did, Val.now()))
            d = self.get(did)
            self._log(d, by, what='kp', kp=kid)
            self._sync(c, d, by)
            if old:
                o = self.get(old)
                if o:
                    self._log(o, by, what='kpOut', kp=kid)
                    self._sync(c, o, by)
            c.commit()
        return old

    def on_kp(self, kid, meta, by, want=None):
        """КП сохранено: в сделку want (если задана и есть; 'new' — в отдельную новую), в прежнюю или в новую по описанию КП.
        Сумма и этап сделки пересчитываются. → id сделки."""
        m = meta if isinstance(meta, dict) else _obj(meta)
        with self.store.lock:
            c = self.store.conn()
            cur = (c.execute('SELECT deal_id FROM deal_kp WHERE kp_id=?', (kid,)).fetchone() or [None])[0]
            if want == 'new' and cur:         # «Отдельная новая сделка» для КП, которое уже в сделке
                old = self.get(cur)
                did = self._from_kp(c, kid, m, _obj((c.execute('SELECT track FROM kp WHERE id=?', (kid,)).fetchone() or [''])[0]), by)
                if old:
                    self._log(old, by, what='kpOut', kp=kid)
                    self._sync(c, old, by)
                self._sync(c, self.get(did), by)
                c.commit()
                return did
            if want and want != 'new' and want != cur and self.get(want):
                self.link(want, kid, by)
                return want
            did = cur or self._from_kp(c, kid, m, _obj((c.execute('SELECT track FROM kp WHERE id=?', (kid,)).fetchone() or [''])[0]), by)
            d = self.get(did)
            if d:
                if not d.get('client') and m.get('client'):
                    d.update(client=str(m['client'])[:300], clientInn=re.sub(r'\D', '', str(m.get('clientInn') or ''))[:12])
                self._sync(c, d, by)
            c.commit()
        return did

    def _from_kp(self, c, kid, m, tr, by, when=None, manager=None):
        items = m.get('items') if isinstance(m.get('items'), list) else []
        tnd = m.get('tender') if isinstance(m.get('tender'), dict) else {}
        title = ('Закупка № %s' % tnd['number']) if tnd.get('number') else (str(items[0]) if items else 'КП № %s' % (m.get('number') or kid))
        mid, mname = manager or (str(m.get('authorId') or m.get('managerId') or ''), str(m.get('manager') or ''))
        exp = Val.day(m.get('validUntil')) or ((Val.day(m.get('date')) or date.today()) + timedelta(days=30))
        d = {'title': title[:200], 'client': str(m.get('client') or '')[:300], 'clientInn': re.sub(r'\D', '', str(m.get('clientInn') or ''))[:12],
             'managerId': mid[:64], 'manager': mname[:120], 'stage': Stages.BY_TRACK.get(tr.get('status') or 'new', 'lead'),
             'expected': exp.isoformat(), 'auto': True}
        if d['stage'] not in Stages.keys(self.store):
            d['stage'] = Stages.keys(self.store)[0]
        self._log(d, by, what='create', kp=kid)
        did = self._new(c, d, by, when=when)
        c.execute('INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (kid, did, when or Val.now()))
        return did

    @classmethod
    def kp_moved(cls, store, kid, by):
        """КП ушло в корзину или вернулось из неё — сумма и этап его сделки заново (и в очередь Битрикс24). Сбой — не мешает
        удалению или восстановлению, только в журнал сервера."""
        try:
            did = cls(store).refresh(kid, by)
            if did:
                from bitrix import BitrixQueue
                BitrixQueue.touch(store, 'deal', did)
            return did
        except Exception as e:
            from server_log import ServerLog
            ServerLog.failure('сделка КП %s после корзины' % kid, e)
            return None

    def refresh(self, kid, by):
        """Ход сделки КП изменился — этап и сумма его сделки."""
        did = self.deal_of(kid)
        if not did:
            return None
        with self.store.lock:
            c = self.store.conn()
            d = self.get(did)
            if d:
                self._sync(c, d, by)
                c.commit()
        return did

    def _rows(self, c, did):
        from admin import econ_rub
        return [self._kp(k, _obj(m), _obj(t), econ_rub) for k, m, t in c.execute(
            'SELECT k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id WHERE l.deal_id=? AND k.meta IS NOT NULL', (did,)).fetchall()]

    def _sum(self, c, d, rows=None):
        """Сумма сделки — по последнему незакрытому проигрышем КП (своя сумма менеджера — как есть)."""
        if d.get('sumOwn'):
            return
        rows = self._rows(c, d['id']) if rows is None else rows
        live = [r for r in rows if r['status'] != 'lost'] or rows
        live.sort(key=lambda r: (r['savedAt'] or r['date'] or '', r['id']), reverse=True)
        d['sum'] = (live[0]['sum'] or 0) if live else (d.get('sum') or 0)

    def _sync(self, c, d, by, when=None):
        """Сумма по КП и этап вперёд по ходу сделки КП: отправлено → «КП отправлено», в работе → «Переговоры»,
        выиграно → «Договор и оплата»; все КП проиграны → «Проиграно» (вернётся, если КП снова в работе)."""
        rows = self._rows(c, d['id'])
        self._sum(c, d, rows)
        keys = [k for k in Stages.keys(self.store) if k not in ('won', 'lost')]
        st = d.get('stage') or 'lead'
        target = None
        if rows and all(r['status'] == 'lost' for r in rows):
            if st not in ('won', 'lost'):
                last = max(rows, key=lambda r: r['savedAt'] or r['date'] or '')
                target, d['lostReason'], d['lostAuto'] = 'lost', last['reason'] or 'КП проиграно', True
        else:
            best = [Stages.BY_TRACK.get(r['status']) for r in rows if r['status'] != 'lost']
            best = [k for k in best if k in keys]
            top = max(best, key=keys.index) if best else None
            if top and st == 'lost' and d.get('lostAuto'):
                target = top
            elif top and st in keys and keys.index(top) > keys.index(st):
                target = top
        if target and target != st:
            d.update(stage=target, stageAt=when or Val.now())
            if target != 'lost':
                d.pop('lostReason', None)
                d['lostAuto'] = False
            self._log(d, by, what='stage', auto=True, **{'from': st, 'to': target})
        self._save(c, d['id'], d, by, when=when)

    # ---------- КП без сделки
    def adopt(self):
        """КП журнала без сделки — в сделки (после перехода на сделки, восстановления и загрузки копии). → сколько КП."""
        if not self.store.one('SELECT 1 FROM kp k WHERE k.meta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deal_kp l WHERE l.kp_id = k.id) LIMIT 1'):
            return 0
        with self.store.lock:
            c = self.store.conn()
            n = self._adopt(c)
            c.commit()
        return n

    def _adopt(self, c):
        names = {}
        for mid, doc in c.execute('SELECT id, doc FROM managers').fetchall():
            nm = str(_obj(doc).get('name') or '').strip().lower()
            if nm:
                names.setdefault(nm, mid)
        rows = []
        for kid, meta, track in c.execute('SELECT k.id, k.meta, k.track FROM kp k WHERE k.meta IS NOT NULL AND '
                                          'NOT EXISTS (SELECT 1 FROM deal_kp l WHERE l.kp_id = k.id)').fetchall():
            m, tr = _obj(meta), _obj(track)
            day = Val.day(m.get('date')) or Val.day(m.get('savedAt')) or date.today()
            mid = str(m.get('authorId') or m.get('managerId') or names.get(str(m.get('manager') or '').strip().lower()) or '')
            who = mid or str(m.get('manager') or '').strip().lower()
            client = re.sub(r'\D', '', str(m.get('clientInn') or '')) or str(m.get('client') or '').strip().lower()
            rows.append((who, client, day, kid, m, tr, mid))
        rows.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
        groups, last = [], None
        for r in rows:
            g = groups[-1] if groups else None
            if g and last and r[0] == last[0] and r[1] and r[1] == last[1] and (r[2] - last[2]).days <= self.GROUP_DAYS:
                g.append(r)
            else:
                groups.append([r])
            last = r
        today = date.today()
        for g in groups:
            first, end = g[0], g[-1]
            when = first[2].isoformat() + 'T09:00:00'
            did = self._from_kp(c, first[3], first[4], first[5], 'переход на сделки', when=when,
                                manager=(first[6], str(first[4].get('manager') or '')))
            for r in g[1:]:
                c.execute('INSERT OR REPLACE INTO deal_kp (kp_id, deal_id, added) VALUES (?,?,?)', (r[3], did, when))
            d = self.get_c(c, did)
            stamp = end[2].isoformat() + 'T09:00:00'
            self._sync(c, d, 'переход на сделки', when=stamp)
            d = self.get_c(c, did)
            age = (today - end[2]).days
            st = d['stage']
            if st == 'contract' and age > self.WON_DAYS:
                d.update(stage='won', stageAt=stamp)
            elif st not in ('won', 'lost') and age > self.STALE_DAYS:
                d.update(stage='lost', stageAt=stamp, lostReason=self.STALE_REASON, lostAuto=False)
            if d['stage'] != st:
                self._save(c, did, d, 'переход на сделки', when=stamp)
        return len(rows)

    def flag(self, did, **kw):
        """Служебные отметки сделки (например, «новая из Битрикс24, ещё не открыта») — без новой правки и без истории;
        None — снять отметку."""
        with self.store.lock:
            r = self.store.one('SELECT doc FROM deals WHERE id=?', (did,))
            if not r:
                return
            d = _obj(r[0])
            for k, v in kw.items():
                if v is None:
                    d.pop(k, None)
                else:
                    d[k] = v
            self.store.write('UPDATE deals SET doc=? WHERE id=?', (json.dumps(d, ensure_ascii=False), did))

    def get_c(self, c, did):
        r = c.execute('SELECT %s FROM deals WHERE id=?' % self.COLS, (did,)).fetchone()
        return self._out(r) if r else None


class TaskBook:
    """Дела менеджера: звонок, встреча, письмо, задача — со сроком (дата и, если нужно, время), по сделке или сами по себе.
    Состояния: open — нужно сделать, done — сделано, cancel — отменено (дела не удаляются)."""
    KINDS = (('call', 'Звонок'), ('meet', 'Встреча'), ('mail', 'Письмо'), ('task', 'Задача'))
    STATES = ('open', 'done', 'cancel')
    TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
    COLS = 'id, deal_id, manager_id, kind, due, time, title, note, state, done_at, created, created_by'

    def __init__(self, store):
        self.store = store

    @classmethod
    def _out(cls, r):
        return dict(zip(('id', 'deal', 'managerId', 'kind', 'due', 'time', 'title', 'note', 'state', 'doneAt', 'created', 'by'), r))

    def get(self, tid):
        r = self.store.one('SELECT %s FROM crm_tasks WHERE id=?' % self.COLS, (int(tid),))
        return self._out(r) if r else None

    def list(self, managers=None, deal=None, days=14):
        """Незакрытые дела и закрытые за последние days дней: менеджеров (None — всех) или одной сделки (все её дела)."""
        if deal:
            rows = self.store.all('SELECT %s FROM crm_tasks WHERE deal_id=? ORDER BY due, time, id' % self.COLS, (deal,))
            return [self._out(r) for r in rows]
        since = (date.today() - timedelta(days=days)).isoformat()
        sql, args = "SELECT %s FROM crm_tasks WHERE (state = 'open' OR done_at >= ?)" % self.COLS, [since]
        if managers is not None:
            sql += ' AND manager_id IN (%s)' % ','.join('?' * len(managers)) if managers else ' AND 0'
            args += list(managers)
        return [self._out(r) for r in self.store.all(sql + ' ORDER BY due, time, id', tuple(args))]

    def _clean(self, d, cur):
        if not isinstance(d, dict):
            raise ValueError('Нет данных дела')
        x = {}
        if 'kind' in d or not cur:
            k = d.get('kind') or 'task'
            if k not in dict(self.KINDS):
                raise ValueError('Неизвестный вид дела')
            x['kind'] = k
        if 'due' in d or not cur:
            dt = Val.day(d.get('due'))
            if not dt:
                raise ValueError('Укажите дату дела')
            x['due'] = dt.isoformat()
        if 'time' in d:
            t = str(d.get('time') or '').strip()
            if t and not self.TIME.match(t):
                raise ValueError('Время — в формате ЧЧ:ММ')
            x['time'] = t
        for k, n in (('title', 200), ('note', 1000)):
            if k in d:
                x[k] = Val.text(d.get(k), n)
        if 'state' in d:
            if d.get('state') not in self.STATES:
                raise ValueError('Неизвестное состояние дела')
            x['state'] = d['state']
        return x

    def add(self, d, manager_id, by, deal=None):
        x = self._clean(d, None)
        title = x.get('title') or dict(self.KINDS)[x['kind']]
        with self.store.lock:
            c = self.store.conn()
            cur = c.execute('INSERT INTO crm_tasks (deal_id, manager_id, kind, due, time, title, note, state, created, created_by) '
                            "VALUES (?,?,?,?,?,?,?,'open',?,?)",
                            (deal or None, manager_id or '', x['kind'], x['due'], x.get('time') or '', title, x.get('note') or '', Val.now(), str(by or '')[:120]))
            c.commit()
            tid = cur.lastrowid
        return self.get(tid)

    def update(self, tid, d):
        cur = self.get(tid)
        if not cur:
            raise LookupError('Дело не найдено')
        x = self._clean(d, cur)
        new = dict(cur, **x)
        if 'state' in x and x['state'] != cur['state']:
            new['doneAt'] = Val.now() if x['state'] != 'open' else None
        if not new.get('title'):
            new['title'] = dict(self.KINDS)[new['kind']]
        self.store.write('UPDATE crm_tasks SET kind=?, due=?, time=?, title=?, note=?, state=?, done_at=? WHERE id=?',
                         (new['kind'], new['due'], new['time'] or '', new['title'], new['note'] or '', new['state'], new['doneAt'], int(tid)))
        return self.get(tid)

    def move_deal(self, did, manager_id):
        """Ответственный по сделке сменился — незакрытые дела сделки переходят к нему."""
        self.store.write("UPDATE crm_tasks SET manager_id=? WHERE deal_id=? AND state='open'", (manager_id or '', did))


class CrmBoard:
    """Кабинет одним ответом: этапы, сделки (с КП и ближайшим делом), дела, менеджеры."""

    def __init__(self, store):
        self.store = store

    def managers(self):
        out = []
        for mid, doc in self.store.all('SELECT id, doc FROM managers ORDER BY name COLLATE NOCASE'):
            d = _obj(doc)
            if d.get('name') and not d.get('hidden'):
                out.append({'id': mid, 'name': str(d['name'])})
        return out

    def build(self, managers):
        book, tasks = DealBook(self.store), TaskBook(self.store)
        book.adopt()
        deals = book.deals(managers)
        kp = book.kps([d['id'] for d in deals])
        T = tasks.list(managers)
        nxt = {}
        for t in T:
            if t['state'] == 'open' and t['deal'] and t['deal'] not in nxt:
                nxt[t['deal']] = t
        for d in deals:
            d['kps'] = kp.get(d['id'], [])
            d['next'] = nxt.get(d['id'])
            d.pop('history', None)
        return {'stages': Stages.all(self.store), 'deals': deals, 'tasks': T, 'kinds': [{'key': k, 'label': lb} for k, lb in TaskBook.KINDS],
                'today': date.today().isoformat(), 'now': datetime.now().isoformat(timespec='minutes')}

    def find(self, managers, q, limit=8):
        """Сделки по словам (название, клиент, ИНН, номер) — единый поиск программы; сначала незакрытые и свежие."""
        words = [w for w in re.sub(r'\s+', ' ', str(q or '').lower().replace('ё', 'е')).strip().split(' ') if w][:6]
        if not words:
            return []
        sql, args = 'SELECT %s FROM deals' % DealBook.COLS, []
        if managers is not None:
            sql += ' WHERE manager_id IN (%s)' % ','.join('?' * len(managers)) if managers else ' WHERE 0'
            args += list(managers)
        out = []
        for d in (DealBook._out(r) for r in self.store.all(sql + " ORDER BY stage IN ('won', 'lost'), updated DESC", tuple(args))):
            hay = ' '.join(str(d.get(k) or '') for k in ('title', 'client', 'inn', 'number')).lower().replace('ё', 'е')
            if all(w in hay for w in words):
                out.append({k: d.get(k) for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')})
                if len(out) >= limit:
                    break
        return out

    def pick(self, managers, inn, name):
        """Незакрытые сделки клиента (по ИНН или названию) — выбор сделки при сохранении КП."""
        sql, args = "SELECT %s FROM deals WHERE stage NOT IN ('won', 'lost')" % DealBook.COLS, []
        if inn:
            sql, args = sql + ' AND inn=?', [inn]
        if managers is not None:
            sql += ' AND manager_id IN (%s)' % ','.join('?' * len(managers)) if managers else ' AND 0'
            args += list(managers)
        key = name.strip().lower()           # lower() базы не знает русских букв — название сравнивается здесь
        rows = [DealBook._out(r) for r in self.store.all(sql + ' ORDER BY updated DESC', tuple(args))]
        rows = [d for d in rows if inn or str(d.get('client') or '').strip().lower() == key][:20]
        return [{k: d.get(k) for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')}
                for d in rows]
