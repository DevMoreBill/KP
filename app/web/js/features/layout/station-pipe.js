import { Mm } from './mm.js';
import { StationFire } from './station-fire.js';
import { StationMatrix } from './station-matrix.js';

const n = v => Mm.text(v);
const f = v => StationFire.f1(v);
const WALL = { right: 'дальний торец', back: 'заднюю стену', front: 'стену прохода' };
const WHAT = { air: 'Выход сжатого воздуха', in: 'Вход (всасывание)' };
const PN = [10, 16, 25, 40, 63];

/**
 * Диаметр трубопровода по расходу и допустимой скорости: d = √(4 · Q / (π · v)), DN — ближайший больший (ГОСТ 3262,
 * ГОСТ 8732). Воздух — расход при рабочем давлении; вода — подача рабочих насосов; топливо — насос перекачки.
 */
export class StationPipe {
  static DN = [
    [15, 15.7],
    [20, 20.9],
    [25, 26.6],
    [32, 35.1],
    [40, 40.9],
    [50, 52.5],
    [65, 68],
    [80, 80.9],
    [100, 106],
    [125, 131],
    [150, 156],
    [200, 207],
    [250, 259],
    [300, 309],
  ];

  static get V() {
    return StationRules.raw('el.pipe_v');
  }
  static get FUEL() {
    return StationMatrix.grp('light').fuelPump;
  }

  /** DN по внутреннему диаметру, мм. */
  static dn(d) {
    const r = StationPipe.DN.find(([, di]) => di >= d - 1e-9);
    return r ? r[0] : StationPipe.DN[StationPipe.DN.length - 1][0];
  }

  static inner(dn) {
    const r = StationPipe.DN.find(([k]) => k === dn);
    return r ? r[1] : dn;
  }

  /** {medium, why, lines: [{name, v, d, dn, vAct}], dn, set — DN в составе, small — меньше расчётного} или null. */
  static calc(plan) {
    if (!(plan.lines || []).length) return null;
    const P = plan.piping || [];
    const pp = P.find(p => p.pos != null) || P[0];
    const set = pp ? +(String(pp.dn || '').match(/\d+/) || [0])[0] || 0 : 0;
    const lines = [];
    const add = (name, q, v) => {
      const d = Math.sqrt((4 * q) / (Math.PI * v)) * 1000;
      const dn = StationPipe.dn(d);
      const di = StationPipe.inner(dn) / 1000;
      lines.push({
        name,
        v,
        d: Math.round(d * 10) / 10,
        dn,
        vAct: Math.round((q / ((Math.PI * di * di) / 4)) * 10) / 10,
      });
    };
    const { medium, why } = StationPipe.flow(plan, add);
    if (!lines.length) return null;
    const dn = lines[0].dn;
    return { medium, why, lines, dn, set, small: set > 0 && set < dn };
  }

  static flow(plan, add) {
    const V = StationPipe.V;
    const r = plan.req || {};
    const pumps = (plan.items || [])
      .filter(i => i.kind === 'pump' && i.flow > 0)
      .map(i => i.flow)
      .sort((a, b) => b - a);
    if (plan.air && plan.air.q > 0) {
      const bar = plan.air.bar || 8;
      const q = ((plan.air.q / 60) * 1.013) / (bar + 1.013);
      add('магистраль сжатого воздуха', q, V.air);
      return { medium: 'air', why: `${f(plan.air.q)} м³/мин при ${f(bar)} бар — ${f(q * 60)} м³/мин в трубе` };
    }
    if (pumps.length) {
      const k = Math.max(1, pumps.length - Math.max(0, Math.round(r.res || 0)));
      const Q = pumps.slice(0, k).reduce((s, v) => s + v, 0) / 3600;
      add('напорный коллектор', Q, V.out);
      add('всасывающий коллектор', Q, V.in);
      return { medium: 'water', why: `подача рабочих насосов ${f(Q * 3600)} м³/ч` };
    }
    if (plan.fuel) {
      add('топливопровод', StationPipe.FUEL / 3600, V.fuel);
      return { medium: 'fuel', why: `подача насоса перекачки около ${f(StationPipe.FUEL)} м³/ч` };
    }
    return { medium: '', why: '' };
  }

  /** Пункты ТЗ: выходы трубопровода из станции — где, на какой высоте, патрубок с фланцем (ГОСТ 33259-2015). */
  static outs(plan) {
    const bar = plan.air && plan.air.bar > 0 ? plan.air.bar : 0;
    const pn = bar ? PN.find(v => v >= bar) || 63 : 0;
    const dn = plan.pipe ? plan.pipe.set || plan.pipe.dn : 0;
    return (plan.lines || []).filter(l => l.out).map(l => StationPipe.outText(plan, l, { pn, dn }));
  }

  static outText(plan, l, { pn, dn }) {
    const o = l.out;
    const [L] = plan.int || [0];
    const where =
      o.wall === 'right'
        ? `через дальний торец${o.rise ? ' над проёмом' : ''}, в ${n(Math.round(plan.int[1] - o.y))} мм от задней стены (внутри)`
        : `через ${WALL[o.wall]} в ${n(Math.round(L - o.x))} мм от дальнего торца (внутри)`;
    const moved = o.moved ? ` (в торце — ${o.why}: выход перенесён на свободное место)` : '';
    return `${WHAT[l.medium] || 'Выход'} — ${where}, на высоте ${n(Math.round(o.z))} мм от пола${moved}: патрубок${dn ? ` DN ${dn}` : ''} с выступом ${n(o.flange)} мм от стены и фланцем (ГОСТ 33259-2015${pn ? `, PN ${pn}` : ', PN — по рабочему давлению'}), на перевозку — фланцевая заглушка; проход стены — гильза с уплотнением.`;
  }

  /** Пункт ТЗ и строка «Компоновки»: DN по расчёту. */
  static text(Q) {
    if (!Q) return '';
    const lines = Q.lines
      .map(l => `${l.name} — DN ${l.dn} (внутри не менее ${f(l.d)} мм при скорости не более ${f(l.v)} м/с)`)
      .join(', ');
    let set = '';
    if (Q.set)
      set = Q.small
        ? `; в составе указан DN ${Q.set} — меньше расчётного, принять DN ${Q.dn}`
        : `; в составе — DN ${Q.set}`;
    return `диаметр — по расчёту (${Q.why}): ${lines}${set}`;
  }
}
