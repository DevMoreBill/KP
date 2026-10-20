"""Кабинет как Битрикс24: структура портала (воронки, стадии, поля сделки, пользователи) и загрузка сделок в программу."""

import json
import re
import threading
from collections import Counter
from datetime import date, timedelta
from typing import Any

from bitrix import BitrixQueue, BitrixSync
from bitrix_clients import BitrixClients
from crm import DealBook, TaskBook
from crm_funnels import DealFields, Funnels, UfValue
from kp_track import Val
from server_log import ServerLog


class MirrorStructure:
    """Воронки и поля портала → «Настройки» программы; поля карточки — по заполненности за год."""

    SAMPLE = 300
    YEAR_DAYS = 365
    USERS_MAX = 5000
    SEM = {'S': Funnels.WON, 'F': Funnels.LOST, 'success': Funnels.WON, 'failure': Funnels.LOST}
    CHOICE = ('enumeration', 'crm_status')

    def __init__(self, store, opener=None) -> None:
        self.store = store
        self.sync = BitrixSync(store, opener)

    def load(self) -> dict:
        """Загрузить структуру и выбрать поля. → {funnels, fields, on}."""
        funnels = [self._funnel(cat) for cat in self.sync.categories()]
        Funnels(self.store).save_mirror(funnels)
        fields = DealFields(self.store)
        fields.save_defs(self._fields(), self._users())
        fill = {row['id']: self._fill(row['bx'], fields.all()) for row in funnels}
        fields.choose(fill)
        self.sync.log.add(
            f'Структура Битрикс24: воронок {len(funnels)}, полей сделки {len(fields.all())}, в карточке {len(fields.codes())}'
        )
        return {'funnels': len(funnels), 'fields': len(fields.all()), 'on': len(fields.codes())}

    def _funnel(self, cat: dict) -> dict:
        cid = str(cat['id'])
        entity = 'DEAL_STAGE' if cid == '0' else f'DEAL_STAGE_{cid}'
        rows = self.sync.api.list('crm.status.list', {'filter': {'ENTITY_ID': entity}, 'order': {'SORT': 'ASC'}})
        stages = [self._stage(row) for row in rows if row.get('STATUS_ID')]
        keys = {stage['key'] for stage in stages if not stage['sem']}
        mapped = self.sync.rules.stages(cid) if cid in self.sync.rules.pull_cats() else {}
        return {
            'id': f'{Funnels.PREFIX}{cid}',
            'bx': cid,
            'name': str(cat.get('name') or ('Общая' if cid == '0' else f'Воронка {cid}'))[: Funnels.NAME_MAX],
            'stages': stages,
            'track': {k: v for k, v in mapped.items() if k in Funnels.TRACK and v in keys} or self._guess(stages),
        }

    # ход КП → стадия воронки по названию стадии (администратор поправит в «Настройках»)
    GUESS = (
        ('sent', re.compile(r'ткп|(?<![а-яё])кп(?![а-яё])|^сч[её]т|коммерческ', re.IGNORECASE)),
        ('talks', re.compile(r'переговор|согласован|отбор|потребност', re.IGNORECASE)),
        ('contract', re.compile(r'договор', re.IGNORECASE)),
    )

    def _guess(self, stages: list[dict]) -> dict:
        opened = [stage['key'] for stage in stages if not stage['sem']]
        if not opened:
            return {}
        track, last = {'lead': opened[0]}, 0
        for key, pattern in self.GUESS:
            found = next(
                (
                    i
                    for i, stage in enumerate(stages)
                    if not stage['sem'] and i > last and pattern.search(stage['label'])
                ),
                None,
            )
            if found is not None:
                track[key], last = stages[found]['key'], found
        return track

    def _stage(self, row: dict) -> dict:
        extra: dict = row['EXTRA'] if isinstance(row.get('EXTRA'), dict) else {}
        sem = self.SEM.get(str(extra.get('SEMANTICS') or row.get('SEMANTICS') or ''), '')
        color = str(extra.get('COLOR') or row.get('COLOR') or '')
        return {
            'key': str(row['STATUS_ID']),
            'label': str(row.get('NAME') or row['STATUS_ID']),
            'sem': sem,
            'color': color if Funnels.COLOR_RE.match(color) else '',
        }

    def _users(self) -> dict:
        rows = self.sync.api.list('user.get', {}, limit=self.USERS_MAX)
        return {
            str(user.get('ID')): ' '.join(x for x in (user.get('LAST_NAME'), user.get('NAME')) if x)
            or str(user.get('EMAIL') or user.get('ID'))
            for user in rows
        }

    def _fields(self) -> list[dict]:
        raw = self.sync.api.call('crm.deal.fields') or {}
        statuses: dict[str, list] = {}
        out = []
        for code, field in raw.items() if isinstance(raw, dict) else []:
            if not code.startswith('UF_') or not isinstance(field, dict):
                continue
            title = str(field.get('formLabel') or field.get('listLabel') or field.get('title') or code)
            row = {
                'code': code,
                'title': title,
                'label': DealFields.label(title),
                'type': str(field.get('type') or 'string'),
                'multiple': bool(field.get('isMultiple')),
                'on': [],
            }
            items = self._items(field, statuses)
            if items is not None:
                row['items'] = items
            out.append(row)
        return out

    def _items(self, field: dict, statuses: dict) -> list | None:
        if field.get('type') == 'enumeration':
            return [
                {'id': str(item.get('ID')), 'value': str(item.get('VALUE') or '')} for item in field.get('items') or []
            ]
        if field.get('type') != 'crm_status':
            return None
        entity = str((field.get('settings') or {}).get('ENTITY_TYPE') or '')
        if entity and entity not in statuses:
            rows = self.sync.api.list('crm.status.list', {'filter': {'ENTITY_ID': entity}, 'order': {'SORT': 'ASC'}})
            statuses[entity] = [{'id': str(row.get('STATUS_ID')), 'value': str(row.get('NAME') or '')} for row in rows]
        return statuses.get(entity, [])

    def _fill(self, cat: str, fields: list[dict]) -> dict:
        """Доля сделок воронки за год, где поле заполнено: {код: доля}."""
        since = (date.today() - timedelta(days=self.YEAR_DAYS)).isoformat() + 'T00:00:00'
        codes = [field['code'] for field in fields]
        rows = self.sync.api.list(
            'crm.deal.list',
            {
                'order': {'DATE_MODIFY': 'DESC'},
                'filter': {'CATEGORY_ID': int(cat), '>=DATE_MODIFY': since},
                'select': ['ID', *codes],
            },
            limit=self.SAMPLE,
        )
        if not rows:
            return {}
        count: Counter = Counter()
        for row in rows:
            for field in fields:
                if self._filled(UfValue.norm(field, row.get(field['code']))):
                    count[field['code']] += 1
        return {code: hits / len(rows) for code, hits in count.items()}

    @staticmethod
    def _filled(value: Any) -> bool:
        return bool(value) and value != '0'


class MirrorImport:
    """Сделки повторённых воронок → программа: открытые и закрытые за 2 года, их открытые дела (в фоне, с ходом)."""

    KEY = 'crm.mirrorJob'
    CLOSED_DAYS = 730
    LIMIT = 50000
    CHUNK = 50
    LOCK = threading.Lock()

    def __init__(self, store, opener=None) -> None:
        self.store = store
        self.sync = BitrixSync(store, opener)

    def status(self) -> dict:
        job = self.store.kv_get(self.KEY) or {}
        return job if isinstance(job, dict) else {}

    def _mark(self, **kw: Any) -> None:
        job = self.status()
        job.update(kw, at=Val.now())
        self.store.kv_set(self.KEY, job)

    def start(self) -> dict:
        """Запустить в фоне. ValueError — загрузка уже идёт или нет повторённых воронок."""
        if not self.sync.mirror.cats():
            raise ValueError('Сначала загрузите структуру Битрикс24 (воронки и поля)')
        if not self.LOCK.acquire(blocking=False):
            raise ValueError('Загрузка сделок уже идёт')
        self.store.kv_set(
            self.KEY, {'state': 'run', 'started': Val.now(), 'done': 0, 'created': 0, 'updated': 0, 'skipped': 0}
        )
        threading.Thread(target=self._thread, name='bitrix-mirror', daemon=True).start()
        return self.status()

    def _thread(self) -> None:
        try:
            self.run()
        except Exception as exc:
            ServerLog.failure('загрузка сделок Битрикс24', exc)
            self._mark(state='error', error=re.sub(r'https?://\S+', '***', str(exc))[:300])
        finally:
            self.LOCK.release()

    def run(self) -> dict:
        res = {'created': 0, 'updated': 0, 'skipped': 0, 'done': 0, 'tasks': 0}
        since = (date.today() - timedelta(days=self.CLOSED_DAYS)).isoformat() + 'T00:00:00'
        for cat in self.sync.mirror.cats():
            for flt in ({'CLOSED': 'N'}, {'CLOSED': 'Y', '>=DATE_MODIFY': since}):
                rows = self.sync.api.list(
                    'crm.deal.list',
                    {
                        'filter': {'CATEGORY_ID': int(cat), **flt},
                        'select': self.sync.mirror.select(),
                        'order': {'ID': 'ASC'},
                    },
                    limit=self.LIMIT,
                )
                for start in range(0, len(rows), self.CHUNK):
                    self._chunk(rows[start : start + self.CHUNK], res)
                    self._mark(state='run', **res)
        res['tasks'] = self._tasks()
        self._mark(state='done', **res)
        self.sync.log.add(
            'Загрузка сделок Битрикс24: новых {created}, обновлено {updated}, пропущено {skipped}, дел {tasks}'.format(
                **res
            )
        )
        return res

    def _chunk(self, rows: list, res: dict) -> None:
        companies = self._companies([row.get('COMPANY_ID') for row in rows])
        BitrixQueue._quiet.on = True
        try:
            for bx_deal in rows:
                res['done'] += 1
                res[self._one(bx_deal, companies.get(str(bx_deal.get('COMPANY_ID') or ''), {}))] += 1
        finally:
            BitrixQueue._quiet.on = False

    def _one(self, bx_deal: dict, company: dict) -> str:
        sync = self.sync
        did = sync.links.local('deal', bx_deal.get('ID'))
        if did:
            deal = DealBook(self.store).get(did)
            if not deal:
                return 'skipped'
            body: dict = {}
            sync.mirror.stage_back(deal, str(bx_deal.get('STAGE_ID') or ''), bx_deal, body)
            if body:
                DealBook(self.store).update(did, body, sync.WHO)
            DealBook(self.store).put_uf(did, sync.mirror.uf_of(bx_deal), sync.WHO)
            return 'updated'
        mid = sync._who(bx_deal)
        if mid is None:
            return 'skipped'
        sync._import_deal(bx_deal, mid, company)
        return 'created'

    def _companies(self, ids: list) -> dict:
        """Компании пачкой: {id: {company, name, inn, clientId | pick}} — со слиянием с базой клиентов."""
        return BitrixClients(self.sync).bulk(ids)

    def _tasks(self) -> int:
        """Открытые дела загруженных сделок (по связям сделок)."""
        sync = self.sync
        if not sync.rules.can('task', 'in'):
            return 0
        ids = [bx_id for (bx_id,) in self.store.all("SELECT bx_id FROM bx_link WHERE kind='deal'")]
        tasks, rules, count = TaskBook(self.store), sync.rules.tasks(), 0
        for start in range(0, len(ids), self.CHUNK):
            rows = sync.api.list(
                'crm.activity.list',
                {
                    'filter': {'OWNER_TYPE_ID': 2, 'COMPLETED': 'N', 'OWNER_ID': ids[start : start + self.CHUNK]},
                    'select': [
                        'ID',
                        'OWNER_ID',
                        'SUBJECT',
                        'DEADLINE',
                        'COMPLETED',
                        'TYPE_ID',
                        'RESPONSIBLE_ID',
                        'DESCRIPTION',
                    ],
                },
                limit=self.LIMIT,
            )
            for activity in rows:
                count += sync._task_in(activity, tasks, rules)
        return count


class MirrorConvert:
    """Сделки своей воронки программы, связанные с Битриксом, — в повторённые воронки (стадия — как в Битриксе)."""

    def __init__(self, store) -> None:
        self.store = store

    def _todo(self) -> list[tuple[str, str, str]]:
        funnels, out = Funnels(self.store), []
        for did, sent in self.store.all(
            "SELECT l.local_id, l.sent FROM bx_link l JOIN deals d ON d.id = l.local_id WHERE l.kind='deal' AND d.funnel=?",
            (Funnels.MAIN,),
        ):
            agreed = self._obj(sent)
            fid = funnels.of_bx(str(agreed.get('cat') or '0'))
            if fid:
                stage = str(agreed.get('stage') or '')
                out.append((did, fid, stage if funnels.resolve(fid, stage) else funnels.first(fid)))
        return out

    @staticmethod
    def _obj(text: Any) -> dict:
        try:
            data = json.loads(text) if text else {}
        except (TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def count(self) -> int:
        return len(self._todo())

    def run(self, author: str) -> int:
        book, done = DealBook(self.store), 0
        BitrixQueue._quiet.on = True
        try:
            for did, fid, stage in self._todo():
                book.update(did, {'funnel': fid, 'stage': stage}, author)
                done += 1
        finally:
            BitrixQueue._quiet.on = False
        return done


class MirrorDesk:
    """«Настройки → Битрикс24 → Как в Битрикс24» (/api/admin/bitrix/mirror…): только администратор, изменения — с CSRF."""

    def __init__(self, handler, store, log_fn, opener=None) -> None:
        self.handler, self.store, self.log_fn, self.opener = handler, store, log_fn, opener

    def view(self) -> dict:
        funnels = Funnels(self.store)
        conf = funnels.conf()
        return {
            'funnels': funnels.all(),
            'fields': DealFields(self.store).all(),
            'newDeals': conf.get('newDeals') or Funnels.MAIN,
            'byManager': conf.get('byManager') or {},
            'mainName': conf.get('mainName') or Funnels.MAIN_NAME,
            'loaded': conf.get('at') or '',
            'job': MirrorImport(self.store).status(),
            'convert': MirrorConvert(self.store).count(),
            'managers': BitrixSync(self.store)._managers(),
        }

    def route(self, method: str, sub: str, author: str) -> None:
        from bitrix import BitrixConf, BitrixDesk, BitrixError

        desk = BitrixDesk(self.handler, self.store, self.log_fn, self.opener)
        actions = {
            'bitrix/mirror/structure': lambda: MirrorStructure(self.store, self.opener).load(),
            'bitrix/mirror/import': lambda: MirrorImport(self.store, self.opener).start(),
            'bitrix/mirror/options': lambda: self._options(desk.body()),
            'bitrix/mirror/convert': lambda: {'moved': MirrorConvert(self.store).run(author)},
        }
        if sub == 'bitrix/mirror' and method == 'GET':
            return desk.send(self.view())
        action = actions.get(sub)
        if action is None or method != 'POST':
            return desk.text(404, 'Нет такого действия')
        if sub != 'bitrix/mirror/options' and not BitrixConf(self.store).enabled():
            return desk.text(400, 'Сначала включите связь с Битрикс24')
        try:
            res = action()
        except ValueError as exc:
            return desk.text(400, str(exc))
        except BitrixError as exc:
            return desk.text(422, str(exc))
        self.log_fn('edit_settings', 'settings', 'bitrix', None, {'mirror': sub.rsplit('/', 1)[-1]})
        return desk.send(dict(self.view(), result=res))

    def _options(self, data: dict) -> dict:
        funnels = Funnels(self.store)
        funnels.options({k: data[k] for k in ('funnels', 'newDeals', 'byManager', 'mainName') if k in data})
        if 'fields' in data:
            DealFields(self.store).options(data['fields'], [row['id'] for row in funnels.all()])
        return {'saved': True}
