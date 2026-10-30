"""Качество карточек каталога: обязательные поля основного оборудования, поиск возможных дублей и цены «из КП»,
подтверждённые последним КП сотрудника."""

import difflib
import json
import re
from collections.abc import Iterator
from typing import Any


class CardRules:
    """Обязательное у основного оборудования: категория, производитель, модель, своё главное фото, ключевые характеристики категории.

    Основное — карточка с категорией роли «equipment» (или без категории); опции (`kind: option`), станции-сборки (`kit`)
    и категории роли «accessory» (запчасти, шкафы АВР) — без требований.
    """

    MAIN_ROLE = 'equipment'
    OPTION_KIND = 'option'
    BASE = (('cat', 'категория'), ('maker', 'производитель'), ('model', 'модель'))
    PHOTO = 'главное фото'

    def __init__(self, types: list[dict]) -> None:
        self._types = {str(kind.get('id')): kind for kind in types if isinstance(kind, dict)}

    def _attrs(self, doc: dict) -> dict:
        attrs = doc.get('attrs')
        return attrs if isinstance(attrs, dict) else {}

    def is_main(self, doc: dict) -> bool:
        """Карточка основного оборудования (к ней есть требования)."""
        if doc.get('kind') == self.OPTION_KIND or doc.get('kit'):
            return False
        kind = self._types.get(str(self._attrs(doc).get('cat') or ''))
        return kind is None or kind.get('role', self.MAIN_ROLE) == self.MAIN_ROLE

    def _needed(self, doc: dict) -> list[tuple[str, str]]:
        kind = self._types.get(str(self._attrs(doc).get('cat') or '')) or {}
        keys = [
            (field['key'], str(field.get('label') or field['key']).lower())
            for field in kind.get('fields') or []
            if isinstance(field, dict) and field.get('kpi') and field.get('key')
        ]
        return [*self.BASE, *keys]

    @staticmethod
    def _filled(value: Any) -> bool:
        return value not in (None, '') and not (isinstance(value, str) and not value.strip())

    def _has_photo(self, doc: dict) -> bool:
        photo = doc.get('photo')
        return isinstance(photo, dict) and bool(photo.get('src')) and not doc.get('photoFrom')

    def missing(self, doc: dict) -> list[str]:
        """Что не заполнено (подписи для пользователя); пусто — карточка в порядке или не основное оборудование."""
        if not self.is_main(doc):
            return []
        attrs = self._attrs(doc)
        out = [label for key, label in self._needed(doc) if not self._filled(attrs.get(key))]
        if not self._has_photo(doc):
            out.append(self.PHOTO)
        return out

    def check(self, before: dict | None, after: dict) -> list[str]:
        """Что мешает сохранить: новая карточка — всё обязательное; правка прежней (и перенос в другую категорию) — не опустошать заполненное."""
        if before is None:
            return self.missing(after)
        if not self.is_main(after):
            return []
        was, now = self._attrs(before), self._attrs(after)
        out = [
            label for key, label in self._needed(after) if self._filled(was.get(key)) and not self._filled(now.get(key))
        ]
        if self._has_photo(before) and not self._has_photo(after):
            out.append(self.PHOTO)
        return out

    @staticmethod
    def text(labels: list[str]) -> str:
        """Сообщение пользователю."""
        return 'Заполните обязательное для основного оборудования: ' + ', '.join(labels)


class DupFinder:
    """Возможные дубли: та же модель (без пробелов, дефисов и регистра) у того же производителя или почти то же название."""

    NAME_RATIO = 0.92
    MODEL_MIN = 3
    LIMIT = 5
    _JUNK = re.compile(r'[\W_]+', re.UNICODE)

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def norm(cls, text: Any) -> str:
        """Строка для сравнения: строчные, ё → е, только буквы и цифры."""
        return cls._JUNK.sub('', str(text or '').lower().replace('ё', 'е'))

    @classmethod
    def _words(cls, text: Any) -> str:
        return ' '.join(sorted(word for word in (cls.norm(part) for part in str(text or '').split()) if word))

    def _rows(self) -> list:
        return self.store.all("SELECT id, name, maker, json_extract(doc, '$.attrs.model') FROM catalog", ())

    def _same_model(self, model: str, maker: str, row: tuple) -> bool:
        other = self.norm(row[3])
        if len(model) < self.MODEL_MIN or other != model:
            return False
        their = self.norm(row[2])
        return not maker or not their or their == maker

    def _same_name(self, name: str, words: str, row: tuple) -> bool:
        if not name:
            return False
        if self._words(row[1]) == words:
            return True
        match = difflib.SequenceMatcher(None, name, self.norm(row[1]))
        return (
            match.real_quick_ratio() >= self.NAME_RATIO
            and match.quick_ratio() >= self.NAME_RATIO
            and (match.ratio() >= self.NAME_RATIO)
        )

    def _why(self, row: tuple, model: str, maker: str, name: str, words: str) -> str:
        if self._same_model(model, maker, row):
            return 'та же модель'
        if self._same_name(name, words, row):
            return 'похожее название'
        return ''

    def find(self, doc: dict, cid: str) -> list[dict]:
        """Похожие позиции каталога (кроме самой cid): [{id, name, why}]."""
        attrs = picked if isinstance(picked := doc.get('attrs'), dict) else {}
        model, maker = self.norm(attrs.get('model')), self.norm(attrs.get('maker'))
        name, words = self.norm(doc.get('name')), self._words(doc.get('name'))
        out = []
        for row in self._rows():
            if row[0] == cid:
                continue
            why = self._why(row, model, maker, name, words)
            if why:
                out.append({'id': row[0], 'name': row[1] or row[0], 'why': why})
                if len(out) >= self.LIMIT:
                    break
        return out

    @staticmethod
    def changed(before: dict | None, after: dict) -> bool:
        """Новая карточка или сменились название, модель, производитель — искать дубли."""
        return before is None or DupFinder._key(before) != DupFinder._key(after)

    @staticmethod
    def _key(doc: dict) -> tuple:
        attrs = picked if isinstance(picked := doc.get('attrs'), dict) else {}
        return doc.get('name'), attrs.get('model'), attrs.get('maker')


class KpPriceProof:
    """Цены позиции каталога, присланные сохранением КП (аудит 30.10, п. 27): без права «Правка каталога» и мимо модерации
    принимаются, только если их подтверждает последнее КП, сохранённое этим сотрудником, — позиция (цена, валюта КП,
    закупка, наценка) или её опция (цена) с тем же кодом каталога или названием; история цен — прежняя плюс запись этого КП.
    Расчёт полей — как у сохранения КП в интерфейсе (`CatalogSync._money`, `_history`)."""

    FIELDS = ('price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode')
    NUMBERS = frozenset({'price', 'cost'})
    HISTORY = 'prices'
    DEFAULT_CUR = 'RUB'
    EPS = 0.005
    LAST = 'SELECT number, state FROM kp WHERE updated_by=? AND state IS NOT NULL ORDER BY updated DESC LIMIT 1'

    def __init__(self, store) -> None:
        self.store = store

    def holds(self, saver: str, cid: str, before: dict, after: dict) -> bool:
        """Изменённое в ценах позиции cid подтверждает последнее КП, которое сохранил saver (подпись сохранения КП)."""
        last = self._last(saver)
        if last is None:
            return False
        number, state = last
        changed = [key for key in self.FIELDS if self._value(after.get(key)) != self._value(before.get(key))]
        return any(
            self._same(row, cid, after)
            and self._fits(want, changed, after)
            and self._history(before, after, number, want)
            for row, want in self._candidates(state, before)
        )

    def _last(self, saver: str) -> tuple[str, dict] | None:
        found = self.store.one(self.LAST, (saver,)) if saver else None
        state = self._obj(found[1]) if found else {}
        if not found or not state:
            return None
        return str(state.get('number') or found[0] or ''), state

    def _candidates(self, state: dict, before: dict) -> Iterator[tuple[dict, dict]]:
        """(строка КП, какими по ней станут поля цены): у опции меняется только цена."""
        pricing = state.get('pricing')
        cur = str((pricing if isinstance(pricing, dict) else {}).get('cur') or self.DEFAULT_CUR)
        kept = {key: before.get(key) for key in self.FIELDS}
        for item in self._list(state.get('items')):
            yield item, self._item_values(item, before, cur)
            for option in self._list(item.get('options')):
                yield option, dict(kept, price=option.get('price'))

    @classmethod
    def _item_values(cls, item: dict, before: dict, cur: str) -> dict:
        own_cost = cls._truthy(item.get('cost'))
        return {
            'price': item.get('price'),
            'priceCur': cur,
            'cost': item.get('cost') if own_cost else before.get('cost') or 0,
            'costCur': (item.get('costCur') or cls.DEFAULT_CUR)
            if own_cost
            else before.get('costCur') or cls.DEFAULT_CUR,
            'margin': item.get('margin') if item.get('margin') is not None else before.get('margin'),
            'mmode': item.get('mmode') or before.get('mmode'),
        }

    @staticmethod
    def _same(row: dict, cid: str, after: dict) -> bool:
        if str(row.get('catId') or '') == cid:
            return True
        name = DupFinder.norm(row.get('name'))
        return bool(name) and name == DupFinder.norm(after.get('name'))

    def _fits(self, want: dict, changed: list[str], after: dict) -> bool:
        return all(self._equal(key, after.get(key), want.get(key)) for key in changed)

    def _equal(self, key: str, got: Any, want: Any) -> bool:
        if key not in self.NUMBERS:
            return self._value(got) == self._value(want)
        first, second = self._num(got), self._num(want)
        return first is not None and second is not None and abs(first - second) < self.EPS

    def _history(self, before: dict, after: dict, number: str, want: dict) -> bool:
        """История цен: прежние записи (без записи этого КП) и первой — запись этого КП с его ценой."""
        new = after.get(self.HISTORY)
        if new == before.get(self.HISTORY):
            return True
        if not isinstance(new, list) or not new or not isinstance(new[0], dict):
            return False
        head = new[0]
        old = [entry for entry in self._list(before.get(self.HISTORY)) if str(entry.get('number') or '') != number]
        return (
            bool(number)
            and str(head.get('number') or '') == number
            and self._equal('price', head.get('price'), want.get('price'))
            and new[1:] == old[: len(new) - 1]
        )

    @staticmethod
    def _value(value: Any) -> Any:
        """Пустое и отсутствующее поле — одно и то же (как в сравнении правок каталога)."""
        return None if value in (None, '', [], {}) else value

    @staticmethod
    def _truthy(value: Any) -> bool:
        """Как в интерфейсе: пусто, 0 и «» — нет значения."""
        return value not in (None, '', 0, False)

    @staticmethod
    def _num(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _list(value: Any) -> list[dict]:
        return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []

    @staticmethod
    def _obj(raw: Any) -> dict:
        try:
            found = json.loads(raw or '{}')
        except (TypeError, ValueError):
            return {}
        return found if isinstance(found, dict) else {}
