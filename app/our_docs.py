"""Документы из КП: «Наши реквизиты» (юрлица продавца) и свои шаблоны Word договора и спецификации."""

import os
import re
from typing import ClassVar

from kp_files import KpFiles


class OurRequisites:
    """Реквизиты своих юрлиц (несколько, одно — по умолчанию): хранятся только в базе пользователя."""

    KEY = 'ourRequisites'
    MAX = 20
    TEXT_MAX = 300
    ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
    # поле: (название для сообщения, шаблон проверки или None — любой текст)
    FIELDS: ClassVar[dict[str, tuple[str, re.Pattern | None]]] = {
        'name': ('Наименование', None),
        'inn': ('ИНН', re.compile(r'^(\d{10}|\d{12})$')),
        'kpp': ('КПП', re.compile(r'^\d{9}$')),
        'ogrn': ('ОГРН', re.compile(r'^(\d{13}|\d{15})$')),
        'address': ('Адрес', None),
        'bank': ('Банк', None),
        'bik': ('БИК', re.compile(r'^\d{9}$')),
        'account': ('Расчётный счёт', re.compile(r'^\d{20}$')),
        'corr': ('Корр. счёт', re.compile(r'^\d{20}$')),
        'phone': ('Телефон', None),
        'director': ('Руководитель (ФИО)', None),
        'directorPost': ('Должность руководителя', None),
        'accountant': ('Главный бухгалтер (ФИО)', None),
        'vat': ('НДС', re.compile(r'^(0|5|7|10|20|22|без НДС)$')),
        'usn': ('Налог на прибыль или УСН', re.compile(r'^(income|profit)$')),
        'usnRate': ('Ставка УСН', re.compile(r'^\d{1,2}([.,]\d{1,2})?$')),
    }
    # ставка УСН по закону — верхняя граница своей ставки юрлица (НК РФ, ст. 346.20); НДС 5 и 7 % — только при УСН (ст. 164, п. 8)
    USN_MAX: ClassVar[dict[str, float]] = {'income': 6.0, 'profit': 15.0}
    USN_VAT = ('5', '7')

    def __init__(self, store) -> None:
        self.store = store

    def list(self) -> dict:
        """{items: [...], main: id}."""
        own = self.store.kv_get(self.KEY) or {}
        own = own if isinstance(own, dict) else {}
        items = [x for x in (own.get('items') or []) if isinstance(x, dict)]
        main = own.get('main') if any(x.get('id') == own.get('main') for x in items) else ''
        return {'items': items, 'main': main or (items[0]['id'] if items else '')}

    def save(self, data: dict) -> dict:
        """Проверить и записать весь список; ошибка — ValueError с понятным текстом."""
        if not isinstance(data, dict) or not isinstance(data.get('items'), list):
            raise ValueError('Нужен список юрлиц')
        if len(data['items']) > self.MAX:
            raise ValueError(f'Юрлиц не больше {self.MAX}')
        items = [self._one(x, place) for place, x in enumerate(data['items'], 1)]
        ids = [x['id'] for x in items]
        if len(set(ids)) != len(ids):
            raise ValueError('Два юрлица с одним кодом')
        main = data.get('main') if data.get('main') in ids else (ids[0] if ids else '')
        self.store.kv_set(self.KEY, {'items': items, 'main': main})
        return self.list()

    def _one(self, raw, place: int) -> dict:
        if not isinstance(raw, dict):
            raise ValueError(f'Юрлицо {place}: неверные данные')
        rid = str(raw.get('id') or '')
        if not self.ID_RE.match(rid):
            raise ValueError(f'Юрлицо {place}: неверный код')
        out = {'id': rid}
        for key, (label, pattern) in self.FIELDS.items():
            value = re.sub(r'\s+', ' ', str(raw.get(key) or '')).strip()[: self.TEXT_MAX]
            if value and pattern and not pattern.match(value.replace(' ', '') if key != 'vat' else value):
                raise ValueError(f'Юрлицо {place}: поле «{label}» заполнено неверно')
            out[key] = value.replace(' ', '') if value and pattern and key != 'vat' else value
        if not out['name']:
            raise ValueError(f'Юрлицо {place}: укажите наименование')
        self._usn(out, place)
        return out

    def _usn(self, out: dict, place: int) -> None:
        mode = out['usn']
        if not mode:
            out['usnRate'] = ''
            if out['vat'] in self.USN_VAT:
                raise ValueError(
                    f'Юрлицо {place}: НДС {out["vat"]} % — только при УСН: выберите «Налог на прибыль или УСН»'
                )
            return
        rate = out['usnRate'].replace(',', '.')
        if rate and float(rate) > self.USN_MAX[mode]:
            raise ValueError(f'Юрлицо {place}: ставка УСН — не больше {self.USN_MAX[mode]:g} %')


class DocTemplates:
    """Свои шаблоны Word (договор, спецификация) с метками {метка}: папка doc_templates рядом с базой."""

    FOLDER = 'doc_templates'
    KINDS: ClassVar[dict[str, str]] = {'contract': 'договора', 'spec': 'спецификации'}
    SIZE_MAX = 10 * 1024 * 1024

    def __init__(self, store) -> None:
        self.root = os.path.join(os.path.dirname(os.path.abspath(store.path)), self.FOLDER)

    def _path(self, kind: str) -> str:
        if kind not in self.KINDS:
            raise ValueError('Неизвестный вид документа')
        return os.path.join(self.root, f'{kind}.docx')

    def info(self) -> dict:
        """{вид: есть ли свой шаблон}."""
        return {kind: os.path.isfile(self._path(kind)) for kind in self.KINDS}

    def read(self, kind: str) -> bytes | None:
        path = self._path(kind)
        if not os.path.isfile(path):
            return None
        with open(path, 'rb') as file:
            return file.read()

    def put(self, kind: str, data: bytes) -> None:
        """Записать шаблон: только .docx, проверка содержимого как у документов КП."""
        path = self._path(kind)
        if not data or len(data) > self.SIZE_MAX:
            raise ValueError('Шаблон — файл Word .docx до 10 МБ')
        KpFiles.check_content(f'Шаблон {self.KINDS[kind]}', '.docx', data)
        os.makedirs(self.root, exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'wb') as file:
            file.write(data)
        os.replace(tmp, path)

    def remove(self, kind: str) -> None:
        path = self._path(kind)
        if os.path.isfile(path):
            os.remove(path)
