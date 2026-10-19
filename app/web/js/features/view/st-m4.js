import { StV } from './st-v.js';

export class StM4 {
  static mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = v;
      }
    return o;
  }
  static persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    return new Float32Array([
      t / asp,
      0,
      0,
      0,
      0,
      t,
      0,
      0,
      0,
      0,
      (f + n) / (n - f),
      -1,
      0,
      0,
      (2 * f * n) / (n - f),
      0,
    ]);
  }
  static ortho([l, r], [b, t], [n, f]) {
    return new Float32Array([
      2 / (r - l),
      0,
      0,
      0,
      0,
      2 / (t - b),
      0,
      0,
      0,
      0,
      -2 / (f - n),
      0,
      -(r + l) / (r - l),
      -(t + b) / (t - b),
      -(f + n) / (f - n),
      1,
    ]);
  }
  static look(eye, at, up) {
    const z = StV.norm(StV.sub(eye, at));
    const x = StV.norm(StV.cross(up, z));
    const y = StV.cross(z, x);
    return new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -StV.dot(x, eye),
      -StV.dot(y, eye),
      -StV.dot(z, eye),
      1,
    ]);
  }
  static apply(m, p) {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  }
  /** Свет: ортографическая проекция по шару сцены (центр c, радиус R) со стороны dir. */
  static light(dir, c, R) {
    const up = Math.abs(dir[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    return this.mul(this.ortho([-R, R], [-R, R], [0.05, 4 * R]), this.look(StV.add(c, StV.mul(dir, 2 * R)), c, up));
  }
}
