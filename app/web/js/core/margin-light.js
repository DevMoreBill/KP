import { DefRegistry } from './defaults.js';

/** «Светофор маржи» («Значения программы → Экономика сделки»): пороги, %, и цвет маржинальности. */
export class MarginLight {
  static RED = 10;
  static YELLOW = 20;

  /**
   * Красный порог маржинальности, %.
   * @returns {number}
   */
  static red() {
    return DefRegistry.num('deal.marginRed', this.RED);
  }

  /**
   * Цвет маржинальности по порогам «Светофора маржи».
   * @param {number} margin маржинальность, %
   * @returns {'neg'|'warn'|'pos'|''}
   */
  static tone(margin) {
    if (margin == null || !Number.isFinite(margin)) return '';
    if (margin < this.red()) return 'neg';
    return margin < DefRegistry.num('deal.marginYellow', this.YELLOW) ? 'warn' : 'pos';
  }
}
