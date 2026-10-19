import { StationMatrix } from './station-matrix.js';

/** Проёмы в стенах: дверь оператора, сервисные ворота, дверь-жалюзи ДГУ; отступы проёмов от углов и друг от друга. */
export class LayoutOpening {
  /** Дверь оператора в стене прохода: от торца (за тамбуром) — дверь в свету и коробка 50 мм с каждой стороны. */
  static get ENTRY() {
    return [300, 300 + StationMatrix.door().w + 100];
  }

  /** Сервисные двери и ворота: ширина min…max, створка до leaf, высота не ниже двери оператора, от углов — pad. */
  static get DOOR() {
    const s = StationMatrix.service();
    const d = StationMatrix.door();
    return { min: s.min, max: s.max, leaf: s.leaf, h: d.h, pad: d.pad };
  }

  /** Начало проёма шириной w на стене длиной W: по месту v, не ближе pad к краям; стена уже — по середине. */
  static inWall(v, w, W, pad) {
    return Math.round(W - 2 * pad < w ? (W - w) / 2 : Math.max(pad, Math.min(W - pad - w, v)));
  }

  /** Проёмы на одной стене: между ними — door.gap, от края станции — door.edge: {gap, eL — от торца, eW — от боковой}. */
  static gaps(geo) {
    const d = StationMatrix.door();
    const e = geo && geo.ext;
    const i = geo && geo.int;
    const tL = e && i ? (e[0] - i[0]) / 2 : 0;
    const tW = e && i ? (e[1] - i[1]) / 2 : 0;
    const pad = this.DOOR.pad;
    return { gap: d.gap, eL: Math.max(pad, Math.ceil(d.edge - tL)), eW: Math.max(pad, Math.ceil(d.edge - tW)) };
  }

  /** Ширина сервисных ворот: сторона агрегата + service.addW (+ 2·T стенки), с шагом service.step, min…max. */
  static svcW(len, T = 0) {
    const s = StationMatrix.service();
    const step = s.step || 100;
    const wall = s.wall === 0 ? 0 : 2 * T;
    return Math.max(s.min, Math.min(s.max, Math.ceil((len + s.addW + wall) / step) * step));
  }

  /** Высота сервисных ворот: высота агрегата + service.addH (+ T), не ниже minH (за агрегатом) или двери, под потолком 100 мм. */
  static svcH(h, T, rear, H) {
    const s = StationMatrix.service();
    const step = Math.min(50, s.step || 50);
    const wall = s.wall === 0 ? 0 : T;
    const low = rear ? s.minH : StationMatrix.door().h;
    return Math.min(H - 100, Math.max(low, Math.ceil((h + s.addH + wall) / step) * step));
  }

  /** Ширина двери-жалюзи ДГУ по её стороне напротив радиатора: +200 мм, шаг 100, не уже сервисной двери. */
  static dguDoorW(len) {
    return Math.max(this.DOOR.min, Math.ceil((len + 200) / 100) * 100);
  }
}
