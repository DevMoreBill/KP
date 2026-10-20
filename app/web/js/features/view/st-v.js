export class StV {
  /** Сумма. */
  static add(vecA, vecB) {
    return [vecA[0] + vecB[0], vecA[1] + vecB[1], vecA[2] + vecB[2]];
  }
  /** Разность. */
  static sub(vecA, vecB) {
    return [vecA[0] - vecB[0], vecA[1] - vecB[1], vecA[2] - vecB[2]];
  }
  /** Произведение на число. */
  static mul(vec, k) {
    return [vec[0] * k, vec[1] * k, vec[2] * k];
  }
  /** Скалярное произведение. */
  static dot(vecA, vecB) {
    return vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];
  }
  /** Векторное произведение. */
  static cross(vecA, vecB) {
    return [
      vecA[1] * vecB[2] - vecA[2] * vecB[1],
      vecA[2] * vecB[0] - vecA[0] * vecB[2],
      vecA[0] * vecB[1] - vecA[1] * vecB[0],
    ];
  }
  /** Длина. */
  static len(vec) {
    return Math.hypot(vec[0], vec[1], vec[2]);
  }
  /** Единичный вектор. */
  static norm(vec) {
    const length = this.len(vec) || 1;
    return [vec[0] / length, vec[1] / length, vec[2] / length];
  }
  /** Два перпендикуляра к направлению d. */
  static basis(dir) {
    const helper = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = this.norm(this.cross(dir, helper));
    return [u, this.cross(dir, u)];
  }
}
