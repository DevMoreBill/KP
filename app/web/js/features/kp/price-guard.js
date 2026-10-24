import { PriceHist } from './price-hints.js';
import { Currency } from './currency.js';
import { DealState } from '../deal/deal-state.js';
import { DealValues } from '../deal/deal-values.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { esc, isoDay } from '../../core/util.js';
import { S } from '../../core/state.js';
import { WorkCalendar } from '../../ui/date-picker.js';
import { KpEconomics } from './price-calc.js';
import { DefRegistry } from '../../core/defaults.js';

/** Проверка цен перед сохранением и отправкой КП: ниже закупки, маржа ниже красного порога, курс ЦБ старше суток. */
export class PriceGuard {
  static RATE_DAYS = 1;
  static DAY_MS = 86400000;
  static LOOK_BACK = 14; // самые длинные праздники — январские

  /**
   * Что не так с ценами текущего КП.
   * @returns {string[]}
   */
  static problems() {
    return [...this._belowCost(), ...this._margin(), ...this._rate()];
  }

  /**
   * Спросить менеджера, если есть замечания: true — продолжить, false — вернуться и исправить.
   * @param {string} action «Сохранить» / «Отправить»
   * @returns {Promise<boolean>}
   */
  static async confirm(action) {
    if (!FEAT.on('priceGuard')) return true;
    const found = this.problems();
    if (!found.length) return true;
    const rows = found.map(text => `<li>${esc(text)}</li>`).join('');
    const answer = await Modal.ask(`<h3>Проверьте цены</h3><ul class="pg-list">${rows}</ul>
      <div class="row"><button class="btn" type="button" data-v="0">Исправить</button><button class="btn primary" type="button" data-v="go">${esc(action)} всё равно</button></div>`);
    return answer === 'go';
  }

  static _cost(item) {
    const card = PriceHist.doc(item);
    if (!card || !(card.cost > 0)) return null;
    const cur = card.costCur || 'RUB';
    const kpCur = Currency.current();
    const value = cur === kpCur ? card.cost : this._convert(card.cost, cur, kpCur);
    return value == null ? null : Math.round(S.pricing.costNoVat ? value * (1 + this._supVat()) : value);
  }

  static _convert(amount, from, into) {
    const rateFrom = Currency.rate(from);
    const rateTo = Currency.rate(into);
    return rateFrom > 0 && rateTo > 0 ? (amount * rateFrom) / rateTo : null;
  }

  static _supVat() {
    return DefRegistry.num('deal.supVat', KpEconomics.SUP_VAT) / KpEconomics.PERCENT;
  }

  // закупка — как в экономике (позиция КП), иначе из карточки каталога; цена — после скидки позиции
  static _belowCost() {
    return S.items
      .filter(item => item.price > 0)
      .filter(item => {
        const cost = KpEconomics.unitCost(item) || this._cost(item);
        return cost != null && KPGen.netPrice(item) < cost;
      })
      .map(item => `«${item.name || 'позиция'}» — цена ниже закупки`);
  }

  // экономику не открывали — маржа по закупке позиций, как в «Цене КП»
  static _margin() {
    const sum = DealState.summary();
    const margin = sum ? this._dealMargin(sum) : KpEconomics.of().margin;
    if (margin == null || !Number.isFinite(margin)) return [];
    const red = DealValues.num('deal.marginRed', DealValues.MARGIN_RED);
    return margin < red ? [`Маржа ${Math.round(margin)} % — ниже порога ${red} %`] : [];
  }

  static _dealMargin(sum) {
    return sum.confirmed ? sum.margin : sum.marginLo;
  }

  // курс ЦБ устанавливается на рабочий день: в понедельник утром курс субботы ещё действует
  static _rate() {
    if (Currency.current() === 'RUB' || !S.pricing.rateDate) return [];
    return S.pricing.rateDate < this._lastWorkDay() ? ['Курс ЦБ устарел — обновите курс в «Ценах и валюте»'] : [];
  }

  static _lastWorkDay() {
    const day = new Date(Date.now() - this.RATE_DAYS * this.DAY_MS);
    for (let step = 0; step < this.LOOK_BACK && WorkCalendar.day(day).off; step++) day.setDate(day.getDate() - 1);
    return isoDay(day);
  }
}
