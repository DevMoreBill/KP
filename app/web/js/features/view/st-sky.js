import { StV } from './st-v.js';

export class StSky {
  static SUN = StV.norm([-0.5, -0.55, 1.05]); // спереди слева, высоко
  static SUN_E = [2.6, 2.5, 2.32]; // освещённость от солнца (линейная)
  static ZEN = [0.36, 0.45, 0.6]; // яркость неба в зените
  static HOR = [0.74, 0.77, 0.82]; // у горизонта
  static GROUND = 0.33; // отражение земли (свет снизу)
  static halton(i, b) {
    let f = 1;
    let r = 0;
    while (i > 0) {
      f /= b;
      r += f * (i % b);
      i = Math.floor(i / b);
    }
    return r;
  }
  static sky(z) {
    const t = Math.pow(Math.max(0, z), 0.55);
    return this.HOR.map((h, k) => h + (this.ZEN[k] - h) * t);
  }
  /** Проходы. */
  static passes(n, S = this.SUN) {
    const nSun = Math.max(1, Math.round(n * 0.375));
    const nSky = Math.max(1, n - nSun);
    const sun = [];
    const sky = [];
    const [u, v] = StV.basis(S);
    for (let i = 0; i < nSun; i++) {
      const r = Math.sqrt(this.halton(i + 1, 2)) * 0.08;
      const t = this.halton(i + 1, 3) * Math.PI * 2;
      sun.push({
        dir: StV.norm(StV.add(S, StV.add(StV.mul(u, r * Math.cos(t)), StV.mul(v, r * Math.sin(t))))),
        E: this.SUN_E.map(x => x / nSun),
        sun: true,
      });
    }
    const sinE = Math.max(0.1, S[2]);
    const gE = this.SUN_E.map(
      (x, k) => (this.GROUND * (x * sinE + Math.PI * 0.5 * (this.ZEN[k] + this.HOR[k]))) / Math.PI,
    );
    for (let i = 0; i < nSky; i++) {
      const z = 1 - (2 * (i + 0.5)) / nSky;
      const r = Math.sqrt(1 - z * z);
      const ph = i * 2.399963 + 0.7;
      const d = [r * Math.cos(ph), r * Math.sin(ph), z];
      const L = z >= 0 ? this.sky(z) : gE;
      sky.push({ dir: d, E: L.map(x => (x * 4 * Math.PI) / nSky), sun: false });
    }
    const out = [];
    for (let i = 0, j = 0; out.length < nSun + nSky; ) {
      if (i < nSun && (i * nSky <= j * nSun || j >= nSky)) out.push(sun[i++]);
      else out.push(sky[j++]);
    }
    return out;
  }
}
