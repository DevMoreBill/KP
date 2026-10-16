# -*- coding: utf-8 -*-
"""Доставка оборудования из Китая до границы РФ — только для администратора («Настройки → Расчёты и нормы → Доставка
из Китая»); в «Экономику сделки» не попадает. Открытого бесплатного API расчёта Китай → РФ
у перевозчиков нет, поэтому два источника:
  1) ATI.SU «Средние ставки» (тот же ключ, что для доставки по России): направления, у которых город отправления
     в справочнике ATI.SU — «…, Китай»; кузов: тент 20 т, контейнеровоз (docker), трал (негабарит);
  2) ставки экспедиторов, которые вписывает администратор (из их коммерческих предложений): маршрут, вид перевозки,
     ставка в USD / CNY / EUR / RUB за рейс (контейнер), за кг или за м³ — в рубли по курсу ЦБ."""
import re
from datetime import datetime

import logistics_api as lg


class ChinaFreight:
    KV = 'chinaRates'
    KINDS = {'ftl': 'Фура 20 т (тент)', 'docker': 'Контейнер (контейнеровоз)', 'tral': 'Негабарит (трал)', 'ltl': 'Сборный груз'}
    UNITS = {'trip': 'за рейс / контейнер', 'kg': 'за кг', 'm3': 'за м³'}
    CURS = ('USD', 'CNY', 'EUR', 'RUB')
    # пункты пропуска на границе с Китаем (авто / ж.-д.) — подсказка в поле «Куда»
    BORDERS = ('Забайкальск', 'Пограничный', 'Благовещенск', 'Краскино', 'Нижнеленинское', 'Кяхта')
    ATI_CAR = {'ftl': ('tent', 20), 'docker': ('docker', 20), 'tral': ('tral', 20)}
    CN = re.compile(r'китай|кнр', re.I)
    MAX_ROWS = 300

    def __init__(self, store):
        self.store = store

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

    def save_rates(self, rows, by=''):
        if not isinstance(rows, list) or len(rows) > self.MAX_ROWS:
            raise ValueError('Ставки экспедиторов: нужен список до %d строк' % self.MAX_ROWS)
        out = []
        for i, r in enumerate(rows, 1):
            if not isinstance(r, dict):
                raise ValueError('Ставки экспедиторов: строка %d — неверный формат' % i)
            try:
                price = float(str(r.get('price', '')).replace(',', '.').replace(' ', ''))
            except ValueError:
                price = 0
            if not 0 < price <= 1e9:
                raise ValueError('Строка %d: ставка — число больше нуля' % i)
            kind, unit, cur = r.get('kind'), r.get('unit') or 'trip', r.get('cur') or 'USD'
            if kind not in self.KINDS or unit not in self.UNITS or cur not in self.CURS:
                raise ValueError('Строка %d: выберите вид перевозки, единицу и валюту из списка' % i)
            days = str(r.get('days') or '').strip()
            if days and not (days.isdigit() and int(days) <= 365):
                raise ValueError('Строка %d: срок — целое число дней до 365' % i)
            out.append({'from': self._text(r.get('from'), 'Откуда', 80), 'to': self._text(r.get('to'), 'Куда', 80), 'kind': kind,
                        'unit': unit, 'price': price, 'cur': cur, 'days': int(days) if days else None,
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
        out = {'kinds': self.KINDS, 'units': self.UNITS, 'curs': list(self.CURS), 'borders': list(self.BORDERS), 'ati': bool(self.ati_on()),
               'rates': self.rates(), 'directions': []}
        if out['ati']:
            try:
                out['directions'] = [{'from': d['from'], 'to': d['to']} for d in self.directions()]
            except Exception as e:
                out['atiError'] = lg.Http.error(e)
        return out

    # ---------- расчёт
    def quote(self, req, fx):
        """req: from, to, kind, kg, m3; fx — курсы ЦБ {USD, CNY, EUR, date}. Ответ: предложения в рублях и ошибки по источникам."""
        frm, to, kind = lg.cnorm(req.get('from')), lg.cnorm(req.get('to')), req.get('kind')
        if not frm or not to or kind not in self.KINDS:
            raise ValueError('Укажите, откуда и куда, и вид перевозки')
        qty = {'kg': lg.number(req.get('kg')) or 0, 'm3': lg.number(req.get('m3')) or 0}
        offers, errors = [], []
        if kind in self.ATI_CAR:
            if not self.ati_on():
                errors.append({'src': 'ATI.SU', 'msg': 'нет ключа ATI.SU («Внешние сервисы → Ключи API») или ATI.SU выключен'})
            else:
                try:
                    ds = [d for d in self.directions() if lg.cnorm(d['from']) == frm and lg.cnorm(d['to']) == to]
                    if not ds:
                        raise ValueError('направления %s → %s нет в «Средних ставках» ATI.SU — выберите город из подсказки' % (req.get('from'), req.get('to')))
                    car, ton = self.ATI_CAR[kind]
                    p = lg.Ati.price(self.store, ds[0], car, ton)
                    offers.append({'src': 'ATI.SU «Средние ставки»', 'rub': round(p['upperRub'] or 0), 'avgRub': round(p['avgRub'] or 0) if p['avgRub'] else None,
                                   'note': 'верхняя граница средних ставок за %d дн., %s %s т, с НДС%s' % (lg.LtlLimits.ati_days(self.store), self.KINDS[kind].split(' (')[0].lower(), ton,
                                                                                                        ', %s ₽/км' % '{:,.0f}'.format(p['upperKm']).replace(',', ' ') if p['upperKm'] else '')})
                except Exception as e:
                    errors.append({'src': 'ATI.SU', 'msg': lg.Http.error(e)})
        for r in self.rates().get('rows') or []:
            if r.get('kind') != kind or lg.cnorm(r.get('from')) != frm or lg.cnorm(r.get('to')) != to:
                continue
            mul = 1 if r['unit'] == 'trip' else qty[r['unit']]
            if not mul:
                errors.append({'src': r.get('who') or 'Ставка экспедитора', 'msg': 'ставка %s — укажите %s' % (self.UNITS[r['unit']], 'вес, кг' if r['unit'] == 'kg' else 'объём, м³')})
                continue
            rate = 1.0 if r['cur'] == 'RUB' else lg.number((fx or {}).get(r['cur']))
            if not rate:
                errors.append({'src': r.get('who') or 'Ставка экспедитора', 'msg': 'нет курса ЦБ для %s — повторите позже' % r['cur']})
                continue
            amount = r['price'] * mul
            offers.append({'src': r.get('who') or 'Ставка экспедитора', 'rub': round(amount * rate), 'amount': round(amount, 2), 'cur': r['cur'],
                           'days': r.get('days'), 'note': '%s %s %s%s' % ('{:,.2f}'.format(r['price']).replace(',', ' ').replace('.00', ''), r['cur'], self.UNITS[r['unit']],
                                                                          ('; ' + r['note']) if r.get('note') else '')})
        if not offers and not errors:
            errors.append({'src': 'Ставки экспедиторов', 'msg': 'для этого маршрута и вида перевозки ставок нет — добавьте их в таблицу ниже'})
        offers.sort(key=lambda o: -o['rub'])
        return {'offers': offers, 'errors': errors, 'fx': {k: (fx or {}).get(k) for k in ('USD', 'CNY', 'EUR', 'date')}}
