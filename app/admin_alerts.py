# -*- coding: utf-8 -*-
"""Письма администратору о проблемах сервера: копия базы не делается, вторая папка не обновляется, мало места на диске,
обновление не запустилось, задача Планировщика с настройками не для сервера, ошибки в журнале сервера.

Источник — пункты «Требует внимания» с пометкой alert (admin_overview.Attention, у каждого — постоянный key). Письмо —
когда проблема появилась и раз в сутки, пока она есть; проверка — раз в час (Background.every); оба срока —
«Значения программы» (srv.alertRemindH, srv.alertsEveryMin). Решённая проблема
забывается: появится снова — снова письмо. Настройки (kv alerts: on, to) — «Настройки → Почта»; отправка — почтой
программы (kp_track.Mailer, тот же сервер SMTP, что и для КП).
"""
import socket
from datetime import datetime, timedelta

from defaults import SrvVal
from server_log import ServerLog


class AdminAlerts:
    KV = 'alerts'
    MAX_TO = 5
    NOTICES = 10          # событий (ночное обновление) до следующего письма
    LEVEL = {'bad': 'Важно', 'warn': 'Внимание', 'info': 'К сведению'}

    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg

    @staticmethod
    def _now():
        return datetime.now().isoformat(timespec='seconds')

    def settings(self):
        s = self.store.kv_get(self.KV) or {}
        return s if isinstance(s, dict) else {}

    @classmethod
    def notice(cls, store, text):
        """Событие для следующего письма (не проблема, например ночное обновление). Письма выключены — не копим."""
        s = store.kv_get(cls.KV) or {}
        if not isinstance(s, dict) or not s.get('on'):
            return
        s['notices'] = ((s.get('notices') or []) + [{'at': cls._now(), 'text': str(text)[:300]}])[-cls.NOTICES:]
        store.kv_set(cls.KV, s)

    def problems(self):
        """Пункты «Требует внимания», о которых пишем: [{key, level, text, tab}]."""
        from admin_overview import Attention
        return [x for x in Attention(self.store, self.cfg).items() if x.get('alert')]

    def public(self):
        from kp_track import Mailer
        s = self.settings()
        return {'on': bool(s.get('on')), 'to': s.get('to') or '', 'last': s.get('last') or None, 'mailOn': Mailer(self.store).on()}

    def save(self, d, by):
        """Настройки из «Настройки → Почта»: on, to. ValueError — с понятным текстом."""
        from kp_track import Mailer
        s = self.settings()
        if 'to' in d:
            to = Mailer.addresses(str(d.get('to') or '')[:600])
            if len(to) > self.MAX_TO:
                raise ValueError('Не больше %d адресов для писем о проблемах' % self.MAX_TO)
            s['to'] = ', '.join(to)
        if 'on' in d:
            s['on'] = bool(d.get('on'))
        if s.get('on') and not s.get('to'):
            raise ValueError('Укажите адрес, на который присылать письма о проблемах')
        s['updatedAt'], s['updatedBy'] = self._now(), by
        self.store.kv_set(self.KV, s)
        return self.public()

    def check(self):
        """Раз в час: появилась проблема или прошли сутки с прошлого письма о ней — письмо. → запись о письме или None."""
        s = self.settings()
        if not s.get('on') or not s.get('to'):
            return None
        items = self.problems()
        keys = {x['key'] for x in items}
        sent = {k: v for k, v in (s.get('sent') or {}).items() if k in keys}       # решённые — забыть
        edge = (datetime.now() - timedelta(hours=SrvVal.get(self.store, 'srv.alertRemindH'))).isoformat(timespec='seconds')
        due = {x['key'] for x in items if sent.get(x['key'], '') < edge}
        notes = s.get('notices') or []
        if not due and not notes:
            if sent != (s.get('sent') or {}):
                s['sent'] = sent
                self.store.kv_set(self.KV, s)
            return None
        rec = self.send(items, due, notes=notes)
        if rec['ok']:
            sent.update({k: rec['at'] for k in keys})
            s['notices'] = []
        s['sent'], s['last'] = sent, rec
        self.store.kv_set(self.KV, s)
        return rec

    def test(self):
        """Пробное письмо на адреса из настроек. RuntimeError — почему не ушло."""
        rec = self.send(self.problems(), (), test=True)
        s = self.settings()
        s['last'] = rec
        self.store.kv_set(self.KV, s)
        if not rec['ok']:
            raise RuntimeError(rec['error'])
        return rec

    def send(self, items, new=(), test=False, notes=()):
        from kp_track import Mailer
        host = socket.gethostname()
        url = 'http://%s:%d/' % (host, self.cfg.BASE_PORT)
        lines = ['• %s: %s%s' % (self.LEVEL.get(x['level'], ''), x['text'], ' (новое)' if x['key'] in new else '') for x in items]
        if test:
            subject = 'Конструктор КП (%s): пробное письмо' % host
            head = 'Это пробное письмо: уведомления о проблемах сервера отдела «Конструктор КП» на компьютере %s работают.' % host
            body = head + ('\n\nСейчас требует внимания:\n' + '\n'.join(lines) if lines else '\n\nСейчас проблем нет.')
        elif items:
            subject = 'Конструктор КП (%s): требует внимания — %d' % (host, len(items))
            body = 'Сервер отдела «Конструктор КП» на компьютере %s требует внимания:\n\n%s' % (host, '\n'.join(lines))
        else:
            subject = 'Конструктор КП (%s): события' % host
            body = 'Сервер отдела «Конструктор КП» на компьютере %s: проблем нет.' % host
        if notes:
            body += '\n\nСобытия:\n' + '\n'.join('• %s %s' % (n.get('at', '')[:16].replace('T', ' '), n.get('text', '')) for n in notes)
        body += ('\n\nОткрыть программу: %s → «Настройки» → «Статистика» → «Требует внимания».\n\n'
                 'Письмо приходит, когда проблема появилась, и раз в сутки, пока она не решена. '
                 'Изменить адрес или отключить — «Настройки → Почта» → «Письма о проблемах».') % url
        rec = {'at': self._now(), 'count': len(items), 'test': test, 'ok': True}
        try:
            m = Mailer(self.store)
            m.send(m.addresses(self.settings().get('to')), [], subject, body, [], test=True)
        except (RuntimeError, ValueError) as e:
            rec.update(ok=False, error=str(e)[:300])
            ServerLog.failure('письмо администратору не отправлено: %s' % e)
        return rec
