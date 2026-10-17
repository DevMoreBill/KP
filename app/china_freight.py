# -*- coding: utf-8 -*-
"""Доставка оборудования из Китая до места прибытия на таможенную территорию ЕАЭС — только для администратора
(«Настройки → Расчёты и нормы → Доставка из Китая»); в «Экономику сделки» пока не попадает (решение владельца 17.10).

Эта часть логистики входит в таможенную стоимость (ТК ЕАЭС, ст. 40, п. 1, пп. 4): перевозка, погрузка, разгрузка,
перегрузка и страхование — до места прибытия на территорию ЕАЭС. Перевозка по территории ЕАЭС от места прибытия в
таможенную стоимость не включается, только если она выделена из цены, заявлена и подтверждена документами (ст. 40, п. 2);
место для железной дороги — Решение Коллегии ЕЭК № 11 от 24.01.2023; распределение по позициям — пропорционально весу
брутто (Решение Коллегии ЕЭК № 83 от 22.05.2018). При ввозе через Казахстан место прибытия — Достык / Хоргос
(граница ЕАЭС), а не граница РФ.

Открытого API цен Китай → граница у перевозчиков нет (проверено 17.10), поэтому цена — только из ставок экспедиторов,
которые вписывает администратор (с участком: до места прибытия, сквозная до пункта в РФ, по РФ; сроком действия);
ATI.SU «Средние ставки» — контроль «не выбивается ли из рынка» (отклонение больше `log.cnDev` — предупреждение),
в таможенную стоимость не идёт. Валюта — в рубли по курсу ЦБ на дату расчёта (для декларации — курс на день
регистрации ДТ)."""
import json
import os
import re
from datetime import date, datetime

import defaults
import logistics_api as lg
from config import APP_DIR


class ChinaFreight:
    KV = 'chinaRates'
    KINDS = {'ftl': 'Фура 20 т (тент)', 'ltl': 'Сборный груз', 'docker': 'Контейнер (контейнеровоз)', 'tral': 'Негабарит (трал)'}
    UNITS = {'trip': 'за рейс / контейнер', 'kg': 'за кг', 'm3': 'за м³'}
    CURS = ('CNY', 'USD', 'EUR', 'RUB')
    # участок ставки: до места прибытия на территорию ЕАЭС (входит в таможенную стоимость), сквозная до пункта в РФ (одной
    # суммой — входит целиком), по территории ЕАЭС после места прибытия (не входит, если выделена и подтверждена)
    SCOPES = {'border': 'До места прибытия в ЕАЭС', 'through': 'Сквозная до пункта в РФ', 'after': 'По РФ от места прибытия'}
    # места прибытия на территорию ЕАЭС с Китаем (ж/д, авто); через Казахстан — граница Казахстана
    BORDERS = ('Забайкальск', 'Пограничный', 'Достык (Казахстан)', 'Хоргос (Казахстан)', 'Благовещенск', 'Краскино', 'Нижнеленинское', 'Кяхта')
    # условия поставки: что добавить к цене контракта (ТК ЕАЭС ст. 40): перевозку до места прибытия, расходы в Китае
    # (погрузка, экспортное оформление), страхование, если его оплатил покупатель
    TERMS = {'EXW': ('EXW — с завода', True, True, True), 'FCA': ('FCA — передача перевозчику в Китае', True, False, True),
             'FOB': ('FOB — порт отгрузки', True, False, True), 'CPT': ('CPT / DAP — до места прибытия (граница)', False, False, True),
             'CIP': ('CIP / CIF — до места прибытия со страхованием', False, False, False),
             'DAP_RU': ('DAP / DDP — до пункта в РФ', False, False, False)}
    ATI_CAR = {'ftl': ('tent', 20), 'docker': ('docker', 20), 'tral': ('tral', 20)}
    DEV = ('log.cnDev', 30, 0, 200)          # «Значения программы → Логистика»: отклонение ставки от рынка, %
    CN = re.compile(r'китай|кнр', re.I)
    MAX_ROWS = 300
    # ориентиры по открытым данным (с источником и датой) — кнопка «Добавить ориентиры» на вкладке; не ставки по договору
    REF = os.path.join(APP_DIR, 'web', 'rules', 'china_rates_ref.json')

    def __init__(self, store):
        self.store = store

    def dev(self):
        key, b, lo, hi = self.DEV
        return defaults.num(self.store, key, b, lo, hi)

    # ---------- ставки экспедиторов
    def rates(self):
        d = self.store.kv_get(self.KV)
        return d if isinstance(d, dict) else {'rows': []}

    @staticmethod
    def _text(v, name, n, need=True):
        s = re.sub(r'\s+', ' ', str(v or '')).strip()
        if need and not s:
            raise ValueError('Ставки экспедиторов: не заполнено поле «%s»' % name)
        if len(s) > n:
            raise ValueError('Ставки экспедиторов: «%s» — не длиннее %d знаков' % (name, n))
        return s

    @staticmethod
    def _num(v):
        try:
            return float(str(v if v is not None else '').replace(',', '.').replace(' ', '').replace(' ', ''))
        except ValueError:
            return None

    @staticmethod
    def _date(v, i):
        s = str(v or '').strip()
        if not s:
            return ''
        try:
            return date.fromisoformat(s[:10]).isoformat()
        except ValueError:
            raise ValueError('Строка %d: «Действует до» — дата (ГГГГ-ММ-ДД)' % i)

    @classmethod
    def ref(cls):
        """{date, title, note, rows} из файла поставки; нет файла — пусто."""
        try:
            with open(cls.REF, encoding='utf-8') as f:
                d = json.load(f)
            return {k: d.get(k) for k in ('date', 'title', 'note', 'rows')} if d.get('format') == 'kp-china-rates-ref' else {'rows': []}
        except (OSError, ValueError):
            return {'rows': []}

    def save_rates(self, rows, by=''):
        if not isinstance(rows, list) or len(rows) > self.MAX_ROWS:
            raise ValueError('Ставки экспедиторов: нужен список до %d строк' % self.MAX_ROWS)
        out = []
        for i, r in enumerate(rows, 1):
            if not isinstance(r, dict):
                raise ValueError('Ставки экспедиторов: строка %d — неверный формат' % i)
            price = self._num(r.get('price'))
            if price is None or not 0 < price <= 1e9:
                raise ValueError('Строка %d: ставка — число больше нуля' % i)
            kind, unit, cur, scope = r.get('kind'), r.get('unit') or 'trip', r.get('cur') or 'CNY', r.get('scope') or 'border'
            if kind not in self.KINDS or unit not in self.UNITS or cur not in self.CURS or scope not in self.SCOPES:
                raise ValueError('Строка %d: выберите вид перевозки, участок, единицу и валюту из списка' % i)
            mn = self._num(r.get('min')) if str(r.get('min') or '').strip() else 0
            if mn is None or not 0 <= mn <= 1e9:
                raise ValueError('Строка %d: минимальная сумма — число не меньше нуля' % i)
            days = str(r.get('days') or '').strip()
            if days and not (days.isdigit() and int(days) <= 365):
                raise ValueError('Строка %d: срок — целое число дней до 365' % i)
            src = self._text(r.get('src'), 'Источник', 300, need=False)
            if src and not re.match(r'^https?://\S+$', src):
                raise ValueError('Строка %d: источник — ссылка http(s)://…' % i)
            out.append({'ref': bool(r.get('ref')) and r.get('ref') not in ('0', 'false', ''), 'src': src, 'from': self._text(r.get('from'), 'Откуда', 80), 'to': self._text(r.get('to'), 'Куда', 80), 'kind': kind, 'scope': scope,
                        'unit': unit, 'price': price, 'min': mn, 'cur': cur, 'days': int(days) if days else None, 'until': self._date(r.get('until'), i),
                        'who': self._text(r.get('who'), 'Экспедитор', 80, need=False), 'note': self._text(r.get('note'), 'Примечание', 200, need=False)})
        d = {'rows': out, 'at': datetime.now().isoformat(timespec='seconds'), 'by': str(by or '')[:80]}
        self.store.kv_set(self.KV, d)
        return d

    # ---------- ATI.SU: направления из Китая
    def ati_on(self):
        return lg.providers(self.store).get('ati')

    def directions(self):
        """[{from, to, fromId, toId}] — направления «Средних ставок» с отправлением из Китая."""
        return [d for d in lg.Ati.directions(self.store) if self.CN.search(d.get('from') or '')]

    def status(self):
        out = {'kinds': self.KINDS, 'units': self.UNITS, 'curs': list(self.CURS), 'scopes': self.SCOPES, 'borders': list(self.BORDERS),
               'terms': {k: v[0] for k, v in self.TERMS.items()}, 'dev': self.dev(), 'ref': self.ref(), 'ati': bool(self.ati_on()), 'rates': self.rates(), 'directions': []}
        if out['ati']:
            try:
                out['directions'] = [{'from': d['from'], 'to': d['to']} for d in self.directions()]
            except Exception as e:
                out['atiError'] = lg.Http.error(e)
        return out

    # ---------- расчёт
    @staticmethod
    def _key(s):
        """«Достык (Казахстан)» = «Достык»: сравнение мест без пояснения в скобках."""
        return lg.cnorm(re.sub(r'\([^)]*\)', '', str(s or '')))

    def _money(self, o, fx, what):
        """{v, cur} → рубли по курсу ЦБ; пусто — 0; нет курса — ValueError."""
        v = self._num((o or {}).get('v')) if str((o or {}).get('v') or '').strip() else 0
        if v is None or v < 0:
            raise ValueError('%s — число не меньше нуля' % what)
        cur = (o or {}).get('cur') or 'CNY'
        if cur not in self.CURS:
            raise ValueError('%s — выберите валюту из списка' % what)
        rate = 1.0 if cur == 'RUB' else lg.number((fx or {}).get(cur))
        if v and not rate:
            raise ValueError('%s: нет курса ЦБ для %s — повторите позже' % (what, cur))
        return v * (rate or 0)

    def _ati(self, frm, to, kind):
        """Рыночный ориентир ATI.SU (верхняя граница средних ставок, ₽) или (None, ошибка)."""
        if kind not in self.ATI_CAR:
            return None, None
        if not self.ati_on():
            return None, 'нет ключа ATI.SU («Внешние сервисы → Ключи API») или ATI.SU выключен — сравнение с рынком не сделано'
        try:
            ds = [d for d in self.directions() if self._key(d['from']) == frm and self._key(d['to']) == to]
            if not ds:
                return None, 'направления нет в «Средних ставках» ATI.SU — сравнение с рынком не сделано'
            car, ton = self.ATI_CAR[kind]
            p = lg.Ati.price(self.store, ds[0], car, ton)
            return {'rub': round(p['upperRub'] or 0), 'avgRub': round(p['avgRub'] or 0) if p['avgRub'] else None,
                    'note': 'верхняя граница средних ставок за %d дн., %s %s т, с НДС' % (lg.LtlLimits.ati_days(self.store), self.KINDS[kind].split(' (')[0].lower(), ton)}, None
        except Exception as e:
            return None, lg.Http.error(e)

    def quote(self, req, fx, today=None):
        """req: from (город в Китае), to (место прибытия в ЕАЭС), dest (пункт в РФ, необязательно), kind, kg, m3 (брутто),
        terms (условия поставки), extra {v, cur} (погрузка и экспорт в Китае), ins {v, cur} (страхование, если оплачено);
        fx — курсы ЦБ {CNY, USD, EUR, date}. Ответ: предложения экспедиторов с суммой к таможенной стоимости, участки по РФ
        отдельно, рыночный ориентир ATI.SU, предупреждения."""
        frm, to, dest, kind = self._key(req.get('from')), self._key(req.get('to')), self._key(req.get('dest')), req.get('kind')
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
                errors.append({'src': who, 'msg': 'ставка %s — укажите %s' % (self.UNITS[r['unit']], 'вес брутто, кг' if r['unit'] == 'kg' else 'объём, м³')})
                continue
            rate = 1.0 if r['cur'] == 'RUB' else lg.number((fx or {}).get(r['cur']))
            if not rate:
                errors.append({'src': who, 'msg': 'нет курса ЦБ для %s — повторите позже' % r['cur']})
                continue
            amount = r['price'] * mul
            how = '%s %s %s' % (self.fmt(r['price']), r['cur'], self.UNITS[r['unit']]) + ('' if r['unit'] == 'trip' else ' × %s' % self.fmt(mul))
            g = groups.setdefault((who, scope, self._key(r.get('to'))), {'src': who, 'scope': scope, 'amount': 0, 'cur': r['cur'], 'rate': rate, 'how': [],
                                                                       'days': r.get('days'), 'until': r.get('until') or '', 'note': r.get('note') or '', 'min': 0,
                                                                       'ref': bool(r.get('ref')), 'url': r.get('src') or ''})
            if g['cur'] != r['cur']:
                errors.append({'src': who, 'msg': 'ставки одного экспедитора на один участок — в разных валютах; оставьте одну валюту'})
                continue
            # сборный груз: за кг и за м³ — берётся большее (как считают экспедиторы), не меньше минимальной суммы
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
                warn.append('ориентир по открытым данным, а не ставка экспедитора по договору — для таможенной стоимости запросите ставку с выделенным участком до места прибытия')
            if g['until'] and g['until'] < today:
                warn.append('ставка просрочена (действовала до %s) — запросите у экспедитора новую' % '.'.join(reversed(g['until'].split('-'))))
            if g['min'] and g['min'] >= g['amount']:
                g['how'].append('минимальная сумма %s %s' % (self.fmt(g['min']), g['cur']))
            o = {'src': g['src'], 'scope': g['scope'], 'rub': rub, 'amount': round(amount, 2), 'cur': g['cur'], 'days': g['days'], 'until': g['until'],
                 'note': '; '.join(g['how'] + ([g['note']] if g['note'] else [])), 'warn': warn, 'ref': g['ref'], 'srcUrl': g['url']}
            if g['scope'] == 'after':
                o['warn'].append('в таможенную стоимость не входит, только если эта сумма выделена в договоре и подтверждена счётом (ТК ЕАЭС ст. 40 п. 2)')
                after.append(o)
                continue
            if g['scope'] == 'through':
                o['warn'].append('сквозная ставка одной суммой: вся сумма войдёт в таможенную стоимость; чтобы исключить участок по РФ — '
                                 'попросите экспедитора выделить его в договоре и счёте (ТК ЕАЭС ст. 40 п. 2)')
            if mkt and mkt['rub'] and g['scope'] == 'border' and dev:
                d = (rub - mkt['rub']) / float(mkt['rub']) * 100
                if abs(d) > dev:
                    o['warn'].append('%s рынка на %d %% (ATI.SU %s ₽) — проверьте ставку' % ('дороже' if d > 0 else 'дешевле', round(abs(d)), self.fmt(mkt['rub'])))
            o['cv'] = round((rub if add_freight else 0) + extra + ins)
            o['cvParts'] = [p for p in ((('перевозка ' + ('сквозная (целиком)' if g['scope'] == 'through' else 'до места прибытия'), rub) if add_freight else None), (('расходы в Китае', round(extra)) if extra else None),
                                        (('страхование', round(ins)) if ins else None)) if p]
            offers.append(o)
        if mkt_err:
            errors.append({'src': 'ATI.SU', 'msg': mkt_err, 'skip': True})
        if not offers and not [e for e in errors if not e.get('skip')]:
            errors.append({'src': 'Ставки экспедиторов', 'msg': 'для этого маршрута и вида перевозки ставок нет — добавьте их в таблицу ниже'})
        offers.sort(key=lambda o: -o['cv'])
        note = {'EXW': 'к цене контракта добавляются перевозка до места прибытия, расходы в Китае и страхование (если оплачено)',
                'FCA': 'к цене контракта добавляются перевозка от передачи перевозчику до места прибытия и страхование (если оплачено)',
                'FOB': 'к цене контракта добавляются фрахт от порта отгрузки до места прибытия и страхование (если оплачено)',
                'CPT': 'перевозка до места прибытия уже в цене контракта — к ней добавляется только страхование, если его оплатил покупатель',
                'CIP': 'перевозка и страхование до места прибытия уже в цене контракта — ничего не добавляется',
                'DAP_RU': 'перевозка до пункта в РФ уже в цене контракта; участок по РФ можно вычесть из таможенной стоимости, только если он '
                          'выделен в контракте и подтверждён документами (ТК ЕАЭС ст. 40 п. 2)'}[terms]
        return {'offers': offers, 'after': after, 'market': mkt, 'errors': errors, 'terms': t_name, 'termsNote': note, 'extra': round(extra), 'ins': round(ins),
                'dev': dev, 'kz': 'казахстан' in str(req.get('to') or '').lower(),
                'fx': {k: (fx or {}).get(k) for k in ('USD', 'CNY', 'EUR', 'date')}}

    @staticmethod
    def fmt(v):
        s = '{:,.2f}'.format(v).replace(',', ' ')
        return s[:-3] if s.endswith('.00') else s.replace('.', ',')
