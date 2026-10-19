import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

const WALLS = ['front', 'back', 'left', 'right'];
const unique = list => [...new Set(list)];

/** Аккуратность компоновки: лицевые линии, ровный шаг, проёмы по линиям, оценка 0…100. */
export class StationTidy {
  static get M() {
    return StationMatrix.grp('look');
  }

  /** Подряд идущие элементы списка, для которых same(предыдущий, следующий): [[…], …]. */
  static runs(list, same) {
    const out = [];
    for (let a = 0; a < list.length; ) {
      let b = a;
      while (b + 1 < list.length && same(list[b], list[b + 1])) b++;
      out.push(list.slice(a, b + 1));
      a = b + 1;
    }
    return out;
  }

  /** Промежутки по длине между соседями ряда. */
  static gaps(run) {
    return run.slice(1).map((it, k) => it.x - run[k].x - run[k].lx);
  }

  static rowOf(items, ri) {
    return items.filter(i => i.ri === ri).sort((p, q) => p.x - q.x);
  }

  /** Одинаковые соседи в ряду (три и больше) — с равными промежутками; сумма промежутков не меняется. */
  static even(items) {
    if (!this.M.even) return;
    const plain = o => !o.pair && !o.end;
    const same = (a, b) =>
      a.ri === b.ri &&
      a.o.e.kind === b.o.e.kind &&
      a.lx === b.lx &&
      a.d === b.d &&
      Boolean(a.o.rot) === Boolean(b.o.rot) &&
      plain(a.o) &&
      plain(b.o);
    for (const ri of unique(items.map(i => i.ri))) {
      for (const run of this.runs(this.rowOf(items, ri), same).filter(r => r.length >= 3)) this.spread(run);
    }
  }

  static spread(run) {
    const g = this.gaps(run);
    const step = Math.floor(g.reduce((s, v) => s + v, 0) / g.length);
    for (let k = 1; k < run.length; k++) run[k].x = run[k - 1].x + run[k - 1].lx + step;
  }

  /**
   * Оценка аккуратности расстановки или готового плана.
   * @returns {{score: number, good: string[], bad: string[]}}
   */
  static score(r, geo) {
    const acc = { pen: 0, good: [], bad: [] };
    const floor = (r.items || []).filter(
      i => i.mount === 'floor' && !i.cross && !i.pair && !i.tank && i.kind !== 'dgu',
    );
    const rows = this.faces(floor);
    this.scoreFacade(acc, floor, rows);
    this.scoreStep(acc, floor, rows);
    this.scoreGates(acc, r);
    this.scoreLouvers(acc, r);
    this.scoreMain(acc, r);
    this.scoreMods(acc, r, geo);
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

  static scoreFacade(acc, floor, rows) {
    if (floor.length <= 1) return;
    const extra = [...rows.values()].reduce((s, set) => s + set.size - 1, 0);
    if (!extra) {
      acc.good.push('ряды — по одной лицевой линии');
      return;
    }
    acc.pen += Math.min(30, extra * 8);
    acc.bad.push(`лицевых линий в ряду — ${extra + rows.size} (агрегаты разной глубины у стены)`);
  }

  static scoreStep(acc, floor, rows) {
    const same = (a, b) => b.kind === a.kind && b.lx === a.lx && b.ly === a.ly;
    const runs = [...rows.keys()].flatMap(k =>
      this.runs(
        floor.filter(i => i.row === k).sort((a, b) => a.x - b.x),
        same,
      ).filter(run => run.length >= 3),
    );
    if (!runs.length) return;
    const uneven = runs.filter(run => {
      const g = this.gaps(run);
      return Math.max(...g) - Math.min(...g) > 10;
    }).length;
    if (!uneven) {
      acc.good.push('одинаковые агрегаты — с равным шагом');
      return;
    }
    acc.pen += uneven * 6;
    acc.bad.push('промежутки между одинаковыми агрегатами разные');
  }

  static scoreGates(acc, r) {
    for (const w of ['front', 'back']) {
      const heights = new Set((r.doors || []).filter(d => d.kind !== 'entry' && d.wall === w).map(d => d.h));
      if (heights.size <= 1) continue;
      acc.pen += 5 * (heights.size - 1);
      acc.bad.push('сервисные ворота на одной стене — разной высоты');
    }
  }

  static scoreLouvers(acc, r) {
    const L = (r.vent && r.vent.louvers) || [];
    if (!L.length) return;
    let off = 0;
    for (const w of WALLS) {
      for (const [kind, key] of [
        ['out', 'z1'],
        ['in', 'z0'],
      ]) {
        const lines = new Set(this.plainLouvers(L, w, kind).map(q => q[key]));
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

  static plainLouvers(L, wall, kind) {
    return L.filter(q => q.wall === wall && q.kind === kind && !q.leaf && !q.door);
  }

  static scoreMain(acc, r) {
    const air = (r.lines || []).filter(l => l.medium === 'air' && !l.header && !l.par);
    if (air.length) acc.good.push(`магистраль — на одной высоте ${Mm.text(air[0].z)} мм`);
  }

  static GROUP = { compressor: 'a', dgu: 'a', pump: 'a', dryer: 'b', filter: 'b', receiver: 'b' };

  /** Станция из модулей: стыки между группами оборудования и массы модулей. */
  static scoreMods(acc, r, geo) {
    const md = geo && geo.mods;
    if (!md || !md.Lm) return;
    const content = StationMods.content({ geo, items: r.items, int: geo.int || r.int });
    const kindOf = new Map((r.items || []).map(i => [i.pos, i.kind]));
    const groups = list => new Set(list.map(q => this.GROUP[kindOf.get(q.pos)] || '').filter(Boolean));
    const mixed = [...content.values()].filter(list => groups(list).size > 1).length;
    if (mixed) {
      acc.pen += mixed * 5;
      acc.bad.push(`модулей с агрегатами и подготовкой воздуха вместе — ${mixed}`);
    } else if (content.size > 1) acc.good.push('стыки — между группами оборудования');
    this.scoreMass(acc, r, geo, md);
  }

  static scoreMass(acc, r, geo, md) {
    const ox = (geo.ext[0] - geo.int[0]) / 2;
    const oy = (geo.ext[1] - geo.int[1]) / 2;
    const cellOf = q => [Math.floor((ox + q.x + q.lx / 2) / md.Lm), Math.floor((oy + q.y + q.ly / 2) / md.Wm)];
    const heavy = (r.items || []).filter(q => q.mass > 0);
    const mass = md.cells
      .map(([i, j]) =>
        heavy
          .filter(q => {
            const [a, b] = cellOf(q);
            return a === i && b === j;
          })
          .reduce((s, q) => s + q.mass, 0),
      )
      .filter(v => v > 0);
    const hi = Math.max(0, ...mass);
    if (!(hi > 0) || mass.length <= 1) return;
    const lo = Math.min(...mass);
    const k = lo > 0 ? hi / lo : 3;
    if (k <= 2) return;
    acc.pen += Math.min(15, Math.round((k - 2) * 5));
    const times = k >= 3 ? 'три и более' : Mm.dec(Math.round(k * 10) / 10);
    acc.bad.push(`масса модулей неравная (самый тяжёлый — в ${times} раза тяжелее лёгкого)`);
  }

  /** Строка в «Компоновке»: « · аккуратность 92 из 100». */
  static line(plan) {
    const t = plan && plan.tidy;
    return t ? ` · аккуратность ${t.score} из 100` : '';
  }

  /** Сервисные ворота на одной стене — одной высоты (по самым высоким). */
  static doors(D) {
    if (!this.M.lines || !D) return;
    for (const w of ['front', 'back']) {
      const same = D.filter(d => d.kind !== 'entry' && d.wall === w);
      if (same.length < 2) continue;
      const h = Math.max(...same.map(d => d.h));
      for (const d of same) d.h = h;
    }
  }

  /**
   * Жалюзи на стене — по общим линиям: выброс по верху самого высокого, приток по низу самого низкого (если место
   * свободно); жалюзи с воздуховодом — опора линии, не двигаются.
   * @param {object[]} L жалюзи
   * @param {{B: object, free: Function}} walls занятость стен
   */
  static louvers(L, walls, H, gap) {
    if (!this.M.lines) return;
    for (const w of WALLS) {
      for (const top of [true, false]) {
        const same = this.plainLouvers(L, w, top ? 'out' : 'in');
        if (same.length >= 2) this.alignLouvers(same, { w, top, walls, H, gap });
      }
    }
  }

  static alignLouvers(same, { w, top, walls, H, gap }) {
    const line = top ? Math.max(...same.map(q => q.z1)) : Math.min(...same.map(q => q.z0));
    const B = walls.B[w];
    const drop = box => {
      const i = B.findIndex(x => x.every((v, k) => v === box[k]));
      if (i >= 0) B.splice(i, 1);
      return i >= 0;
    };
    for (const q of same.filter(x => !x.duct)) {
      const dz = line - (top ? q.z1 : q.z0);
      if (!dz || q.z1 + dz > H - 100 || q.z0 + dz < 0) continue;
      const box = [q.u0 - 90 - gap, q.u1 + 260 + gap, q.z0 - 90, q.z1 + 90];
      const had = drop(box);
      if (walls.free(w, q.u0 - 90, q.u1 + 90, q.z0 + dz - 90, q.z1 + dz + 90, false)) {
        q.z0 += dz;
        q.z1 += dz;
        B.push([box[0], box[1], box[2] + dz, box[3] + dz]);
      } else if (had) B.push(box);
    }
  }

  /**
   * Лицевая линия ряда — общая, где это ничего не ухудшает: к стене агрегат отходит, пока сзади остаётся рекомендуемый
   * отступ, к проходу — пока проход не уже рекомендуемого (или на ≤ 50 мм); сдвиг не больше look.align.
   */
  static facade(items, W, rows, aRec) {
    const lim = this.M.align;
    if (!(lim > 0)) return;
    const eq = items.filter(i => !i.o.e.slot && !i.o.e.cross && !i.o.end && !i.o.pair && i.o.e.kind !== 'dgu');
    for (const ri of unique(eq.map(i => i.ri))) {
      const row = eq.filter(i => i.ri === ri);
      if (row.length >= 2) this.alignRow(row, { W, rows, aRec, lim });
    }
  }

  static alignRow(row, { W, rows, aRec, lim }) {
    const front = row[0].face === 1;
    const face = it => (front ? it.y + it.d : it.y);
    const can = (it, t) => {
      const dv = t - face(it);
      if (Math.abs(dv) > lim) return false;
      if (!dv) return true;
      if (front ? dv < 0 : dv > 0) return (front ? t - it.d : W - t - it.d) >= it.o.e.c.back[0];
      return Math.abs(dv) <= 50 || rows === 2 || front || t >= aRec;
    };
    let best = null;
    for (const t of unique(row.map(face))) {
      const n = row.filter(it => can(it, t)).length;
      if (!best || n > best.n) best = { t, n };
    }
    if (!best || best.n < 2) return;
    for (const it of row.filter(x => can(x, best.t))) {
      if (front) {
        it.y = best.t - it.d;
        it.back = it.y;
      } else {
        it.y = best.t;
        it.back = W - best.t - it.d;
        if (rows !== 2) it.aisle = best.t;
      }
    }
  }
}
