"""Раздел «Экономика сделки» карточки Битрикс24 ↔ экономика сделки КП: поля раздела находятся по карточке портала и
заполняются из экономики последнего КП; статья затрат, изменённая в Битриксе, становится поправкой в экономике КП."""

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from clock import Clock
from crm_funnels import DealFields, UfValue
from money import Money
from server_log import ServerLog


def _obj(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        found = json.loads(raw or '{}')
    except (TypeError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


class EconKind(Enum):
    """Статья затрат (правка из Битрикса — поправка в расчёт) или итог (правка из Битрикса — только пометка)."""

    PART = 'part'
    TOTAL = 'total'


class FixVat(Enum):
    """Поправка статьи — платёж с НДС поставщика (НДС уходит в вычет) или без НДС."""

    WITH = 'with'
    WITHOUT = 'without'


@dataclass(frozen=True)
class EconValue:
    """Значение экономики: ключ, подпись, слова названия поля портала, вид; статья — из каких строк структуры затрат."""

    key: str
    label: str
    find: str
    kind: EconKind
    parts: tuple[str, ...] = ()
    total: str = ''
    vat: FixVat = FixVat.WITH

    def pattern(self) -> re.Pattern:
        return re.compile(self.find, re.IGNORECASE)


class EconValues:
    """Что из экономики сделки бывает в карточке Битрикса. Порядок важен: поле получает первое совпадение по названию."""

    ITEMS = (
        EconValue(
            'margin', 'Маржинальность, %', r'маржинальн|рентабельн|марж\w*[^а-я]*%', EconKind.TOTAL, total='margin'
        ),
        EconValue('markup', 'Наценка, %', r'наценк', EconKind.TOTAL, total='markup'),
        EconValue('net', 'Чистая прибыль, ₽', r'чист\w* прибыл', EconKind.TOTAL, total='net'),
        EconValue('finance', 'Финансирование, ₽', r'финансир|стоимост\w* денег', EconKind.TOTAL, total='fin'),
        EconValue('revenue', 'Выручка без НДС, ₽', r'выручк', EconKind.TOTAL, total='revenue'),
        EconValue(
            'cost',
            'Себестоимость, ₽',
            r'себестоим|затрат\w* всего|расход\w* всего|итого (затрат|расход)',
            EconKind.TOTAL,
            total='cost',
        ),
        EconValue(
            'price',
            'Цена для заказчика с НДС, ₽',
            r'цен\w* (для заказчик|продаж|с ндс)|стоимост\w* для заказчик|сумм\w* продаж',
            EconKind.TOTAL,
            total='price',
        ),
        EconValue('equip', 'Закупка оборудования, ₽', r'закуп|оборудован', EconKind.PART, ('Оборудование',)),
        EconValue(
            'logistics',
            'Логистика, ₽',
            r'логист|доставк|перевоз|транспорт|страхован',
            EconKind.PART,
            ('Логистика до границы', 'Доставка по России', 'Страхование груза'),
        ),
        EconValue(
            'customs',
            'Таможня, ₽',
            r'тамож|пошлин|брокер|свх',
            EconKind.PART,
            ('Таможенные платежи', 'Брокер, СВХ, сертификация'),
            vat=FixVat.WITHOUT,
        ),
        EconValue('assembly', 'Сборка станции, ₽', r'сборк', EconKind.PART, ('Сборка станции',)),
        EconValue('mount', 'Монтаж и ПНР, ₽', r'монтаж|пнр|пуско', EconKind.PART, ('Монтаж и ПНР',)),
        EconValue('docs', 'Документация, ₽', r'документац', EconKind.PART, ('Разработка документации',)),
        EconValue(
            'guarantee',
            'Банковская гарантия, ₽',
            r'банковск\w* гарант|(?<![а-я])бг(?![а-я])',
            EconKind.PART,
            ('Банковская гарантия',),
            vat=FixVat.WITHOUT,
        ),
        EconValue(
            'warranty',
            'Резерв на гарантию, ₽',
            r'резерв|гарантийн',
            EconKind.PART,
            ('Резерв на гарантию',),
            vat=FixVat.WITHOUT,
        ),
        EconValue(
            'bonus',
            'Бонусы и комиссии, ₽',
            r'бонус|комисси|агентск|вознагражд',
            EconKind.PART,
            ('Бонусы и комиссии с продажи',),
            vat=FixVat.WITHOUT,
        ),
        EconValue(
            'other',
            'Прочие расходы, ₽',
            r'прочи\w* (расход|затрат)|доп\w* (расход|затрат)',
            EconKind.PART,
            ('Прочие расходы',),
            vat=FixVat.WITHOUT,
        ),
        EconValue('profit', 'Прибыль до налога, ₽', r'прибыл|марж', EconKind.TOTAL, total='profit'),
    )
    PERCENT = frozenset({'margin', 'markup'})

    @classmethod
    def by_key(cls) -> dict[str, EconValue]:
        return {item.key: item for item in cls.ITEMS}

    @classmethod
    def match(cls, title: str) -> str:
        """Ключ значения по названию поля портала ('' — не экономика)."""
        return next((item.key for item in cls.ITEMS if item.pattern().search(title or '')), '')

    @classmethod
    def of_summary(cls, summary: dict) -> dict[str, float]:
        """Значения экономики из краткого итога КП (meta.deal): итоги и статьи вместе с поправками из Битрикса."""
        full = _obj(summary.get('full'))
        confirmed = bool(summary.get('confirmed'))
        totals = {
            'price': full.get('price'),
            'revenue': full.get('revenue'),
            'cost': full.get('cost'),
            'fin': full.get('fin'),
            'profit': summary.get('profit') if confirmed else summary.get('lo'),
            'margin': summary.get('margin') if confirmed else summary.get('marginLo'),
            'markup': summary.get('markup') if confirmed else None,
            'net': summary.get('net') if confirmed else None,
        }
        parts: dict[str, float] = {}
        for row in full.get('parts') or []:
            if isinstance(row, list) and len(row) == EconShift.PAIR and isinstance(row[1], (int, float)):
                parts[str(row[0])] = parts.get(str(row[0]), 0.0) + float(row[1])
        fixes = _obj(full.get('fix'))
        out: dict[str, float] = {}
        for item in cls.ITEMS:
            if item.kind is EconKind.TOTAL:
                value = totals.get(item.total)
                if isinstance(value, (int, float)):
                    out[item.key] = float(value)
                continue
            found = [parts[label] for label in item.parts if label in parts]
            fix = fixes.get(item.key)
            if found or isinstance(fix, (int, float)):
                out[item.key] = round(sum(found) + (float(fix) if isinstance(fix, (int, float)) else 0.0), 2)
        return out


class EconShift:
    """Поправка статьи в кратком итоге КП — по тем же формулам, что расчёт сделки в программе (DealCalculator.result):
    поправка — платёж вне графика (финансирование не меняется), НДС поставщика внутри неё — к вычету."""

    PAIR = 2
    PCT = 100.0
    CENTS = 100

    @classmethod
    def vat_of(cls, item: EconValue, delta: float, calc: dict) -> float:
        """НДС к вычету в поправке: доля НДС статьи по расчёту программы (vatShare), в прежних итогах — ставка поставщика"""
        share = _obj(calc.get('vatShare')).get(item.key)
        if isinstance(share, (int, float)) and not isinstance(share, bool):
            return delta * min(1.0, max(0.0, float(share)))
        rate = float(calc.get('sv') or 0)
        if item.vat is FixVat.WITHOUT or rate <= 0:
            return 0.0
        return delta * rate / (cls.PCT + rate)

    @classmethod
    def _side(cls, side: dict, calc: dict, delta: float, vat: float) -> dict:
        before = float(side.get('Pa') or 0) - (delta - vat)
        ctot = float(side.get('Ctot') or 0) + (delta - vat)
        tax = before * float(calc.get('taxP') or 0) / cls.PCT if before > 0 else 0.0
        cash = cls._cash(calc, before, tax)
        cost = cash * float(calc.get('xG') or 1)
        profit = before - cost
        revenue = float(calc.get('R') or 0)
        return {
            'Pa': before,
            'Ctot': ctot,
            'P': profit,
            'net': before - tax - cost,
            'margin': profit / revenue * cls.PCT if revenue else None,
            'markup': profit / (ctot + cost) * cls.PCT if ctot + cost else None,
        }

    @classmethod
    def _cash(cls, calc: dict, before: float, tax: float) -> float:
        value = float(calc.get('xV') or 0)
        if not value:
            return 0.0
        bases = {
            'sum': lambda: value,
            'sale': lambda: float(calc.get('R') or 0) * value / cls.PCT,
            'salevat': lambda: float(calc.get('S') or 0) * value / cls.PCT,
        }
        mode = str(calc.get('xMode') or 'net')
        return bases[mode]() if mode in bases else max(0.0, before - tax) * value / cls.PCT

    @classmethod
    def cents(cls, value: float) -> float:
        return round(value * cls.CENTS) / cls.CENTS

    @classmethod
    def apply(cls, summary: dict, item: EconValue, delta: float) -> dict:
        """Итог КП с поправкой статьи item, изменённой на delta ₽ (относительно прежней поправки)."""
        out = json.loads(json.dumps(summary))
        full = out.setdefault('full', {})
        calc = _obj(full.get('calc'))
        vat = cls.vat_of(item, delta, calc)
        cents = cls.cents
        sides = {name: _obj(calc.get(name)) for name in ('lo', 'hi') if calc.get(name)}
        moved = {name: cls._side(side, calc, delta, vat) for name, side in sides.items()}
        for name, side in moved.items():
            calc[name] = dict(sides[name], Pa=side['Pa'], Ctot=side['Ctot'])
        full['calc'] = calc
        if 'cost' in full and isinstance(full['cost'], (int, float)):
            full['cost'] = cents(full['cost'] + delta - vat)
        low = moved.get('lo')
        if low and out.get('confirmed'):
            out.update(profit=cents(low['P']), net=cents(low['net']), margin=low['margin'], markup=low['markup'])
        elif low:
            out.update(lo=round(low['P']), marginLo=low['margin'])
            high = moved.get('hi') or low
            out.update(hi=round(high['P']), marginHi=high['margin'])
        fixes = _obj(full.get('fix'))
        fixes[item.key] = cents(float(fixes.get(item.key) or 0) + delta)
        full['fix'] = {key: value for key, value in fixes.items() if abs(value) >= 1 / cls.CENTS}
        return out


class DealEcon:
    """Поля раздела «Экономика сделки» карточки Битрикса ↔ экономика КП сделки.

    Поле раздела получает значение программы, когда экономика КП изменилась (иначе правка в Битриксе остаётся);
    статья затрат, изменённая в Битриксе, — поправкой в экономику последнего КП с экономикой (bxFix в расчёте сделки),
    итог, изменённый в Битриксе, — пометкой в карточке сделки (экономика не меняется).
    """

    KEY = 'crm.dealEcon'
    SECTION = re.compile(r'эконом', re.IGNORECASE)
    EPS = 0.5
    LABEL_MAX = 120
    NOTES_MAX = 20

    def __init__(self, store) -> None:
        self.store = store
        self.fields = DealFields(store)

    def conf(self) -> dict:
        data = self.store.kv_get(self.KEY) or {}
        return data if isinstance(data, dict) else {}

    def enabled(self) -> bool:
        from bitrix import BitrixConf
        from features import FeatureAccess

        return FeatureAccess(self.store).is_on('bxEcon') and BitrixConf(self.store).enabled()

    # --- поля раздела ---

    def discover(self, api, cats: list[str]) -> dict:
        """Поля раздела «Экономика сделки» по настройке карточки сделки портала (общей и воронок cats)."""
        codes: list[str] = []
        titles: list[str] = []
        for cat in ['', *cats]:
            params: dict = {'scope': 'C'}
            if cat not in ('', '0'):
                params['extras'] = {'dealCategoryId': int(cat)}
            try:
                sections = api.call('crm.deal.details.configuration.get', params) or []
            except Exception as exc:  # нет права или старый портал — раздел выбирается вручную
                ServerLog.note(f'Битрикс24: настройка карточки сделки «{cat or "общая"}» не получена — {exc}')
                continue
            for section in sections if isinstance(sections, list) else []:
                if not isinstance(section, dict) or not self.SECTION.search(str(section.get('title') or '')):
                    continue
                titles.append(str(section.get('title')))
                for element in section.get('elements') or []:
                    code = str((element or {}).get('name') or '') if isinstance(element, dict) else ''
                    if code.startswith('UF_') and code not in codes:
                        codes.append(code)
        conf = dict(self.conf(), codes=codes, section=titles[0] if titles else '', found=Clock.now())
        self.store.kv_set(self.KEY, conf)
        self.mark()
        return conf

    def pairs(self) -> dict[str, EconValue]:
        """Поле портала → значение экономики: выбор администратора, иначе — по названию (поля регламента — регламенту)."""
        from deal_rules import DealRegs

        conf = self.conf()
        chosen = picked if isinstance(picked := conf.get('map'), dict) else {}
        defs = self.fields.by_code()
        regs = set(DealRegs(self.store).codes().values())
        values = EconValues.by_key()
        out = {}
        for code in [*(conf.get('codes') or []), *chosen]:
            if code not in defs or code in out:
                continue
            key = (
                chosen[code] if code in chosen else ('' if code in regs else EconValues.match(self._title(defs[code])))
            )
            if key in values:
                out[code] = values[key]
        return out

    @staticmethod
    def _title(row: dict) -> str:
        return str(row.get('title') or row.get('label') or '')

    def owned(self) -> set[str]:
        """Поля сделки, которые заполняет экономика: раздел и привязка к элементам списка «Оплаты» (bitrix_econ_list)."""
        if self.conf().get('on', True) is False:
            return set()
        link = (self.store.kv_get('crm.dealEconList') or {}).get('dealField')
        return set(self.pairs()) | ({str(link)} if link else set())

    def mark(self) -> bool:
        """Поля раздела — в карточке сделки во всех воронках (их значения хранятся в программе и ходят в обмене)."""
        wanted = self.owned()
        rows = self.fields.all()
        changed = False
        for row in rows:
            flag = row['code'] in wanted
            if bool(row.get('econ')) != flag:
                row['econ'] = flag
                changed = True
        if changed:
            self.fields.save_rows(rows)
        return changed

    def view(self) -> dict:
        """Для «Настроек → Битрикс24 → Экономика сделки»: поля раздела, что в них пишется, выбор администратора."""
        conf = self.conf()
        defs = self.fields.by_code()
        chosen = picked if isinstance(picked := conf.get('map'), dict) else {}
        pairs = self.pairs()
        codes = [code for code in [*(conf.get('codes') or []), *chosen] if code in defs]
        rows = []
        for code in dict.fromkeys(codes):
            row = defs[code]
            rows.append(
                {
                    'code': code,
                    'label': row.get('label') or code,
                    'type': row.get('type') or '',
                    'key': pairs[code].key if code in pairs else '',
                    'auto': EconValues.match(self._title(row)),
                    'picked': code in chosen,
                    'section': code in (conf.get('codes') or []),
                }
            )
        numbers = [
            {'code': code, 'label': row.get('label') or code}
            for code, row in defs.items()
            if row.get('type') in ('double', 'integer', 'money', 'string')
        ]
        return {
            'on': conf.get('on', True) is not False,
            'section': conf.get('section') or '',
            'found': conf.get('found') or '',
            'rows': rows,
            'fields': numbers,
            'values': [{'key': item.key, 'label': item.label, 'kind': item.kind.value} for item in EconValues.ITEMS],
        }

    def save(self, data: Any) -> dict:
        """{on, map: {код поля: ключ значения | ''}} → view. ValueError — с понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет настроек экономики сделки')
        defs = self.fields.by_code()
        values = EconValues.by_key()
        chosen = data.get('map') or {}
        if not isinstance(chosen, dict):
            raise ValueError('Неверный выбор полей')
        clean = {}
        for code, key in chosen.items():
            if code not in defs:
                raise ValueError('Неизвестное поле Битрикс24')
            if key not in ('', *values):
                raise ValueError('Неизвестное значение экономики')
            clean[str(code)] = str(key)
        conf = dict(self.conf(), on=data.get('on', True) is not False, map=clean)
        self.store.kv_set(self.KEY, conf)
        self.mark()
        return self.view()

    # --- программа → поля сделки ---

    def latest(self, kp_ids: list[str]) -> tuple[str, dict]:
        """Последнее КП сделки с экономикой (kp_ids — свежие первыми): (id, краткий итог экономики)."""
        for kid in kp_ids:
            summary = _obj(_obj(self.store.kp_get(kid, 'meta')).get('deal'))
            if _obj(summary.get('full')):
                return kid, summary
        return '', {}

    def fill(self, deal: dict, kp_ids: list[str]) -> list[str]:
        """Поля раздела — значениями экономики КП (на месте deal['uf']), если экономика изменилась с прошлой записи
        или поле пустое. → коды изменённых полей."""
        if not self.enabled():
            return []
        pairs = self.pairs()
        if not pairs:
            return []
        _kid, summary = self.latest(kp_ids)
        ours = EconValues.of_summary(summary) if summary else {}
        defs = self.fields.by_code()
        values = dict(deal.get('uf') or {})
        sent = dict(deal.get('econSent') or {})
        changed = []
        for code, item in pairs.items():
            if item.key not in ours:
                continue
            value = self.typed(defs[code], item, ours[item.key])
            if value is None:
                continue
            empty = values.get(code) in (None, '', [], '0')
            if value == sent.get(code) and not empty:
                continue  # экономика не менялась — правка в Битриксе остаётся
            sent[code] = value
            if values.get(code) != value:
                values[code] = value
                changed.append(code)
        deal['econSent'] = sent
        if changed:
            deal['uf'] = values
        return changed

    @staticmethod
    def typed(row: dict, item: EconValue, number: float) -> str | None:
        """Значение для поля портала его вида (в виде программы, как UfValue.norm)."""
        kind = row.get('type')
        percent = item.key in EconValues.PERCENT
        if kind == 'money':
            return None if percent else DealEcon.money(number)
        if kind == 'integer':
            return str(round(number))
        if kind == 'double':
            return UfValue.norm(row, round(number, 2))
        if kind == 'string':
            if percent:
                return f'{number:.1f} %'.replace('.', ',')
            return Money.rub(number)
        return None

    @staticmethod
    def money(number: float) -> str:
        """Поле «Деньги»: с копейками и без экспоненты; целая сумма — без «.00», как записывалась раньше."""
        text = f'{round(number, 2):.2f}'.rstrip('0').rstrip('.')
        return f'{text}|RUB'

    @staticmethod
    def number(raw: Any) -> float | None:
        """Число из значения поля портала: «1 234,5», «1234.5|RUB», «12,5 %», «1.23457e+06»."""
        text = str(raw[0] if isinstance(raw, list) and raw else raw or '').split('|')[0]
        text = re.sub(r'[^\d,.\-eE+]', '', text).replace(',', '.')
        try:
            return float(text)
        except ValueError:
            return None

    # --- Битрикс → экономика КП ---

    def from_bitrix(self, did: str, fields: dict, author: str) -> list[str]:
        """Поля раздела, изменённые в Битриксе: статья — поправкой в экономику КП, итог — пометкой. → что изменилось."""
        from crm import DealBook

        if not self.enabled():
            return []
        pairs = {code: item for code, item in self.pairs().items() if code in fields}
        if not pairs:
            return []
        book = DealBook(self.store)
        deal = book.get(did)
        if not deal:
            return []
        sent = deal.get('econSent') or {}
        kid, summary = self.latest(book.kp_order(did))
        ours = EconValues.of_summary(summary) if summary else {}
        said: list[str] = []
        notes = picked if isinstance(picked := deal.get('econNotes'), dict) else {}
        for code, item in pairs.items():
            value = fields[code]
            if value == sent.get(code):
                continue
            theirs = self.number(value)
            if theirs is None or item.key not in ours or abs(theirs - ours[item.key]) < self.EPS:
                notes.pop(code, None)
                continue
            if item.kind is EconKind.PART and kid:
                was = ours[item.key]
                summary = self._fix(kid, summary, item, theirs, author)
                ours = EconValues.of_summary(summary)
                said.append(f'{item.label.split(",")[0]}: {Money.rub(was)} → {Money.rub(theirs)}')
                notes.pop(code, None)
            else:
                notes[code] = {'label': item.label, 'ours': ours[item.key], 'theirs': theirs, 'at': Clock.now()}
        book.put_econ(did, notes, author, said)
        if said:
            book.autofill(did, author)  # итоги после поправки — в поля раздела и в Битрикс
        return said

    def shift_part(self, did: str, key: str, delta: float, author: str) -> str:
        """Статья key последнего КП сделки с экономикой — на delta ₽ (поправка из Битрикса). → строка «было → стало»."""
        from crm import DealBook

        kid, summary = self.latest(DealBook(self.store).kp_order(did))
        item = EconValues.by_key().get(key)
        if not kid or not item:
            return ''
        ours = EconValues.of_summary(summary).get(key, 0.0)
        self._fix(kid, summary, item, ours + delta, author)
        return f'{item.label.split(",")[0]}: {Money.rub(ours)} → {Money.rub(ours + delta)}'

    def _fix(self, kid: str, summary: dict, item: EconValue, theirs: float, author: str) -> dict:
        """Поправка статьи в КП до суммы theirs: состояние (bxFix — для расчёта в программе: действует, пока статья по
        расчёту программы равна base) и краткий итог (для журнала, карточки и Битрикса)."""
        ours = EconValues.of_summary(summary).get(item.key, 0.0)
        fix_was = float(_obj(_obj(summary.get('full')).get('fix')).get(item.key) or 0)
        new = EconShift.apply(summary, item, theirs - ours)
        state = _obj(self.store.kp_get(kid, 'state'))
        deal_state = state['deal'] if isinstance(state.get('deal'), dict) else {}
        fixes = _obj(deal_state.get('bxFix'))
        fixes[item.key] = {
            'to': round(theirs, 2),
            'base': round(ours - fix_was, 2),
            'at': Clock.now(),
            'by': str(author or '')[: self.LABEL_MAX],
        }
        deal_state['bxFix'] = fixes
        state['deal'] = deal_state
        meta = _obj(self.store.kp_get(kid, 'meta'))
        meta['deal'] = new
        self.store.kp_set(kid, 'state', json.dumps(state, ensure_ascii=False), author)
        self.store.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), author)
        return new
