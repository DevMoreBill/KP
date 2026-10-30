import { LayoutPipes } from './layout-pipes.js';
import { Mm } from './mm.js';
import { StationMods } from './station-mods.js';

/**
 * Разъёмные соединения на стыках модулей (для ТЗ на сборку): трубы по геометрии линий, кабели — от шкафа-источника к
 * агрегатам и сетям других модулей путём «по длине, затем поперёк»; маркировка «С<стык>.<номер>».
 */
export class StationJoints {
  static MED = {
    air: 'сжатого воздуха',
    fuel: 'топливопровод',
    in: 'всасывающий коллектор',
    out: 'напорный коллектор',
    gen: 'трубопровод',
  };

  static POWERED = new Set(['compressor', 'dryer', 'pump', 'dgu', 'cabinet']);

  static EARTH = 'перемычка заземления каркасов модулей — гибкий медный проводник на болтах (ПУЭ, гл. 1.7)';

  static _key = (axis, i, j) => `${axis}:${i},${j}`;

  /** [{n, a, b — номера модулей, dir, at, list: [{mark, t}]}] или []. */
  static calc(plan) {
    const geo = plan && plan.geo;
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm || !plan.int) return [];
    const ctx = StationJoints.grid(plan, geo, mods);
    StationJoints.pipes(plan, ctx);
    StationJoints.cables(plan, ctx);
    StationJoints.nets(plan, ctx);
    return [...ctx.joints.values()].map((joint, k) => ({
      ...joint,
      n: k + 1,
      list: [...joint.list, StationJoints.EARTH].map((text, idx) => ({ mark: `С${k + 1}.${idx + 1}`, t: text })),
    }));
  }

  /** Стыки, клетка модуля по точке, добавление соединения на стык и путь кабеля от источника. */
  static grid(plan, geo, mods) {
    const [Li, Wi] = plan.int;
    const ox = (geo.ext[0] - Li) / 2;
    const oy = (geo.ext[1] - Wi) / 2;
    const lines = StationMods.lines(geo);
    const num = (i, j) => mods.cells.findIndex(cellAt => cellAt[0] === i && cellAt[1] === j) + 1;
    const cell = (x, y) => [
      Math.min(mods.a - 1, Math.max(0, Math.floor((ox + x) / mods.Lm))),
      Math.min(mods.b - 1, Math.max(0, Math.floor((oy + y) / mods.Wm))),
    ];
    const joints = new Map();
    for (let j = 0; j < mods.b; j++) {
      for (let i = 0; i < mods.a - 1; i++)
        joints.set(StationJoints._key('x', i, j), {
          dir: 'x',
          a: num(i, j),
          b: num(i + 1, j),
          at: lines.x[i],
          list: [],
        });
    }
    for (let i = 0; i < mods.a; i++) {
      for (let j = 0; j < mods.b - 1; j++)
        joints.set(StationJoints._key('y', i, j), {
          dir: 'y',
          a: num(i, j),
          b: num(i, j + 1),
          at: lines.y[j],
          list: [],
        });
    }
    const add = (k, text) => {
      const joint = joints.get(k);
      if (joint && !joint.list.includes(text)) joint.list.push(text);
    };
    return { L: Li, W: Wi, md: mods, J: lines, cell, joints, add };
  }

  /** Трубы: участки вдоль (x) и поперёк (y), пересекающие линии стыков. */
  static pipes(plan, { W: Wi, J: joints, cell, add }) {
    const seg = (x0, y0, x1, y1, text) => {
      if (Math.abs(y1 - y0) < 1) {
        const [from, till] = [Math.min(x0, x1), Math.max(x0, x1)];
        joints.x.forEach(
          (jointX, i) => from < jointX && till > jointX && add(StationJoints._key('x', i, cell(jointX, y0)[1]), text),
        );
      } else if (Math.abs(x1 - x0) < 1) {
        const [from, till] = [Math.min(y0, y1), Math.max(y0, y1)];
        joints.y.forEach(
          (jointY, j) => from < jointY && till > jointY && add(StationJoints._key('y', cell(x0, jointY)[0], j), text),
        );
      }
    };
    const bore = plan.pipe && (plan.pipe.set || plan.pipe.dn);
    for (const line of plan.lines || []) {
      const text = `${StationJoints.what(line, bore)} — разъёмное фланцевое соединение (до DN 40 — разъёмная муфта)`;
      for (const [from, till] of LayoutPipes.runs(line)) seg(from, line.y, till, line.y, text);
      for (const branch of line.branches || []) seg(branch.x, branch.y0, branch.x, branch.y1, text);
      const outPath = LayoutPipes.outPath(line, Wi);
      if (outPath)
        for (let k = 1; k < outPath.pts.length; k++)
          seg(outPath.pts[k - 1][0], outPath.pts[k - 1][1], outPath.pts[k][0], outPath.pts[k][1], text);
    }
  }

  /** Что проходит через стык: трубы, топливо, кабели. */
  static what(line, bore) {
    if (line.medium !== 'air') return StationJoints.MED[line.medium] || 'трубопровод';
    if (line.header) return 'коллектор компрессоров';
    if (line.par) return 'коллектор входов параллельных аппаратов';
    return `магистраль сжатого воздуха${bore ? ` DN ${bore}` : ''}`;
  }

  /** Кабели: от шкафа АВР / ввода (нет шкафа — от двери оператора) к агрегатам в других модулях. */
  static cables(plan, ctx) {
    const items = plan.items || [];
    const cabs = items.filter(i => i.kind === 'cabinet');
    const src = cabs.find(i => /АВР|ввод|ВРУ/i.test(i.name || '')) || cabs[0];
    ctx.src = StationJoints.source(plan, src, ctx.cell);
    const srcT = src ? `шкафа поз. ${src.pos}` : 'ввода';
    const many = new Set(
      items
        .filter(i => items.some(other => other !== i && other.pos === i.pos && other.mount === i.mount))
        .map(i => i.pos),
    );
    const posText = item => `поз. ${item.pos}${many.has(item.pos) ? ` (${(item.unit || 0) + 1})` : ''}`;
    const seen = new Set();
    for (const item of items) {
      const id = `${item.pos}#${item.unit}`;
      if (
        item === src ||
        item.mount === 'pipe' ||
        seen.has(id) ||
        !(StationJoints.POWERED.has(item.kind) || item.kw > 0)
      )
        continue;
      seen.add(id);
      StationJoints.path(
        ctx,
        ctx.cell(item.x + item.lx / 2, item.y + item.ly / 2),
        StationJoints._cable(item, posText(item), srcT),
      );
    }
  }

  /** Модуль, где начинается кабель. */
  static source(plan, src, cell) {
    if (src) return cell(src.x + src.lx / 2, src.y + src.ly / 2);
    const entry = plan.entry;
    return entry && entry.wall === 'front' ? cell((entry.x0 + entry.x1) / 2, 0) : [0, 0];
  }

  static _cable(item, pos, srcT) {
    const name = item.short || item.name;
    if (item.kind === 'dgu') return `силовой кабель и кабели управления ДГУ ${pos} — к ${srcT}`;
    if (item.kind === 'cabinet') return `кабели питания и связи шкафа ${pos} «${name}»`;
    return `кабель питания и управления ${pos} «${name}»${item.kw ? ` (${Mm.text(item.kw)} кВт)` : ''} — от ${srcT}`;
  }

  /** Путь от клетки источника: по длине, затем поперёк — стыки по пути. */
  static path({ src, add }, target, text) {
    let [i, j] = src;
    while (i !== target[0]) {
      const dir = target[0] > i ? 1 : -1;
      add(StationJoints._key('x', Math.min(i, i + dir), j), text);
      i += dir;
    }
    while (j !== target[1]) {
      const dir = target[1] > j ? 1 : -1;
      add(StationJoints._key('y', i, Math.min(j, j + dir)), text);
      j += dir;
    }
  }

  /** Групповые сети каждого модуля (освещение, розетки, ОПС, отопление) — от модуля источника. */
  static nets(plan, ctx) {
    const { L: Li, W: Wi, md: mods, cell, src } = ctx;
    const sys = [
      plan.light && plan.light.on !== false ? 'освещение' : '',
      plan.sockets ? 'розетки' : '',
      plan.fire ? 'ОПС и пожаротушение' : '',
    ].filter(Boolean);
    const heat = (plan.heat && plan.heat.heaters) || [];
    const spotOf = heater => {
      if (heater.wall === 'front' || heater.wall === 'back')
        return [heater.x + heater.lx / 2, heater.wall === 'back' ? Wi - 1 : 1];
      return [heater.wall === 'left' ? 1 : Li - 1, heater.y + heater.ly / 2];
    };
    mods.cells.forEach(([i, j], cellIx) => {
      if (i === src[0] && j === src[1]) return;
      const heaters = heat.filter(heater => {
        const heaterCell = cell(...spotOf(heater));
        return heaterCell[0] === i && heaterCell[1] === j;
      }).length;
      const list = [...sys, heaters ? `отопление (${heaters} шт.)` : ''].filter(Boolean);
      if (list.length)
        StationJoints.path(
          ctx,
          [i, j],
          `групповые сети модуля М${cellIx + 1}: ${list.join(', ')} — разъёмные клеммные коробки у стыка`,
        );
    });
  }

  /** Раздел ТЗ на сборку: таблица по стыкам. */
  static tzSection(plan, doc) {
    const joints = StationJoints.calc(plan);
    if (!joints.length) return;
    doc.h2('Стыки модулей — разъёмные соединения (маркировать при расстыковке)');
    doc.p(
      'На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку расстыковывают только соединения ниже — каждое маркируют с обеих сторон (бирка «С<стык>.<номер>»), концы закрывают заглушками и колпачками, кабели сматывают и крепят внутри модуля. На объекте — стыковка по маркировке, затем проверка плотности трубопровода и сопротивления изоляции кабелей.',
    );
    const rows = joints.flatMap(joint =>
      joint.list.map((row, k) => [
        row.mark,
        k
          ? ''
          : `С${joint.n}: М${joint.a} — М${joint.b} (${joint.dir === 'x' ? 'поперёк, торец к торцу' : 'вдоль, бок о бок'})`,
        row.t,
      ]),
    );
    doc.table([20, 40, 110], ['Маркировка', 'Стык', 'Соединение'], rows);
  }
}
