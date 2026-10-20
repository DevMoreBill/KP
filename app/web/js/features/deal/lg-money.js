import { DealTerms } from './deal-terms.js';
import { InputNum } from './input-num.js';
import { LgValues } from './lg-values.js';

/**
 * «Своя сумма» доставки по России — в рублях или валюте: sup.logRu = {v, cur}; в рубли переводит расчёт сделки по курсу ЦБ
 * из «Цены КП» (или своему курсу расчёта). «По расчёту» пишет рубли без валюты (src: 'module'). Последняя валюта —
 * sup.lg.manCur.
 */
export class LgMoney {
  static RATE_DIGITS = 10000;

  /**
   * Валюта своей суммы.
   * @param {object} sup
   * @returns {string}
   */
  static cur(sup) {
    const own = sup.logRu || {};
    if (own.cur) return DealTerms.CURS.includes(own.cur) ? own.cur : 'RUB';
    // сумма прежних версий и «по расчёту» — в рублях
    if (String(own.v ?? '').trim() !== '') return 'RUB';
    const last = (sup.lg && sup.lg.manCur) || LgValues.manCur();
    return DealTerms.CURS.includes(last) ? last : 'RUB';
  }

  /**
   * Сменить валюту своей суммы.
   * @param {object} sup
   * @param {string} cur
   */
  static setCur(sup, cur) {
    if (!DealTerms.CURS.includes(cur)) return;
    sup.lg = sup.lg || {};
    sup.lg.manCur = cur;
    sup.logRu = { v: (sup.logRu && sup.logRu.src !== 'module' && sup.logRu.v) || '', cur };
  }

  /**
   * Переход на «Своя сумма»: сумма расчёта остаётся (в рублях), иначе — пусто в валюте по умолчанию.
   * @param {object} sup
   */
  static toManual(sup) {
    const value = InputNum.parse(sup.logRu && sup.logRu.v);
    sup.logRu = value
      ? { v: String(Math.round(value)), cur: 'RUB' }
      : { v: '', cur: (sup.lg && sup.lg.manCur) || LgValues.manCur() };
  }

  /**
   * Срок в пути → «Доставка до заказчика».
   * @param {object} sup
   * @returns {boolean}
   */
  static setDays(sup) {
    const value = sup.lg && sup.lg.setDays;
    return value == null ? LgValues.setDays() : value !== false;
  }

  /**
   * Под полем: «= 92 500 ₽ · курс ЦБ на 14.10.2026: 1 USD = 92,5 ₽» или «нет курса …» с кнопкой.
   * @param {object} calc расчёт сделки
   * @param {object} cs поставщик в расчёте
   * @param {string} cur
   * @returns {string}
   */
  static rubNote(calc, customs, cur) {
    if (cur === 'RUB') return '';
    const rate = calc.rate(cur);
    const pricing = S.pricing || {};
    if (!(rate > 0)) {
      return `<small class="bad-t lg-rub">Нет курса ${esc(cur)} — <button type="button" class="lnk" data-dlx="cbr">загрузить курс ЦБ</button> или впишите его в «Цене КП»</small>`;
    }
    const when =
      calc.rateSrc[cur] === 'deal'
        ? 'курс расчёта'
        : `курс ЦБ${pricing.rateDate ? ` на ${esc(KPGen.ruDate(pricing.rateDate))}` : ''}`;
    const value = String(Math.round(rate * LgMoney.RATE_DIGITS) / LgMoney.RATE_DIGITS).replace('.', ',');
    return `<small class="muted lg-rub">= <b>${Fmt.rub(customs.Lru)}</b> · ${when}: 1 ${esc(cur)} = ${esc(value)} ₽</small>`;
  }
}
