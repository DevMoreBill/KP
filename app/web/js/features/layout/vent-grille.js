import { StationMatrix } from './station-matrix.js';
import { StationRules } from '../rules/station-rules.js';

/** Жалюзи и маркизы: размеры и пределы — раздел grille матрицы («Настройки → … → Жалюзи притока и выброса, маркизы»). */
export class VentGrille {
  static get _GRILLE() {
    return StationMatrix.grp('grille');
  }
  /** Шаг размеров жалюзи, мм. */
  static get STEP() {
    return VentGrille._GRILLE.step;
  }
  /** Зазор между жалюзи, мм. */
  static get GAP() {
    return VentGrille._GRILLE.gap;
  }
  /** Пределы жалюзи притока. */
  static get INLET() {
    return StationMatrix.derive('ventIn', () => {
      const grid = VentGrille._GRILLE;
      return { z0: grid.inZ, h: [grid.inHmin, grid.inHmax], w: [grid.inWmin, grid.inWmax] };
    });
  }
  /** Пределы жалюзи выброса. */
  static get OUTLET() {
    return StationMatrix.derive('ventOut', () => {
      const grid = VentGrille._GRILLE;
      return { top: grid.outTop, h: [grid.outHmin, grid.outHmax], w: [grid.outWmin, grid.outWmax] };
    });
  }
  /** Наибольшая ширина цельной жалюзи, мм. */
  static get WHOLE() {
    return VentGrille._GRILLE.whole;
  }
  /** Наибольшее число жалюзи. */
  static get MAXN() {
    return VentGrille._GRILLE.maxn;
  }
  /** Выступ маркизы за жалюзи сбоку, мм. */
  static get HOOD_SIDE() {
    return VentGrille._GRILLE.hoodSide;
  }
  /** Перекрытие маркизы сверху и снизу, мм. */
  static get HOOD_LAP() {
    return VentGrille._GRILLE.hoodLap;
  }
  /** Пределы угла маркизы, °. */
  static get HOOD_ANG() {
    return [VentGrille._GRILLE.hoodAng0, VentGrille._GRILLE.hoodAng1];
  }
  /** Наименьшая высота маркизы, мм. */
  static get HOOD_LOW() {
    return VentGrille._GRILLE.hoodLow;
  }
  /** Зазор маркизы от стены, мм. */
  static get HOOD_GAP() {
    return VentGrille._GRILLE.hoodGap;
  }
  /** Скорость воздуха под маркизой, м/с. */
  static get HOOD_V() {
    return StationRules.raw('vent.hood_v');
  }
  /** Подъём жалюзи притока над снегом. */
  static get LIFT() {
    return VentGrille._GRILLE.lift;
  }
  /** Колпак на крыше. */
  static get HOOD() {
    return VentGrille._GRILLE.roofHood;
  }
  /** Наибольшая часть жалюзи. */
  static get PIECE() {
    return VentGrille._GRILLE.piece;
  }
  /** Наименьший вентилятор притока. */
  static get FAN_MIN() {
    return VentGrille._GRILLE.fanMin;
  }
  /** Живое сечение жалюзи. */
  static get FREE() {
    return StationRules.raw('vent.free');
  }
  /** Скорость воздуха через радиатор ДГУ, м/с. */
  static get RAD_V() {
    return VentGrille._GRILLE.radV;
  }

  /** Одинаковые жалюзи на площадь по рамке area, м²: {n, w, h} — площадь не меньше нужной, форма ближе к 3 : 2, меньше штук. */
  static size(area, range) {
    const step = VentGrille.STEP;
    let best = null;
    for (let count = 1; count <= 12 && !best; count++) {
      const areaMm2 = (area / count) * 1e6;
      for (let height = range.h[0]; height <= range.h[1]; height += step) {
        const width = Math.max(range.w[0], Math.ceil(areaMm2 / height / step) * step);
        const score =
          width > range.w[1]
            ? Infinity
            : ((count * width * height) / 1e6 - area) / area +
              0.3 * Math.abs(Math.log(width / height / 1.5)) +
              0.25 * (count - 1);
        if (score < Infinity && (!best || score < best.score)) best = { n: count, w: width, h: height, score };
      }
    }
    return best ? { n: best.n, w: best.w, h: best.h } : null;
  }

  /** Лучший размер count жалюзи на площадь. */
  static sizeN(area, range, count) {
    return VentGrille.sizesN(area, range, count)[0] || null;
  }

  /** Все формы n одинаковых жалюзи (высота — не больше двух ширин), лучшие — первыми. */
  static sizesN(area, range, count) {
    const step = VentGrille.STEP;
    const out = [];
    for (let height = range.h[0]; height <= range.h[1]; height += step) {
      const width = Math.max(range.w[0], Math.ceil(((area / count) * 1e6) / height / step) * step);
      if (width <= range.w[1] && height <= 2 * width)
        out.push({
          n: count,
          w: width,
          h: height,
          score: ((count * width * height) / 1e6 - area) / area + 0.3 * Math.abs(Math.log(width / height / 1.5)),
        });
    }
    return out.sort((left, right) => left.score - right.score).map(opt => ({ n: opt.n, w: opt.w, h: opt.h }));
  }

  /**
   * Маркиза над жалюзи w × h (верх — z1): козырёк шириной B, длиной l; угол открытия — наименьший (шаг 5°), при котором
   * скорость во входе снизу не больше vmax; не хватает и при наибольшем — козырёк длиннее (не ниже HOOD_LOW).
   */
  static hood(flow, width, height, z1, vmax) {
    const hoodW = width + 2 * VentGrille.HOOD_SIDE;
    const need = (flow / 3600 / vmax / (hoodW / 1000)) * 1000;
    const rad = Math.PI / 180;
    const [angMin, angMax] = VentGrille.HOOD_ANG;
    const len0 = height + 2 * VentGrille.HOOD_LAP;
    const longer = Math.max(
      len0,
      Math.min(
        z1 + VentGrille.HOOD_LAP - VentGrille.HOOD_LOW,
        Math.ceil(need / Math.sin(angMax * rad) / VentGrille.STEP) * VentGrille.STEP,
      ),
    );
    const len = need > len0 * Math.sin(angMax * rad) ? longer : len0;
    const angle = Math.min(angMax, Math.max(angMin, Math.ceil(Math.asin(Math.min(1, need / len)) / rad / 5) * 5));
    return VentGrille.hoodAt({ w: hoodW, l: len }, angle, flow);
  }

  /** Маркиза H, открытая на угол a: вылет, опускание кромки, скорость во входе при расходе q, м³/ч. */
  static hoodAt(hood, angle, flow) {
    const rad = (angle * Math.PI) / 180;
    const depth = Math.round(hood.l * Math.sin(rad));
    return {
      w: hood.w,
      l: hood.l,
      a: angle,
      d: depth,
      drop: Math.round(hood.l * Math.cos(rad)),
      v: Math.round((flow / 3600 / (((hood.w / 1000) * depth) / 1000)) * 100) / 100,
    };
  }
}
