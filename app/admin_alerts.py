"""Письма администратору о проблемах сервера (пункты «Требует внимания» с пометкой alert)."""

import socket
from datetime import datetime, timedelta

from defaults import SrvVal
from server_log import ServerLog


class AdminAlerts:
    KV = 'alerts'
    MAX_TO = 5
    NOTICES = 10
    LEVEL = {'bad': 'Важно', 'warn': 'Внимание', 'info': 'К сведению'}

    def __init__(self, store, cfg) -> None:
        self.store, self.cfg = store, cfg

    @staticmethod
    def _now() -> str:
        return datetime.now().isoformat(timespec='seconds')

    def settings(self) -> dict:
        s = self.store.kv_get(self.KV) or {}
        return s if isinstance(s, dict) else {}

    @classmethod
    def notice(cls, store, text: str) -> None:
        """Событие (не проблема) — в следующее письмо, если письма включены."""
        s = store.kv_get(cls.KV) or {}
        if not isinstance(s, dict) or not s.get('on'):
            return
        s['notices'] = ((s.get('notices') or []) + [{'at': cls._now(), 'text': str(text)[:300]}])[-cls.NOTICES :]
        store.kv_set(cls.KV, s)

    def problems(self) -> list[dict]:
        from admin_overview import Attention

        return [x for x in Attention(self.store, self.cfg).items() if x.get('alert')]

    def public(self) -> dict:
        from kp_track import Mailer

        s = self.settings()
        return {
            'on': bool(s.get('on')),
            'to': s.get('to') or '',
            'last': s.get('last') or None,
            'mailOn': Mailer(self.store).on(),
        }

    def save(self, d: dict, by: str) -> dict:
        from kp_track import Mailer

        s = self.settings()
        if 'to' in d:
            to = Mailer.addresses(str(d.get('to') or '')[:600])
            if len(to) > self.MAX_TO:
                raise ValueError(f'Не больше {self.MAX_TO} адресов для писем о проблемах')
            s['to'] = ', '.join(to)
        if 'on' in d:
            s['on'] = bool(d.get('on'))
        if s.get('on') and not s.get('to'):
            raise ValueError('Укажите адрес, на который присылать письма о проблемах')
        s['updatedAt'], s['updatedBy'] = self._now(), by
        self.store.kv_set(self.KV, s)
        return self.public()

    def check(self) -> dict | None:
        """Письмо о новой проблеме или раз в srv.alertRemindH, пока она есть."""
        s = self.settings()
        if not s.get('on') or not s.get('to'):
            return None
        items = self.problems()
        keys = {x['key'] for x in items}
        sent = {k: v for k, v in (s.get('sent') or {}).items() if k in keys}
        edge = (datetime.now() - timedelta(hours=SrvVal.get(self.store, 'srv.alertRemindH'))).isoformat(
            timespec='seconds'
        )
        due = {x['key'] for x in items if sent.get(x['key'], '') < edge}
        notes = s.get('notices') or []
        if not due and not notes:
            if sent != (s.get('sent') or {}):
                s['sent'] = sent
                self.store.kv_set(self.KV, s)
            return None
        rec = self.send(items, due, notes=notes)
        if rec['ok']:
            sent.update(dict.fromkeys(keys, rec['at']))
            s['notices'] = []
        s['sent'], s['last'] = sent, rec
        self.store.kv_set(self.KV, s)
        return rec

    def test(self) -> dict:
        """Пробное письмо; RuntimeError — почему не ушло."""
        rec = self.send(self.problems(), (), test=True)
        s = self.settings()
        s['last'] = rec
        self.store.kv_set(self.KV, s)
        if not rec['ok']:
            raise RuntimeError(rec['error'])
        return rec

    def send(self, items: list[dict], new=(), test: bool = False, notes=()) -> dict:
        from kp_track import Mailer

        host = socket.gethostname()
        url = f'http://{host}:{self.cfg.BASE_PORT}/'
        lines = [
            f'• {self.LEVEL.get(x["level"], "")}: {x["text"]}{" (новое)" if x["key"] in new else ""}' for x in items
        ]
        if test:
            subject = f'Конструктор КП ({host}): пробное письмо'
            head = f'Это пробное письмо: уведомления о проблемах сервера отдела «Конструктор КП» на компьютере {host} работают.'
            body = head + ('\n\nСейчас требует внимания:\n' + '\n'.join(lines) if lines else '\n\nСейчас проблем нет.')
        elif items:
            subject = f'Конструктор КП ({host}): требует внимания — {len(items)}'
            body = f'Сервер отдела «Конструктор КП» на компьютере {host} требует внимания:\n\n' + '\n'.join(lines)
        else:
            subject = f'Конструктор КП ({host}): события'
            body = f'Сервер отдела «Конструктор КП» на компьютере {host}: проблем нет.'
        if notes:
            body += '\n\nСобытия:\n' + '\n'.join(
                f'• {n.get("at", "")[:16].replace("T", " ")} {n.get("text", "")}' for n in notes
            )
        body += (
            f'\n\nОткрыть программу: {url} → «Настройки» → «Обзор» → «Сводка и статистика» → «Требует внимания».\n\n'
            'Письмо приходит, когда проблема появилась, и раз в сутки, пока она не решена. '
            'Изменить адрес или отключить — «Настройки → Почта» → «Письма о проблемах».'
        )
        rec = {'at': self._now(), 'count': len(items), 'test': test, 'ok': True}
        try:
            m = Mailer(self.store)
            m.send(m.addresses(self.settings().get('to')), [], subject, body, [], test=True)
        except (RuntimeError, ValueError) as e:
            rec.update(ok=False, error=str(e)[:300])
            ServerLog.failure(f'письмо администратору не отправлено: {e}')
        return rec
