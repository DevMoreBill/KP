import { StationMatrix } from './station-matrix.js';

/** Сервисные розетки: 230 В — по одной на каждые sockStep мм длины помещения (не меньше sockMin), 380 В, ЯТП-0,25 (ПУЭ, п. 6.1.16). */
export class StationSockets {
  static calc(plan) {
    if ((plan.sys || {}).power === false) return null;
    const [L] = plan.int;
    const P = StationMatrix.grp('power');
    return {
      n230: Math.max(P.sockMin, Math.ceil((L - (plan.geo.x0 || 0)) / P.sockStep)),
      n380: P.sock380,
      ytp: 1,
      z: P.sockZ,
    };
  }

  static text(K) {
    if (!K) return '';
    const z = (K.z / 1000).toFixed(1).replace('.', ',');
    return `сервисные розетки: 230 В 16 А IP54 с заземляющим контактом — ${K.n230} шт. (у входа и у оборудования, через УЗО 30 мА), 380 В 16 А IP54 (3P+N+PE) — ${K.n380} шт. у основного оборудования, ящик ЯТП-0,25 (220/36 В) для переносных светильников — ${K.ytp} шт. у входа; высота — ${z} м от пола`;
  }
}
