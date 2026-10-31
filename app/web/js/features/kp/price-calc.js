import { FEAT } from '../../core/features.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpState, S } from '../../core/state.js';
import { Currency } from '../../core/currency.js';

/** Цена продажи по закупке и марже (подстановка модели из каталога без цены); округление цен КП. */
export class PriceCalc {
  static KOPECKS = 100;
  static PERCENT = 100;
  static MARGIN_MAX = 0.99;

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
    return S.pricing.costNoVat ? value * (1 + KpEconomics.supVat() / this.PERCENT) : value;
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
   * НДС поставщика, % («Значения программы» → deal.supVat) — одно место для КП, проверки цен и экономики сделки.
   * @returns {number}
   */
  static supVat() {
    return DefRegistry.num('deal.supVat', this.SUP_VAT);
  }

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
    const opts = this._options(items, { pricing, rate, cur });
    const cost =
      withCost.reduce((sum, item) => sum + unitCost(item) * (+item.qty || 0), 0) +
      opts.reduce((sum, row) => sum + row.cost, 0);
    const sale =
      withCost.reduce((sum, item) => sum + KPGen.netPrice(item) * (+item.qty || 0), 0) +
      opts.reduce((sum, row) => sum + row.sale, 0);
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

  // опции и услуги с закупкой (выключатель optCost): закупка и продажа — за всё количество
  static _options(items, ctx) {
    if (!FEAT.on('optCost')) return [];
    return items
      .flatMap(item => item.options || [])
      .filter(option => option.name && option.cost > 0 && !option.askPrice)
      .map(option => ({
        cost: (this._unitCost(option, ctx) || 0) * (+option.qty || 0),
        sale: (option.price || 0) * (+option.qty || 0),
      }));
  }

  static _rate(pricing, code) {
    return !code || code === 'RUB' ? 1 : Currency.parseRate((pricing.rates || {})[code]);
  }

  static _line(item) {
    return { qty: +item.qty || 0, price: item.price || 0, disc: item.disc, options: KpState.pricedOptions(item) };
  }

  /**
   * Закупка единицы позиции в валюте КП, как в экономике (с НДС поставщика при «закупке без НДС»); нет закупки — null.
   * @param {object} item позиция КП
   * @param {object} [state] состояние КП
   * @returns {number | null}
   */
  static unitCost(item, state = S) {
    const pricing = state.pricing || {};
    const rate = code => this._rate(pricing, code);
    return this._unitCost(item, { pricing, rate, cur: pricing.cur || 'RUB' });
  }

  static _unitCost(item, { pricing, rate, cur }) {
    if (!item.cost) return null;
    const value = (item.cost * rate(item.costCur || 'RUB')) / rate(cur);
    return pricing.costNoVat ? value * (1 + this.supVat() / this.PERCENT) : value;
  }
}
