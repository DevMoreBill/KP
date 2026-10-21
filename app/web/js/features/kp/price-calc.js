import { Currency } from './currency.js';
import { DefRegistry } from '../../core/defaults.js';
import { S } from '../../core/state.js';

/** Цена продажи по закупке и марже (подстановка модели из каталога без цены); округление цен КП. */
export class PriceCalc {
  static KOPECKS = 100;
  static PERCENT = 100;
  static MARGIN_MAX = 0.99;
  static SUP_VAT = 22;

  /**
   * Округление цены (копейки) по шагу «Округление цен» КП.
   * @param {number} kopecks
   * @returns {number}
   */
  static round(kopecks) {
    const step = Math.round(parseFloat(S.pricing.round || '0.01') * this.KOPECKS) || 1;
    return Math.round(kopecks / step) * step;
  }

  static _margin(item) {
    if (item.margin == null || item.margin === '') return null;
    const value = parseFloat(String(item.margin).replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  static _mode(item) {
    return item.mmode === 'markup' ? 'markup' : 'margin';
  }

  // себестоимость единицы в валюте КП, копейки (с НДС): цена поставщика без НДС → с НДС по ставке поставщика
  static _cost(item) {
    if (!item.cost) return null;
    const from = Currency.rate(item.costCur || 'RUB');
    const rateTo = Currency.rate(Currency.current());
    if (!(from > 0 && rateTo > 0)) return NaN;
    const value = (item.cost * from) / rateTo;
    return S.pricing.costNoVat ? value * (1 + DefRegistry.num('deal.supVat', this.SUP_VAT) / this.PERCENT) : value;
  }

  static _price(item) {
    const cost = this._cost(item);
    if (cost == null || Number.isNaN(cost)) return cost;
    const percent = this._margin(item);
    if (percent == null) return null;
    const share = percent / this.PERCENT;
    let value = NaN;
    if (this._mode(item) === 'markup') value = cost * (1 + share);
    else if (share < this.MARGIN_MAX) value = cost / (1 - share);
    return Number.isNaN(value) ? NaN : this.round(value);
  }

  /**
   * Цена по закупке и марже — в позицию (ручная цена не меняется).
   * @param {object} item
   */
  static apply(item) {
    if (item.priceManual || !item.cost || this._margin(item) == null) return;
    const price = this._price(item);
    if (price > 0) {
      item.price = price;
      delete item._priceText;
    }
  }
}

/**
 * Экономика КП по состоянию (текущего S или сохранённого в журнале): итог, закупка, прибыль, маржа — по позициям с
 * указанной закупкой; курсы — сохранённые в КП.
 */
export class KpEconomics {
  static PERCENT = 100;
  static SUP_VAT = 22;

  /**
   * Экономика КП.
   * @param {object} [state] состояние КП
   * @returns {object} {cur, sum, vat, discount, sumRub, withCost, positions, cost, sale, profit, margin, markup}
   */
  static of(state = S) {
    const pricing = state.pricing || {};
    const cur = pricing.cur || 'RUB';
    const rate = code => this._rate(pricing, code);
    const items = state.items || [];
    const total = KPGen.totals(
      items.map(item => this._line(item)),
      +state.vat || 0,
    );
    const unitCost = item => this._unitCost(item, { pricing, rate, cur });
    const withCost = items.filter(item => unitCost(item) > 0);
    const cost = withCost.reduce((sum, item) => sum + unitCost(item) * (+item.qty || 0), 0);
    const sale = withCost.reduce((sum, item) => sum + KPGen.netPrice(item) * (+item.qty || 0), 0);
    const kpRate = cur !== 'RUB' && rate(cur) > 0 ? rate(cur) : null;
    return {
      cur,
      sum: total.sum,
      vat: total.vat,
      discount: total.discount || 0,
      sumRub: kpRate ? Math.round(total.sum * kpRate) : null,
      withCost: withCost.length,
      positions: items.length,
      cost: Math.round(cost),
      sale: Math.round(sale),
      profit: Math.round(sale - cost),
      margin: sale ? ((sale - cost) / sale) * this.PERCENT : null,
      markup: cost ? ((sale - cost) / cost) * this.PERCENT : null,
    };
  }

  static _rate(pricing, code) {
    if (!code || code === 'RUB') return 1;
    const value = parseFloat(
      String((pricing.rates || {})[code] || '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
    return value > 0 ? value : NaN;
  }

  static _line(item) {
    const options = (item.options || [])
      .filter(option => option.name)
      .map(option => ({ qty: +option.qty || 0, price: option.price || 0 }));
    return { qty: +item.qty || 0, price: item.price || 0, disc: item.disc, options };
  }

  static _unitCost(item, { pricing, rate, cur }) {
    if (!item.cost) return null;
    const value = (item.cost * rate(item.costCur || 'RUB')) / rate(cur);
    return pricing.costNoVat ? value * (1 + DefRegistry.num('deal.supVat', this.SUP_VAT) / this.PERCENT) : value;
  }
}
