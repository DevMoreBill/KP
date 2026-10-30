"""Адреса справочников: адреса и расстояния, контрагенты и клиенты, карточка клиента и предприятия, менеджеры, поставщики и ТН ВЭД, наши реквизиты и шаблоны договора."""

import json
from typing import Any

import admin
import admin_access
import admin_journal
import catalog_admin
from client_contacts import ClientContacts
from clock import Clock
from config import BadRequest, safe_id, store
from inn import Inn
from our_docs import DocTemplates, OurRequisites
from web_base import Controller, counterparties, route


class GeoController(Controller):
    PAIR = 2

    @route(r'/api/geo/(.*)', 'GET')
    def geo(self, act) -> Any:
        import geo

        query = self.query
        try:
            if act == 'suggest':
                return self.send_json(geo.suggest(store(), query.get('q', '')))
            if act == 'locate':
                return self.send_json(geo.locate(store(), query.get('q', '')))
            if act == 'reverse':
                return self.send_json(geo.reverse(store(), query.get('lat'), query.get('lon')))
            if act == 'route':
                src, dst = (query.get('a') or '').split(','), (query.get('b') or '').split(',')
                if len(src) != self.PAIR or len(dst) != self.PAIR:
                    raise ValueError('Нужны две точки')
                return self.send_json(geo.RoadRoute.distance_km(store(), src, dst))
            if act == 'unshort':
                return self.send_json({'url': geo.unshort(query.get('u', ''))})
        except Exception as exc:
            return self.send_json({'error': self.no_paths(exc)[:300] or exc.__class__.__name__})
        return self.text(404, 'Нет такого запроса')


class PartiesController(Controller):
    @route(r'/api/party')
    def party(self) -> Any:
        return self.send_json(counterparties().lookup(self.query.get('inn', '')))

    @route(
        r'/api/check/quota'
    )  # сколько проверок Checko (и резерва OFData) осталось сегодня на весь отдел, сколько в очереди
    def quota(self) -> None:
        return self.send_json(counterparties().quota())

    @route(r'/api/check')
    def check(self) -> Any:
        from counterparty import CheckMode

        return self.send_json(
            counterparties().check(
                self.query.get('inn', ''),
                CheckMode.FRESH if self.query.get('force') == '1' else CheckMode.CACHED,
                author=admin.actor(self.handler)[1],
            )
        )

    @route(r'/api/integrations/export', 'GET')  # резервная копия ключей (только администратор — см. admin.guard)
    def keys_export(self) -> Any:
        return self.send_json(
            {
                'kind': 'kp-keys',
                'v': 1,
                'at': Clock.now(),
                'keys': counterparties().keys(),
            }
        )

    @route(r'/api/integrations')
    def keys(self) -> Any:
        if self.method == 'PUT':
            self.json_body()
            with self.user_input():
                saved = counterparties().save_keys(self.body())
            return self.send_json(saved)
        pub = counterparties().keys_public()
        if admin.AdminSessions.of(self.handler) is None:  # менеджеру — «задан / не задан» и лимиты, без маски ключа
            pub = {k: v for k, v in pub.items() if not k.endswith('Mask')}
        return self.send_json(pub)

    @route(r'/api/clients', 'GET')
    def clients(self) -> Any:
        # справочник не грузится целиком: последние использованные или найденные по названию / ИНН / адресу
        query = self.query
        try:
            limit, offset = (
                max(1, min(int(query.get('limit') or 50), 500)),
                max(0, min(int(query.get('offset') or 0), 10**9)),
            )
        except ValueError:
            limit, offset = 50, 0
        res = store().clients_search(query.get('q', ''), limit, offset)
        res['all'] = store().clients_count() if not query.get('q') else None
        return self.send_json(res)

    @route(r'/api/clients/([^/]+)', ('GET', 'PUT'))
    def client(self, cid) -> Any:
        cid = safe_id(cid)
        if self.method == 'GET':
            client = store().client_get_rev(cid)
            return self.send_json(client) if client else self.text(404, 'Клиент не найден')
        self.json_body()  # не объект JSON — 400
        return self.send_json(
            counterparties().save_client(cid, self.body(), admin.actor(self.handler)[1], self.base_rev())
        )


class ManagersController(Controller):
    @route(r'/api/managers', 'GET')
    def managers(self) -> Any:
        return self.send_cached('mgr-' + store().data_rev('managers'), lambda: store().managers_list_rev())

    @route(r'/api/managers/([^/]+)', 'PUT')
    def manager(self, mid: str) -> Any:
        mid, data = safe_id(mid), self.json_body()
        # при входе по паролю менеджер меняет только свою карточку (контакты в его КП); остальные — администратор
        if admin_access.login_on(self.handler) and (getattr(self.handler, '_kp_user', None) or {}).get('id') != mid:
            return self.text(403, 'Карточку другого менеджера меняет администратор')
        for k in ('name', 'position', 'phone', 'ext', 'mobile', 'email'):
            if k in data and not isinstance(data[k], str):
                data[k] = '' if data[k] is None else str(data[k])
        try:
            return self.send_json(
                store().manager_put(
                    mid, json.dumps(data, ensure_ascii=False), admin.actor(self.handler)[1], self.base_rev()
                )
            )
        except ValueError as exc:  # дубль другого менеджера (ФИО, e-mail, мобильный, добавочный)
            return self.text(422, str(exc))


class DealController(Controller):
    @route(r'/api/suppliers', 'GET')
    def suppliers(self) -> Any:
        return self.send_cached('sup-' + store().data_rev('suppliers'), lambda: store().suppliers_list())

    @route(r'/api/suppliers/([A-Za-z0-9_-]{1,64})', 'PUT')
    def supplier(self, sid) -> Any:
        if not catalog_admin.power(
            self.handler, 'catSelfMod', 'PUT'
        ):  # справочник поставщиков — администратор и право «Без модерации»
            return self.text(403, 'Справочник поставщиков меняет администратор или менеджер с правом «Без модерации»')
        data = self.json_body()
        with self.user_input():
            saved = store().supplier_put(sid, data, admin.actor(self.handler)[1], self.base_rev())
        return self.send_json(saved)

    @route(r'/api/customs', ('GET', 'PUT'))
    def customs(self) -> Any:
        if self.method == 'GET':
            return self.send_json(store().customs_all())
        data = self.json_body()
        with self.user_input():
            store().customs_put(
                data.get('key'),
                data.get('code'),
                data.get('duty'),
                data.get('note'),
                admin.actor(self.handler)[1],
                data.get('name'),
            )
        return self.send_json({'ok': True})


class ClientCardController(Controller):
    """Карточка клиента: реквизиты и контакты из справочника, все КП клиента (с правами журнала), итоги по статусам, заметки."""

    MAX_NOTES = 200

    def _client(self, cid, inn) -> dict | None:
        client = store().client_get_rev(safe_id(cid)) if cid else None
        if not client and inn:
            client = store().client_get_rev('inn' + inn)
        return client

    @route(r'/api/clientcard', 'GET')
    def card(self) -> Any:
        inn = Inn.key(self.query.get('inn'))
        name = (self.query.get('name') or '').strip()[:300]
        client = self._client(self.query.get('id') or '', inn)
        if client:
            inn = inn or Inn.digits(client.get('inn'))
            name = name or str(client.get('name') or '')
        if not inn and not name:
            raise BadRequest('Нужен ИНН или название клиента')
        res = admin_journal.KpJournal.page(self.handler, store(), {'q': inn or name, 'limit': 500})
        key = (
            (lambda rec: Inn.digits(rec.get('clientInn')) == inn)
            if inn
            else (lambda item: str(item.get('client') or '').strip().lower() == name.lower())
        )
        rows = [rec for rec in res['items'] if key(rec)]
        rows.sort(key=lambda rec: (rec.get('date') or '', rec.get('number') or ''), reverse=True)
        by_status: dict = {}
        total = 0
        people: dict = {}
        for rec in rows:
            status = admin_journal.KpJournal.status(rec)
            rub = admin.econ_rub(rec)[0] or 0
            group = by_status.setdefault(status, {'n': 0, 'sum': 0})
            group['n'] += 1
            group['sum'] += rub
            total += rub
            if rec.get('manager'):
                people[rec['manager']] = people.get(rec['manager'], 0) + 1
        return self.send_json(
            {
                'client': client,
                'inn': inn,
                'name': name,
                'kps': rows,
                'by': by_status,
                'total': total,
                'managers': sorted(people, key=lambda k: -people[k]),
                'notes': (client or {}).get('notes') or [],
            }
        )

    @route(
        r'/api/clientcard/note', 'POST'
    )  # заметка о клиенте: {id, text} — добавить; {id, del: время заметки} — удалить свою
    def note(self) -> None:
        data = self.json_body()
        client = self._client(str(data.get('id') or '')[:64], '')
        if not client:
            return self.text(404, 'Клиент не найден в справочнике — сначала сохраните КП с этим клиентом')
        cid = safe_id(str(data.get('id')))
        uid, name = admin.actor(self.handler, admin=False)[0] or '', admin.actor(self.handler)[1] or ''
        notes = [note for note in (client.get('notes') or []) if isinstance(note, dict)]
        if data.get('del'):
            mine = admin.AdminSessions.of(self.handler) is not None
            keep = [note for note in notes if not (note.get('at') == data['del'] and (mine or note.get('uid') == uid))]
            if len(keep) == len(notes):
                return self.text(403, 'Удалить можно только свою заметку')
            notes = keep
        else:
            text = str(data.get('text') or '').strip()[:2000]
            if not text:
                raise BadRequest('Пустая заметка')
            notes.insert(0, {'at': Clock.now(), 'by': name, 'uid': uid, 'text': text})
            notes = notes[: self.MAX_NOTES]
        doc = {k: v for k, v in client.items() if k != '_rev'}
        doc['notes'] = notes
        store().client_put(cid, doc, name)
        return self.send_json({'ok': True, 'notes': notes})

    @route(r'/api/clientcard/contact', 'POST')  # {id, was?: прежнее ФИО | index?, contact: {name, post, phone, email}}
    def contact(self) -> Any:
        data = self.json_body()
        cid = safe_id(str(data.get('id') or '')[:64])
        try:
            rows = ClientContacts(store()).save(
                cid,
                {'was': str(data['was'])} if data.get('was') else data.get('index'),
                data.get('contact'),
                admin.actor(self.handler)[1],
            )
        except LookupError as exc:
            return self.text(404, str(exc))
        except ValueError as exc:
            raise BadRequest(str(exc)) from None
        return self.send_json({'ok': True, 'contacts': rows})

    @route(r'/api/clientcard/contact/remove', 'POST')  # {id, was: ФИО} — только в программе, в Битрикс24 не удаляется
    def contact_remove(self) -> Any:
        data = self.json_body()
        cid = safe_id(str(data.get('id') or '')[:64])
        try:
            rows, gone = ClientContacts(store()).remove(cid, str(data.get('was') or ''), admin.actor(self.handler)[1])
        except LookupError as exc:
            return self.text(404, str(exc))
        except ValueError as exc:
            raise BadRequest(str(exc)) from None
        admin.log(self.handler, store(), 'delete_contact', 'client', cid, before=gone)
        return self.send_json({'ok': True, 'contacts': rows})

    @route(r'/api/companycard/parse', 'POST')
    def company_parse(self) -> Any:
        """Карточка предприятия: JSON {text} или файл (?name=…: PDF, Word, Excel, TXT) → реквизиты и сверка с ФНС."""
        if self._too_big('Файл'):
            return None
        from company_card import CompanyCard

        card = CompanyCard(store())
        with self.user_input():
            if 'json' in str(self.handler.headers.get('Content-Type') or ''):
                text = str(self.json_body().get('text') or '')
            else:
                text = card.read(str(self.query.get('name') or ''), self.body())
            return self.send_json(card.parse(text))

    @route(r'/api/companycard/create', 'POST')
    def company_create(self) -> Any:
        """Новый клиент по проверенным реквизитам карточки (есть с этим ИНН — дописываются пустые поля)."""
        from company_card import CompanyCard

        with self.user_input():
            doc = CompanyCard(store()).create(self.json_body(), admin.actor(self.handler)[1])
        return self.send_json({'ok': True, 'client': doc})


class OurDocsController(Controller):
    """Счёт, спецификация, договор из КП: свои реквизиты и шаблоны Word (изменение — администратор, см. admin.guard)."""

    DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    @route(r'/api/requisites', ('GET', 'PUT'))
    def requisites(self) -> Any:
        own = OurRequisites(store())
        if self.method == 'PUT':
            with self.user_input():
                own.save(self.json_body())
        return self.send_json({**own.list(), 'templates': DocTemplates(store()).info()})

    @route(r'/api/doctpl/(contract|spec)', ('GET', 'PUT'))
    def template(self, kind: str) -> Any:
        tpl = DocTemplates(store())
        if self.method == 'PUT':
            with self.user_input():
                tpl.put(kind, self.body())
            return self.send_json({'ok': True, 'templates': tpl.info()})
        data = tpl.read(kind)
        if data is None:
            return self.not_found('Шаблон не загружен')
        return self.send(200, self.DOCX, data, self.attachment(f'{kind}.docx', f'{kind}.docx'))

    @route(r'/api/doctpl/(contract|spec)/remove', 'POST')
    def template_remove(self, kind: str) -> Any:
        tpl = DocTemplates(store())
        tpl.remove(kind)
        return self.send_json({'ok': True, 'templates': tpl.info()})
