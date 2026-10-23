"""Карточка предприятия (PDF, Word, Excel, текст) → реквизиты нового клиента; ИНН и название сверяются с ФНС."""

import re
from typing import Any

from counterparty import Counterparties, valid_inn
from doc_text import DocText
from phone import Phone


class CompanyCard:
    """Распознать реквизиты правилами и создать клиента (ничего не выдумывается: не нашлось — поле пустое)."""

    TEXT_MAX = 40000
    OFFLINE = 'ФНС сейчас не ответила — ИНН проверен по контрольной сумме, название сверьте вручную'
    VALUE_MAX = 300
    PATTERNS = {
        'inn': r'ИНН(?:\s*/\s*КПП)?\D{0,12}?(\d{12}|\d{10})(?!\d)',
        'kpp': r'КПП\D{0,12}?(\d{9})(?!\d)|ИНН\s*/\s*КПП\D{0,12}?\d{10}\s*/\s*(\d{9})',
        'ogrn': r'ОГРН(?:ИП)?\D{0,12}?(\d{15}|\d{13})(?!\d)',
        'okpo': r'ОКПО\D{0,12}?(\d{8,10})(?!\d)',
        'bik': r'БИК\D{0,12}?(\d{9})(?!\d)',
        'account': r'(?:Р/?С|Расч[её]тный сч[её]т|р\.\s*сч\.?)\D{0,20}?(\d{20})(?!\d)',
        'corr': r'(?:К/?С|Корр?(?:еспондентский)?\.?\s*сч[её]т|кор\.\s*сч\.?)\D{0,20}?(\d{20})(?!\d)',
    }
    LINES = {
        'name': r'(?:Полное|Сокращ[её]нное)?\s*наименование(?: организации| предприятия)?',
        'address': r'(?:Юридический|Фактический|Почтовый)?\s*адрес',
        'bank': r'(?:Наименование\s+)?банка?|Банк получателя',
        'director': r'(?:Генеральный\s+)?директор|Руководитель',
    }
    EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
    PHONE = re.compile(r'(?<![\d+])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)')
    COMPANY = re.compile(r'\b(ООО|АО|ПАО|ЗАО|ОАО|ИП|ФГУП|МУП|ГУП)\s*[«"“]([^»"”\n]{2,120})[»"”]')
    PERSON = re.compile(r'\bИП\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})')

    def __init__(self, store) -> None:
        self.store = store

    def read(self, name: str, data: bytes) -> str:
        """Текст файла. ValueError — понятным текстом."""
        try:
            doc = DocText.extract(str(name or '')[:200], data)
        except Exception as exc:  # повреждённый или чужой файл — без трассировки
            raise ValueError(f'Файл не прочитан: {str(exc)[:200]}') from None
        text = str(doc.get('text') or '')
        if not text.strip():
            raise ValueError('В файле нет текста (скан без распознавания) — вставьте текст карточки вручную')
        return text

    def parse(self, text: Any) -> dict:
        """Текст карточки → {fields, fns, warnings}."""
        text = str(text or '')[: self.TEXT_MAX]
        if not text.strip():
            raise ValueError('Вставьте текст карточки предприятия или выберите файл')
        fields = {key: self._first(pattern, text) for key, pattern in self.PATTERNS.items()}
        fields.update({key: self._line(label, text) for key, label in self.LINES.items()})
        fields['name'] = self._company(text) or fields['name']
        fields['email'] = next(iter(self.EMAIL.findall(text)), '')
        fields['phone'] = Phone.format(found.group(0)) if (found := self.PHONE.search(text)) else ''
        fields = {key: value[: self.VALUE_MAX] for key, value in fields.items() if value}
        fns, warnings = self._fns(fields)
        return {'fields': fields, 'fns': fns, 'warnings': warnings}

    @staticmethod
    def _first(pattern: str, text: str) -> str:
        found = re.search(pattern, text, re.I)
        return next((group for group in found.groups() if group), '') if found else ''

    @staticmethod
    def _line(label: str, text: str) -> str:
        found = re.search(rf'(?im)^\s*(?:{label})\s*[:\t|;]+\s*(.+?)\s*$', text)
        return found.group(1).strip(' "\t|;') if found else ''

    def _company(self, text: str) -> str:
        found = self.COMPANY.search(text)
        if found:
            return f'{found.group(1)} «{found.group(2).strip()}»'
        person = self.PERSON.search(text)
        return f'ИП {person.group(1)}' if person else ''

    def _fns(self, fields: dict) -> tuple[dict, list[str]]:
        inn = fields.get('inn') or ''
        if not inn:
            return {}, ['ИНН в карточке не найден — впишите его, программа проверит по ФНС']
        if not valid_inn(inn):
            return {}, [f'ИНН {inn} с ошибкой (контрольная сумма) — проверьте карточку']
        try:
            found = Counterparties(self.store).lookup(inn)
        except Exception:
            found = {'error': 'сервис недоступен'}
        if found.get('error'):
            return {}, [self.OFFLINE]
        fns = {
            key: found.get(key) or ''
            for key in ('short', 'full', 'kpp', 'ogrn', 'address', 'director', 'status', 'source')
        }
        warnings = []
        if fields.get('kpp') and fns['kpp'] and fields['kpp'] != fns['kpp']:
            warnings.append(
                f'КПП в карточке {fields["kpp"]}, в ФНС — {fns["kpp"]} (возможно, обособленное подразделение)'
            )
        if fields.get('ogrn') and fns['ogrn'] and fields['ogrn'] != fns['ogrn']:
            warnings.append(f'ОГРН в карточке {fields["ogrn"]}, в ФНС — {fns["ogrn"]}')
        if fns['status'] and 'действ' not in str(fns['status']).lower():
            warnings.append(f'Статус в ФНС: {fns["status"]}')
        return fns, warnings

    def create(self, data: Any, author: str) -> dict:
        """Новый клиент по проверенным полям; уже есть с этим ИНН — дописать пустые поля. → карточка."""
        if not isinstance(data, dict):
            raise ValueError('Нет данных клиента')
        fields = {
            key: str(data.get(key) or '').strip()[: self.VALUE_MAX]
            for key in (*self.PATTERNS, *self.LINES, 'email', 'phone')
        }
        inn = re.sub(r'\D', '', fields['inn'])
        if not valid_inn(inn):
            raise ValueError('ИНН — 10 цифр (организация) или 12 (ИП) с верной контрольной суммой')
        if not fields['name']:
            raise ValueError('Укажите наименование')
        cid = 'inn' + inn
        known = self.store.client_get(cid)
        doc = dict(known) if isinstance(known, dict) else {'id': cid, 'contacts': []}
        for key, value in dict(fields, inn=inn).items():
            if value and not doc.get(key):
                doc[key] = value
        self.store.client_put(cid, doc, author)
        return doc
