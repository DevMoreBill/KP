import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Стены с проёмами, двери и ворота (полотна, створки), помещение внутри: обшивка, пол, потолок, перегородки. */
export class SceneRoom {
  constructor(s) {
    this.s = s;
  }

  /** Стена со стороны зрителя, когда она не срезана: панели между проёмами сервисных дверей, двери открыты. */
  frontWall(w, z0, z1, prof) {
    this.wallWithDoors(w, [z0, z1], prof, this.s.openF, [0, -1]);
  }

  backWall(w, z0, z1, prof) {
    this.wallWithDoors(w, [z0, z1], prof, this.s.doorsB, [this.s.We, 1]);
  }

  /** Длинная стена (yw — наружная плоскость, out — наружу) с проёмами. */
  wallWithDoors(w, zs, prof, doors, side) {
    const [yw, out] = side;
    const cuts = doors
      .map(d => ({
        a: this.s.ox + d.x0 / 1000,
        b: this.s.ox + d.x1 / 1000,
        h: this.s.base + d.h / 1000,
        n: d.leaves || 1,
        kind: d.kind || 'service',
        open: !!d.open,
      }))
      .sort((p, q) => p.a - q.a);
    this.sheets(w, cuts, prof, side, zs);
    const M = {
      fr: this.s.M(StMat.paint(this.s.frame, 0.45)),
      leaf: this.s.M(StMat.paint(this.s.door, 0.45)),
      inner: this.s.M(StMat.paint(this.s.lining, 0.55)),
      dk: this.s.M(StMat.paint('#24292e', 0.55)),
    };
    const depth = this.s.oy + 0.01;
    const ys = out < 0 ? [0, depth] : [yw - depth, yw];
    for (const c of cuts) if (c.kind !== 'dgu') this.opening(c, M, side, ys); // дверь-жалюзи ДГУ — OutfitDoors
  }

  /** Панели стены между проёмами и над ними. */
  sheets(w, cuts, prof, [yw, out], [z0, z1]) {
    const sheet = (a, b, za, zb) => {
      if (b <= a + 0.005 || zb <= za) return;
      if (prof) w.corr(0, [a, b], [yw - out * 0.03, out], [za, zb], [...prof]);
      else {
        const y = yw - out * 0.02;
        w.quad([a, y, za], [b, y, za], [b, y, zb], [a, y, zb], [0, out, 0]);
      }
    };
    let x = 0.16;
    for (const c of cuts) {
      sheet(x, c.a, z0, z1);
      sheet(c.a, c.b, c.h, z1);
      x = Math.max(x, c.b);
    }
    sheet(x, this.s.Le - 0.16, z0, z1);
  }

  /** Проём: обрамление, закрытая дверь или открытые створки и откос с утеплителем. */
  opening(c, M, side, [y0, y1]) {
    const { fr } = M;
    fr.box([c.a - 0.05, y0, this.s.base - 0.02], [c.a, y1, c.h + 0.05], 0.004);
    fr.box([c.b, y0, this.s.base - 0.02], [c.b + 0.05, y1, c.h + 0.05], 0.004);
    fr.box([c.a - 0.05, y0, c.h], [c.b + 0.05, y1, c.h + 0.05], 0.004);
    if (this.s.closed || !c.open) {
      this.shut(c, side, M.leaf, M.dk);
      return;
    }
    for (let k = 0; k < c.n; k++) this.openLeaf(c, k === 0, M, side);
    const ins = this.s.M(StMat.paint(StScene.INS, 0.9));
    ins.quad([c.a, y0, c.h], [c.b, y0, c.h], [c.b, y1, c.h], [c.a, y1, c.h], [0, 0, -1]);
  }

  /** Створка, открытая наружу на 100°: полотно, обшивка, жалюзи, ручка, петли. */
  openLeaf(c, left, { leaf, inner, dk }, [yw, out]) {
    const lw = (c.b - c.a) / c.n;
    const H = c.h - this.s.base - 0.02;
    const hx = left ? c.a : c.b;
    const sx = left ? 1 : -1;
    const ph = (100 * Math.PI) / 180;
    const d = [sx * Math.cos(ph) * lw, out * Math.sin(ph) * lw, 0];
    const o = [hx, yw + out * 0.005, this.s.base + 0.01];
    const thick = StV.mul(StV.norm([-d[1], d[0], 0]), 0.045 * (left ? 1 : -1) * -out);
    leaf.obox(o, d, thick, [0, 0, H]);
    inner.obox(StV.add(o, StV.mul(thick, 1.02)), StV.mul(d, 0.96), StV.mul(thick, 0.06), [0, 0, H * 0.98]);
    for (let i = 0; i < 6; i++) {
      const zz = this.s.base + H * (0.18 + i * 0.045);
      dk.obox(
        StV.add([hx, yw + out * 0.005, zz], StV.mul(d, 0.2)),
        StV.mul(d, 0.6),
        StV.mul(thick, -0.15),
        [0, 0, 0.018],
      );
    }
    const hp = StV.add([hx, yw + out * 0.005, this.s.base + H * 0.5], StV.mul(d, 0.9));
    dk.obox(StV.add(hp, StV.mul(thick, -0.6)), StV.mul(StV.norm(d), 0.025), StV.mul(thick, -0.8), [0, 0, 0.2]);
    for (const z of [0.15, 0.85])
      dk.tube([hx, yw + out * 0.01, this.s.base + H * z], [hx, yw + out * 0.01, this.s.base + H * z + 0.12], 0.018, 10);
  }

  /** Закрытая дверь в проёме (вид снаружи). */
  shut(c, [yw, out], leaf, dk) {
    const yo = yw + out * 0.005;
    const yi = yo + out * 0.045;
    const g = {
      out,
      z0: this.s.base + 0.01,
      z1: c.h - 0.005,
      zh: this.s.base + 1.0,
      yf: yi + out * 0.004,
      lock: c.n === 1 ? c.b - 0.09 : (c.a + c.b) / 2 + 0.06,
      mt: this.s.M(StMat.metal('#c3c8cd', 0.3)),
    };
    const sm = this.s.M(StMat.paint(RalColor.shade(this.s.wall, 0.82), 0.5));
    const lw = (c.b - c.a) / c.n;
    for (let k = 0; k < c.n; k++) {
      const a = c.a + k * lw + 0.004;
      const b = c.a + (k + 1) * lw - 0.004;
      leaf.box([a, yo, g.z0], [b, yi, g.z1], 0.006);
      for (const z of [g.z0 + 0.12, g.z1 - 0.12])
        sm.box([a + 0.05, yi, z - 0.004], [b - 0.05, yi + out * 0.003, z + 0.004]);
    }
    if (c.kind === 'service') {
      this.bars(c, g, dk);
      return;
    }
    this.handle(g, dk);
    if (c.n === 1) this.closer(c, g, dk, yw);
    if (c.kind === 'tank')
      for (let i = 0; i < 7; i++) {
        const z = g.z0 + 0.12 + i * 0.045;
        dk.box([c.a + 0.12, g.yf, z], [c.b - 0.12, g.yf + out * 0.012, z + 0.022]);
      }
  }

  /** Запорные штанги сервисных ворот. */
  bars(c, { out, z0, z1, zh, yf, lock, mt }, dk) {
    for (const x of c.n === 1 ? [lock] : [(c.a + c.b) / 2 - 0.07, lock]) {
      mt.tube([x, yf + out * 0.02, z0 + 0.08], [x, yf + out * 0.02, z1 - 0.08], 0.012, 10);
      dk.box([x - 0.03, yf, zh - 0.12], [x + 0.03, yf + out * 0.05, zh + 0.12], 0.005);
    }
  }

  /** Ручка-скоба с замком. */
  handle({ out, zh, yf, lock, mt }, dk) {
    dk.box([lock - 0.025, yf, zh - 0.09], [lock + 0.025, yf + out * 0.012, zh + 0.09], 0.006);
    mt.box([lock - 0.13, yf + out * 0.035, zh + 0.03], [lock + 0.01, yf + out * 0.055, zh + 0.05], 0.008);
    mt.box([lock - 0.008, yf, zh + 0.025], [lock + 0.012, yf + out * 0.055, zh + 0.055], 0.004);
    mt.tube([lock, yf, zh - 0.05], [lock, yf + out * 0.015, zh - 0.05], 0.011, 12);
  }

  /** Доводчик — всегда внутри: корпус у петель со стороны помещения, рычаг к верху коробки. */
  closer(c, { out, z1 }, dk, yw) {
    const x = c.a + 0.07;
    const zc = z1 - 0.07;
    const si = -out;
    const yin = yw + si * this.s.oy;
    this.s.M(StMat.metal('#9aa1a8', 0.35)).box([x, yin, zc - 0.035], [x + 0.27, yin + si * 0.06, zc + 0.035], 0.012);
    const p0 = [x + 0.24, yin + si * 0.05, zc + 0.01];
    const p1 = [x + 0.4, yin + si * 0.07, zc + 0.02];
    const p2 = [x + 0.46, yin + si * 0.03, c.h + 0.03];
    dk.tube(p0, p1, 0.009, 8);
    dk.sphere(p1, 0.012, 8);
    dk.tube(p1, p2, 0.008, 8);
  }

  /** Обшивка изнутри стены с проёмами. */
  holes(m, y, n, doors, [b, c]) {
    const cuts = doors
      .map(d => [this.s.ox + d.x0 / 1000, this.s.ox + d.x1 / 1000, this.s.base + d.h / 1000])
      .sort((p, q) => p[0] - q[0]);
    let x = this.s.ox;
    const q = (a, z, za, zb) => {
      if (z > a + 0.005 && zb > za) m.quad([a, y, za], [z, y, za], [z, y, zb], [a, y, zb], [0, n, 0]);
    };
    for (const [a, z, h] of cuts) {
      q(x, a, b, c);
      q(a, z, h, c);
      x = Math.max(x, z);
    }
    q(x, this.s.ox + this.s.Li, b, c);
  }

  /** Створки в торцах блок-контейнера: ворота, двери оператора, ворота отсека бака. */
  endDoors() {
    const P = this.s.plan;
    const en = P.entry;
    for (const G of [P.gates, P.gates2]) if (G && !G.sea) this.endLeaves(G, G.wall, 2);
    if (en && en.wall === 'left' && !en.sea) this.endLeaves(en, 'left', 1);
    if (P.fuel && P.fuel.gate) this.endLeaves(P.fuel.gate, 'left', 2); // ворота отсека топливного бака
    if (P.exit) this.endLeaves(P.exit, P.exit.wall, 1);
  }

  /** Створки в торце side ('left' — x = 0, 'right' — x = Le). */
  endLeaves(d, side, n) {
    const s = side === 'left' ? -1 : 1;
    const xw = side === 'left' ? 0 : this.s.Le;
    const y0 = this.s.oy + d.y0 / 1000;
    const w = (d.y1 - d.y0) / 1000;
    const lw = w / n;
    const z0 = this.s.base;
    const z1 = this.s.base + d.h / 1000;
    const lf = this.s.M(StMat.paint(RalColor.shade(this.s.door, 0.95), 0.45));
    const dk = this.s.M(StMat.paint('#23272b', 0.6));
    const fr = this.s.M(StMat.paint(RalColor.shade(this.s.frame, 0.9), 0.45));
    const X = (a, b) => [Math.min(xw + s * a, xw + s * b), Math.max(xw + s * a, xw + s * b)];
    const [fa, fb] = X(0, 0.03);
    fr.box([fa, y0 - 0.05, z0], [fb, y0, z1 + 0.05]);
    fr.box([fa, y0 + w, z0], [fb, y0 + w + 0.05, z1 + 0.05]);
    fr.box([fa, y0 - 0.05, z1], [fb, y0 + w + 0.05, z1 + 0.05]); // коробка
    const [la, lb] = X(0, 0.025);
    for (let i = 0; i < n; i++)
      lf.box([la, y0 + lw * i + 0.004, z0 + 0.01], [lb, y0 + lw * (i + 1) - 0.004, z1 - 0.004], 0.004);
    const [ha, hb] = X(0.025, 0.055);
    const yh = n > 1 ? [y0 + w / 2 - 0.08, y0 + w / 2 + 0.06] : [y0 + w - 0.12];
    for (const y of yh) dk.box([ha, y, z0 + 0.95], [hb, y + 0.02, z0 + 1.15], 0.004);
    if (n > 1) {
      const mt = this.s.M(StMat.metal('#c3c8cd', 0.3));
      const [ba, bb] = X(0.04, 0.06);
      for (const y of [y0 + w / 2 - 0.07, y0 + w / 2 + 0.05])
        mt.box([ba, y, z0 + 0.08], [bb, y + 0.02, z1 - 0.08], 0.004);
    } // запорные штанги
    if (d.wicket) {
      const ww = d.wicket.w / 1000;
      const wh = d.wicket.h / 1000;
      const ya = y0 + 0.08;
      const yb = ya + ww;
      const za = z0 + 0.06;
      const zb = za + wh;
      const [ka, kb] = X(0.025, 0.03);
      // калитка в створке: контур, ручка
      for (const [p, q, r, t] of [
        [ya, yb, za, za + 0.012],
        [ya, yb, zb - 0.012, zb],
        [ya, ya + 0.012, za, zb],
        [yb - 0.012, yb, za, zb],
      ])
        dk.box([ka, p, r], [kb, q, t]);
      dk.box([ha, yb - 0.1, z0 + 0.95], [hb, yb - 0.08, z0 + 1.15], 0.004);
    }
  }

  /** Внутри: обшивка стен и потолка, пол из рифлёного листа, разрез стены со стороны зрителя (утеплитель). */
  inside() {
    const { ox, oy, Li, Wi, base: b, ceil: c } = this.s;
    const lin = this.s.M(StMat.paint(this.s.lining, 0.6));
    if (!this.s.doorsB.length)
      lin.quad([ox, oy + Wi, b], [ox + Li, oy + Wi, b], [ox + Li, oy + Wi, c], [ox, oy + Wi, c], [0, -1, 0]);
    const E = this.endOpenings();
    this.endLining(lin, ox + Li, -1, this.s.cut ? E.filter(d => d.wall === 'right') : [], [b, c]);
    this.endLining(lin, ox, 1, this.s.cut ? E.filter(d => d.wall === 'left') : [], [b, c]);
    if (this.s.cut) {
      for (const d of E) this.innerLeaves(d, d.wall, d.n);
      for (const d of this.s.doorsB) this.innerLeaves(d, 'back', d.leaves || 1);
    }
    lin.quad([ox, oy, c], [ox + Li, oy, c], [ox + Li, oy + Wi, c], [ox, oy + Wi, c], [0, 0, -1]);
    if (!this.s.cut) this.holes(lin, oy, 1, this.s.openF, [b, c]);
    if (this.s.doorsB.length) this.holes(lin, oy + Wi, -1, this.s.doorsB, [b, c]);
    this.seams();
    this.floor();
    if (this.s.cut) this.section();
    this.tambour();
  }

  /** Швы обшивки по задней стене и потолку. */
  seams() {
    const { ox, oy, Li, Wi, base: b, ceil: c } = this.s;
    const sm = this.s.M(StMat.paint(RalColor.shade(this.s.lining, 0.86), 0.6));
    const step = this.s.g.sea ? 1.2 : 1.15;
    for (let x = ox + step; x < ox + Li - 0.2; x += step) {
      sm.box([x - 0.004, oy + Wi - 0.004, b], [x + 0.004, oy + Wi, c]);
      sm.box([x - 0.004, oy, c - 0.004], [x + 0.004, oy + Wi, c]);
    }
  }

  /** Пол — рифлёный лист: сталь чёрная или алюминий; задан RAL — окрашен. */
  floor() {
    const { ox, oy, Li, Wi, base: b } = this.s;
    const F = StationGeo.FLOORS[this.s.g.floor] || StationGeo.FLOORS.steel;
    const col = this.s.plan.floorColor;
    const fl = this.s.M(col ? { ...StMat.paint(col, 0.5), k: 1 } : { c: F.color, r: F.r, m: F.m, k: 1 });
    fl.quad([ox, oy, b], [ox + Li, oy, b], [ox + Li, oy + Wi, b], [ox, oy + Wi, b], [0, 0, 1]);
  }

  /** Разрез на месте срезанной стены: крыша, пол и торцевые стены в сечении — утеплитель между обшивками. */
  section() {
    const { ox, base: b, ceil: c } = this.s;
    const ins = this.s.M(StMat.paint(StScene.INS, 0.9));
    const y = 0.002;
    const n = [0, -1, 0];
    const x0 = 0.15;
    const x1 = this.s.Le - 0.15;
    const mono = this.s.g.roof === 'mono' && this.s.rise > 0;
    const zr = mono ? this.s.top + this.s.rise : this.s.top - (this.s.g.sea ? 0.11 : 0.1);
    if (zr > c) ins.quad([x0, y, c], [x1, y, c], [x1, y, zr], [x0, y, zr], n);
    const zf = this.s.dz + 0.16;
    if (b > zf) ins.quad([x0, y, zf], [x1, y, zf], [x1, y, b], [x0, y, b], n);
    for (const [a, z] of [
      [x0, ox],
      [this.s.Le - ox, x1],
    ])
      if (z > a) ins.quad([a, y, b], [z, y, b], [z, y, c], [a, y, c], n);
  }

  /** Тамбур «Север»: перегородка с дверью (после отсека бака, если он есть). */
  tambour() {
    const fu = this.s.plan.fuel;
    if ((this.s.g.x0 || 0) - (fu ? fu.x1 + fu.part : 0) <= 0) return;
    const { oy, Wi, base: b, ceil: c } = this.s;
    const x = this.s.ox + this.s.g.x0 / 1000;
    const d = this.s.M(StMat.paint(this.s.lining, 0.55));
    const dw = this.s.M(StMat.paint(RalColor.shade(this.s.door, 0.95), 0.45));
    d.box([x - 0.06, oy, b], [x, oy + Wi - 1.0, c]);
    d.box([x - 0.06, oy + Wi - 0.1, b], [x, oy + Wi, c]);
    d.box([x - 0.06, oy + Wi - 1.0, b + 2.0], [x, oy + Wi - 0.1, c]);
    dw.box([x - 0.05, oy + Wi - 0.98, b], [x - 0.01, oy + Wi - 0.12, b + 1.98], 0.004);
    const cl = this.s.M(StMat.metal('#9aa1a8', 0.35));
    const dk = this.s.M(StMat.paint('#24292e', 0.55));
    cl.box([x - 0.11, oy + Wi - 0.92, b + 1.84], [x - 0.05, oy + Wi - 0.65, b + 1.91], 0.01); // доводчик
    dk.tube([x - 0.09, oy + Wi - 0.68, b + 1.9], [x - 0.12, oy + Wi - 0.55, b + 1.94], 0.008, 8);
    dk.tube([x - 0.12, oy + Wi - 0.55, b + 1.94], [x - 0.07, oy + Wi - 0.5, b + 2.0], 0.008, 8);
  }

  /** Проёмы в торцах. */
  endOpenings() {
    const P = this.s.plan;
    const out = [];
    for (const G of [P.gates, P.gates2])
      if (G) out.push({ wall: G.wall, y0: G.y0, y1: G.y1, h: G.h, n: 2, kind: 'gate', wicket: G.wicket || null });
    if (P.entry && P.entry.wall === 'left' && !P.entry.sea)
      out.push({ wall: 'left', y0: P.entry.y0, y1: P.entry.y1, h: P.entry.h, n: 1, kind: 'entry' });
    if (P.fuel && P.fuel.gate) {
      const G = P.fuel.gate;
      out.push({ wall: 'left', y0: G.y0, y1: G.y1, h: G.h, n: 2, kind: 'gate' });
    } // ворота отсека бака
    if (P.exit) out.push({ wall: P.exit.wall, y0: P.exit.y0, y1: P.exit.y1, h: P.exit.h, n: 1, kind: 'entry' });
    for (const d of (P.dguDoors || []).filter(d => d.wall !== 'back'))
      out.push({ wall: d.wall, y0: d.y0, y1: d.y1, h: d.h, n: 2, kind: 'dgu' });
    return out;
  }

  /** Обшивка торца изнутри (x — плоскость, nx — нормаль внутрь) с проёмами cuts: участки до, между и над проёмами. */
  endLining(m, x, nx, cuts, [b, c]) {
    const C = cuts
      .map(d => [this.s.oy + d.y0 / 1000, this.s.oy + d.y1 / 1000, this.s.base + d.h / 1000])
      .sort((p, q) => p[0] - q[0]);
    const q = (a, z, za, zb) => {
      if (z > a + 0.005 && zb > za) m.quad([x, a, za], [x, z, za], [x, z, zb], [x, a, zb], [nx, 0, 0]);
    };
    let y = this.s.oy;
    for (const [a, z, h] of C) {
      q(y, a, b, c);
      q(a, z, h, c);
      y = Math.max(y, z);
    }
    q(y, this.s.oy + this.s.Wi, b, c);
  }

  /** Ворота (дверь) изнутри — вид в разрезе. */
  innerLeaves(d, wall, n) {
    const end = wall === 'left' || wall === 'right';
    const pl = { left: this.s.ox, right: this.s.ox + this.s.Li }[wall] ?? this.s.oy + this.s.Wi;
    const s = wall === 'left' ? 1 : -1;
    const o = end ? this.s.oy : this.s.ox;
    const u = end ? [o + d.y0 / 1000, o + d.y1 / 1000] : [o + d.x0 / 1000, o + d.x1 / 1000];
    const z = [this.s.base, this.s.base + d.h / 1000];
    /** Короб на полотне: u — вдоль стены, zz — по высоте, tt — от плоскости внутрь. */
    const box = (m, [a, b], [za, zb], [t0, t1], r = 0.004) => {
      const w0 = pl + s * t0;
      const w1 = pl + s * t1;
      if (end) m.box([w0, a, za], [w1, b, zb], r);
      else m.box([a, w0, za], [b, w1, zb], r);
    };
    const M = {
      fr: this.s.M(StMat.paint(RalColor.shade(this.s.frame, 0.9), 0.45)),
      lf: this.s.M(StMat.paint(RalColor.shade(this.s.lining, 0.9), 0.5)),
      rib: this.s.M(StMat.paint(RalColor.shade(this.s.lining, 0.78), 0.55)),
      mt: this.s.M(StMat.metal('#c3c8cd', 0.3)),
      dk: this.s.M(StMat.paint('#23272b', 0.6)),
    };
    const [u0, u1] = u;
    const [z0, z1] = z;
    box(M.fr, [u0 - 0.05, u0], [z0, z1 + 0.05], [0, 0.03]);
    box(M.fr, [u1, u1 + 0.05], [z0, z1 + 0.05], [0, 0.03]);
    box(M.fr, [u0 - 0.05, u1 + 0.05], [z1, z1 + 0.05], [0, 0.03]);
    const lw = (u1 - u0) / n;
    for (let i = 0; i < n; i++) SceneRoom.leafIn(box, M, [u0 + lw * i + 0.005, u0 + lw * (i + 1) - 0.005, i === 0], z);
    SceneRoom.latch(box, M, n > 1 && d.kind !== 'entry', u, z);
    if (d.kind === 'dgu')
      for (let zz = z0 + 0.25; zz < z1 - 0.2; zz += 0.06)
        box(M.rib, [u0 + 0.08, u1 - 0.08], [zz, zz + 0.02], [0.03, 0.04]);
    if (d.wicket) SceneRoom.wicket(box, M.dk, d.wicket, u1, z0);
  }

  /** Створка изнутри: обшивка, рёбра каркаса, петли. */
  static leafIn(box, { lf, rib, dk }, [a, b, first], [z0, z1]) {
    box(lf, [a, b], [z0 + 0.01, z1 - 0.005], [0.004, 0.018]);
    for (const k of [0.25, 0.5, 0.75]) {
      const z = z0 + (z1 - z0) * k;
      box(rib, [a + 0.04, b - 0.04], [z - 0.02, z + 0.02], [0.018, 0.03]);
    }
    const hx = first ? a + 0.02 : b - 0.02;
    for (const k of [0.12, 0.5, 0.88]) {
      const z = z0 + (z1 - z0) * k;
      box(dk, [hx - 0.02, hx + 0.02], [z - 0.06, z + 0.06], [0.018, 0.045]);
    }
  }

  /** Запорные штанги и ручки у притвора ворот или ручка двери. */
  static latch(box, { mt, dk }, gate, [u0, u1], [z0, z1]) {
    if (!gate) {
      box(dk, [u1 - 0.12, u1 - 0.1], [z0 + 0.95, z0 + 1.15], [0.03, 0.06]);
      return;
    }
    const m = (u0 + u1) / 2;
    for (const x of [m - 0.06, m + 0.04]) box(mt, [x, x + 0.02], [z0 + 0.06, z1 - 0.06], [0.03, 0.05], 0.008);
    for (const x of [m - 0.1, m + 0.08]) box(dk, [x, x + 0.02], [z0 + 0.95, z0 + 1.15], [0.03, 0.06]);
  }

  /** Калитка в створке ворот: рамка. */
  static wicket(box, dk, wk, u1, z0) {
    const ww = wk.w / 1000;
    const wh = wk.h / 1000;
    const ya = u1 - 0.08 - ww;
    for (const [p, q, za, zb] of [
      [ya, ya + ww, z0 + 0.06, z0 + 0.075],
      [ya, ya + ww, z0 + 0.06 + wh, z0 + 0.075 + wh],
      [ya, ya + 0.015, z0 + 0.06, z0 + 0.06 + wh],
      [ya + ww - 0.015, ya + ww, z0 + 0.06, z0 + 0.06 + wh],
    ])
      box(dk, [p, q], [za, zb], [0.018, 0.024]);
  }
}
