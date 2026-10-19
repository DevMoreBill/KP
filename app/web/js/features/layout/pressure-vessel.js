/**
 * Воздушный ресивер — сосуд под давлением (ФНП ОРПД, ТР ТС 032/2013): на учёт в Ростехнадзоре, если p·V больше
 * vessel.pv (МПа·м³); давление — наибольшее рабочее на станции, без него — расчётное ресивера.
 */
export class PressureVessel {
  static get LIMIT() {
    return StationRules.raw('vessel.pv');
  }

  /** Ресиверы состава: [{pos, qty, vol, mpa, pv, reg, out}]; bar — рабочее давление станции (0 — неизвестно). */
  static list(eq, bar) {
    return eq
      .filter(e => e.kind === 'receiver' && e.air && (e.place !== false || e.outside))
      .map(e => {
        const vol = e.air.vol > 0 ? e.air.vol : null;
        const b = this.pressure(bar, e.air.bar);
        const mpa = b ? b / 10 : null;
        const pv = vol && mpa ? Math.round(((mpa * vol) / 1000) * 1000) / 1000 : null;
        return {
          pos: e.pos,
          qty: e.qty || 1,
          vol,
          mpa,
          pv,
          reg: pv == null ? null : pv > this.LIMIT,
          out: Boolean(e.outside),
        };
      });
  }

  static pressure(station, own) {
    if (station > 0) return station;
    return own > 0 ? own : null;
  }

  /** «0,8 МПа × 1,0 м³ = 0,8» */
  static text(v) {
    const f = x => String(Math.round(x * 100) / 100).replace('.', ',');
    return `${f(v.mpa)} МПа × ${f(v.vol / 1000)} м³ = ${f(v.pv)}`;
  }
}
