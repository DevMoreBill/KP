import { RalColor } from '../layout/ral-color.js';
import { StationMods } from '../layout/station-mods.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Корпус контейнера снаружи. */
export class SceneHull {
  constructor(s) {
    this.s = s;
  }

  chassis() {
    const d = this.s.M(StMat.paint('#30353b', 0.6));
    const tire = this.s.M(StMat.paint('#1d1f22', 0.85));
    const rim = this.s.M(StMat.metal('#9ea4aa', 0.4));
    const z = this.s.dz;
    const L = this.s.Le;
    const W = this.s.We;
    d.box([0.2, W * 0.18, z - 0.28], [L - 0.2, W * 0.3, z], 0.01);
    d.box([0.2, W * 0.7, z - 0.28], [L - 0.2, W * 0.82, z], 0.01);
    for (let x = 0.6; x < L - 0.4; x += 1.2) d.box([x, W * 0.18, z - 0.22], [x + 0.08, W * 0.82, z - 0.06]);
    for (const k of L <= 7 ? [0.62, 0.78] : [0.66, 0.76, 0.86]) {
      const x = L * k;
      d.tube([x, W * 0.12, 0.43], [x, W * 0.88, 0.43], 0.06, 12);
      for (const y of [0.0, W - 0.32]) {
        tire.tube([x, y, 0.43], [x, y + 0.32, 0.43], 0.43, 28);
        rim.tube([x, y - 0.004, 0.43], [x, y + 0.324, 0.43], 0.24, 20);
      }
    }
    for (const y of [W * 0.2, W * 0.75]) d.box([L * 0.18, y, 0], [L * 0.18 + 0.12, y + 0.12, z - 0.28]);
  }

  container() {
    if (this.s.g.sea) this.sea();
    else if (this.s.g.type === 'welded') this.welded();
    else this.block();
    this.joints();
    this.s.room.inside();
  }

  /** Станция из модулей. */
  joints() {
    const md = this.s.g.mods;
    if (!md || !md.Lm) return;
    const L = this.s.Le;
    const W = this.s.We;
    const z0 = this.s.dz;
    const zt = z0 + this.s.He;
    const t = 0.1;
    const mm = this.s.mm;
    const f = this.s.M(StMat.paint(this.s.frame, 0.45));
    const cv = this.s.M(StMat.paint(RalColor.shade(this.s.wall, 0.86), 0.5));
    for (let i = 1; i < md.a; i++) {
      const x = mm(i * md.Lm);
      for (const y of [0, W - t]) f.box([x - t, y, z0], [x + t, y + t, zt], 0.006); // стойки обоих модулей
      cv.box([x - 0.06, W, z0 + 0.16], [x + 0.06, W + 0.006, zt - t]);
      if (!this.s.cut) cv.box([x - 0.06, -0.006, z0 + 0.16], [x + 0.06, 0, zt - t]); // нащельники
      if (!this.s.rise) cv.box([x - 0.07, 0, this.s.top], [x + 0.07, W, this.s.top + 0.012]);
    } // по кровле (плоской)
    for (let j = 1; j < md.b; j++) {
      const y = mm(j * md.Wm);
      for (const x of [0, L - t]) f.box([x, y - t, z0], [x + t, y + t, zt], 0.006);
      cv.box([L, y - 0.06, z0 + 0.16], [L + 0.006, y + 0.06, zt - t]);
      cv.box([-0.006, y - 0.06, z0 + 0.16], [0, y + 0.06, zt - t]);
      const zr = this.s.roofZ(y);
      cv.box([0, y - 0.07, zr], [L, y + 0.07, zr + 0.012]);
    }
    if (this.s.view === 'in')
      for (const p of StationMods.posts(this.s.g)) {
        const s = mm(StationMods.M.post) / 2;
        const c = this.s.P(p.x, p.y, 0);
        f.box([c[0] - s, c[1] - s, this.s.base], [c[0] + s, c[1] + s, this.s.ceil], 0.006);
      }
  }

  /** Морской контейнер: рама, угловые фитинги, гофрированные стены, крыша, торцевые двери. */
  sea() {
    const L = this.s.Le;
    const W = this.s.We;
    const z0 = this.s.dz;
    const H = this.s.He;
    const zt = z0 + H;
    const f = this.s.M(StMat.paint(this.s.frame, 0.5));
    const w = this.s.M(StMat.paint(this.s.wall, 0.5));
    const cast = this.s.M(StMat.paint(RalColor.shade(this.s.frame, 0.85), 0.55));
    const post = 0.15;
    const rail = 0.16;
    // стойки, нижние и верхние балки, фитинги
    for (const x of [0, L - post]) for (const y of [0, W - post]) f.box([x, y, z0], [x + post, y + post, zt], 0.008);
    for (const y of [0, W - 0.16]) {
      f.box([0, y, z0], [L, y + 0.16, z0 + rail], 0.006);
      f.box([0, y, zt - 0.11], [L, y + 0.16, zt], 0.006);
    }
    for (const x of [0, L - 0.2]) {
      f.box([x, 0, z0], [x + 0.2, W, z0 + 0.2], 0.006);
      f.box([x, 0, zt - 0.12], [x + 0.2, W, zt], 0.006);
    }
    for (const x of [0, L - 0.178])
      for (const y of [0, W - 0.162])
        for (const z of [z0, zt - 0.118]) {
          cast.box([x - 0.004, y - 0.004, z], [x + 0.182, y + 0.166, z + 0.118], 0.01);
          const dk = this.s.M(StMat.paint('#15181b', 0.8));
          dk.box([x + 0.05, y - 0.006, z + 0.035], [x + 0.13, y + 0.004, z + 0.085], 0.01);
        }
    if (this.s.doorsB.length) this.s.room.backWall(w, z0 + rail, zt - 0.11, StScene.SEA_P);
    else w.corr(0, [post, L - post], [W - 0.03, 1], [z0 + rail, zt - 0.11]);
    w.corr(1, [post, W - post], [L - 0.03, 1], [z0 + 0.2, zt - 0.12], [0.28, 0.045]);
    if (!this.s.cut) this.s.room.frontWall(w, z0 + rail, zt - 0.11, StScene.SEA_P);
    // крыша: лист с неглубокими поперечными гофрами
    const roof = this.s.M(StMat.paint(this.s.roofC, 0.5));
    roof.box([post, 0.06, zt - 0.02], [L - post, W - 0.06, zt - 0.004]);
    for (let x = post + 0.25; x < L - post - 0.1; x += 0.5)
      roof.box([x, 0.08, zt - 0.004], [x + 0.2, W - 0.08, zt + 0.008], 0.004);
    this.cargoDoors();
  }

  /** Торцевые двери морского контейнера (торец у двери, x = 0): две створки, четыре запорные штанги, ручки, петли. */
  cargoDoors() {
    const W = this.s.We;
    const z0 = this.s.dz + 0.2;
    const z1 = this.s.dz + this.s.He - 0.12;
    const w = this.s.M(StMat.paint(this.s.door, 0.5));
    const bar = this.s.M(StMat.metal(StScene.GALV, 0.4));
    const dk = this.s.M(StMat.paint('#202428', 0.6));
    w.corr(1, [0.15, W / 2 - 0.01], [0.0, -1], [z0, z1], [0.32, 0.03]);
    w.corr(1, [W / 2 + 0.01, W - 0.15], [0.0, -1], [z0, z1], [0.32, 0.03]);
    for (const y of [W / 2 - 0.012, W / 2 + 0.012]) dk.box([-0.035, y - 0.006, z0], [-0.02, y + 0.006, z1]);
    for (const f of [0.14, 0.36, 0.64, 0.86]) {
      const y = W * f;
      bar.tube([-0.06, y, z0 + 0.05], [-0.06, y, z1 - 0.05], 0.016, 10);
      for (const z of [z0 + 0.06, z1 - 0.06]) dk.box([-0.075, y - 0.03, z - 0.03], [-0.035, y + 0.03, z + 0.03], 0.005);
      dk.box(
        [-0.09, y - 0.012, this.s.dz + this.s.He * 0.42],
        [-0.06, y + 0.15 * (f < 0.5 ? 1 : -1), this.s.dz + this.s.He * 0.42 + 0.03],
        0.006,
      );
    }
    for (const y of [0.17, W - 0.19])
      for (const k of [0.2, 0.5, 0.8])
        dk.box([-0.05, y, z0 + (z1 - z0) * k], [-0.02, y + 0.04, z0 + (z1 - z0) * k + 0.1], 0.004);
  }

  /** Блок-контейнер: каркас из профильной трубы, стены и кровля — сэндвич-панели со швами. */
  block() {
    const L = this.s.Le;
    const W = this.s.We;
    const z0 = this.s.dz;
    const zt = z0 + this.s.He;
    const f = this.s.M(StMat.paint(this.s.frame, 0.45));
    const w = this.s.M(StMat.paint(this.s.wall, 0.42));
    const seam = this.s.M(StMat.paint(RalColor.shade(this.s.wall, 0.82), 0.6));
    const t = 0.1;
    for (const x of [0, L - t]) for (const y of [0, W - t]) f.box([x, y, z0], [x + t, y + t, zt], 0.006);
    for (const y of [0, W - t]) {
      f.box([0, y, z0], [L, y + t, z0 + 0.16], 0.006);
      f.box([0, y, zt - t], [L, y + t, zt], 0.006);
    }
    for (const x of [0, L - t]) {
      f.box([x, 0, z0], [x + t, W, z0 + 0.16], 0.006);
      f.box([x, 0, zt - t], [x + t, W, zt], 0.006);
    }
    // стены: задняя, торцы; швы панелей шагом около 1,15 м
    const panel = (along, u0, u1, wv, out) => {
      const P = (u, z) => (along === 0 ? [u, wv, z] : [wv, u, z]),
        n = along === 0 ? [0, out, 0] : [out, 0, 0];
      w.quad(P(u0, z0 + 0.16), P(u1, z0 + 0.16), P(u1, zt - t), P(u0, zt - t), n);
      const k = Math.max(1, Math.round((u1 - u0) / 1.15));
      for (let i = 1; i < k; i++) {
        const u = u0 + ((u1 - u0) * i) / k,
          o = out * 0.004;
        seam.box(
          ...(along === 0
            ? [
                [u - 0.006, wv + o - 0.002, z0 + 0.16],
                [u + 0.006, wv + o + 0.002, zt - t],
              ]
            : [
                [wv + o - 0.002, u - 0.006, z0 + 0.16],
                [wv + o + 0.002, u + 0.006, zt - t],
              ]),
        );
      }
    };
    if (this.s.doorsB.length) this.s.room.backWall(w, z0 + 0.16, zt - t, null);
    else panel(0, t, L - t, W - 0.02, 1);
    panel(1, t, W - t, L - 0.02, 1);
    panel(1, t, W - t, 0.02, -1);
    if (!this.s.cut) this.s.room.frontWall(w, z0 + 0.16, zt - t, null);
    this.roof(zt, this.s.roofC);
    this.s.room.endDoors();
  }

  /** Цельносварной: рама из гнутого швеллера и стойки, стены — профилированный лист (трапеция), приваренный к раме. */
  welded() {
    const L = this.s.Le;
    const W = this.s.We;
    const z0 = this.s.dz;
    const zt = z0 + this.s.He;
    const f = this.s.M(StMat.paint(this.s.frame, 0.45));
    const w = this.s.M(StMat.paint(this.s.wall, 0.45));
    const t = 0.12;
    const b = 0.2;
    const P = StScene.WELD_P;
    for (const x of [0, L - t]) for (const y of [0, W - t]) f.box([x, y, z0], [x + t, y + t, zt], 0.006);
    for (const y of [0, W - t]) {
      f.box([0, y, z0], [L, y + t, z0 + b], 0.006);
      f.box([0, y, zt - 0.1], [L, y + t, zt], 0.006);
    }
    for (const x of [0, L - t]) {
      f.box([x, 0, z0], [x + t, W, z0 + b], 0.006);
      f.box([x, 0, zt - 0.1], [x + t, W, zt], 0.006);
    }
    if (this.s.doorsB.length) this.s.room.backWall(w, z0 + b, zt - 0.1, P);
    else w.corr(0, [t, L - t], [W - 0.025, 1], [z0 + b, zt - 0.1], [...P]);
    w.corr(1, [t, W - t], [L - 0.025, 1], [z0 + b, zt - 0.1], [...P]);
    w.corr(1, [t, W - t], [0.025, -1], [z0 + b, zt - 0.1], [...P]);
    if (!this.s.cut) this.s.room.frontWall(w, z0 + b, zt - 0.1, P);
    this.roof(zt, this.s.roofC);
    this.s.room.endDoors();
  }

  /** Радиус дуги арочной крыши: хорда — ширина контейнера, стрела — подъём. */
  arcR() {
    const R = this.s.rise;
    const h = this.s.We / 2;
    return (h * h + R * R) / (2 * R);
  }

  /** Крыша блок-контейнера и цельносварного. */
  roof(zt, col) {
    const m = this.s.M(StMat.paint(col, 0.45));
    if (this.s.rise > 0) {
      const ribs = [this.s.M(StMat.paint(RalColor.shade(col, 0.93), 0.45)), this.s.M(StMat.paint(this.s.wall, 0.42))];
      const kind = this.s.g.roof;
      if (kind === 'arch') this.arch(zt, m, ribs, 0.06, 0.04);
      else if (kind === 'gable') this.gable(zt, m, ribs);
      else this.shed(zt, m, ribs);
    } else m.box([-0.03, -0.03, zt - 0.02], [this.s.Le + 0.03, this.s.We + 0.03, zt + 0.03], 0.01);
    this.lugs(zt);
  }

  /** Скат кровли от (ya, za) до (yb, zb) со свесом по длине: лист и рёбра. */
  slope(m, rib, [ya, za], [yb, zb]) {
    const o = 0.06;
    const L = this.s.Le;
    const dy = yb - ya;
    const dz = zb - za;
    const l = Math.hypot(dy, dz);
    const s = Math.sign(dy);
    const n = [0, (-dz * s) / l, (dy * s) / l];
    const v = [0, dy, dz];
    const w = StV.mul(n, 0.04);
    m.obox([-o, ya, za], [L + 2 * o, 0, 0], v, w);
    for (let x = 0.12; x < L + 2 * o - 0.08; x += 0.333)
      rib.obox(StV.add([x - o, ya, za], w), [0.035, 0, 0], v, StV.mul(n, 0.028));
  }

  /** Двускатная: конёк вдоль контейнера, фронтоны в торцах. */
  gable(zt, m, [rib, gb]) {
    const L = this.s.Le;
    const W = this.s.We;
    const R = this.s.rise;
    const o = 0.06;
    const ze = zt - (o * R) / (W / 2);
    this.slope(m, rib, [-o, ze], [W / 2, zt + R]);
    this.slope(m, rib, [W + o, ze], [W / 2, zt + R]);
    m.box([-o, W / 2 - 0.09, zt + R + 0.04 * 0.3], [L + o, W / 2 + 0.09, zt + R + 0.04 + 0.02], 0.01);
    for (const [x, n] of [
      [0, -1],
      [L, 1],
    ])
      gb.tri([x, 0, zt], [x, W, zt], [x, W / 2, zt + R], [n, 0, 0]);
  }

  /** Односкатная: выше у стены с дверью, скат — к задней стене. */
  shed(zt, m, [rib, gb]) {
    const L = this.s.Le;
    const W = this.s.We;
    const R = this.s.rise;
    const o = 0.06;
    const k = R / W;
    this.slope(m, rib, [W + o, zt - o * k], [-o, zt + R + o * k]);
    for (const [x, n] of [
      [0, -1],
      [L, 1],
    ])
      gb.tri([x, 0, zt], [x, W, zt], [x, 0, zt + R], [n, 0, 0]);
    if (!this.s.cut) gb.quad([0, 0, zt], [L, 0, zt], [L, 0, zt + R], [0, 0, zt + R], [0, -1, 0]);
  }

  /** Арочная крыша: лист по дуге (гладкие нормали) толщиной t со свесами o, рёбра по дуге, торцы под дугой — стеной. */
  arch(zt, m, [rib, gb], o, t) {
    const L = this.s.Le;
    const P = this.arcPts(zt, o);
    SceneHull.strip(m, P, [-o, L + o], 0, false);
    SceneHull.strip(m, P, [-o, L + o], -t, true);
    SceneHull.band(m, P, -o, -t, -1);
    SceneHull.band(m, P, L + o, -t, 1);
    for (let x = 0.12; x < L + 2 * o - 0.08; x += 0.333) {
      const x0 = x - o;
      const x1 = x0 + 0.035;
      SceneHull.strip(rib, P, [x0, x1], 0.026, false);
      SceneHull.band(rib, P, x0, 0.026, -1);
      SceneHull.band(rib, P, x1, 0.026, 1);
    }
    const W = this.s.We;
    for (const [x, sx] of [
      [0, -1],
      [L, 1],
    ])
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k];
        const b = P[k + 1];
        if (a.y < 0 || b.y > W) continue; // торец под дугой
        gb.tri([x, W / 2, zt], [x, a.y, Math.max(zt, a.z - t)], [x, b.y, Math.max(zt, b.z - t)], [sx, 0, 0]);
      }
  }

  /** Точки дуги поперёк контейнера со свесами o: y, z и нормаль. */
  arcPts(zt, o) {
    const W = this.s.We;
    const rc = this.arcR();
    const zc = zt + this.s.rise - rc;
    const N = 20;
    const P = [];
    for (let k = 0; k <= N; k++) {
      const y = -o + ((W + 2 * o) * k) / N;
      const z = zc + Math.sqrt(Math.max(0, rc * rc - (y - W / 2) * (y - W / 2)));
      P.push({ y, z, n: StV.norm([0, y - W / 2, z - zc]) });
    }
    return P;
  }

  /** Полоса по дуге от x0 до x1, смещённая по нормали на off (flip — нормаль внутрь). */
  static strip(mesh, P, [x0, x1], off, flip) {
    const s = flip ? -1 : 1;
    const q = (p, x) => [x, p.y + p.n[1] * off, p.z + p.n[2] * off];
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k];
      const b = P[k + 1];
      const i = mesh.count;
      mesh.vert(q(a, x0), StV.mul(a.n, s));
      mesh.vert(q(a, x1), StV.mul(a.n, s));
      mesh.vert(q(b, x1), StV.mul(b.n, s));
      mesh.vert(q(b, x0), StV.mul(b.n, s));
      mesh.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  /** Торец полосы в плоскости x: от дуги до смещения off по нормали, нормаль торца — sx по x. */
  static band(mesh, P, x, off, sx) {
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k];
      const b = P[k + 1];
      mesh.quad(
        [x, a.y, a.z],
        [x, b.y, b.z],
        [x, b.y + b.n[1] * off, b.z + b.n[2] * off],
        [x, a.y + a.n[1] * off, a.z + a.n[2] * off],
        [sx, 0, 0],
      );
    }
  }

  /** Строповочные петли в верхних углах рамы (блок-контейнер, цельносварной). */
  lugs(zt) {
    const L = this.s.Le;
    const W = this.s.We;
    const m = this.s.M(StMat.paint(RalColor.shade(this.s.frame, 0.9), 0.45));
    const dk = this.s.M(StMat.paint('#15181b', 0.8));
    for (const x of [0.09, L - 0.09])
      for (const y of [0.05, W - 0.05]) {
        const z0 = this.s.rise > 0 ? this.s.roofZ(y) + 0.03 : zt + 0.03;
        m.box([x - 0.08, y - 0.012, z0 - 0.02], [x + 0.08, y + 0.012, z0 + 0.12], 0.008);
        dk.tube([x, y - 0.015, z0 + 0.07], [x, y + 0.015, z0 + 0.07], 0.03, 16);
      }
  }
}
