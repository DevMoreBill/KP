import { FEAT } from '../../core/features.js';
import { KpState, S } from '../../core/state.js';
import { Price } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { CbrRates } from './cbr-rates.js';
import { Currency } from './currency.js';
import { KpForm } from '../../core/kp-form.js';
import { Money } from '../../core/money.js';
import { DealLink } from '../../core/deal-link.js';

/**
 * Цена продажи опции или услуги в своей валюте (option.sale, option.saleCur), как закупка. В КП, итоги, документ и
 * экономику идёт option.price — в валюте КП по курсу; валюта продажи = валюте КП — option.price вписан напрямую.
 */
export class OptionSale {
  /**
   * Валюта цены продажи опций (выключатель optSaleCur).
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('optSaleCur');
  }

  /**
   * Валюта цены продажи опции.
   * @param {object} option
   * @returns {string}
   */
  static cur(option) {
    return (this.enabled() && option.saleCur) || Currency.current();
  }

  /**
   * Цена продажи в другой валюте, чем КП.
   * @param {object} option
   * @returns {boolean}
   */
  static foreign(option) {
    return this.cur(option) !== Currency.current();
  }

  /**
   * Цена за единицу в валюте продажи, копейки.
   * @param {object} option
   * @returns {number}
   */
  static amount(option) {
    return this.foreign(option) ? option.sale || 0 : option.price || 0;
  }

  /**
   * Текст поля цены (недописанное — как вписано).
   * @param {object} option
   * @returns {string}
   */
  static text(option) {
    const amount = this.amount(option);
    return option._priceText ?? (amount ? KPGen.money(amount) : '');
  }

  /**
   * Поле цены продажи; с валютой — как поле закупки.
   * @param {number} i позиция КП
   * @param {number} j опция
   * @param {object} option
   * @returns {string}
   */
  static field(i, j, option) {
    const text = this.text(option);
    const input = `<input type="text" inputmode="decimal" class="num${Number.isNaN(Price.parse(text)) ? ' bad' : ''}" data-oprice="${i}.${j}" value="${esc(text)}" placeholder="включено" aria-label="Цена продажи за единицу">`;
    if (!this.enabled()) return `<span class="opt-sale">${input}</span>`;
    const cur = this.cur(option);
    const curs = Money.CURS.map(code => `<option${cur === code ? ' selected' : ''}>${code}</option>`).join('');
    return `<span class="opt-cost opt-sale">${input}<select data-osalecur="${i}.${j}" aria-label="Валюта цены продажи">${curs}</select></span>`;
  }

  /**
   * Сумма опции в валюте КП; цена в другой валюте — с пометкой валюты КП.
   * @param {object} option
   * @returns {string}
   */
  static sum(option) {
    if (!option.price) return this.foreign(option) && option.sale ? 'нет курса' : '—';
    const money = KPGen.money((+option.qty || 0) * option.price);
    return this.foreign(option) ? `${money} ${Currency.short(Currency.current())}` : money;
  }

  /**
   * Вписанная цена за единицу (копейки, в валюте продажи) → цена в КП.
   * @param {object} option
   * @param {number} amount
   */
  static set(option, amount) {
    if (this.foreign(option)) {
      option.sale = amount;
      this.sync(option);
      return;
    }
    option.price = amount;
    delete option.sale;
  }

  /**
   * Цена в валюте КП из цены в валюте продажи по курсам КП; курса нет — 0 (КП попросит курс).
   * @param {object} option
   */
  static sync(option) {
    if (!this.foreign(option)) {
      if (option.saleCur && option.sale != null) option.price = option.sale;
      delete option.sale;
      return;
    }
    const from = Currency.rate(this.cur(option));
    const into = Currency.rate(Currency.current());
    option.price = from > 0 && into > 0 ? Math.round(((option.sale || 0) * from) / into) : 0;
  }

  /** Перед сменой валюты КП: цена опций с выбранной валютой запоминается в этой валюте. */
  static pin() {
    for (const item of S.items)
      for (const option of item.options || []) if (option.saleCur) option.sale = this.amount(option);
  }

  /** Курс или валюта КП изменились — пересчитать опции с ценой в другой валюте. */
  static syncAll() {
    for (const item of S.items) for (const option of item.options || []) if (option.saleCur) this.sync(option);
  }

  /**
   * Валюты цен продажи опций — для курсов ЦБ.
   * @param {object[]} items
   * @returns {string[]}
   */
  static currencies(items) {
    if (!this.enabled()) return [];
    return items.flatMap(item =>
      (item.options || []).filter(option => option.saleCur && option.sale).map(option => option.saleCur),
    );
  }

  /** Выбор валюты цены продажи — в карточке позиции и в «Цене и валюте». */
  static listen() {
    document.addEventListener('change', event => this._currency(event.target));
  }

  static _currency(field) {
    if (!field.dataset || field.dataset.osalecur == null) return;
    const [i, j] = field.dataset.osalecur.split('.').map(Number);
    const option = S.items[i] && S.items[i].options && S.items[i].options[j];
    if (!option) return;
    const amount = this.amount(option);
    option.saleCur = field.value;
    delete option._priceText;
    this.set(option, amount);
    if (field.value !== 'RUB' && !(Currency.rate(field.value) > 0)) CbrRates.fillEmpty();
    KpState.persist();
    KpForm.render();
    DealLink.render();
  }
}
