import { FEAT } from '../../core/features.js';
import { KpState, S } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { DealTerms } from '../deal/deal-terms.js';
import { DealWin } from '../deal/deal-win.js';
import { InputNum } from '../deal/input-num.js';
import { CbrRates } from './cbr-rates.js';
import { Currency } from './currency.js';

/**
 * Закупка опций и услуг позиции: цена за единицу и валюта. Одно поле — в «Опциях и услугах» позиции и в закупке
 * «Экономики сделки» (data-optcost / data-optcur «позиция.опция»); в документ КП закупка не попадает.
 */
export class OptionCost {
  static KOPECKS = 100;

  /**
   * Учитывать закупку опций (выключатель optCost).
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('optCost');
  }

  /**
   * Текст поля закупки (недописанное — как вписано).
   * @param {object} option
   * @returns {string}
   */
  static text(option) {
    return option._costText ?? (option.cost ? KPGen.money(option.cost) : '');
  }

  /**
   * Поле закупки с валютой.
   * @param {number} i позиция КП
   * @param {number} j опция
   * @param {object} option
   * @returns {string}
   */
  static field(i, j, option) {
    const text = this.text(option);
    const bad = Number.isNaN(InputNum.parse(text)) ? ' bad' : '';
    const curs = DealTerms.CURS.map(
      code => `<option${(option.costCur || 'RUB') === code ? ' selected' : ''}>${code}</option>`,
    ).join('');
    return `<span class="opt-cost"><input type="text" inputmode="decimal" class="num${bad}" data-optcost="${i}.${j}" value="${esc(text)}" placeholder="закупка" aria-label="Закупка за единицу"><select data-optcur="${i}.${j}" aria-label="Валюта закупки">${curs}</select></span>`;
  }

  /**
   * Валюты закупки опций — для курсов ЦБ.
   * @param {object[]} items
   * @returns {string[]}
   */
  static currencies(items) {
    if (!this.enabled()) return [];
    return items.flatMap(item =>
      (item.options || []).filter(option => option.cost).map(option => option.costCur || 'RUB'),
    );
  }

  /** Ввод, уход с поля и выбор валюты — в форме КП и в экономике сделки. */
  static listen() {
    document.addEventListener('input', event => this._input(event.target));
    document.addEventListener('focusout', event => this._leave(event.target));
    document.addEventListener('change', event => this._currency(event.target));
  }

  static _of(key) {
    const [i, j] = String(key).split('.').map(Number);
    const item = S.items[i];
    const option = item && item.options && item.options[j];
    return option || null;
  }

  static _input(field) {
    if (!field.dataset || field.dataset.optcost == null) return;
    const option = this._of(field.dataset.optcost);
    if (!option) return;
    const cost = InputNum.parse(field.value);
    option._costText = field.value;
    field.classList.toggle('bad', Number.isNaN(cost));
    if (!Number.isNaN(cost)) option.cost = cost == null ? 0 : Math.round(cost * this.KOPECKS);
    KpState.persist();
    if (field.closest('#dealdlg')) DealWin.render();
  }

  static _leave(field) {
    if (!field.dataset || field.dataset.optcost == null) return;
    const option = this._of(field.dataset.optcost);
    if (option && !Number.isNaN(InputNum.parse(option._costText))) delete option._costText;
    KpState.persist();
    DealWin.render();
  }

  static _currency(field) {
    if (!field.dataset || field.dataset.optcur == null) return;
    const option = this._of(field.dataset.optcur);
    if (!option) return;
    option.costCur = field.value;
    if (field.value !== 'RUB' && !(Currency.rate(field.value) > 0)) CbrRates.fillEmpty();
    KpState.persist();
    DealWin.render();
  }
}
