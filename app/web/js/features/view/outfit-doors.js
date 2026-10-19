import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { RalColor } from '../layout/ral-color.js';

const POW = [
  ['POW_NO', 0.06],
  ['AUTO_OFF', -0.14],
];

/**
 * Двери снаружи: над каждой — съёмный козырёк (водостоков нет), под ним — светодиодный прожектор; на входной двери —
 * табличка категории помещения (кроме Д; ППР в РФ, п. 12), знаки W08 и P06, при пожаротушении рядом — табло «Порошок! Не
 * входи!» и «Автоматика отключена»; на двери отсека бака — табличка категории, W01 и P02. Места снаружи занимаются.
 */
export class OutfitDoors {
  constructor(o) {
    this.o = o;
  }

  doors() {
    const { s: S, p: P } = this.o;
    const F = P.fire || {};
    const rooms = OutfitDoors.rooms(F);
    for (const G of [P.gates, P.gates2].filter(g => g && !g.sea)) this.gate(G);
    if (P.entry && P.entry.wall === 'left') this.endEntry(P.entry, rooms.main, F);
    if (P.fuel && P.fuel.gate) this.tankGate(P.fuel.gate, rooms.tank);
    if (P.exit) this.endExit(P.exit);
    for (const d of S.doorsB) this.o.outer('back', d.x0 - 170, d.x1 + 170, 0, d.h + 620);
    if (!S.closed) {
      for (const c of S.openF) this.o.outer('front', c.x0 - 60, c.x1 + 60, 0, c.h + 620);
      return;
    }
    for (const c of S.openF) this.front(c, rooms, F);
  }

  static rooms(F) {
    const R = F.rooms || [];
    return { main: R[0], tank: R.find(q => q.id === 'tank') };
  }

  /** Табличка категории помещения по пожарной опасности (кроме категории Д). */
  static cat(q) {
    return q && q.cat && q.cat !== 'Д' ? { type: 'sign', id: 'CAT', cat: q.cat, zone: q.zone || '' } : null;
  }

  /** Монтажные ворота в торце: козырёк над ними. */
  gate(G) {
    const S = this.o.s;
    const x = G.wall === 'left' ? this.o.leftX() : this.o.rightX();
    this.canopy(
      [x, S.oy + (G.y0 + G.y1) / 2000, S.base + G.h / 1000],
      [G.wall === 'left' ? -1 : 1, 0, 0],
      (G.y1 - G.y0) / 1000 + 0.24,
    );
    this.o.outer(G.wall, G.y0 - 100, G.y1 + 100, 0, G.h + 620);
  }

  /** Дверь оператора в торце: козырёк, прожектор; таблички и знаки — на полотне (у морского — на его дверях). */
  endEntry(en, main, F) {
    const S = this.o.s;
    const x = this.o.leftX();
    const n = [-1, 0, 0];
    const yc = S.oy + (en.y0 + en.y1) / 2000;
    const zt = S.base + en.h / 1000;
    this.o.outer('left', en.y0 - 100, en.y1 + 100, 0, en.h + 620);
    if (!en.sea) {
      this.canopy([x, yc, zt], n, en.w / 1000 + 0.24);
      if (this.room(zt)) this.flood([x, yc, zt + 0.17], n);
    }
    this.endSigns(en, main, [x, yc]);
    if (F.auto && !en.sea && zt + 0.2 < S.top - 0.04) this.endBoards(en, x, zt);
  }

  /** Табличка категории и знаки W08, P06 на двери в торце (у морского — на его дверях, выше и в столбик). */
  endSigns(en, main, [x, yc]) {
    const S = this.o.s;
    const n = [-1, 0, 0];
    const sea = !!en.sea;
    const zs = S.base + (sea ? 1.62 : 1.38);
    const dy = sea ? 0.3 : 0.12;
    const c = OutfitDoors.cat(main);
    const at = sea
      ? { cat: [yc + 0.3, zs + 0.06], w08: zs + 0.06, p06: [yc - dy, zs - 0.19] }
      : { cat: [yc, S.base + 1.72], w08: zs, p06: [yc + dy, zs] };
    if (c) S.sticker(c, [x - 0.004, ...at.cat], n, [0.3, 0.2]);
    S.sticker({ type: 'sign', id: 'W08' }, [x - 0.004, yc - dy, at.w08], n, [0.2, 0.175]);
    S.sticker({ type: 'sign', id: 'P06' }, [x - 0.004, ...at.p06], n, [0.2, 0.2]);
  }

  /** Табло у двери в торце: справа от неё, у края — слева. */
  endBoards(en, x, zt) {
    const S = this.o.s;
    const W = S.Wi * 1000;
    const hb = S.M(StMat.paint('#eceeef', 0.4));
    const right = en.y1 + 560 <= W - 100;
    if (!right && en.y0 - 530 < 100) return;
    const a = S.oy + (right ? en.y1 + 140 : en.y0 - 530) / 1000;
    const b = a + 0.39;
    for (const [id, dz] of POW) {
      const z = zt + dz;
      hb.box([x - 0.04, a, z - 0.08], [x, b, z + 0.08], 0.006);
      S.sticker({ type: 'sign', id }, [x - 0.04, (a + b) / 2, z], [-1, 0, 0], [0.36, 0.13], 0.8);
    }
  }

  /** Ворота отсека бака: козырёк, таблички на левой створке. */
  tankGate(G, tank) {
    const S = this.o.s;
    const x = this.o.leftX();
    const n = [-1, 0, 0];
    const lw = (G.y1 - G.y0) / 2000;
    const ya = S.oy + G.y0 / 1000 + lw / 2;
    const zs = S.base + 1.38;
    this.canopy([x, S.oy + (G.y0 + G.y1) / 2000, S.base + G.h / 1000], n, (G.y1 - G.y0) / 1000 + 0.24);
    this.o.outer('left', G.y0 - 100, G.y1 + 100, 0, G.h + 620);
    const c = OutfitDoors.cat(tank);
    if (c) S.sticker(c, [x - 0.03, ya, S.base + 1.72], n, [0.3, 0.2]);
    S.sticker({ type: 'sign', id: 'W01' }, [x - 0.03, ya - 0.12, zs], n, [0.2, 0.175]);
    S.sticker({ type: 'sign', id: 'P02' }, [x - 0.03, ya + 0.12, zs], n, [0.2, 0.2]);
  }

  /** Вторая дверь оператора в дальнем торце. */
  endExit(ex) {
    const S = this.o.s;
    const x = this.o.rightX();
    const n = [1, 0, 0];
    const yc = S.oy + (ex.y0 + ex.y1) / 2000;
    const zt = S.base + ex.h / 1000;
    this.o.outer('right', ex.y0 - 100, ex.y1 + 100, 0, ex.h + 620);
    this.canopy([x, yc, zt], n, ex.w / 1000 + 0.24);
    if (this.room(zt)) this.flood([x, yc, zt + 0.17], n);
  }

  /** Дверь в стене со стороны зрителя (стена не срезана): козырёк, прожектор, занятые места, таблички и табло. */
  front(c, rooms, F) {
    const S = this.o.s;
    const n = [0, -1, 0];
    const fy = this.o.frontY();
    const [a, b] = [S.ox + c.x0 / 1000, S.ox + c.x1 / 1000];
    const xm = (a + b) / 2;
    const zt = S.base + c.h / 1000;
    this.canopy([xm, fy, zt], n, b - a + 0.24);
    if (c.kind !== 'service' && this.room(zt)) this.flood([xm, fy, zt + 0.17], n);
    const xp = OutfitDoors.signX(c, a, b, xm);
    const right = b + 0.56 < S.ox + S.Li - 0.05;
    this.frontBusy(c, xp * 1000 - S.ox * 1000, right, F);
    const sign = c.kind === 'entry';
    let pl = null;
    if (c.kind === 'tank') pl = OutfitDoors.cat(rooms.tank);
    else if (sign) pl = OutfitDoors.cat(rooms.main);
    if (pl) S.sticker(pl, [xp, -0.052, S.base + 1.72], n, [0.3, 0.2]);
    if (sign) this.entrySigns(xp, zt, { tb: right ? b + 0.14 : a - 0.53, fy }, F);
    if (c.kind === 'tank') this.tankSigns(xm);
  }

  /** У сервисной двери — мимо запорных штанг. */
  static signX(c, a, b, xm) {
    if (c.kind !== 'service') return xm;
    return (c.leaves || 1) > 1 ? a + (b - a) * 0.75 : xm - 0.08;
  }

  /** Снаружи занято: козырёк и прожектор, края полотна, ручка (у сервисной — штанги), таблички, табло, решётка отсека бака. */
  frontBusy(c, um, right, F) {
    const out = (u0, u1, z0, z1) => this.o.outer('front', u0, u1, z0, z1);
    const two = (c.leaves || 1) > 1;
    const uc = (c.x0 + c.x1) / 2;
    out(c.x0 - 170, c.x1 + 170, c.h - 60, c.h + 620);
    for (const e of [c.x0, c.x1]) out(e - 30, e + 30, 0, c.h);
    if (c.kind === 'service') out(...(two ? [uc - 160, uc + 160] : [c.x1 - 200, c.x1 + 20]), 0, c.h);
    else out(two ? uc - 160 : c.x1 - 260, two ? uc + 160 : c.x1 + 60, 800, 1200);
    this.signsBusy(c, um, right, F);
  }

  /** Таблички, табло справа от входа (у дальнего края — слева), решётка внизу двери отсека бака. */
  signsBusy(c, um, right, F) {
    const out = (u0, u1, z0, z1) => this.o.outer('front', u0, u1, z0, z1);
    if (c.kind === 'entry' || c.kind === 'tank') out(um - 290, um + 290, 1240, 1850);
    if (c.kind === 'entry' && F.auto)
      out(...(right ? [c.x1 + 120, c.x1 + 560] : [c.x0 - 560, c.x0 - 120]), c.h - 260, c.h + 170);
    if (c.kind === 'tank') out(c.x0, c.x1, 0, 520);
  }

  /** Знаки W08 и P06 на входной двери; при пожаротушении — табло справа от двери (у дальнего края — слева). */
  entrySigns(xp, zt, { tb, fy }, F) {
    const S = this.o.s;
    const n = [0, -1, 0];
    const zs = S.base + 1.38;
    S.sticker({ type: 'sign', id: 'W08' }, [xp - 0.12, -0.052, zs], n, [0.2, 0.175]);
    S.sticker({ type: 'sign', id: 'P06' }, [xp + 0.12, -0.052, zs], n, [0.2, 0.2]);
    if (!F.auto || zt + 0.2 >= S.top - 0.04) return;
    const hb = S.M(StMat.paint('#eceeef', 0.4));
    for (const [id, dz] of POW) {
      const z = zt + dz;
      hb.box([tb, fy - 0.04, z - 0.08], [tb + 0.39, fy, z + 0.08], 0.006);
      S.sticker({ type: 'sign', id }, [tb + 0.195, fy - 0.04, z], n, [0.36, 0.13], 0.8);
    }
  }

  tankSigns(xm) {
    const S = this.o.s;
    const n = [0, -1, 0];
    const zs = S.base + 1.38;
    S.sticker({ type: 'sign', id: 'W01' }, [xm - 0.12, -0.052, zs], n, [0.2, 0.175]);
    S.sticker({ type: 'sign', id: 'P02' }, [xm + 0.12, -0.052, zs], n, [0.2, 0.2]);
  }

  /** Над дверью хватает места для прожектора под козырьком. */
  room(zt) {
    return zt + 0.34 < this.o.s.top - 0.04;
  }

  /** Съёмный козырёк над дверью: лист с уклоном наружу и бортом, два кронштейна; c — середина над проёмом, n — наружу. */
  canopy(c, n, w) {
    const S = this.o.s;
    const r = StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1]));
    const z = Math.min(S.top - 0.07, c[2] + 0.42);
    const d = 0.32;
    const m = S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45));
    const br = S.M(StMat.paint(RalColor.shade(S.frame, 0.85), 0.5));
    const o = StV.sub([c[0], c[1], z], StV.mul(r, w / 2));
    const v = StV.add(StV.mul(n, d), [0, 0, -0.06]);
    m.obox(o, StV.mul(r, w), v, [0, 0, 0.008]);
    m.obox(StV.add(o, v), StV.mul(r, w), StV.mul(n, 0.008), [0, 0, -0.05]);
    for (const k of [0.06, w - 0.06]) {
      const p = StV.add(o, StV.mul(r, k));
      br.tube(StV.add(p, [0, 0, -0.2]), StV.add(StV.add(p, StV.mul(n, d * 0.85)), [0, 0, -0.05]), 0.01, 8);
    }
  }

  /** Светодиодный прожектор над дверью: корпус с рёбрами на скобе, наклонён вниз на 30°, светящееся стекло. */
  flood(c, n) {
    const S = this.o.s;
    const r = StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1]));
    const t = (30 * Math.PI) / 180;
    const f = StV.norm(StV.add(StV.mul(n, Math.cos(t)), [0, 0, -Math.sin(t)]));
    const up = StV.cross(f, r);
    const body = S.M(StMat.paint('#2d3237', 0.45));
    const [W, H, D] = [0.2, 0.15, 0.05];
    const o = StV.add(c, StV.mul(n, 0.08));
    const C = StV.sub(StV.sub(StV.sub(o, StV.mul(r, W / 2)), StV.mul(up, H / 2)), StV.mul(f, D / 2));
    body.obox(C, StV.mul(r, W), StV.mul(up, H), StV.mul(f, D));
    S.M(StMat.glow('#fff6dc', 3.4)).obox(
      StV.add(C, StV.add(StV.add(StV.mul(r, 0.016), StV.mul(up, 0.016)), StV.mul(f, D))),
      StV.mul(r, W - 0.032),
      StV.mul(up, H - 0.032),
      StV.mul(f, 0.004),
    );
    for (let k = 1; k < 6; k++)
      body.obox(
        StV.add(C, StV.add(StV.mul(r, (W * k) / 6 - 0.003), StV.mul(f, -0.018))),
        StV.mul(r, 0.006),
        StV.mul(up, H),
        StV.mul(f, 0.018),
      );
    for (const k of [-1, 1]) {
      const p = [0, 1, 2].map(i => c[i] + r[i] * k * (W / 2 + 0.008));
      const lo = [0, 1, 2].map(i => Math.min(p[i], p[i] + n[i] * 0.09) - (i === 2 ? 0.015 : 0));
      const hi = [0, 1, 2].map(i => Math.max(p[i], p[i] + n[i] * 0.09) + (i === 2 ? 0.015 : 0.004));
      body.box(lo, hi);
    }
  }
}
