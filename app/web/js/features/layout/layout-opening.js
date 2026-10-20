import { StationMatrix } from './station-matrix.js';

/** Проёмы в стенах: дверь оператора, сервисные ворота, дверь-жалюзи ДГУ; отступы проёмов от углов и друг от друга. */
export class LayoutOpening {
  /** Дверь оператора в стене прохода: от торца (за тамбуром) — дверь в свету и коробка 50 мм с каждой стороны. */
  static get ENTRY() {
    return [300, 300 + StationMatrix.door().w + 100];
  }

  /** Сервисные двери и ворота: ширина min…max, створка до leaf, высота не ниже двери оператора, от углов — pad. */
  static get DOOR() {
    const service = StationMatrix.service();
    const door = StationMatrix.door();
    return { min: service.min, max: service.max, leaf: service.leaf, h: door.h, pad: door.pad };
  }

  /** Начало проёма шириной w на стене длиной W: по месту v, не ближе pad к краям; стена уже — по середине. */
  static inWall(v, width, wallLen, pad) {
    return Math.round(
      wallLen - 2 * pad < width ? (wallLen - width) / 2 : Math.max(pad, Math.min(wallLen - pad - width, v)),
    );
  }

  /** Проёмы на одной стене: между ними — door.gap, от края станции — door.edge: {gap, eL — от торца, eW — от боковой}. */
  static gaps(geo) {
    const door = StationMatrix.door();
    const ext = geo && geo.ext;
    const i = geo && geo.int;
    const thickL = ext && i ? (ext[0] - i[0]) / 2 : 0;
    const thickW = ext && i ? (ext[1] - i[1]) / 2 : 0;
    const pad = this.DOOR.pad;
    return {
      gap: door.gap,
      eL: Math.max(pad, Math.ceil(door.edge - thickL)),
      eW: Math.max(pad, Math.ceil(door.edge - thickW)),
    };
  }

  /** Ширина сервисных ворот: сторона агрегата + service.addW (+ 2·T стенки), с шагом service.step, min…max. */
  static svcW(len, thick = 0) {
    const service = StationMatrix.service();
    const step = service.step || 100;
    const wall = service.wall === 0 ? 0 : 2 * thick;
    return Math.max(service.min, Math.min(service.max, Math.ceil((len + service.addW + wall) / step) * step));
  }

  /** Высота сервисных ворот: высота агрегата + service.addH (+ T), не ниже minH (за агрегатом) или двери, под потолком 100 мм. */
  static svcH(height, thick, rear, Hi) {
    const service = StationMatrix.service();
    const step = Math.min(50, service.step || 50);
    const wall = service.wall === 0 ? 0 : thick;
    const low = rear ? service.minH : StationMatrix.door().h;
    return Math.min(Hi - 100, Math.max(low, Math.ceil((height + service.addH + wall) / step) * step));
  }

  /** Ширина двери-жалюзи ДГУ по её стороне напротив радиатора: +200 мм, шаг 100, не уже сервисной двери. */
  static dguDoorW(len) {
    return Math.max(this.DOOR.min, Math.ceil((len + 200) / 100) * 100);
  }
}
