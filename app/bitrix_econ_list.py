"""Экономика сделки в универсальном списке Битрикс24 (например, «Оплаты»): элемент на каждую оплату клиента — дата и
сумма поступления, поставщик, закупка, доставка и прочие расходы в доле оплаты, НДС закупки; правка закупки, доставки или
прочих в элементе — поправка в экономику КП (deal_econ.DealEcon)."""

import json
import re
from typing import Any

from deal_econ import DealEcon, EconKind, EconValues
from kp_track import Val


def _obj(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        found = json.loads(raw or '{}')
    except (TypeError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


class ListKeys:
    """Поля списка по названию (порядок важен: «НДС включён в закупку» — раньше «закупки»)."""

    ITEMS = (
        ('vatIn', 'НДС включён в закупку', r'ндс\W.*включ|включ\w*\W.*ндс'),
        ('vatRate', 'Ставка НДС', r'(?<![а-яё])ставк'),
        ('date', 'Дата поступления', r'дата'),
        ('amount', 'Сумма поступления', r'сумм'),
        ('supplier', 'Поставщик', r'поставщик'),
        ('purchase', 'Закупочная цена', r'закуп'),
        ('delivery', 'Стоимость доставки', r'доставк|логист|перевоз'),
        ('other', 'Прочие расходы', r'прочи'),
    )
    NEED = ('date', 'amount', 'purchase')
    # статья экономики КП для поправки из элемента
    PART = {'purchase': 'equip', 'delivery': 'logistics', 'other': 'other'}
    LIST_NAME = re.compile(r'оплат|эконом', re.IGNORECASE)
    CRM = re.compile(r'ECrm', re.IGNORECASE)

    @classmethod
    def labels(cls) -> dict[str, str]:
        return {key: label for key, label, _find in cls.ITEMS}

    @classmethod
    def match(cls, name: str) -> str:
        return next((key for key, _label, find in cls.ITEMS if re.search(find, name or '', re.IGNORECASE)), '')


class EconList:
    """Список «Оплаты» портала ↔ оплаты клиента по сделке программы (элементы помнит сделка: econList)."""

    KEY = 'crm.dealEconList'
    TYPES = ('lists', 'bitrix_processes', 'lists_socnet')
    LISTS_MAX = 60
    SCORE_MIN = 4
    CHUNK = 50
    CENTS = 100
    EPS = 0.5
    NAME_MAX = 255
    OTHER_KEYS = tuple(
        item.key for item in EconValues.ITEMS if item.kind is EconKind.PART and item.key not in ('equip', 'logistics')
    )

    def __init__(self, store) -> None:
        self.store = store

    def conf(self) -> dict:
        data = self.store.kv_get(self.KEY) or {}
        return data if isinstance(data, dict) else {}

    def ready(self) -> bool:
        conf = self.conf()
        return conf.get('on', True) is not False and bool(conf.get('list')) and DealEcon(self.store).enabled()

    # --- поиск списка ---

    def discover(self, api) -> dict:
        """Список с полями оплаты (больше всего совпадений по названиям) и его связь со сделкой."""
        from bitrix import BitrixError

        best: tuple = (0, False, None)
        error = ''
        for kind in self.TYPES:
            try:
                lists = api.list('lists.get', {'IBLOCK_TYPE_ID': kind}, limit=self.LISTS_MAX)
            except BitrixError as exc:
                error = str(exc)
                continue
            for row in lists:
                found = self._fields(api, kind, row)
                if found and (found['score'], found['named']) > best[:2]:
                    best = (found['score'], found['named'], found)
        found = best[2]
        conf = dict(self.conf(), found=Val.now(), error='' if found else error)
        if found and found['score'] >= self.SCORE_MIN and all(key in found['fields'] for key in ListKeys.NEED):
            found['dealField'] = self._deal_field(api, found['list']['id'])
            conf.update({key: found[key] for key in ('list', 'fields', 'types', 'enums', 'names', 'crm', 'dealField')})
        else:
            conf.update(list=None, fields={}, types={}, enums={}, names={}, crm=None, dealField='')
        self.store.kv_set(self.KEY, conf)
        DealEcon(self.store).mark()
        return conf

    def _fields(self, api, kind: str, row: dict) -> dict | None:
        from bitrix import BitrixError

        lid = str(row.get('ID') or '')
        if not lid.isdigit():
            return None
        try:
            raw = api.call('lists.field.get', {'IBLOCK_TYPE_ID': kind, 'IBLOCK_ID': int(lid)}) or {}
        except BitrixError:
            return None
        fields, types, enums, names, crm = {}, {}, {}, {}, None
        for fid, field in raw.items() if isinstance(raw, dict) else []:
            if not isinstance(field, dict):
                continue
            kind_of = str(field.get('TYPE') or '')
            types[fid] = kind_of
            names[fid] = str(field.get('NAME') or fid)[: self.NAME_MAX]
            if ListKeys.CRM.search(kind_of):
                crm = {'id': fid, 'prefix': self._prefix(field)}
                continue
            key = ListKeys.match(str(field.get('NAME') or ''))
            if key and key not in fields:
                fields[key] = fid
            options = field.get('DISPLAY_VALUES_FORM')
            if isinstance(options, dict):
                enums[fid] = {str(oid): str(text) for oid, text in options.items()}
        return {
            'list': {'id': lid, 'type': kind, 'name': str(row.get('NAME') or '')[: self.NAME_MAX]},
            'fields': fields,
            'types': types,
            'enums': enums,
            'names': names,
            'crm': crm,
            'score': len(fields),
            'named': bool(ListKeys.LIST_NAME.search(str(row.get('NAME') or ''))),
        }

    @staticmethod
    def _prefix(field: dict) -> bool:
        """Привязка к CRM нескольких видов — значение с приставкой «D_»; только к сделкам — номер сделки."""
        settings = field.get('USER_TYPE_SETTINGS') or field.get('SETTINGS') or {}
        kinds = [key for key, value in settings.items() if value == 'Y'] if isinstance(settings, dict) else []
        return len([key for key in kinds if key in ('LEAD', 'CONTACT', 'COMPANY', 'DEAL', 'QUOTE', 'ORDER')]) != 1

    @staticmethod
    def _deal_field(api, lid: str) -> str:
        """Поле сделки «привязка к элементам списка» на этот список (если есть)."""
        from bitrix import BitrixError

        try:
            rows = api.list('crm.deal.userfield.list', {'filter': {'USER_TYPE_ID': 'iblock_element'}})
        except BitrixError:
            return ''
        for row in rows:
            settings = row.get('SETTINGS') or {}
            if isinstance(settings, dict) and str(settings.get('IBLOCK_ID') or '') == lid:
                return str(row.get('FIELD_NAME') or '')
        return ''

    def view(self) -> dict:
        conf = self.conf()
        labels = ListKeys.labels()
        return {
            'on': conf.get('on', True) is not False,
            'list': conf.get('list'),
            'found': conf.get('found') or '',
            'error': conf.get('error') or '',
            'fields': [
                {
                    'key': key,
                    'label': labels[key],
                    'field': (conf.get('names') or {}).get((conf.get('fields') or {}).get(key, ''), ''),
                }
                for key in labels
            ],
            'link': 'поле сделки' if conf.get('dealField') else ('поле «Сделка» в списке' if conf.get('crm') else ''),
        }

    def save_on(self, flag: Any) -> None:
        self.store.kv_set(self.KEY, dict(self.conf(), on=flag is not False))

    # --- программа → список ---

    def rows(self, deal: dict) -> dict[str, dict]:
        """Оплаты клиента, отмеченные в «Исполнении»: {ключ оплаты: значения элемента (ключи ListKeys)}."""
        from crm import DealBook
        from crm_exec import ExecPlan, Sums

        did = deal['id']
        book = DealBook(self.store)
        _kid, summary = DealEcon(self.store).latest(book.kp_order(did))
        full = _obj(summary.get('full'))
        price = float(full.get('price') or 0)
        if not price:
            return {}
        values = EconValues.of_summary(summary)
        sups = [row for row in full.get('sup') or [] if isinstance(row, dict)]
        vat_in = any(row.get('vatIn') for row in sups)
        rate = float(_obj(full.get('calc')).get('sv') or 0) if vat_in else 0.0
        steps = ExecPlan(dict(deal, kps=book.kps([did])[did])).steps(Sums.ALL)
        out = {}
        for step in steps:
            if step.get('kind') != 'cust' or step.get('state') != 'done' or not step.get('amount'):
                continue
            share = float(step['amount']) / price
            out[step['key']] = {
                'date': str(step.get('fact') or '')[:10],
                'amount': self._cents(float(step['amount'])),
                'supplier': ', '.join(dict.fromkeys(str(row.get('name') or '') for row in sups if row.get('name'))),
                'purchase': self._cents(values.get('equip', 0.0) * share),
                'delivery': self._cents(values.get('logistics', 0.0) * share),
                'other': self._cents(sum(values.get(key, 0.0) for key in self.OTHER_KEYS) * share),
                'vatIn': vat_in,
                'vatRate': rate,
                'share': share,
                'title': str(step.get('label') or 'Оплата'),
            }
        return out

    @classmethod
    def _cents(cls, value: float) -> float:
        return round(value * cls.CENTS) / cls.CENTS

    def push(self, api, deal: dict, bid: str) -> list[str]:
        """Элементы списка по оплатам сделки: новые — добавить, изменившиеся в программе — обновить, отменённые — убрать.
        → что сделано (для журнала)."""
        if not self.ready():
            return []
        conf = self.conf()
        want = self.rows(deal)
        have = {key: row for key, row in _obj(deal.get('econList')).items() if isinstance(row, dict)}
        said = []
        for key, row in want.items():
            mine = {name: value for name, value in row.items() if name not in ('share', 'title')}
            old = have.get(key)
            if old and old.get('sent') == mine:
                continue
            fields = self._fields_of(conf, deal, bid, row)
            if old and old.get('id'):
                api.call('lists.element.update', dict(self._where(conf), ELEMENT_ID=int(old['id']), FIELDS=fields))
                said.append(f'обновлена оплата {row["date"]}')
                have[key] = dict(old, sent=mine, share=row['share'])
            else:
                eid = api.call(
                    'lists.element.add',
                    dict(self._where(conf), ELEMENT_CODE=f'kp-{deal["id"]}-{key}'[:100], FIELDS=fields),
                )
                have[key] = {'id': str(eid), 'sent': mine, 'share': row['share']}
                said.append(f'добавлена оплата {row["date"]}')
        for key in [key for key in have if key not in want]:
            if have[key].get('id'):
                api.call('lists.element.delete', dict(self._where(conf), ELEMENT_ID=int(have[key]['id'])))
            said.append('убрана отменённая оплата')
            have.pop(key)
        if said:
            self._link(api, conf, deal, bid, have)
            self._remember(deal['id'], have)
        return said

    @staticmethod
    def _where(conf: dict) -> dict:
        return {'IBLOCK_TYPE_ID': conf['list']['type'], 'IBLOCK_ID': int(conf['list']['id'])}

    def _fields_of(self, conf: dict, deal: dict, bid: str, row: dict) -> dict:
        fields: dict[str, Any] = {
            'NAME': f'Сделка № {deal.get("number")}: {row["title"]} от {self._ru_day(row["date"])}'[: self.NAME_MAX]
        }
        types, enums = conf.get('types') or {}, conf.get('enums') or {}
        for key, fid in (conf.get('fields') or {}).items():
            value = self._value(types.get(fid, ''), enums.get(fid) or {}, key, row.get(key))
            if value is not None:
                fields[fid] = value
        crm = conf.get('crm')
        if isinstance(crm, dict) and crm.get('id'):
            fields[crm['id']] = f'D_{bid}' if crm.get('prefix') else str(bid)
        return fields

    @staticmethod
    def _ru_day(day: str) -> str:
        return '.'.join(reversed(day.split('-'))) if re.match(r'^\d{4}-\d{2}-\d{2}$', day) else day

    def _value(self, kind: str, enum: dict, key: str, raw: Any) -> Any:
        if enum:
            return self._enum(enum, key, raw)
        if key == 'date':
            day = self._ru_day(str(raw or ''))
            return f'{day} 00:00:00' if 'DateTime' in kind else day
        if isinstance(raw, bool):
            return 'Да' if raw else 'Нет'
        if isinstance(raw, float):
            number = f'{raw:.2f}'
            return f'{number}|RUB' if 'Money' in kind else number
        return str(raw or '')[: self.NAME_MAX]

    @staticmethod
    def _enum(enum: dict, key: str, raw: Any) -> str | None:
        """Вариант списка: «да / нет» для НДС в закупке, ставка — по числу (0 — «без НДС», если есть)."""
        texts = {oid: str(text).lower() for oid, text in enum.items()}
        if key == 'vatIn':
            want = ('да', 'вкл', 'с ндс') if raw else ('нет', 'без', 'не ')
            return next((oid for oid, text in texts.items() if text.startswith(want)), None)
        if key == 'vatRate':
            number = f'{float(raw or 0):g}'
            found = next(
                (oid for oid, text in texts.items() if re.sub(r'[^\d.,]', '', text).replace(',', '.') == number), None
            )
            if found or float(raw or 0):
                return found
            return next((oid for oid, text in texts.items() if 'без' in text), None)
        return None

    def _link(self, api, conf: dict, deal: dict, bid: str, have: dict) -> None:
        """Поле сделки «привязка к элементам списка» — все элементы оплат сделки."""
        code = conf.get('dealField')
        if not code:
            return
        from crm import DealBook

        ids = [row['id'] for row in have.values() if row.get('id')]
        api.call('crm.deal.update', {'id': bid, 'fields': {code: ids}})
        DealBook(self.store).put_uf(deal['id'], {code: ids}, 'Битрикс24')

    def _remember(self, did: str, have: dict) -> None:
        from crm import DealBook

        DealBook(self.store).put_econ_list(did, have)

    # --- список → экономика КП ---

    def pull(self, api) -> list[str]:
        """Элементы оплат, у которых в Битриксе поменяли закупку, доставку или прочие: разница / доля оплаты — поправка
        статьи в экономику КП (итоги пересчитаются и уйдут обратно). → строки для журнала."""
        if not self.ready():
            return []
        conf = self.conf()
        owners: dict[str, tuple[str, str]] = {}
        for did, doc in self.store.all(
            "SELECT id, doc FROM deals WHERE json_extract(doc, '$.econList') IS NOT NULL", ()
        ):
            for key, row in _obj(_obj(doc).get('econList')).items():
                if isinstance(row, dict) and row.get('id'):
                    owners[str(row['id'])] = (did, key)
        said = []
        ids = list(owners)
        for start in range(0, len(ids), self.CHUNK):
            rows = api.list(
                'lists.element.get', dict(self._where(conf), FILTER={'ID': ids[start : start + self.CHUNK]})
            )
            for element in rows:
                owner = owners.get(str(element.get('ID') or ''))
                if owner:
                    said += self._back(conf, owner, element)
        return said

    def _back(self, conf: dict, owner: tuple[str, str], element: dict) -> list[str]:
        from crm import DealBook

        did, key = owner
        book = DealBook(self.store)
        deal = book.get(did) or {}
        have = _obj(deal.get('econList'))
        row = have.get(key) or {}
        sent, share = dict(row.get('sent') or {}), float(row.get('share') or 0)
        said = []
        for name, part in ListKeys.PART.items():
            fid = (conf.get('fields') or {}).get(name)
            theirs = DealEcon.number(self._first(element.get(fid))) if fid else None
            if theirs is None or share <= 0 or abs(theirs - float(sent.get(name) or 0)) < self.EPS:
                continue
            delta = (theirs - float(sent.get(name) or 0)) / share
            line = DealEcon(self.store).shift_part(did, part, delta, 'Битрикс24')
            if line:
                said.append(f'Сделка № {deal.get("number")} ← «{conf["list"]["name"]}»: {line}')
            sent[name] = theirs
        if said:
            have[key] = dict(row, sent=sent)
            book.put_econ_list(did, have)
            book.autofill(did, 'Битрикс24')
            from bitrix import BitrixQueue

            BitrixQueue.touch(self.store, 'deal', did)  # пересчитанные итоги и элементы — обратно в Битрикс
        return said

    @staticmethod
    def _first(raw: Any) -> Any:
        """Значение свойства элемента списка: {номер значения: значение} или значение."""
        if isinstance(raw, dict):
            return next(iter(raw.values()), None)
        if isinstance(raw, list):
            return raw[0] if raw else None
        return raw
