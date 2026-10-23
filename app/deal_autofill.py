"""Поля сделки Битрикс24 из КП: пустые поля карточки заполняются по позициям КП, клиенту и прошлым сделкам."""

import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from crm_funnels import DealFields, Funnels
from deal_rules import DealRegs
from equipment_types import load_types_builtin


def _obj(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        found = json.loads(raw or '{}')
    except (TypeError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


class Words:
    """Слова текста для сравнения со значениями списков Битрикса: русские — по началу слова (окончания не мешают)."""

    STEM = 5
    SHORT = 3
    STOP = frozenset({'для', 'прочее', 'прочие', 'другое', 'другие', 'иное', 'общее', 'все', 'или', 'без', 'под'})

    @classmethod
    def plain(cls, text: str) -> set[str]:
        """Целые слова (для городов и регионов)."""
        words = re.findall(r'[a-zа-яё0-9]+', str(text or '').lower().replace('ё', 'е'))
        return {word for word in words if len(word) >= cls.SHORT and word not in cls.STOP}

    @classmethod
    def stems(cls, text: str) -> set[str]:
        return {cls._stem(word) for word in cls.plain(text)}

    @classmethod
    def _stem(cls, word: str) -> str:
        return word[: cls.STEM] if re.match('[а-я]', word) else word

    @staticmethod
    def key(text: str) -> str:
        """Название без знаков и регистра: «Atlas Copco» = «ATLAS-COPCO»."""
        return re.sub(r'[^a-zа-я0-9]', '', str(text or '').lower().replace('ё', 'е'))


@dataclass
class KpFacts:
    """Что известно о сделке из её КП и клиента."""

    names: list[str] = field(default_factory=list)
    makers: list[str] = field(default_factory=list)
    cats: list[str] = field(default_factory=list)
    texts: dict[str, set[str]] = field(default_factory=dict)  # категория → слова позиций этой категории
    address: str = ''
    inn: str = ''
    sum_rub: int = 0

    def stems(self) -> set[str]:
        return set().union(*self.texts.values()) if self.texts else set()


class FieldKind:
    """Вид поля Битрикса по названию — каким правилом заполнять (порядок важен: первое совпадение)."""

    SKIP = re.compile(
        r'запрош|источник|реклам|обращени|причин|стади|ответствен|коммент|дата|телефон|почт|e-?mail|ссылк|вероятн|'
        r'описани|неисправ',
        re.I,
    )
    RULES = (
        ('brand', re.compile(r'бренд|марк[аи]|производител', re.I)),
        ('form', re.compile(r'форма органи|организационн|опф', re.I)),
        ('region', re.compile(r'регион|город|област', re.I)),
        ('sum', re.compile(r'сумм.*(т?кп|сч[её]т|предложен)', re.I)),
        ('goods', re.compile(r'товар|продукц|модел', re.I)),
        ('match', re.compile(r'оборудован|тема|направлен|отдел|категор|вид техн|тип продук', re.I)),
        ('client', re.compile(r'тип компан|компани|клиент|отрасл|сегмент', re.I)),
    )
    LISTS = frozenset({'enumeration', 'crm_status'})
    TEXTS = frozenset({'string'})
    NUMBERS = frozenset({'double', 'integer', 'money'})

    @classmethod
    def of(cls, row: dict) -> str:
        label = str(row.get('label') or row.get('title') or '')
        if cls.SKIP.search(label):
            return ''
        return next((kind for kind, pattern in cls.RULES if pattern.search(label)), 'learn')


class DealHistory:
    """Как менеджеры заполняли поля раньше: значения по категориям оборудования и по клиенту, частота значений."""

    STRONG_SHARE = 0.7
    STRONG_COUNT = 3

    def __init__(self, store) -> None:
        self.store = store
        self._rows: list[dict] | None = None

    def rows(self) -> list[dict]:
        if self._rows is None:
            self._rows = [
                dict(
                    _obj(doc), id=did, clientInn=inn or '', managerId=mid or '', stage=stage or '', funnel=funnel or ''
                )
                for did, doc, inn, mid, stage, funnel in self.store.all(
                    'SELECT id, doc, inn, manager_id, stage, funnel FROM deals', ()
                )
            ]
        return self._rows

    def popular(self, code: str) -> Counter:
        counts: Counter = Counter()
        for deal in self.rows():
            counts.update(self._values((deal.get('uf') or {}).get(code)))
        return counts

    def by_cat(self, code: str, cat: str, skip: str) -> str:
        """Значение, которое почти всегда ставили сделкам с оборудованием этой категории (не своё автозаполнение)."""
        counts: Counter = Counter()
        for deal in self.rows():
            if deal['id'] == skip or cat not in (deal.get('kpCats') or []) or self._auto(deal, code):
                continue
            counts.update(self._values((deal.get('uf') or {}).get(code)))
        return self._strong(counts, self.STRONG_COUNT)

    def by_where(self, code: str, test: Callable[[dict], bool], skip: str) -> str:
        """Значение, которое почти всегда ставили сделкам, подходящим под условие (не своё автозаполнение)."""
        counts: Counter = Counter()
        for deal in self.rows():
            if deal['id'] == skip or self._auto(deal, code) or not test(deal):
                continue
            counts.update(self._values((deal.get('uf') or {}).get(code)))
        return self._strong(counts, self.STRONG_COUNT)

    def by_client(self, code: str, inn: str, skip: str) -> str:
        """Значение прежних сделок того же клиента (по ИНН), если они согласны между собой."""
        if not inn:
            return ''
        counts: Counter = Counter()
        for deal in self.rows():
            if deal['id'] != skip and deal.get('clientInn') == inn:
                counts.update(self._values((deal.get('uf') or {}).get(code)))
        return self._strong(counts, 1)

    @staticmethod
    def _auto(deal: dict, code: str) -> bool:
        auto = deal.get('ufAuto') or {}
        return code in auto and auto[code] == (deal.get('uf') or {}).get(code)

    @staticmethod
    def _values(value: Any) -> list[str]:
        values = value if isinstance(value, list) else [value]
        return [str(one) for one in values if one not in (None, '', '0')]

    @classmethod
    def _strong(cls, counts: Counter, least: int) -> str:
        total = sum(counts.values())
        if not total:
            return ''
        value, count = counts.most_common(1)[0]
        return value if count >= least and count / total >= cls.STRONG_SHARE else ''


class ListMatch:
    """Значение списка Битрикса по словам КП: больше совпавших слов значения, затем — чаще выбирали раньше."""

    MIN_SHARE = 0.5
    MANY = 3

    def __init__(self, items: list[dict], popular: Counter) -> None:
        self.items = [item for item in items if str(item.get('value') or '').strip()]
        self.popular = popular

    def best(self, stems: set[str]) -> str:
        scored = []
        for item in self.items:
            mine = Words.stems(item['value'])
            hits = len(mine & stems)
            if mine and hits and hits / len(mine) >= self.MIN_SHARE:
                scored.append((hits / len(mine), hits, self.popular[str(item['id'])], str(item['id'])))
        if not scored:
            return ''
        scored.sort(reverse=True)
        top = scored[0]
        tied = [row for row in scored if row[:3] == top[:3]]
        return top[3] if len(tied) == 1 else ''

    def exact(self, names: list[str]) -> list[str]:
        """Значения, совпавшие с названиями (бренды): «Atlas Copco» = «ATLAS COPCO»."""
        keys = {Words.key(name): name for name in names if Words.key(name)}
        found = [str(item['id']) for item in self.items if Words.key(item['value']) in keys]
        return list(dict.fromkeys(found))

    def place(self, address: str) -> str:
        """Регион или город по адресу клиента: все слова значения — в адресе."""
        words = Words.plain(address)
        scored = []
        for item in self.items:
            mine = Words.plain(item['value'])
            if mine and mine <= words:
                scored.append((len(mine), self.popular[str(item['id'])], str(item['id'])))
        if not scored:
            return ''
        scored.sort(reverse=True)
        return scored[0][2] if len(scored) == 1 or scored[0][:2] != scored[1][:2] else ''


class ContextFill:
    """Поля, которые не следуют из КП, но известны по самой сделке: вероятность успеха — как обычно ставили на этой
    стадии, руководитель ответственного — как у прежних сделок того же менеджера, реклама — как при том же источнике,
    «Источник (дополнительно)» — как у прежних сделок клиента, дата рабочего комментария — по последней правке заметки,
    рабочего комментария или по комментарию в ленте. Нет уверенного ответа — поле остаётся пустым."""

    RULES = (
        ('chance', re.compile(r'вероятн', re.I)),
        ('noteDay', re.compile(r'дата.*коммент', re.I)),
        ('chief', re.compile(r'руководител', re.I)),
        ('ads', re.compile(r'реклам', re.I)),
        ('sourceMore', re.compile(r'источник.*дополн', re.I)),
    )
    SOURCE = re.compile(r'источник', re.I)
    COMMENT = re.compile(r'коммент', re.I)
    MORE = re.compile(r'дополн|дата', re.I)
    LISTS = frozenset({'enumeration', 'crm_status', 'iblock_element', 'employee'})

    def __init__(self, history: DealHistory, deal: dict, fields: list[dict]) -> None:
        self.history, self.deal, self.fields = history, deal, fields

    @classmethod
    def kind(cls, row: dict) -> str:
        label = str(row.get('label') or row.get('title') or '')
        return next((kind for kind, pattern in cls.RULES if pattern.search(label)), '')

    def value(self, row: dict) -> Any:
        kind = self.kind(row)
        rules = {
            'chance': self._chance,
            'noteDay': self._note_day,
            'chief': self._chief,
            'ads': self._ads,
            'sourceMore': self._source_more,
        }
        return rules[kind](row) if kind in rules else None

    def _learned(self, row: dict, test: Callable[[dict], bool]) -> Any:
        if row.get('type') not in self.LISTS:
            return None
        found = self.history.by_where(row['code'], test, self.deal.get('id', ''))
        return ([found] if row.get('multiple') else found) if found else None

    def _chance(self, row: dict) -> Any:
        stage, funnel = self.deal.get('fstage') or self.deal.get('stage'), self.deal.get('funnel')
        return self._learned(
            row, lambda other: (other.get('fstage') or other.get('stage')) == stage and other.get('funnel') == funnel
        )

    def _chief(self, row: dict) -> Any:
        mid = self.deal.get('managerId')
        return self._learned(row, lambda other: bool(mid) and other.get('managerId') == mid) if mid else None

    def _ads(self, row: dict) -> Any:
        source = next(
            (
                one['code']
                for one in self.fields
                if self.SOURCE.search(str(one.get('label') or '')) and not self.MORE.search(str(one.get('label') or ''))
            ),
            '',
        )
        value = (self.deal.get('uf') or {}).get(source) if source else None
        if value in (None, '', []):
            return None
        return self._learned(row, lambda other: (other.get('uf') or {}).get(source) == value)

    def _source_more(self, row: dict) -> Any:
        inn = re.sub(r'\D', '', str(self.deal.get('clientInn') or ''))
        return self.history.by_client(row['code'], inn, self.deal.get('id', '')) or None

    def _note_day(self, row: dict) -> Any:
        codes = {
            one['code']
            for one in self.fields
            if self.COMMENT.search(str(one.get('label') or '')) and not self.MORE.search(str(one.get('label') or ''))
        }
        days = [str(one.get('at') or '') for one in self.deal.get('comments') or [] if isinstance(one, dict)]
        for entry in self.deal.get('history') or []:
            fields = set(entry.get('fields') or []) if isinstance(entry, dict) else set()
            if 'note' in fields or fields & codes:
                days.append(str(entry.get('at') or ''))
        day = max((one[:10] for one in days if one), default='')
        if not day:
            return None
        return day if row.get('type') in ('date', 'datetime') else '.'.join(reversed(day.split('-')))


class DealAutoFill:
    """Пустые поля Битрикс24 сделки — из КП (позиции, производители, категории, сумма), клиента и прошлых сделок.

    Заполненное программой помнится в `ufAuto`: менеджер изменил или стёр значение — больше не трогается; не менял — может
    обновиться по новому КП.
    """

    INN_COMPANY = 10
    INN_PERSON = 12
    GOODS_MAX = 255
    GOODS_SHOWN = 3
    KOPECKS = 100
    FIRST = frozenset({'brand', 'goods', 'match'})

    def __init__(self, store) -> None:
        self.store = store
        self.history = DealHistory(store)
        self._types: dict[str, dict] | None = None

    def apply(self, deal: dict, kp_ids: list[str]) -> list[str]:
        """Дополнить deal['uf'] (на месте). → коды полей, которые заполнены или обновлены."""
        facts = self.facts(deal, kp_ids)
        deal['kpCats'] = sorted(set(facts.cats))
        values = dict(deal.get('uf') or {})
        auto = dict(deal.get('ufAuto') or {})
        changed = []
        regs = {code: key for key, code in DealRegs(self.store).codes().items()}
        reg_fill = RegFill(self, deal, kp_ids, facts)
        shown = DealFields(self.store).shown(deal.get('funnel') or Funnels.MAIN)
        context = ContextFill(self.history, deal, shown)
        for row in shown:
            code = row['code']
            if code in auto and values.get(code) != auto[code]:
                continue  # менеджер изменил или стёр — его выбор
            if code not in auto and values.get(code) not in (None, '', [], '0'):
                continue
            key = regs.get(code, '')
            if code in auto and self._stale(row, key):
                values.pop(
                    code, None
                )  # прежняя версия заполняла это поле ошибочно (например, «Описание работ» товаром)
                auto.pop(code, None)
                changed.append(code)
                continue
            if ContextFill.kind(row) and key not in RegFill.KINDS:
                value = context.value(row)
            elif not kp_ids and key not in RegFill.KINDS:
                continue  # без КП — только то, что известно о самой сделке (источник, сумма)
            else:
                value = reg_fill.value(key, row) if key in RegFill.KINDS else self.value(row, facts, deal)
            if value in (None, '', []) or value == values.get(code):
                continue
            values[code] = auto[code] = value
            changed.append(code)
        if changed:
            deal.update(uf=values, ufAuto=auto)
        return changed

    @staticmethod
    def _stale(row: dict, key: str) -> bool:
        """Поле, которое программа больше не заполняет ни одним правилом."""
        return key not in RegFill.KINDS and not ContextFill.kind(row) and not FieldKind.of(row)

    def facts(self, deal: dict, kp_ids: list[str]) -> KpFacts:
        facts = KpFacts(inn=re.sub(r'\D', '', str(deal.get('clientInn') or '')), sum_rub=self._rub(deal))
        for kid in kp_ids:
            for item in self._items(kid):
                self._add(facts, item)
        client = self._client(deal)
        facts.address = str(client.get('address') or '')
        facts.inn = facts.inn or re.sub(r'\D', '', str(client.get('inn') or ''))
        return facts

    def value(self, row: dict, facts: KpFacts, deal: dict) -> Any:
        kind = FieldKind.of(row)
        if not kind:
            return None
        if row.get('type') in FieldKind.LISTS:
            return self._list(kind, row, facts, deal)
        if row.get('type') in FieldKind.TEXTS:
            return self._text(kind, facts)
        if row.get('type') in FieldKind.NUMBERS and kind == 'sum' and facts.sum_rub:
            return f'{facts.sum_rub}|RUB' if row.get('type') == 'money' else str(facts.sum_rub)
        return None

    def _list(self, kind: str, row: dict, facts: KpFacts, deal: dict) -> Any:
        code = row['code']
        match = ListMatch(row.get('items') or [], self.history.popular(code))
        rules = {
            'brand': lambda: match.exact(facts.makers),
            'form': lambda: self._form(match, facts.inn),
            'region': lambda: self.history.by_client(code, facts.inn, deal.get('id', '')) or match.place(facts.address),
            'client': lambda: self.history.by_client(code, facts.inn, deal.get('id', '')),
            'goods': lambda: self._by_cats(code, match, facts, deal),
            'match': lambda: self._by_cats(code, match, facts, deal),
            'learn': lambda: [self.history.by_cat(code, cat, deal.get('id', '')) for cat in facts.cats],
        }
        found = rules[kind]() if kind in rules else ''
        values = [one for one in (found if isinstance(found, list) else [found]) if one]
        values = list(dict.fromkeys(values))
        if row.get('multiple'):
            return values[: ListMatch.MANY]
        first = kind in self.FIRST  # главная позиция КП — первая: её бренд и вид оборудования
        return values[0] if len(values) == 1 or (values and first) else None

    def _by_cats(self, code: str, match: ListMatch, facts: KpFacts, deal: dict) -> list[str]:
        """По каждой категории оборудования КП: как ставили раньше, иначе — по словам позиций."""
        out = []
        for cat in facts.cats or ['']:
            learned = self.history.by_cat(code, cat, deal.get('id', '')) if cat else ''
            out.append(learned or match.best(facts.texts.get(cat) or facts.stems()))
        return [one for one in out if one]

    @classmethod
    def _form(cls, match: ListMatch, inn: str) -> str:
        want = {cls.INN_COMPANY: re.compile(r'юр', re.I), cls.INN_PERSON: re.compile(r'\bип\b|индивид', re.I)}.get(
            len(inn)
        )
        if not want:
            return ''
        found = [str(item['id']) for item in match.items if want.search(str(item['value']))]
        return found[0] if len(found) == 1 else ''

    def _text(self, kind: str, facts: KpFacts) -> str:
        texts = {
            'goods': '; '.join(facts.names[: self.GOODS_SHOWN]),
            'brand': ', '.join(dict.fromkeys(facts.makers)),
        }
        return texts.get(kind, '')[: self.GOODS_MAX]

    def _rub(self, deal: dict) -> int:
        try:
            return round(float(deal.get('sum') or 0) / self.KOPECKS)
        except (TypeError, ValueError):
            return 0

    def _items(self, kid: str) -> list[dict]:
        state = _obj(self.store.kp_get(kid, 'state'))
        items = state.get('items')
        return (
            [item for item in items if isinstance(item, dict) and item.get('name')] if isinstance(items, list) else []
        )

    def _add(self, facts: KpFacts, item: dict) -> None:
        attrs = _obj(item.get('attrs'))
        if not attrs.get('cat') and item.get('catId'):
            attrs = dict(_obj(_obj(self.store.catalog_get(str(item['catId']))).get('attrs')), **attrs)
        cat = str(attrs.get('cat') or '')
        maker = str(attrs.get('maker') or '').strip()
        name = str(item.get('short') or item.get('name') or '').strip()
        facts.names.append(name)
        if maker:
            facts.makers.append(maker)
        if cat:
            facts.cats.append(cat)
        kind = self._type(cat)
        text = ' '.join(
            [name, maker, str(kind.get('name') or ''), str(kind.get('item') or ''), str(kind.get('group') or '')]
        )
        facts.texts.setdefault(cat, set()).update(Words.stems(text))

    def _type(self, cat: str) -> dict:
        if self._types is None:
            own = (self.store.kv_get('types') or {}).get('types') or []
            rows = [*load_types_builtin(), *own]
            self._types = {str(row.get('id')): row for row in rows if isinstance(row, dict) and row.get('id')}
        return self._types.get(cat) or {}

    def _client(self, deal: dict) -> dict:
        cid = deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')
        found = self.store.client_get(cid) if cid else None
        return found if isinstance(found, dict) else {}


class RegFill:
    """Поля регламента не по словам КП: источник заявки, запрошенное (первое КП сделки), деньги из экономики сделки,
    условия оплаты по графику платежей, первый платёж и маржа — по отметкам оплат в «Исполнении»."""

    KINDS = frozenset(
        {
            'source',
            'askBrand',
            'askGoods',
            'expect',
            'margin',
            'contract',
            'pay',
            'pay1Date',
            'pay1',
            'pay1Margin',
            'marginFact',
            'address',
        }
    )
    SOURCES = {'ad': r'реклам', 'repeat': r'повтор', 'own': r'личн'}
    PREPAID = re.compile(r'предоплат|аванс', re.I)
    POSTPAID = re.compile(r'постоплат|отсрочк|по факту|после', re.I)
    PERCENT = 100
    DAY_LEN = 10
    TEXT_MAX = 255

    def __init__(self, filler: 'DealAutoFill', deal: dict, kp_ids: list[str], facts: KpFacts) -> None:
        self.filler = filler
        self.deal = deal
        self.kp_ids = kp_ids
        self.facts = facts
        self._first: KpFacts | None = None
        self.meta = _obj(filler.store.kp_get(kp_ids[0], 'meta')) if kp_ids else {}
        self._paid: list[dict] | None = None

    def value(self, key: str, row: dict) -> Any:
        getters = {
            'source': self._source,
            'askBrand': self._ask_brand,
            'askGoods': self._ask_goods,
            'expect': lambda _row: self.facts.sum_rub,
            'contract': lambda _row: self.facts.sum_rub,
            'margin': lambda _row: self._profit(),
            'pay': self._pay,
            'pay1Date': lambda _row: self._first_paid().get('fact', '')[: self.DAY_LEN],
            'pay1': lambda _row: self._first_paid().get('amount') or 0,
            'pay1Margin': lambda _row: self._share(self._first_paid().get('amount') or 0),
            'marginFact': lambda _row: self._margin_fact(),
            'address': lambda _row: self.facts.address,
        }
        return self._typed(row, getters[key](row))

    def _typed(self, row: dict, raw: Any) -> Any:
        if raw in (None, '', [], 0):
            return None
        kind = row.get('type')
        if kind in FieldKind.LISTS:
            values = raw if isinstance(raw, list) else [raw]
            return values[: ListMatch.MANY] if row.get('multiple') else values[0]
        if kind == 'money':
            return f'{round(raw)}|RUB' if isinstance(raw, (int, float)) else None
        if kind in ('double', 'integer'):
            return str(round(raw)) if isinstance(raw, (int, float)) else None
        if kind in ('date', 'datetime'):
            return str(raw)[: self.DAY_LEN] if re.match(r'^\d{4}-\d{2}-\d{2}', str(raw)) else None
        if kind in FieldKind.TEXTS:
            return self._money_text(raw) if isinstance(raw, (int, float)) else str(raw)[: self.TEXT_MAX]
        return None

    @staticmethod
    def _money_text(rub: float) -> str:
        return f'{rub:,.0f}'.replace(',', ' ')

    def first(self) -> KpFacts:
        """Что было в первом КП сделки — то, что клиент запрашивал."""
        if self._first is None:
            self._first = self.filler.facts(self.deal, self.kp_ids[-1:]) if len(self.kp_ids) > 1 else self.facts
        return self._first

    def _source(self, row: dict) -> Any:
        pattern = self.SOURCES.get(str(self.deal.get('source') or ''))
        if not pattern:
            return None
        if row.get('type') not in FieldKind.LISTS:
            return {'ad': 'Рекламная заявка', 'repeat': 'Повторная заявка', 'own': 'Личная заявка'}[self.deal['source']]
        found = [str(item['id']) for item in row.get('items') or [] if re.search(pattern, str(item.get('value')), re.I)]
        return found[0] if len(found) == 1 else None

    def _ask_brand(self, row: dict) -> Any:
        makers = self.first().makers
        if row.get('type') in FieldKind.LISTS:
            return ListMatch(row.get('items') or [], Counter()).exact(makers)
        return ', '.join(dict.fromkeys(makers))

    def _ask_goods(self, row: dict) -> Any:
        first = self.first()
        if row.get('type') in FieldKind.LISTS:
            return ListMatch(row.get('items') or [], Counter()).best(first.stems())
        return '; '.join(first.names[: DealAutoFill.GOODS_SHOWN])

    def _econ(self) -> dict:
        return _obj(self.meta.get('deal'))

    def _profit(self) -> float:
        econ = self._econ()
        value = econ.get('profit') if econ.get('confirmed') else econ.get('lo')
        return float(value) if isinstance(value, (int, float)) else 0

    def _price(self) -> float:
        full = _obj(self._econ().get('full'))
        price = full.get('price') or full.get('revenue')
        return float(price) if isinstance(price, (int, float)) and price else float(self.facts.sum_rub)

    def _share(self, amount: float) -> float:
        """Маржа с платежа — доля прибыли сделки в сумме платежа."""
        price = self._price()
        return amount * self._profit() / price if price else 0

    def _pays(self) -> list[dict]:
        plan = _obj(self.meta.get('plan'))
        rows = picked if isinstance(picked := plan.get('pays'), list) else []
        return [row for row in rows if isinstance(row, dict) and isinstance(row.get('d'), int)]

    def _prepaid(self) -> float | None:
        """Сколько процентов заказчик платит до поставки (в день договора и раньше)."""
        pays = self._pays()
        if not pays:
            return None
        return sum(float(row.get('p') or 0) for row in pays if row['d'] <= 0)

    def _pay(self, row: dict) -> Any:
        pays = self._pays()
        if not pays:
            return None
        if row.get('type') not in FieldKind.LISTS:
            return '; '.join(str(one.get('t') or '') for one in pays if one.get('t'))
        prepaid = self._prepaid() or 0
        found = [str(item['id']) for item in row.get('items') or [] if self._pay_fits(str(item.get('value')), prepaid)]
        return found[0] if len(found) == 1 else None

    def _pay_fits(self, text: str, prepaid: float) -> bool:
        numbers = {int(one) for one in re.findall(r'\d+', text)}
        if prepaid >= self.PERCENT:
            return bool(self.PREPAID.search(text)) and (not numbers or self.PERCENT in numbers)
        if prepaid <= 0:
            return bool(self.POSTPAID.search(text)) and not self.PREPAID.search(text)
        return round(prepaid) in numbers

    def _customer(self) -> list[dict]:
        """Оплаты заказчика по исполнению сделки (с отметкой «оплачено» — fact)."""
        if self._paid is None:
            from crm import DealBook
            from crm_exec import ExecPlan, Sums

            did = self.deal.get('id') or ''
            kps = DealBook(self.filler.store).kps([did])[did] if did else []
            steps = ExecPlan(dict(self.deal, kps=kps)).steps(Sums.SALES)
            self._paid = [step for step in steps if step['kind'] == 'cust']
        return self._paid

    def _first_paid(self) -> dict:
        return next((step for step in self._customer() if step['state'] == 'done'), {})

    def _margin_fact(self) -> float:
        steps = self._customer()
        if not steps or any(step['state'] != 'done' for step in steps):
            return 0
        return self._share(sum(step.get('amount') or 0 for step in steps))
