import { StationRules } from '../rules/station-rules.js';
import { SummerTemp } from './summer-temp.js';

/**
 * Производительность осушителя к номиналу: поправки производителя F = Fp · Fвх · Fокр (· Fтр — номинал серии не для +3 °C);
 * серии нет — типовая серия по виду (dryer.generic), нет и её — Kp ÷ запас. Давление и температуры для поправок — одни
 * у расчётной записки, «Компоновки» и подбора.
 */
export class DryerDerate {
  static EPS = 1e-9;
  static MIN_BAR = 1;

  /**
   * Значение таблицы и признак «вне таблицы».
   * @param {number[][]|null} table [[x, k], …]
   * @param {number|null} station
   * @returns {{k: number, out: boolean}}
   */
  static k(table, station) {
    if (!Array.isArray(table) || !table.length || station == null) return { k: 1, out: false };
    return {
      k: StationRules.interp(table, station),
      out: station < table[0][0] - this.EPS || station > table[table.length - 1][0] + this.EPS,
    };
  }

  /**
   * Поправка на давление по типовой таблице (правило dryer.kp).
   * @param {number} bar
   * @returns {number}
   */
  static pressK(bar) {
    return bar > 0 ? StationRules.interp(StationRules.raw('dryer.kp'), bar) : 1;
  }

  /**
   * Температуры: в помещении — наружная летом (SummerTemp) + нагрев; на входе — из требований или помещение + dryer.inlet_dt.
   * @param {{tmax?: number|null, tin?: number|null}} req
   * @returns {{amb: number, tin: number}}
   */
  static temps(req) {
    const amb = SummerTemp.of(req.tmax) + StationRules.raw('heat.vent_dt');
    return { amb, tin: req.tin != null ? req.tin : amb + StationRules.raw('dryer.inlet_dt') };
  }

  /**
   * Серия производителя; нет — типовая серия по виду осушителя (generic).
   * @param {object|null} part
   * @param {string} type refrig | ads
   * @returns {{s: object|null, generic: boolean}}
   */
  static seriesOf(part, type) {
    const series = part ? StationRules.series(part, 'dryer') : null;
    if (series) return { s: series, generic: false };
    const title = (StationRules.raw('dryer.generic') || {})[type === 'ads' ? 'ads' : 'refrig'];
    const generic = ((StationRules.data || {}).series || []).find(z => z.kind === 'dryer' && z.title === title) || null;
    return { s: generic, generic: !!generic };
  }

  /**
   * Поправка осушителя к номиналу: серия производителя или типовая таблица.
   * @param {object|null} part позиция (null — типовая серия вида)
   * @param {number} bar давление для поправок
   * @param {{amb: number, tin: number}} temps
   * @param {string} type refrig | ads
   * @returns {object} {F, s, generic, kp, ki, ka, kc, out}
   */
  static factor(part, bar, temps, type) {
    const { s: series, generic } = this.seriesOf(part, type);
    if (!series) {
      const kPress = this.pressK(bar);
      return { F: kPress / StationRules.raw('dryer.margin'), s: null, generic: false, kp: { k: kPress }, out: [] };
    }
    const kPress = this.k(series.f.p, bar);
    const kInlet = this.k(series.f.inlet, series.f.inlet ? temps.tin : null);
    const kAmbient = this.k(series.f.ambient, series.f.ambient ? temps.amb : null);
    const kSeries = series.k > 0 ? series.k : 1;
    const out = [
      kPress.out && 'давление',
      kInlet.out && 'температура входа',
      kAmbient.out && 'температура помещения',
    ].filter(Boolean);
    return {
      F: kPress.k * kInlet.k * kAmbient.k * kSeries,
      s: series,
      generic,
      kp: kPress,
      ki: kInlet,
      ka: kAmbient,
      kc: kSeries,
      out,
    };
  }

  /**
   * Давление для поправок, бар, — не выше фактического: задано у потребителя — оно + потери трубопровода станции; иначе
   * давление включения компрессоров минус потери подготовки воздуха; давления компрессоров нет — у потребителя или номинал.
   * @param {{pressure: number|null, pmax: number, vsd: boolean, loss: number}} budget
   * @returns {number}
   */
  static bar({ pressure, pmax, vsd, loss }) {
    if (!Number.isFinite(pmax)) return pressure > 0 ? pressure : StationRules.raw('dryer.ref').p;
    if (pressure > 0) return pressure + StationRules.raw('loss.pipe');
    return Math.max(this.MIN_BAR, pmax - (vsd ? 0 : StationRules.raw('pressure.band')) - loss);
  }

  /**
   * Аппараты с потерями давления по ходу воздуха: фильтры (кроме сборников конденсата), затем осушители.
   * @param {{kind: string, info: object}[]} units элементы состава с AirChain.info
   * @returns {object[]}
   */
  static lossUnits(units) {
    return [
      ...units.filter(unit => unit.kind === 'filter' && unit.info.grade !== 'cond'),
      ...units.filter(unit => unit.kind === 'dryer'),
    ];
  }

  /**
   * Потери давления аппарата, бар: по паспорту, иначе по правилу (осушитель — по виду, фильтр).
   * @param {{kind: string, info: object}} unit
   * @returns {{v: number, rule: string}} rule — '' по паспорту
   */
  static drop({ kind, info }) {
    if (info.drop != null) return { v: info.drop, rule: '' };
    if (kind === 'filter') return { v: StationRules.raw('loss.filter'), rule: 'loss.filter' };
    return { v: StationRules.raw('loss.dryer')[info.type === 'ads' ? 'ads' : 'refrig'], rule: 'loss.dryer' };
  }

  /**
   * Потери давления подготовки воздуха и трубопровода станции, бар.
   * @param {{kind: string, info: object}[]} units
   * @returns {number}
   */
  static loss(units) {
    const own = this.lossUnits(units).reduce((sum, unit) => sum + this.drop(unit).v, 0);
    return own + StationRules.raw('loss.pipe');
  }

  /**
   * Потери по плану цепочки до подбора, бар (по правилам): осушитель вида ads / рефрижераторный, два фильтра (до и после
   * осушителя), угольный — при классе масла 1, трубопровод станции.
   * @param {{ads: boolean, oilOne: boolean}} plan
   * @returns {number}
   */
  static planLoss({ ads, oilOne }) {
    const filter = { kind: 'filter', info: { grade: 'micro', drop: null } };
    const dryer = { kind: 'dryer', info: { type: ads ? 'ads' : 'refrig', drop: null } };
    return this.loss([dryer, filter, filter, ...(oilOne ? [filter] : [])]);
  }
}
