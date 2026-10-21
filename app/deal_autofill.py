"""Поля сделки Битрикс24 из КП: пустые поля карточки заполняются по позициям КП, клиенту и прошлым сделкам."""

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from crm_funnels import DealFields, Funnels
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
        r'запрош|источник|реклам|обращени|причин|стади|ответствен|коммент|дата|телефон|почт|e-?mail|ссылк|вероятн', re.I
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
                dict(_obj(doc), id=did, clientInn=inn or '')
                for did, doc, inn in self.store.all('SELECT id, doc, inn FROM deals', ())
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
        if not kp_ids:
            return []
        values = dict(deal.get('uf') or {})
        auto = dict(deal.get('ufAuto') or {})
        changed = []
        for row in DealFields(self.store).shown(deal.get('funnel') or Funnels.MAIN):
            code = row['code']
            if code in auto and values.get(code) != auto[code]:
                continue  # менеджер изменил или стёр — его выбор
            if code not in auto and values.get(code) not in (None, '', [], '0'):
                continue
            value = self.value(row, facts, deal)
            if value in (None, '', []) or value == values.get(code):
                continue
            values[code] = auto[code] = value
            changed.append(code)
        if changed:
            deal.update(uf=values, ufAuto=auto)
        return changed

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
