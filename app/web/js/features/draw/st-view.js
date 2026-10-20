import { RalColor } from '../layout/ral-color.js';

export class StView {
  constructor(project, k, sinEl, svg) {
    this.project = project;
    this.k = k;
    this.sinEl = sinEl;
    this.svg = svg;
    this.defs = [];
    this.gid = 0;
  }
  /** Грань-четырёхугольник в проекции. */
  face(quad, fill, strokeW = 1, extra = '') {
    return this.svg.poly(
      quad.map(point => this.project(...point)),
      fill,
      strokeW ? RalColor.shade(fill.startsWith('#') ? fill : '#888888', 0.62) : '',
      strokeW,
      extra,
    );
  }
  /** Отрезок между точками пространства. */
  line(start, end, stroke, strokeW) {
    const startPt = this.project(...start);
    const endPt = this.project(...end);
    return this.svg.line([startPt[0], startPt[1]], [endPt[0], endPt[1]], stroke, strokeW, ' stroke-linecap="round"');
  }
  /** Короб: видны торец x0, лицевая сторона y0 и верх; deco(f, грань) — детали на грани в долях u, v. */
  box([x0, y0, z0], [x1, y1, z1], color, deco) {
    if (x1 - x0 < 1 || y1 - y0 < 1 || z1 - z0 < 1) return [];
    const top = RalColor.light(color) < 0.3 ? 1.25 : 1.1;
    const out = [
      this.face(
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        RalColor.shade(color, 0.8),
        1,
      ),
      this.face(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        color,
        1,
      ),
      this.face(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        RalColor.shade(color, top),
        1,
      ),
    ];
    if (deco) {
      const front = (fracU, fracV) => [x0 + (x1 - x0) * fracU, y0 - 1, z0 + (z1 - z0) * fracV];
      const left = (fracU, fracV) => [x0 - 1, y1 - (y1 - y0) * fracU, z0 + (z1 - z0) * fracV];
      const frontDeco = deco(front, 'front');
      const leftDeco = deco(left, 'left');
      if (frontDeco) out.push(frontDeco);
      if (leftDeco) out.push(leftDeco);
    }
    return out;
  }
  /** Прямоугольник на грани в долях её сторон. */
  rectOn(face, [uFrom, uTo], [vFrom, vTo], fill) {
    return this.face([face(uFrom, vFrom), face(uTo, vFrom), face(uTo, vTo), face(uFrom, vTo)], fill, 0);
  }
  /** Отрезок на грани в долях её сторон. */
  lineOn(face, [uFrom, vFrom], [uTo, vTo], stroke, strokeW) {
    return this.line(face(uFrom, vFrom), face(uTo, vTo), stroke, strokeW);
  }
  /** Решётка из count полос на грани. */
  grille(face, [uFrom, uTo], [vFrom, vTo], count, stroke) {
    let svgText = '';
    for (let i = 0; i < count; i++) {
      const fracV = vFrom + ((vTo - vFrom) * (i + 0.5)) / count;
      svgText += this.line(face(uFrom, fracV), face(uTo, fracV), stroke, 1.6);
    }
    return svgText;
  }
  /** Жалюзи на стене: углы a и b (x — на торце, y — на задней стене). */
  louver(start, end, axis) {
    const [x0, y0, z0] = start;
    const [x1, y1, z1] = end;
    const quad =
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
    let svgText = this.face(quad, '#8d959d', 1.2);
    for (let i = 1; i < 8; i++) {
      const z = z0 + ((z1 - z0) * i) / 8;
      svgText +=
        axis === 'x'
          ? this.line([x0, y0, z], [x0, y1, z], '#4d555d', 1.6)
          : this.line([x0, y0, z], [x1, y0, z], '#4d555d', 1.6);
    }
    return svgText;
  }
  /** Вертикальный цилиндр (ресивер — с выпуклым днищем сверху), заливка — градиент «объёма». */
  vcyl([centerX, centerY, radius], [z0, z1], color, dome) {
    const svg = this.svg;
    const bottom = this.project(centerX, centerY, z0);
    const top = this.project(centerX, centerY, z1);
    const radiusX = radius * this.k;
    const radiusY = radius * this.k * this.sinEl;
    const id = `g${++this.gid}`;
    this.defs.push(
      `<linearGradient id="${id}" x1="${svg.fmt(bottom[0] - radiusX)}" y1="0" x2="${svg.fmt(bottom[0] + radiusX)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(color, 0.78)}"/><stop offset="0.35" stop-color="${RalColor.shade(color, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(color, 0.62)}"/></linearGradient>`,
    );
    const edge = RalColor.shade(color, 0.55);
    const fmt = svg.fmt;
    let path = `<path d="M${fmt(top[0] - radiusX)},${fmt(top[1])} L${fmt(bottom[0] - radiusX)},${fmt(bottom[1])} A${fmt(radiusX)},${fmt(radiusY)} 0 0 0 ${fmt(bottom[0] + radiusX)},${fmt(bottom[1])} L${fmt(top[0] + radiusX)},${fmt(top[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    if (dome)
      path += `<path d="M${fmt(top[0] - radiusX)},${fmt(top[1])} A${fmt(radiusX)},${fmt(Math.max(radiusY, radiusX * 0.42))} 0 0 1 ${fmt(top[0] + radiusX)},${fmt(top[1])} A${fmt(radiusX)},${fmt(radiusY)} 0 0 1 ${fmt(top[0] - radiusX)},${fmt(top[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    else
      path += `<ellipse cx="${fmt(top[0])}" cy="${fmt(top[1])}" rx="${fmt(radiusX)}" ry="${fmt(radiusY)}" fill="${RalColor.shade(color, 1.1)}" stroke="${edge}" stroke-width="1"/>`;
    return path;
  }
  /** Горизонтальный цилиндр вдоль x. */
  hcyl([x0, x1], [centerY, centerZ, radius], color) {
    const svg = this.svg;
    const ring = x => {
      const points = [];
      for (let i = 0; i < 40; i++) {
        const angle = (i / 40) * Math.PI * 2;
        points.push(this.project(x, centerY + radius * Math.cos(angle), centerZ + radius * Math.sin(angle)));
      }
      return points;
    };
    const startRing = ring(x0);
    const endRing = ring(x1);
    const hull = StView.hull([...startRing, ...endRing]);
    const id = `g${++this.gid}`;
    const upper = this.project(x0, centerY, centerZ + radius);
    const lower = this.project(x0, centerY, centerZ - radius);
    this.defs.push(
      `<linearGradient id="${id}" x1="${svg.fmt(upper[0])}" y1="${svg.fmt(upper[1])}" x2="${svg.fmt(lower[0])}" y2="${svg.fmt(lower[1])}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(color, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(color, 0.62)}"/></linearGradient>`,
    );
    return (
      svg.poly(hull, `url(#${id})`, RalColor.shade(color, 0.55), 1) +
      svg.poly(startRing, RalColor.shade(color, 0.85), RalColor.shade(color, 0.55), 1)
    );
  }
  /** Выпуклая оболочка точек. */
  static hull(points) {
    const sorted = points.slice().sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    const cross = (origin, first, second) =>
      (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
    const lower = [];
    const upper = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    for (const point of sorted.reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
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
        const center = this.project(x, y, 430);
        const wheelR = 430 * this.k;
        this.defs.push(
          `<radialGradient id="${id}"><stop offset="0.5" stop-color="#8c9298"/><stop offset="0.56" stop-color="#202326"/><stop offset="1" stop-color="#2b2e31"/></radialGradient>`,
        );
        out.push(
          `<ellipse cx="${this.svg.fmt(center[0])}" cy="${this.svg.fmt(center[1])}" rx="${this.svg.fmt(wheelR * 0.62)}" ry="${this.svg.fmt(wheelR)}" fill="url(#${id})" transform="rotate(${this.svg.fmt(-12)} ${this.svg.fmt(center[0])} ${this.svg.fmt(center[1])})"/>`,
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
  static depth(item) {
    return ((item.X0 + item.X1) / 2) * 0.5 + ((item.Y0 + item.Y1) / 2) * 0.866;
  }

  /** Из пары изделий — дальнее (рисуется раньше). */
  static farther(first, second) {
    const apartX = first.X1 <= second.X0 + 1 || second.X1 <= first.X0 + 1;
    const apartY = first.Y1 <= second.Y0 + 1 || second.Y1 <= first.Y0 + 1;
    if (apartY && !apartX) return first.Y0 >= second.Y1 - 1 ? first : second;
    if (apartX && !apartY) return first.X0 >= second.X1 - 1 ? first : second;
    if (!apartX && !apartY) return StView.depth(first) >= StView.depth(second) ? first : second;
    return null;
  }

  /** Порядок отрисовки: из пары разнесённых только по одной оси сначала дальняя (больше y или x). */
  order(items) {
    const count = items.length;
    const nxt = items.map(() => []);
    const indeg = new Array(count).fill(0);
    const dep = i => StView.depth(items[i]);
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const cmp = StView.farther(items[i], items[j]);
        if (!cmp) continue;
        const [far, near] = cmp === items[i] ? [i, j] : [j, i];
        nxt[far].push(near);
        indeg[near]++;
      }
    const out = [];
    const ready = [...Array(count).keys()].filter(i => !indeg[i]);
    while (ready.length) {
      ready.sort((first, second) => dep(second) - dep(first));
      const i = ready.shift();
      out.push(items[i]);
      for (const j of nxt[i]) if (!--indeg[j]) ready.push(j);
    }
    if (out.length < count) for (const item of items) if (!out.includes(item)) out.push(item);
    return out;
  }
}
