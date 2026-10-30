"""Адреса КП: документ и версии, Word и PDF, передача, файлы КП, черновики и заготовки, шаблоны КП."""

import json
import math
import os
import urllib.parse
from collections.abc import Callable
from typing import Any

import admin
import admin_access
import admin_journal
import pdf_convert
from bitrix import BitrixConf
from clock import Clock
from config import DOCS_DIR, DOCS_SHARE, MIME, BadRequest, docs_path, safe_dir, safe_file, safe_id, store, write_bytes
from crm import DealBook, DealLinks
from desktop import open_file, open_folder, show_in_folder
from features import FeatureAccess
from kp_files import KpFiles
from kp_templates import (
    TEMPLATES_DIR,
    TemplateError,
    copy_template,
    delete_template,
    list_history,
    list_templates,
    open_template_file,
    put_file,
    reset_template,
    restore_history,
    template_file,
)
from storage import with_rev
from web_base import PASS, Controller, Forbidden, NotFound, counterparties, pdf_of, route
from web_crm import CrmController

WIN_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1, 10)} | {f'LPT{i}' for i in range(1, 10)}


class TemplatesController(Controller):
    @route(r'/api/templates')
    def templates(self) -> Any:
        return self.send_json(list_templates())

    @route(r'/api/templates/folder', 'POST')
    def folder(self) -> Any:
        if not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        open_folder(TEMPLATES_DIR)
        return self.send_json({'ok': True})

    @route(r'/api/templates/([A-Za-z0-9_-]+)/([a-z]+)')
    def action(self, tid: str, action) -> Any:
        """Редактор шаблона: сохранение файлов, история версий, копия, заводской вариант, открыть в Word."""
        method, query = self.method, self.query
        try:
            if action == 'file' and method == 'PUT':
                put_file(tid, query.get('name', ''), self.body())
                return self.send_json({'ok': True})
            if action == 'history' and method == 'GET':
                return self.send_json(list_history(tid))
            if action == 'restore' and method == 'POST':
                return self.send_json({'ok': True, 'file': restore_history(tid, query.get('name', ''))})
            if action == 'copy' and method == 'POST':
                return self.send_json(
                    {'ok': True, 'id': copy_template(tid, query.get('to', ''), query.get('title', ''))}
                )
            if action == 'reset' and method == 'POST':
                reset_template(tid)
                return self.send_json({'ok': True})
            if action == 'delete' and method == 'POST':
                delete_template(tid)
                return self.send_json({'ok': True})
            if action == 'open' and method == 'POST':
                if not self.is_local():
                    return self.send_json({'remote': True})
                open_template_file(tid, query.get('name', ''))
                return self.send_json({'ok': True})
        except TemplateError as exc:
            return self.text(400, str(exc))
        raise NotFound()

    @route(r'/tpl/([A-Za-z0-9_-]+)/([^/]+)')
    def file(self, tid: str, name) -> Any:
        path = template_file(tid, urllib.parse.unquote(name))
        if not path:
            raise NotFound('Файл шаблона не найден')
        ext = os.path.splitext(path)[1].lower()
        ctype = {
            '.json': 'application/json; charset=utf-8',
            '.js': 'text/plain; charset=utf-8',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }.get(ext) or MIME.get(ext, 'application/octet-stream')
        extra = (
            {'Content-Disposition': f'attachment; filename="{os.path.basename(path)}"'}
            if self.query.get('download') == '1'
            else None
        )
        with open(path, 'rb') as handle:
            return self.send(200, ctype, handle.read(), extra)


class KpController(Controller):
    # PDF: чем можно преобразовать; преобразование присланного DOCX (предпросмотр) без записи в журнал
    NUM_DIGITS_MAX = 9

    @route(r'/api/pdf', 'GET')
    def pdf_tools(self) -> Any:
        return self.send_json(pdf_convert.available(counterparties().keys().get('convertapiKey')))

    @route(r'/api/pdf', 'POST')
    def pdf_convert(self) -> Any:
        try:
            data = pdf_convert.convert_bytes(self.body(), counterparties().keys().get('convertapiKey'))
        except Exception as exc:
            return self.text(422, f'PDF не создан: {Controller.no_paths(exc)}')
        return self.send(200, 'application/pdf', data, self.attachment(safe_file(self.query.get('name')) or 'КП.pdf'))

    @route(r'/api/history')
    def history(self) -> Any:
        if (
            'limit' in self.query
        ):  # постранично, с поиском и итогами по всему отбору; files — число справочных документов КП
            res = admin_journal.KpJournal.page(self.handler, store(), self.query)
            count = KpFiles.of(store()).counts([rec.get('id') for rec in res['items'] if isinstance(rec, dict)])
            links = DealLinks(store()).for_kps(
                [str(rec.get('id') or '') for rec in res['items'] if isinstance(rec, dict)]
            )
            for rec in res['items']:
                if isinstance(rec, dict) and count.get(rec.get('id')):
                    rec['files'] = count[rec['id']]
                if isinstance(rec, dict) and str(rec.get('id') or '') in links:
                    rec['crm'] = links[str(rec['id'])]
            return self.send_json(res)
        return self.send_json(admin_journal.KpJournal.out(self.handler, store().kp_list()))

    @route(r'/api/kp/new', 'POST')
    def new(self) -> Any:
        num = store().next_number()
        return self.send_json({'id': num, 'number': num})

    @route(r'/api/kp/([^/]+)/(state|meta)', ('GET', 'PUT'))
    def doc(self, kid: str, field) -> Any:
        kid = safe_id(kid)
        if self.method == 'PUT':
            text = self.body().decode('utf-8')
            try:
                if not isinstance(json.loads(text), dict):
                    raise ValueError
            except ValueError:  # испорченная запись ломала бы журнал КП у всех
                return self.text(400, 'Неверный формат КП')
            if self._others_kp(kid):
                return None
            if field == 'meta':
                self._note_others_edit(kid)
            rev = store().kp_set(
                kid,
                field,
                admin_access.kp_in(self.handler, store(), kid, field, text),
                admin.actor(self.handler)[1],
                self.base_rev() if field == 'state' else None,
            )
            if field == 'meta':
                return self.send_json(
                    {
                        'ok': True,
                        'rev': rev,
                        'deal': CrmController.on_kp(self.handler, kid),
                        'bx': BitrixConf(store()).enabled(),
                    }
                )
            return self.send_json({'ok': True, 'rev': rev})
        v = store().kp_get(kid, field)
        if v and field == 'state':
            v = with_rev(admin_access.kp_out(self.handler, 'state', v), store().rev_of('kp', kid)['rev'])
            return self.send_json(v)
        if not v:
            raise NotFound()
        return self.send_json(admin_access.kp_out(self.handler, field, v))

    @route(r'/api/kp/([^/]+)/transfer', ('GET', 'POST'))
    def transfer(self, kid: str) -> Any:
        """Передать КП другому менеджеру: GET — что изменится, POST {manager, deal: with | keep} — передать.
        Автор, администратор и право «КП других менеджеров»."""
        from kp_transfer import DealMove, KpTransfer

        kid = safe_id(kid)
        if not admin.kp_access(self.handler, store(), kid):
            raise Forbidden('Передать можно своё КП; чужое — администратору и с правом «КП других менеджеров»')
        mover = KpTransfer(store())
        try:
            if self.method == 'GET':
                return self.send_json(mover.plan(kid))
            data = self.json_body()
            choice = DealMove.KEEP if data.get('deal') == DealMove.KEEP.value else DealMove.WITH
            with self.user_input():
                result = mover.move(kid, str(data.get('manager') or '')[:64], admin.actor(self.handler)[1], choice)
        except LookupError as exc:
            raise NotFound(str(exc)) from None
        admin.log(
            self.handler, store(), 'transfer_kp', 'kp', kid, {'manager': result['from']}, {'manager': result['manager']}
        )
        return self.send_json(result)

    EDIT_OTHER = 'X-KP-Edit-Other'

    def _foreign_author(self, kid: str) -> str:
        """Автор сохранённого КП, если это не тот, кто сохраняет (функция «только просмотр» включена); иначе ''."""
        if not FeatureAccess(store()).is_on('kpViewLock'):
            return ''
        try:
            meta = json.loads(store().kp_get(kid, 'meta') or '{}')
        except ValueError:
            meta = {}
        author = str(meta.get('authorId') or meta.get('managerId') or '') if isinstance(meta, dict) else ''
        return '' if admin.actor(self.handler, admin=False)[0] == author else author

    def _others_kp(self, kid: str) -> bool:
        """Чужое сохранённое КП без отметки «Разрешить правку» не перезаписывается (просмотр администратором или правом
        «КП других менеджеров» не меняет КП случайно). True — отказ 409 уже отправлен."""
        if self.handler.headers.get(self.EDIT_OTHER) == '1' or not self._foreign_author(kid):
            return False
        self.text(
            409,
            'КП другого менеджера открыто только для просмотра — нажмите «Разрешить правку», чтобы сохранить изменения',
        )
        return True

    def _note_others_edit(self, kid: str) -> None:
        """Правка чужого КП по «Разрешить правку» — в журнал действий (кто, чьё КП)."""
        author = self._foreign_author(kid) if self.handler.headers.get(self.EDIT_OTHER) == '1' else ''
        if author:
            admin.log(self.handler, store(), 'edit_others_kp', 'kp', kid, {'author': author}, None)

    @route(r'/api/kp/([^/]+)/rev', 'GET')  # кто и когда последним сохранил КП — проверка перед сохранением
    def rev(self, kid: str) -> None:
        return self.send_json(store().rev_of('kp', safe_id(kid)))

    # история версий КП: список и состояние выбранной версии (экономика чужого КП убирается, как и у текущей)
    @route(r'/api/kp/([^/]+)/versions', 'GET')
    def versions(self, kid: str) -> Any:
        return self.send_json(store().kp_versions(safe_id(kid)))

    @route(r'/api/kp/([^/]+)/versions/(\d+)', 'GET')
    def version(self, kid: str, num) -> Any:
        if len(num) > self.NUM_DIGITS_MAX:
            raise NotFound()
        v = store().kp_version_state(safe_id(kid), num)
        if not v:
            raise NotFound()
        return self.send_json(admin_access.kp_out(self.handler, 'state', v))

    NAME_TRIES = 100

    @classmethod
    def free_name(cls, name: str, sub: str, kid: str, taken: Callable) -> str:
        """Путь файла КП, не занятый другим КП: «4567892 КП», «(2)», «(3)»… — и, если и они заняты, с номером этого КП."""
        stem, ext = os.path.splitext(name)
        names = [name] + [f'{stem} ({k}){ext}' for k in range(2, cls.NAME_TRIES)] + [f'{stem} ({kid}){ext}']
        for one in names:
            rel = (sub + '/' + one) if sub else one
            if not taken(rel):
                return rel
        return rel

    @route(r'/api/kp/([^/]+)/docx', 'PUT')
    def docx_put(self, kid: str) -> Any:
        kid, query = safe_id(kid), self.query
        if self._others_kp(kid):
            return None
        name = safe_file(query.get('name'))
        # только документ Word: имя — с расширением .docx (не .exe, .bat, .lnk…), содержимое — архив docx (PK…)
        if not name.lower().endswith('.docx'):
            name = os.path.splitext(name)[0].rstrip('. ') + '.docx'
        if os.path.splitext(name)[0].split('.')[0].strip().upper() in WIN_RESERVED:
            name = '_' + name
        try:  # документ Word без макросов и внешних шаблонов — его потом открывает Word сервера (PDF)
            pdf_convert.DocxCheck.check(self.body())
        except ValueError as exc:
            return self.text(400, f'Файл КП должен быть документом Word (.docx): {exc}')
        sub = safe_dir(query.get('dir'))  # папка менеджера (фамилия)
        rel = self.free_name(name, sub, kid, lambda path: store().kp_docx_owner(path, kid))
        path = docs_path(rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_bytes(path, self.body())
        # прежний PDF устарел: создаётся заново, если его попросили сохранить
        stale = [pdf_of(path)]
        # при пересохранении КП под новым именем старый файл убираем, чтобы не копились дубли
        prev = store().kp_get(kid, 'docx')
        if prev:
            old = docs_path(prev.strip())
            if os.path.isfile(old) and os.path.normcase(old) != os.path.normcase(path):
                stale += [old, pdf_of(old)]
        for x in stale:
            try:
                if os.path.isfile(x):
                    os.remove(x)
            except OSError:
                pass
        store().kp_set(kid, 'docx', rel)
        return self.send_json({'ok': True, 'path': path if self.is_local() else '', 'rel': rel})

    @route(r'/api/kp/([^/]+)/docx', 'GET')
    def docx_get(self, kid: str) -> Any:
        # скачивание готового КП — для сотрудников, открывших программу по сети
        path = self.kp_docx(safe_id(kid))
        if not path:
            raise NotFound('Файл КП не найден')
        with open(path, 'rb') as handle:
            data = handle.read()
        return self.send(
            200,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data,
            self.attachment(os.path.basename(path), 'KP.docx'),
        )

    # PDF сохранённого КП: создаётся рядом с .docx (тем же именем), скачивается сотрудниками по сети
    @route(r'/api/kp/([^/]+)/pdf')
    def pdf(self, kid: str) -> Any:
        path = self.kp_docx(safe_id(kid))
        if not path:
            raise NotFound('Файл КП не найден')
        pdf = pdf_of(path)
        if self.method == 'POST':
            try:
                pdf_convert.convert_file(path, pdf, counterparties().keys().get('convertapiKey'))
            except Exception as exc:
                return self.text(422, f'PDF не создан: {Controller.no_paths(exc)}')
            return self.send_json({'ok': True, 'path': pdf if self.is_local() else '', 'local': self.is_local()})
        if self.method == 'GET':
            if not os.path.isfile(pdf):
                raise NotFound('PDF этого КП ещё не создан')
            with open(pdf, 'rb') as handle:
                return self.send(200, 'application/pdf', handle.read(), self.attachment(os.path.basename(pdf)))
        return PASS

    @route(r'/api/kp/([^/]+)/openpdf', 'POST')
    def open_pdf(self, kid: str) -> Any:
        rel = store().kp_get(safe_id(kid), 'docx')
        pdf = pdf_of(docs_path(rel.strip())) if rel else None
        if not pdf or not os.path.isfile(pdf):
            raise NotFound('PDF этого КП ещё не создан')
        if not self.is_local():
            return self.send_json({'remote': True, 'download': f'/api/kp/{safe_id(kid)}/pdf'})
        open_file(pdf)
        return self.send_json({'ok': True})

    @route(r'/api/kp/([^/]+)/(open|folder)', 'POST')
    def open_doc(self, kid: str, how) -> Any:
        rel = store().kp_get(safe_id(kid), 'docx')
        if not rel:
            raise NotFound('Файл КП не найден')
        if not self.is_local():  # открыть Word можно только на своём компьютере — сотруднику по сети отдаём файл
            return self.send_json(
                {
                    'remote': True,
                    'download': f'/api/kp/{safe_id(kid)}/docx',
                    'share': (DOCS_SHARE.rstrip('\\/') + '\\' + rel.replace('/', '\\')) if DOCS_SHARE else '',
                }
            )
        path = docs_path(rel.strip())
        if not os.path.isfile(path):
            raise NotFound('Файл КП был перемещён или удалён')
        if os.path.splitext(path)[1].lower() not in ('.docx', '.pdf'):  # запускать на компьютере можно только документ
            return self.text(400, 'Это не документ Word — файл не открывается')
        if how == 'open':
            open_file(path)
        else:
            show_in_folder(path)
        return self.send_json({'ok': True})

    @route(r'/api/folder', 'POST')
    def docs_folder(self) -> Any:
        sub = safe_dir(self.query.get('dir'))
        target = os.path.join(DOCS_DIR, sub) if sub else DOCS_DIR
        os.makedirs(target, exist_ok=True)
        if not self.is_local():
            return self.send_json(
                {
                    'remote': True,
                    'share': (DOCS_SHARE.rstrip('\\/') + ('\\' + sub if sub else '')) if DOCS_SHARE else '',
                }
            )
        open_folder(target)
        return self.send_json({'ok': True})


class KpFilesController(Controller):
    """Паспорта, сертификаты, схемы к КП — в документ КП не входят."""

    def _kp_ok(self, kid: str) -> bool:
        """КП есть в журнале; КП в корзине — только администратору (его документы ждут восстановления)."""
        return store().kp_get(kid, 'meta') is not None or admin.AdminSessions.of(self.handler) is not None

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files', ('GET', 'POST'))
    def files(self, kid: str) -> Any:
        files = KpFiles.of(store())
        if self.method == 'GET':
            if not self._kp_ok(kid):
                raise NotFound('КП не найдено')
            return self.send_json({'items': files.list(kid, admin.actor(self.handler)[0]), 'limits': files.limits()})
        if store().kp_get(kid, 'meta') is None:
            return self.text(400, 'Сначала сохраните КП, затем прикрепите документы')
        uid, name, _role = admin.actor(self.handler)
        with self.user_input():
            rec = files.add(kid, self.query.get('name', ''), self.body(), self.query.get('note', ''), name, uid)
        admin.log(self.handler, store(), 'add_kp_file', 'kp', kid, None, {'name': rec['name'], 'size': rec['size']})
        CrmController.bitrix_on(DealBook(store()).deal_of(kid))
        return self.send_json(rec)

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files/(\d{1,9})', ('GET', 'PUT'))
    def file(self, kid: str, fid: str) -> Any:
        files = KpFiles.of(store())
        if not self._kp_ok(kid):
            raise NotFound('КП не найдено')
        if self.method == 'PUT':
            note = self.json_body().get('note')
            if note is not None and not isinstance(note, str):
                raise BadRequest('Примечание — строка')
            old = files.get(kid, fid)
            if old is None:
                raise NotFound('Документ не найден')
            try:
                rec = files.set_note(kid, fid, note or '')
            except LookupError as exc:
                raise NotFound(str(exc)) from None
            admin.log(
                self.handler,
                store(),
                'edit_kp_file',
                'kp',
                kid,
                {'name': old['name'], 'note': old['note']},
                {'note': rec['note']},
            )
            return self.send_json(rec)
        got = files.read(kid, fid)
        if not got:
            raise NotFound('Документ не найден')
        rec, data = got
        return self.send(
            200,
            rec['mime'] or 'application/octet-stream',
            data,
            self.attachment(rec['name'], 'document.' + (rec['ext'] or 'bin')),
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files/(\d{1,9})/remove', 'POST')
    def remove_own(self, kid: str, fid: str) -> Any:
        """Автор удаляет свой файл, прикреплённый по ошибке, — только в первые kp.fileUndoMin минут после загрузки."""
        try:
            rec = KpFiles.of(store()).delete_own(kid, fid, admin.actor(self.handler)[0])
        except LookupError as exc:
            raise NotFound(str(exc)) from None
        except PermissionError as exc:
            raise Forbidden(str(exc)) from None
        admin.log(
            self.handler,
            store(),
            'delete_kp_file',
            'kp',
            kid,
            {'name': rec['name'], 'size': rec['size'], 'author': True},
            None,
        )
        return self.send_json({'ok': True})


class DraftsController(Controller):
    """Черновики КП на сервере (у каждого менеджера свои, автосохранение) и заготовки КП (общие для всех)."""

    KINDS = {'drafts': 'draft', 'presets': 'preset'}
    MAX_STATE = 25 * 1024 * 1024
    PRESET_DROP = (
        'kpId',
        'number',
        'createdAt',
        'authorId',
        'managerId',
        'manager',
        'date',
        'client',
        'clientId',
        'clientInn',
        'clientKpp',
        'clientOgrn',
        'clientFull',
        'clientAddr',
        'clientDir',
        'clientDirPost',
        'clientStatus',
        'contact',
        'object',
        'check',
        'tender',
        'deal',
        'dealId',
    )

    def _who(self) -> tuple:
        uid, name, _ = admin.actor(self.handler, admin=False)
        return uid or '', name or ''

    def _mine(self, row) -> bool:
        # черновик без автора (сохранён до выбора менеджера на устройстве) — того, кто с ним работает
        return (
            row['owner'] == self._who()[0]
            or (row['kind'] == 'draft' and not row['owner'])
            or admin.AdminSessions.of(self.handler) is not None
        )

    @route(r'/api/(drafts|presets)', 'GET')
    def list(self, kind) -> Any:
        k = self.KINDS[kind]
        return self.send_json(
            {'items': store().drafts_list(k, self._who()[0] if k == 'draft' else None), 'me': self._who()[0]}
        )

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})', 'GET')
    def get(self, kind, did) -> Any:
        row, state = store().draft_get(did)
        if not row or row['kind'] != self.KINDS[kind]:
            raise NotFound('Черновик не найден' if kind == 'drafts' else 'Заготовка не найдена')
        if kind == 'drafts' and not self._mine(row):
            raise Forbidden('Это черновик другого менеджера')
        return self.send(
            200,
            'application/json; charset=utf-8',
            ('{{"row":{},"data":{}}}'.format(json.dumps(row, ensure_ascii=False), state or '{}')).encode('utf-8'),
        )

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})', 'PUT')
    def put(self, kind, did) -> Any:
        k = self.KINDS[kind]
        raw = self.body()
        if len(raw) > self.MAX_STATE:
            return self.text(
                413, 'Черновик слишком большой (больше 25 МБ) — уберите вставленные картинки большого размера'
            )
        payload = self.json_body()
        state = payload.get('state')
        if not isinstance(state, dict):
            raise BadRequest('Нет состояния КП')
        old, _ = store().draft_get(did)
        if old and (old['kind'] != k or not self._mine(old)):
            raise Forbidden('Это запись другого менеджера')
        uid, name = self._who()
        items = picked if isinstance(picked := state.get('items'), list) else []
        try:
            total = float(payload.get('sum') or 0)
        except (TypeError, ValueError):
            total = 0.0
        if not math.isfinite(total):
            total = 0.0
        keep = old and old['owner']  # черновик без автора получает автора при сохранении
        row = {
            'id': did,
            'kind': k,
            'owner': old['owner'] if keep else uid,
            'owner_name': old['owner_name'] if keep else name,
            'title': str(payload.get('title') or '')[:120],
            'client': str(state.get('client') or '')[:200],
            'kp': str(state.get('number') or '')[:40] if state.get('kpId') and k == 'draft' else '',
            'positions': len(items),
            'sum': total,
            'cur': str(payload.get('cur') or 'RUB')[:3],
            'updated': Clock.now(),
        }
        if k == 'preset' and not row['title']:
            raise BadRequest('Укажите название заготовки')
        if (
            k == 'preset'
        ):  # заготовка — общая для отдела: без клиента, номера, автора и экономики (как Presets.DROP в клиенте)
            state = {x: v for x, v in state.items() if x not in self.PRESET_DROP}
        data = {'state': state}
        if k == 'draft' and isinstance(payload.get('rev'), int):
            data['rev'] = payload['rev']
        store().draft_put(row, json.dumps(data, ensure_ascii=False))
        if k == 'preset' and not old:
            admin.log(self.handler, store(), 'preset_add', 'preset', did, None, {'title': row['title']})
        return self.send_json({'ok': True, 'row': row})

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})/delete', 'POST')
    def delete(self, kind, did) -> Any:
        row, _ = store().draft_get(did)
        if not row or row['kind'] != self.KINDS[kind]:
            return self.send_json({'ok': True})
        if not self._mine(row):
            raise Forbidden('Удалить может только автор или администратор')
        store().draft_del(did)
        if kind == 'presets':
            admin.log(self.handler, store(), 'preset_delete', 'preset', did, {'title': row['title']}, None)
        return self.send_json({'ok': True})
