import { Mm } from './mm.js';
import { StationFire } from './station-fire.js';
import { StationMatrix } from './station-matrix.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Диаметр трубопровода по расходу и допустимой скорости: d = √(4 · Q / (π · v)), DN — ближайший больший (ГОСТ 3262,
 * ГОСТ 8732). Воздух — расход при рабочем давлении; вода — подача рабочих насосов; топливо — насос перекачки.
 */
export class StationPipe {
  static WALL = { right: 'дальний торец', back: 'заднюю стену', front: 'стену прохода' };

  static WHAT = { air: 'Выход сжатого воздуха', in: 'Вход (всасывание)' };

  static PRESSURES = [10, 16, 25, 40, 63];

  static BORES = [
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

  static get _MAX_SPEED() {
    return StationRules.raw('el.pipe_v');
  }
  /** Топливный насос из матрицы. */
  static get FUEL() {
    return StationMatrix.grp('light').fuelPump;
  }

  /** DN по внутреннему диаметру, мм. */
  static bore(inner) {
    const row = StationPipe.BORES.find(([, inside]) => inside >= inner - 1e-9);
    return row ? row[0] : StationPipe.BORES[StationPipe.BORES.length - 1][0];
  }

  /** Внутренний диаметр трубы условного прохода, мм. */
  static inner(bore) {
    const row = StationPipe.BORES.find(([k]) => k === bore);
    return row ? row[1] : bore;
  }

  /** {medium, why, lines: [{name, v, d, dn, vAct}], dn, set — DN в составе, small — меньше расчётного} или null. */
  static calc(plan) {
    if (!(plan.lines || []).length) return null;
    const piping = plan.piping || [];
    const pipe = piping.find(part => part.pos != null) || piping[0];
    const set = pipe ? +(String(pipe.dn || '').match(/\d+/) || [0])[0] || 0 : 0;
    const lines = [];
    const add = (name, flow, v) => {
      const diam = Math.sqrt((4 * flow) / (Math.PI * v)) * 1000;
      const bore = StationPipe.bore(diam);
      const insideM = StationPipe.inner(bore) / 1000;
      lines.push({
        name,
        v,
        d: Math.round(diam * 10) / 10,
        dn: bore,
        vAct: Math.round((flow / ((Math.PI * insideM * insideM) / 4)) * 10) / 10,
      });
    };
    const { medium, why } = StationPipe.flow(plan, add);
    if (!lines.length) return null;
    const bore = lines[0].dn;
    return { medium, why, lines, dn: bore, set, small: set > 0 && set < bore };
  }

  /** Расход по трассам, м³/с. */
  static flow(plan, add) {
    const maxSpeed = StationPipe._MAX_SPEED;
    const req = plan.req || {};
    const pumps = (plan.items || [])
      .filter(i => i.kind === 'pump' && i.flow > 0)
      .map(i => i.flow)
      .sort((left, right) => right - left);
    if (plan.air && plan.air.q > 0) {
      const bar = plan.air.bar || StationRules.raw('pressure.default');
      const flow = ((plan.air.q / 60) * 1.013) / (bar + 1.013);
      add('магистраль сжатого воздуха', flow, maxSpeed.air);
      return {
        medium: 'air',
        why: `${StationFire.dec1(plan.air.q)} м³/мин при ${StationFire.dec1(bar)} бар — ${StationFire.dec1(flow * 60)} м³/мин в трубе`,
      };
    }
    if (pumps.length) {
      const k = Math.max(1, pumps.length - Math.max(0, Math.round(req.res || 0)));
      const flowSum = pumps.slice(0, k).reduce((acc, v) => acc + v, 0) / 3600;
      add('напорный коллектор', flowSum, maxSpeed.out);
      add('всасывающий коллектор', flowSum, maxSpeed.in);
      return { medium: 'water', why: `подача рабочих насосов ${StationFire.dec1(flowSum * 3600)} м³/ч` };
    }
    if (plan.fuel) {
      add('топливопровод', StationPipe.FUEL / 3600, maxSpeed.fuel);
      return { medium: 'fuel', why: `подача насоса перекачки около ${StationFire.dec1(StationPipe.FUEL)} м³/ч` };
    }
    return { medium: '', why: '' };
  }

  /** Пункты ТЗ: выходы трубопровода из станции — где, на какой высоте, патрубок с фланцем (ГОСТ 33259-2015). */
  static outs(plan) {
    const bar = plan.air && plan.air.bar > 0 ? plan.air.bar : 0;
    const pressure = bar ? StationPipe.PRESSURES.find(v => v >= bar) || 63 : 0;
    const bore = plan.pipe ? plan.pipe.set || plan.pipe.dn : 0;
    return (plan.lines || [])
      .filter(line => line.out)
      .map(line => StationPipe.outText(plan, line, { pn: pressure, dn: bore }));
  }

  /** Текст о выходе трубы через стену. */
  static outText(plan, line, { pn: pressure, dn: bore }) {
    const out = line.out;
    const [Li] = plan.int || [0];
    const where =
      out.wall === 'right'
        ? `через дальний торец${out.rise ? ' над проёмом' : ''}, в ${Mm.text(Math.round(plan.int[1] - out.y))} мм от задней стены (внутри)`
        : `через ${StationPipe.WALL[out.wall]} в ${Mm.text(Math.round(Li - out.x))} мм от дальнего торца (внутри)`;
    const moved = out.moved ? ` (в торце — ${out.why}: выход перенесён на свободное место)` : '';
    return `${StationPipe.WHAT[line.medium] || 'Выход'} — ${where}, на высоте ${Mm.text(Math.round(out.z))} мм от пола${moved}: патрубок${bore ? ` DN ${bore}` : ''} с выступом ${Mm.text(out.flange)} мм от стены и фланцем (ГОСТ 33259-2015${pressure ? `, PN ${pressure}` : ', PN — по рабочему давлению'}), на перевозку — фланцевая заглушка; проход стены — гильза с уплотнением.`;
  }

  /** Пункт ТЗ и строка «Компоновки»: DN по расчёту. */
  static text(calc) {
    if (!calc) return '';
    const lines = calc.lines
      .map(
        line =>
          `${line.name} — DN ${line.dn} (внутри не менее ${StationFire.dec1(line.d)} мм при скорости не более ${StationFire.dec1(line.v)} м/с)`,
      )
      .join(', ');
    let set = '';
    if (calc.set)
      set = calc.small
        ? `; в составе указан DN ${calc.set} — меньше расчётного, принять DN ${calc.dn}`
        : `; в составе — DN ${calc.set}`;
    return `диаметр — по расчёту (${calc.why}): ${lines}${set}`;
  }
}
