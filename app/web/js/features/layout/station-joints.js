import { LayoutPipes } from './layout-pipes.js';
import { Mm } from './mm.js';
import { StationMods } from './station-mods.js';

const MED = {
  air: 'сжатого воздуха',
  fuel: 'топливопровод',
  in: 'всасывающий коллектор',
  out: 'напорный коллектор',
  gen: 'трубопровод',
};
const POWERED = new Set(['compressor', 'dryer', 'pump', 'dgu', 'cabinet']);
const EARTH = 'перемычка заземления каркасов модулей — гибкий медный проводник на болтах (ПУЭ, гл. 1.7)';
const key = (d, i, j) => `${d}:${i},${j}`;

/**
 * Разъёмные соединения на стыках модулей (для ТЗ на сборку): трубы по геометрии линий, кабели — от шкафа-источника к
 * агрегатам и сетям других модулей путём «по длине, затем поперёк»; маркировка «С<стык>.<номер>».
 */
export class StationJoints {
  static MED = MED;

  /** [{n, a, b — номера модулей, dir, at, list: [{mark, t}]}] или []. */
  static calc(plan) {
    const g = plan && plan.geo;
    const md = g && g.mods;
    if (!md || !md.Lm || !plan.int) return [];
    const ctx = StationJoints.grid(plan, g, md);
    StationJoints.pipes(plan, ctx);
    StationJoints.cables(plan, ctx);
    StationJoints.nets(plan, ctx);
    return [...ctx.joints.values()].map((q, k) => ({
      ...q,
      n: k + 1,
      list: [...q.list, EARTH].map((t, m) => ({ mark: `С${k + 1}.${m + 1}`, t })),
    }));
  }

  /** Стыки, клетка модуля по точке, добавление соединения на стык и путь кабеля от источника. */
  static grid(plan, g, md) {
    const [L, W] = plan.int;
    const ox = (g.ext[0] - L) / 2;
    const oy = (g.ext[1] - W) / 2;
    const J = StationMods.lines(g);
    const num = (i, j) => md.cells.findIndex(q => q[0] === i && q[1] === j) + 1;
    const cell = (x, y) => [
      Math.min(md.a - 1, Math.max(0, Math.floor((ox + x) / md.Lm))),
      Math.min(md.b - 1, Math.max(0, Math.floor((oy + y) / md.Wm))),
    ];
    const joints = new Map();
    for (let j = 0; j < md.b; j++) {
      for (let i = 0; i < md.a - 1; i++)
        joints.set(key('x', i, j), { dir: 'x', a: num(i, j), b: num(i + 1, j), at: J.x[i], list: [] });
    }
    for (let i = 0; i < md.a; i++) {
      for (let j = 0; j < md.b - 1; j++)
        joints.set(key('y', i, j), { dir: 'y', a: num(i, j), b: num(i, j + 1), at: J.y[j], list: [] });
    }
    const add = (k, t) => {
      const q = joints.get(k);
      if (q && !q.list.includes(t)) q.list.push(t);
    };
    return { L, W, md, J, cell, joints, add };
  }

  /** Трубы: участки вдоль (x) и поперёк (y), пересекающие линии стыков. */
  static pipes(plan, { W, J, cell, add }) {
    const seg = (x0, y0, x1, y1, t) => {
      if (Math.abs(y1 - y0) < 1) {
        const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
        J.x.forEach((X, i) => a < X && b > X && add(key('x', i, cell(X, y0)[1]), t));
      } else if (Math.abs(x1 - x0) < 1) {
        const [a, b] = [Math.min(y0, y1), Math.max(y0, y1)];
        J.y.forEach((Y, j) => a < Y && b > Y && add(key('y', cell(x0, Y)[0], j), t));
      }
    };
    const dn = plan.pipe && (plan.pipe.set || plan.pipe.dn);
    for (const l of plan.lines || []) {
      const t = `${StationJoints.what(l, dn)} — разъёмное фланцевое соединение (до DN 40 — разъёмная муфта)`;
      for (const [a, b] of LayoutPipes.runs(l)) seg(a, l.y, b, l.y, t);
      for (const br of l.branches || []) seg(br.x, br.y0, br.x, br.y1, t);
      const op = LayoutPipes.outPath(l, W);
      if (op)
        for (let k = 1; k < op.pts.length; k++) seg(op.pts[k - 1][0], op.pts[k - 1][1], op.pts[k][0], op.pts[k][1], t);
    }
  }

  static what(l, dn) {
    if (l.medium !== 'air') return MED[l.medium] || 'трубопровод';
    if (l.header) return 'коллектор компрессоров';
    if (l.par) return 'коллектор входов параллельных аппаратов';
    return `магистраль сжатого воздуха${dn ? ` DN ${dn}` : ''}`;
  }

  /** Кабели: от шкафа АВР / ввода (нет шкафа — от двери оператора) к агрегатам в других модулях. */
  static cables(plan, ctx) {
    const I = plan.items || [];
    const cabs = I.filter(i => i.kind === 'cabinet');
    const src = cabs.find(i => /АВР|ввод|ВРУ/i.test(i.name || '')) || cabs[0];
    ctx.src = StationJoints.source(plan, src, ctx.cell);
    const srcT = src ? `шкафа поз. ${src.pos}` : 'ввода';
    const many = new Set(I.filter(i => I.some(q => q !== i && q.pos === i.pos && q.mount === i.mount)).map(i => i.pos));
    const pn = it => `поз. ${it.pos}${many.has(it.pos) ? ` (${(it.unit || 0) + 1})` : ''}`;
    const seen = new Set();
    for (const it of I) {
      const id = `${it.pos}#${it.unit}`;
      if (it === src || it.mount === 'pipe' || seen.has(id) || !(POWERED.has(it.kind) || it.kw > 0)) continue;
      seen.add(id);
      StationJoints.path(ctx, ctx.cell(it.x + it.lx / 2, it.y + it.ly / 2), StationJoints.cable(it, pn(it), srcT));
    }
  }

  static source(plan, src, cell) {
    if (src) return cell(src.x + src.lx / 2, src.y + src.ly / 2);
    const en = plan.entry;
    return en && en.wall === 'front' ? cell((en.x0 + en.x1) / 2, 0) : [0, 0];
  }

  static cable(it, pos, srcT) {
    const name = it.short || it.name;
    if (it.kind === 'dgu') return `силовой кабель и кабели управления ДГУ ${pos} — к ${srcT}`;
    if (it.kind === 'cabinet') return `кабели питания и связи шкафа ${pos} «${name}»`;
    return `кабель питания и управления ${pos} «${name}»${it.kw ? ` (${Mm.text(it.kw)} кВт)` : ''} — от ${srcT}`;
  }

  /** Путь от клетки источника: по длине, затем поперёк — стыки по пути. */
  static path({ src, add }, c, t) {
    let [i, j] = src;
    while (i !== c[0]) {
      const d = c[0] > i ? 1 : -1;
      add(key('x', Math.min(i, i + d), j), t);
      i += d;
    }
    while (j !== c[1]) {
      const d = c[1] > j ? 1 : -1;
      add(key('y', i, Math.min(j, j + d)), t);
      j += d;
    }
  }

  /** Групповые сети каждого модуля (освещение, розетки, ОПС, отопление) — от модуля источника. */
  static nets(plan, ctx) {
    const { L, W, md, cell, src } = ctx;
    const sys = [
      plan.light && plan.light.on !== false ? 'освещение' : '',
      plan.sockets ? 'розетки' : '',
      plan.fire ? 'ОПС и пожаротушение' : '',
    ].filter(Boolean);
    const heat = (plan.heat && plan.heat.heaters) || [];
    const at = h => {
      if (h.wall === 'front' || h.wall === 'back') return [h.x + h.lx / 2, h.wall === 'back' ? W - 1 : 1];
      return [h.wall === 'left' ? 1 : L - 1, h.y + h.ly / 2];
    };
    md.cells.forEach(([i, j], q) => {
      if (i === src[0] && j === src[1]) return;
      const hs = heat.filter(h => {
        const c = cell(...at(h));
        return c[0] === i && c[1] === j;
      }).length;
      const list = [...sys, hs ? `отопление (${hs} шт.)` : ''].filter(Boolean);
      if (list.length)
        StationJoints.path(
          ctx,
          [i, j],
          `групповые сети модуля М${q + 1}: ${list.join(', ')} — разъёмные клеммные коробки у стыка`,
        );
    });
  }

  /** Раздел ТЗ на сборку: таблица по стыкам. */
  static tz(plan, d) {
    const J = StationJoints.calc(plan);
    if (!J.length) return;
    d.h2('Стыки модулей — разъёмные соединения (маркировать при расстыковке)');
    d.p(
      'На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку расстыковывают только соединения ниже — каждое маркируют с обеих сторон (бирка «С<стык>.<номер>»), концы закрывают заглушками и колпачками, кабели сматывают и крепят внутри модуля. На объекте — стыковка по маркировке, затем проверка плотности трубопровода и сопротивления изоляции кабелей.',
    );
    const rows = J.flatMap(q =>
      q.list.map((r, k) => [
        r.mark,
        k ? '' : `С${q.n}: М${q.a} — М${q.b} (${q.dir === 'x' ? 'поперёк, торец к торцу' : 'вдоль, бок о бок'})`,
        r.t,
      ]),
    );
    d.table([20, 40, 110], ['Маркировка', 'Стык', 'Соединение'], rows);
  }
}
