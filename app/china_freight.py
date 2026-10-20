"""Доставка из Китая до места прибытия в ЕАЭС (входит в таможенную стоимость): ставки экспедиторов и ATI.SU."""

import json
import os
import re
from datetime import date, datetime

import defaults
import logistics_api as lg
from config import APP_DIR


class ChinaFreight:
    KV = 'chinaRates'
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
    CN = re.compile(r'китай|кнр', re.I)
    MAX_ROWS = 300
    # ориентиры по открытым данным — не ставки по договору
    REF = os.path.join(APP_DIR, 'web', 'rules', 'china_rates_ref.json')

    def __init__(self, store) -> None:
        self.store = store

    def dev(self) -> float:
        key, b, lo, hi = self.DEV
        return defaults.num(self.store, key, b, lo, hi)

    def rates(self) -> dict:
        d = self.store.kv_get(self.KV)
        return d if isinstance(d, dict) else {'rows': []}

    @staticmethod
    def _text(v, name: str, n: int, need: bool = True) -> str:
        s = re.sub(r'\s+', ' ', str(v or '')).strip()
        if need and not s:
            raise ValueError(f'Ставки экспедиторов: не заполнено поле «{name}»')
        if len(s) > n:
            raise ValueError(f'Ставки экспедиторов: «{name}» — не длиннее {n} знаков')
        return s

    @staticmethod
    def _num(v) -> float | None:
        try:
            return float(str(v if v is not None else '').replace(',', '.').replace(' ', '').replace(' ', ''))
        except ValueError:
            return None

    @staticmethod
    def _date(v, i: int) -> str:
        s = str(v or '').strip()
        if not s:
            return ''
        try:
            return date.fromisoformat(s[:10]).isoformat()
        except ValueError:
            raise ValueError(f'Строка {i}: «Действует до» — дата (ГГГГ-ММ-ДД)') from None

    @classmethod
    def ref(cls) -> dict:
        """{date, title, note, rows} из файла поставки; нет файла — пусто."""
        try:
            with open(cls.REF, encoding='utf-8') as f:
                d = json.load(f)
            return (
                {k: d.get(k) for k in ('date', 'title', 'note', 'rows')}
                if d.get('format') == 'kp-china-rates-ref'
                else {'rows': []}
            )
        except (OSError, ValueError):
            return {'rows': []}

    def save_rates(self, rows: list, by: str = '') -> dict:
        if not isinstance(rows, list) or len(rows) > self.MAX_ROWS:
            raise ValueError(f'Ставки экспедиторов: нужен список до {self.MAX_ROWS} строк')
        out = []
        for i, r in enumerate(rows, 1):
            if not isinstance(r, dict):
                raise ValueError(f'Ставки экспедиторов: строка {i} — неверный формат')
            price = self._num(r.get('price'))
            if price is None or not 0 < price <= 1e9:
                raise ValueError(f'Строка {i}: ставка — число больше нуля')
            kind, unit, cur, scope = (
                r.get('kind'),
                r.get('unit') or 'trip',
                r.get('cur') or 'CNY',
                r.get('scope') or 'border',
            )
            if kind not in self.KINDS or unit not in self.UNITS or cur not in self.CURS or scope not in self.SCOPES:
                raise ValueError(f'Строка {i}: выберите вид перевозки, участок, единицу и валюту из списка')
            mn = self._num(r.get('min')) if str(r.get('min') or '').strip() else 0
            if mn is None or not 0 <= mn <= 1e9:
                raise ValueError(f'Строка {i}: минимальная сумма — число не меньше нуля')
            days = str(r.get('days') or '').strip()
            if days and not (days.isdigit() and int(days) <= 365):
                raise ValueError(f'Строка {i}: срок — целое число дней до 365')
            src = self._text(r.get('src'), 'Источник', 300, need=False)
            if src and not re.match(r'^https?://\S+$', src):
                raise ValueError(f'Строка {i}: источник — ссылка http(s)://…')
            out.append(
                {
                    'ref': bool(r.get('ref')) and r.get('ref') not in ('0', 'false', ''),
                    'src': src,
                    'from': self._text(r.get('from'), 'Откуда', 80),
                    'to': self._text(r.get('to'), 'Куда', 80),
                    'kind': kind,
                    'scope': scope,
                    'unit': unit,
                    'price': price,
                    'min': mn,
                    'cur': cur,
                    'days': int(days) if days else None,
                    'until': self._date(r.get('until'), i),
                    'who': self._text(r.get('who'), 'Экспедитор', 80, need=False),
                    'note': self._text(r.get('note'), 'Примечание', 200, need=False),
                }
            )
        d = {'rows': out, 'at': datetime.now().isoformat(timespec='seconds'), 'by': str(by or '')[:80]}
        self.store.kv_set(self.KV, d)
        return d

    def ati_on(self):
        return lg.providers(self.store).get('ati')

    def directions(self) -> list:
        """[{from, to, fromId, toId}] — направления «Средних ставок» с отправлением из Китая."""
        return [d for d in lg.Ati.directions(self.store) if self.CN.search(d.get('from') or '')]

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
                out['directions'] = [{'from': d['from'], 'to': d['to']} for d in self.directions()]
            except Exception as e:
                out['atiError'] = lg.Http.error(e)
        return out

    @staticmethod
    def _key(s) -> str:
        """«Достык (Казахстан)» = «Достык»: сравнение мест без пояснения в скобках."""
        return lg.cnorm(re.sub(r'\([^)]*\)', '', str(s or '')))

    def _money(self, o, fx: dict, what: str) -> float:
        """{v, cur} → рубли по курсу ЦБ; пусто — 0; нет курса — ValueError."""
        v = self._num((o or {}).get('v')) if str((o or {}).get('v') or '').strip() else 0
        if v is None or v < 0:
            raise ValueError(f'{what} — число не меньше нуля')
        cur = (o or {}).get('cur') or 'CNY'
        if cur not in self.CURS:
            raise ValueError(f'{what} — выберите валюту из списка')
        rate = 1.0 if cur == 'RUB' else lg.number((fx or {}).get(cur))
        if v and not rate:
            raise ValueError(f'{what}: нет курса ЦБ для {cur} — повторите позже')
        return v * (rate or 0)

    def _ati(self, frm: str, to: str, kind: str) -> tuple:
        """Рыночный ориентир ATI.SU (верхняя граница средних ставок, ₽) или (None, ошибка)."""
        if kind not in self.ATI_CAR:
            return None, None
        if not self.ati_on():
            return (
                None,
                'нет ключа ATI.SU («Сотрудники и система → Подключения и ключи») или ATI.SU выключен — сравнение с рынком не сделано',
            )
        try:
            ds = [d for d in self.directions() if self._key(d['from']) == frm and self._key(d['to']) == to]
            if not ds:
                return None, 'направления нет в «Средних ставках» ATI.SU — сравнение с рынком не сделано'
            car, ton = self.ATI_CAR[kind]
            p = lg.Ati.price(self.store, ds[0], car, ton)
            return {
                'rub': round(p['upperRub'] or 0),
                'avgRub': round(p['avgRub'] or 0) if p['avgRub'] else None,
                'note': f'верхняя граница средних ставок за {lg.LtlLimits.ati_days(self.store)} дн., '
                f'{self.KINDS[kind].split(" (")[0].lower()} {ton} т, с НДС',
            }, None
        except Exception as e:
            return None, lg.Http.error(e)

    def quote(self, req: dict, fx: dict, today=None) -> dict:
        """req: from, to, dest, kind, kg, m3, terms, extra, ins; fx — курсы ЦБ → предложения с суммой к таможенной стоимости."""
        frm, to, dest, kind = (
            self._key(req.get('from')),
            self._key(req.get('to')),
            self._key(req.get('dest')),
            req.get('kind'),
        )
        if not frm or not to or kind not in self.KINDS:
            raise ValueError('Укажите город в Китае, место прибытия и вид перевозки')
        terms = req.get('terms') or 'EXW'
        if terms not in self.TERMS:
            raise ValueError('Выберите условия поставки из списка')
        t_name, add_freight, add_extra, add_ins = self.TERMS[terms]
        qty = {'kg': lg.number(req.get('kg')) or 0, 'm3': lg.number(req.get('m3')) or 0}
        extra = self._money(req.get('extra'), fx, 'Расходы в Китае') if add_extra else 0
        ins = self._money(req.get('ins'), fx, 'Страхование') if add_ins else 0
        today = today or date.today().isoformat()
        offers, after, errors, groups = [], [], [], {}
        for r in self.rates().get('rows') or []:
            scope = r.get('scope') or 'border'
            if r.get('kind') != kind:
                continue
            if scope == 'border':
                ok = self._key(r.get('from')) == frm and self._key(r.get('to')) == to
            elif scope == 'through':
                ok = self._key(r.get('from')) == frm and bool(dest) and self._key(r.get('to')) == dest
            else:
                ok = self._key(r.get('from')) == to and bool(dest) and self._key(r.get('to')) == dest
            if not ok:
                continue
            who = r.get('who') or 'Ставка экспедитора'
            mul = 1 if r['unit'] == 'trip' else qty[r['unit']]
            if not mul:
                errors.append(
                    {
                        'src': who,
                        'msg': 'ставка {} — укажите {}'.format(
                            self.UNITS[r['unit']], 'вес брутто, кг' if r['unit'] == 'kg' else 'объём, м³'
                        ),
                    }
                )
                continue
            rate = 1.0 if r['cur'] == 'RUB' else lg.number((fx or {}).get(r['cur']))
            if not rate:
                errors.append({'src': who, 'msg': 'нет курса ЦБ для {} — повторите позже'.format(r['cur'])})
                continue
            amount = r['price'] * mul
            how = '{} {} {}'.format(self.fmt(r['price']), r['cur'], self.UNITS[r['unit']]) + (
                '' if r['unit'] == 'trip' else f' × {self.fmt(mul)}'
            )
            g = groups.setdefault(
                (who, scope, self._key(r.get('to'))),
                {
                    'src': who,
                    'scope': scope,
                    'amount': 0,
                    'cur': r['cur'],
                    'rate': rate,
                    'how': [],
                    'days': r.get('days'),
                    'until': r.get('until') or '',
                    'note': r.get('note') or '',
                    'min': 0,
                    'ref': bool(r.get('ref')),
                    'url': r.get('src') or '',
                },
            )
            if g['cur'] != r['cur']:
                errors.append(
                    {
                        'src': who,
                        'msg': 'ставки одного экспедитора на один участок — в разных валютах; оставьте одну валюту',
                    }
                )
                continue
            # сборный: большее из «за кг» и «за м³», не меньше минимума
            g['amount'] = max(g['amount'], amount)
            g['min'] = max(g['min'], r.get('min') or 0)
            g['how'].append(how)
            if r.get('until') and (not g['until'] or r['until'] < g['until']):
                g['until'] = r['until']
        mkt, mkt_err = self._ati(frm, to, kind)
        dev = self.dev()
        for g in groups.values():
            amount = max(g['amount'], g['min'])
            rub = round(amount * g['rate'])
            warn = []
            if g['ref']:
                warn.append(
                    'ориентир по открытым данным, а не ставка экспедитора по договору — для таможенной стоимости запросите ставку с выделенным участком до места прибытия'
                )
            if g['until'] and g['until'] < today:
                warn.append(
                    'ставка просрочена (действовала до {}) — запросите у экспедитора новую'.format(
                        '.'.join(reversed(g['until'].split('-')))
                    )
                )
            if g['min'] and g['min'] >= g['amount']:
                g['how'].append('минимальная сумма {} {}'.format(self.fmt(g['min']), g['cur']))
            o = {
                'src': g['src'],
                'scope': g['scope'],
                'rub': rub,
                'amount': round(amount, 2),
                'cur': g['cur'],
                'days': g['days'],
                'until': g['until'],
                'note': '; '.join(g['how'] + ([g['note']] if g['note'] else [])),
                'warn': warn,
                'ref': g['ref'],
                'srcUrl': g['url'],
            }
            if g['scope'] == 'after':
                o['warn'].append(
                    'в таможенную стоимость не входит, только если эта сумма выделена в договоре и подтверждена счётом (ТК ЕАЭС ст. 40 п. 2)'
                )
                after.append(o)
                continue
            if g['scope'] == 'through':
                o['warn'].append(
                    'сквозная ставка одной суммой: вся сумма войдёт в таможенную стоимость; чтобы исключить участок по РФ — '
                    'попросите экспедитора выделить его в договоре и счёте (ТК ЕАЭС ст. 40 п. 2)'
                )
            if mkt and mkt['rub'] and g['scope'] == 'border' and dev:
                d = (rub - mkt['rub']) / float(mkt['rub']) * 100
                if abs(d) > dev:
                    o['warn'].append(
                        f'{"дороже" if d > 0 else "дешевле"} рынка на {round(abs(d))} % '
                        f'(ATI.SU {self.fmt(mkt["rub"])} ₽) — проверьте ставку'
                    )
            o['cv'] = round((rub if add_freight else 0) + extra + ins)
            o['cvParts'] = [
                p
                for p in (
                    (
                        ('перевозка ' + ('сквозная (целиком)' if g['scope'] == 'through' else 'до места прибытия'), rub)
                        if add_freight
                        else None
                    ),
                    (('расходы в Китае', round(extra)) if extra else None),
                    (('страхование', round(ins)) if ins else None),
                )
                if p
            ]
            offers.append(o)
        if mkt_err:
            errors.append({'src': 'ATI.SU', 'msg': mkt_err, 'skip': True})
        if not offers and not [e for e in errors if not e.get('skip')]:
            errors.append(
                {
                    'src': 'Ставки экспедиторов',
                    'msg': 'для этого маршрута и вида перевозки ставок нет — добавьте их в таблицу ниже',
                }
            )
        offers.sort(key=lambda o: -o['cv'])
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
            'fx': {k: (fx or {}).get(k) for k in ('USD', 'CNY', 'EUR', 'date')},
        }

    @staticmethod
    def fmt(v) -> str:
        s = f'{v:,.2f}'.replace(',', ' ')
        return s[:-3] if s.endswith('.00') else s.replace('.', ',')
