# -*- coding: utf-8 -*-
"""Обзор для администратора: сведения о программе и компьютере, список «Требует внимания».

• SystemInfo — версия (EXE и обновление), режим (компьютер / сервер отдела), адрес, папки, свободное место, время работы.
• Attention — что администратору стоит сделать сейчас: правки на модерации, копия базы не сделана или с ошибкой, есть новая
  версия, функция включена, но не настроена (почта, нейросеть), мало места на диске, корзина, задача Планировщика сервера
  отдела с настройками не для сервера. У пункта — важность и вкладка «Настроек», где это решается.
"""
import os
import shutil
import socket
import sys
import time
from datetime import datetime, timedelta

import version


class SystemInfo:
    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg

    @staticmethod
    def _free(path):
        try:
            u = shutil.disk_usage(path)
            return {'free': u.free, 'total': u.total}
        except OSError:
            return None

    @staticmethod
    def _os():
        try:                 # модуль platform может отсутствовать в EXE прежних версий (обновление ставится поверх них)
            import platform
            return platform.platform(terse=True)
        except ImportError:
            return sys.platform

    def task(self):
        """Задача Планировщика сервера отдела (только Windows и режим сервера): итог проверки или «проверяется»."""
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
        return {'version': version.VERSION, 'base': os.environ.get('KP_BASE_VERSION') or '', 'patched': bool(os.environ.get('KP_UPDATE_DIR')),
                'frozen': c.FROZEN, 'mode': 'server' if c.SERVER_MODE else 'local', 'host': socket.gethostname(), 'port': c.BASE_PORT,
                'root': c.ROOT, 'dataDir': c.DATA_DIR, 'docsDir': c.DOCS_DIR, 'docsShare': c.DOCS_SHARE, 'settingsFile': os.path.join(c.ROOT, 'settings.json'),
                'dbBytes': db, 'disk': self._free(c.DATA_DIR), 'python': sys.version.split()[0], 'os': self._os(),
                'started': datetime.fromtimestamp(c.STARTED).isoformat(timespec='seconds'), 'uptime': int(time.time() - c.STARTED),
                'allowedHosts': list(c.ALLOWED_HOSTS), 'task': self.task()}


class Attention:
    """Пункты «Требует внимания»: {level: bad | warn | info, text, tab}; у проблем сервера — постоянный key и alert:
    о них администратору приходит письмо (admin_alerts.AdminAlerts)."""
    LOW_DISK = 2 * 1024 ** 3
    BACKUP_DAYS = 2

    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg

    def items(self):
        out = []
        for check in (self._catalog, self._backup, self._mirror, self._update, self._task, self._errors, self._moderation, self._mail, self._ai, self._disk, self._login, self._trash):
            try:
                out.extend(check())
            except Exception:        # одна проверка не должна ломать обзор
                pass
        order = {'bad': 0, 'warn': 1, 'info': 2}
        return sorted(out, key=lambda x: order.get(x['level'], 3))

    def _catalog(self):
        if self.store.catalog_count():
            return []
        return [{'level': 'warn', 'text': 'Каталог пуст: каталог и фото хранятся на сервере отдела — работайте по его адресу или загрузите сюда файл базы (фото — папка data\\img сервера)', 'tab': 'backup'}]

    def _backup(self):
        import maintenance
        b = maintenance.state(self.store).get('backup') or {}       # запись о последней копии (без обхода папок копий)
        if not b.get('at'):
            return [{'level': 'warn', 'text': 'Автоматической копии базы ещё не было', 'tab': 'backup'}]
        if not b.get('ok'):
            return [{'level': 'bad', 'text': 'Последняя копия базы с ошибкой: %s' % (b.get('error') or '')[:120], 'tab': 'backup', 'key': 'backup', 'alert': True}]
        if datetime.fromisoformat(b['at'][:19]) < datetime.now() - timedelta(days=self.BACKUP_DAYS):
            return [{'level': 'warn', 'text': 'Копия базы не обновлялась с %s' % b['at'][:10], 'tab': 'backup', 'key': 'backup', 'alert': True}]
        return []

    def _mirror(self):
        from backup_mirror import MirrorBackup
        mb = MirrorBackup(self.store, self.cfg.DATA_DIR)
        c, s = mb.config(), mb.state()
        if not c['on']:
            return [{'level': 'info', 'text': 'Копии базы хранятся только на этом диске — укажите вторую папку (сетевой диск, флешку, облако)', 'tab': 'backup'}]
        if mb.stale():
            why = s.get('error') or ('последняя — %s' % s['at'][:10] if s.get('at') else 'ещё не было')
            return [{'level': 'bad' if s.get('error') else 'warn', 'text': 'Копия во вторую папку не обновляется: %s' % why[:160], 'tab': 'backup',
                     'key': 'mirror', 'alert': True}]
        return []

    def _update(self):
        from app_update import Updater
        s = Updater(self.store, self.cfg.ROOT, self.cfg.DATA_DIR).status()
        f = s.get('failed')
        out = [{'level': 'bad', 'text': 'Обновление %s не запустилось — программа сама вернулась к версии %s. Причина: %s'
                % (f['version'], s['current'], f.get('reason', '')[:160]), 'tab': 'updates', 'key': 'update-failed', 'alert': True}] if f else []
        if s['available'] and not (f and f['version'] == s['last']['version']):     # ту же неудачную версию не предлагать
            out.append({'level': 'warn', 'text': 'Доступна новая версия %s (работает %s)' % (s['last']['version'], s['current']), 'tab': 'updates'})
        elif s['pending']:
            out.append({'level': 'warn', 'text': 'Обновление %s установлено, но программа ещё не перезапущена' % s['installed'], 'tab': 'updates'})
        night = s.get('nightLast') or {}
        if s.get('nightly', 'off') != 'off' and not s.get('nightSupported'):
            out.append({'level': 'info', 'text': 'Ночные обновления включены, но работают только у программы из EXE 3.51 и новее', 'tab': 'updates'})
        elif s.get('nightly', 'off') != 'off' and night.get('error'):
            out.append({'level': 'warn', 'text': 'Ночное обновление %s: %s' % (night.get('night', ''), night.get('result', '')[:160]), 'tab': 'updates'})
        return out

    def _task(self):
        t = SystemInfo(self.store, self.cfg).task()
        if not t or not t.get('exists') or not t.get('problems'):
            return []
        why = ' (исправить не удалось: %s)' % t['error'][:120] if t.get('error') else ''
        return [{'level': 'bad', 'text': 'Задача Планировщика сервера отдела %s%s — запустите «server-setup\\1. Установить сервер отдела.bat» '
                 'от имени администратора' % (', '.join(t['problems']), why), 'tab': 'system', 'key': 'task', 'alert': True}]

    def _errors(self):
        from server_log import ServerLog
        lg = ServerLog.current or ServerLog(os.path.join(self.cfg.DATA_DIR, 'logs'))
        n = lg.count_since(24)
        return [{'level': 'warn', 'text': 'Ошибки сервера за сутки: %d — подробности в «Системе» (журнал сервера)' % n, 'tab': 'system',
                 'key': 'errors', 'alert': True}] if n else []

    def _moderation(self):
        n = len(self.store.pending_list('pending'))
        return [{'level': 'warn', 'text': 'Правок товаров на модерации: %d' % n, 'tab': 'moderation'}] if n else []

    def _mail(self):
        from features import FeatureAccess
        from kp_track import Mailer
        if not Mailer(self.store).on():
            if (self.store.kv_get('alerts') or {}).get('on'):
                return [{'level': 'warn', 'text': 'Письма администратору о проблемах включены, но почта не настроена', 'tab': 'mail'}]
            if FeatureAccess(self.store).is_on('mail'):
                return [{'level': 'info', 'text': 'Отправка КП по почте включена, но почта не настроена', 'tab': 'mail'}]
        return []

    def _ai(self):
        import ai_llm
        s = ai_llm.settings(self.store)
        if s['enabled'] and not ai_llm.status(self.store)['enabled']:
            return [{'level': 'warn', 'text': 'Нейросеть включена, но не задан ключ API', 'tab': 'ai'}]
        return []

    def _disk(self):
        d = SystemInfo._free(self.cfg.DATA_DIR)
        if d and d['free'] < self.LOW_DISK:
            return [{'level': 'bad', 'text': 'На диске с базой осталось %.1f ГБ' % (d['free'] / 1024 ** 3), 'tab': 'system', 'key': 'disk', 'alert': True}]
        return []

    def _login(self):
        import auth_users
        if not auth_users.enabled(self.store) and self.cfg.SERVER_MODE:
            return [{'level': 'info', 'text': 'Сервер отдела работает без входа менеджеров по паролю', 'tab': 'access'}]
        return []

    def _trash(self):
        n = len(self.store.trash_list())
        return [{'level': 'info', 'text': 'В корзине записей: %d (хранятся 30 дней)' % n, 'tab': 'trash'}] if n else []
