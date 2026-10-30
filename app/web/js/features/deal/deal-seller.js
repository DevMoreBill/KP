import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { SellerTax } from '../../core/seller-tax.js';

/**
 * Продавец сделки — наше юрлицо из «Наших реквизитов» (по умолчанию основное): его налогообложение («НДС продавца»)
 * определяет, есть ли вычет входного НДС в расчёте.
 */
export class DealSeller {
  static EMPTY = { items: [], main: '' };
  static own = DealSeller.EMPTY;
  static failed = false;

  /** Юрлица — при открытии экономики; не загрузились — выбор в сделке не трогается. */
  static async load() {
    if (!FEAT.on('sellerTax')) return;
    try {
      this.own = (await Api.request('/api/requisites')) || this.EMPTY;
      this.failed = false;
    } catch {
      this.failed = true;
    }
  }

  /**
   * Продавец сделки: свой выбор, иначе основное юрлицо; режим — по его «НДС продавца» на сейчас.
   * @param {object} deal
   */
  static sync(deal) {
    if (this.failed || !FEAT.on('sellerTax')) return;
    const items = this.own.items || [];
    const entity = items.find(item => item.id === deal.seller) || items.find(item => item.id === this.own.main);
    deal.seller = entity ? entity.id : '';
    deal.sellerVat = entity ? String(entity.vat || '') : '';
  }

  /**
   * Выбрать продавца.
   * @param {object} deal
   * @param {string} id
   */
  static choose(deal, id) {
    deal.seller = String(id || '');
    this.sync(deal);
  }

  /**
   * «НДС продавца» для расчёта; функция выключена — как при ОСНО (вычет).
   * @param {object|null} deal
   * @returns {string}
   */
  static vatOf(deal) {
    return FEAT.on('sellerTax') && deal ? String(deal.sellerVat || '') : '';
  }

  /**
   * Юрлицо продавца сделки или null.
   * @param {object} deal
   * @returns {object|null}
   */
  static entity(deal) {
    return (this.own.items || []).find(item => item.id === deal.seller) || null;
  }

  /**
   * Подпись режима продавца.
   * @param {object} deal
   * @returns {string}
   */
  static label(deal) {
    return SellerTax.label(this.vatOf(deal));
  }
}
