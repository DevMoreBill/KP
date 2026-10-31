import { AirCheck } from '../layout/air-check.js';
import { Kit } from '../../core/kit.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationPlan } from '../req/station-plan.js';
import { StationReq } from '../req/station-req.js';
/** Воздух состава станции: цепочка подготовки по составу, компрессоры с характеристиками, давление. */
export class KitAir {
  /**
   * Цепочка воздуха по составу (контейнер не нужен).
   * @param {object} item позиция КП
   * @returns {object|null} {q, bar, recs, …} или null (не компрессорная, нет компрессоров)
   */
  static of(item) {
    if (StationReq.kind(item) !== 'comp') return null;
    const equipment = StationEquip.list(Kit.parts(item), {
      recv: StationReq.recv(item),
      recvOut: StationReq.recvOut(item),
    });
    return AirCheck.of(equipment, StationPlan.opts(item).air, StationReq.recvIn(item), StationReq.dryer(item));
  }

  /**
   * Компрессоры состава с характеристиками.
   * @param {object} item
   * @returns {object[]}
   */
  static comps(item) {
    return StationEquip.list(Kit.parts(item)).filter(entry => entry.kind === 'compressor' && entry.air);
  }

  /**
   * Наибольшее давление компрессоров, бар (0 — неизвестно).
   * @param {object} item
   * @returns {number}
   */
  static bar(item) {
    return Math.max(0, ...this.comps(item).map(entry => entry.air.bar || 0));
  }
}
