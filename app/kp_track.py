# -*- coding: utf-8 -*-
"""Ход сделки по КП: статус, напоминание менеджеру, срок действия предложения, отправка КП клиенту по почте.

• Ход сделки хранится отдельно от описания КП (столбец kp.track): пересохранение КП его не затирает.
  {status, reason, note, at, by, followUp: {date, note, done}, sent: [{at, by, to, files}], history: [{at, by, status, reason, note}]}
• Статусы: new — подготовлено (не отправлено), sent — отправлено клиенту, work — в работе (переговоры), won — выиграно (договор),
  lost — проиграно (с причиной). Причины проигрыша — список «Причины проигрыша» в «Настройках → Списки и выборы».
• Напоминания: «перезвонить» (followUp на дату), срок действия КП истекает (по условию «Срок действия предложения»),
  отправлено и нет ответа больше недели.
• Почта: SMTP из «Настроек → Почта» (kv mail); письмо с файлом КП (Word и / или PDF), ответ — на адрес менеджера КП.
"""
import re
import smtplib
import ssl
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

STATUSES = [('new', 'Подготовлено'), ('sent', 'Отправлено'), ('work', 'В работе'), ('won', 'Выиграно'), ('lost', 'Проиграно')]
STATUS_KEYS = [k for k, _ in STATUSES]
HISTORY_MAX = 50
SENT_MAX = 30
STALE_DAYS = 7            # «отправлено, ответа нет» — столько дней без смены статуса
EXPIRE_AHEAD = 3          # срок действия КП: напомнить за столько дней
EMAIL = re.compile(r'^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$')


def _now():
    return datetime.now().isoformat(timespec='seconds')


def _day(s):
    """'ГГГГ-ММ-ДД' → date или None."""
    try:
        return datetime.strptime(str(s or '')[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def _text(v, n):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(v or '')).strip()[:n]


# ---------------------------------------------------------------- статус и напоминание
def update(store, kid, d, by):
    """Изменить ход сделки: status, reason, note, followUp ({date, note} | {done: true} | None). ValueError — с понятным текстом."""
    tr = store.kp_track_get(kid)
    changed = {}
    if 'status' in d:
        st = d.get('status') or 'new'
        if st not in STATUS_KEYS:
            raise ValueError('Неизвестный статус КП')
        reason = _text(d.get('reason'), 200) if st == 'lost' else ''
        note = _text(d.get('note'), 500)
        if st != (tr.get('status') or 'new') or reason != (tr.get('reason') or '') or note != (tr.get('note') or ''):
            tr.update(status=st, reason=reason, note=note, at=_now(), by=by)
            changed = {'status': st, 'reason': reason, 'note': note}
            if st in ('won', 'lost') and isinstance(tr.get('followUp'), dict):
                tr['followUp']['done'] = True          # сделка закрыта — напоминание больше не нужно
    if 'followUp' in d:
        fu = d.get('followUp')
        if fu is None:
            tr.pop('followUp', None)
            changed['followUp'] = None
        elif isinstance(fu, dict):
            if fu.get('done'):
                if isinstance(tr.get('followUp'), dict):
                    tr['followUp']['done'] = True
                changed['followUp'] = 'выполнено'
            else:
                dt = _day(fu.get('date'))
                if not dt:
                    raise ValueError('Дата напоминания — в формате ГГГГ-ММ-ДД')
                tr['followUp'] = {'date': dt.isoformat(), 'note': _text(fu.get('note'), 300), 'by': by, 'at': _now()}
                changed['followUp'] = tr['followUp']
        else:
            raise ValueError('Напоминание: нужна дата')
    if changed:
        h = tr.get('history') if isinstance(tr.get('history'), list) else []
        h.append(dict(changed, at=_now(), by=by))
        tr['history'] = h[-HISTORY_MAX:]
        store.kp_track_set(kid, tr)
    return tr, changed


def mark_sent(store, kid, to, files, by):
    tr = store.kp_track_get(kid)
    s = tr.get('sent') if isinstance(tr.get('sent'), list) else []
    s.append({'at': _now(), 'by': by, 'to': to, 'files': files})
    tr['sent'] = s[-SENT_MAX:]
    if (tr.get('status') or 'new') == 'new':
        tr.update(status='sent', at=_now(), by=by)
        h = tr.get('history') if isinstance(tr.get('history'), list) else []
        h.append({'status': 'sent', 'note': 'письмо: ' + ', '.join(to), 'at': _now(), 'by': by})
        tr['history'] = h[-HISTORY_MAX:]
    store.kp_track_set(kid, tr)
    return tr


# ---------------------------------------------------------------- срок действия предложения
_UNITS = (('раб', 'work'), ('дн', 1), ('ден', 1), ('сут', 1), ('недел', 7), ('мес', 30))


def valid_until(state, meta=None):
    """Дата окончания срока действия КП (date) по условию «Срок действия …»: «30 дней», «10 рабочих дней», «2 недели»,
    «1 месяц», «до 31.12.2026»; от даты КП. None — срок не указан или не распознан."""
    m = meta if isinstance(meta, dict) else {}
    if m.get('validUntil'):
        return _day(m['validUntil'])
    st = state if isinstance(state, dict) else {}
    cond = next((c for c in (st.get('conditions') or []) if isinstance(c, dict) and 'действ' in str(c.get('label') or '').lower()), None)
    v = str((cond or {}).get('value') or '').lower()
    if not v:
        return None
    dm = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', v)
    if dm:
        try:
            return date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
        except ValueError:
            return None
    base = _day(st.get('date') or m.get('date'))
    nm = re.search(r'(\d{1,3})\s*([а-яё]*)\s*([а-яё]*)', v)
    if not base or not nm:
        return None
    n, words = int(nm.group(1)), nm.group(2) + ' ' + nm.group(3)
    for key, mult in _UNITS:
        if key in words:
            if mult == 'work':          # рабочие дни: без выходных (праздники — приблизительно)
                d, k = base, 0
                while k < n:
                    d += timedelta(days=1)
                    if d.weekday() < 5:
                        k += 1
                return d
            return base + timedelta(days=n * mult)
    return None


# ---------------------------------------------------------------- напоминания менеджера
def reminders(rows, mine, today=None):
    """rows — [(id, meta-dict, track-dict, state-dict)] доступных КП; mine(meta) — КП этого менеджера.
    Возвращает [{kind: follow | expire | stale, id, number, client, date, text, overdue}] по сроку."""
    today = today or date.today()
    out = []
    for kid, meta, tr, state in rows:
        if not mine(meta):
            continue
        st = tr.get('status') or 'new'
        base = {'id': kid, 'number': meta.get('number') or kid, 'client': meta.get('client') or '', 'status': st}
        fu = tr.get('followUp') if isinstance(tr.get('followUp'), dict) else None
        if fu and not fu.get('done'):
            d = _day(fu.get('date'))
            if d and d <= today + timedelta(days=1):
                out.append(dict(base, kind='follow', date=d.isoformat(), text=fu.get('note') or 'Связаться с клиентом', overdue=d < today))
        if st in ('won', 'lost'):
            continue
        vu = valid_until(state, meta)
        if vu and today - timedelta(days=3) <= vu <= today + timedelta(days=EXPIRE_AHEAD):
            out.append(dict(base, kind='expire', date=vu.isoformat(),
                            text='Срок действия КП истёк' if vu < today else 'Срок действия КП истекает', overdue=vu < today))
        if st == 'sent' and not fu:
            at = _day(tr.get('at'))
            if at and (today - at).days >= STALE_DAYS:
                out.append(dict(base, kind='stale', date=at.isoformat(), text='Отправлено %d дн. назад — ответа нет?' % (today - at).days, overdue=False))
    out.sort(key=lambda x: (x['date'], x['number']))
    return out


# ---------------------------------------------------------------- почта
MAIL_KEYS = ('host', 'port', 'security', 'login', 'password', 'fromEmail', 'fromName', 'bccSelf', 'subject', 'body')
SUBJECT = 'Коммерческое предложение № {номер} — {поставщик}'
BODY = ('Здравствуйте{, контакт}!\n\nНаправляем коммерческое предложение № {номер} от {дата}{: оборудование}.\n'
        'Файл — во вложении. Будем рады ответить на вопросы.\n\nС уважением,\n{менеджер}\n{должность}\n{телефон}\n{e-mail}')


def mail_get(store):
    m = store.kv_get('mail') or {}
    return m if isinstance(m, dict) else {}


def mail_public(store):
    """Для «Настроек»: без пароля (есть ли он — hasPassword)."""
    m = mail_get(store)
    out = {k: m.get(k, '') for k in MAIL_KEYS if k != 'password'}
    out.update(hasPassword=bool(m.get('password')), bccSelf=bool(m.get('bccSelf')), port=m.get('port') or 465, security=m.get('security') or 'ssl',
               subject=m.get('subject') or SUBJECT, body=m.get('body') or BODY, on=mail_on(store))
    return out


def mail_on(store):
    m = mail_get(store)
    return bool(m.get('host') and EMAIL.match(m.get('fromEmail') or ''))


def mail_save(store, d, by):
    m = mail_get(store)
    for k in ('host', 'login', 'fromName', 'subject', 'body'):
        if k in d:
            m[k] = _text(d.get(k), 4000 if k == 'body' else 300)
    if 'fromEmail' in d:
        e = _text(d.get('fromEmail'), 200)
        if e and not EMAIL.match(e):
            raise ValueError('Адрес отправителя — например, kp@company.ru')
        m['fromEmail'] = e
    if 'port' in d:
        try:
            p = int(d.get('port') or 0)
        except (TypeError, ValueError):
            p = 0
        if not 1 <= p <= 65535:
            raise ValueError('Порт — число от 1 до 65535 (обычно 465 или 587)')
        m['port'] = p
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
    m['updatedAt'], m['updatedBy'] = _now(), by
    store.kv_set('mail', m)
    return mail_public(store)


def fill(tpl, v):
    """Подстановки письма: {номер}, {дата}, {клиент}, {поставщик}, {менеджер}, {должность}, {телефон}, {e-mail};
    {, контакт} и {: оборудование} — с текстом вокруг, если значение есть."""
    s = str(tpl or '')
    s = s.replace('{, контакт}', (', ' + v['контакт']) if v.get('контакт') else '')
    s = s.replace('{ на оборудование}', (' на ' + v['оборудование']) if v.get('оборудование') else '')
    s = s.replace('{: оборудование}', (': ' + v['оборудование']) if v.get('оборудование') else '')
    for k, x in v.items():
        s = s.replace('{%s}' % k, str(x or ''))
    return re.sub(r'\n{3,}', '\n\n', re.sub(r'[ \t]+\n', '\n', s)).strip()


def addresses(s):
    out = []
    for a in re.split(r'[,;\s]+', str(s or '')):
        a = a.strip()
        if not a:
            continue
        if not EMAIL.match(a):
            raise ValueError('Неверный адрес почты: %s' % a[:80])
        out.append(a)
    if len(out) > 10:
        raise ValueError('Не больше 10 адресов в письме')
    return out


def send(store, to, cc, subject, body, files, reply_to='', test=False):
    """Письмо через SMTP из настроек. files — [(имя, байты, mime)]. RuntimeError — с понятным текстом."""
    m = mail_get(store)
    if not mail_on(store):
        raise RuntimeError('Почта не настроена: администратор — «Настройки → Почта»')
    msg = EmailMessage()
    msg['From'] = formataddr((m.get('fromName') or '', m['fromEmail']))
    msg['To'] = ', '.join(to)
    if cc:
        msg['Cc'] = ', '.join(cc)
    if reply_to and EMAIL.match(reply_to):
        msg['Reply-To'] = reply_to
    msg['Subject'] = subject or 'Коммерческое предложение'
    msg['Message-ID'] = make_msgid(domain=m['fromEmail'].split('@')[-1])
    msg.set_content(body or '')
    for name, data, mime in files:
        mt, st = (mime or 'application/octet-stream').split('/', 1)
        msg.add_attachment(data, maintype=mt, subtype=st, filename=name)
    rcpt = to + cc + ([m['fromEmail']] if m.get('bccSelf') and not test else [])
    host, port, sec = m['host'], int(m.get('port') or 465), m.get('security') or 'ssl'
    try:
        if sec == 'ssl':
            srv = smtplib.SMTP_SSL(host, port, timeout=30, context=ssl.create_default_context())
        else:
            srv = smtplib.SMTP(host, port, timeout=30)
        with srv:
            if sec == 'starttls':
                srv.starttls(context=ssl.create_default_context())
            if m.get('login'):
                srv.login(m['login'], m.get('password') or '')
            srv.send_message(msg, to_addrs=rcpt)
    except smtplib.SMTPAuthenticationError:
        raise RuntimeError('Почтовый сервер не принял логин или пароль — проверьте «Настройки → Почта»')
    except (smtplib.SMTPException, OSError) as e:
        raise RuntimeError('Письмо не отправлено: %s' % (str(e) or type(e).__name__)[:200])
    return rcpt


def mail_vars(state, meta, supplier=''):
    """Значения подстановок письма из КП."""
    st = state if isinstance(state, dict) else {}
    mt = meta if isinstance(meta, dict) else {}
    mg = st.get('manager') if isinstance(st.get('manager'), dict) else {}
    ct = st.get('contact') if isinstance(st.get('contact'), dict) else {}
    cv = st.get('cover') if isinstance(st.get('cover'), dict) else {}
    d = _day(st.get('date') or mt.get('date'))
    phone = ', '.join(x for x in [str(mg.get('phone') or '') + ((' доб. ' + str(mg['ext'])) if mg.get('ext') else ''), str(mg.get('mobile') or '')] if x.strip())
    eq = ' '.join(x for x in [str(cv.get('title') or '').strip(), str(cv.get('model') or '').strip()] if x).strip()
    return {'номер': mt.get('number') or st.get('number') or '', 'дата': d.strftime('%d.%m.%Y') if d else '', 'клиент': mt.get('client') or st.get('client') or '',
            'поставщик': supplier, 'менеджер': mg.get('name') or mt.get('manager') or '', 'должность': mg.get('position') or '',
            'телефон': phone, 'e-mail': mg.get('email') or '', 'контакт': str(ct.get('name') or '').strip(), 'оборудование': eq}
