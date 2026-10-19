import { LayoutMode } from './layout-mode.js';
import { Mm } from './mm.js';
import { StationClear } from './station-clear.js';
import { StationMatrix } from './station-matrix.js';

const n = v => Mm.text(v);
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 50;

/** Стороны агрегата → направления на плане по тому, куда он смотрит лицом (face). */
const DIRS = {
  1: { F: '+y', B: '-y', L: '+x', R: '-x' },
  2: { F: '+x', B: '-x', L: '-y', R: '+y' },
  '-2': { F: '-x', B: '+x', L: '+y', R: '-y' },
  '-1': { F: '-y', B: '+y', L: '-x', R: '+x' },
};

/** Стена торца по направлению. */
const END_WALL = { '+x': 'right', '-x': 'left', '+y': 'back' };

/**
 * Матрица доступа: у каждого агрегата на полу — 4 стороны (Ф, З, Л, П) и чем к ним подойти: проход, зазор, сервисные
 * ворота, ворота торца, дверь; сторона, которую обслуживать не нужно, — «не требуется»; miss — обслуживаемые без доступа.
 */
export class LayoutAccess {
  static SIDE = {
    F: ['спереди', 'лицевой стороне'],
    B: ['сзади', 'задней стороне'],
    L: ['слева', 'левому боку'],
    R: ['справа', 'правому боку'],
  };

  constructor(lay) {
    this.lay = lay;
  }

  side(k) {
    return LayoutAccess.SIDE[k][1];
  }

  /** Свободно от агрегата в направлении d: [мм, до стены]. */
  gap(r, geo, i, d) {
    const [L, W] = geo.int;
    const O = r.items.filter(o => o !== i && (o.mount === 'floor' || o.tank));
    const alongX = o => overlap(o.x, o.x + o.lx, i.x, i.x + i.lx);
    const alongY = o => overlap(o.y, o.y + o.ly, i.y, i.y + i.ly);
    const ways = {
      '-y': () =>
        this.toward(
          O.filter(o => alongX(o) && o.y + o.ly <= i.y + 1),
          b => i.y - Math.max(...b.map(o => o.y + o.ly)),
          i.y,
        ),
      '+y': () =>
        this.toward(
          O.filter(o => alongX(o) && o.y >= i.y + i.ly - 1),
          b => Math.min(...b.map(o => o.y)) - i.y - i.ly,
          W - i.y - i.ly,
        ),
      '-x': () =>
        this.toward(
          O.filter(o => alongY(o) && o.x + o.lx <= i.x + 1),
          b => i.x - Math.max(...b.map(o => o.x + o.lx)),
          i.x - (geo.x0 || 0),
        ),
      '+x': () =>
        this.toward(
          O.filter(o => alongY(o) && o.x >= i.x + i.lx - 1),
          b => Math.min(...b.map(o => o.x)) - i.x - i.lx,
          L - i.x - i.lx,
        ),
    };
    return ways[d]();
  }

  toward(blocking, toNeighbour, toWall) {
    return blocking.length ? [toNeighbour(blocking), false] : [toWall, true];
  }

  /** Проём в стене напротив агрегата: дверь-жалюзи ДГУ, ворота торца, дверь оператора, сервисные ворота; нет — null. */
  hole(r, i, d) {
    if ((r.dguDoors || []).some(q => q.pos === i.pos && q.wall === END_WALL[d])) return 'дверь-жалюзи ДГУ';
    if (d === '-x' || d === '+x') {
      const wall = d === '-x' ? 'left' : 'right';
      const g = [r.gates, r.gates2].filter(Boolean).find(q => q.wall === wall && overlap(q.y0, q.y1, i.y, i.y + i.ly));
      if (!g) return null;
      return g.sea ? 'штатные двери торца' : 'ворота торца';
    }
    const wall = d === '+y' ? 'back' : 'front';
    const door = (r.doors || []).find(q => q.wall === wall && overlap(q.x0, q.x1, i.x, i.x + i.lx));
    if (!door) return null;
    return door.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота';
  }

  /** Сколько нужно свободно у стороны k: спереди — проход обслуживания, сзади — access.back, сбоку — access.side. */
  needAt(i, k, sideMin) {
    const A = StationMatrix.access();
    const sv = StationMatrix.aisle().service;
    const own = { F: sv, B: A.back }[k] ?? sideMin;
    const mid = i.kind === 'dgu' && !i.rot && (k === 'F' || k === 'B');
    return mid ? Math.min(StationMatrix.grp('dgu').pass, k === 'F' ? sv : A.back) : own;
  }

  /** Малые насосы — по два на общей раме без прохода: сбоку достаточно их отступа. */
  sideMin(i) {
    const small = StationClear.PUMP_SMALL;
    return i.kind === 'pump' && StationClear.of('pump', i) === small ? small.side[1] : StationMatrix.access().side;
  }

  /** Доступ к стороне k агрегата i: {ok, t, g}. */
  sideAccess(r, geo, i, k) {
    const D = DIRS[i.face] || DIRS[-1];
    const [g, wall] = this.gap(r, geo, i, D[k]);
    const min = this.needAt(i, k, this.sideMin(i));
    const hole = wall ? this.hole(r, i, D[k]) : null;
    if (!StationMatrix.sides(i.kind)[k]) return { ok: true, t: 'не требуется', g };
    if (g >= min) return { ok: true, t: `${k === 'F' ? 'проход' : 'зазор'} ${n(Math.round(g))} мм`, g };
    if (hole) return { ok: true, t: hole, g };
    const beside = k === 'F' && i.pair ? Math.max(this.gap(r, geo, i, D.L)[0], this.gap(r, geo, i, D.R)[0]) : -Infinity;
    if (beside >= StationMatrix.recv().pairSide)
      return { ok: true, t: `сбоку, через промежуток ${n(Math.round(beside))} мм (ресиверы в два ряда)`, g };
    return {
      ok: false,
      t: `${n(Math.max(0, Math.round(g)))} мм${wall ? ' до стены' : ' до соседнего'}, нужно ${n(min)}`,
      g,
    };
  }

  /** Класс по ширине: узкое — с основным проходом и отступом, широкое — проход «в крайнем случае», сверхширокое — нет. */
  widthClass(i, W) {
    const narrow = Math.min(i.l || i.lx, i.w || i.ly);
    const wall = StationMatrix.wall(i) || [0, 0];
    const Wu = W - 2 * this.lay.G;
    if (narrow + StationClear.aisle()[0] + wall[0] <= Wu) return 'узкое';
    return narrow + LayoutMode.TIGHT + wall[1] <= Wu ? 'широкое' : 'сверхширокое';
  }

  matrix(r, geo) {
    const W = geo.int[1];
    const floor = r.items.filter(i => i.mount === 'floor' && !i.tank && i.kind !== 'cabinet');
    const total = new Map();
    for (const i of floor) total.set(i.pos, (total.get(i.pos) || 0) + 1);
    const seen = new Map();
    return floor.map(i => {
      const k1 = (seen.get(i.pos) || 0) + 1;
      seen.set(i.pos, k1);
      const s = Object.fromEntries(['F', 'B', 'L', 'R'].map(k => [k, this.sideAccess(r, geo, i, k)]));
      const miss = ['F', 'B', 'L', 'R'].filter(k => !s[k].ok);
      return {
        cls: this.widthClass(i, W),
        pos: total.get(i.pos) > 1 ? `${i.pos} (${k1})` : String(i.pos),
        kind: i.kind,
        name: i.short || i.name,
        s,
        miss,
      };
    });
  }
}
