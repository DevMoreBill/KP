import { PriceHist } from './price-hints.js';
import { Currency } from './currency.js';
import { DealState } from '../deal/deal-state.js';
import { DealValues } from '../deal/deal-values.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { esc, isoDay } from '../../core/util.js';
import { S } from '../../core/state.js';

/** Проверка цен перед сохранением и отправкой КП: ниже закупки, маржа ниже красного порога, курс ЦБ старше суток. */
export class PriceGuard {
  static RATE_DAYS = 1;
  static DAY_MS = 86400000;

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
    if (cur === kpCur) return card.cost;
    const from = Currency.rate(cur);
    const rateTo = Currency.rate(kpCur);
    return from > 0 && rateTo > 0 ? Math.round((card.cost * from) / rateTo) : null;
  }

  static _belowCost() {
    return S.items
      .filter(item => item.price > 0)
      .filter(item => {
        const cost = this._cost(item);
        return cost != null && item.price < cost;
      })
      .map(item => `«${item.name || 'позиция'}» — цена ниже закупки`);
  }

  static _margin() {
    const sum = DealState.summary();
    const margin = sum && (sum.confirmed ? sum.margin : sum.marginLo);
    if (margin == null || !Number.isFinite(margin)) return [];
    const red = DealValues.num('deal.marginRed', DealValues.MARGIN_RED);
    return margin < red ? [`Маржа ${Math.round(margin)} % — ниже порога ${red} %`] : [];
  }

  static _rate() {
    if (Currency.current() === 'RUB' || !S.pricing.rateDate) return [];
    const border = isoDay(new Date(Date.now() - this.RATE_DAYS * this.DAY_MS));
    return S.pricing.rateDate < border ? ['Курс ЦБ старше суток — обновите курс в «Ценах и валюте»'] : [];
  }
}
