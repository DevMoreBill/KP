import { StationRules } from '../rules/station-rules.js';

/** Наружная температура летом для расчётов станции (перевод в FAD, осушитель, вентиляция) — одно значение. */
export class SummerTemp {
  static RULE = 'heat.t_summer';

  /**
   * Из требований станции, иначе правило heat.t_summer.
   * @param {number|null} tmax температура из требований, °C
   * @returns {number}
   */
  static of(tmax) {
    return Number.isFinite(tmax) ? tmax : StationRules.raw(this.RULE);
  }
}
