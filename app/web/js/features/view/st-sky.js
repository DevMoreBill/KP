import { StV } from './st-v.js';

export class StSky {
  static SUN = StV.norm([-0.5, -0.55, 1.05]); // спереди слева, высоко
  static SUN_E = [2.6, 2.5, 2.32]; // освещённость от солнца (линейная)
  static ZEN = [0.36, 0.45, 0.6]; // яркость неба в зените
  static HOR = [0.74, 0.77, 0.82]; // у горизонта
  static GROUND = 0.33; // отражение земли (свет снизу)
  /** Число последовательности Холтона. */
  static halton(i, base) {
    let frac = 1;
    let res = 0;
    while (i > 0) {
      frac /= base;
      res += frac * (i % base);
      i = Math.floor(i / base);
    }
    return res;
  }
  /** Цвет неба по высоте z. */
  static sky(z) {
    const blend = Math.pow(Math.max(0, z), 0.55);
    return this.HOR.map((hor, k) => hor + (this.ZEN[k] - hor) * blend);
  }
  /** Проходы. */
  static passes(count, sunDir = this.SUN) {
    const nSun = Math.max(1, Math.round(count * 0.375));
    const nSky = Math.max(1, count - nSun);
    const sun = [];
    const sky = [];
    const [u, v] = StV.basis(sunDir);
    for (let i = 0; i < nSun; i++) {
      const radius = Math.sqrt(this.halton(i + 1, 2)) * 0.08;
      const angle = this.halton(i + 1, 3) * Math.PI * 2;
      sun.push({
        dir: StV.norm(
          StV.add(sunDir, StV.add(StV.mul(u, radius * Math.cos(angle)), StV.mul(v, radius * Math.sin(angle)))),
        ),
        E: this.SUN_E.map(x => x / nSun),
        sun: true,
      });
    }
    const sinE = Math.max(0.1, sunDir[2]);
    const groundE = this.SUN_E.map(
      (x, k) => (this.GROUND * (x * sinE + Math.PI * 0.5 * (this.ZEN[k] + this.HOR[k]))) / Math.PI,
    );
    for (let i = 0; i < nSky; i++) {
      const z = 1 - (2 * (i + 0.5)) / nSky;
      const radius = Math.sqrt(1 - z * z);
      const phase = i * 2.399963 + 0.7;
      const dir = [radius * Math.cos(phase), radius * Math.sin(phase), z];
      const radiance = z >= 0 ? this.sky(z) : groundE;
      sky.push({ dir, E: radiance.map(x => (x * 4 * Math.PI) / nSky), sun: false });
    }
    const out = [];
    for (let i = 0, j = 0; out.length < nSun + nSky; ) {
      if (i < nSun && (i * nSky <= j * nSun || j >= nSky)) out.push(sun[i++]);
      else out.push(sky[j++]);
    }
    return out;
  }
}
