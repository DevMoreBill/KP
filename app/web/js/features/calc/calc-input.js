import { AirChain } from '../layout/air-chain.js';
import { StationEquip } from '../layout/station-equip.js';
import { AirDemand } from './air-demand.js';

/** Исходные данные расчёта: требования (числа с проверкой диапазона), элементы состава по видам. */
export class CalcInput {
  static AIR_KINDS = /^(compressor|dryer|filter|receiver)$/;
  static RANGED = [
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
  /** Ошибочное и вне допустимого — не в расчёт (ошибка поля — StationCalc.run). */
  static num(value) {
    return ReqNum.num(value);
  }

  /** {kind, cls, units, parts, recvIn, recvOut, req}. */
  static of(station) {
    const req = StationReq.of(station);
    const parts = kitParts(station).filter(part => part.role !== 'container');
    const units = parts.map(part => {
      const kind = StationEquip.kindOf(part);
      const info = CalcInput.AIR_KINDS.test(kind) ? AirChain.info(part, kind) : {};
      return {
        p: part,
        kind,
        qty: Math.max(1, Math.min(20, Math.round(+part.qty || 1))),
        info,
        name: String(part.name || '').trim(),
        attrs: part.attrs || {},
        rows: part.rows || [],
      };
    });
    return {
      kind: StationReq.kind(station),
      cls: StationUi.opts(station).air || '',
      units,
      parts,
      recvIn: StationReq.recvIn(station),
      recvOut: StationReq.recvOut(station),
      req: CalcInput._req(req),
    };
  }

  static _req(req) {
    const checked = k => (ReqNum.check(k, req[k]) ? null : CalcInput.num(req[k]));
    const out = Object.fromEntries(CalcInput.RANGED.map(k => [k, checked(k)]));
    return {
      ...out,
      basis: AirDemand.REF[req.basis] ? req.basis : 'fad',
      reserve:
        req.reserve != null && req.reserve !== '' ? Math.max(0, Math.round(CalcInput.num(req.reserve) || 0)) : null,
      work: CalcInput.num(req.work),
      start: req.start || '',
      mode: req.mode || '',
      liquid: req.liquid || '',
    };
  }

  /** Строка характеристик по ключу → число в единицах строки; unitRx — единица должна совпасть. */
  static row(unit, keyRx, unitRx) {
    for (const row of (unit.rows || []).filter(entry => entry && keyRx.test(String(entry.k || '')))) {
      const text = `${String(row.k || '')} ${String(row.v || '')}`;
      const value = !unitRx || unitRx.test(text) ? AirChain.first(row.v) : null;
      if (value != null) return { v: value, t: text };
    }
    return null;
  }

  /** Перепад давления элемента по паспорту, бар. */
  static pressureDrop(unit) {
    const row = CalcInput.row(unit, /перепад|потер[ия]\S* давлени/i);
    if (!row) return null;
    if (/мбар|mbar/i.test(row.t)) return row.v / 1000;
    return /кпа/i.test(row.t) ? row.v / 100 : row.v;
  }
}
