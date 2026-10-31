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
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.uvs = [];
  }

  /** Число вершин. */
  get count() {
    return this.positions.length / 3;
  }

  /** Вершина с нормалью; номер. */
  vert(point, normal) {
    this.positions.push(point[0], point[1], point[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    return this.positions.length / 3 - 1;
  }

  /** Плоский четырёхугольник a-b-c-d (по кругу) с нормалью n (не задана — по обходу). */
  quad(first, second, third, fourth, normal) {
    normal = normal || StV.norm(StV.cross(StV.sub(second, first), StV.sub(fourth, first)));
    const k = this.vert(first, normal);
    this.vert(second, normal);
    this.vert(third, normal);
    this.vert(fourth, normal);
    this.indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }

  /** Треугольник. */
  tri(first, second, third, normal) {
    normal = normal || StV.norm(StV.cross(StV.sub(second, first), StV.sub(third, first)));
    const k = this.vert(first, normal);
    this.vert(second, normal);
    this.vert(third, normal);
    this.indices.push(k, k + 1, k + 2);
  }

  /** Наклейка: четырёхугольник a-b-c-d (a — левый нижний, по кругу) с текстурой (строка 0 картинки — вверху). */
  decal(first, second, third, fourth, normal) {
    const k = this.vert(first, normal);
    this.vert(second, normal);
    this.vert(third, normal);
    this.vert(fourth, normal);
    this.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    this.indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }

  /** Наклейка на цилиндре (ось z в точке cx, cy, радиус r): по дуге a0…a1, по высоте z0…z1. */
  decalArc([midX, midY, radius], [fromA, tillA], [z0, z1], seg = 12) {
    const base = this.count;
    for (let j = 0; j <= seg; j++) {
      const angle = fromA + ((tillA - fromA) * j) / seg;
      const normal = [Math.cos(angle), Math.sin(angle), 0];
      const u = j / seg;
      this.vert([midX + radius * normal[0], midY + radius * normal[1], z0], normal);
      this.uvs.push(u, 1);
      this.vert([midX + radius * normal[0], midY + radius * normal[1], z1], normal);
      this.uvs.push(u, 0);
    }
    for (let j = 0; j < seg; j++) {
      const row = base + j * 2;
      this.indices.push(row, row + 2, row + 3, row, row + 3, row + 1);
    }
  }

  /** Короб между углами a и b; r — фаска по рёбрам (блик на гранях, как у гнутого листа). */
  box(corner, opposite, round = 0) {
    const low = corner.map((v, k) => Math.min(v, opposite[k]));
    const high = corner.map((v, k) => Math.max(v, opposite[k]));
    if (high.some((v, k) => v - low[k] < 1e-5)) return;
    const frame = { lo: low, hi: high, r: Math.max(0, Math.min(round, ...high.map((v, k) => (v - low[k]) / 2.2))) };
    this.faces(frame);
    if (!frame.r) return;
    this.edges(frame);
    this.corners(frame);
  }

  /** Точка по парам (ось, значение). */
  static axisPoint(...axisValues) {
    const point = [0, 0, 0];
    for (let k = 0; k < axisValues.length; k += 2) point[axisValues[k]] = axisValues[k + 1];
    return point;
  }

  /** Наружная граница рамы по оси k. */
  static ext({ lo: low, hi: high }, k, sign) {
    return sign > 0 ? high[k] : low[k];
  }

  /** Внутренняя граница рамы (с учётом скругления). */
  static ins({ lo: low, hi: high, r: round }, k, sign) {
    return sign > 0 ? high[k] - round : low[k] + round;
  }

  /** Шесть граней (без фасок). */
  faces(frame) {
    const { lo: low, hi: high, r: round } = frame;
    const axisPoint = StMesh.axisPoint;
    for (let axis = 0; axis < 3; axis++) {
      const [axisB, axisC] = [(axis + 1) % 3, (axis + 2) % 3];
      for (const sign of [-1, 1]) {
        const normal = [0, 0, 0];
        normal[axis] = sign;
        const x = StMesh.ext(frame, axis, sign);
        this.quad(
          axisPoint(axis, x, axisB, low[axisB] + round, axisC, low[axisC] + round),
          axisPoint(axis, x, axisB, high[axisB] - round, axisC, low[axisC] + round),
          axisPoint(axis, x, axisB, high[axisB] - round, axisC, high[axisC] - round),
          axisPoint(axis, x, axisB, low[axisB] + round, axisC, high[axisC] - round),
          normal,
        );
      }
    }
  }

  /** Фаски по двенадцати рёбрам. */
  edges(frame) {
    const { lo: low, hi: high, r: round } = frame;
    const axisPoint = StMesh.axisPoint;
    const { ext, ins } = StMesh;
    for (const [axis, axisB] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const axisC = 3 - axis - axisB;
      for (const [signA, signB] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const normal = [0, 0, 0];
        normal[axis] = signA * Math.SQRT1_2;
        normal[axisB] = signB * Math.SQRT1_2;
        this.quad(
          axisPoint(axis, ext(frame, axis, signA), axisB, ins(frame, axisB, signB), axisC, low[axisC] + round),
          axisPoint(axis, ins(frame, axis, signA), axisB, ext(frame, axisB, signB), axisC, low[axisC] + round),
          axisPoint(axis, ins(frame, axis, signA), axisB, ext(frame, axisB, signB), axisC, high[axisC] - round),
          axisPoint(axis, ext(frame, axis, signA), axisB, ins(frame, axisB, signB), axisC, high[axisC] - round),
          normal,
        );
      }
    }
  }

  /** Срезы восьми углов. */
  corners(frame) {
    const { ext, ins } = StMesh;
    for (const signX of [-1, 1]) {
      for (const signY of [-1, 1]) {
        for (const signZ of [-1, 1]) {
          this.tri(
            [ext(frame, 0, signX), ins(frame, 1, signY), ins(frame, 2, signZ)],
            [ins(frame, 0, signX), ext(frame, 1, signY), ins(frame, 2, signZ)],
            [ins(frame, 0, signX), ins(frame, 1, signY), ext(frame, 2, signZ)],
            StV.norm([signX, signY, signZ]),
          );
        }
      }
    }
  }

  /** Повёрнутый короб: угол o и рёбра u, v, w (векторы) — створки дверей и наклонные детали. */
  obox(origin, u, v, wVec) {
    const atFrac = (fracU, fracV, fracW) =>
      StV.add(origin, StV.add(StV.mul(u, fracU), StV.add(StV.mul(v, fracV), StV.mul(wVec, fracW))));
    const normU = StV.norm(u);
    const normV = StV.norm(v);
    const normW = StV.norm(wVec);
    this.quad(atFrac(0, 0, 0), atFrac(0, 1, 0), atFrac(0, 1, 1), atFrac(0, 0, 1), StV.mul(normU, -1));
    this.quad(atFrac(1, 0, 0), atFrac(1, 1, 0), atFrac(1, 1, 1), atFrac(1, 0, 1), normU);
    this.quad(atFrac(0, 0, 0), atFrac(1, 0, 0), atFrac(1, 0, 1), atFrac(0, 0, 1), StV.mul(normV, -1));
    this.quad(atFrac(0, 1, 0), atFrac(1, 1, 0), atFrac(1, 1, 1), atFrac(0, 1, 1), normV);
    this.quad(atFrac(0, 0, 0), atFrac(1, 0, 0), atFrac(1, 1, 0), atFrac(0, 1, 0), StV.mul(normW, -1));
    this.quad(atFrac(0, 0, 1), atFrac(1, 0, 1), atFrac(1, 1, 1), atFrac(0, 1, 1), normW);
  }

  /** Цилиндр (конус, если r2) от точки a до точки b; caps — донышки [в a, в b]. */
  tube(start, end, radius, seg = 20, { caps = [true, true], r2: endRadius } = {}) {
    const span = StV.sub(end, start);
    const length = StV.len(span);
    if (length < 1e-5) return;
    const axis = StV.mul(span, 1 / length);
    const [u, v] = StV.basis(axis);
    const radius2 = endRadius == null ? radius : endRadius;
    const base = this.count;
    for (let k = 0; k <= seg; k++) {
      const angle = (k / seg) * Math.PI * 2;
      const normal = StV.add(StV.mul(u, Math.cos(angle)), StV.mul(v, Math.sin(angle)));
      this.vert(StV.add(start, StV.mul(normal, radius)), normal);
      this.vert(StV.add(end, StV.mul(normal, radius2)), normal);
    }
    for (let k = 0; k < seg; k++) {
      const row = base + k * 2;
      this.indices.push(row, row + 1, row + 3, row, row + 3, row + 2);
    }
    if (caps[0] && radius > 0) this.cap(start, radius, StV.mul(axis, -1), [u, v], seg);
    if (caps[1] && radius2 > 0) this.cap(end, radius2, axis, [u, v], seg);
  }

  /** Донышко цилиндра: круг радиуса rr в точке c с нормалью n. */
  cap(center, radius, normal, [u, v], seg) {
    const hub = this.vert(center, normal);
    for (let k = 0; k <= seg; k++) {
      const angle = (k / seg) * Math.PI * 2;
      this.vert(
        StV.add(center, StV.add(StV.mul(u, Math.cos(angle) * radius), StV.mul(v, Math.sin(angle) * radius))),
        normal,
      );
    }
    for (let k = 0; k < seg; k++) this.indices.push(hub, hub + 1 + k, hub + 2 + k);
  }

  /** Шар. */
  sphere(center, radius, seg = 16) {
    const base = this.count;
    const rows = Math.max(4, seg >> 1);
    for (let i = 0; i <= rows; i++) {
      const theta = (i / rows) * Math.PI;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      for (let j = 0; j <= seg; j++) {
        const phi = (j / seg) * Math.PI * 2;
        const normal = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT];
        this.vert(StV.add(center, StV.mul(normal, radius)), normal);
      }
    }
    this.grid(base, rows, seg);
  }

  /** Треугольники сетки rows × seg вершин (строки по seg + 1). */
  grid(base, rows, seg) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < seg; j++) {
        const here = base + i * (seg + 1) + j;
        const below = here + seg + 1;
        this.indices.push(here, below, here + 1, here + 1, below, below + 1);
      }
    }
  }

  /** Эллиптическое днище (2:1). */
  dish([midX, midY, z], radius, dir, seg = 24) {
    const base = this.count;
    const rows = 8;
    const depth = radius * 0.5;
    for (let i = 0; i <= rows; i++) {
      const angle = ((i / rows) * Math.PI) / 2;
      const ringR = radius * Math.cos(angle);
      const ringZ = z + dir * depth * Math.sin(angle);
      for (let j = 0; j <= seg; j++) {
        const phi = (j / seg) * Math.PI * 2;
        const normal = StV.norm([
          (Math.cos(angle) * Math.cos(phi)) / radius,
          (Math.cos(angle) * Math.sin(phi)) / radius,
          (dir * Math.sin(angle)) / depth,
        ]);
        this.vert([midX + ringR * Math.cos(phi), midY + ringR * Math.sin(phi), ringZ], normal);
      }
    }
    this.grid(base, rows, seg);
  }

  /** Гофр (трапеция) вдоль оси along (0 — x, 1 — y) от u0 до u1, по высоте z0…z1; плоскость стены — на координате w поперёк, наружу — out (±1); шаг и глубина гофра. /. */
  corr(along, [u0, u1], [plane, out], [z0, z1], [pitch, depth] = [0.278, 0.036]) {
    const toWorld = (u, off, z) => (along === 0 ? [u, plane + out * off, z] : [plane + out * off, u, z]);
    const prof = CORR.map(([step, depthFrac]) => [step, depthFrac * depth]);
    for (let u = u0; u < u1 - 1e-6; u += pitch) {
      const span = Math.min(pitch, u1 - u);
      for (let k = 0; k < prof.length - 1; k++) {
        const [from, till] = [prof[k], prof[k + 1]];
        const fromU = u + from[0] * pitch;
        const tillU = Math.min(u + till[0] * pitch, u + span);
        if (tillU > fromU)
          this.quad(
            toWorld(fromU, from[1], z0),
            toWorld(tillU, till[1], z0),
            toWorld(tillU, till[1], z1),
            toWorld(fromU, from[1], z1),
            StMesh.outward(along, out, [tillU - fromU, till[1] - from[1]]),
          );
      }
    }
  }

  /** Нормаль грани гофра — наружу. */
  static outward(along, out, [du, dOut]) {
    const tangent = StV.norm(along === 0 ? [du, out * dOut, 0] : [out * dOut, du, 0]);
    const normal = [tangent[1], -tangent[0], 0];
    return StV.norm(StV.dot(normal, along === 0 ? [0, out, 0] : [out, 0, 0]) < 0 ? StV.mul(normal, -1) : normal);
  }

  /** Построитель, рисующий через преобразование точек f (поворот и зеркало по осям). */
  static mapped(mesh, map) {
    const origin = map([0, 0, 0]);
    const mapVec = vec => {
      const mapped = map(vec);
      return [mapped[0] - origin[0], mapped[1] - origin[1], mapped[2] - origin[2]];
    };
    return {
      box: (low, high, radius) => mesh.box(map(low), map(high), radius),
      tube: (start, end, radius, seg, opts) => mesh.tube(map(start), map(end), radius, seg, opts),
      sphere: (center, radius, seg) => mesh.sphere(map(center), radius, seg),
      obox: (corner, u, v, wVec) => mesh.obox(map(corner), mapVec(u), mapVec(v), mapVec(wVec)),
      quad: (first, second, third, fourth, normal) =>
        mesh.quad(map(first), map(second), map(third), map(fourth), normal && mapVec(normal)),
      tri: (first, second, third, normal) => mesh.tri(map(first), map(second), map(third), normal && mapVec(normal)),
    };
  }
}
