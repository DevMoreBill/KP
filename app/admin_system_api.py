"""«Настройки» → система, обслуживание базы и история изменений."""

import os
import re
import threading
from datetime import datetime

from admin_access import actor
from admin_base import AdminBase
from server_log import ServerLog


class AdminSystemApi(AdminBase):
    """«Настройки» → система, обслуживание базы и история изменений."""

    AUDIT_YEARS_MAX = 20

    def system(self, method, sub, query, actor_login) -> None:
        import config
        from admin_overview import Attention, Readiness, SystemInfo
        from app_update import Restarter, UpdateError, Updater

        store, updater = self.store, Updater(self.store, config.ROOT, config.DATA_DIR)
        if sub == 'system' and method == 'GET':
            return self.ok(dict(SystemInfo(store, config).get(), local=self.handler.is_local()))
        if sub == 'attention' and method == 'GET':
            return self.ok({'items': Attention(store, config).items()})
        if sub == 'readiness' and method == 'GET':
            return self.ok({'items': Readiness(store, config).items()})
        if sub == 'log' and method == 'GET':  # журнал сервера: последние ошибки (data/logs/kp.log)
            log = ServerLog.of(config.DATA_DIR)
            return self.ok(
                {
                    'errors': log.errors(30),
                    'day': log.count_since(24),
                    'bytes': log.size(),
                    'files': len(log.files()),
                    'dir': log.folder,
                    'local': self.handler.is_local(),
                }
            )
        if sub == 'log/download' and method == 'GET':
            log = ServerLog.of(config.DATA_DIR)
            return self.handler.send(
                200,
                'text/plain; charset=utf-8',
                log.text().encode('utf-8'),
                self.handler.attachment('kp-log_{}.txt'.format(datetime.now().strftime('%Y-%m-%d_%H%M'))),
            )
        if sub.startswith('alerts'):  # письма администратору о проблемах (admin_alerts.py)
            from admin_alerts import AdminAlerts

            alerts = AdminAlerts(store, config)
            try:
                if sub == 'alerts' and method == 'GET':
                    return self.ok(alerts.public())
                if sub == 'alerts' and method == 'POST':
                    before = alerts.public()
                    res = alerts.save(self.data(), actor_login)
                    self.log(
                        'edit_settings',
                        'settings',
                        'alerts',
                        {'on': before['on'], 'to': before['to']},
                        {'on': res['on'], 'to': res['to']},
                    )
                    return self.ok(res)
                if sub == 'alerts/test' and method == 'POST':
                    return self.ok(alerts.test())
            except (ValueError, RuntimeError) as exc:
                return self.err(400, str(exc))
            return self.err(404, 'not found')
        if sub == 'restart' and method == 'POST':
            self.log('restart', 'system', config.APP_TITLE)
            ServerLog.note(f'Перезапуск из «Настроек» ({actor_login or "администратор"})')
            self.ok({'ok': True, 'delay': Restarter.DELAY})
            Restarter(config.SERVER_MODE).restart(getattr(self.handler.server, 'main_server', self.handler.server))
            return None
        if sub == 'folder' and method == 'POST':
            if not self.handler.is_local():
                return self.err(403, 'Папки открываются только на компьютере, где работает программа')
            from desktop import open_folder

            path = {
                'data': config.DATA_DIR,
                'docs': config.DOCS_DIR,
                'root': config.ROOT,
                'backup': os.path.join(config.DATA_DIR, 'backup'),
                'logs': os.path.join(config.DATA_DIR, 'logs'),
            }.get(str(self.data().get('which')))
            if not path or not os.path.isdir(path):
                return self.err(404, 'Папки нет')
            open_folder(path)
            return self.ok()
        try:
            if sub == 'update' and method == 'GET':
                return self.ok(updater.status())
            if sub == 'update' and method == 'POST':
                data = self.data()
                res = updater.configure(data, actor_login or 'admin')
                self.log(
                    'edit_settings',
                    'settings',
                    'update',
                    None,
                    {
                        k: ('задан' if k == 'token' and data[k] else data[k])
                        for k in data
                        if k in ('repo', 'auto', 'token', 'nightly', 'nightHour')
                    },
                )
                return self.ok(res)
            if sub == 'update/check' and method == 'POST':
                return self.ok(updater.check())
            if sub in ('update/download', 'update/upload') and method == 'POST':
                res = (
                    updater.download_latest(actor_login or 'admin')
                    if sub == 'update/download'
                    else (updater.reinstall if query.get('force') == '1' else updater.install)(
                        self.handler.body(), actor_login or 'admin', source='файл ' + str(query.get('name') or '')[:80]
                    )
                )
                self.log(
                    'update_install',
                    'system',
                    res['version'],
                    {'version': res['from']},
                    {'version': res['version'], 'files': res['files']},
                )
                return self.ok(res)
            if sub == 'update/rollback' and method == 'POST':
                res = updater.rollback(actor_login or 'admin')
                self.log('update_rollback', 'system', res['version'])
                return self.ok(res)
            if sub == 'update/remove' and method == 'POST':
                res = updater.remove(actor_login or 'admin')
                self.log('update_remove', 'system', 'EXE')
                return self.ok(res)
        except UpdateError as exc:
            return self.err(422, str(exc))
        return self.err(404, 'not found')

    def history(self, method, sub, query) -> None:
        from settings_history import SettingsHistory

        history = SettingsHistory(self.store)
        if sub == 'history' and method == 'GET':
            key = query.get('key') if query.get('key') in SettingsHistory.KEYS else None
            limit, offset = (
                max(1, min(int(query.get('limit') or 100), 500)),
                max(0, min(int(query.get('offset') or 0), SettingsHistory.KEEP)),
            )
            return self.ok({'items': history.items(key, limit, offset), 'keys': SettingsHistory.KEYS})
        match = re.match(r'^history/(\d{1,9})(/rollback)?$', sub)
        if match and method == 'GET' and not match.group(2):
            return self.ok(history.get(match.group(1)))
        if match and method == 'POST' and match.group(2):
            res = history.rollback(match.group(1), actor(self.handler, True)[1])
            self.log('rollback_settings', 'settings', res['key'], None, {'history': res['id'], 'title': res['title']})
            return self.ok(res)
        return self.err(404, 'not found')

    def maint(self, method, sub, query) -> None:
        import maintenance

        store = self.store
        data_dir = os.path.dirname(store.path)
        img_dir = os.path.join(data_dir, 'img')
        if sub == 'maint' and method == 'GET':
            return self.ok(maintenance.summary(store, data_dir))
        if sub == 'maint/health':  # проверка «здоровья» базы: последняя (GET) или сейчас (POST)
            import config
            from db_health import DbHealth

            health = DbHealth(store, config.DATA_DIR, config.DOCS_DIR)
            if method == 'POST':
                res = health.run()
                self.log(
                    'db_health',
                    'db',
                    'health',
                    None,
                    {k: (v.get('n') if isinstance(v, dict) else v) for k, v in res.items()},
                )
                return self.ok(res)
            return self.ok(health.last())
        if sub == 'maint/overview' and method == 'GET':  # сводка над вкладкой «База и копии»
            from admin_overview import DbOverview

            return self.ok(DbOverview(store, data_dir).get())
        if sub == 'maint/backup' and method == 'POST':
            rec = maintenance.DbCopy.now(store, data_dir)
            self.log(
                'backup_db',
                'db',
                'auto',
                None,
                {'ok': rec.get('ok'), 'file': os.path.basename(rec.get('file') or '')},
                result='success' if rec.get('ok') else 'failed',
            )
            from backup_mirror import MirrorBackup

            mirror = MirrorBackup(store, data_dir)
            if mirror.config()['on'] and not mirror.status()['running']:
                threading.Thread(target=mirror.run, daemon=True, name='backup-mirror').start()
            return self.ok(maintenance.summary(store, data_dir))
        if sub.startswith('maint/mirror'):  # вторая папка для копий базы (сетевой диск, флешка, облако)
            from backup_mirror import MirrorBackup

            mirror = MirrorBackup(store, data_dir)
            if sub == 'maint/mirror' and method == 'GET':
                return self.ok(mirror.status())
            if sub == 'maint/mirror' and method == 'POST':
                res = mirror.save(self.data(), actor(self.handler, True)[1])
                self.log(
                    'edit_settings', 'settings', 'backup2', None, {k: res[k] for k in ('on', 'path', 'keep', 'images')}
                )
                return self.ok(res)
            if sub == 'maint/mirror/check' and method == 'POST':
                return self.ok(mirror.check_any(self.data()))
            if sub == 'maint/mirror/run' and method == 'POST':
                res = mirror.start()
                self.log('backup_db', 'db', 'mirror', None, {'path': res.get('path')})
                return self.ok(res)
        if sub == 'maint/run' and method == 'POST':
            rec = maintenance.db_maintenance(store, vacuum=True)
            self.log('maintain_db', 'db', 'vacuum', None, rec.get('vacuum'))
            return self.ok(maintenance.summary(store, data_dir))
        if sub == 'maint/audit' and method == 'POST':
            years = int(self.data().get('years') or 0)
            if years < 1 or years > self.AUDIT_YEARS_MAX:
                raise ValueError('Срок хранения журнала — от 1 до 20 лет')
            cfg = store.kv_get('settings') or {}
            cfg['auditYears'] = years
            store.kv_set('settings', cfg)
            count = maintenance.archive_audit(store, data_dir, years)
            self.log('edit_settings', 'settings', 'auditYears', None, {'years': years, 'archived': count})
            return self.ok(dict(maintenance.summary(store, data_dir), archivedNow=count))
        if sub == 'maint/images' and method == 'GET':
            lst = maintenance.unused_images(store, img_dir)
            return self.ok(
                {'count': len(lst), 'bytes': sum(x['bytes'] for x in lst), 'sample': [x['rel'] for x in lst[:20]]}
            )
        if sub == 'maint/images' and method == 'POST':
            import feeds  # хранилище изображений: его индекс одинаковых картинок после очистки строится заново

            res = maintenance.purge_images(store, img_dir, feeds.IMAGE_STORE)
            self.log('purge_images', 'images', 'unused', None, res)
            return self.ok(res)
        return self.err(404, 'not found')
