"""Адреса кабинета и хода КП: сделки, дела, отчёты, оплаты; статус и экономика КП, письмо заказчику, напоминания, отчёт."""

import json
import os
import re
from datetime import date, datetime, timedelta
from typing import Any

import admin
import admin_access
import admin_journal
import defaults
import pdf_convert
from bitrix import BitrixConf, BitrixQueue, BitrixSync, EconXlsx
from bitrix_comms import BitrixComms, DealComms
from bitrix_my import MyCompanies
from config import BadRequest, safe_id, store
from crm import CrmBoard, DealBook, KpFollowUp, Stages, TaskBook
from crm_auto import AutoTasks
from crm_exec import ExecBook, ExecPlan, ExecTasks, Sums
from crm_funnels import DealFields, Funnels
from crm_money import PayCalendar, PayReminder
from deal_files import DealClosing, DealFiles
from deal_intake import DealIntake
from deal_rules import ClientByInn, DealRegs
from features import FeatureAccess, Viewer
from feedback import Feedback
from inn import Inn
from kp_files import KpFiles
from kp_track import DealTrack, Mailer, MailRate, MailTemplate, ReminderList
from server_log import ErrorText, ServerLog
from web_base import Controller, Forbidden, NotFound, counterparties, pdf_of, route


class TrackController(Controller):
    @staticmethod
    def _obj(text) -> dict:
        """Объект JSON из базы; пусто или испорчено — {}."""
        try:
            data = json.loads(text) if text else {}
        except (TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/track', 'PUT'
    )  # статус, причина, заметка, напоминание (права — admin.guard по /api/kp/<id>/)
    def track(self, kid: str) -> None:
        if not store().kp_get(kid, 'meta'):
            raise NotFound('Сначала сохраните КП')
        with self.user_input():
            track, changed = DealTrack(store()).update(kid, self.json_body(), admin.actor(self.handler)[1])
        if changed:
            admin.log(self.handler, store(), 'kp_status', 'kp', kid, None, changed)
            CrmController.safe(
                lambda: CrmController.bitrix_on(DealBook(store()).refresh(kid, admin.actor(self.handler)[1]))
            )
        return self.send_json({'ok': True, 'track': track})

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/econ', 'PUT'
    )  # Excel экономики сделки (собран в браузере автора) — для Битрикс24
    def econ(self, kid: str) -> None:
        meta = self._obj(store().kp_get(kid, 'meta'))
        if not meta:
            raise NotFound('Сначала сохраните КП')
        if not admin_access.deal_allowed(self.handler, meta):
            raise Forbidden('Экономика сделки — только автору КП и администратору')
        if not BitrixConf(store()).enabled():
            return self.send_json({'ok': False})
        with self.user_input():
            EconXlsx(store()).save(kid, self.body())
        CrmController.bitrix_on(DealBook(store()).deal_of(kid))
        return self.send_json({'ok': True})

    @route(r'/api/reminders', 'GET')  # напоминания менеджера: перезвонить, срок действия КП, нет ответа
    def reminders(self) -> None:
        handler = self.handler
        uid, name, _ = admin.actor(handler, admin=False)
        everyone = admin.AdminSessions.of(handler) is not None and not uid

        def mine(meta_obj) -> bool:
            if everyone:
                return True
            author = meta_obj.get('authorId') or meta_obj.get('managerId')
            if author and uid:
                return author == uid
            return bool(name) and str(meta_obj.get('manager') or '').strip().lower() == str(name).strip().lower()

        rows = []
        for kid, meta, track in store().kp_tracked(
            (date.today() - timedelta(days=defaults.SrvVal.get(store(), 'kp.remindDays'))).isoformat()
        ):
            meta_dict = self._obj(meta)
            if (
                admin_access.login_on(handler)
                and not admin_access.own_kp(handler, meta_dict)
                and not admin.perm(handler, 'kpOthers')
            ):
                continue
            if not mine(meta_dict):
                continue
            rows.append((kid, meta_dict, self._obj(track)))
        # срок действия, не записанный в описании, — из условий КП (состояние бывает в мегабайтах — читаются два поля)
        terms = store().kp_terms([kid for kid, meta_dict, _ in rows if not meta_dict.get('validUntil')])
        handled = KpFollowUp(store()).handled({kid: track for kid, _, track in rows})
        items = ReminderList(store=store(), handled=handled).collect(
            [(kid, meta_dict, track, terms.get(kid, {})) for kid, meta_dict, track in rows], mine
        )
        return self.send_json({'items': items, 'count': len(items)})

    @route(r'/api/features', 'GET')  # какие функции программы включены (для всех; правка — /api/admin/features)
    def features(self) -> Any:
        return self.send_json(self._features())

    def _features(self) -> dict:
        """Функции программы, доступные тому, кто прислал запрос."""
        return FeatureAccess(store()).for_user(
            Viewer(admin.AdminSessions.of(self.handler) is not None, admin.actor(self.handler, admin=False)[0] or '')
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/mailform', 'GET')  # письмо клиенту: адреса и текст по умолчанию
    def mailform(self, kid: str) -> None:
        state, meta = self._obj(store().kp_get(kid, 'state')), self._obj(store().kp_get(kid, 'meta'))
        mail_public = Mailer(store()).public()
        tpl = MailTemplate(state, meta, mail_public.get('fromName') or '')
        word = self.kp_docx(kid)
        pdf = pdf_of(word) if word and os.path.isfile(pdf_of(word)) else None
        contact = picked if isinstance(picked := state.get('contact'), dict) else {}
        files = []
        if self._features().get('kpFiles'):
            files = [{k: x[k] for k in ('id', 'name', 'size', 'note')} for x in KpFiles.of(store()).list(kid)]
        return self.send_json(
            {
                'on': mail_public['on'],
                'to': str(contact.get('email') or '').strip(),
                'cc': tpl.vars['e-mail'],
                'subject': tpl.fill(mail_public['subject']),
                'body': tpl.fill(mail_public['body']),
                'word': os.path.basename(word) if word else '',
                'pdf': os.path.basename(pdf) if pdf else '',
                'wordSize': os.path.getsize(word) if word else 0,
                'pdfSize': os.path.getsize(pdf) if pdf else 0,
                'files': files,
                'mailMB': defaults.SrvVal.get(store(), 'kp.mailMB'),
                'sent': (store().kp_track_get(kid).get('sent') or [])[-5:],
            }
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/send', 'POST')  # отправить КП клиенту по почте
    def send_kp(self, kid: str) -> None:
        data = self.json_body()
        with self.user_input():
            recipients, copies = Mailer.addresses(data.get('to')), Mailer.addresses(data.get('cc'))
        if not recipients:
            raise BadRequest('Укажите адрес получателя')
        path = self.kp_docx(kid)
        if not path:
            raise NotFound('Файл КП не найден — сохраните КП')
        files = []
        if data.get('word', True):
            with open(path, 'rb') as handle:
                files.append(
                    (
                        os.path.basename(path),
                        handle.read(),
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    )
                )
        if data.get('pdf'):
            pdf = pdf_of(path)
            if not os.path.isfile(pdf):
                try:
                    pdf_convert.convert_file(path, pdf, counterparties().keys().get('convertapiKey'))
                except Exception as exc:
                    return self.text(422, f'PDF не создан: {self.no_paths(exc)[:200]}')
            with open(pdf, 'rb') as handle:
                files.append((os.path.basename(pdf), handle.read(), 'application/pdf'))
        if not files:
            raise BadRequest('Выберите файл: Word или PDF')
        if data.get('files') and self._features().get('kpFiles'):  # отмеченные справочные документы КП
            if not isinstance(data['files'], list):
                raise BadRequest('Неверный список документов')
            with self.user_input():
                files += KpFiles.of(store()).for_mail(kid, data['files'], sum(len(x[1]) for x in files))
        state = self._obj(store().kp_get(kid, 'state'))
        reply = str((state.get('manager') or {}).get('email') or '') if isinstance(state.get('manager'), dict) else ''
        with self.user_input():
            u = getattr(
                self.handler, '_kp_user', None
            )  # без входа по паролю «кто» — заголовок запроса: считаем по компьютеру
            MailRate.take(store(), 'u:{}'.format(u['id']) if u else f'ip:{self.handler.client_address[0]}')
        try:
            accepted = Mailer(store()).send(
                recipients,
                copies,
                str(data.get('subject') or '')[:300],
                str(data.get('body') or '')[:20000],
                files,
                reply,
            )
        except RuntimeError as exc:
            admin.log(
                self.handler,
                store(),
                'send_kp',
                'kp',
                kid,
                None,
                {'to': recipients, 'error': ErrorText.of(exc)[:200]},
                result='failed',
            )
            return self.text(422, str(exc))
        track = DealTrack(store()).mark_sent(
            kid, recipients + copies, [x[0] for x in files], admin.actor(self.handler)[1]
        )
        CrmController.safe(
            lambda: CrmController.bitrix_on(DealBook(store()).refresh(kid, admin.actor(self.handler)[1]))
        )
        CrmController.safe(lambda: CrmController.mailed(kid, recipients + copies, admin.actor(self.handler)[1]))
        admin.log(
            self.handler,
            store(),
            'send_kp',
            'kp',
            kid,
            None,
            {'to': recipients, 'cc': copies, 'files': [x[0] for x in files]},
        )
        refused = [addr for addr in recipients + copies if addr not in accepted]
        return self.send_json({'ok': True, 'track': track, 'refused': refused})

    @route(
        r'/api/report', 'GET'
    )  # отчёт по КП за период: описания (права — как в журнале) и позиции для расчёта по категориям
    def report(self) -> None:
        query = self.query
        date_from, date_to = str(query.get('from') or '')[:10], str(query.get('to') or '')[:10] or '9999-12-31'
        docs = [
            day
            for day in map(
                self._obj,
                store().kp_metas_where(
                    query.get('q', ''),
                    query.get('author', ''),
                    query.get('kind', ''),
                    '',
                    date_from,
                    str(query.get('to') or '')[:10],
                ),
            )
            if day and date_from <= str(day.get('date') or '')[:10] <= date_to
        ]
        rows = admin_journal.KpJournal.rows(self.handler, docs)
        states = store().kp_states(
            [rec.get('id') for rec in rows if isinstance(rec, dict) and rec.get('id') and not rec.get('locked')]
        )
        deal_on = self._features()['deal']  # экономика недоступна — без прибыли
        for rec in rows:
            sale_rub, profit = admin.econ_rub(rec)
            rec['sumRub'], rec['profitRub'] = sale_rub, (profit if deal_on else None)
            if not deal_on:
                for k in ('econ', 'deal'):
                    rec.pop(k, None)
            if rec.get('locked') or not deal_on:
                continue
            state = self._obj(states.get(rec.get('id') or ''))
            rec['calc'] = {
                'vat': state.get('vat'),
                'pricing': {k: (state.get('pricing') or {}).get(k) for k in ('cur', 'rates', 'costNoVat')},
                'items': [
                    {
                        k: x.get(k)
                        for k in ('name', 'qty', 'price', 'disc', 'options', 'cost', 'costCur', 'attrs', 'kit')
                    }
                    for x in (state.get('items') or [])
                    if isinstance(x, dict)
                ],
            }
        return self.send_json({'items': rows})


class CrmController(Controller):
    """Кабинет: свои сделки и дела — каждому, коллег и отдел — администратору и праву «КП других»; не удаляются."""

    MID = re.compile(r'^[A-Za-z0-9_:-]{0,64}$')
    CONTACTS = 10

    @staticmethod
    def safe(func) -> Any:
        """Сделки — дополнение к КП: сбой в них не мешает сохранить КП (подробности — в журнал сервера)."""
        try:
            return func()
        except Exception as exc:
            ServerLog.failure('сделки', exc)
            return None

    @staticmethod
    def bitrix_on(did, kind='deal') -> str:
        """Изменение — в очередь отправки в Битрикс24 (если связь включена). → did"""
        if did:
            BitrixQueue.touch(store(), kind, did)
        return did

    @classmethod
    def mailed(cls, kid: str, recipients, author: str) -> str | None:
        """Письмо с КП ушло клиенту — сделанное дело «Письмо» в сделке (и в Битрикс24, если связь включена)."""
        book = DealBook(store())
        did = book.deal_of(kid)
        deal = book.get(did) if did else None
        if not deal:
            return None
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        tasks = TaskBook(store())
        task = tasks.add(
            {
                'kind': 'mail',
                'due': date.today().isoformat(),
                'time': datetime.now().strftime('%H:%M'),
                'title': 'Отправлено КП № {}: {}'.format(*(meta.get('number') or kid, ', '.join(recipients))[:200]),
            },
            deal.get('managerId') or '',
            author,
            did,
        )
        tasks.update(task['id'], {'state': 'done'})
        return cls.bitrix_on(task['id'], 'task')

    @classmethod
    def on_kp(cls, handler, kid: str) -> str | None:
        """КП сохранено — в сделку: выбранную в КП (своя или с правом на чужие), прежнюю или новую."""
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        want: Any = str(meta.get('dealId') or '')[:40]
        if want and want != 'new':
            deal = DealBook(store()).get(want)
            uid, _name, everyone = cls.who(handler)
            want = want if deal and (everyone or deal.get('managerId') == uid) else None
        return cls.safe(
            lambda: cls.bitrix_on(DealBook(store()).on_kp(kid, meta, admin.actor(handler)[1], want or None))
        )

    @staticmethod
    def who(handler) -> tuple:
        uid, name, _ = admin.actor(handler, admin=False)
        everyone = admin.AdminSessions.of(handler) is not None or admin.perm(handler, 'kpOthers')
        return uid or '', name or '', everyone

    def _scope(self, query) -> list | None:
        """Чьи сделки: '' — свои, 'all' — весь отдел, id — менеджера. Чужие — только с правом."""
        uid, _name, everyone = self.who(self.handler)
        query = str(query or '')
        if query in ('', 'me') or query == uid:
            return [uid]
        if not everyone:
            raise PermissionError(
                'Кабинет коллеги и отдел — у администратора и менеджеров с правом «КП других менеджеров»'
            )
        if query == 'all':
            return None
        if not self.MID.match(query):
            raise BadRequest('Неверный менеджер')
        return [query]

    def _deal(self, did) -> dict:
        """Сделка, если она своя или есть право на чужие; иначе — NotFound или Forbidden (ответ — Router)."""
        deal = DealBook(store()).get(did)
        uid, _name, everyone = self.who(self.handler)
        if not deal:
            raise NotFound('Сделка не найдена')
        if not everyone and deal.get('managerId') != uid:
            admin.DeniedLog.note(self.handler, store(), 'deal', did)
            raise Forbidden('Это сделка другого менеджера — нет доступа')
        return deal

    def _manager(self, mid: str) -> tuple:
        """(id, имя) менеджера из справочника для смены ответственного."""
        mgr = next((x for x in CrmBoard(store()).managers() if x['id'] == mid), None)
        if not mgr:
            raise BadRequest('Менеджер не найден')
        return mgr['id'], mgr['name']

    @route(r'/api/crm/board', 'GET')
    def board(self) -> Any:
        try:
            scope = self._scope(self.query.get('manager'))
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        res = CrmBoard(store()).build(scope)
        res['regs'] = DealRegs(store()).enabled()  # регламент Битрикс24: источник заявки при создании, окно «Заполните»
        if BitrixConf(store()).enabled():  # ссылки «Открыть в Битрикс24» на карточках доски
            portal = BitrixConf(store()).get().get('portal') or ''
            bx_ids = dict(store().all("SELECT local_id, bx_id FROM bx_link WHERE kind='deal'"))
            for deal in res['deals']:
                if deal['id'] in bx_ids and portal:
                    deal['bxUrl'] = '{}/crm/deal/details/{}/'.format(portal, bx_ids[deal['id']])
        uid, name, everyone = self.who(self.handler)
        res.update(me=uid, meName=name, canAll=everyone, managers=CrmBoard(store()).managers() if everyone else [])
        return self.send_json(res)

    @route(r'/api/crm/pay', 'GET')
    def pay_calendar(self) -> Any:
        """Платёжный календарь: оплаты клиентов и платежи поставщикам по плану исполнения сделок; просроченные оплаты."""
        try:
            scope = self._scope(self.query.get('manager'))
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        rows = PayCalendar(store()).rows(scope, self._money)
        return self.send_json({'rows': rows, 'overdue': PayCalendar.overdue(rows)})

    @route(r'/api/crm/deal/(d\d{1,9})/remind', 'POST')
    def pay_remind(self, did: str) -> Any:
        """Дело «Напомнить об оплате» по точке оплаты клиента."""
        deal = self._deal(did)
        key = str(self.json_body().get('key') or '')[:80]
        deal['kps'] = DealBook(store()).kps([did])[did]
        step = next((row for row in ExecPlan(deal).raw() if row['key'] == key and row['kind'] == 'cust'), None)
        if not step:
            return self.text(400, 'Нет такой оплаты клиента — обновите окно')
        task = PayReminder(store()).add(deal, step['label'], admin.actor(self.handler)[1])
        self.bitrix_on(task['id'], 'task')
        return self.send_json(task)

    @route(r'/api/crm/time', 'GET')
    def deal_time(self) -> Any:
        """«Где тратится время» — по отделу, без имён: только тем, кому виден весь отдел."""
        try:
            self._scope('all')
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        from crm_time import DealTime

        return self.send_json(DealTime(store()).report())

    @route(r'/api/crm/month', 'GET')
    def month_report(self) -> Any:
        """«Отчёт за месяц» в Excel — тем, кому виден весь отдел."""
        try:
            self._scope('all')
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        from crm_month import MonthReport

        try:
            report = MonthReport(store(), self.query.get('m') or MonthReport.current())
        except ValueError as exc:
            return self.text(400, str(exc))
        return self.send(
            200,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            report.xlsx(),
            self.attachment(report.file_name(), 'report.xlsx'),
        )

    @route(r'/api/crm/regs/audit', 'GET')
    def reg_audit(self) -> Any:
        """«Отдел» → регламент: незаполненное для текущей стадии по менеджерам — тем, кому виден весь отдел."""
        try:
            self._scope('all')
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        from deal_reg_audit import RegAudit

        return self.send_json(RegAudit(store()).report())

    @route(r'/api/crm/pick', 'GET')
    def pick(self) -> Any:
        uid, _name, everyone = self.who(self.handler)
        inn = Inn.key(self.query.get('inn'))
        name = (self.query.get('name') or '').strip()[:300]
        kid = safe_id(self.query.get('kp')) if self.query.get('kp') else ''
        cur = DealBook(store()).deal_of(kid) if kid and admin.kp_access(self.handler, store(), kid) else None
        mine = [uid] if not everyone else None
        items = CrmBoard(store()).pick(mine, inn, name) if inn or name else []
        if cur and cur not in [x['id'] for x in items]:
            deal = DealBook(store()).get(cur)
            if deal:
                items.insert(
                    0,
                    {
                        k: deal.get(k)
                        for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')
                    },
                )
        return self.send_json({'items': items, 'current': cur or '', 'stages': Stages.all(store())})

    @route(r'/api/crm/find', 'GET')  # единый поиск программы: сделки по словам (свои; руководитель — все)
    def find(self) -> Any:
        uid, _name, everyone = self.who(self.handler)
        return self.send_json(
            {'items': CrmBoard(store()).find(None if everyone else [uid], str(self.query.get('q') or '')[:200])}
        )

    @route(r'/api/crm/deal', 'POST')
    def create(self) -> Any:
        data = self.json_body()
        uid, name, everyone = self.who(self.handler)
        mid, mname = (
            self._manager(str(data.get('managerId')))
            if everyone and data.get('managerId') and data.get('managerId') != uid
            else (uid, name)
        )
        with self.user_input():
            deal = DealBook(store()).create(data, mid, mname, admin.actor(self.handler)[1])
            DealIntake(store()).attach_contact(
                deal.get('clientId') or '', data.get('contact'), admin.actor(self.handler)[1]
            )
        admin.log(
            self.handler,
            store(),
            'create_deal',
            'deal',
            deal['id'],
            None,
            {k: deal.get(k) for k in ('title', 'client', 'stage')},
        )
        self.bitrix_on(deal['id'])
        return self.send_json(deal)

    @route(r'/api/feedback', 'POST')
    def feedback(self) -> Any:
        """«Сообщить о проблеме»: текст менеджера и где это случилось — администратору."""
        with self.user_input():
            entry = Feedback(store()).add(self.json_body(), admin.actor(self.handler)[1])
        return self.send_json({'id': entry['id']})

    @route(r'/api/crm/intake', 'POST')
    def intake(self) -> Any:
        """Заявка из письма или ТЗ: JSON {text} или файл (?name=…: PDF, Word, Excel, TXT, письмо .eml) → поля сделки."""
        if self._too_big('Файл'):
            return None
        intake = DealIntake(store())
        with self.user_input():
            if 'json' in str(self.handler.headers.get('Content-Type') or ''):
                mail = {'text': str(self.json_body().get('text') or '')}
            else:
                mail = intake.read(str(self.query.get('name') or ''), self.body())
            return self.send_json(intake.parse(mail))

    @route(r'/api/crm/deal/(d\d{1,9})', ('GET', 'PUT'))
    def deal(self, did) -> Any:
        deal = self._deal(did)
        book = DealBook(store())
        if (
            deal.get('bxNew') and deal.get('managerId') == self.who(self.handler)[0]
        ):  # ответственный открыл — сделка больше не «новая»
            book.flag(did, bxNew=None)
            deal.pop('bxNew', None)
        if self.method == 'PUT':
            body = self.json_body()
            mgr = None
            if body.get('managerId') and body['managerId'] != deal.get('managerId'):
                if not self.who(self.handler)[2]:
                    raise Forbidden(
                        'Передать сделку коллеге может администратор или менеджер с правом «КП других менеджеров»'
                    )
                mgr = self._manager(str(body['managerId']))
            with self.user_input():
                if 'stage' in body:
                    DealRegs(store()).check(deal, str(body['stage'] or ''), str(body.get('lostReason') or ''))
                try:
                    new = book.update(did, body, admin.actor(self.handler)[1], self.base_rev(), mgr)
                except LookupError as exc:
                    raise NotFound(str(exc)) from None
            if mgr:
                TaskBook(store()).move_deal(did, mgr[0])
            changes = {k: new.get(k) for k in ('stage', 'lostReason', 'manager') if new.get(k) != deal.get(k)}
            if changes:
                admin.log(self.handler, store(), 'edit_deal', 'deal', did, {k: deal.get(k) for k in changes}, changes)
            self.bitrix_on(did)
            deal = new
        return self._card(did, deal)

    def _comms(self, did: str) -> list:
        """Звонки и письма сделки из Битрикс24 (до подключения обмена — подтягиваются при открытии, раз в полчаса)."""
        comms = BitrixComms(BitrixSync(store()))
        if not comms.enabled():
            return []
        self.safe(lambda: comms.sweep(did))
        return DealComms(store()).of(did)

    @route(r'/api/crm/deal/(d\d{1,9})/comm/(\d{1,12})', 'GET')
    def comm_body(self, did, bx_id) -> Any:
        """Текст письма Битрикс24 целиком — по нажатию в ленте сделки."""
        self._deal(did)
        body = DealComms(store()).body(did, bx_id)
        if body is None:
            raise NotFound('Письма нет')
        return self.send_json({'body': body})

    @route(r'/api/crm/client/inn', 'POST')
    def client_by_inn(self) -> Any:
        """Клиент по ИНН: из справочника или из ФНС (новая карточка) — для сделки без ручного ввода реквизитов."""
        body = self.json_body()
        with self.user_input():
            doc = ClientByInn(store()).ensure(
                str(body.get('inn') or ''), str(body.get('name') or '')[:300], admin.actor(self.handler)[1]
            )
        return self.send_json({key: doc.get(key) or '' for key in ('id', 'name', 'inn', 'address')})

    @route(r'/api/crm/deal/(d\d{1,9})/need', ('GET', 'POST'))
    def need(self, did) -> Any:
        """Регламент Битрикс24: что заполнить для стадии (GET) — и заполнить, затем перевести (POST)."""
        deal = self._deal(did)
        regs, book = DealRegs(store()), DealBook(store())
        author = admin.actor(self.handler)[1]
        if self.method == 'GET':
            book.autofill(did, author)
            with self.user_input():
                view = regs.need(
                    book.get(did) or deal, str(self.query.get('stage') or ''), str(self.query.get('reason') or '')
                )
            return self.send_json(dict(view, on=regs.enabled()))
        body = self.json_body()
        with self.user_input():
            filled = regs.save_client(deal, body.get('client'), author)
            edit = {key: body[key] for key in ('uf', 'note') if key in body}
            edit.update({key: filled[key] for key in ('clientId', 'clientInn') if filled.get(key) != deal.get(key)})
            if edit:
                book.update(did, edit, author)
            book.autofill(did, author)
            deal = book.get(did) or deal
            move = {key: body[key] for key in ('stage', 'lostReason') if key in body}
            if move.get('stage'):
                regs.check(deal, str(move['stage']), str(move.get('lostReason') or ''))
                new = book.update(did, move, author)
            else:
                new = deal
        changes = {key: new.get(key) for key in ('stage', 'lostReason') if new.get(key) != deal.get(key)}
        if changes:
            admin.log(self.handler, store(), 'edit_deal', 'deal', did, {key: deal.get(key) for key in changes}, changes)
        self.bitrix_on(did)
        return self._card(did, new)

    def _card(self, did: str, deal: dict) -> Any:
        """Карточка сделки: КП, исполнение, клиент из справочника, дела, Битрикс24, воронки и поля."""
        book = DealBook(store())
        if book.autofill(did, admin.actor(self.handler)[1]):
            deal = dict(book.get(did) or deal)
            self.bitrix_on(did)
        deal['kps'] = book.kps([did])[did]
        if ExecTasks(store()).sync(deal) + (self.safe(lambda: AutoTasks(store()).sync(deal)) or 0):
            deal = dict(book.get(did) or deal, kps=deal['kps'])
        deal['closingDue'] = DealClosing(store()).due(deal)
        deal['exec'] = ExecPlan(deal).view(Sums.ALL if self._money(deal) else Sums.SALES)
        ExecPlan.strip(deal['kps'])
        deal['clientCard'] = self._client_card(deal)
        # сделка из Битрикса без контактов у клиента — подтянуть контакты сделки и компании (раз в сутки)
        no_people = not (deal['clientCard'] or {}).get('contacts')
        if no_people and BitrixConf(store()).enabled() and self.safe(lambda: BitrixSync(store()).people(did)):
            deal = dict(book.get(did) or deal, kps=deal['kps'], exec=deal['exec'])
            deal['clientCard'] = self._client_card(deal)
        deal['tasks'] = TaskBook(store()).list(deal=did)
        uid, _name, everyone = self.who(self.handler)
        deal['calls'] = TaskBook(store()).client_calls(deal, None if everyone else [uid])
        if BitrixConf(store()).enabled():
            deal['bx'] = self.safe(lambda: BitrixSync(store()).card(did))
            deal['comms'] = self._comms(did)
            companies = MyCompanies(store())
            deal['myCompanies'] = companies.all()
            deal['myCompanyDefault'] = companies.default(BitrixConf(store()).rules().company()['my'])
        funnel = deal.get('funnel') or Funnels.MAIN
        fields = DealFields(store())
        deal['regsNext'] = self.safe(lambda: DealRegs(store()).next_gaps(deal))
        deal['files'] = DealFiles.of(store()).list(did, admin.actor(self.handler)[0])
        deal['fileKinds'] = DealFiles.KINDS
        return self.send_json(
            dict(
                deal,
                stages=Stages.all(store()),
                funnels=Funnels(store()).all(),
                fields=fields.shown(funnel),
                users=fields.users(),
            )
        )

    def _money(self, deal) -> bool:
        """Суммы оплат поставщикам и перевозчикам — тем, кому открыта экономика сделки КП (решение владельца 20.10)."""
        main = ExecPlan.main(deal)
        if not main:
            return False
        meta = TrackController._obj(store().kp_get(main['id'], 'meta'))
        return admin_access.deal_allowed(self.handler, meta)

    @staticmethod
    def _client_card(deal) -> dict | None:
        """Клиент сделки из справочника: реквизиты и контакты (телефон, почта — для звонка и письма из карточки)."""
        cid = deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')
        client = store().client_get(cid) if cid else None
        if not client:
            return None
        contacts = [row for row in (client.get('contacts') or []) if isinstance(row, dict)][: CrmController.CONTACTS]
        keep = ('name', 'post', 'phone', 'email')
        return {
            'id': client.get('id') or cid,
            'name': client.get('name') or '',
            'inn': client.get('inn') or '',
            'noInn': bool(client.get('noInn')),
            'address': client.get('address') or '',
            'contacts': [{key: str(row.get(key) or '') for key in keep} for row in contacts],
        }

    @route(r'/api/crm/deal/(d\d{1,9})/comment', 'POST')
    def comment(self, did) -> Any:
        """Комментарий в ленту сделки (уходит и в ленту сделки Битрикс24)."""
        self._deal(did)
        with self.user_input():
            try:
                DealBook(store()).comment(did, self.json_body().get('text'), admin.actor(self.handler)[1])
            except LookupError as exc:
                raise NotFound(str(exc)) from None
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/files', 'POST')
    def deal_file_add(self, did: str) -> Any:
        """Документ сделки: ?kind=…&name=…, тело — файл; уходит и в Битрикс24."""
        self._deal(did)
        uid, name, _role = admin.actor(self.handler)
        with self.user_input():
            rec = DealFiles.of(store()).add_kind(
                did, self.query.get('kind', ''), self.query.get('name', ''), self.body(), name, uid
            )
        admin.log(self.handler, store(), 'add_deal_file', 'deal', did, None, {'name': rec['name'], 'kind': rec['kind']})
        AutoTasks(store()).settle_closing(did)
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/files/(\d{1,9})', 'GET')
    def deal_file(self, did: str, fid: str) -> Any:
        self._deal(did)
        got = DealFiles.of(store()).read(did, fid)
        if not got:
            raise NotFound('Документ не найден')
        rec, data = got
        return self.send(
            200,
            rec['mime'] or 'application/octet-stream',
            data,
            self.attachment(rec['name'], 'document.' + (rec['ext'] or 'bin')),
        )

    @route(r'/api/crm/deal/(d\d{1,9})/files/(\d{1,9})/remove', 'POST')
    def deal_file_remove(self, did: str, fid: str) -> Any:
        """Автор удаляет свой документ в первые kp.fileUndoMin минут; позже — администратор."""
        self._deal(did)
        try:
            rec = DealFiles.of(store()).delete_own(did, fid, admin.actor(self.handler)[0])
        except LookupError as exc:
            raise NotFound(str(exc)) from None
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        admin.log(self.handler, store(), 'delete_deal_file', 'deal', did, {'name': rec['name'], 'author': True}, None)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/remove', 'POST')
    def deal_remove(self, did: str) -> Any:
        """Удалить сделку в корзину: ответственный — свою, руководитель и администратор — любую."""
        deal = self._deal(did)
        DealBook(store()).remove(did, admin.actor(self.handler)[1])
        admin.log(
            self.handler,
            store(),
            'delete_deal',
            'deal',
            did,
            {'title': deal.get('title'), 'client': deal.get('client')},
            None,
        )
        return self.send_json({'ok': True, 'id': did})

    @route(r'/api/crm/deal/(d\d{1,9})/restore', 'POST')
    def deal_restore(self, did: str) -> Any:
        """«Восстановить» сразу после удаления: свою — в первые минуты, руководитель и администратор — любую."""
        from features import Viewer

        uid, _name, everyone = self.who(self.handler)
        try:
            deal = DealBook(store()).restore(did, Viewer(admin=everyone, uid=uid))
        except LookupError as exc:
            raise NotFound(str(exc)) from None
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        admin.log(self.handler, store(), 'restore', 'deal', did, None, {'title': deal.get('title')})
        return self.send_json({'ok': True, 'id': did})

    @route(r'/api/crm/deal/(d\d{1,9})/exec', 'PUT')
    def exec_mark(self, did) -> Any:
        """Отметка точки исполнения: {key, at} — at пусто снимает отметку."""
        self._deal(did)
        body = self.json_body()
        with self.user_input():
            try:
                ExecBook(store()).mark(
                    did, str(body.get('key') or '')[:80], str(body.get('at') or ''), admin.actor(self.handler)[1]
                )
            except LookupError as exc:
                raise NotFound(str(exc)) from None
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/kp', 'POST')
    def link(self, did) -> Any:
        self._deal(did)
        kid = safe_id(str(self.json_body().get('kp') or ''))
        if not store().kp_get(kid, 'meta'):
            raise NotFound('КП не найдено')
        if not admin.kp_access(self.handler, store(), kid):
            raise Forbidden('Это КП другого менеджера — нет доступа')
        old = DealBook(store()).link(did, kid, admin.actor(self.handler)[1])
        admin.log(self.handler, store(), 'link_deal', 'deal', did, {'deal': old} if old else None, {'kp': kid})
        self.bitrix_on(did)
        self.bitrix_on(old)
        return self.send_json({'ok': True, 'from': old})

    @route(r'/api/crm/task', 'POST')
    def task_add(self) -> Any:
        data = self.json_body()
        uid, _name, everyone = self.who(self.handler)
        did = str(data.get('deal') or '')
        mid = uid
        if did:
            deal = self._deal(did)
            mid = deal.get('managerId') or uid
        elif everyone and data.get('managerId'):
            mid = self._manager(str(data['managerId']))[0]
        twin = TaskBook(store()).twin(did, data) if did and not data.get('again') else None
        if twin:
            day = '.'.join(reversed(str(twin['due']).split('-')[1:]))
            return self.text(409, 'Такое дело уже есть: «{}» на {}.'.format(twin['title'], day))
        with self.user_input():
            task = TaskBook(store()).add(data, mid, admin.actor(self.handler)[1], did or None)
        self.bitrix_on(task['id'], 'task')
        return self.send_json(task)

    @route(r'/api/crm/task/(\d{1,9})', 'PUT')
    def task(self, tid: str) -> Any:
        tasks = TaskBook(store())
        task = tasks.get(tid)
        if not task:
            raise NotFound('Дело не найдено')
        uid, _name, everyone = self.who(self.handler)
        if not everyone and task['managerId'] != uid:
            raise Forbidden('Это дело другого менеджера — нет доступа')
        with self.user_input():
            task = tasks.update(tid, self.json_body(), admin.actor(self.handler)[1])
        self.bitrix_on(task['id'], 'task')
        return self.send_json(task)
