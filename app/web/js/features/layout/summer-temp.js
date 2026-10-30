import { StationRules } from '../rules/station-rules.js';

/**
 * Температура летом для расчётов станции: наружная (вентиляция) — одно значение; воздух помещения станции (на всасывании
 * компрессора — перевод в FAD, у осушителя) — наружная + нагрев в контейнере heat.vent_dt.
 */
export class SummerTemp {
  static RULE = 'heat.t_summer';
  static ROOM_RULE = 'heat.vent_dt';

  /**
   * Из требований станции, иначе правило heat.t_summer.
   * @param {number|null} tmax температура из требований, °C
   * @returns {number}
   */
  static of(tmax) {
    return Number.isFinite(tmax) ? tmax : StationRules.raw(this.RULE);
  }

  /**
   * Воздух помещения станции летом: наружная + нагрев в контейнере при расчётной вентиляции.
   * @param {number|null} tmax температура из требований, °C
   * @returns {number}
   */
  static room(tmax) {
    return this.of(tmax) + StationRules.raw(this.ROOM_RULE);
  }
}
