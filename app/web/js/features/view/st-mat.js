import { RalColor } from '../layout/ral-color.js';

// 3 — наклейка (tex — описание картинки в сцене: логотип, знак, табло)
export class StMat {
  static INS = '#d9c48a'; // разрез стены: минеральная вата

  static DARK = '#2b3036'; // рамы, решётки, основания

  static GALV = '#b9c0c6'; // оцинковка

  static INOX = '#c9cfd5';

  /** Краска. */
  static paint(color, rough = 0.45) {
    return { c: color, r: rough, m: 0 };
  }
  /** Металл. */
  static metal(color, rough = 0.35) {
    return { c: color, r: rough, m: 1 };
  }
  /** Светящийся. */
  static glow(color, glow = 4) {
    return { c: color, r: 0.3, m: 0, e: glow };
  }
  /** Наклейка с текстурой tex. */
  static decal(tex, glow = 0) {
    return { c: '#ffffff', r: 0.5, m: 0, e: glow, k: 3, tex };
  }
  /** Ключ материала для группировки. */
  static key(mat) {
    return [mat.c, mat.r, mat.m, mat.e || 0, mat.k || 0, mat.tex || ''].join('|');
  }
  /** Цвет #rrggbb в линейном пространстве. */
  static lin(hex) {
    return RalColor.rgb(hex).map(v => {
      const unit = v / 255;
      return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    });
  }
}
