import { Num } from './num.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/** Аккуратность компоновки: лицевые линии, ровный шаг, проёмы по линиям, оценка 0…100. */
export class StationTidy {
  static WALLS = ['front', 'back', 'left', 'right'];

  /** Правила раздела «Аккуратность» матрицы. */
  static get RULES() {
    return StationMatrix.grp('look');
  }

  /** Подряд идущие элементы списка, для которых same(предыдущий, следующий): [[…], …]. */
  static runs(list, same) {
    const out = [];
    for (let start = 0; start < list.length; ) {
      let end = start;
      while (end + 1 < list.length && same(list[end], list[end + 1])) end++;
      out.push(list.slice(start, end + 1));
      start = end + 1;
    }
    return out;
  }

  /** Промежутки по длине между соседями ряда. */
  static gaps(run) {
    return run.slice(1).map((item, k) => item.x - run[k].x - run[k].lx);
  }

  static _rowOf(items, rowIx) {
    return items.filter(i => i.ri === rowIx).sort((left, right) => left.x - right.x);
  }

  /** Одинаковые соседи в ряду (три и больше) — с равными промежутками; сумма промежутков не меняется. */
  static even(items) {
    if (!this.RULES.even) return;
    const plain = item => !item.pair && !item.end;
    const same = (left, right) =>
      left.ri === right.ri &&
      left.o.e.kind === right.o.e.kind &&
      left.lx === right.lx &&
      left.d === right.d &&
      Boolean(left.o.rot) === Boolean(right.o.rot) &&
      plain(left.o) &&
      plain(right.o);
    for (const rowIx of Num.uniq(items.map(i => i.ri))) {
      for (const run of this.runs(this._rowOf(items, rowIx), same).filter(seq => seq.length >= 3)) this.spread(run);
    }
  }

  /** Ровный шаг между одинаковыми агрегатами. */
  static spread(run) {
    const gaps = this.gaps(run);
    const step = Math.floor(gaps.reduce((acc, v) => acc + v, 0) / gaps.length);
    for (let k = 1; k < run.length; k++) run[k].x = run[k - 1].x + run[k - 1].lx + step;
  }

  /**
   * Оценка аккуратности расстановки или готового плана.
   * @returns {{score: number, good: string[], bad: string[]}}
   */
  static score(res, geo) {
    const acc = { pen: 0, good: [], bad: [] };
    const floor = (res.items || []).filter(
      i => i.mount === 'floor' && !i.cross && !i.pair && !i.tank && i.kind !== 'dgu',
    );
    const rows = this.faces(floor);
    this._scoreFacade(acc, floor, rows);
    this._scoreStep(acc, floor, rows);
    this._scoreGates(acc, res);
    this._scoreLouvers(acc, res);
    this._scoreMain(acc, res);
    this.scoreMods(acc, res, geo);
    return { score: Math.max(0, 100 - acc.pen), good: acc.good, bad: acc.bad };
  }

  /** Лицевые линии рядов: Map ряд → Set линий (с точностью 10 мм). */
  static faces(floor) {
    const rows = new Map();
    for (const i of floor) {
      if (!rows.has(i.row)) rows.set(i.row, new Set());
      rows.get(i.row).add(Math.round((i.face === 1 ? i.y + i.ly : i.y) / 10));
    }
    return rows;
  }

  static _scoreFacade(acc, floor, rows) {
    if (floor.length <= 1) return;
    const extra = [...rows.values()].reduce((total, set) => total + set.size - 1, 0);
    if (!extra) {
      acc.good.push('ряды — по одной лицевой линии');
      return;
    }
    acc.pen += Math.min(30, extra * 8);
    acc.bad.push(`лицевых линий в ряду — ${extra + rows.size} (агрегаты разной глубины у стены)`);
  }

  static _scoreStep(acc, floor, rows) {
    const same = (left, right) => right.kind === left.kind && right.lx === left.lx && right.ly === left.ly;
    const runs = [...rows.keys()].flatMap(k =>
      this.runs(
        floor.filter(i => i.row === k).sort((left, right) => left.x - right.x),
        same,
      ).filter(run => run.length >= 3),
    );
    if (!runs.length) return;
    const uneven = runs.filter(run => {
      const gaps = this.gaps(run);
      return Math.max(...gaps) - Math.min(...gaps) > 10;
    }).length;
    if (!uneven) {
      acc.good.push('одинаковые агрегаты — с равным шагом');
      return;
    }
    acc.pen += uneven * 6;
    acc.bad.push('промежутки между одинаковыми агрегатами разные');
  }

  static _scoreGates(acc, res) {
    for (const wall of ['front', 'back']) {
      const heights = new Set(
        (res.doors || []).filter(door => door.kind !== 'entry' && door.wall === wall).map(door => door.h),
      );
      if (heights.size <= 1) continue;
      acc.pen += 5 * (heights.size - 1);
      acc.bad.push('сервисные ворота на одной стене — разной высоты');
    }
  }

  static _scoreLouvers(acc, res) {
    const louvers = (res.vent && res.vent.louvers) || [];
    if (!louvers.length) return;
    let off = 0;
    for (const wall of StationTidy.WALLS) {
      for (const [kind, key] of [
        ['out', 'z1'],
        ['in', 'z0'],
      ]) {
        const lines = new Set(this._plainLouvers(louvers, wall, kind).map(item => item[key]));
        if (lines.size > 1) off += lines.size - 1;
      }
    }
    if (!off) {
      acc.good.push('жалюзи — по общим линиям');
      return;
    }
    acc.pen += off * 4;
    acc.bad.push('жалюзи на стене — не по одной линии (мешают ворота, двери или шкафы)');
  }

  static _plainLouvers(louvers, wall, kind) {
    return louvers.filter(item => item.wall === wall && item.kind === kind && !item.leaf && !item.door);
  }

  static _scoreMain(acc, res) {
    const air = (res.lines || []).filter(line => line.medium === 'air' && !line.header && !line.par);
    if (air.length) acc.good.push(`магистраль — на одной высоте ${Mm.text(air[0].z)} мм`);
  }

  static GROUP = { compressor: 'a', dgu: 'a', pump: 'a', dryer: 'b', filter: 'b', receiver: 'b' };

  /** Станция из модулей: стыки между группами оборудования и массы модулей. */
  static scoreMods(acc, res, geo) {
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm) return;
    const content = StationMods.content({ geo, items: res.items, int: geo.int || res.int });
    const kindOf = new Map((res.items || []).map(i => [i.pos, i.kind]));
    const groups = list => new Set(list.map(item => this.GROUP[kindOf.get(item.pos)] || '').filter(Boolean));
    const mixed = [...content.values()].filter(list => groups(list).size > 1).length;
    if (mixed) {
      acc.pen += mixed * 5;
      acc.bad.push(`модулей с агрегатами и подготовкой воздуха вместе — ${mixed}`);
    } else if (content.size > 1) acc.good.push('стыки — между группами оборудования');
    this._scoreMass(acc, res, geo, mods);
  }

  static _scoreMass(acc, res, geo, mods) {
    const ox = (geo.ext[0] - geo.int[0]) / 2;
    const oy = (geo.ext[1] - geo.int[1]) / 2;
    const cellOf = item => [
      Math.floor((ox + item.x + item.lx / 2) / mods.Lm),
      Math.floor((oy + item.y + item.ly / 2) / mods.Wm),
    ];
    const heavy = (res.items || []).filter(item => item.mass > 0);
    const mass = mods.cells
      .map(([i, j]) =>
        heavy
          .filter(item => {
            const [cellX, cellY] = cellOf(item);
            return cellX === i && cellY === j;
          })
          .reduce((total, item) => total + item.mass, 0),
      )
      .filter(v => v > 0);
    const most = Math.max(0, ...mass);
    if (!(most > 0) || mass.length <= 1) return;
    const least = Math.min(...mass);
    const k = least > 0 ? most / least : 3;
    if (k <= 2) return;
    acc.pen += Math.min(15, Math.round((k - 2) * 5));
    const times = k >= 3 ? 'три и более' : Mm.dec(Math.round(k * 10) / 10);
    acc.bad.push(`масса модулей неравная (самый тяжёлый — в ${times} раза тяжелее лёгкого)`);
  }

  /** Строка в «Компоновке»: « · аккуратность 92 из 100». */
  static line(plan) {
    const tidy = plan && plan.tidy;
    return tidy ? ` · аккуратность ${tidy.score} из 100` : '';
  }

  /** Сервисные ворота на одной стене — одной высоты (по самым высоким). */
  static doors(doors) {
    if (!this.RULES.lines || !doors) return;
    for (const wall of ['front', 'back']) {
      const same = doors.filter(door => door.kind !== 'entry' && door.wall === wall);
      if (same.length < 2) continue;
      const height = Math.max(...same.map(door => door.h));
      for (const door of same) door.h = height;
    }
  }

  /**
   * Жалюзи на стене — по общим линиям: выброс по верху самого высокого, приток по низу самого низкого (если место
   * свободно); жалюзи с воздуховодом — опора линии, не двигаются.
   * @param {object[]} L жалюзи
   * @param {{B: object, free: Function}} walls занятость стен
   */
  static louvers(louvers, walls, Hi, gap) {
    if (!this.RULES.lines) return;
    for (const wall of StationTidy.WALLS) {
      for (const top of [true, false]) {
        const same = this._plainLouvers(louvers, wall, top ? 'out' : 'in');
        if (same.length >= 2) this._alignLouvers(same, { w: wall, top, walls, H: Hi, gap });
      }
    }
  }

  static _alignLouvers(same, { w: wall, top, walls, H: Hi, gap }) {
    const line = top ? Math.max(...same.map(item => item.z1)) : Math.min(...same.map(item => item.z0));
    const bounds = walls.hard[wall];
    const drop = box => {
      const i = bounds.findIndex(x => x.every((v, k) => v === box[k]));
      if (i >= 0) bounds.splice(i, 1);
      return i >= 0;
    };
    for (const item of same.filter(x => !x.duct)) {
      const dz = line - (top ? item.z1 : item.z0);
      if (!dz || item.z1 + dz > Hi - 100 || item.z0 + dz < 0) continue;
      const box = [item.u0 - 90 - gap, item.u1 + 260 + gap, item.z0 - 90, item.z1 + 90];
      const had = drop(box);
      if (walls.free(wall, [item.u0 - 90, item.u1 + 90], [item.z0 + dz - 90, item.z1 + dz + 90], false)) {
        item.z0 += dz;
        item.z1 += dz;
        bounds.push([box[0], box[1], box[2] + dz, box[3] + dz]);
      } else if (had) bounds.push(box);
    }
  }

  /**
   * Лицевая линия ряда — общая, где это ничего не ухудшает: к стене агрегат отходит, пока сзади остаётся рекомендуемый
   * отступ, к проходу — пока проход не уже рекомендуемого (или на ≤ 50 мм); сдвиг не больше look.align.
   */
  static facade(items, Wi, rows, aRec) {
    const lim = this.RULES.align;
    if (!(lim > 0)) return;
    const units = items.filter(i => !i.o.e.slot && !i.o.e.cross && !i.o.end && !i.o.pair && i.o.e.kind !== 'dgu');
    for (const rowIx of Num.uniq(units.map(i => i.ri))) {
      const row = units.filter(i => i.ri === rowIx);
      if (row.length >= 2) this._alignRow(row, { W: Wi, rows, aRec, lim });
    }
  }

  static _alignRow(row, { W: Wi, rows, aRec, lim }) {
    const front = row[0].face === 1;
    const face = item => (front ? item.y + item.d : item.y);
    const can = (item, line) => {
      const dv = line - face(item);
      if (Math.abs(dv) > lim) return false;
      if (!dv) return true;
      if (front ? dv < 0 : dv > 0) return (front ? line - item.d : Wi - line - item.d) >= item.o.e.c.back[0];
      return Math.abs(dv) <= 50 || rows === 2 || front || line >= aRec;
    };
    let best = null;
    for (const line of Num.uniq(row.map(face))) {
      const count = row.filter(item => can(item, line)).length;
      if (!best || count > best.n) best = { t: line, n: count };
    }
    if (!best || best.n < 2) return;
    for (const item of row.filter(x => can(x, best.t))) {
      if (front) {
        item.y = best.t - item.d;
        item.back = item.y;
      } else {
        item.y = best.t;
        item.back = Wi - best.t - item.d;
        if (rows !== 2) item.aisle = best.t;
      }
    }
  }
}
