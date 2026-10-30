import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { IncomeTax } from '../../core/income-tax.js';
import { SellerTax } from '../../core/seller-tax.js';

/**
 * Продавец сделки — наше юрлицо из «Наших реквизитов» (по умолчанию основное): его налогообложение определяет, есть ли
 * вычет входного НДС («НДС продавца») и каким налогом облагается результат сделки (налог на прибыль или УСН).
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
   * Продавец сделки: свой выбор, иначе основное юрлицо; режим — по его «НДС продавца» и «Налогу на прибыль или УСН» на сейчас.
   * @param {object} deal
   */
  static sync(deal) {
    if (this.failed || !FEAT.on('sellerTax')) return;
    const items = this.own.items || [];
    const entity = items.find(item => item.id === deal.seller) || items.find(item => item.id === this.own.main) || {};
    deal.seller = String(entity.id || '');
    deal.sellerVat = String(entity.vat || '');
    deal.sellerUsn = IncomeTax.mode(entity.usn);
    deal.sellerUsnRate = deal.sellerUsn ? String(entity.usnRate || '') : '';
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
   * Налог продавца с результата сделки: «income», «profit» (УСН) или '' — налог на прибыль; выключено — как при ОСНО.
   * @param {object|null} deal
   * @returns {string}
   */
  static usnOf(deal) {
    return FEAT.on('sellerTax') && deal ? IncomeTax.mode(deal.sellerUsn) : '';
  }

  /**
   * Своя ставка УСН продавца (текст поля юрлица; пусто — по закону).
   * @param {object|null} deal
   * @returns {string}
   */
  static usnRateOf(deal) {
    return this.usnOf(deal) ? String(deal.sellerUsnRate || '') : '';
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
   * Подпись режима продавца: НДС и налог с результата (при УСН — объект и ставка).
   * @param {object} deal
   * @returns {string}
   */
  static label(deal) {
    const usn = this.usnOf(deal);
    const tax = IncomeTax.of(usn).short;
    return `${SellerTax.label(this.vatOf(deal))} · ${usn ? `${tax} ${IncomeTax.rate(usn, this.usnRateOf(deal))} %` : tax}`;
  }
}
