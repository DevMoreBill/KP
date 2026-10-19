import { StV } from './st-v.js';

const CORR = [
  [0, 0],
  [0.26, 0],
  [0.37, 1],
  [0.63, 1],
  [0.74, 0],
  [1, 0],
];

/** Геометрия одного материала: вершины, нормали, треугольники; t — координаты текстуры (только у наклеек). */
export class StMesh {
  constructor() {
    this.p = [];
    this.n = [];
    this.i = [];
    this.t = [];
  }

  get count() {
    return this.p.length / 3;
  }

  vert(p, n) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    return this.p.length / 3 - 1;
  }

  /** Плоский четырёхугольник a-b-c-d (по кругу) с нормалью n (не задана — по обходу). */
  quad(a, b, c, d, n) {
    n = n || StV.norm(StV.cross(StV.sub(b, a), StV.sub(d, a)));
    const k = this.vert(a, n);
    this.vert(b, n);
    this.vert(c, n);
    this.vert(d, n);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }

  tri(a, b, c, n) {
    n = n || StV.norm(StV.cross(StV.sub(b, a), StV.sub(c, a)));
    const k = this.vert(a, n);
    this.vert(b, n);
    this.vert(c, n);
    this.i.push(k, k + 1, k + 2);
  }

  /** Наклейка: четырёхугольник a-b-c-d (a — левый нижний, по кругу) с текстурой (строка 0 картинки — вверху). */
  decal(a, b, c, d, n) {
    const k = this.vert(a, n);
    this.vert(b, n);
    this.vert(c, n);
    this.vert(d, n);
    this.t.push(0, 1, 1, 1, 1, 0, 0, 0);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }

  /** Наклейка на цилиндре (ось z в точке cx, cy, радиус r): по дуге a0…a1, по высоте z0…z1. */
  decalArc([cx, cy, r], [a0, a1], [z0, z1], seg = 12) {
    const k0 = this.count;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + ((a1 - a0) * j) / seg;
      const n = [Math.cos(a), Math.sin(a), 0];
      const u = j / seg;
      this.vert([cx + r * n[0], cy + r * n[1], z0], n);
      this.t.push(u, 1);
      this.vert([cx + r * n[0], cy + r * n[1], z1], n);
      this.t.push(u, 0);
    }
    for (let j = 0; j < seg; j++) {
      const q = k0 + j * 2;
      this.i.push(q, q + 2, q + 3, q, q + 3, q + 1);
    }
  }

  /** Короб между углами a и b; r — фаска по рёбрам (блик на гранях, как у гнутого листа). */
  box(a, b, r = 0) {
    const lo = a.map((v, k) => Math.min(v, b[k]));
    const hi = a.map((v, k) => Math.max(v, b[k]));
    if (hi.some((v, k) => v - lo[k] < 1e-5)) return;
    const f = { lo, hi, r: Math.max(0, Math.min(r, ...hi.map((v, k) => (v - lo[k]) / 2.2))) };
    this.faces(f);
    if (!f.r) return;
    this.edges(f);
    this.corners(f);
  }

  static pt(...av) {
    const p = [0, 0, 0];
    for (let k = 0; k < av.length; k += 2) p[av[k]] = av[k + 1];
    return p;
  }

  static ext({ lo, hi }, k, s) {
    return s > 0 ? hi[k] : lo[k];
  }

  static ins({ lo, hi, r }, k, s) {
    return s > 0 ? hi[k] - r : lo[k] + r;
  }

  /** Шесть граней (без фасок). */
  faces(f) {
    const { lo, hi, r } = f;
    const pt = StMesh.pt;
    for (let a = 0; a < 3; a++) {
      const [b, c] = [(a + 1) % 3, (a + 2) % 3];
      for (const s of [-1, 1]) {
        const n = [0, 0, 0];
        n[a] = s;
        const x = StMesh.ext(f, a, s);
        this.quad(
          pt(a, x, b, lo[b] + r, c, lo[c] + r),
          pt(a, x, b, hi[b] - r, c, lo[c] + r),
          pt(a, x, b, hi[b] - r, c, hi[c] - r),
          pt(a, x, b, lo[b] + r, c, hi[c] - r),
          n,
        );
      }
    }
  }

  /** Фаски по двенадцати рёбрам. */
  edges(f) {
    const { lo, hi, r } = f;
    const pt = StMesh.pt;
    const { ext, ins } = StMesh;
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const c = 3 - a - b;
      for (const [sa, sb] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const n = [0, 0, 0];
        n[a] = sa * Math.SQRT1_2;
        n[b] = sb * Math.SQRT1_2;
        this.quad(
          pt(a, ext(f, a, sa), b, ins(f, b, sb), c, lo[c] + r),
          pt(a, ins(f, a, sa), b, ext(f, b, sb), c, lo[c] + r),
          pt(a, ins(f, a, sa), b, ext(f, b, sb), c, hi[c] - r),
          pt(a, ext(f, a, sa), b, ins(f, b, sb), c, hi[c] - r),
          n,
        );
      }
    }
  }

  /** Срезы восьми углов. */
  corners(f) {
    const { ext, ins } = StMesh;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          this.tri(
            [ext(f, 0, sx), ins(f, 1, sy), ins(f, 2, sz)],
            [ins(f, 0, sx), ext(f, 1, sy), ins(f, 2, sz)],
            [ins(f, 0, sx), ins(f, 1, sy), ext(f, 2, sz)],
            StV.norm([sx, sy, sz]),
          );
        }
      }
    }
  }

  /** Повёрнутый короб: угол o и рёбра u, v, w (векторы) — створки дверей и наклонные детали. */
  obox(o, u, v, w) {
    const P = (a, b, c) => StV.add(o, StV.add(StV.mul(u, a), StV.add(StV.mul(v, b), StV.mul(w, c))));
    const nu = StV.norm(u);
    const nv = StV.norm(v);
    const nw = StV.norm(w);
    this.quad(P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1), StV.mul(nu, -1));
    this.quad(P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1), nu);
    this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), StV.mul(nv, -1));
    this.quad(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), nv);
    this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), StV.mul(nw, -1));
    this.quad(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), nw);
  }

  /** Цилиндр (конус, если r2) от точки a до точки b; caps — донышки [в a, в b]. */
  tube(a, b, r, seg = 20, { caps = [true, true], r2 } = {}) {
    const d = StV.sub(b, a);
    const L = StV.len(d);
    if (L < 1e-5) return;
    const ax = StV.mul(d, 1 / L);
    const [u, v] = StV.basis(ax);
    const R2 = r2 == null ? r : r2;
    const k0 = this.count;
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      const n = StV.add(StV.mul(u, Math.cos(t)), StV.mul(v, Math.sin(t)));
      this.vert(StV.add(a, StV.mul(n, r)), n);
      this.vert(StV.add(b, StV.mul(n, R2)), n);
    }
    for (let k = 0; k < seg; k++) {
      const q = k0 + k * 2;
      this.i.push(q, q + 1, q + 3, q, q + 3, q + 2);
    }
    if (caps[0] && r > 0) this.cap(a, r, StV.mul(ax, -1), [u, v], seg);
    if (caps[1] && R2 > 0) this.cap(b, R2, ax, [u, v], seg);
  }

  /** Донышко цилиндра: круг радиуса rr в точке c с нормалью n. */
  cap(c, rr, n, [u, v], seg) {
    const m = this.vert(c, n);
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      this.vert(StV.add(c, StV.add(StV.mul(u, Math.cos(t) * rr), StV.mul(v, Math.sin(t) * rr))), n);
    }
    for (let k = 0; k < seg; k++) this.i.push(m, m + 1 + k, m + 2 + k);
  }

  sphere(c, r, seg = 16) {
    const k0 = this.count;
    const rows = Math.max(4, seg >> 1);
    for (let i = 0; i <= rows; i++) {
      const th = (i / rows) * Math.PI;
      const st = Math.sin(th);
      const ct = Math.cos(th);
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const n = [st * Math.cos(ph), st * Math.sin(ph), ct];
        this.vert(StV.add(c, StV.mul(n, r)), n);
      }
    }
    this.grid(k0, rows, seg);
  }

  /** Треугольники сетки rows × seg вершин (строки по seg + 1). */
  grid(k0, rows, seg) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < seg; j++) {
        const a = k0 + i * (seg + 1) + j;
        const b = a + seg + 1;
        this.i.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /** Эллиптическое днище (2:1). */
  dish([cx, cy, z], r, dir, seg = 24) {
    const k0 = this.count;
    const rows = 8;
    const h = r * 0.5;
    for (let i = 0; i <= rows; i++) {
      const a = ((i / rows) * Math.PI) / 2;
      const rr = r * Math.cos(a);
      const zz = z + dir * h * Math.sin(a);
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const n = StV.norm([
          (Math.cos(a) * Math.cos(ph)) / r,
          (Math.cos(a) * Math.sin(ph)) / r,
          (dir * Math.sin(a)) / h,
        ]);
        this.vert([cx + rr * Math.cos(ph), cy + rr * Math.sin(ph), zz], n);
      }
    }
    this.grid(k0, rows, seg);
  }

  /** Гофр (трапеция) вдоль оси along (0 — x, 1 — y) от u0 до u1, по высоте z0…z1; плоскость стены — на координате w поперёк, наружу — out (±1); шаг и глубина гофра. /. */
  corr(along, [u0, u1], [w, out], [z0, z1], [pitch, depth] = [0.278, 0.036]) {
    const P = (u, o, z) => (along === 0 ? [u, w + out * o, z] : [w + out * o, u, z]);
    const prof = CORR.map(([s, d]) => [s, d * depth]);
    for (let u = u0; u < u1 - 1e-6; u += pitch) {
      const span = Math.min(pitch, u1 - u);
      for (let k = 0; k < prof.length - 1; k++) {
        const [a, b] = [prof[k], prof[k + 1]];
        const ua = u + a[0] * pitch;
        const ub = Math.min(u + b[0] * pitch, u + span);
        if (ub > ua)
          this.quad(
            P(ua, a[1], z0),
            P(ub, b[1], z0),
            P(ub, b[1], z1),
            P(ua, a[1], z1),
            StMesh.outward(along, out, [ub - ua, b[1] - a[1]]),
          );
      }
    }
  }

  /** Нормаль грани гофра — наружу. */
  static outward(along, out, [du, dd]) {
    const t = StV.norm(along === 0 ? [du, out * dd, 0] : [out * dd, du, 0]);
    const n = [t[1], -t[0], 0];
    return StV.norm(StV.dot(n, along === 0 ? [0, out, 0] : [out, 0, 0]) < 0 ? StV.mul(n, -1) : n);
  }
}
