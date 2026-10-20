import { LayoutMode } from './layout-mode.js';
import { Mm } from './mm.js';
import { StationClear } from './station-clear.js';
import { StationMatrix } from './station-matrix.js';

/**
 * Матрица доступа: у каждого агрегата на полу — 4 стороны (Ф, З, Л, П) и чем к ним подойти: проход, зазор, сервисные
 * ворота, ворота торца, дверь; сторона, которую обслуживать не нужно, — «не требуется»; miss — обслуживаемые без доступа.
 */
export class LayoutAccess {
  static _overlap = (aFrom, aTill, bFrom, bTill) => Math.min(aTill, bTill) - Math.max(aFrom, bFrom) > 50;

  /** Стороны агрегата → направления на плане по тому, куда он смотрит лицом (face). */
  static DIRS = {
    1: { F: '+y', B: '-y', L: '+x', R: '-x' },
    2: { F: '+x', B: '-x', L: '-y', R: '+y' },
    '-2': { F: '-x', B: '+x', L: '+y', R: '-y' },
    '-1': { F: '-y', B: '+y', L: '-x', R: '+x' },
  };

  /** Стена торца по направлению. */
  static END_WALL = { '+x': 'right', '-x': 'left', '+y': 'back' };

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
  gap(res, geo, i, dir) {
    const [Li, Wi] = geo.int;
    const others = res.items.filter(other => other !== i && (other.mount === 'floor' || other.tank));
    const alongX = other => LayoutAccess._overlap(other.x, other.x + other.lx, i.x, i.x + i.lx);
    const alongY = other => LayoutAccess._overlap(other.y, other.y + other.ly, i.y, i.y + i.ly);
    const ways = {
      '-y': () =>
        this.toward(
          others.filter(other => alongX(other) && other.y + other.ly <= i.y + 1),
          near => i.y - Math.max(...near.map(other => other.y + other.ly)),
          i.y,
        ),
      '+y': () =>
        this.toward(
          others.filter(other => alongX(other) && other.y >= i.y + i.ly - 1),
          near => Math.min(...near.map(other => other.y)) - i.y - i.ly,
          Wi - i.y - i.ly,
        ),
      '-x': () =>
        this.toward(
          others.filter(other => alongY(other) && other.x + other.lx <= i.x + 1),
          near => i.x - Math.max(...near.map(other => other.x + other.lx)),
          i.x - (geo.x0 || 0),
        ),
      '+x': () =>
        this.toward(
          others.filter(other => alongY(other) && other.x >= i.x + i.lx - 1),
          near => Math.min(...near.map(other => other.x)) - i.x - i.lx,
          Li - i.x - i.lx,
        ),
    };
    return ways[dir]();
  }

  toward(blocking, toNeighbour, toWall) {
    return blocking.length ? [toNeighbour(blocking), false] : [toWall, true];
  }

  /** Проём в стене напротив агрегата: дверь-жалюзи ДГУ, ворота торца, дверь оператора, сервисные ворота; нет — null. */
  hole(res, i, dir) {
    if ((res.dguDoors || []).some(opening => opening.pos === i.pos && opening.wall === LayoutAccess.END_WALL[dir]))
      return 'дверь-жалюзи ДГУ';
    if (dir === '-x' || dir === '+x') {
      const wall = dir === '-x' ? 'left' : 'right';
      const gate = [res.gates, res.gates2]
        .filter(Boolean)
        .find(opening => opening.wall === wall && LayoutAccess._overlap(opening.y0, opening.y1, i.y, i.y + i.ly));
      if (!gate) return null;
      return gate.sea ? 'штатные двери торца' : 'ворота торца';
    }
    const wall = dir === '+y' ? 'back' : 'front';
    const door = (res.doors || []).find(
      opening => opening.wall === wall && LayoutAccess._overlap(opening.x0, opening.x1, i.x, i.x + i.lx),
    );
    if (!door) return null;
    return door.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота';
  }

  /** Сколько нужно свободно у стороны k: спереди — проход обслуживания, сзади — access.back, сбоку — access.side. */
  needAt(i, k, sideMin) {
    const access = StationMatrix.access();
    const service = StationMatrix.aisle().service;
    const own = { F: service, B: access.back }[k] ?? sideMin;
    const mid = i.kind === 'dgu' && !i.rot && (k === 'F' || k === 'B');
    return mid ? Math.min(StationMatrix.grp('dgu').pass, k === 'F' ? service : access.back) : own;
  }

  /** Малые насосы — по два на общей раме без прохода: сбоку достаточно их отступа. */
  sideMin(i) {
    const small = StationClear.PUMP_SMALL;
    return i.kind === 'pump' && StationClear.of('pump', i) === small ? small.side[1] : StationMatrix.access().side;
  }

  /** Доступ к стороне k агрегата i: {ok, t, g}. */
  sideAccess(res, geo, i, k) {
    const dirs = LayoutAccess.DIRS[i.face] || LayoutAccess.DIRS[-1];
    const [gapWall, wall] = this.gap(res, geo, i, dirs[k]);
    const min = this.needAt(i, k, this.sideMin(i));
    const hole = wall ? this.hole(res, i, dirs[k]) : null;
    if (!StationMatrix.sides(i.kind)[k]) return { ok: true, t: 'не требуется', g: gapWall };
    if (gapWall >= min)
      return { ok: true, t: `${k === 'F' ? 'проход' : 'зазор'} ${Mm.text(Math.round(gapWall))} мм`, g: gapWall };
    if (hole) return { ok: true, t: hole, g: gapWall };
    const beside =
      k === 'F' && i.pair ? Math.max(this.gap(res, geo, i, dirs.L)[0], this.gap(res, geo, i, dirs.R)[0]) : -Infinity;
    if (beside >= StationMatrix.recv().pairSide)
      return {
        ok: true,
        t: `сбоку, через промежуток ${Mm.text(Math.round(beside))} мм (ресиверы в два ряда)`,
        g: gapWall,
      };
    return {
      ok: false,
      t: `${Mm.text(Math.max(0, Math.round(gapWall)))} мм${wall ? ' до стены' : ' до соседнего'}, нужно ${Mm.text(min)}`,
      g: gapWall,
    };
  }

  /** Класс по ширине: узкое — с основным проходом и отступом, широкое — проход «в крайнем случае», сверхширокое — нет. */
  widthClass(i, Wi) {
    const narrow = Math.min(i.l || i.lx, i.w || i.ly);
    const wall = StationMatrix.wall(i) || [0, 0];
    const usableW = Wi - 2 * this.lay.gap;
    if (narrow + StationClear.aisle()[0] + wall[0] <= usableW) return 'узкое';
    return narrow + LayoutMode.TIGHT + wall[1] <= usableW ? 'широкое' : 'сверхширокое';
  }

  matrix(res, geo) {
    const Wi = geo.int[1];
    const floor = res.items.filter(i => i.mount === 'floor' && !i.tank && i.kind !== 'cabinet');
    const total = new Map();
    for (const i of floor) total.set(i.pos, (total.get(i.pos) || 0) + 1);
    const seen = new Map();
    return floor.map(i => {
      const count = (seen.get(i.pos) || 0) + 1;
      seen.set(i.pos, count);
      const sides = Object.fromEntries(['F', 'B', 'L', 'R'].map(k => [k, this.sideAccess(res, geo, i, k)]));
      const miss = ['F', 'B', 'L', 'R'].filter(k => !sides[k].ok);
      return {
        cls: this.widthClass(i, Wi),
        pos: total.get(i.pos) > 1 ? `${i.pos} (${count})` : String(i.pos),
        kind: i.kind,
        name: i.short || i.name,
        s: sides,
        miss,
      };
    });
  }
}
