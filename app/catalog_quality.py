"""Качество карточек каталога: обязательные поля основного оборудования и поиск возможных дублей."""

import difflib
import re
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
