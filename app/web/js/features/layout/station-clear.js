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
      const p = StationMatrix.grp('pumps');
      return { back: [p.back, p.backMin], side: [p.side, p.sideMin], top: [p.top, p.topMin] };
    });
  }

  /** Отступы оборудования по виду (у насосов — ещё по мощности и длине). */
  static of(kind, e) {
    if (kind === 'pump' && e && this.smallPump(e)) return this.PUMP_SMALL;
    return this.KIND[kind] || this.KIND.other;
  }

  static smallPump(e) {
    const p = StationMatrix.grp('pumps');
    return !(e.kw > p.kw) && Math.max(e.l || 0, e.w || 0) <= p.len;
  }

  /** Проход обслуживания [рекомендуется, не менее], мм. */
  static aisle() {
    const A = StationRules.raw('norm.aisle');
    const rec = Math.max(600, Math.min(3000, +A[0] || 1000));
    const min = Math.max(600, Math.min(rec, +A[1] || 800));
    return [rec, min];
  }
}
