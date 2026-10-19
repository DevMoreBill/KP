import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { RalColor } from '../layout/ral-color.js';
import { OutfitBase } from './outfit-base.js';

/**
 * Отсек топливного бака ДГУ: перегородка, поддон, заливная труба к горловине в нише стены (лючок заподлицо — габарит не
 * меняется), насос перекачки в бак ДГУ, дыхательный клапан над крышей, огнетушитель, жалюзи отсека.
 */
export class OutfitFuel {
  constructor(o) {
    this.o = o;
  }

  fuel() {
    const { s: S, p: P } = this.o;
    const f = P.fuel;
    if (!f) return;
    const T = P.items.filter(i => i.tank);
    const M = { dk: S.M(StMat.paint('#2b3036', 0.6)), st: S.M(StMat.metal(StScene.GALV, 0.4)) };
    const t = T[0];
    if (this.o.inside) this.room(f, T, M);
    if (t) this.breather(t, M);
    const fl = f.fill;
    const wl = fl.wall === 'left' || fl.wall === 'back' ? fl.wall : 'front';
    const fu = wl === 'left' ? fl.y : fl.x;
    this.o.outer(wl, fu - 260, fu + 260, fl.z - 260, fl.z + 260);
    if (wl !== 'front' || !S.cut) this.niche(wl, fu, fl.z);
    if (f.gate) this.gateLouvers(f.gate);
    else if (!S.g.sea) this.endLouver();
  }

  /** Внутри: перегородка (в разрезе — утеплитель), поддоны, заливная труба, огнетушитель, насос перекачки. */
  room(f, T, M) {
    const S = this.o.s;
    const [, W, H] = this.o.p.int;
    const a = S.P(f.x1, 0, 0);
    const b = S.P(f.x1 + f.part, W, H);
    S.M(StMat.paint(S.lining, 0.55)).box(a, b);
    if (S.cut) {
      const y = S.oy - 0.001;
      S.M(StMat.paint(StScene.INS, 0.9)).quad(
        [a[0], y, a[2]],
        [b[0], y, a[2]],
        [b[0], y, b[2]],
        [a[0], y, b[2]],
        [0, -1, 0],
      );
    }
    for (const q of T) this.pan(q, M.dk, W);
    const t = T[0];
    if (t) this.fillPipe(f, t, M.st);
    this.o.safety.extinguisher(S.P(f.x1, 350, OutfitBase.EXT - 500), [-1, 0, 0]);
    S.sticker({ type: 'sign', id: 'F04' }, S.P(f.x1, 350, 1720), [-1, 0, 0], [0.2, 0.2]);
    if (t) this.transfer(t, f, M);
  }

  /** Поддон под баком на полный объём. */
  pan(q, dk, W) {
    const S = this.o.s;
    const p0 = S.P(q.x - 60, q.y - 60, 0);
    const p1 = S.P(q.x + q.lx + 60, Math.min(W - 20, q.y + q.ly + 60), 180);
    const w = 0.006;
    dk.box([p0[0], p0[1], p0[2]], [p1[0], p1[1], p0[2] + 0.008]);
    for (const [x0, y0, x1, y1] of [
      [p0[0], p0[1], p1[0], p0[1] + w],
      [p0[0], p1[1] - w, p1[0], p1[1]],
      [p0[0], p0[1], p0[0] + w, p1[1]],
      [p1[0] - w, p0[1], p1[0], p1[1]],
    ]) {
      dk.box([x0, y0, p0[2]], [x1, y1, p1[2]]);
    }
  }

  /** Заливная труба: от горловины в стене — к баку сверху. */
  fillPipe(f, t, st) {
    const S = this.o.s;
    const Q = this.fillPath(f.fill, t).map(([x, y, z]) => S.P(x, y, z));
    for (let k = 1; k < Q.length; k++) {
      st.tube(Q[k - 1], Q[k], 0.026, 12);
      if (k < Q.length - 1) st.sphere(Q[k], 0.027, 10);
    }
  }

  fillPath(fl, t) {
    const W = this.o.p.int[1];
    const top = t.z + t.h;
    const tx = t.x + t.lx * 0.25;
    const ty = t.y + t.ly / 2;
    const zr = Math.max(fl.z, top + 150);
    const bx = fl.wall === 'left' ? tx : Math.max(t.x + 100, Math.min(t.x + t.lx - 100, fl.x));
    const yb = W - 50;
    const tail = [
      [bx, ty, zr],
      [bx, ty, top],
    ];
    if (fl.wall === 'left') return [[0, fl.y, fl.z], [120, fl.y, fl.z], [120, fl.y, zr], [bx, fl.y, zr], ...tail];
    if (fl.wall === 'back') return [[fl.x, W, fl.z], [fl.x, yb, fl.z], [fl.x, yb, zr], [bx, yb, zr], ...tail];
    return [[fl.x, 0, fl.z], [fl.x, 120, fl.z], [fl.x, 120, zr], [fl.x, ty, zr], ...tail];
  }

  /** Дыхательный клапан с огнепреградителем — над крышей. */
  breather(t, { st, dk }) {
    const S = this.o.s;
    const p = S.P(t.x + t.lx * 0.8, t.y + t.ly * 0.7, t.z + t.h);
    const zr = S.roofZ(p[1]) + (S.rise > 0 ? 0.04 : 0);
    if (this.o.inside) st.tube(p, [p[0], p[1], S.ceil], 0.02, 10);
    st.tube([p[0], p[1], zr - 0.02], [p[0], p[1], zr + 0.32], 0.02, 10);
    st.tube([p[0], p[1], zr + 0.32], [p[0], p[1], zr + 0.4], 0.042, 14);
    dk.tube([p[0], p[1], zr + 0.42], [p[0], p[1], zr + 0.435], 0.075, 18);
    st.tube([p[0], p[1], zr + 0.4], [p[0], p[1], zr + 0.42], 0.014, 8);
  }

  /** Ворота отсека в торце: жалюзи внизу и вверху створок (естественная вентиляция отсека). */
  gateLouvers(G) {
    const S = this.o.s;
    const mm = S.mm;
    const lw = (G.y1 - G.y0) / 2;
    const x = -0.027;
    for (let k = 0; k < 2; k++) {
      const a = S.oy + mm(G.y0 + k * lw + 120);
      const b = S.oy + mm(G.y0 + (k + 1) * lw - 120);
      if (b - a < 0.15) continue;
      S.louver(1, x, [a, b], [S.base + 0.15, S.base + 0.45], -1);
      S.louver(1, x, [a, b], [S.base + mm(G.h) - 0.45, S.base + mm(G.h) - 0.2], -1);
    }
    this.o.outer('left', G.y0 - 100, G.y1 + 100, 0, G.h + 150);
  }

  /** Жалюзи отсека вверху в торце (внизу — решётка в двери отсека). */
  endLouver() {
    const S = this.o.s;
    const W = this.o.p.int[1];
    const y0 = S.oy + S.mm(W - 450);
    const y1 = S.oy + S.mm(W - 150);
    S.louver(1, 0, [y0, y1], [S.top - 0.65, S.top - 0.4], -1);
    this.o.hood('left', y0 - S.oy - 0.06, y1 - S.oy + 0.06, S.top - 0.34);
    this.o.outer('left', W - 510, W - 90, (S.top - 0.7 - S.base) * 1000, (S.top - 0.3 - S.base) * 1000);
  }

  /** Насос перекачки: на раме у бака перед перегородкой; всасывание — из нижнего патрубка с краном, нагнетание — вверх. */
  transfer(t, f, { st, dk }) {
    const S = this.o.s;
    const x = Math.min(f.x1 - 130, t.x + t.lx + 170);
    const y0 = Math.max(220, t.y - 330);
    const y1 = y0 + 240;
    const zc = 170;
    const red = S.M(StMat.paint('#c83a2e', 0.4));
    const mo = S.M(StMat.paint('#4f5d6b', 0.45));
    if (x - 100 < t.x + t.lx + 40) return;
    this.o.log.push({ kind: 'fuelpump', x, y: y0 });
    dk.box(S.P(x - 100, y0, 0), S.P(x + 100, y1, 60), 0.006);
    mo.tube(S.P(x, y0 + 20, zc), S.P(x, y0 + 170, zc), 0.07, 20);
    dk.tube(S.P(x, y0 + 15, zc), S.P(x, y0 + 22, zc), 0.072, 20);
    red.tube(S.P(x, y0 + 170, zc), S.P(x, y1 - 10, zc), 0.06, 20);
    dk.box(S.P(x - 60, y0 + 40, 60), S.P(x + 60, y0 + 150, zc - 60));
    this.suction(t, { x, y1, zc }, { st, red });
    this.delivery({ x, y0, y1, zc }, st);
  }

  /** Всасывание из бака с краном. */
  suction(t, { x, y1, zc }, { st, red }) {
    const S = this.o.s;
    const a = S.P(t.x + t.lx - 120, t.y - 1, 120);
    const b = S.P(t.x + t.lx - 120, y1 + 60, 120);
    const c = S.P(x, y1 + 60, 120);
    const d = S.P(x, y1 - 10, zc);
    st.tube(a, b, 0.016, 10);
    st.sphere(b, 0.017, 8);
    st.tube(b, c, 0.016, 10);
    st.sphere(c, 0.017, 8);
    st.tube(c, d, 0.016, 10);
    st.sphere(b, 0.026, 10);
    red.box([b[0] - 0.01, b[1] - 0.01, b[2] + 0.03], [b[0] + 0.09, b[1] + 0.01, b[2] + 0.045], 0.003);
  }

  /** Нагнетание — к топливопроводу у задней стены. */
  delivery({ x, y0, y1, zc }, st) {
    const S = this.o.s;
    const l = (this.o.p.lines || []).find(q => q.medium === 'fuel');
    const zl = l ? l.z : 1150;
    const yl = l ? l.y : this.o.p.int[1] - 50;
    const u = S.P(x, (y0 + y1) / 2, zc + 70);
    const v = S.P(x, (y0 + y1) / 2, zl);
    const w = S.P(x, yl, zl);
    st.tube(u, v, 0.016, 10);
    st.sphere(v, 0.017, 8);
    st.tube(v, w, 0.016, 10);
    st.sphere(w, 0.022, 8);
  }

  /** Заливная горловина в нише стены w: снаружи — лючок заподлицо, замок, знаки W01 и «ДТ»; изнутри — короб ниши. */
  niche(w, u, z) {
    const S = this.o.s;
    const lk = S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45));
    const dk = S.M(StMat.paint('#24292e', 0.55));
    const mt = S.M(StMat.metal('#c3c8cd', 0.3));
    const a = 0.2;
    const { at, n, bx } = this.nicheFrame(w, u, z);
    bx(dk, [-a, a], [-a, a], [0, 0.003]);
    bx(lk, [-a + 0.012, a - 0.012], [-a + 0.012, a - 0.012], [0.002, 0.004], 0.003);
    bx(mt, [-0.02, 0.02], [-0.12, -0.08], [0.003, 0.006], 0.004);
    S.sticker({ type: 'sign', id: 'W01' }, at(-0.08, 0.06, 0.005), n, [0.12, 0.105]);
    S.sticker({ type: 'sign', id: 'DT' }, at(0.1, 0.06, 0.005), n, [0.11, 0.06]);
    if (!this.o.inside) return;
    const t = w === 'left' ? S.ox : S.oy;
    bx(lk, [-a, a], [-a, a], [-(t + 0.15), -t], 0.01);
    dk.tube(at(0, -0.02, -t - 0.02), at(0, -0.02, -t - 0.12), 0.04, 14);
  }

  /** Наружная плоскость стены у горловины: at(вдоль, вверх, наружу), нормаль наружу, короб bx([вдоль], [вверх], [наружу]). */
  nicheFrame(w, u, z) {
    const S = this.o.s;
    const end = w === 'left';
    const zc = S.base + S.mm(z);
    const n = { left: [-1, 0, 0], back: [0, 1, 0] }[w] || [0, -1, 0];
    const c = end ? [this.o.leftX(), S.oy + S.mm(u), zc] : [S.ox + S.mm(u), w === 'back' ? S.We : this.o.frontY(), zc];
    const at = (du, dz, o) => (end ? [c[0] + n[0] * o, c[1] + du, c[2] + dz] : [c[0] + du, c[1] + n[1] * o, c[2] + dz]);
    const bx = (m, [d0, d1], [z0, z1], [o0, o1], r = 0) => {
      const p = at(d0, z0, o0);
      const q = at(d1, z1, o1);
      m.box([p[0], p[1], p[2]], [q[0], q[1], q[2]], r);
    };
    return { at, n, bx };
  }
}
