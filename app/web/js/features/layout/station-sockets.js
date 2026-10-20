import { StationMatrix } from './station-matrix.js';

/** Сервисные розетки: 230 В — по одной на каждые sockStep мм длины помещения (не меньше sockMin), 380 В, ЯТП-0,25 (ПУЭ, п. 6.1.16). */
export class StationSockets {
  static calc(plan) {
    if ((plan.sys || {}).power === false) return null;
    const [Li] = plan.int;
    const power = StationMatrix.grp('power');
    return {
      n230: Math.max(power.sockMin, Math.ceil((Li - (plan.geo.x0 || 0)) / power.sockStep)),
      n380: power.sock380,
      ytp: 1,
      z: power.sockZ,
    };
  }

  static text(sockets) {
    if (!sockets) return '';
    const z = (sockets.z / 1000).toFixed(1).replace('.', ',');
    return `сервисные розетки: 230 В 16 А IP54 с заземляющим контактом — ${sockets.n230} шт. (у входа и у оборудования, через УЗО 30 мА), 380 В 16 А IP54 (3P+N+PE) — ${sockets.n380} шт. у основного оборудования, ящик ЯТП-0,25 (220/36 В) для переносных светильников — ${sockets.ytp} шт. у входа; высота — ${z} м от пола`;
  }
}
