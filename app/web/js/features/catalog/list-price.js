import { Currency } from '../../core/currency.js';

/** Цена позиции в списке каталога, аналогах и сравнении: цена, иначе закупка, иначе «без цены». */
export class ListPrice {
  /**
   * Цена в списке: цена, иначе закупка, иначе «без цены».
   * @param {object} card
   * @returns {string}
   */
  static html(card) {
    if (card.price) return `${KPGen.money(card.price)} ${Currency.short(card.priceCur || 'RUB')}`;
    if (card.cost) return `<small>закупка</small>${KPGen.money(card.cost)} ${Currency.short(card.costCur || 'RUB')}`;
    return '<small>без цены</small>';
  }
}
