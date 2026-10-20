import { StV } from './st-v.js';

export class StM4 {
  /** Произведение матриц 4 × 4. */
  static mul(matA, matB) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += matA[k * 4 + j] * matB[i * 4 + k];
        out[i * 4 + j] = v;
      }
    return out;
  }
  /** Перспектива. */
  static persp(fov, asp, near, far) {
    const focal = 1 / Math.tan(fov / 2);
    return new Float32Array([
      focal / asp,
      0,
      0,
      0,
      0,
      focal,
      0,
      0,
      0,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
  }
  /** Ортогональная проекция. */
  static ortho([left, right], [bottom, top], [near, far]) {
    return new Float32Array([
      2 / (right - left),
      0,
      0,
      0,
      0,
      2 / (top - bottom),
      0,
      0,
      0,
      0,
      -2 / (far - near),
      0,
      -(right + left) / (right - left),
      -(top + bottom) / (top - bottom),
      -(far + near) / (far - near),
      1,
    ]);
  }
  /** Взгляд из eye на target. */
  static look(eye, target, upward) {
    const z = StV.norm(StV.sub(eye, target));
    const x = StV.norm(StV.cross(upward, z));
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
  /** Точка через матрицу (с делением на w). */
  static apply(mat, point) {
    const x = point[0];
    const y = point[1];
    const z = point[2];
    const wScale = mat[3] * x + mat[7] * y + mat[11] * z + mat[15];
    return [
      (mat[0] * x + mat[4] * y + mat[8] * z + mat[12]) / wScale,
      (mat[1] * x + mat[5] * y + mat[9] * z + mat[13]) / wScale,
      (mat[2] * x + mat[6] * y + mat[10] * z + mat[14]) / wScale,
    ];
  }
  /** Свет: ортографическая проекция по шару сцены (центр c, радиус R) со стороны dir. */
  static light(dir, center, radius) {
    const upward = Math.abs(dir[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    return this.mul(
      this.ortho([-radius, radius], [-radius, radius], [0.05, 4 * radius]),
      this.look(StV.add(center, StV.mul(dir, 2 * radius)), center, upward),
    );
  }
}
