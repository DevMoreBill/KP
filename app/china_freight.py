"""Доставка из Китая до места прибытия в ЕАЭС (входит в таможенную стоимость): ставки экспедиторов и ATI.SU."""

import json
import os
import re
from datetime import date, datetime

import defaults
import logistics_api
from config import APP_DIR


class ChinaFreight:
    KV_KEY = 'chinaRates'
    KINDS = {
        'ftl': 'Фура 20 т (тент)',
        'ltl': 'Сборный груз',
        'docker': 'Контейнер (контейнеровоз)',
        'tral': 'Негабарит (трал)',
    }
    UNITS = {'trip': 'за рейс / контейнер', 'kg': 'за кг', 'm3': 'за м³'}
    CURS = ('CNY', 'USD', 'EUR', 'RUB')
    # участок: до места прибытия и сквозной — в таможенную стоимость, по ЕАЭС — нет, если выделен
    SCOPES = {
        'border': 'До места прибытия в ЕАЭС',
        'through': 'Сквозная до пункта в РФ',
        'after': 'По РФ от места прибытия',
    }
    # места прибытия на территорию ЕАЭС с Китаем (ж/д, авто); через Казахстан — граница Казахстана
    BORDERS = (
        'Забайкальск',
        'Пограничный',
        'Достык (Казахстан)',
        'Хоргос (Казахстан)',
        'Благовещенск',
        'Краскино',
        'Нижнеленинское',
        'Кяхта',
    )
    # что добавить к цене контракта по условиям поставки (ТК ЕАЭС, ст. 40)
    TERMS = {
        'EXW': ('EXW — с завода', True, True, True),
        'FCA': ('FCA — передача перевозчику в Китае', True, False, True),
        'FOB': ('FOB — порт отгрузки', True, False, True),
        'CPT': ('CPT / DAP — до места прибытия (граница)', False, False, True),
        'CIP': ('CIP / CIF — до места прибытия со страхованием', False, False, False),
        'DAP_RU': ('DAP / DDP — до пункта в РФ', False, False, False),
    }
    ATI_CAR = {'ftl': ('tent', 20), 'docker': ('docker', 20), 'tral': ('tral', 20)}
    DEV = ('log.cnDev', 30, 0, 200)  # отклонение ставки от рынка, %
    CHINA_RE = re.compile(r'китай|кнр', re.I)
    MAX_ROWS = 300
    # ориентиры по открытым данным — не ставки по договору
    REF = os.path.join(APP_DIR, 'web', 'rules', 'china_rates_ref.json')

    def __init__(self, store) -> None:
        self.store = store

    def dev(self) -> float:
        key, builtin, low, high = self.DEV
        return defaults.num(self.store, key, builtin, low, high)

    def rates(self) -> dict:
        data = self.store.kv_get(self.KV_KEY)
        return data if isinstance(data, dict) else {'rows': []}

    @staticmethod
    def _text(v, name: str, limit: int, need: bool = True) -> str:
        text = re.sub(r'\s+', ' ', str(v or '')).strip()
        if need and not text:
            raise ValueError(f'Ставки экспедиторов: не заполнено поле «{name}»')
        if len(text) > limit:
            raise ValueError(f'Ставки экспедиторов: «{name}» — не длиннее {limit} знаков')
        return text

    @staticmethod
    def _num(v) -> float | None:
        try:
            return float(str(v if v is not None else '').replace(',', '.').replace(' ', '').replace(' ', ''))
        except ValueError:
            return None

    @staticmethod
    def _date(v, i: int) -> str:
        text = str(v or '').strip()
        if not text:
            return ''
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            raise ValueError(f'Строка {i}: «Действует до» — дата (ГГГГ-ММ-ДД)') from None

    @classmethod
    def ref(cls) -> dict:
        """{date, title, note, rows} из файла поставки; нет файла — пусто."""
        try:
            with open(cls.REF, encoding='utf-8') as handle:
                data = json.load(handle)
            return (
                {k: data.get(k) for k in ('date', 'title', 'note', 'rows')}
                if data.get('format') == 'kp-china-rates-ref'
                else {'rows': []}
            )
        except (OSError, ValueError):
            return {'rows': []}

    def save_rates(self, rows: list, author: str = '') -> dict:
        if not isinstance(rows, list) or len(rows) > self.MAX_ROWS:
            raise ValueError(f'Ставки экспедиторов: нужен список до {self.MAX_ROWS} строк')
        out = []
        for i, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                raise ValueError(f'Ставки экспедиторов: строка {i} — неверный формат')
            price = self._num(row.get('price'))
            if price is None or not 0 < price <= 1e9:
                raise ValueError(f'Строка {i}: ставка — число больше нуля')
            kind, unit, cur, scope = (
                row.get('kind'),
                row.get('unit') or 'trip',
                row.get('cur') or 'CNY',
                row.get('scope') or 'border',
            )
            if kind not in self.KINDS or unit not in self.UNITS or cur not in self.CURS or scope not in self.SCOPES:
                raise ValueError(f'Строка {i}: выберите вид перевозки, участок, единицу и валюту из списка')
            minimum = self._num(row.get('min')) if str(row.get('min') or '').strip() else 0
            if minimum is None or not 0 <= minimum <= 1e9:
                raise ValueError(f'Строка {i}: минимальная сумма — число не меньше нуля')
            days = str(row.get('days') or '').strip()
            if days and not (days.isdigit() and int(days) <= 365):
                raise ValueError(f'Строка {i}: срок — целое число дней до 365')
            src = self._text(row.get('src'), 'Источник', 300, need=False)
            if src and not re.match(r'^https?://\S+$', src):
                raise ValueError(f'Строка {i}: источник — ссылка http(s)://…')
            out.append(
                {
                    'ref': bool(row.get('ref')) and row.get('ref') not in ('0', 'false', ''),
                    'src': src,
                    'from': self._text(row.get('from'), 'Откуда', 80),
                    'to': self._text(row.get('to'), 'Куда', 80),
                    'kind': kind,
                    'scope': scope,
                    'unit': unit,
                    'price': price,
                    'min': minimum,
                    'cur': cur,
                    'days': int(days) if days else None,
                    'until': self._date(row.get('until'), i),
                    'who': self._text(row.get('who'), 'Экспедитор', 80, need=False),
                    'note': self._text(row.get('note'), 'Примечание', 200, need=False),
                }
            )
        data = {'rows': out, 'at': datetime.now().isoformat(timespec='seconds'), 'by': str(author or '')[:80]}
        self.store.kv_set(self.KV_KEY, data)
        return data

    def ati_on(self):
        return logistics_api.providers(self.store).get('ati')

    def directions(self) -> list:
        """[{from, to, fromId, toId}] — направления «Средних ставок» с отправлением из Китая."""
        return [
            direction
            for direction in logistics_api.Ati.directions(self.store)
            if self.CHINA_RE.search(direction.get('from') or '')
        ]

    def status(self) -> dict:
        out = {
            'kinds': self.KINDS,
            'units': self.UNITS,
            'curs': list(self.CURS),
            'scopes': self.SCOPES,
            'borders': list(self.BORDERS),
            'terms': {k: v[0] for k, v in self.TERMS.items()},
            'dev': self.dev(),
            'ref': self.ref(),
            'ati': bool(self.ati_on()),
            'rates': self.rates(),
            'directions': [],
        }
        if out['ati']:
            try:
                out['directions'] = [
                    {'from': direction['from'], 'to': direction['to']} for direction in self.directions()
                ]
            except Exception as exc:
                out['atiError'] = logistics_api.Http.error(exc)
        return out

    @staticmethod
    def _key(text) -> str:
        """«Достык (Казахстан)» = «Достык»: сравнение мест без пояснения в скобках."""
        return logistics_api.cnorm(re.sub(r'\([^)]*\)', '', str(text or '')))

    def _money(self, offer, rates: dict, what: str) -> float:
        """{v, cur} → рубли по курсу ЦБ; пусто — 0; нет курса — ValueError."""
        v = self._num((offer or {}).get('v')) if str((offer or {}).get('v') or '').strip() else 0
        if v is None or v < 0:
            raise ValueError(f'{what} — число не меньше нуля')
        cur = (offer or {}).get('cur') or 'CNY'
        if cur not in self.CURS:
            raise ValueError(f'{what} — выберите валюту из списка')
        rate = 1.0 if cur == 'RUB' else logistics_api.number((rates or {}).get(cur))
        if v and not rate:
            raise ValueError(f'{what}: нет курса ЦБ для {cur} — повторите позже')
        return v * (rate or 0)

    def _ati(self, frm: str, dest: str, kind: str) -> tuple:
        """Рыночный ориентир ATI.SU (верхняя граница средних ставок, ₽) или (None, ошибка)."""
        if kind not in self.ATI_CAR:
            return None, None
        if not self.ati_on():
            return (
                None,
                'нет ключа ATI.SU («Сотрудники и система → Подключения и ключи») или ATI.SU выключен — сравнение с рынком не сделано',
            )
        try:
            dirs = [
                direction
                for direction in self.directions()
                if self._key(direction['from']) == frm and self._key(direction['to']) == dest
            ]
            if not dirs:
                return None, 'направления нет в «Средних ставках» ATI.SU — сравнение с рынком не сделано'
            car, ton = self.ATI_CAR[kind]
            price = logistics_api.Ati.price(self.store, dirs[0], car, ton)
            return {
                'rub': round(price['upperRub'] or 0),
                'avgRub': round(price['avgRub'] or 0) if price['avgRub'] else None,
                'note': f'верхняя граница средних ставок за {logistics_api.LtlLimits.ati_days(self.store)} дн., '
                f'{self.KINDS[kind].split(" (")[0].lower()} {ton} т, с НДС',
            }, None
        except Exception as exc:
            return None, logistics_api.Http.error(exc)

    def quote(self, req: dict, rates: dict, today=None) -> dict:
        """req: from, to, dest, kind, kg, m3, terms, extra, ins; fx — курсы ЦБ → предложения с суммой к таможенной стоимости."""
        frm, dst, dest, kind = (
            self._key(req.get('from')),
            self._key(req.get('to')),
            self._key(req.get('dest')),
            req.get('kind'),
        )
        if not frm or not dst or kind not in self.KINDS:
            raise ValueError('Укажите город в Китае, место прибытия и вид перевозки')
        terms = req.get('terms') or 'EXW'
        if terms not in self.TERMS:
            raise ValueError('Выберите условия поставки из списка')
        t_name, add_freight, add_extra, add_ins = self.TERMS[terms]
        qty = {'kg': logistics_api.number(req.get('kg')) or 0, 'm3': logistics_api.number(req.get('m3')) or 0}
        extra = self._money(req.get('extra'), rates, 'Расходы в Китае') if add_extra else 0
        ins = self._money(req.get('ins'), rates, 'Страхование') if add_ins else 0
        today = today or date.today().isoformat()
        offers = []
        after = []
        errors = []
        groups: dict = {}
        for row in self.rates().get('rows') or []:
            scope = row.get('scope') or 'border'
            if row.get('kind') != kind:
                continue
            if scope == 'border':
                ok = self._key(row.get('from')) == frm and self._key(row.get('to')) == dst
            elif scope == 'through':
                ok = self._key(row.get('from')) == frm and bool(dest) and self._key(row.get('to')) == dest
            else:
                ok = self._key(row.get('from')) == dst and bool(dest) and self._key(row.get('to')) == dest
            if not ok:
                continue
            who = row.get('who') or 'Ставка экспедитора'
            mul = 1 if row['unit'] == 'trip' else qty[row['unit']]
            if not mul:
                errors.append(
                    {
                        'src': who,
                        'msg': 'ставка {} — укажите {}'.format(
                            self.UNITS[row['unit']], 'вес брутто, кг' if row['unit'] == 'kg' else 'объём, м³'
                        ),
                    }
                )
                continue
            rate = 1.0 if row['cur'] == 'RUB' else logistics_api.number((rates or {}).get(row['cur']))
            if not rate:
                errors.append({'src': who, 'msg': 'нет курса ЦБ для {} — повторите позже'.format(row['cur'])})
                continue
            amount = row['price'] * mul
            how = '{} {} {}'.format(self.fmt(row['price']), row['cur'], self.UNITS[row['unit']]) + (
                '' if row['unit'] == 'trip' else f' × {self.fmt(mul)}'
            )
            group = groups.setdefault(
                (who, scope, self._key(row.get('to'))),
                {
                    'src': who,
                    'scope': scope,
                    'amount': 0,
                    'cur': row['cur'],
                    'rate': rate,
                    'how': [],
                    'days': row.get('days'),
                    'until': row.get('until') or '',
                    'note': row.get('note') or '',
                    'min': 0,
                    'ref': bool(row.get('ref')),
                    'url': row.get('src') or '',
                },
            )
            if group['cur'] != row['cur']:
                errors.append(
                    {
                        'src': who,
                        'msg': 'ставки одного экспедитора на один участок — в разных валютах; оставьте одну валюту',
                    }
                )
                continue
            # сборный: большее из «за кг» и «за м³», не меньше минимума
            group['amount'] = max(group['amount'], amount)
            group['min'] = max(group['min'], row.get('min') or 0)
            group['how'].append(how)
            if row.get('until') and (not group['until'] or row['until'] < group['until']):
                group['until'] = row['until']
        mkt, mkt_err = self._ati(frm, dst, kind)
        dev = self.dev()
        for group in groups.values():
            amount = max(group['amount'], group['min'])
            rub = round(amount * group['rate'])
            warn = []
            if group['ref']:
                warn.append(
                    'ориентир по открытым данным, а не ставка экспедитора по договору — для таможенной стоимости запросите ставку с выделенным участком до места прибытия'
                )
            if group['until'] and group['until'] < today:
                warn.append(
                    'ставка просрочена (действовала до {}) — запросите у экспедитора новую'.format(
                        '.'.join(reversed(group['until'].split('-')))
                    )
                )
            if group['min'] and group['min'] >= group['amount']:
                group['how'].append('минимальная сумма {} {}'.format(self.fmt(group['min']), group['cur']))
            offer = {
                'src': group['src'],
                'scope': group['scope'],
                'rub': rub,
                'amount': round(amount, 2),
                'cur': group['cur'],
                'days': group['days'],
                'until': group['until'],
                'note': '; '.join(group['how'] + ([group['note']] if group['note'] else [])),
                'warn': warn,
                'ref': group['ref'],
                'srcUrl': group['url'],
            }
            if group['scope'] == 'after':
                offer['warn'].append(
                    'в таможенную стоимость не входит, только если эта сумма выделена в договоре и подтверждена счётом (ТК ЕАЭС ст. 40 п. 2)'
                )
                after.append(offer)
                continue
            if group['scope'] == 'through':
                offer['warn'].append(
                    'сквозная ставка одной суммой: вся сумма войдёт в таможенную стоимость; чтобы исключить участок по РФ — '
                    'попросите экспедитора выделить его в договоре и счёте (ТК ЕАЭС ст. 40 п. 2)'
                )
            if mkt and mkt['rub'] and group['scope'] == 'border' and dev:
                diff = (rub - mkt['rub']) / float(mkt['rub']) * 100
                if abs(diff) > dev:
                    offer['warn'].append(
                        f'{"дороже" if diff > 0 else "дешевле"} рынка на {round(abs(diff))} % '
                        f'(ATI.SU {self.fmt(mkt["rub"])} ₽) — проверьте ставку'
                    )
            offer['cv'] = round((rub if add_freight else 0) + extra + ins)
            offer['cvParts'] = [
                part
                for part in (
                    (
                        (
                            'перевозка '
                            + ('сквозная (целиком)' if group['scope'] == 'through' else 'до места прибытия'),
                            rub,
                        )
                        if add_freight
                        else None
                    ),
                    (('расходы в Китае', round(extra)) if extra else None),
                    (('страхование', round(ins)) if ins else None),
                )
                if part
            ]
            offers.append(offer)
        if mkt_err:
            errors.append({'src': 'ATI.SU', 'msg': mkt_err, 'skip': True})
        if not offers and not [err for err in errors if not err.get('skip')]:
            errors.append(
                {
                    'src': 'Ставки экспедиторов',
                    'msg': 'для этого маршрута и вида перевозки ставок нет — добавьте их в таблицу ниже',
                }
            )
        offers.sort(key=lambda offer: -offer['cv'])
        note = {
            'EXW': 'к цене контракта добавляются перевозка до места прибытия, расходы в Китае и страхование (если оплачено)',
            'FCA': 'к цене контракта добавляются перевозка от передачи перевозчику до места прибытия и страхование (если оплачено)',
            'FOB': 'к цене контракта добавляются фрахт от порта отгрузки до места прибытия и страхование (если оплачено)',
            'CPT': 'перевозка до места прибытия уже в цене контракта — к ней добавляется только страхование, если его оплатил покупатель',
            'CIP': 'перевозка и страхование до места прибытия уже в цене контракта — ничего не добавляется',
            'DAP_RU': 'перевозка до пункта в РФ уже в цене контракта; участок по РФ можно вычесть из таможенной стоимости, только если он '
            'выделен в контракте и подтверждён документами (ТК ЕАЭС ст. 40 п. 2)',
        }[terms]
        return {
            'offers': offers,
            'after': after,
            'market': mkt,
            'errors': errors,
            'terms': t_name,
            'termsNote': note,
            'extra': round(extra),
            'ins': round(ins),
            'dev': dev,
            'kz': 'казахстан' in str(req.get('to') or '').lower(),
            'fx': {k: (rates or {}).get(k) for k in ('USD', 'CNY', 'EUR', 'date')},
        }

    @staticmethod
    def fmt(v) -> str:
        text = f'{v:,.2f}'.replace(',', ' ')
        return text[:-3] if text.endswith('.00') else text.replace('.', ',')
