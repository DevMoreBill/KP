/**
 * Воздушный ресивер — сосуд под давлением (ФНП ОРПД, ТР ТС 032/2013): на учёт в Ростехнадзоре, если p·V больше
 * vessel.pv (МПа·м³); давление — наибольшее рабочее на станции, без него — расчётное ресивера.
 */
export class PressureVessel {
  static get LIMIT() {
    return StationRules.raw('vessel.pv');
  }

  /** Ресиверы состава: [{pos, qty, vol, mpa, pv, reg, out}]; bar — рабочее давление станции (0 — неизвестно). */
  static list(equip, bar) {
    return equip
      .filter(unit => unit.kind === 'receiver' && unit.air && (unit.place !== false || unit.outside))
      .map(unit => {
        const vol = unit.air.vol > 0 ? unit.air.vol : null;
        const barMpa = this.pressure(bar, unit.air.bar);
        const mpa = barMpa ? barMpa / 10 : null;
        const pvProduct = vol && mpa ? Math.round(((mpa * vol) / 1000) * 1000) / 1000 : null;
        return {
          pos: unit.pos,
          qty: unit.qty || 1,
          vol,
          mpa,
          pv: pvProduct,
          reg: pvProduct == null ? null : pvProduct > this.LIMIT,
          out: Boolean(unit.outside),
        };
      });
  }

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
