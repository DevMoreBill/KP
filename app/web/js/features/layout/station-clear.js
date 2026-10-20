import { StationMatrix } from './station-matrix.js';

/**
 * Отступы вокруг оборудования: [рекомендуется, не менее], мм — по виду (правило clear.kind) и проход обслуживания
 * (правило norm.aisle). Источники норм — в правилах программы («Настройки → Инженерные правила станций»).
 */
export class StationClear {
  static get KIND() {
    return StationRules.raw('clear.kind');
  }

  /** Малые насосы (до pumps.kw и pumps.len): у стены и по два на общей раме. */
  static get PUMP_SMALL() {
    return StationMatrix.derive('pumps', () => {
      const pumps = StationMatrix.grp('pumps');
      return { back: [pumps.back, pumps.backMin], side: [pumps.side, pumps.sideMin], top: [pumps.top, pumps.topMin] };
    });
  }

  /** Отступы оборудования по виду (у насосов — ещё по мощности и длине). */
  static of(kind, unit) {
    if (kind === 'pump' && unit && this.smallPump(unit)) return this.PUMP_SMALL;
    return this.KIND[kind] || this.KIND.other;
  }

  static smallPump(unit) {
    const pumps = StationMatrix.grp('pumps');
    return !(unit.kw > pumps.kw) && Math.max(unit.l || 0, unit.w || 0) <= pumps.len;
  }

  /** Проход обслуживания [рекомендуется, не менее], мм. */
  static aisle() {
    const raw = StationRules.raw('norm.aisle');
    const rec = Math.max(600, Math.min(3000, +raw[0] || 1000));
    const min = Math.max(600, Math.min(rec, +raw[1] || 800));
    return [rec, min];
  }
}
