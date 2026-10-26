"""Фото похожей модели у позиций фида без своего фото: та же категория и производитель, ближайшая по серии, исполнению
и главному параметру; помечается photoFrom (не считается своим фото карточки)."""

import json
import math
import re

import catalog_migrate
from features import FeatureAccess
from storage import Conflict


class FeedPhotoFrom:
    SERIES_WEIGHT = 3
    WORDS = re.compile(r'[а-яёa-z]{3,}', re.I)
    SERIES = re.compile(r'\b([A-Z]{2,})[\s-]*\d')
    SIZE = re.compile(r'\d+(?:[.,]\d+)?')

    def __init__(self, store, types: list) -> None:
        self.store = store
        self.tmap = {tdef.get('id'): tdef for tdef in types or []}

    def fill(self, docs: list, author: str) -> int:
        """Позициям фида без фото — фото похожей модели. → сколько подставлено."""
        bare = [doc for doc in docs if not self._own(doc.get('photo'))]
        if not bare or not FeatureAccess(self.store).is_on('feedPhotoFrom'):
            return 0
        pool = self._donors()
        revs = self.store.catalog_revs()
        count = 0
        for doc in bare:
            attrs = doc.get('attrs') or {}
            cands = pool.get((attrs.get('cat'), attrs.get('maker')), [])
            donor = self._pick(doc, cands)
            if not donor:
                continue
            doc['photo'] = dict(donor['photo'])
            doc['photoFrom'] = {'id': donor['id'], 'name': donor.get('name', '')}
            try:
                self.store.catalog_put(doc['id'], json.dumps(doc, ensure_ascii=False), author, revs.get(doc['id']))
            except Conflict:
                continue
            count += 1
        return count

    def _pick(self, doc: dict, cands: list) -> dict | None:
        """Ближайшая позиция: общие слова названия (исполнение, вид), та же серия, ближе типоразмер и главный параметр."""
        tdef = self.tmap.get((doc.get('attrs') or {}).get('cat'))
        name = str(doc.get('name') or '')
        words, series, size = self._words(name), self._series(name), self._size(name)
        main = catalog_migrate.main_val(doc, tdef)
        best, best_score = None, -math.inf
        for cand in cands:
            other = str(cand.get('name') or '')
            score = float(len(words & self._words(other)))
            score += self.SERIES_WEIGHT if series and series == self._series(other) else 0
            score -= self._gap(size, self._size(other)) + self._gap(main, catalog_migrate.main_val(cand, tdef))
            if score > best_score:
                best, best_score = cand, score
        return best

    @classmethod
    def _words(cls, name: str) -> set:
        return {word.lower() for word in cls.WORDS.findall(name)}

    @classmethod
    def _series(cls, name: str) -> str:
        found = cls.SERIES.search(name)
        return found.group(1) if found else ''

    @classmethod
    def _size(cls, name: str) -> float | None:
        found = cls.SIZE.search(re.sub(r'^\D*?(?=[A-Z]{2,}[\s-]*\d)', '', name))
        return float(found.group(0).replace(',', '.')) if found else None

    @staticmethod
    def _gap(one: float | None, two: float | None) -> float:
        return abs(math.log((one + 1) / (two + 1))) if one and two else 0.0

    @staticmethod
    def _own(photo: object) -> bool:
        return isinstance(photo, dict) and bool(photo.get('src'))

    def _donors(self) -> dict:
        pool: dict = {}
        for (text,) in self.store.all('SELECT doc FROM catalog'):
            try:
                doc = json.loads(text)
            except ValueError:
                continue
            attrs = doc.get('attrs') or {}
            if self._own(doc.get('photo')) and not doc.get('photoFrom') and attrs.get('maker'):
                pool.setdefault((attrs.get('cat'), attrs.get('maker')), []).append(doc)
        return pool
