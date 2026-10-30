import { StationRules } from '../rules/station-rules.js';
/**
 * Воздушный ресивер — сосуд под давлением (ФНП ОРПД, ТР ТС 032/2013): на учёт в Ростехнадзоре, если p·V больше
 * vessel.pv (МПа·м³); давление — наибольшее рабочее на станции, без него — расчётное ресивера.
 */
export class PressureVessel {
  static EPS = 1e-9;

  /** Предел произведения давления на вместимость для подконтрольного сосуда. */
  static get LIMIT() {
    return StationRules.raw('vessel.pv');
  }

  /**
   * Произведение давления на вместимость, МПа·м³.
   * @param {number} bar
   * @param {number} litres
   * @returns {number}
   */
  static product(bar, litres) {
    return ((bar / 10) * litres) / 1000;
  }

  /**
   * Подлежит учёту в Ростехнадзоре: p·V больше предела vessel.pv — одно сравнение для списка, проверок и подбора.
   * @param {number} bar
   * @param {number} litres
   * @returns {boolean}
   */
  static registered(bar, litres) {
    return this.product(bar, litres) > this.LIMIT + this.EPS;
  }

  /**
   * Предел для текста: «1,0», «1,05» — без округления.
   * @returns {string}
   */
  static limitText() {
    const limit = this.LIMIT;
    return (Number.isInteger(limit) ? limit.toFixed(1) : String(limit)).replace('.', ',');
  }

  /**
   * Ресиверы состава: [{pos, qty, vol, mpa, pv, reg, out, rated}]; bar — рабочее давление станции (0 — неизвестно);
   * rated — паспортное давление, при котором сосуд подлежал бы учёту (без учёта — при уставке клапана не выше рабочего).
   */
  static list(equip, bar) {
    return equip
      .filter(unit => unit.kind === 'receiver' && unit.air && (unit.place !== false || unit.outside))
      .map(unit => {
        const vol = unit.air.vol > 0 ? unit.air.vol : null;
        const pressure = this.pressure(bar, unit.air.bar);
        const mpa = pressure ? pressure / 10 : null;
        const known = Boolean(vol && mpa);
        return {
          pos: unit.pos,
          qty: unit.qty || 1,
          vol,
          mpa,
          pv: known ? Math.round(this.product(pressure, vol) * 1000) / 1000 : null,
          reg: known ? this.registered(pressure, vol) : null,
          out: Boolean(unit.outside),
          rated: this.ratedOnly(pressure, unit.air.bar, vol),
        };
      });
  }

  /**
   * Паспортное давление сосуда выше рабочего и по нему p·V больше предела, а по рабочему — нет: паспортное, иначе null.
   * @param {number|null} bar рабочее давление
   * @param {number} own паспортное (разрешённое) давление сосуда
   * @param {number|null} litres
   * @returns {number|null}
   */
  static ratedOnly(bar, own, litres) {
    if (!(bar > 0) || !(own > bar) || !(litres > 0)) return null;
    return this.registered(own, litres) && !this.registered(bar, litres) ? own : null;
  }

  /** Расчётное давление сосуда: станции или своё. */
  static pressure(station, own) {
    if (station > 0) return station;
    return own > 0 ? own : null;
  }

  /** «0,8 МПа × 1,0 м³ = 0,8» */
  static text(v) {
    const dec2 = x => String(Math.round(x * 100) / 100).replace('.', ',');
    return `${dec2(v.mpa)} МПа × ${dec2(v.vol / 1000)} м³ = ${dec2(v.pv)}`;
  }
}
