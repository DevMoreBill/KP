import { AirChain } from './air-chain.js';
import { LayoutItem } from './layout-item.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';

const mid = (a, l) => a + l / 2;

/** Снаружи помещения: глушители ДГУ на крыше, выхлоп через стену, ресиверы на площадке за дальним торцом. */
export class LayoutRoof {
  static CHASSIS_H = 1150;
  static ROAD_H = 4000;

  /**
   * Глушитель — над своей ДГУ на опорах, выхлоп вбок; хоть у одной ДГУ глушитель на крыше — на крыше у всех (недостающие
   * — как последний в составе). ДГУ поперёк — глушитель вдоль неё, выхлоп к задней стене.
   */
  static roof(plan, eq) {
    const ms = eq.filter(e => e.kind === 'muffler' && e.roof);
    if (!ms.length) return [];
    const [L] = plan.int;
    const dgu = plan.items.filter(i => i.kind === 'dgu' && !i.tank).sort((a, b) => a.x - b.x);
    const ctx = { plan, ow: this.overhang(plan), next: Math.max(100, L / 2 - ms[0].l / 2) };
    return this.units(ms, dgu.length).map(([m, u], k) => this.muffler(m, u, dgu[k], ctx));
  }

  /** Выступ крыши за стену, мм. */
  static overhang(plan) {
    const ext = plan.geo && plan.geo.ext;
    return ext ? (ext[1] - plan.int[1]) / 2 : 100;
  }

  /** Глушители по единицам: [элемент, номер]; на каждую ДГУ — по одному. */
  static units(ms, dguCount) {
    const all = ms.flatMap(m => Array.from({ length: m.qty }, (_, u) => [m, u]));
    for (let u = all.length; u < dguCount; u++) {
      const m = all[all.length - 1][0];
      all.push([m, u - all.filter(q => q[0] !== m).length]);
    }
    return all;
  }

  static muffler(m, u, g, ctx) {
    const R = {
      pos: m.pos,
      unit: u,
      name: m.name,
      brief: m.brief,
      short: m.short,
      kind: 'muffler',
      h: m.w,
      d: m.w,
      known: m.known,
      mass: m.mass,
      color: m.color,
      gap: StationMatrix.muffler().gap,
      outlet: StationMatrix.muffler().outlet,
      dgu: g ? { pos: g.pos, unit: g.unit } : null,
    };
    const rad = (g && g.rad) || 'right';
    return rad === 'back' ? this.across(R, m, g, ctx) : this.along(R, m, g, rad, ctx);
  }

  /** ДГУ поперёк: глушитель по ширине станции над ней, выхлоп — над радиатором. */
  static across(R, m, g, { plan, ow }) {
    const [L, W] = plan.int;
    const d = R.d;
    const l = Math.min(m.l, W + 2 * ow - 80);
    const y = Math.round(Math.max(-ow + 40, Math.min(W + ow - 40 - l, mid(g.y, g.ly) - l / 2)));
    const x = Math.round(Math.max(100, Math.min(L - 100 - d, mid(g.x, g.lx) - d / 2)));
    const exhaust = {
      x: Math.round(mid(g.x, g.lx)),
      y: Math.round(Math.max(y + 120, Math.min(y + l - 120, g.y + g.ly * 0.62))),
      z: g.h,
    };
    return { ...R, x, y, lx: d, ly: l, dir: 'y+', exhaust };
  }

  /** ДГУ вдоль: глушитель по длине над ней (без ДГУ — подряд по середине), выхлоп — в сторону радиатора. */
  static along(R, m, g, rad, ctx) {
    const { plan, ow } = ctx;
    const [L, W] = plan.int;
    const d = R.d;
    const l = Math.min(m.l, L - 200);
    const cx = g ? mid(g.x, g.lx) : ctx.next + l / 2;
    const x = Math.round(Math.max(100, Math.min(L - 100 - l, cx - l / 2)));
    const y = Math.round(g ? Math.max(-ow + 40, Math.min(W + ow - 40 - d, mid(g.y, g.ly) - d / 2)) : W / 2 - d / 2);
    const exhaust = g
      ? {
          x: Math.round(Math.max(x + 120, Math.min(x + l - 120, g.x + g.lx * (rad === 'left' ? 0.38 : 0.62)))),
          y: Math.round(mid(g.y, g.ly)),
          z: g.h,
        }
      : null;
    ctx.next = x + l + 300;
    return { ...R, x, y, lx: l, ly: d, dir: rad === 'left' ? 'x-' : 'x+', exhaust };
  }

  /**
   * Выхлоп каждой ДГУ: глушитель на крыше для неё — через крышу, иначе через заднюю стену (глушитель встроен в ДГУ):
   * вдоль — над двигателем, поперёк — рядом с дверью-жалюзи. [{pos, unit, how, wall, u, z, gap}]
   */
  static exhausts(plan) {
    const [, W, H] = plan.int;
    const roof = plan.roof || [];
    const dgu = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');
    return dgu.map(g => {
      const base = { pos: g.pos, unit: g.unit, x: Math.round(mid(g.x, g.lx)), y: Math.round(mid(g.y, g.ly)) };
      if (roof.some(m => m.dgu && m.dgu.pos === g.pos && m.dgu.unit === g.unit)) return { ...base, how: 'roof' };
      const z = Math.round(Math.min(H - 200, g.h + 250));
      return { ...base, how: 'wall', wall: 'back', u: this.exhaustAt(plan, g), z, gap: Math.max(0, W - g.y - g.ly) };
    });
  }

  static exhaustAt(plan, g) {
    const rad = g.rad || 'right';
    if (rad === 'back') {
      const door = (plan.dguDoors || []).find(q => q.pos === g.pos && q.unit === g.unit);
      return Math.round(door ? door.x1 + 200 : mid(g.x, g.lx));
    }
    return Math.round(rad === 'left' ? g.x + g.lx * 0.16 + 300 : g.x + g.lx * 0.84 - 300);
  }

  /**
   * Ресиверы снаружи (ФНП ОРПД, п. 65) — на площадке за дальним торцом у выхода трубопровода: первый — по оси выхода,
   * следующие — к стене прохода через recv.outStep; не помещаются по ширине — следующий ряд дальше. z — от площадки.
   */
  static outside(plan, eq, chassis) {
    const E = eq.filter(e => e.outside);
    if (!E.length) return [];
    const [L, W] = plan.int;
    const ext = plan.geo.ext;
    const R = StationMatrix.recv();
    const oy = (ext[1] - W) / 2;
    const zf = StationGeo.zFloor(plan.geo.type);
    const air = (plan.piping || [])
      .flatMap(p => p.lines || [])
      .filter(l => l.medium === 'air' && !l.header && l.x1 >= L - 1);
    const yc = air.length ? air[0].y : W - StationMatrix.grp('pipe').airY;
    const first = ly => Math.round(Math.min(W + oy - ly, Math.max(-oy, yc - ly / 2)));
    const z = -(zf + (chassis ? this.CHASSIS_H : 0)) + R.pad;
    const out = [];
    const at = { x: L + (ext[0] - L) / 2 + R.outGap, top: null, col: 0 };
    for (const e of E) {
      for (let k = 0; k < e.qty; k++) {
        const y = this.nextY(at, e, { first, lo: -oy, step: R.outStep });
        out.push(
          LayoutItem.unit(e, {
            unit: k,
            x: Math.round(at.x),
            y,
            z,
            mount: 'out',
            face: -2,
            air: AirChain.unit(e.air, k),
          }),
        );
      }
    }
    return out;
  }

  /** Следующее место ресивера снаружи: к стене прохода, не помещается — новый ряд дальше от торца. */
  static nextY(at, e, { first, lo, step }) {
    let y = at.top == null ? first(e.w) : at.top - step - e.w;
    if (at.top != null && y < lo) {
      at.x += at.col + step;
      at.col = 0;
      y = first(e.w);
    }
    at.top = y;
    at.col = Math.max(at.col, e.l);
    return y;
  }
}
