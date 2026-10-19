import { AirChain } from '../layout/air-chain.js';
import { StationEquip } from '../layout/station-equip.js';
import { AirDemand } from './air-demand.js';

const AIR_KINDS = /^(compressor|dryer|filter|receiver)$/;
const RANGED = [
  'flow',
  'pressure',
  'alt',
  'rh',
  'margin',
  'tmin',
  'tmax',
  'tin',
  'kw',
  'load',
  'hours',
  'motor',
  'recvVol',
  'q',
  'head',
  'hsuct',
  'tliq',
];

/** Исходные данные расчёта: требования (числа с проверкой диапазона), элементы состава по видам. */
export class CalcInput {
  /** Ошибочное и вне допустимого — не в расчёт (ошибка поля — StationCalc.run). */
  static num(v) {
    return ReqNum.num(v);
  }

  /** {kind, cls, units, parts, recvIn, recvOut, req}. */
  static of(x) {
    const r = StationReq.of(x);
    const P = kitParts(x).filter(p => p.role !== 'container');
    const units = P.map(p => {
      const kind = StationEquip.kindOf(p);
      const info = AIR_KINDS.test(kind) ? AirChain.info(p, kind) : {};
      return {
        p,
        kind,
        qty: Math.max(1, Math.min(20, Math.round(+p.qty || 1))),
        info,
        name: String(p.name || '').trim(),
        attrs: p.attrs || {},
        rows: p.rows || [],
      };
    });
    return {
      kind: StationReq.kind(x),
      cls: StationUi.opts(x).air || '',
      units,
      parts: P,
      recvIn: StationReq.recvIn(x),
      recvOut: StationReq.recvOut(x),
      req: CalcInput.req(r),
    };
  }

  static req(r) {
    const g = k => (ReqNum.check(k, r[k]) ? null : CalcInput.num(r[k]));
    const out = Object.fromEntries(RANGED.map(k => [k, g(k)]));
    return {
      ...out,
      basis: AirDemand.REF[r.basis] ? r.basis : 'fad',
      reserve: r.reserve != null && r.reserve !== '' ? Math.max(0, Math.round(CalcInput.num(r.reserve) || 0)) : null,
      work: CalcInput.num(r.work),
      start: r.start || '',
      mode: r.mode || '',
      liquid: r.liquid || '',
    };
  }

  /** Строка характеристик по ключу → число в единицах строки; unitRx — единица должна совпасть. */
  static row(u, keyRx, unitRx) {
    for (const r of (u.rows || []).filter(q => q && keyRx.test(String(q.k || '')))) {
      const t = `${String(r.k || '')} ${String(r.v || '')}`;
      const v = !unitRx || unitRx.test(t) ? AirChain.first(r.v) : null;
      if (v != null) return { v, t };
    }
    return null;
  }

  /** Перепад давления элемента по паспорту, бар. */
  static dp(u) {
    const r = CalcInput.row(u, /перепад|потер[ия]\S* давлени/i);
    if (!r) return null;
    if (/мбар|mbar/i.test(r.t)) return r.v / 1000;
    return /кпа/i.test(r.t) ? r.v / 100 : r.v;
  }
}
