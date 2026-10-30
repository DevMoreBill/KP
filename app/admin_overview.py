"""Обзор администратора: сведения о программе (SystemInfo), «Требует внимания» (Attention), сводка базы (DbOverview)."""

import os
import shutil
import socket
import sys
import time
from datetime import datetime, timedelta

import version
from defaults import SrvVal
from server_log import ServerLog


class SystemInfo:
    def __init__(self, store, cfg) -> None:
        self.store, self.cfg = store, cfg

    @staticmethod
    def _free(path: str) -> dict | None:
        try:
            u = shutil.disk_usage(path)
            return {'free': u.free, 'total': u.total}
        except OSError:
            return None

    @staticmethod
    def _os_name() -> str:
        try:  # platform может не быть в EXE прежних версий
            import platform

            return platform.platform(terse=True)
        except ImportError:
            return sys.platform

    def task(self) -> dict | None:
        """Задача Планировщика сервера отдела: итог проверки или «проверяется»."""
        from server_task import ServerTask

        if not ServerTask.applicable(self.cfg.SERVER_MODE):
            return None
        return ServerTask(self.store).status() or {'pending': True}

    def get(self):
        conf = self.cfg
        try:
            db = os.path.getsize(self.store.path)
        except OSError:
            db = 0
        return {
            'version': version.VERSION,
            'base': os.environ.get('KP_BASE_VERSION') or '',
            'patched': bool(os.environ.get('KP_UPDATE_DIR')),
            'frozen': conf.FROZEN,
            'mode': 'server' if conf.SERVER_MODE else 'local',
            'host': socket.gethostname(),
            'port': conf.BASE_PORT,
            'root': conf.ROOT,
            'dataDir': conf.DATA_DIR,
            'docsDir': conf.DOCS_DIR,
            'docsShare': conf.DOCS_SHARE,
            'settingsFile': os.path.join(conf.ROOT, 'settings.json'),
            'dbBytes': db,
            'disk': self._free(conf.DATA_DIR),
            'python': sys.version.split()[0],
            'os': self._os_name(),
            'started': datetime.fromtimestamp(conf.STARTED).isoformat(timespec='seconds'),
            'uptime': int(time.time() - conf.STARTED),
            'allowedHosts': list(conf.ALLOWED_HOSTS),
            'task': self.task(),
        }


class Attention:
    """Пункты «Требует внимания» {level, text, tab}; с key и alert — письмом администратору."""

    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg

    def items(self) -> list[dict]:
        out = []
        for check in (
            self._catalog,
            self._backup,
            self._mirror,
            self._update,
            self._task,
            self._errors,
            self._moderation,
            self._mail,
            self._neural,
            self._disk,
            self._login,
            self._trash,
            self._health,
            self._night,
            self._feedback,
            self._feeds,
        ):
            try:
                out.extend(check())
            except Exception as exc:  # одна проверка не должна ломать обзор, но сбой её — в журнал сервера
                ServerLog.failure(f'«Главная»: проверка {check.__name__}', exc)
        order = {'bad': 0, 'warn': 1, 'info': 2}
        return sorted(out, key=lambda x: order.get(x['level'], 3))

    def _catalog(self):
        if self.store.catalog_count():
            return []
        return [
            {
                'level': 'warn',
                'text': 'Каталог пуст: каталог и фото хранятся на сервере отдела — работайте по его адресу или загрузите сюда файл базы (фото — папка data\\img сервера)',
                'tab': 'backup',
            }
        ]

    def _backup(self):
        import maintenance

        backup = maintenance.state(self.store).get('backup') or {}
        if not backup.get('at'):
            return [{'level': 'warn', 'text': 'Автоматической копии базы ещё не было', 'tab': 'backup', 'do': 'backup'}]
        if not backup.get('ok'):
            return [
                {
                    'level': 'bad',
                    'text': 'Последняя копия базы с ошибкой: {}'.format((backup.get('error') or '')[:120]),
                    'tab': 'backup',
                    'do': 'backup',
                    'key': 'backup',
                    'alert': True,
                }
            ]
        if datetime.fromisoformat(backup['at'][:19]) < datetime.now() - timedelta(
            days=SrvVal.get(self.store, 'srv.backupStaleDays')
        ):
            return [
                {
                    'level': 'warn',
                    'text': 'Копия базы не обновлялась с {}'.format(backup['at'][:10]),
                    'tab': 'backup',
                    'do': 'backup',
                    'key': 'backup',
                    'alert': True,
                }
            ]
        return []

    def _mirror(self):
        from backup_mirror import MirrorBackup

        mirror = MirrorBackup(self.store, self.cfg.DATA_DIR)
        conf, state = mirror.config(), mirror.state()
        if not conf['on']:
            return [
                {
                    'level': 'info',
                    'text': 'Копии базы хранятся только на этом диске — укажите вторую папку (сетевой диск, флешку, облако)',
                    'tab': 'backup',
                }
            ]
        if mirror.stale():
            why = state.get('error') or (
                'последняя — {}'.format(state['at'][:10]) if state.get('at') else 'ещё не было'
            )
            return [
                {
                    'level': 'bad' if state.get('error') else 'warn',
                    'text': f'Копия во вторую папку не обновляется: {why[:160]}',
                    'tab': 'backup',
                    'key': 'mirror',
                    'alert': True,
                }
            ]
        return []

    def _update(self):
        from app_update import Updater

        status = Updater(self.store, self.cfg.ROOT, self.cfg.DATA_DIR).status()
        failed = status.get('failed')
        out = (
            [
                {
                    'level': 'bad',
                    'text': 'Обновление {} не запустилось — программа сама вернулась к версии {}. Причина: {}'.format(
                        failed['version'], status['current'], failed.get('reason', '')[:160]
                    ),
                    'tab': 'updates',
                    'key': 'update-failed',
                    'alert': True,
                }
            ]
            if failed
            else []
        )
        if status['available'] and not (
            failed and failed['version'] == status['last']['version']
        ):  # ту же неудачную версию не предлагать
            out.append(
                {
                    'level': 'warn',
                    'text': 'Доступна новая версия {} (работает {})'.format(
                        status['last']['version'], status['current']
                    ),
                    'tab': 'updates',
                    'do': 'update' if (status['last'] or {}).get('asset') else '',
                }
            )
        elif status['pending']:
            out.append(
                {
                    'level': 'warn',
                    'text': 'Обновление {} установлено, но программа ещё не перезапущена'.format(status['installed']),
                    'tab': 'updates',
                    'do': 'restart',
                }
            )
        night = status.get('nightLast') or {}
        if status.get('nightly', 'off') != 'off' and not status.get('nightSupported'):
            out.append(
                {
                    'level': 'info',
                    'text': 'Ночные обновления включены, но работают только у программы из EXE 3.51 и новее',
                    'tab': 'updates',
                }
            )
        elif status.get('nightly', 'off') != 'off' and night.get('error'):
            out.append(
                {
                    'level': 'warn',
                    'text': 'Ночное обновление {}: {}'.format(night.get('night', ''), night.get('result', '')[:160]),
                    'tab': 'updates',
                }
            )
        return out

    def _task(self):
        task = SystemInfo(self.store, self.cfg).task()
        if not task or not task.get('exists') or not task.get('problems'):
            return []
        why = ' (исправить не удалось: {})'.format(task['error'][:120]) if task.get('error') else ''
        return [
            {
                'level': 'bad',
                'text': 'Задача Планировщика сервера отдела {}{} — запустите «server-setup\\1. Установить сервер отдела.bat» '
                'от имени администратора'.format(', '.join(task['problems']), why),
                'tab': 'system',
                'key': 'task',
                'alert': True,
            }
        ]

    def _errors(self):
        log = ServerLog.of(self.cfg.DATA_DIR)
        count = log.count_since(24)
        return (
            [
                {
                    'level': 'warn',
                    'text': f'Ошибки сервера за сутки: {count} — подробности в «Системе» (журнал сервера)',
                    'tab': 'system',
                    'key': 'errors',
                    'alert': True,
                }
            ]
            if count
            else []
        )

    def _feedback(self):
        from feedback import Feedback

        rows = Feedback(self.store).new()
        if not rows:
            return []
        last = rows[-1]
        text = 'Сообщений о проблемах от менеджеров: {} (последнее — {}: «{}»)'.format(
            len(rows), last.get('by') or 'менеджер', str(last.get('text') or '')[:80]
        )
        return [
            {
                'level': 'warn',
                'text': text,
                'tab': 'feedback',
                'act': 'Прочитать',
                'do': 'feedback',
                'key': f'feedback:{last.get("id")}',
                'alert': True,
            }
        ]

    def _feeds(self):
        import feeds

        out = []
        for feed in feeds.feeds(self.store):
            last = next(iter(feeds.log_of(self.store, feed.get('id') or '')), None)
            if (
                not (isinstance(last, dict) and last.get('error'))
                or (feeds.JOBS.get(feed['id']) or {}).get('state') == 'run'
            ):
                continue
            kind = 'загрузка' if last.get('kind') == 'import' else 'проверка'
            out.append(
                {
                    'level': 'warn',
                    'text': 'Фид «{}»: последняя {} с ошибкой — {}'.format(
                        feed.get('name') or feed['id'], kind, str(last['error'])[:140]
                    ),
                    'tab': 'feeds',
                    'do': 'feed:' + feed['id'],
                    'key': 'feed:' + feed['id'],
                }
            )
        return out

    def _moderation(self):
        count = len(self.store.pending_list('pending'))
        return (
            [
                {
                    'level': 'warn',
                    'text': f'Правок товаров на модерации: {count}',
                    'tab': 'moderation',
                    'do': 'moderation',
                }
            ]
            if count
            else []
        )

    def _mail(self):
        from features import FeatureAccess
        from kp_track import Mailer

        if not Mailer(self.store).enabled():
            if (self.store.kv_get('alerts') or {}).get('on'):
                return [
                    {
                        'level': 'warn',
                        'text': 'Письма администратору о проблемах включены, но почта не настроена',
                        'tab': 'mail',
                    }
                ]
            if FeatureAccess(self.store).is_on('mail'):
                return [
                    {'level': 'info', 'text': 'Отправка КП по почте включена, но почта не настроена', 'tab': 'mail'}
                ]
        return []

    def _neural(self):
        import ai_llm

        conf = ai_llm.settings(self.store)
        if conf['enabled'] and not ai_llm.status(self.store)['enabled']:
            return [{'level': 'warn', 'text': 'Нейросеть включена, но не задан ключ API', 'tab': 'ai'}]
        return []

    def _disk(self):
        free = SystemInfo._free(self.cfg.DATA_DIR)
        if free and free['free'] < SrvVal.get(self.store, 'srv.lowDiskGB') * 1024**3:
            return [
                {
                    'level': 'bad',
                    'text': 'На диске с базой осталось %.1f ГБ' % (free['free'] / 1024**3),
                    'tab': 'system',
                    'key': 'disk',
                    'alert': True,
                }
            ]
        return []

    def _login(self):
        import auth_users

        if not auth_users.enabled(self.store) and self.cfg.SERVER_MODE:
            return [
                {
                    'level': 'warn',
                    'tab': 'access',
                    'act': 'Включить вход',
                    'text': 'Сервер отдела работает без входа по паролю: любой компьютер в сети видит экономику и черновики всех '
                    'менеджеров и закупку в каталоге. Задайте менеджерам пароли и включите вход',
                }
            ]
        return []

    def _health(self):
        from db_health import DbHealth

        return DbHealth(self.store).attention()

    def _night(self):
        from db_health import NightCheck
        from features import FeatureAccess

        return (
            NightCheck(self.store, self.cfg.DATA_DIR).attention() if FeatureAccess(self.store).is_on('dbNight') else []
        )

    def _trash(self):
        count = len(self.store.trash_list())
        return (
            [
                {
                    'level': 'info',
                    'text': f'В корзине записей: {count} (хранятся {SrvVal.get(self.store, "srv.trashDays")} дн.)',
                    'tab': 'trash',
                }
            ]
            if count
            else []
        )


class Readiness:
    """«Готовность программы» на главной «Настроек»: что настроено из нужного отделу ({key, label, ok, tab})."""

    def __init__(self, store, cfg) -> None:
        self.store, self.cfg = store, cfg

    def items(self) -> list[dict]:
        checks = (
            ('catalog', 'Каталог оборудования заполнен', 'catalog:goods', self._catalog),
            ('managers', 'Менеджеры добавлены', 'managers', self._managers),
            ('login', 'Вход менеджеров по паролю', 'managers', self._login),
            ('mail', 'Почта для отправки КП', 'mail', self._mail),
            ('backup', 'Автоматические копии базы', 'backup', self._backup),
            ('mirror', 'Вторая папка для копий', 'backup', self._mirror),
            ('checko', 'Проверка контрагентов (ключ Checko)', 'services', self._checko),
            ('ai', 'Нейросеть для заполнения карточек', 'services', self._neural),
            ('bitrix', 'Связь с Битрикс24', 'bitrix', self._bitrix),
        )
        out = []
        for key, label, tab, check in checks:
            try:
                done = bool(check())
            except Exception:  # одна проверка не должна ломать главную
                done = False
            out.append({'key': key, 'label': label, 'ok': done, 'tab': tab})
        return out

    def _catalog(self) -> bool:
        return bool(self.store.catalog_count())

    def _managers(self) -> bool:
        return bool(self.store.scalar('SELECT COUNT(*) FROM managers'))

    def _login(self) -> bool:
        import auth_users

        return auth_users.enabled(self.store)

    def _mail(self) -> bool:
        return bool((self.store.kv_get('mail') or {}).get('host'))

    def _backup(self) -> bool:
        import maintenance

        return bool((maintenance.state(self.store).get('backup') or {}).get('ok'))

    def _mirror(self) -> bool:
        from backup_mirror import MirrorBackup

        return bool(MirrorBackup(self.store, self.cfg.DATA_DIR).config()['on'])

    def _checko(self) -> bool:
        from counterparty import CheckoApi

        return bool(CheckoApi(self.store).key())

    def _neural(self) -> bool:
        import ai_llm

        return bool(ai_llm.status(self.store)['enabled'])

    def _bitrix(self) -> bool:
        from bitrix import BitrixConf

        return BitrixConf(self.store).enabled()


class DbOverview:
    """Сводка над «Базой и копиями»: размер, место на диске, записи разделов, последняя автокопия, вторая папка."""

    COUNTS = ('catalog', 'kp', 'clients', 'managers', 'deals')

    def __init__(self, store, data_dir: str) -> None:
        self.store, self.data_dir = store, data_dir

    def _count(self, table: str) -> int | None:
        try:
            return self.store.scalar(f'SELECT COUNT(*) FROM "{table}"')  # имя — из COUNTS, не из запроса
        except Exception:  # таблицы ещё нет (миграция откачена)
            return None

    def _old(self, backup):
        try:
            return datetime.fromisoformat(backup['at'][:19]) < datetime.now() - timedelta(
                days=SrvVal.get(self.store, 'srv.backupStaleDays')
            )
        except (KeyError, TypeError, ValueError):
            return True

    def get(self):
        import maintenance
        from backup_mirror import MirrorBackup

        out = maintenance.summary(self.store, self.data_dir)
        mirror = MirrorBackup(self.store, self.data_dir).status()
        out.update(
            disk=SystemInfo._free(self.data_dir),
            counts={table: self._count(table) for table in self.COUNTS},
            stale=self._old(out.get('backup') or {}),
            mirror={k: mirror.get(k) for k in ('on', 'path', 'last', 'stale', 'running')},
        )
        return out
