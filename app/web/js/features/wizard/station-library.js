import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';

/**
 * Типовые станции в окне новой станции: готовые требования (5, 10, 20 м³/мин; ДГУ 100–400 кВт; насосные) — одним нажатием
 * в поля «что нужно заказчику», дальше тот же подбор; менеджер поправляет числа под заказчика.
 */
export class StationLibrary {
  static LIST = {
    comp: [
      ['5 м³/мин · 8 бар', { flow: '5', pressure: '8' }],
      ['10 м³/мин · 8 бар', { flow: '10', pressure: '8' }],
      ['20 м³/мин · 8 бар', { flow: '20', pressure: '8' }],
      ['10 м³/мин · 10 бар', { flow: '10', pressure: '10' }],
    ],
    dgu: [
      ['100 кВт · 8 ч', { kw: '100', hours: '8' }],
      ['200 кВт · 8 ч', { kw: '200', hours: '8' }],
      ['400 кВт · 8 ч', { kw: '400', hours: '8' }],
    ],
    pump: [
      ['25 м³/ч · 40 м', { q: '25', head: '40' }],
      ['50 м³/ч · 40 м', { q: '50', head: '40' }],
      ['100 м³/ч · 50 м', { q: '100', head: '50' }],
    ],
  };

  /**
   * Строка типовых станций вида.
   * @param {string} kind comp | dgu | pump
   * @returns {string}
   */
  static html(kind) {
    const list = this.LIST[kind];
    if (!list || !FEAT.on('stLibrary')) return '';
    const chips = list
      .map(([label], index) => `<button class="chip" type="button" data-nslib="${index}">${esc(label)}</button>`)
      .join('');
    return `<div class="ns-lib"><span class="muted">Типовые:</span>${chips}</div>`;
  }

  /**
   * Требования типовой станции.
   * @param {string} kind
   * @param {number} index
   * @returns {object|null}
   */
  static req(kind, index) {
    const found = (this.LIST[kind] || [])[index];
    return found ? { ...found[1] } : null;
  }
}
