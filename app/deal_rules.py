"""Регламент оформления сделки Битрикс24: что должно быть заполнено для стадии, проигрыша и клиента сделки."""

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from client_match import ContactKey
from crm_funnels import DealFields, Funnels
from kp_track import Val


class Close(Enum):
    """Когда пункт обязателен: на стадиях по ходу сделки, при успехе или при проигрыше."""

    OPEN = 'open'
    WON = 'won'
    LOST = 'lost'


class Source(Enum):
    """Куда пишется пункт: поле сделки Битрикса, заметка сделки, файл КП (прикладывается сам)."""

    FIELD = 'uf'
    NOTE = 'note'
    FILE = 'file'


@dataclass(frozen=True)
class RegItem:
    """Пункт регламента: поле портала ищется по названию (find), обязателен со стадии since (или во воронке funnel)."""

    key: str
    label: str
    find: str
    since: str = ''
    close: Close = Close.OPEN
    when: str = ''
    funnel: str = ''
    source: Source = Source.FIELD

    def pattern(self) -> re.Pattern:
        return re.compile(self.find, re.IGNORECASE)


@dataclass(frozen=True)
class Target:
    """Куда переводится сделка: воронка, стадия, вид (по ходу / успех / провал), причина провала."""

    funnel: str
    stage: str
    close: Close
    reason: str = ''
    label: str = ''  # стадия провала воронки Битрикса («Дубль сделки»)

    def why(self) -> str:
        """Стадия провала и причина — по ним выбираются пункты «дубль», «нецелевая»."""
        return f'{self.label} {self.reason}'.strip()


class DealRegs:
    """Регламент «Правила ведения и оформления сделки в Битрикс24»: пункты, их поля портала и проверка перед стадией.

    Поле портала для пункта подбирается по названию; администратор может выбрать другое или выключить пункт
    («Настройки → Связи → Битрикс24 → Регламент»). Поля пунктов показываются в карточке сделки во всех воронках.
    """

    KEY = 'crm.dealRegs'
    TAKEN = r'взят[оа]? в работ'
    OFFER = r'ткп|кп отправ|предложени'
    TALKS = r'согласовани'
    SIGNED = r'договор подписан|подписан'
    FIRST_PAY = r'перв\w* оплат'
    SERVICE = r'сервис'
    MAIN_LABELS = {
        'lead': 'Взято в работу',
        'sent': 'ТКП отправлено клиенту',
        'talks': 'Согласование договора',
        'contract': 'Договор подписан',
        'delivery': 'Договор подписан',
    }
    ITEMS = (
        RegItem('note', 'Комментарий (кратко о заявке)', r'^$', TAKEN, source=Source.NOTE),
        RegItem('source', 'Источник', r'^источник', TAKEN),
        RegItem('topic', 'Тема запроса', r'тема запрос', TAKEN),
        RegItem('ctype', 'Тип компании', r'тип (компани|клиент)', TAKEN),
        RegItem('region', 'Регион', r'^регион', TAKEN),
        RegItem('eqtype', 'Тип оборудования', r'(тип|вид) оборудован', TAKEN),
        RegItem('askBrand', 'Запрошенный бренд', r'запрош\w* бренд', TAKEN),
        RegItem('askGoods', 'Запрошенный товар', r'запрош\w* товар', TAKEN),
        RegItem('brand', 'Бренд по сделке', r'бренд по сделк', OFFER),
        RegItem('goods', 'Товар по сделке', r'товар по сделк', OFFER),
        RegItem('expect', 'Ожидаемая сумма сделки', r'ожидаем\w* сумм', OFFER),
        RegItem('margin', 'Маржа ожидаемая', r'марж\w* ожидаем|ожидаем\w* марж', OFFER),
        RegItem('tkp', 'ТКП / счёт (файл)', r'ткп.*сч[её]т|загрузить ткп', OFFER, source=Source.FILE),
        RegItem('pay', 'Условия оплаты', r'услови\w* оплат', SIGNED),
        RegItem('contract', 'Сумма по договору', r'сумм\w*.*по договор', SIGNED),
        RegItem('pay1Date', 'Дата выписки по 1-му платежу', r'дата выписки', FIRST_PAY),
        RegItem('pay1', '1-й платёж', r'^1-?\s?й плат[её]ж', FIRST_PAY),
        RegItem('pay1Margin', 'Маржа по 1-му платежу', r'марж\w* по 1', FIRST_PAY),
        RegItem('marginFact', 'Маржа фактическая в план', r'марж\w* фактическ\w* в план', FIRST_PAY, Close.WON),
        RegItem('invoice', '№ счёта', r'^№ сч[её]т|номер сч[её]т', funnel=SERVICE),
        RegItem('works', 'Описание работ сервиса', r'описание работ', funnel=SERVICE),
        RegItem('address', 'Адрес клиента для сервиса', r'адрес клиента для сервис', funnel=SERVICE),
        RegItem('visit', 'Желаемая дата выезда инженера', r'дата выезда', funnel=SERVICE),
        RegItem('lostNote', 'Комментарий к проигранной сделке', r'коммент\w* к проигран', close=Close.LOST),
        RegItem('dupId', 'ID основной сделки (дубль)', r'id основн', close=Close.LOST, when=r'дубл'),
        RegItem(
            'untarget',
            'Комментарий к нецелевой заявке',
            r'коммент\w* к не\s?целев',
            close=Close.LOST,
            when=r'не\s?целев',
        ),
    )
    CLIENT = (
        ('companyPhone', 'Телефон компании'),
        ('companyEmail', 'Почта компании'),
        ('inn', 'ИНН компании'),
        ('person', 'ФИО контакта'),
        ('personPhone', 'Телефон контакта'),
        ('personEmail', 'Почта контакта'),
    )
    PHONE_MIN = 10
    PHONE_MAX = 15
    NAME_MAX = 120
    NOTE_MAX = 3000
    FIO_WORDS = 2
    INN_LENGTHS = (10, 12)
    HINT_ITEMS = 3

    def __init__(self, store) -> None:
        self.store = store
        self.fields = DealFields(store)
        self.funnels = Funnels(store)

    def conf(self) -> dict:
        data = self.store.kv_get(self.KEY) or {}
        return data if isinstance(data, dict) else {}

    def enabled(self) -> bool:
        from bitrix import BitrixConf

        return self.conf().get('on', True) is not False and BitrixConf(self.store).enabled()

    def by_key(self) -> dict[str, RegItem]:
        return {item.key: item for item in self.ITEMS}

    def codes(self) -> dict[str, str]:
        """Пункт → код поля портала: выбор администратора, иначе — по названию поля; выключенные пункты — без поля."""
        conf = self.conf()
        chosen = picked if isinstance(picked := conf.get('map'), dict) else {}
        off = set(conf.get('off') or [])
        defs = self.fields.by_code()
        out = {}
        for item in self.ITEMS:
            if item.key in off or item.source is Source.NOTE:
                continue
            code = chosen.get(item.key)
            code = code if code in defs else self._match(item, defs)
            if code:
                out[item.key] = code
        return out

    @staticmethod
    def _match(item: RegItem, defs: dict) -> str:
        """Поле портала для пункта: по названию; из нескольких похожих — не служебное и чаще заполняемое в сделках."""
        pattern = item.pattern()
        found = [
            row
            for row in defs.values()
            if pattern.search(row.get('label') or '') or pattern.search(row.get('title') or '')
        ]
        found.sort(
            key=lambda row: (
                DealFields.SERVICE.search(row.get('title') or '') is not None,
                -max((row.get('fill') or {}).values(), default=0),
                len(row.get('title') or ''),
            )
        )
        return found[0]['code'] if found else ''

    def mark(self) -> bool:
        """Поля пунктов — в карточке во всех воронках (отметка reg у описания поля). → изменилось ли."""
        wanted = set(self.codes().values()) if self.conf().get('on', True) is not False else set()
        rows = self.fields.all()
        changed = False
        for row in rows:
            flag = row['code'] in wanted
            if bool(row.get('reg')) != flag:
                row['reg'] = flag
                changed = True
        if changed:
            self.fields.save_rows(rows)
        return changed

    # --- что нужно для стадии ---

    def target(self, deal: dict, stage: str, reason: str = '') -> Target:
        funnel = deal.get('funnel') or Funnels.MAIN
        found = self.funnels.resolve(funnel, stage)
        if not found:
            raise ValueError('Неизвестный этап сделки')
        column, exact = found
        close = {Funnels.WON: Close.WON, Funnels.LOST: Close.LOST}.get(column, Close.OPEN)
        label = self.funnels.label(funnel, exact) if close is Close.LOST and funnel != Funnels.MAIN else ''
        return Target(funnel, exact, close, reason, label)

    def required(self, target: Target) -> list[RegItem]:
        """Пункты, обязательные для перехода (у которых есть поле портала или это заметка сделки)."""
        codes = self.codes()
        off = set(self.conf().get('off') or [])
        out = []
        for item in self.ITEMS:
            if item.key in off or (item.source is not Source.NOTE and item.key not in codes):
                continue
            if self._applies(item, target):
                out.append(item)
        return out

    def _applies(self, item: RegItem, target: Target) -> bool:
        if target.close is Close.LOST:
            return item.close is Close.LOST and (not item.when or bool(re.search(item.when, target.why(), re.I)))
        if item.close is Close.LOST:
            return False
        labels = self._labels(target.funnel)
        if item.funnel:
            name = (self.funnels.get(target.funnel) or {}).get('name') or ''
            if not re.search(item.funnel, name, re.IGNORECASE):
                return False
            since = 1
        else:
            found = next((index for index, label in enumerate(labels) if re.search(item.since, label, re.I)), None)
            if found is None:
                return False
            since = found
        if item.close is Close.WON:
            return target.close is Close.WON
        if target.close is Close.WON:
            return True
        keys = self.funnels.open_keys(target.funnel)
        return target.stage in keys and keys.index(target.stage) >= since

    def _labels(self, funnel: str) -> list[str]:
        keys = self.funnels.open_keys(funnel)
        if funnel == Funnels.MAIN:
            return [self.MAIN_LABELS.get(key, key) for key in keys]
        return [self.funnels.label(funnel, key) for key in keys]

    def missing(self, deal: dict, target: Target) -> dict:
        """Чего не хватает: {fields: [пункты], client: [ключи клиента]} — по сделке, её клиенту и КП."""
        codes = self.codes()
        has_file = self.kp_file(deal.get('id') or '')
        values = deal.get('uf') or {}
        defs, users = self.fields.by_code(), self.fields.users()
        items = []
        for item in self.required(target):
            if item.source is Source.FIELD and not DealFields.fillable(defs.get(codes.get(item.key, '')), users):
                continue  # поле не заполнить из программы (вид поля или нет вариантов) — заполняется в Битрикс24
            if item.source is Source.NOTE:
                empty = not str(deal.get('note') or '').strip()
            elif item.source is Source.FILE:
                empty = not has_file and not self._filled(values.get(codes[item.key]))
            else:
                empty = not self._filled(values.get(codes[item.key]))
            if empty:
                items.append(item)
        client = self.client_gaps(deal) if target.close is not Close.LOST and self._taken(target) else []
        return {'fields': items, 'client': client}

    def kp_file(self, did: str) -> bool:
        """У сделки есть КП, сохранённое в Word, — его файл уйдёт в поле «ТКП / счёт» сам."""
        row = self.store.one(
            "SELECT 1 FROM deal_kp l JOIN kp k ON k.id = l.kp_id WHERE l.deal_id=? AND COALESCE(k.docx, '') <> '' LIMIT 1",
            (did,),
        )
        return row is not None

    def _taken(self, target: Target) -> bool:
        """Сделка уже «взята в работу» (дальше первой стадии) — клиент и контакт должны быть заполнены."""
        if target.close is Close.WON:
            return True
        keys = self.funnels.open_keys(target.funnel)
        return target.stage in keys and keys.index(target.stage) > 0

    @staticmethod
    def _filled(value: Any) -> bool:
        if isinstance(value, list):
            return bool(value)
        return value not in (None, '', '0')

    # --- клиент сделки ---

    def client_of(self, deal: dict) -> dict:
        cid = deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')
        found = self.store.client_get(cid) if cid else None
        return found if isinstance(found, dict) else {}

    def client_gaps(self, deal: dict) -> list[str]:
        """Пустое в клиенте сделки по регламенту: телефон и почта компании, ИНН, ФИО, телефон и почта контакта."""
        client = self.client_of(deal)
        person = self.person(client)
        checks = {
            'companyPhone': bool(ContactKey.phone(client.get('phone'))),
            'companyEmail': Val.email(str(client.get('email') or '')),
            'inn': bool(client.get('noInn'))
            or len(re.sub(r'\D', '', str(client.get('inn') or deal.get('clientInn') or ''))) in self.INN_LENGTHS,
            'person': len(str(person.get('name') or '').split()) >= self.FIO_WORDS,
            'personPhone': bool(ContactKey.phone(person.get('phone'))),
            'personEmail': Val.email(str(person.get('email') or '')),
        }
        return [key for key, _label in self.CLIENT if not checks[key]]

    @staticmethod
    def person(client: dict) -> dict:
        rows = [row for row in client.get('contacts') or [] if isinstance(row, dict)]
        return rows[0] if rows else {}

    def save_client(self, deal: dict, data: Any, author: str) -> dict:
        """Телефон и почта компании, ИНН, контакт (первый в карточке клиента) — из окна «Заполните». ValueError — понятно."""
        if not isinstance(data, dict) or not data:
            return deal
        client = self.client_of(deal)
        inn = re.sub(r'\D', '', str(data.get('inn') or ''))
        if 'inn' in data and inn and len(inn) not in self.INN_LENGTHS:
            raise ValueError('ИНН — 10 цифр (организация) или 12 (ИП)')
        if not client:
            if not inn:
                raise ValueError('Укажите ИНН клиента — без него клиента нет в справочнике')
            client = ClientByInn(self.store).ensure(inn, deal.get('client') or '', author)
        doc = {key: value for key, value in client.items() if key != '_rev'}
        if inn and not doc.get('inn'):
            doc['inn'] = inn
        for key, field in (('companyPhone', 'phone'), ('companyEmail', 'email')):
            if key in data:
                doc[field] = self._contact_value(field, data[key])
        person = {
            field: self._contact_value(field, data[key])
            for key, field in (('person', 'name'), ('personPhone', 'phone'), ('personEmail', 'email'))
            if key in data
        }
        if person:
            rows = [dict(row) for row in doc.get('contacts') or [] if isinstance(row, dict)]
            if rows:
                rows[0].update(person)
            else:
                rows.append(person)
            doc['contacts'] = rows
        self.store.client_put(doc['id'], doc, author)
        return dict(deal, clientId=doc['id'], clientInn=doc.get('inn') or deal.get('clientInn') or '')

    def _contact_value(self, field: str, raw: Any) -> str:
        text = Val.text(raw, self.NAME_MAX)
        if not text:
            return ''
        if field == 'phone':
            digits = re.sub(r'\D', '', text)
            if not self.PHONE_MIN <= len(digits) <= self.PHONE_MAX:
                raise ValueError(f'Телефон «{text}» — от {self.PHONE_MIN} до {self.PHONE_MAX} цифр')
        if field == 'email' and not Val.email(text):
            raise ValueError(f'Почта «{text}» указана с ошибкой')
        return text

    # --- окно «Заполните» ---

    def need(self, deal: dict, stage: str, reason: str = '') -> dict:
        """Окно перед стадией: недостающие поля (описание поля портала), клиент и контакт, подсказка заметки."""
        target = self.target(deal, stage, reason)
        gaps = self.missing(deal, target)
        defs = self.fields.by_code()
        codes = self.codes()
        fields = []
        for item in gaps['fields']:
            row: dict[str, Any] = {'key': item.key, 'label': item.label, 'source': item.source.value}
            if item.source is Source.FIELD:
                row['field'] = defs[codes[item.key]]
            fields.append(row)
        client = self.client_of(deal)
        person = self.person(client)
        labels = dict(self.CLIENT)
        return {
            'stage': self._stage_label(target),
            'key': target.stage,
            'noteHint': self._note_hint(deal.get('id') or '') if any(row['key'] == 'note' for row in fields) else '',
            'users': self.fields.users()
            if any(row.get('field', {}).get('type') == 'employee' for row in fields)
            else {},
            'close': target.close.value,
            'ok': not fields and not gaps['client'],
            'fields': fields,
            'client': [{'key': key, 'label': labels[key]} for key in gaps['client']],
            'values': {
                'companyPhone': client.get('phone') or '',
                'companyEmail': client.get('email') or '',
                'inn': client.get('inn') or deal.get('clientInn') or '',
                'person': person.get('name') or '',
                'personPhone': person.get('phone') or '',
                'personEmail': person.get('email') or '',
            },
        }

    def _note_hint(self, did: str) -> str:
        """Подсказка «Комментария»: что предложено в КП сделки (менеджер правит)."""
        names: list[str] = []
        for (meta,) in self.store.all(
            'SELECT k.meta FROM deal_kp l JOIN kp k ON k.id = l.kp_id WHERE l.deal_id=? AND k.meta IS NOT NULL', (did,)
        ):
            items = self._json(meta).get('items')
            names += [str(item) for item in items if item] if isinstance(items, list) else []
        names = list(dict.fromkeys(names))[: self.HINT_ITEMS]
        return 'Запрос: ' + '; '.join(names) if names else ''

    @staticmethod
    def _json(raw: Any) -> dict:
        try:
            found = json.loads(raw or '{}')
        except (TypeError, ValueError):
            return {}
        return found if isinstance(found, dict) else {}

    def next_gaps(self, deal: dict) -> dict | None:
        """Для карточки: чего не хватает до следующей стадии воронки (коды полей — для отметки «*»)."""
        if not self.enabled() or deal.get('stage') in Funnels.CLOSED:
            return None
        funnel = deal.get('funnel') or Funnels.MAIN
        keys = self.funnels.open_keys(funnel)
        current = deal.get('fstage') or deal.get('stage')
        if current not in keys or keys.index(current) + 1 >= len(keys):
            return None
        stage = keys[keys.index(current) + 1]
        target = self.target(deal, stage)
        gaps = self.missing(deal, target)
        codes = self.codes()
        labels = dict(self.CLIENT)
        names = [item.label for item in gaps['fields']] + [labels[key] for key in gaps['client']]
        return {
            'stage': stage,
            'label': self._stage_label(target),
            'names': names,
            'codes': [codes[item.key] for item in gaps['fields'] if item.key in codes],
        }

    def _stage_label(self, target: Target) -> str:
        if target.close is Close.LOST:
            why = target.label or target.reason
            return 'Сделка проиграна' + (f' — {why}' if why else '')
        return self.funnels.label(target.funnel, target.stage)

    def check(self, deal: dict, stage: str, reason: str = '') -> None:
        """Перед сменой стадии из программы: не заполнено по регламенту — ValueError с перечнем."""
        if not self.enabled():
            return
        target = self.target(deal, stage, reason)
        gaps = self.missing(deal, target)
        labels = dict(self.CLIENT)
        names = [item.label for item in gaps['fields']] + [labels[key] for key in gaps['client']]
        if names:
            raise ValueError(
                'Для стадии «{}» по регламенту заполните: {}'.format(self._stage_label(target), ', '.join(names))
            )

    # --- настройка администратора ---

    def view(self) -> dict:
        """Пункты для «Настроек»: поле портала (выбранное или найденное), варианты, выключен ли."""
        conf = self.conf()
        chosen = picked if isinstance(picked := conf.get('map'), dict) else {}
        off = set(conf.get('off') or [])
        defs = self.fields.by_code()
        rows = []
        for item in self.ITEMS:
            auto = self._match(item, defs) if item.source is not Source.NOTE else ''
            rows.append(
                {
                    'key': item.key,
                    'label': item.label,
                    'when': self._when_text(item),
                    'code': chosen.get(item.key) if chosen.get(item.key) in defs else auto,
                    'auto': auto,
                    'note': item.source is Source.NOTE,
                    'off': item.key in off,
                }
            )
        fields = [
            {'code': row['code'], 'label': row.get('label') or row.get('title') or row['code']} for row in defs.values()
        ]
        fields.sort(key=lambda row: row['label'].lower())
        return {'on': conf.get('on', True) is not False, 'items': rows, 'fields': fields}

    @staticmethod
    def _when_text(item: RegItem) -> str:
        if item.close is Close.LOST:
            return 'при проигрыше' + (' (дубль)' if 'дубл' in item.when else ' (нецелевая)' if item.when else '')
        if item.funnel:
            return 'заявки в сервис'
        stage = {
            DealRegs.TAKEN: 'с «Взято в работу»',
            DealRegs.OFFER: 'с «ТКП отправлено»',
            DealRegs.SIGNED: 'с «Договор подписан»',
            DealRegs.FIRST_PAY: 'с «Первая оплата»',
        }.get(item.since, '')
        return 'при завершении проекта' if item.close is Close.WON else stage

    def save(self, data: Any) -> dict:
        if not isinstance(data, dict):
            raise ValueError('Нет настроек регламента')
        known = self.by_key()
        defs = self.fields.by_code()
        chosen = picked if isinstance(picked := data.get('map'), dict) else {}
        conf = {
            'on': data.get('on', True) is not False,
            'map': {key: str(code) for key, code in chosen.items() if key in known and str(code) in defs},
            'off': sorted({str(key) for key in data.get('off') or [] if key in known}),
        }
        self.store.kv_set(self.KEY, conf)
        self.mark()
        return self.view()


class ClientByInn:
    """Клиент по ИНН: из справочника, иначе — реквизиты из ФНС (DaData, ЕГРЮЛ) и новая карточка; так регион, адрес и
    тип компании для полей Битрикс24 заполняются сами."""

    KEEP = ('kpp', 'ogrn', 'full', 'address', 'director', 'directorPost', 'okved', 'status')

    def __init__(self, store) -> None:
        self.store = store

    def ensure(self, inn: str, name: str = '', author: str = '') -> dict:
        """Карточка клиента с этим ИНН (найденная или новая). ValueError — ИНН с ошибкой."""
        digits = re.sub(r'\D', '', str(inn or ''))
        if len(digits) not in DealRegs.INN_LENGTHS:
            raise ValueError('ИНН — 10 цифр (организация) или 12 (ИП)')
        known = self.store.client_get('inn' + digits)
        if isinstance(known, dict) and known:
            return known
        found = self._lookup(digits)
        doc = {
            'id': 'inn' + digits,
            'name': str(found.get('short') or found.get('full') or name or '')[: DealRegs.NAME_MAX * 2],
            'inn': digits,
            'contacts': [],
            **{key: found[key] for key in self.KEEP if found.get(key)},
        }
        if not doc['name']:
            raise ValueError('Организация с таким ИНН не найдена — проверьте ИНН или впишите название')
        self.store.client_put(doc['id'], doc, author)
        return doc

    def _lookup(self, inn: str) -> dict:
        from counterparty import Counterparties

        try:
            found = Counterparties(self.store).lookup(inn)
        except Exception:
            return {}
        return found if isinstance(found, dict) and not found.get('error') else {}
