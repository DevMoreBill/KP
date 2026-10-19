import { LayoutItem } from './layout-item.js';
import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { TankSize } from './tank-size.js';

/**
 * Отсек дополнительного топливного бака ДГУ у ближнего торца: противопожарная перегородка, вход — ворота в торце
 * (tank.gates) или своя дверь, горловина — в нише стены, бак — в поддоне вдоль задней стены.
 */
export class LayoutTank {
  static get M() {
    return StationMatrix.tank();
  }

  /**
   * Отсек: {units — [{e, lx, ly}], room — длина внутри, len — с перегородкой}; нет ДГУ или бака — null. Бак без своих
   * габаритов — по объёму под этот отсек (с воротами — до ширины контейнера, с дверью — оставляя проход перед ним).
   */
  static room(units, Wi, Hi, sea, gMax = Wi) {
    const T = units.filter(e => e.kind === 'tank');
    if (!T.length || !units.some(e => e.kind === 'dgu')) return null;
    const C = this.M;
    const pass = StationMatrix.move().pass;
    const deep = C.gates && !sea ? Math.min(Wi - 2 * C.back, gMax - 2 * pass) : Wi - C.back - C.aisle;
    for (const e of T.filter(x => !x.known)) {
      const d = TankSize.of(e.vol || 1000, { h: (Hi || TankSize.H) - C.top, w: deep });
      Object.assign(e, { l: d.l, w: d.w, h: d.h });
    }
    const U = T.map(e => {
      const long = Math.max(e.l, e.w);
      const short = Math.min(e.l, e.w);
      return long <= deep ? { e, lx: short, ly: long } : { e, lx: long, ly: short };
    });
    const body = U.reduce((s, u) => s + u.lx, 0) + C.gap * (U.length - 1);
    const room = Math.max(body + 2 * C.pad, C.door + 2 * C.pad);
    return { units: U, room, len: room + C.part };
  }

  /** Баки — в отсеке вдоль задней стены; вход и горловина; проход перед баком и высота отсека — замечания. */
  static place(r, geo, tank) {
    const [, W, H] = geo.int;
    const C = this.M;
    let x = C.pad;
    for (const { e, lx, ly } of tank.units) {
      const y = Math.max(0, W - C.back - ly);
      r.items.push(
        LayoutItem.unit(e, {
          x,
          y,
          z: 0,
          lx,
          ly,
          rot: lx < e.l,
          mount: 'floor',
          face: -1,
          row: 0,
          back: C.back,
          aisle: y,
          tank: true,
        }),
      );
      x += lx + C.gap;
    }
    const T = r.items.filter(i => i.tank);
    const d0 = Math.round((tank.room - C.door) / 2);
    const f = T[0];
    const fill = geo.sea
      ? { wall: 'back', x: Math.round(f.x + f.lx / 2), z: C.fill }
      : { wall: 'left', y: Math.round(f.y + f.ly / 2), z: C.fill };
    r.fuel = { x1: tank.room, part: C.part, door: { x0: d0, x1: d0 + C.door }, fill };
    if (C.gates && !geo.sea) this.gate(r, geo, T, tank);
    r.fuel.fill.niche = true;
    this.check(r, T, H);
  }

  /** Вход в отсек — двустворчатые ворота в торце напротив баков; горловина — в торце рядом, не встала — в стене прохода. */
  static gate(r, geo, T, tank) {
    const [, W, H] = geo.int;
    const C = this.M;
    const Q = LayoutOpening.gaps(geo);
    const [a, b] = T.reduce((s, i) => [Math.min(s[0], i.y), Math.max(s[1], i.y + i.ly)], [W, 0]);
    const w = Math.min(W - 2 * Q.eW, LayoutOpening.dguDoorW(b - a));
    const y0 = Math.round(Math.max(Q.eW, Math.min(W - Q.eW - w, (a + b) / 2 - w / 2)));
    const h = Math.min(H - 100, Math.max(LayoutOpening.DOOR.h, Math.max(...T.map(i => i.h)) + 150));
    r.fuel.door = null;
    r.fuel.gate = { wall: 'left', y0, y1: y0 + w, w, h, leaves: 2 };
    const fy = y0 - Q.gap - 150;
    r.fuel.fill =
      fy - 150 >= Q.eW
        ? { wall: 'left', y: Math.round(fy), z: C.fill }
        : { wall: 'front', x: Math.round(tank.room / 2), z: C.fill };
  }

  static check(r, T, H) {
    const C = this.M;
    const n = v => Mm.text(v);
    const iss = (r.issues = r.issues || []);
    const aisle = Math.min(...T.map(i => i.y));
    if (aisle < C.aisle && !r.fuel.gate) {
      iss.push({
        level: 'warn',
        text: `Отсек топливного бака: проход перед баком ${n(aisle)} мм — меньше ${n(C.aisle)} мм.`,
      });
    }
    for (const i of T.filter(x => x.h + 200 > H)) {
      r.bad = true;
      iss.push({
        level: 'error',
        text: `Топливный бак поз. ${i.pos} не проходит по высоте отсека: ${n(i.h)} мм, внутри ${n(H)} мм.`,
      });
    }
  }
}
