"""Обзор администратора: сведения о программе (SystemInfo), «Требует внимания» (Attention), сводка базы (DbOverview)."""

import os
import shutil
import socket
import sys
import time
from datetime import datetime, timedelta

import version
from defaults import SrvVal


class SystemInfo:
    def __init__(self, store, cfg) -> None:
        self.store, self.cfg = store, cfg

    @staticmethod
    def _free(path: str) -> int | None:
        try:
            u = shutil.disk_usage(path)
            return {'free': u.free, 'total': u.total}
        except OSError:
            return None

    @staticmethod
    def _os() -> str:
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
        c = self.cfg
        try:
            db = os.path.getsize(self.store.path)
        except OSError:
            db = 0
        return {
            'version': version.VERSION,
            'base': os.environ.get('KP_BASE_VERSION') or '',
            'patched': bool(os.environ.get('KP_UPDATE_DIR')),
            'frozen': c.FROZEN,
            'mode': 'server' if c.SERVER_MODE else 'local',
            'host': socket.gethostname(),
            'port': c.BASE_PORT,
            'root': c.ROOT,
            'dataDir': c.DATA_DIR,
            'docsDir': c.DOCS_DIR,
            'docsShare': c.DOCS_SHARE,
            'settingsFile': os.path.join(c.ROOT, 'settings.json'),
            'dbBytes': db,
            'disk': self._free(c.DATA_DIR),
            'python': sys.version.split()[0],
            'os': self._os(),
            'started': datetime.fromtimestamp(c.STARTED).isoformat(timespec='seconds'),
            'uptime': int(time.time() - c.STARTED),
            'allowedHosts': list(c.ALLOWED_HOSTS),
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
            self._ai,
            self._disk,
            self._login,
            self._trash,
            self._health,
        ):
            try:
                out.extend(check())
            except Exception:  # одна проверка не должна ломать обзор
                pass
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

        b = maintenance.state(self.store).get('backup') or {}
        if not b.get('at'):
            return [{'level': 'warn', 'text': 'Автоматической копии базы ещё не было', 'tab': 'backup'}]
        if not b.get('ok'):
            return [
                {
                    'level': 'bad',
                    'text': 'Последняя копия базы с ошибкой: {}'.format((b.get('error') or '')[:120]),
                    'tab': 'backup',
                    'key': 'backup',
                    'alert': True,
                }
            ]
        if datetime.fromisoformat(b['at'][:19]) < datetime.now() - timedelta(
            days=SrvVal.get(self.store, 'srv.backupStaleDays')
        ):
            return [
                {
                    'level': 'warn',
                    'text': 'Копия базы не обновлялась с {}'.format(b['at'][:10]),
                    'tab': 'backup',
                    'key': 'backup',
                    'alert': True,
                }
            ]
        return []

    def _mirror(self):
        from backup_mirror import MirrorBackup

        mb = MirrorBackup(self.store, self.cfg.DATA_DIR)
        c, s = mb.config(), mb.state()
        if not c['on']:
            return [
                {
                    'level': 'info',
                    'text': 'Копии базы хранятся только на этом диске — укажите вторую папку (сетевой диск, флешку, облако)',
                    'tab': 'backup',
                }
            ]
        if mb.stale():
            why = s.get('error') or ('последняя — {}'.format(s['at'][:10]) if s.get('at') else 'ещё не было')
            return [
                {
                    'level': 'bad' if s.get('error') else 'warn',
                    'text': f'Копия во вторую папку не обновляется: {why[:160]}',
                    'tab': 'backup',
                    'key': 'mirror',
                    'alert': True,
                }
            ]
        return []

    def _update(self):
        from app_update import Updater

        s = Updater(self.store, self.cfg.ROOT, self.cfg.DATA_DIR).status()
        f = s.get('failed')
        out = (
            [
                {
                    'level': 'bad',
                    'text': 'Обновление {} не запустилось — программа сама вернулась к версии {}. Причина: {}'.format(
                        f['version'], s['current'], f.get('reason', '')[:160]
                    ),
                    'tab': 'updates',
                    'key': 'update-failed',
                    'alert': True,
                }
            ]
            if f
            else []
        )
        if s['available'] and not (f and f['version'] == s['last']['version']):  # ту же неудачную версию не предлагать
            out.append(
                {
                    'level': 'warn',
                    'text': 'Доступна новая версия {} (работает {})'.format(s['last']['version'], s['current']),
                    'tab': 'updates',
                }
            )
        elif s['pending']:
            out.append(
                {
                    'level': 'warn',
                    'text': 'Обновление {} установлено, но программа ещё не перезапущена'.format(s['installed']),
                    'tab': 'updates',
                }
            )
        night = s.get('nightLast') or {}
        if s.get('nightly', 'off') != 'off' and not s.get('nightSupported'):
            out.append(
                {
                    'level': 'info',
                    'text': 'Ночные обновления включены, но работают только у программы из EXE 3.51 и новее',
                    'tab': 'updates',
                }
            )
        elif s.get('nightly', 'off') != 'off' and night.get('error'):
            out.append(
                {
                    'level': 'warn',
                    'text': 'Ночное обновление {}: {}'.format(night.get('night', ''), night.get('result', '')[:160]),
                    'tab': 'updates',
                }
            )
        return out

    def _task(self):
        t = SystemInfo(self.store, self.cfg).task()
        if not t or not t.get('exists') or not t.get('problems'):
            return []
        why = ' (исправить не удалось: {})'.format(t['error'][:120]) if t.get('error') else ''
        return [
            {
                'level': 'bad',
                'text': 'Задача Планировщика сервера отдела {}{} — запустите «server-setup\\1. Установить сервер отдела.bat» '
                'от имени администратора'.format(', '.join(t['problems']), why),
                'tab': 'system',
                'key': 'task',
                'alert': True,
            }
        ]

    def _errors(self):
        from server_log import ServerLog

        lg = ServerLog.of(self.cfg.DATA_DIR)
        n = lg.count_since(24)
        return (
            [
                {
                    'level': 'warn',
                    'text': f'Ошибки сервера за сутки: {n} — подробности в «Системе» (журнал сервера)',
                    'tab': 'system',
                    'key': 'errors',
                    'alert': True,
                }
            ]
            if n
            else []
        )

    def _moderation(self):
        n = len(self.store.pending_list('pending'))
        return [{'level': 'warn', 'text': f'Правок товаров на модерации: {n}', 'tab': 'moderation'}] if n else []

    def _mail(self):
        from features import FeatureAccess
        from kp_track import Mailer

        if not Mailer(self.store).on():
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

    def _ai(self):
        import ai_llm

        s = ai_llm.settings(self.store)
        if s['enabled'] and not ai_llm.status(self.store)['enabled']:
            return [{'level': 'warn', 'text': 'Нейросеть включена, но не задан ключ API', 'tab': 'ai'}]
        return []

    def _disk(self):
        d = SystemInfo._free(self.cfg.DATA_DIR)
        if d and d['free'] < SrvVal.get(self.store, 'srv.lowDiskGB') * 1024**3:
            return [
                {
                    'level': 'bad',
                    'text': 'На диске с базой осталось %.1f ГБ' % (d['free'] / 1024**3),
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

    def _trash(self):
        n = len(self.store.trash_list())
        return (
            [
                {
                    'level': 'info',
                    'text': f'В корзине записей: {n} (хранятся {SrvVal.get(self.store, "srv.trashDays")} дн.)',
                    'tab': 'trash',
                }
            ]
            if n
            else []
        )


class DbOverview:
    """Сводка над «Базой и копиями»: размер, место на диске, записи разделов, последняя автокопия, вторая папка."""

    COUNTS = ('catalog', 'kp', 'clients', 'managers', 'deals')

    def __init__(self, store, data_dir: str) -> None:
        self.store, self.data_dir = store, data_dir

    def _count(self, table: str) -> int:
        try:
            return self.store.one(f'SELECT COUNT(*) FROM "{table}"')[0]  # имя — из COUNTS, не из запроса
        except Exception:  # таблицы ещё нет (миграция откачена)
            return None

    def _old(self, b):
        try:
            return datetime.fromisoformat(b['at'][:19]) < datetime.now() - timedelta(
                days=SrvVal.get(self.store, 'srv.backupStaleDays')
            )
        except (KeyError, TypeError, ValueError):
            return True

    def get(self):
        import maintenance
        from backup_mirror import MirrorBackup

        out = maintenance.summary(self.store, self.data_dir)
        mb = MirrorBackup(self.store, self.data_dir).status()
        out.update(
            disk=SystemInfo._free(self.data_dir),
            counts={t: self._count(t) for t in self.COUNTS},
            stale=self._old(out.get('backup') or {}),
            mirror={k: mb.get(k) for k in ('on', 'path', 'last', 'stale', 'running')},
        )
        return out
