"""Адреса программы: состояние сервера, списки и значения, логистика и перевозчики, тексты интерфейса, версия, календарь, свои настройки, копия и остановка, 1С."""

import os
import re
import socket
import threading
from datetime import datetime
from typing import Any

import admin
import defaults
import logistics_api
from cbr import cbr_rates
from cbr_cache import CbrCache
from config import DATA_DIR, DOCS_DIR, DOCS_SHARE, ROOT, SERVER_MODE, UPDATE_DIR, BadRequest, store
from net import Net
from onec import OneCApi, OneCConf, OneCSync
from web_base import Controller, route


class SystemController(Controller):
    @route(r'/api/ping')
    def ping(self) -> Any:
        base = {
            'ok': True,
            'local': self.is_local(),
            'mode': 'server' if SERVER_MODE else 'local',
            'host': socket.gethostname(),
        }
        if (
            getattr(self.handler, '_kp_login', False)
            and not self.handler._kp_user
            and admin.AdminSessions.of(self.handler) is None
        ):
            return self.send_json(base)  # до входа — без папок, путей и состава базы
        far = not self.is_local() and admin.AdminSessions.of(self.handler) is None  # по сети — без путей сервера
        return self.send_json(
            {
                'ok': True,
                'dataDir': '' if far else DATA_DIR,
                'docsDir': '' if far else DOCS_DIR,
                'local': self.is_local(),
                'mode': 'server' if SERVER_MODE else 'local',
                'docsShare': DOCS_SHARE,
                'host': socket.gethostname(),
                'port': self.server.server_address[1],
                'items': store().catalog_count(),
                'migrations': [
                    dict(row, backup=re.split(r'[\\/]', str(row.get('backup') or ''))[-1])
                    if far and isinstance(row, dict)
                    else row
                    for row in (store().kv_get('migrations') or [])[-2:]
                ],  # с другого компьютера — только имя архива, без папок сервера (как dataDir)
            }
        )


class SettingsController(Controller):
    MAX_UITEXTS = 3000  # изменённых текстов интерфейса

    @route(r'/api/lists', 'GET')  # списки и выборы от администратора (для всех; правка — /api/admin/lists)
    def lists(self) -> Any:
        from lists import ListStore

        return self.send_json(ListStore(store()).all())

    @route(r'/api/defaults', 'GET')  # значения по умолчанию от администратора (для всех)
    def defaults(self) -> Any:
        return self.send_json(defaults.get(store()))

    @route(r'/api/logistics/quote', 'POST')  # цены перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — итог по максимуму
    def quote(self) -> None:
        req = self.json_body()
        try:
            return self.send_json(logistics_api.DeliveryQuote(store(), req).run())
        except (ValueError, TypeError, KeyError) as exc:
            return self.text(400, f'Неверный запрос: {self.no_paths(exc)}')

    @route(r'/api/logistics/status', 'GET')
    def logistics_status(self) -> Any:
        return self.send_json(
            {
                'providers': logistics_api.providers(store()),
                'auto': store().kv_get('logisticsAuto'),
                'settings': logistics_api.auto_settings(store()),
            }
        )

    @route(r'/api/logistics/refresh', 'POST')  # обновить ставки по ATI.SU сейчас (администратор)
    def logistics_refresh(self) -> Any:
        try:
            rec = logistics_api.AutoRates.now(store())
        except Exception as exc:
            return self.text(502, f'ATI.SU: {self.no_paths(exc)}')
        return self.send_json(rec or {'error': 'Не задан ключ ATI.SU («Интеграции») или обновление уже идёт'})

    @route(r'/api/logistics/carriers', ('GET', 'PUT'))  # перевозчики: включение и адреса API (изменяет администратор)
    def logistics_carriers(self) -> Any:
        if self.method == 'PUT':
            data = self.json_body()
            with self.user_input():
                saved = logistics_api.CarrierApi.save(store(), data, admin.actor(self.handler)[1])
            return self.send_json(saved)
        return self.send_json(logistics_api.CarrierApi.public(store()))

    @route(r'/api/logistics/carriers/test', 'POST')  # пробный расчёт одного перевозчика (администратор)
    def logistics_carrier_test(self) -> Any:
        carrier = str(self.json_body().get('id') or '')
        with self.user_input():
            res = logistics_api.CarrierApi.test(store(), carrier)
        return self.send_json(res)

    @route(
        r'/api/logistics/china', ('GET', 'PUT')
    )  # доставка из Китая (только администратор): ставки экспедиторов, направления ATI.SU
    def china(self) -> None:
        from china_freight import ChinaFreight

        china = ChinaFreight(store())
        if self.method == 'PUT':
            rows = self.json_body().get('rows') or []
            with self.user_input():
                saved = china.save_rates(rows, admin.actor(self.handler)[1])
            return self.send_json(saved)
        return self.send_json(china.status())

    @route(r'/api/logistics/china/quote', 'POST')  # расчёт Китай → граница РФ (в экономику сделки не идёт)
    def china_quote(self) -> Any:
        from china_freight import ChinaFreight

        req = self.json_body()
        with self.user_input():
            res = ChinaFreight(store()).quote(req, CbrCache.get('cbr_last', cbr_rates))
        return self.send_json(res)

    @route(r'/api/logistics')  # тарифы доставки по России (общие для отдела; изменяет администратор)
    def logistics(self) -> Any:
        if self.method == 'PUT':
            try:
                body = self.json_body()
            except BadRequest:
                raise BadRequest('Неверный формат тарифов') from None
            with self.user_input():
                data = logistics_api.TariffInput.check(body)
            data['updatedAt'] = datetime.now().isoformat(timespec='seconds')
            data['updatedBy'] = admin.actor(self.handler)[1]
            store().kv_set('logistics', data)
            return self.send_json({'ok': True})
        return self.send_json(dict(store().kv_get('logistics') or {}, _auto=store().kv_get('logisticsAuto')))

    @route(r'/api/uitexts', 'GET')  # тексты интерфейса, изменённые администратором: {исходный текст: новый}
    def uitexts(self) -> None:
        return self.send_json(store().kv_get('uitexts') or {})

    @route(r'/api/uitexts', 'PUT')  # только администратор (admin.guard)
    def uitexts_put(self) -> Any:
        try:
            data = self.json_body()
        except BadRequest:
            raise BadRequest('Неверный формат') from None
        if len(data) > self.MAX_UITEXTS:
            raise BadRequest('Неверный формат')
        out = {str(k)[:2000]: str(v)[:4000] for k, v in data.items() if str(k).strip() and isinstance(v, str)}
        store().kv_set('uitexts', out)
        return self.send_json({'ok': True, 'count': len(out)})

    @route(r'/api/version', 'GET')  # версия и есть ли обновление; путь к папке — нет: адрес открыт до входа
    def version(self) -> None:
        import version

        return self.send_json({'version': version.VERSION, 'patched': bool(UPDATE_DIR)})

    @route(r'/api/calendar', 'GET')  # производственный календарь РФ (рабочие / банковские дни)
    def calendar(self) -> Any:
        import workcal

        with self.user_input():
            cal = workcal.year(store(), int(self.query.get('year') or 0))
        return self.send_json(cal)


class MeController(Controller):
    @route(r'/api/me/prefs', 'GET')
    def prefs(self) -> Any:
        from user_prefs import UserPrefs

        uid = admin.actor(self.handler, admin=False)[0]
        return self.send_json({'id': uid or '', 'prefs': UserPrefs(store()).get(uid) if uid else {}})

    @route(r'/api/me/prefs', 'PUT')
    def prefs_put(self) -> Any:
        from user_prefs import UserPrefs

        uid, name, _ = admin.actor(self.handler, admin=False)
        with self.user_input():
            prefs = UserPrefs(store()).save(uid, self.json_body(), name)
        return self.send_json({'id': uid, 'prefs': prefs})


class ServiceController(Controller):
    @route(r'/api/backup', 'POST')
    def backup(self) -> Any:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Резервная копия создаётся на компьютере-сервере'})
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        dst = store().backup(os.path.join(ROOT, 'backup', stamp, 'kp.zip'))  # архив: kp.sqlite3 внутри
        return self.send_json({'ok': True, 'path': dst, 'dir': os.path.dirname(dst)})

    # выключение — только с самого компьютера (файл «Остановить сервер», установщик, кнопка «Выход»); по сети — нельзя
    @route(r'/api/shutdown', 'POST')
    def shutdown(self) -> Any:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Сервер отдела выключается только на компьютере-сервере'})
        self.send_json({'ok': True})
        target = getattr(self.server, 'main_server', self.server)
        threading.Thread(target=target.shutdown, daemon=True).start()
        return None


class OneCController(Controller):
    """1С по OData: подключение, проверка связи, загрузка оплат — только администратор (см. admin.guard)."""

    @route(r'/api/onec', ('GET', 'PUT'))
    def conf(self) -> Any:
        conf = OneCConf(store())
        if self.method == 'PUT':
            with self.user_input():
                return self.send_json(conf.save(self.json_body()))
        return self.send_json(conf.public())

    @route(r'/api/onec/check', 'POST')
    def check(self) -> Any:
        try:
            OneCApi(OneCConf(store()).get()).check()
        except Exception as exc:  # причина — словами, без адреса и пароля
            return self.send_json({'ok': False, 'message': Net.why(exc)})
        return self.send_json({'ok': True, 'message': 'Связь с 1С есть'})

    @route(r'/api/onec/sync', 'POST')
    def sync(self) -> Any:
        try:
            return self.send_json({'ok': True, **OneCSync(store()).run()})
        except ValueError as exc:
            return self.text(400, str(exc))
        except Exception as exc:
            return self.send_json({'ok': False, 'message': Net.why(exc)})
