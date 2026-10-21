import { StationReq } from './station-req.js';
import { Mm } from '../layout/mm.js';
import { StationEquip } from '../layout/station-equip.js';
import { Kit } from '../kit/kit.js';

/**
 * Исходные данные ресиверов изменились — число ресиверов в составе приводится к расчёту (ReceiverPlan): у строки ресивера
 * нужного объёма и роли (основной, мокрый, у потребителя) меняется количество; другой объём — замену предлагает «Нужно…».
 */
export class ReceiverSync {
  static KEYS = [
    'recv',
    'recvSize',
    'recvWhy',
    'recvVol',
    'recvDp',
    'recvValve',
    'recvT',
    'recvC',
    'recvDrop',
    'recvPoint',
    'reserve',
  ];
  static WORD = { dry: 'основной', wet: 'мокрый', local: 'у потребителя' };

  /**
   * Привести число ресиверов к расчёту.
   * @param {object} item позиция КП
   * @returns {string} что изменено словами («основной 4 × 900 л») или ''
   */
  static apply(item) {
    return this._run(item, { write: true });
  }

  /**
   * Что изменилось бы, без изменения состава.
   * @param {object} item
   * @returns {string}
   */
  static preview(item) {
    return this._run(item, { write: false });
  }

  static _run(item, { write }) {
    const plan = StationReq.recvPlan(item);
    if (!plan) return '';
    const parts = Kit.parts(item);
    const equipment = StationEquip.list(parts, { recv: StationReq.recv(item), recvOut: StationReq.recvOut(item) });
    const done = [];
    for (const [role, group] of [
      ['dry', plan.main],
      ['wet', plan.wet],
      ['local', plan.local],
    ]) {
      const part = this._row(equipment, parts, role, group);
      if (!part) continue;
      if (write) part.qty = group.n;
      done.push(`${this.WORD[role]} ${group.n} × ${Mm.text(group.size)} л`);
    }
    return done.join(', ');
  }

  static _role(entry) {
    if (entry.local) return 'local';
    if (entry.kind !== 'receiver' || !entry.air) return '';
    return entry.air.role === 'wet' ? 'wet' : 'dry';
  }

  // одна строка ресивера этой роли и нужного объёма, число которой отличается; несколько строк или другой объём — вручную
  static _row(equipment, parts, role, group) {
    if (!group || !(group.n > 0)) return null;
    const mine = equipment.filter(entry => this._role(entry) === role);
    const volume = entry => Math.round((entry.local ? entry.vol : entry.air.vol) || 0);
    const ids = [...new Set(mine.filter(entry => volume(entry) === group.size).map(entry => entry.id))];
    if (ids.length !== 1 || mine.some(entry => !ids.includes(entry.id))) return null;
    const part = parts.find(row => row.id === ids[0]);
    if (!part || (+part.qty || 1) === group.n) return null;
    return part;
  }
}
