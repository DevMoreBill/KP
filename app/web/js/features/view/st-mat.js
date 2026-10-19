import { RalColor } from '../layout/ral-color.js';

// 3 — наклейка (tex — описание картинки в сцене: логотип, знак, табло)
export class StMat {
  static paint(c, r = 0.45) {
    return { c, r, m: 0 };
  }
  static metal(c, r = 0.35) {
    return { c, r, m: 1 };
  }
  static glow(c, e = 4) {
    return { c, r: 0.3, m: 0, e };
  }
  static decal(tex, e = 0) {
    return { c: '#ffffff', r: 0.5, m: 0, e, k: 3, tex };
  }
  static key(m) {
    return [m.c, m.r, m.m, m.e || 0, m.k || 0, m.tex || ''].join('|');
  }
  static lin(hex) {
    return RalColor.rgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
  }
}
