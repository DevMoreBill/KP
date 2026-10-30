"""«Настройки» → записи: администраторы и права, справочники, удаление, корзина, модерация, откат правок."""

import json
import re
from typing import Any

import auth_users
from admin_access import _loads, actor
from admin_accounts import (
    AdminSessions,
    _cookie_token,
    _now,
    accounts,
    check_login,
    check_new_password,
    find_account,
    hash_password,
    save_accounts,
)
from admin_base import AdminBase
from admin_rights import AdminRights
from catalog_save import ABSENT, _set_moderation, diff, moderation
from defaults import SrvVal


class AdminRecordsApi(AdminBase):
    """«Настройки» → записи: администраторы и права, справочники, удаление, корзина, модерация, откат правок."""

    def access_act(self, mid: str, act, actor_login) -> None:
        """Менеджер: сброс пароля (временный — в ответе один раз), выход везде, права и вход."""
        store = self.store
        if not any(x.get('id') == mid for x in (_loads(store.managers_list()) or [])):
            return self.err(404, 'Менеджер не найден')
        if act == 'reset':
            password, hours, until = auth_users.TempPassword.issue(store, mid, hash_password, actor_login or 'admin')
            self.log('reset_password', 'manager', mid, None, {'temp': True, 'hours': hours, 'until': until})
            return self.ok({'password': password, 'hours': hours, 'until': until})
        closed = auth_users.UserSession.drop_all(store, mid)
        self.log('logout_all', 'manager', mid, None, {'closedSessions': closed})
        return self.ok({'closed': closed})

    def users(self, data, actor_login) -> dict:
        store, users, act = self.store, accounts(self.store), data.get('action')
        login = (data.get('login') or '').strip()
        u = find_account(users, login)
        if act == 'add':
            check_login(login)
            if u:
                raise ValueError(f'Логин «{login}» уже занят')
            check_new_password(data.get('password') or '')
            u = {
                'login': login,
                'name': (data.get('name') or '').strip()[:80] or login,
                'pw': hash_password(data['password']),
                'created': _now(),
                'by': actor_login,
                'main': bool(data.get('main')),
                'rights': AdminRights.clean(data.get('rights')),
            }
            users.append(u)
            save_accounts(store, users)
            self.log('create_admin', 'admin', login, None, {'login': login, 'name': u['name'], 'main': u['main']})
            return {'ok': True}
        if not u:
            raise ValueError('Учётная запись не найдена')
        if act == 'edit':
            before = {'login': u['login'], 'name': u.get('name', '')}
            new_login = (data.get('newLogin') or u['login']).strip()
            if new_login.lower() != u['login'].lower():
                check_login(new_login)
                if find_account(users, new_login):
                    raise ValueError(f'Логин «{new_login}» уже занят')
            u['login'], u['name'] = new_login, (data.get('name') or '').strip()[:80] or new_login
            save_accounts(store, users)
            self.log('edit_admin', 'admin', u['login'], before, {'login': u['login'], 'name': u['name']})
            AdminSessions.rename(login, u['login'], u['name'])
            return {'ok': True}
        if act == 'rights':
            return self._rights(users, u, data)
        if act == 'password':
            check_new_password(data.get('password') or '')
            u['pw'] = hash_password(data['password'])
            save_accounts(store, users)
            AdminSessions.drop_login(
                u['login'], keep=_cookie_token(self.handler)
            )  # сменён пароль — другие входы закрыты
            self.log('set_password', 'admin', u['login'])
            return {'ok': True}
        if act == 'delete':
            if len(users) <= 1:
                raise ValueError('Нельзя удалить единственного администратора')
            if AdminRights.is_main(u) and self._mains(users) <= 1:
                raise ValueError('Это единственный главный администратор — сначала назначьте главным другого')
            if u['login'].lower() == actor_login.lower():
                raise ValueError('Нельзя удалить свою учётную запись — войдите под другим администратором')
            users.remove(u)
            save_accounts(store, users)
            AdminSessions.drop_login(u['login'])
            self.log('delete_admin', 'admin', u['login'], {'login': u['login'], 'name': u.get('name', '')}, None)
            return {'ok': True}
        raise ValueError('Неизвестное действие')

    @staticmethod
    def _mains(users: list) -> int:
        return sum(1 for acc in users if AdminRights.is_main(acc))

    def _rights(self, users: list, u: dict, data: dict) -> dict:
        """Главный или права по вкладкам и действиям; последнего главного разжаловать нельзя."""
        before = {'main': AdminRights.is_main(u), 'rights': AdminRights.clean(u.get('rights'))}
        main = bool(data.get('main'))
        if before['main'] and not main and self._mains(users) <= 1:
            raise ValueError('Это единственный главный администратор — сначала назначьте главным другого')
        u['main'], u['rights'] = main, AdminRights.clean(data.get('rights'))
        save_accounts(self.store, users)
        self.log('edit_admin_rights', 'admin', u['login'], before, {'main': main, 'rights': u['rights']})
        return {'ok': True}

    def listing(self, etype, query_text) -> dict:
        store, query_low = self.store, query_text.lower()
        if etype == 'kp':
            from kp_files import KpFiles

            metas = store.kp_all_meta()
            file_counts = KpFiles.of(store).counts(
                [x.get('id') for x in metas]
            )  # справочные документы — «📎» у КП (удаляет администратор)
            rows = [
                {
                    'id': x.get('id'),
                    'title': '№ {} — {}'.format(x.get('number', ''), x.get('client', '')),
                    'files': file_counts.get(x.get('id'), 0),
                    'sub': '{} · {} · {}'.format(
                        x.get('date', ''), x.get('manager') or '—', (x.get('items') or [''])[0]
                    ),
                }
                for x in metas
            ]
            rows.sort(key=lambda row: row['title'], reverse=True)
        elif etype == 'catalog':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(str(v) for v in ((x.get('attrs') or {}).get('maker'), x.get('spec')) if v),
                }
                for x in json.loads(store.catalog_light())
            ]
        elif etype == 'manager':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(v for v in (x.get('position'), x.get('phone')) if v),
                }
                for x in json.loads(store.managers_list())
            ]
        elif etype == 'supplier':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(v for v in (x.get('country'), x.get('currency')) if v),
                }
                for x in store.suppliers_list()
            ]
        else:  # контрагентов тысячи: ищем в базе, показываем первые 300
            found = store.clients_search(query_text, 300)
            rows = [
                {'id': x['id'], 'title': x.get('name', ''), 'sub': 'ИНН {}'.format(x.get('inn', ''))}
                for x in found['items']
            ]
            return {'total': found['total'], 'items': rows}
        if query_low:
            rows = [
                item
                for item in rows
                if query_low in (item['title'] + ' ' + item['sub'] + ' ' + str(item['id'])).lower()
            ]
        return {'total': len(rows), 'items': rows if etype != 'catalog' else rows[:300]}

    def delete(self, body) -> None:
        etype, ids = body.get('type'), body.get('ids') or []
        if etype not in ('kp', 'catalog', 'manager', 'client', 'supplier') or not isinstance(ids, list) or not ids:
            raise ValueError('Не выбрано, что удалить')
        if etype == 'catalog':  # название позиции — запросом по id, а не разбором всего каталога на каждую позицию
            found = {
                eid: self.store.one('SELECT name FROM catalog WHERE id=?', (eid,))
                for eid in ids
                if isinstance(eid, str)
            }
            titles = {eid: found[eid][0] if found.get(eid) else str(eid) for eid in ids}
        elif etype == 'client':  # контрагентов тысячи — по одному, а не списком
            titles = {eid: (self.store.client_get(str(eid)) or {}).get('name') or str(eid) for eid in ids}
        else:
            rows = {row['id']: row['title'] for row in self.listing(etype, '')['items']}
            titles = {eid: rows.get(eid) or str(eid) for eid in ids}
        count = 0
        for eid in ids:
            data = self.store.trash_put(etype, str(eid), titles.get(eid, str(eid)), actor(self.handler, True)[1])
            if data and etype == 'kp':
                from crm import DealBook

                DealBook.kp_moved(
                    self.store, str(eid), actor(self.handler, True)[1]
                )  # сумма сделки — без удалённого КП
            self.log(
                'delete_' + etype,
                etype,
                eid,
                {'title': titles.get(eid, '')} if data else None,
                None,
                result='success' if data else 'failed',
            )
            count += bool(data)
        return self.ok({'deleted': count})

    def desk(self) -> Any:
        from catalog_admin import ModerationDesk

        return ModerationDesk(self.store, actor(self.handler, True)[1], self.log)

    def review(self, eid, act, reason) -> Any:
        return self.desk().review(eid, act, reason)

    def trash(self, method, sub, query) -> None:
        """Корзина: список (?type=вид), восстановить, удалить навсегда одну запись, очистить (всё или один вид)."""
        from catalog_admin import TrashBin

        trash = TrashBin(self.store, self.log)
        if sub == 'trash':
            etype = query.get('type') or ''
            return self.ok(
                dict(
                    trash.items(etype if etype in TrashBin.TYPES else ''), days=SrvVal.get(self.store, 'srv.trashDays')
                )
            )
        if method != 'POST':
            return self.err(405, 'Нужен POST')
        if sub == 'trash/clear':
            return self.ok({'deleted': trash.clear(str(self.data().get('type') or ''))})
        match = re.match(r'^trash/(\d{1,9})/(restore|purge)$', sub)
        if not match:
            return self.err(404, 'Нет такого запроса')
        trash.restore(int(match.group(1))) if match.group(2) == 'restore' else trash.drop(int(match.group(1)))
        return self.ok()

    def toggle(self, data) -> None:
        before = moderation(self.store)
        enabled = bool(data.get('enabled'))
        pend = self.store.pending_list('pending')
        if not enabled and pend:
            how = data.get('pending')
            if how not in ('apply', 'reject', 'archive'):
                return self.err(409, f'Есть правки на модерации ({len(pend)}): выберите, что с ними сделать')
            for pending_item in pend:
                if how == 'archive':
                    self.store.pending_set(
                        pending_item['id'], 'archived', actor(self.handler, True)[1], 'Модерация отключена'
                    )
                else:
                    self.review(pending_item['id'], 'approve' if how == 'apply' else 'reject', 'Модерация отключена')
        _set_moderation(self.store, enabled, actor(self.handler, True)[1])
        self.log('toggle_moderation', 'settings', 'productEditModeration', before, moderation(self.store))
        return self.ok({'settings': moderation(self.store)})

    def rollback(self, aid) -> None:
        entry = self.store.audit_get(aid)
        if (
            not entry
            or entry['action'] not in ('edit_product', 'approve_edit')
            or not isinstance(entry.get('before'), dict)
        ):
            raise ValueError('Эту запись откатить нельзя')
        if any(isinstance(v, dict) and '__truncated__' in v for v in entry['before'].values()):
            raise ValueError('Правка слишком большая для отката — исправьте позицию вручную')
        cur = _loads(self.store.catalog_get(entry['entityId']))
        if cur is None:
            raise ValueError('Товара больше нет в каталоге')
        new = dict(cur)
        for k, v in entry['before'].items():
            if v == ABSENT:
                new.pop(k, None)
            else:
                new[k] = v
        self.store.catalog_put(entry['entityId'], json.dumps(new, ensure_ascii=False))
        before_diff, after_diff = diff(cur, new)
        self.log('rollback_edit', 'product', entry['entityId'], before_diff, dict(after_diff, __audit__=aid))
        return self.ok()
