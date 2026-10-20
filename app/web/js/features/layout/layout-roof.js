import { AirChain } from './air-chain.js';
import { LayoutItem } from './layout-item.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';

/** Снаружи помещения: глушители ДГУ на крыше, выхлоп через стену, ресиверы на площадке за дальним торцом. */
export class LayoutRoof {
  static _mid = (start, len) => start + len / 2;

  static CHASSIS_H = 1150;
  static ROAD_H = 4000;

  /**
   * Глушитель — над своей ДГУ на опорах, выхлоп вбок; хоть у одной ДГУ глушитель на крыше — на крыше у всех (недостающие
   * — как последний в составе). ДГУ поперёк — глушитель вдоль неё, выхлоп к задней стене.
   */
  static roof(plan, equip) {
    const mufflers = equip.filter(unit => unit.kind === 'muffler' && unit.roof);
    if (!mufflers.length) return [];
    const [Li] = plan.int;
    const dgu = plan.items.filter(i => i.kind === 'dgu' && !i.tank).sort((left, right) => left.x - right.x);
    const ctx = { plan, ow: this.overhang(plan), next: Math.max(100, Li / 2 - mufflers[0].l / 2) };
    return this.units(mufflers, dgu.length).map(([muffler, u], k) => this.muffler(muffler, u, dgu[k], ctx));
  }

  /** Выступ крыши за стену, мм. */
  static overhang(plan) {
    const ext = plan.geo && plan.geo.ext;
    return ext ? (ext[1] - plan.int[1]) / 2 : 100;
  }

  /** Глушители по единицам: [элемент, номер]; на каждую ДГУ — по одному. */
  static units(mufflers, dguCount) {
    const all = mufflers.flatMap(muffler => Array.from({ length: muffler.qty }, (_, u) => [muffler, u]));
    for (let u = all.length; u < dguCount; u++) {
      const muffler = all[all.length - 1][0];
      all.push([muffler, u - all.filter(pair => pair[0] !== muffler).length]);
    }
    return all;
  }

  /** Глушитель на крыше над своей ДГУ. */
  static muffler(muffler, u, dgu, ctx) {
    const spot = {
      pos: muffler.pos,
      unit: u,
      name: muffler.name,
      brief: muffler.brief,
      short: muffler.short,
      kind: 'muffler',
      h: muffler.w,
      d: muffler.w,
      known: muffler.known,
      mass: muffler.mass,
      color: muffler.color,
      gap: StationMatrix.muffler().gap,
      outlet: StationMatrix.muffler().outlet,
      dgu: dgu ? { pos: dgu.pos, unit: dgu.unit } : null,
    };
    const rad = (dgu && dgu.rad) || 'right';
    return rad === 'back' ? this.across(spot, muffler, dgu, ctx) : this.along(spot, muffler, dgu, rad, ctx);
  }

  /** ДГУ поперёк: глушитель по ширине станции над ней, выхлоп — над радиатором. */
  static across(spot, muffler, dgu, { plan, ow: overhang }) {
    const [Li, Wi] = plan.int;
    const depth = spot.d;
    const len = Math.min(muffler.l, Wi + 2 * overhang - 80);
    const y = Math.round(
      Math.max(-overhang + 40, Math.min(Wi + overhang - 40 - len, LayoutRoof._mid(dgu.y, dgu.ly) - len / 2)),
    );
    const x = Math.round(Math.max(100, Math.min(Li - 100 - depth, LayoutRoof._mid(dgu.x, dgu.lx) - depth / 2)));
    const exhaust = {
      x: Math.round(LayoutRoof._mid(dgu.x, dgu.lx)),
      y: Math.round(Math.max(y + 120, Math.min(y + len - 120, dgu.y + dgu.ly * 0.62))),
      z: dgu.h,
    };
    return { ...spot, x, y, lx: depth, ly: len, dir: 'y+', exhaust };
  }

  /** ДГУ вдоль: глушитель по длине над ней (без ДГУ — подряд по середине), выхлоп — в сторону радиатора. */
  static along(spot, muffler, dgu, rad, ctx) {
    const { plan, ow: overhang } = ctx;
    const [Li, Wi] = plan.int;
    const depth = spot.d;
    const len = Math.min(muffler.l, Li - 200);
    const centerX = dgu ? LayoutRoof._mid(dgu.x, dgu.lx) : ctx.next + len / 2;
    const x = Math.round(Math.max(100, Math.min(Li - 100 - len, centerX - len / 2)));
    const y = Math.round(
      dgu
        ? Math.max(-overhang + 40, Math.min(Wi + overhang - 40 - depth, LayoutRoof._mid(dgu.y, dgu.ly) - depth / 2))
        : Wi / 2 - depth / 2,
    );
    const exhaust = dgu
      ? {
          x: Math.round(Math.max(x + 120, Math.min(x + len - 120, dgu.x + dgu.lx * (rad === 'left' ? 0.38 : 0.62)))),
          y: Math.round(LayoutRoof._mid(dgu.y, dgu.ly)),
          z: dgu.h,
        }
      : null;
    ctx.next = x + len + 300;
    return { ...spot, x, y, lx: len, ly: depth, dir: rad === 'left' ? 'x-' : 'x+', exhaust };
  }

  /**
   * Выхлоп каждой ДГУ: глушитель на крыше для неё — через крышу, иначе через заднюю стену (глушитель встроен в ДГУ):
   * вдоль — над двигателем, поперёк — рядом с дверью-жалюзи. [{pos, unit, how, wall, u, z, gap}]
   */
  static exhausts(plan) {
    const [, Wi, Hi] = plan.int;
    const roof = plan.roof || [];
    const dgu = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');
    return dgu.map(gen => {
      const base = {
        pos: gen.pos,
        unit: gen.unit,
        x: Math.round(LayoutRoof._mid(gen.x, gen.lx)),
        y: Math.round(LayoutRoof._mid(gen.y, gen.ly)),
      };
      if (roof.some(item => item.dgu && item.dgu.pos === gen.pos && item.dgu.unit === gen.unit))
        return { ...base, how: 'roof' };
      const z = Math.round(Math.min(Hi - 200, gen.h + 250));
      return {
        ...base,
        how: 'wall',
        wall: 'back',
        u: this._exhaustAt(plan, gen),
        z,
        gap: Math.max(0, Wi - gen.y - gen.ly),
      };
    });
  }

  static _exhaustAt(plan, dgu) {
    const rad = dgu.rad || 'right';
    if (rad === 'back') {
      const door = (plan.dguDoors || []).find(spot => spot.pos === dgu.pos && spot.unit === dgu.unit);
      return Math.round(door ? door.x1 + 200 : LayoutRoof._mid(dgu.x, dgu.lx));
    }
    return Math.round(rad === 'left' ? dgu.x + dgu.lx * 0.16 + 300 : dgu.x + dgu.lx * 0.84 - 300);
  }

  /**
   * Ресиверы снаружи (ФНП ОРПД, п. 65) — на площадке за дальним торцом у выхода трубопровода: первый — по оси выхода,
   * следующие — к стене прохода через recv.outStep; не помещаются по ширине — следующий ряд дальше. z — от площадки.
   */
  static outside(plan, equip, chassis) {
    const outer = equip.filter(unit => unit.outside);
    if (!outer.length) return [];
    const [Li, Wi] = plan.int;
    const ext = plan.geo.ext;
    const recv = StationMatrix.recv();
    const oy = (ext[1] - Wi) / 2;
    const zFloor = StationGeo.zFloor(plan.geo.type);
    const air = (plan.piping || [])
      .flatMap(part => part.lines || [])
      .filter(line => line.medium === 'air' && !line.header && line.x1 >= Li - 1);
    const lineY = air.length ? air[0].y : Wi - StationMatrix.grp('pipe').airY;
    const first = lenY => Math.round(Math.min(Wi + oy - lenY, Math.max(-oy, lineY - lenY / 2)));
    const z = -(zFloor + (chassis ? this.CHASSIS_H : 0)) + recv.pad;
    const out = [];
    const anchor = { x: Li + (ext[0] - Li) / 2 + recv.outGap, top: null, col: 0 };
    for (const unit of outer) {
      for (let k = 0; k < unit.qty; k++) {
        const y = this.nextY(anchor, unit, { first, lo: -oy, step: recv.outStep });
        out.push(
          LayoutItem.unit(unit, {
            unit: k,
            x: Math.round(anchor.x),
            y,
            z,
            mount: 'out',
            face: -2,
            air: AirChain.unit(unit.air, k),
          }),
        );
      }
    }
    return out;
  }

  /** Следующее место ресивера снаружи: к стене прохода, не помещается — новый ряд дальше от торца. */
  static nextY(anchor, unit, { first, lo: low, step }) {
    let y = anchor.top == null ? first(unit.w) : anchor.top - step - unit.w;
    if (anchor.top != null && y < low) {
      anchor.x += anchor.col + step;
      anchor.col = 0;
      y = first(unit.w);
    }
    anchor.top = y;
    anchor.col = Math.max(anchor.col, unit.l);
    return y;
  }
}
