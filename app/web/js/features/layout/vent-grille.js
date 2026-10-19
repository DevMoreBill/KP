import { StationMatrix } from './station-matrix.js';

/** Жалюзи и маркизы: размеры и пределы — раздел grille матрицы («Настройки → … → Жалюзи притока и выброса, маркизы»). */
export class VentGrille {
  static get G() {
    return StationMatrix.grp('grille');
  }
  static get STEP() {
    return VentGrille.G.step;
  }
  static get GAP() {
    return VentGrille.G.gap;
  }
  static get IN() {
    return StationMatrix.derive('ventIn', () => {
      const g = VentGrille.G;
      return { z0: g.inZ, h: [g.inHmin, g.inHmax], w: [g.inWmin, g.inWmax] };
    });
  }
  static get OUT() {
    return StationMatrix.derive('ventOut', () => {
      const g = VentGrille.G;
      return { top: g.outTop, h: [g.outHmin, g.outHmax], w: [g.outWmin, g.outWmax] };
    });
  }
  static get WHOLE() {
    return VentGrille.G.whole;
  }
  static get MAXN() {
    return VentGrille.G.maxn;
  }
  static get HOOD_SIDE() {
    return VentGrille.G.hoodSide;
  }
  static get HOOD_LAP() {
    return VentGrille.G.hoodLap;
  }
  static get HOOD_ANG() {
    return [VentGrille.G.hoodAng0, VentGrille.G.hoodAng1];
  }
  static get HOOD_LOW() {
    return VentGrille.G.hoodLow;
  }
  static get HOOD_GAP() {
    return VentGrille.G.hoodGap;
  }
  static get HOOD_V() {
    return StationRules.raw('vent.hood_v');
  }
  static get LIFT() {
    return VentGrille.G.lift;
  }
  static get HOOD() {
    return VentGrille.G.roofHood;
  }
  static get PIECE() {
    return VentGrille.G.piece;
  }
  static get FAN_MIN() {
    return VentGrille.G.fanMin;
  }
  static get FREE() {
    return StationRules.raw('vent.free');
  }
  static get RAD_V() {
    return VentGrille.G.radV;
  }

  /** Одинаковые жалюзи на площадь по рамке area, м²: {n, w, h} — площадь не меньше нужной, форма ближе к 3 : 2, меньше штук. */
  static size(area, o) {
    const S = VentGrille.STEP;
    let best = null;
    for (let n = 1; n <= 12 && !best; n++) {
      const a = (area / n) * 1e6;
      for (let h = o.h[0]; h <= o.h[1]; h += S) {
        const w = Math.max(o.w[0], Math.ceil(a / h / S) * S);
        const score =
          w > o.w[1]
            ? Infinity
            : ((n * w * h) / 1e6 - area) / area + 0.3 * Math.abs(Math.log(w / h / 1.5)) + 0.25 * (n - 1);
        if (score < Infinity && (!best || score < best.score)) best = { n, w, h, score };
      }
    }
    return best ? { n: best.n, w: best.w, h: best.h } : null;
  }

  static sizeN(area, o, n) {
    return VentGrille.sizesN(area, o, n)[0] || null;
  }

  /** Все формы n одинаковых жалюзи (высота — не больше двух ширин), лучшие — первыми. */
  static sizesN(area, o, n) {
    const S = VentGrille.STEP;
    const out = [];
    for (let h = o.h[0]; h <= o.h[1]; h += S) {
      const w = Math.max(o.w[0], Math.ceil(((area / n) * 1e6) / h / S) * S);
      if (w <= o.w[1] && h <= 2 * w)
        out.push({ n, w, h, score: ((n * w * h) / 1e6 - area) / area + 0.3 * Math.abs(Math.log(w / h / 1.5)) });
    }
    return out.sort((a, b) => a.score - b.score).map(q => ({ n: q.n, w: q.w, h: q.h }));
  }

  /**
   * Маркиза над жалюзи w × h (верх — z1): козырёк шириной B, длиной l; угол открытия — наименьший (шаг 5°), при котором
   * скорость во входе снизу не больше vmax; не хватает и при наибольшем — козырёк длиннее (не ниже HOOD_LOW).
   */
  static hood(q, w, h, z1, vmax) {
    const B = w + 2 * VentGrille.HOOD_SIDE;
    const need = (q / 3600 / vmax / (B / 1000)) * 1000;
    const rad = Math.PI / 180;
    const [a0, a1] = VentGrille.HOOD_ANG;
    const l0 = h + 2 * VentGrille.HOOD_LAP;
    const longer = Math.max(
      l0,
      Math.min(
        z1 + VentGrille.HOOD_LAP - VentGrille.HOOD_LOW,
        Math.ceil(need / Math.sin(a1 * rad) / VentGrille.STEP) * VentGrille.STEP,
      ),
    );
    const l = need > l0 * Math.sin(a1 * rad) ? longer : l0;
    const a = Math.min(a1, Math.max(a0, Math.ceil(Math.asin(Math.min(1, need / l)) / rad / 5) * 5));
    return VentGrille.hoodAt({ w: B, l }, a, q);
  }

  /** Маркиза H, открытая на угол a: вылет, опускание кромки, скорость во входе при расходе q, м³/ч. */
  static hoodAt(H, a, q) {
    const r = (a * Math.PI) / 180;
    const d = Math.round(H.l * Math.sin(r));
    return {
      w: H.w,
      l: H.l,
      a,
      d,
      drop: Math.round(H.l * Math.cos(r)),
      v: Math.round((q / 3600 / (((H.w / 1000) * d) / 1000)) * 100) / 100,
    };
  }
}
