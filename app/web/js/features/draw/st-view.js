import { RalColor } from '../layout/ral-color.js';

export class StView {
  constructor(P, k, se, S) {
    this.P = P;
    this.k = k;
    this.se = se;
    this.S = S;
    this.defs = [];
    this.gid = 0;
  }
  face(Q, fill, sw = 1, extra = '') {
    return this.S.poly(
      Q.map(q => this.P(...q)),
      fill,
      sw ? RalColor.shade(fill.startsWith('#') ? fill : '#888888', 0.62) : '',
      sw,
      extra,
    );
  }
  line(a, b, stroke, sw) {
    const p = this.P(...a);
    const q = this.P(...b);
    return this.S.line([p[0], p[1]], [q[0], q[1]], stroke, sw, ' stroke-linecap="round"');
  }
  /** Короб: видны торец x0, лицевая сторона y0 и верх; deco(f, грань) — детали на грани в долях u, v. */
  box([x0, y0, z0], [x1, y1, z1], c, deco) {
    if (x1 - x0 < 1 || y1 - y0 < 1 || z1 - z0 < 1) return [];
    const top = RalColor.light(c) < 0.3 ? 1.25 : 1.1;
    const out = [
      this.face(
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        RalColor.shade(c, 0.8),
        1,
      ),
      this.face(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        c,
        1,
      ),
      this.face(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        RalColor.shade(c, top),
        1,
      ),
    ];
    if (deco) {
      const fr = (u, v) => [x0 + (x1 - x0) * u, y0 - 1, z0 + (z1 - z0) * v];
      const lf = (u, v) => [x0 - 1, y1 - (y1 - y0) * u, z0 + (z1 - z0) * v];
      const a = deco(fr, 'front');
      const b = deco(lf, 'left');
      if (a) out.push(a);
      if (b) out.push(b);
    }
    return out;
  }
  rectOn(f, [u0, u1], [v0, v1], fill) {
    return this.face([f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)], fill, 0);
  }
  lineOn(f, [u0, v0], [u1, v1], stroke, sw) {
    return this.line(f(u0, v0), f(u1, v1), stroke, sw);
  }
  grille(f, [u0, u1], [v0, v1], n, stroke) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const v = v0 + ((v1 - v0) * (i + 0.5)) / n;
      s += this.line(f(u0, v), f(u1, v), stroke, 1.6);
    }
    return s;
  }
  /** Жалюзи на стене: углы a и b (x — на торце, y — на задней стене). */
  louver(a, b, axis) {
    const [x0, y0, z0] = a;
    const [x1, y1, z1] = b;
    const Q =
      axis === 'x'
        ? [
            [x0, y0, z0],
            [x0, y1, z0],
            [x0, y1, z1],
            [x0, y0, z1],
          ]
        : [
            [x0, y0, z0],
            [x1, y0, z0],
            [x1, y0, z1],
            [x0, y0, z1],
          ];
    let s = this.face(Q, '#8d959d', 1.2);
    for (let i = 1; i < 8; i++) {
      const z = z0 + ((z1 - z0) * i) / 8;
      s +=
        axis === 'x'
          ? this.line([x0, y0, z], [x0, y1, z], '#4d555d', 1.6)
          : this.line([x0, y0, z], [x1, y0, z], '#4d555d', 1.6);
    }
    return s;
  }
  /** Вертикальный цилиндр (ресивер — с выпуклым днищем сверху), заливка — градиент «объёма». */
  vcyl([cx, cy, r], [z0, z1], c, dome) {
    const S = this.S;
    const b = this.P(cx, cy, z0);
    const t = this.P(cx, cy, z1);
    const rx = r * this.k;
    const ry = r * this.k * this.se;
    const id = `g${++this.gid}`;
    this.defs.push(
      `<linearGradient id="${id}" x1="${S.f(b[0] - rx)}" y1="0" x2="${S.f(b[0] + rx)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(c, 0.78)}"/><stop offset="0.35" stop-color="${RalColor.shade(c, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(c, 0.62)}"/></linearGradient>`,
    );
    const edge = RalColor.shade(c, 0.55);
    const f = S.f;
    let s = `<path d="M${f(t[0] - rx)},${f(t[1])} L${f(b[0] - rx)},${f(b[1])} A${f(rx)},${f(ry)} 0 0 0 ${f(b[0] + rx)},${f(b[1])} L${f(t[0] + rx)},${f(t[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    if (dome)
      s += `<path d="M${f(t[0] - rx)},${f(t[1])} A${f(rx)},${f(Math.max(ry, rx * 0.42))} 0 0 1 ${f(t[0] + rx)},${f(t[1])} A${f(rx)},${f(ry)} 0 0 1 ${f(t[0] - rx)},${f(t[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    else
      s += `<ellipse cx="${f(t[0])}" cy="${f(t[1])}" rx="${f(rx)}" ry="${f(ry)}" fill="${RalColor.shade(c, 1.1)}" stroke="${edge}" stroke-width="1"/>`;
    return s;
  }
  /** Горизонтальный цилиндр вдоль x. */
  hcyl([x0, x1], [cy, cz, r], c) {
    const S = this.S;
    const ring = x => {
      const a = [];
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        a.push(this.P(x, cy + r * Math.cos(t), cz + r * Math.sin(t)));
      }
      return a;
    };
    const A = ring(x0);
    const B = ring(x1);
    const hull = StView.hull([...A, ...B]);
    const id = `g${++this.gid}`;
    const p = this.P(x0, cy, cz + r);
    const q = this.P(x0, cy, cz - r);
    this.defs.push(
      `<linearGradient id="${id}" x1="${S.f(p[0])}" y1="${S.f(p[1])}" x2="${S.f(q[0])}" y2="${S.f(q[1])}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(c, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(c, 0.62)}"/></linearGradient>`,
    );
    return (
      S.poly(hull, `url(#${id})`, RalColor.shade(c, 0.55), 1) +
      S.poly(A, RalColor.shade(c, 0.85), RalColor.shade(c, 0.55), 1)
    );
  }
  static hull(P) {
    const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    const up = [];
    for (const q of p) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (const q of p.reverse()) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  /** Шасси: рама, оси с колёсами, дышло. */
  chassis(Le, We, dz) {
    const out = [];
    const dark = '#33383e';
    const axes = Le <= 7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86];
    out.push(
      ...this.box([150, We * 0.15, dz - 260], [Le - 150, We * 0.3, dz], dark),
      ...this.box([150, We * 0.7, dz - 260], [Le - 150, We * 0.85, dz], dark),
    );
    for (const k of axes) {
      const x = Le * k;
      for (const y of [We - 260, 40]) {
        const id = `w${++this.gid}`;
        const c = this.P(x, y, 430);
        const rr = 430 * this.k;
        this.defs.push(
          `<radialGradient id="${id}"><stop offset="0.5" stop-color="#8c9298"/><stop offset="0.56" stop-color="#202326"/><stop offset="1" stop-color="#2b2e31"/></radialGradient>`,
        );
        out.push(
          `<ellipse cx="${this.S.f(c[0])}" cy="${this.S.f(c[1])}" rx="${this.S.f(rr * 0.62)}" ry="${this.S.f(rr)}" fill="url(#${id})" transform="rotate(${this.S.f(-12)} ${this.S.f(c[0])} ${this.S.f(c[1])})"/>`,
        );
      }
    }
    out.push(
      ...this.box([Le * 0.2, We * 0.18, 0], [Le * 0.2 + 120, We * 0.18 + 120, dz - 260], dark),
      ...this.box([Le * 0.2, We * 0.7, 0], [Le * 0.2 + 120, We * 0.7 + 120, dz - 260], dark),
    );
    return out;
  }
  /** Глубина изделия по направлению взгляда. */
  static depth(it) {
    return ((it.X0 + it.X1) / 2) * 0.5 + ((it.Y0 + it.Y1) / 2) * 0.866;
  }

  /** Из пары изделий — дальнее (рисуется раньше). */
  static farther(A, B) {
    const sx = A.X1 <= B.X0 + 1 || B.X1 <= A.X0 + 1;
    const sy = A.Y1 <= B.Y0 + 1 || B.Y1 <= A.Y0 + 1;
    if (sy && !sx) return A.Y0 >= B.Y1 - 1 ? A : B;
    if (sx && !sy) return A.X0 >= B.X1 - 1 ? A : B;
    if (!sx && !sy) return StView.depth(A) >= StView.depth(B) ? A : B;
    return null;
  }

  /** Порядок отрисовки: из пары разнесённых только по одной оси сначала дальняя (больше y или x). */
  order(items) {
    const n = items.length;
    const nxt = items.map(() => []);
    const indeg = new Array(n).fill(0);
    const dep = i => StView.depth(items[i]);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const f = StView.farther(items[i], items[j]);
        if (!f) continue;
        const [far, near] = f === items[i] ? [i, j] : [j, i];
        nxt[far].push(near);
        indeg[near]++;
      }
    const out = [];
    const ready = [...Array(n).keys()].filter(i => !indeg[i]);
    while (ready.length) {
      ready.sort((a, b) => dep(b) - dep(a));
      const i = ready.shift();
      out.push(items[i]);
      for (const j of nxt[i]) if (!--indeg[j]) ready.push(j);
    }
    if (out.length < n) for (const it of items) if (!out.includes(it)) out.push(it);
    return out;
  }
}
