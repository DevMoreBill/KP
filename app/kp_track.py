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
    def day(s) -> date | None:
        """'ГГГГ-ММ-ДД' → date или None."""
        try:
            return datetime.strptime(str(s or '')[:10], '%Y-%m-%d').date()
        except ValueError:
            return None

    @classmethod
    def text(cls, v, n) -> str:
        return cls.CTRL.sub('', str(v or '')).strip()[:n]

    @classmethod
    def email(cls, s) -> bool:
        return bool(cls.EMAIL.match(s or ''))


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

    def _log(self, tr, entry) -> None:
        h = tr.get('history') if isinstance(tr.get('history'), list) else []
        h.append(entry)
        tr['history'] = h[-self.HISTORY_MAX :]

    def update(self, kid: str, d, by: str) -> tuple:
        """Изменить ход сделки: status, reason, note, followUp ({date, note} | {done: true} | None)."""
        tr = self.store.kp_track_get(kid)
        changed = {}
        if 'status' in d:
            changed.update(self._status(tr, d, by))
        if 'followUp' in d:
            changed.update(self._follow(tr, d.get('followUp'), by))
        if changed:
            self._log(tr, dict(changed, at=Val.now(), by=by))
            self.store.kp_track_set(kid, tr)
        return tr, changed

    def _status(self, tr, d, by: str) -> dict:
        st = d.get('status') or 'new'
        if st not in self.STATUS_KEYS:
            raise ValueError('Неизвестный статус КП')
        reason = Val.text(d.get('reason'), 200) if st == 'lost' else ''
        note = Val.text(d.get('note'), 500)
        if st == (tr.get('status') or 'new') and reason == (tr.get('reason') or '') and note == (tr.get('note') or ''):
            return {}
        tr.update(status=st, reason=reason, note=note, at=Val.now(), by=by)
        if st in ('won', 'lost') and isinstance(tr.get('followUp'), dict):
            tr['followUp']['done'] = True  # сделка закрыта — напоминание больше не нужно
        return {'status': st, 'reason': reason, 'note': note}

    def _follow(self, tr, fu, by: str) -> dict:
        if fu is None:
            tr.pop('followUp', None)
            return {'followUp': None}
        if not isinstance(fu, dict):
            raise ValueError('Напоминание: нужна дата')
        if fu.get('done'):
            if isinstance(tr.get('followUp'), dict):
                tr['followUp']['done'] = True
            return {'followUp': 'выполнено'}
        dt = Val.day(fu.get('date'))
        if not dt:
            raise ValueError('Дата напоминания — в формате ГГГГ-ММ-ДД')
        tr['followUp'] = {'date': dt.isoformat(), 'note': Val.text(fu.get('note'), 300), 'by': by, 'at': Val.now()}
        return {'followUp': tr['followUp']}

    def mark_sent(self, kid: str, to, files, by: str) -> dict:
        """Письмо клиенту ушло: запись в «sent»; неотправленное КП становится «Отправлено»."""
        tr = self.store.kp_track_get(kid)
        s = tr.get('sent') if isinstance(tr.get('sent'), list) else []
        s.append({'at': Val.now(), 'by': by, 'to': to, 'files': files})
        tr['sent'] = s[-self.SENT_MAX :]
        if (tr.get('status') or 'new') == 'new':
            tr.update(status='sent', at=Val.now(), by=by)
            self._log(tr, {'status': 'sent', 'note': 'письмо: ' + ', '.join(to), 'at': Val.now(), 'by': by})
        self.store.kp_track_set(kid, tr)
        return tr


class OfferTerm:
    """Срок действия КП по условию «Срок действия …»: дни, рабочие дни, недели, месяцы или дата."""

    UNITS = (('раб', 'work'), ('дн', 1), ('ден', 1), ('сут', 1), ('недел', 7), ('мес', 30))

    @classmethod
    def until(cls, state, meta=None) -> date | None:
        """Дата окончания (date) или None — срок не указан или не распознан."""
        m = meta if isinstance(meta, dict) else {}
        if m.get('validUntil'):
            return Val.day(m['validUntil'])
        st = state if isinstance(state, dict) else {}
        cond = next(
            (
                c
                for c in (st.get('conditions') or [])
                if isinstance(c, dict) and 'действ' in str(c.get('label') or '').lower()
            ),
            None,
        )
        v = str((cond or {}).get('value') or '').lower()
        if not v:
            return None
        dm = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', v)
        if dm:
            try:
                return date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
            except ValueError:
                return None
        base = Val.day(st.get('date') or m.get('date'))
        nm = re.search(r'(\d{1,3})\s*([а-яё]*)\s*([а-яё]*)', v)
        if not base or not nm:
            return None
        n, words = int(nm.group(1)), nm.group(2) + ' ' + nm.group(3)
        for key, mult in cls.UNITS:
            if key in words:
                return cls.work_days(base, n) if mult == 'work' else base + timedelta(days=n * mult)
        return None

    @staticmethod
    def work_days(base, n) -> date:
        """Через n рабочих дней (без выходных; праздники — приблизительно)."""
        d, k = base, 0
        while k < n:
            d += timedelta(days=1)
            if d.weekday() < 5:
                k += 1
        return d


class ReminderList:
    """Напоминания менеджера на дату today."""

    def __init__(self, today=None, store=None) -> None:
        self.today = today or date.today()
        self.stale, self.ahead, self.expired = (
            SrvVal.get(store, k) for k in ('kp.staleDays', 'kp.expireAhead', 'kp.expiredShow')
        )

    def collect(self, rows, mine) -> list[dict]:
        """rows — [(id, meta-dict, track-dict, state-dict)] доступных КП; mine(meta) — КП этого менеджера."""
        out = []
        for kid, meta, tr, state in rows:
            if mine(meta):
                out.extend(self._of(kid, meta, tr, state))
        out.sort(key=lambda x: (x['date'], x['number']))
        return out

    def _of(self, kid: str, meta, tr, state) -> Iterator[dict]:
        today, st = self.today, tr.get('status') or 'new'
        base = {'id': kid, 'number': meta.get('number') or kid, 'client': meta.get('client') or '', 'status': st}
        fu = tr.get('followUp') if isinstance(tr.get('followUp'), dict) else None
        if fu and not fu.get('done'):
            d = Val.day(fu.get('date'))
            if d and d <= today + timedelta(days=1):
                yield dict(
                    base,
                    kind='follow',
                    date=d.isoformat(),
                    text=fu.get('note') or 'Связаться с клиентом',
                    overdue=d < today,
                )
        if st in ('won', 'lost'):
            return
        vu = OfferTerm.until(state, meta)
        if vu and today - timedelta(days=self.expired) <= vu <= today + timedelta(days=self.ahead):
            yield dict(
                base,
                kind='expire',
                date=vu.isoformat(),
                text='Срок действия КП истёк' if vu < today else 'Срок действия КП истекает',
                overdue=vu < today,
            )
        if st == 'sent' and not fu:
            at = Val.day(tr.get('at'))
            if at and (today - at).days >= self.stale:
                yield dict(
                    base,
                    kind='stale',
                    date=at.isoformat(),
                    text=f'Отправлено {(today - at).days} дн. назад — ответа нет?',
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
        st = state if isinstance(state, dict) else {}
        mt = meta if isinstance(meta, dict) else {}
        mg = st.get('manager') if isinstance(st.get('manager'), dict) else {}
        ct = st.get('contact') if isinstance(st.get('contact'), dict) else {}
        cv = st.get('cover') if isinstance(st.get('cover'), dict) else {}
        d = Val.day(st.get('date') or mt.get('date'))
        phone = str(mg.get('phone') or '')
        if mg.get('ext'):
            phone += ' доб. ' + str(mg['ext'])
        phone = ', '.join(x for x in (phone, str(mg.get('mobile') or '')) if x.strip())
        eq = ' '.join(x for x in [str(cv.get('title') or '').strip(), str(cv.get('model') or '').strip()] if x).strip()
        return {
            'номер': mt.get('number') or st.get('number') or '',
            'дата': d.strftime('%d.%m.%Y') if d else '',
            'клиент': mt.get('client') or st.get('client') or '',
            'поставщик': supplier,
            'менеджер': mg.get('name') or mt.get('manager') or '',
            'должность': mg.get('position') or '',
            'телефон': phone,
            'e-mail': mg.get('email') or '',
            'контакт': str(ct.get('name') or '').strip(),
            'оборудование': eq,
        }

    def fill(self, tpl) -> str:
        """Шаблон письма с подстановками {номер}, {дата}, {клиент}, {менеджер} и др."""
        v, s = self.vars, str(tpl or '')
        s = s.replace('{, контакт}', (', ' + v['контакт']) if v.get('контакт') else '')
        s = s.replace('{ на оборудование}', (' на ' + v['оборудование']) if v.get('оборудование') else '')
        s = s.replace('{: оборудование}', (': ' + v['оборудование']) if v.get('оборудование') else '')
        for k, x in v.items():
            s = s.replace(f'{{{k}}}', str(x or ''))
        return re.sub(r'\n{3,}', '\n\n', re.sub(r'[ \t]+\n', '\n', s)).strip()


class MailRate:
    """Писем клиентам от одного сотрудника в час — не больше srv-значения kp.mailPerHour (письма уходят с адреса компании)."""

    SENT = {}
    LOCK = threading.Lock()

    @classmethod
    def take(cls, store, who) -> None:
        """Учесть письмо; ValueError — предел исчерпан (с временем ожидания)."""
        now, limit = time.time(), SrvVal.get(store, 'kp.mailPerHour')
        with cls.LOCK:
            v = [t for t in cls.SENT.get(who, []) if now - t < 3600]
            if len(v) >= limit:
                wait = int(v[0] + 3600 - now) // 60 + 1
                raise ValueError(f'Отправлено {len(v)} писем за час — следующее можно через {wait} мин')
            v.append(now)
            cls.SENT[who] = v


class Mailer:
    """Почта программы: настройки SMTP (kv mail) и отправка письма."""

    KEYS = ('host', 'port', 'security', 'login', 'password', 'fromEmail', 'fromName', 'bccSelf', 'subject', 'body')
    MAX_TO = 10

    def __init__(self, store) -> None:
        self.store = store

    def settings(self) -> dict:
        m = self.store.kv_get('mail') or {}
        return m if isinstance(m, dict) else {}

    def on(self) -> bool:
        m = self.settings()
        return bool(m.get('host') and Val.email(m.get('fromEmail')))

    def public(self) -> dict:
        """Для «Настроек»: без пароля (есть ли он — hasPassword)."""
        m = self.settings()
        out = {k: m.get(k, '') for k in self.KEYS if k != 'password'}
        out.update(
            hasPassword=bool(m.get('password')),
            bccSelf=bool(m.get('bccSelf')),
            port=m.get('port') or 465,
            security=m.get('security') or 'ssl',
            subject=m.get('subject') or MailTemplate.SUBJECT,
            body=m.get('body') or MailTemplate.BODY,
            on=self.on(),
        )
        return out

    def save(self, d, by: str) -> dict:
        """Сохранить настройки из «Настроек → Почта». ValueError — с понятным текстом."""
        m = self.settings()
        for k in ('host', 'login', 'fromName', 'subject', 'body'):
            if k in d:
                m[k] = Val.text(d.get(k), 4000 if k == 'body' else 300)
        if 'fromEmail' in d:
            e = Val.text(d.get('fromEmail'), 200)
            if e and not Val.email(e):
                raise ValueError('Адрес отправителя — например, kp@company.ru')
            m['fromEmail'] = e
        if 'port' in d:
            m['port'] = self._port(d.get('port'))
        if 'security' in d:
            if d.get('security') not in ('ssl', 'starttls', 'none'):
                raise ValueError('Защита соединения: ssl, starttls или none')
            m['security'] = d['security']
        if 'bccSelf' in d:
            m['bccSelf'] = bool(d.get('bccSelf'))
        if d.get('password'):
            m['password'] = str(d['password'])[:300]
        if d.get('clearPassword'):
            m.pop('password', None)
        m['updatedAt'], m['updatedBy'] = Val.now(), by
        self.store.kv_set('mail', m)
        return self.public()

    @staticmethod
    def _port(v) -> int:
        try:
            p = int(v or 0)
        except (TypeError, ValueError):
            p = 0
        if not 1 <= p <= 65535:
            raise ValueError('Порт — число от 1 до 65535 (обычно 465 или 587)')
        return p

    @classmethod
    def addresses(cls, s) -> list[str]:
        """Адреса из строки «a@b.ru, c@d.ru». ValueError — неверный адрес или больше MAX_TO."""
        out = [a for a in (x.strip() for x in re.split(r'[,;\s]+', str(s or ''))) if a]
        bad = next((a for a in out if not Val.email(a)), None)
        if bad:
            raise ValueError(f'Неверный адрес почты: {bad[:80]}')
        if len(out) > cls.MAX_TO:
            raise ValueError(f'Не больше {cls.MAX_TO} адресов в письме')
        return out

    def send(self, to, cc, subject, body, files, reply_to='', test=False) -> list[str]:
        """Письмо через SMTP из настроек. files — [(имя, байты, mime)]. → получатели. RuntimeError — с понятным текстом."""
        if not self.on():
            raise RuntimeError('Почта не настроена: администратор — «Настройки → Почта»')
        m = self.settings()
        msg = self._message(m, to, cc, subject, body, files, reply_to)
        rcpt = to + cc + ([m['fromEmail']] if m.get('bccSelf') and not test else [])
        try:
            self._deliver(m, msg, rcpt)
        except smtplib.SMTPAuthenticationError:
            raise RuntimeError('Почтовый сервер не принял логин или пароль — проверьте «Настройки → Почта»') from None
        except (smtplib.SMTPException, OSError) as e:
            raise RuntimeError(f'Письмо не отправлено: {(str(e) or type(e).__name__)[:200]}') from e
        return rcpt

    @staticmethod
    def _message(m, to, cc, subject, body, files, reply_to) -> EmailMessage:
        def line(v) -> str:
            return ' '.join(str(v or '').split())  # заголовок письма — одна строка (перевод строки — ошибка письма)

        msg = EmailMessage()
        msg['From'] = formataddr((line(m.get('fromName')), m['fromEmail']))
        msg['To'] = ', '.join(to)
        if cc:
            msg['Cc'] = ', '.join(cc)
        if reply_to and Val.email(reply_to):
            msg['Reply-To'] = reply_to
        msg['Subject'] = line(subject) or 'Коммерческое предложение'
        msg['Message-ID'] = make_msgid(domain=m['fromEmail'].split('@')[-1])
        msg.set_content(body or '')
        for name, data, mime in files:
            mt, st = (mime or 'application/octet-stream').split('/', 1)
            msg.add_attachment(data, maintype=mt, subtype=st, filename=name)
        return msg

    @staticmethod
    def _deliver(m, msg, rcpt) -> None:
        host, port, sec = m['host'], int(m.get('port') or 465), m.get('security') or 'ssl'
        srv = (
            smtplib.SMTP_SSL(host, port, timeout=30, context=ssl.create_default_context())
            if sec == 'ssl'
            else smtplib.SMTP(host, port, timeout=30)
        )
        with srv:
            if sec == 'starttls':
                srv.starttls(context=ssl.create_default_context())
            if m.get('login'):
                srv.login(m['login'], m.get('password') or '')
            srv.send_message(msg, to_addrs=rcpt)
