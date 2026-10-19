export class StV {
  static add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }
  static sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  static mul(a, k) {
    return [a[0] * k, a[1] * k, a[2] * k];
  }
  static dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  static cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  static len(a) {
    return Math.hypot(a[0], a[1], a[2]);
  }
  static norm(a) {
    const l = this.len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  /** Два перпендикуляра к направлению d. */
  static basis(d) {
    const t = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = this.norm(this.cross(d, t));
    return [u, this.cross(d, u)];
  }
}
