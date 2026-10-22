"""Ход сделки по КП (DealTrack), срок действия (OfferTerm), напоминания, письмо КП клиенту (Mailer)."""

import re
import smtplib
import ssl
import threading
import time
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from defaults import SrvVal


class Val:
    """Разбор и очистка значений из запроса."""

    CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
    EMAIL = re.compile(r'^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$')

    @staticmethod
    def now() -> str:
        return datetime.now().isoformat(timespec='seconds')

    @staticmethod
    def day(text) -> date | None:
        """'ГГГГ-ММ-ДД' → date или None."""
        try:
            return datetime.strptime(str(text or '')[:10], '%Y-%m-%d').date()
        except ValueError:
            return None

    @classmethod
    def text(cls, v, limit) -> str:
        return cls.CTRL.sub('', str(v or '')).strip()[:limit]

    @classmethod
    def email(cls, text) -> bool:
        return bool(cls.EMAIL.match(text or ''))


class DealTrack:
    """Ход сделки одного хранилища: изменение статуса и напоминания, отметка об отправке письма."""

    STATUSES = [
        ('new', 'Подготовлено'),
        ('sent', 'Отправлено'),
        ('work', 'В работе'),
        ('won', 'Выиграно'),
        ('lost', 'Проиграно'),
    ]
    STATUS_KEYS = [k for k, _ in STATUSES]
    HISTORY_MAX = 50
    SENT_MAX = 30

    def __init__(self, store) -> None:
        self.store = store

    def _log(self, track, entry) -> None:
        hist = picked if isinstance(picked := track.get('history'), list) else []
        hist.append(entry)
        track['history'] = hist[-self.HISTORY_MAX :]

    def update(self, kid: str, data, author: str) -> tuple:
        """Изменить ход сделки: status, reason, note, followUp ({date, note} | {done: true} | None)."""
        track = self.store.kp_track_get(kid)
        changed = {}
        if 'status' in data:
            changed.update(self._status(track, data, author))
        if 'followUp' in data:
            changed.update(self._follow(track, data.get('followUp'), author))
        if changed:
            self._log(track, dict(changed, at=Val.now(), by=author))
            self.store.kp_track_set(kid, track)
        return track, changed

    def _status(self, track, data, author: str) -> dict:
        status = data.get('status') or 'new'
        if status not in self.STATUS_KEYS:
            raise ValueError('Неизвестный статус КП')
        reason = Val.text(data.get('reason'), 200) if status == 'lost' else ''
        note = Val.text(data.get('note'), 500)
        if (
            status == (track.get('status') or 'new')
            and reason == (track.get('reason') or '')
            and note == (track.get('note') or '')
        ):
            return {}
        track.update(status=status, reason=reason, note=note, at=Val.now(), by=author)
        if status in ('won', 'lost') and isinstance(track.get('followUp'), dict):
            track['followUp']['done'] = True  # сделка закрыта — напоминание больше не нужно
        return {'status': status, 'reason': reason, 'note': note}

    def _follow(self, track, follow, author: str) -> dict:
        if follow is None:
            track.pop('followUp', None)
            return {'followUp': None}
        if not isinstance(follow, dict):
            raise ValueError('Напоминание: нужна дата')
        if follow.get('done'):
            if isinstance(track.get('followUp'), dict):
                track['followUp']['done'] = True
            return {'followUp': 'выполнено'}
        day = Val.day(follow.get('date'))
        if not day:
            raise ValueError('Дата напоминания — в формате ГГГГ-ММ-ДД')
        track['followUp'] = {
            'date': day.isoformat(),
            'note': Val.text(follow.get('note'), 300),
            'by': author,
            'at': Val.now(),
        }
        return {'followUp': track['followUp']}

    def mark_sent(self, kid: str, recipients, files, author: str) -> dict:
        """Письмо клиенту ушло: запись в «sent»; неотправленное КП становится «Отправлено»."""
        track = self.store.kp_track_get(kid)
        text = picked if isinstance(picked := track.get('sent'), list) else []
        text.append({'at': Val.now(), 'by': author, 'to': recipients, 'files': files})
        track['sent'] = text[-self.SENT_MAX :]
        if (track.get('status') or 'new') == 'new':
            track.update(status='sent', at=Val.now(), by=author)
            self._log(
                track, {'status': 'sent', 'note': 'письмо: ' + ', '.join(recipients), 'at': Val.now(), 'by': author}
            )
        self.store.kp_track_set(kid, track)
        return track


class OfferTerm:
    """Срок действия КП по условию «Срок действия …»: дни, рабочие дни, недели, месяцы или дата."""

    WORKDAYS = 5

    UNITS = (('раб', 'work'), ('дн', 1), ('ден', 1), ('сут', 1), ('недел', 7), ('мес', 30))

    @classmethod
    def until(cls, state, meta=None) -> date | None:
        """Дата окончания (date) или None — срок не указан или не распознан."""
        meta1 = meta if isinstance(meta, dict) else {}
        if meta1.get('validUntil'):
            return Val.day(meta1['validUntil'])
        state1 = state if isinstance(state, dict) else {}
        cond = next(
            (
                cnd
                for cnd in (state1.get('conditions') or [])
                if isinstance(cnd, dict) and 'действ' in str(cnd.get('label') or '').lower()
            ),
            None,
        )
        v = str((cond or {}).get('value') or '').lower()
        if not v:
            return None
        date_match = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', v)
        if date_match:
            try:
                return date(int(date_match.group(3)), int(date_match.group(2)), int(date_match.group(1)))
            except ValueError:
                return None
        base = Val.day(state1.get('date') or meta1.get('date'))
        num_match = re.search(r'(\d{1,3})\s*([а-яё]*)\s*([а-яё]*)', v)
        if not base or not num_match:
            return None
        count, words = int(num_match.group(1)), num_match.group(2) + ' ' + num_match.group(3)
        for key, mult in cls.UNITS:
            if key in words:
                return cls.work_days(base, count) if mult == 'work' else base + timedelta(days=count * int(mult))
        return None

    @staticmethod
    def work_days(base, days) -> date:
        """Через n рабочих дней (без выходных; праздники — приблизительно)."""
        day, k = base, 0
        while k < days:
            day += timedelta(days=1)
            if day.weekday() < OfferTerm.WORKDAYS:
                k += 1
        return day


class ReminderList:
    """Напоминания менеджера на дату today."""

    def __init__(self, today=None, store=None) -> None:
        self.today = today or date.today()
        self.stale, self.ahead, self.expired = (
            SrvVal.get(store, k) for k in ('kp.staleDays', 'kp.expireAhead', 'kp.expiredShow')
        )

    def collect(self, rows, mine) -> list[dict]:
        """rows — [(id, meta-dict, track-dict, state-dict)] доступных КП; mine(meta) — КП этого менеджера."""
        out: list = []
        for kid, meta, track, state in rows:
            if mine(meta):
                out.extend(self._of(kid, meta, track, state))
        out.sort(key=lambda x: (x['date'], x['number']))
        return out

    def _of(self, kid: str, meta, track, state) -> Iterator[dict]:
        today, status = self.today, track.get('status') or 'new'
        base = {'id': kid, 'number': meta.get('number') or kid, 'client': meta.get('client') or '', 'status': status}
        follow = picked if isinstance(picked := track.get('followUp'), dict) else None
        if follow and not follow.get('done'):
            due = Val.day(follow.get('date'))
            if due and due <= today + timedelta(days=1):
                yield dict(
                    base,
                    kind='follow',
                    date=due.isoformat(),
                    text=follow.get('note') or 'Связаться с клиентом',
                    overdue=due < today,
                )
        if status in ('won', 'lost'):
            return
        valid_until = OfferTerm.until(state, meta)
        if valid_until and today - timedelta(days=self.expired) <= valid_until <= today + timedelta(days=self.ahead):
            yield dict(
                base,
                kind='expire',
                date=valid_until.isoformat(),
                text='Срок действия КП истёк' if valid_until < today else 'Срок действия КП истекает',
                overdue=valid_until < today,
            )
        if status == 'sent' and not follow:
            stamp = Val.day(track.get('at'))
            if stamp and (today - stamp).days >= self.stale:
                yield dict(
                    base,
                    kind='stale',
                    date=stamp.isoformat(),
                    text=f'Отправлено {(today - stamp).days} дн. назад — ответа нет?',
                    overdue=False,
                )


class MailTemplate:
    """Тема и текст письма клиенту с подстановками из КП."""

    SUBJECT = 'Коммерческое предложение № {номер} — {поставщик}'
    BODY = (
        'Здравствуйте{, контакт}!\n\nНаправляем коммерческое предложение № {номер} от {дата}{: оборудование}.\n'
        'Файл — во вложении. Будем рады ответить на вопросы.\n\nС уважением,\n{менеджер}\n{должность}\n{телефон}\n{e-mail}'
    )

    def __init__(self, state, meta, supplier='') -> None:
        self.vars = self.variables(state, meta, supplier)

    @staticmethod
    def variables(state, meta, supplier='') -> dict:
        """Значения подстановок письма из КП."""
        state1 = state if isinstance(state, dict) else {}
        meta1 = meta if isinstance(meta, dict) else {}
        mgr = picked if isinstance(picked := state1.get('manager'), dict) else {}
        contact = picked if isinstance(picked := state1.get('contact'), dict) else {}
        cover = picked if isinstance(picked := state1.get('cover'), dict) else {}
        day = Val.day(state1.get('date') or meta1.get('date'))
        phone = str(mgr.get('phone') or '')
        if mgr.get('ext'):
            phone += ' доб. ' + str(mgr['ext'])
        phone = ', '.join(x for x in (phone, str(mgr.get('mobile') or '')) if x.strip())
        equip = ' '.join(
            x for x in [str(cover.get('title') or '').strip(), str(cover.get('model') or '').strip()] if x
        ).strip()
        return {
            'номер': meta1.get('number') or state1.get('number') or '',
            'дата': day.strftime('%d.%m.%Y') if day else '',
            'клиент': meta1.get('client') or state1.get('client') or '',
            'поставщик': supplier,
            'менеджер': mgr.get('name') or meta1.get('manager') or '',
            'должность': mgr.get('position') or '',
            'телефон': phone,
            'e-mail': mgr.get('email') or '',
            'контакт': str(contact.get('name') or '').strip(),
            'оборудование': equip,
        }

    def fill(self, tpl) -> str:
        """Шаблон письма с подстановками {номер}, {дата}, {клиент}, {менеджер} и др."""
        v, text = self.vars, str(tpl or '')
        text = text.replace('{, контакт}', (', ' + v['контакт']) if v.get('контакт') else '')
        text = text.replace('{ на оборудование}', (' на ' + v['оборудование']) if v.get('оборудование') else '')
        text = text.replace('{: оборудование}', (': ' + v['оборудование']) if v.get('оборудование') else '')
        for k, x in v.items():
            text = text.replace(f'{{{k}}}', str(x or ''))
        return re.sub(r'\n{3,}', '\n\n', re.sub(r'[ \t]+\n', '\n', text)).strip()


class MailRate:
    """Писем клиентам от одного сотрудника в час — не больше srv-значения kp.mailPerHour (письма уходят с адреса компании)."""

    HOUR_SEC = 3600

    SENT: dict = {}
    LOCK = threading.Lock()

    @classmethod
    def take(cls, store, who) -> None:
        """Учесть письмо; ValueError — предел исчерпан (с временем ожидания)."""
        now, limit = time.time(), SrvVal.get(store, 'kp.mailPerHour')
        with cls.LOCK:
            v = [stamp for stamp in cls.SENT.get(who, []) if now - stamp < cls.HOUR_SEC]
            if len(v) >= limit:
                wait = int(v[0] + 3600 - now) // 60 + 1
                raise ValueError(f'Отправлено {len(v)} писем за час — следующее можно через {wait} мин')
            v.append(now)
            cls.SENT[who] = v


class Mailer:
    """Почта программы: настройки SMTP (kv mail) и отправка письма."""

    PORT_MAX = 65535

    KEYS = ('host', 'port', 'security', 'login', 'password', 'fromEmail', 'fromName', 'bccSelf', 'subject', 'body')
    MAX_TO = 10

    def __init__(self, store) -> None:
        self.store = store

    def settings(self) -> dict:
        mail = self.store.kv_get('mail') or {}
        return mail if isinstance(mail, dict) else {}

    def enabled(self) -> bool:
        mail = self.settings()
        return bool(mail.get('host') and Val.email(mail.get('fromEmail')))

    def public(self) -> dict:
        """Для «Настроек»: без пароля (есть ли он — hasPassword)."""
        mail = self.settings()
        out = {k: mail.get(k, '') for k in self.KEYS if k != 'password'}
        out.update(
            hasPassword=bool(mail.get('password')),
            bccSelf=bool(mail.get('bccSelf')),
            port=mail.get('port') or 465,
            security=mail.get('security') or 'ssl',
            subject=mail.get('subject') or MailTemplate.SUBJECT,
            body=mail.get('body') or MailTemplate.BODY,
            on=self.enabled(),
        )
        return out

    def save(self, data, author: str) -> dict:
        """Сохранить настройки из «Настроек → Почта». ValueError — с понятным текстом."""
        mail = self.settings()
        for k in ('host', 'login', 'fromName', 'subject', 'body'):
            if k in data:
                mail[k] = Val.text(data.get(k), 4000 if k == 'body' else 300)
        if 'fromEmail' in data:
            from_email = Val.text(data.get('fromEmail'), 200)
            if from_email and not Val.email(from_email):
                raise ValueError('Адрес отправителя — например, kp@company.ru')
            mail['fromEmail'] = from_email
        if 'port' in data:
            mail['port'] = self._port(data.get('port'))
        if 'security' in data:
            if data.get('security') not in ('ssl', 'starttls', 'none'):
                raise ValueError('Защита соединения: ssl, starttls или none')
            mail['security'] = data['security']
        if 'bccSelf' in data:
            mail['bccSelf'] = bool(data.get('bccSelf'))
        if data.get('password'):
            mail['password'] = str(data['password'])[:300]
        if data.get('clearPassword'):
            mail.pop('password', None)
        mail['updatedAt'], mail['updatedBy'] = Val.now(), author
        self.store.kv_set('mail', mail)
        return self.public()

    @staticmethod
    def _port(v) -> int:
        try:
            port = int(v or 0)
        except (TypeError, ValueError):
            port = 0
        if not 1 <= port <= Mailer.PORT_MAX:
            raise ValueError('Порт — число от 1 до 65535 (обычно 465 или 587)')
        return port

    @classmethod
    def addresses(cls, text) -> list[str]:
        """Адреса из строки «a@b.ru, c@d.ru». ValueError — неверный адрес или больше MAX_TO."""
        out = [addr for addr in (x.strip() for x in re.split(r'[,;\s]+', str(text or ''))) if addr]
        bad = next((addr for addr in out if not Val.email(addr)), None)
        if bad:
            raise ValueError(f'Неверный адрес почты: {bad[:80]}')
        if len(out) > cls.MAX_TO:
            raise ValueError(f'Не больше {cls.MAX_TO} адресов в письме')
        return out

    def send(self, recipients, copies, subject, body, files, reply_to='') -> list[str]:
        """Письмо через SMTP из настроек. files — [(имя, байты, mime)]. → получатели. RuntimeError — с понятным текстом."""
        mail = self._settings_ready()
        msg = self._message(mail, recipients, copies, subject, body, files, reply_to)
        return self._deliver_to(mail, msg, recipients + copies + ([mail['fromEmail']] if mail.get('bccSelf') else []))

    def send_service(self, recipients, subject, body) -> list[str]:
        """Служебное письмо (пробное, о проблемах сервера) — без копии себе."""
        mail = self._settings_ready()
        return self._deliver_to(mail, self._message(mail, recipients, [], subject, body, [], ''), list(recipients))

    def _settings_ready(self) -> dict:
        if not self.enabled():
            raise RuntimeError('Почта не настроена: администратор — «Настройки → Почта»')
        return self.settings()

    def _deliver_to(self, mail: dict, msg, rcpt: list[str]) -> list[str]:
        """→ адреса, которые почтовый сервер принял (часть могла не пройти — отказ по адресу)."""
        try:
            refused = self._deliver(mail, msg, rcpt)
        except smtplib.SMTPRecipientsRefused as exc:
            bad = ', '.join(str(addr) for addr in exc.recipients)[:200]
            raise RuntimeError(f'Почтовый сервер не принял адрес: {bad} — проверьте написание адреса клиента') from None
        except smtplib.SMTPAuthenticationError:
            raise RuntimeError('Почтовый сервер не принял логин или пароль — проверьте «Настройки → Почта»') from None
        except (smtplib.SMTPException, OSError) as email:
            raise RuntimeError(f'Письмо не отправлено: {(str(email) or type(email).__name__)[:200]}') from email
        return [addr for addr in rcpt if addr not in (refused or {})]

    @staticmethod
    def _message(mail, recipients, copies, subject, body, files, reply_to) -> EmailMessage:
        def line(v) -> str:
            return ' '.join(str(v or '').split())  # заголовок письма — одна строка (перевод строки — ошибка письма)

        msg = EmailMessage()
        msg['From'] = formataddr((line(mail.get('fromName')), mail['fromEmail']))
        msg['To'] = ', '.join(recipients)
        if copies:
            msg['Cc'] = ', '.join(copies)
        if reply_to and Val.email(reply_to):
            msg['Reply-To'] = reply_to
        msg['Subject'] = line(subject) or 'Коммерческое предложение'
        msg['Message-ID'] = make_msgid(domain=mail['fromEmail'].split('@')[-1])
        msg.set_content(body or '')
        for name, data, mime in files:
            main_type, sub_type = (mime or 'application/octet-stream').split('/', 1)
            msg.add_attachment(data, maintype=main_type, subtype=sub_type, filename=name)
        return msg

    @staticmethod
    def _deliver(mail, msg, rcpt) -> dict:
        host, port, sec = mail['host'], int(mail.get('port') or 465), mail.get('security') or 'ssl'
        srv = (
            smtplib.SMTP_SSL(host, port, timeout=30, context=ssl.create_default_context())
            if sec == 'ssl'
            else smtplib.SMTP(host, port, timeout=30)
        )
        with srv:
            if sec == 'starttls':
                srv.starttls(context=ssl.create_default_context())
            if mail.get('login'):
                srv.login(mail['login'], mail.get('password') or '')
            return srv.send_message(msg, to_addrs=rcpt) or {}
