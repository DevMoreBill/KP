# -*- coding: utf-8 -*-
"""Обзор для администратора: сведения о программе и компьютере, список «Требует внимания».

• SystemInfo — версия (EXE и обновление), режим (компьютер / сервер отдела), адрес, папки, свободное место, время работы.
• Attention — что администратору стоит сделать сейчас: правки на модерации, копия базы не сделана или с ошибкой, есть новая
  версия, функция включена, но не настроена (почта, нейросеть), мало места на диске, корзина. У пункта — важность и вкладка
  «Настроек», где это решается.
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
                'allowedHosts': list(c.ALLOWED_HOSTS)}


class Attention:
    """Пункты «Требует внимания»: {level: bad | warn | info, text, tab}."""
    LOW_DISK = 2 * 1024 ** 3
    BACKUP_DAYS = 2

    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg

    def items(self):
        out = []
        for check in (self._backup, self._update, self._moderation, self._mail, self._ai, self._disk, self._login, self._trash):
            try:
                out.extend(check())
            except Exception:        # одна проверка не должна ломать обзор
                pass
        order = {'bad': 0, 'warn': 1, 'info': 2}
        return sorted(out, key=lambda x: order.get(x['level'], 3))

    def _backup(self):
        import maintenance
        b = maintenance.summary(self.store, self.cfg.DATA_DIR).get('backup') or {}
        if not b.get('at'):
            return [{'level': 'warn', 'text': 'Автоматической копии базы ещё не было', 'tab': 'backup'}]
        if not b.get('ok'):
            return [{'level': 'bad', 'text': 'Последняя копия базы с ошибкой: %s' % (b.get('error') or '')[:120], 'tab': 'backup'}]
        if datetime.fromisoformat(b['at'][:19]) < datetime.now() - timedelta(days=self.BACKUP_DAYS):
            return [{'level': 'warn', 'text': 'Копия базы не обновлялась с %s' % b['at'][:10], 'tab': 'backup'}]
        return []

    def _update(self):
        from app_update import Updater
        s = Updater(self.store, self.cfg.ROOT, self.cfg.DATA_DIR).status()
        if s['available']:
            return [{'level': 'warn', 'text': 'Доступна новая версия %s (работает %s)' % (s['last']['version'], s['current']), 'tab': 'updates'}]
        if s['pending']:
            return [{'level': 'warn', 'text': 'Обновление %s установлено, но программа ещё не перезапущена' % s['installed'], 'tab': 'updates'}]
        return []

    def _moderation(self):
        n = len(self.store.pending_list('pending'))
        return [{'level': 'warn', 'text': 'Правок товаров на модерации: %d' % n, 'tab': 'moderation'}] if n else []

    def _mail(self):
        from features import FeatureAccess
        from kp_track import Mailer
        if FeatureAccess(self.store).is_on('mail') and not Mailer(self.store).on():
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
            return [{'level': 'bad', 'text': 'На диске с базой осталось %.1f ГБ' % (d['free'] / 1024 ** 3), 'tab': 'system'}]
        return []

    def _login(self):
        import auth_users
        if not auth_users.enabled(self.store) and self.cfg.SERVER_MODE:
            return [{'level': 'info', 'text': 'Сервер отдела работает без входа менеджеров по паролю', 'tab': 'access'}]
        return []

    def _trash(self):
        n = len(self.store.trash_list())
        return [{'level': 'info', 'text': 'В корзине записей: %d (хранятся 30 дней)' % n, 'tab': 'trash'}] if n else []
