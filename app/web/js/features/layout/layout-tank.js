import { LayoutItem } from './layout-item.js';
import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { TankSize } from './tank-size.js';

/**
 * Отсек дополнительного топливного бака ДГУ у ближнего торца: противопожарная перегородка, вход — ворота в торце
 * (tank.gates) или своя дверь, горловина — в нише стены, бак — в поддоне вдоль задней стены.
 */
export class LayoutTank {
  static get RULES() {
    return StationMatrix.tank();
  }

  /**
   * Отсек: {units — [{e, lx, ly}], room — длина внутри, len — с перегородкой}; нет ДГУ или бака — null. Бак без своих
   * габаритов — по объёму под этот отсек (с воротами — до ширины контейнера, с дверью — оставляя проход перед ним).
   */
  static room(units, Wi, Hi, sea, gMax = Wi) {
    const tanks = units.filter(unit => unit.kind === 'tank');
    if (!tanks.length || !units.some(unit => unit.kind === 'dgu')) return null;
    const rules = this.RULES;
    const pass = StationMatrix.move().pass;
    const deep = rules.gates && !sea ? Math.min(Wi - 2 * rules.back, gMax - 2 * pass) : Wi - rules.back - rules.aisle;
    for (const unit of tanks.filter(x => !x.known)) {
      const size = TankSize.of(unit.vol || 1000, { h: (Hi || TankSize.HEIGHT) - rules.top, w: deep });
      Object.assign(unit, { l: size.l, w: size.w, h: size.h });
    }
    const spots = tanks.map(unit => {
      const long = Math.max(unit.l, unit.w);
      const short = Math.min(unit.l, unit.w);
      return long <= deep ? { e: unit, lx: short, ly: long } : { e: unit, lx: long, ly: short };
    });
    const body = spots.reduce((acc, u) => acc + u.lx, 0) + rules.gap * (spots.length - 1);
    const room = Math.max(body + 2 * rules.pad, rules.door + 2 * rules.pad);
    return { units: spots, room, len: room + rules.part };
  }

  /** Баки — в отсеке вдоль задней стены; вход и горловина; проход перед баком и высота отсека — замечания. */
  static place(res, geo, tank) {
    const [, Wi, Hi] = geo.int;
    const rules = this.RULES;
    let x = rules.pad;
    for (const { e: unit, lx: lenX, ly: lenY } of tank.units) {
      const y = Math.max(0, Wi - rules.back - lenY);
      res.items.push(
        LayoutItem.unit(unit, {
          x,
          y,
          z: 0,
          lx: lenX,
          ly: lenY,
          rot: lenX < unit.l,
          mount: 'floor',
          face: -1,
          row: 0,
          back: rules.back,
          aisle: y,
          tank: true,
        }),
      );
      x += lenX + rules.gap;
    }
    const tanks = res.items.filter(i => i.tank);
    const doorX = Math.round((tank.room - rules.door) / 2);
    const first = tanks[0];
    const fill = geo.sea
      ? { wall: 'back', x: Math.round(first.x + first.lx / 2), z: rules.fill }
      : { wall: 'left', y: Math.round(first.y + first.ly / 2), z: rules.fill };
    res.fuel = { x1: tank.room, part: rules.part, door: { x0: doorX, x1: doorX + rules.door }, fill };
    if (rules.gates && !geo.sea) this.gate(res, geo, tanks, tank);
    res.fuel.fill.niche = true;
    this.check(res, tanks, Hi);
  }

  /** Вход в отсек — двустворчатые ворота в торце напротив баков; горловина — в торце рядом, не встала — в стене прохода. */
  static gate(res, geo, tanks, tank) {
    const [, Wi, Hi] = geo.int;
    const rules = this.RULES;
    const gaps = LayoutOpening.gaps(geo);
    const [from, till] = tanks.reduce((acc, i) => [Math.min(acc[0], i.y), Math.max(acc[1], i.y + i.ly)], [Wi, 0]);
    const width = Math.min(Wi - 2 * gaps.eW, LayoutOpening.dguDoorW(till - from));
    const y0 = Math.round(Math.max(gaps.eW, Math.min(Wi - gaps.eW - width, (from + till) / 2 - width / 2)));
    const height = Math.min(Hi - 100, Math.max(LayoutOpening.DOOR.h, Math.max(...tanks.map(i => i.h)) + 150));
    res.fuel.door = null;
    res.fuel.gate = { wall: 'left', y0, y1: y0 + width, w: width, h: height, leaves: 2 };
    const fillY = y0 - gaps.gap - 150;
    res.fuel.fill =
      fillY - 150 >= gaps.eW
        ? { wall: 'left', y: Math.round(fillY), z: rules.fill }
        : { wall: 'front', x: Math.round(tank.room / 2), z: rules.fill };
  }

  static check(res, tanks, Hi) {
    const rules = this.RULES;
    const fmt = v => Mm.text(v);
    const iss = (res.issues = res.issues || []);
    const aisle = Math.min(...tanks.map(i => i.y));
    if (aisle < rules.aisle && !res.fuel.gate) {
      iss.push({
        level: 'warn',
        text: `Отсек топливного бака: проход перед баком ${fmt(aisle)} мм — меньше ${fmt(rules.aisle)} мм.`,
      });
    }
    for (const i of tanks.filter(x => x.h + 200 > Hi)) {
      res.bad = true;
      iss.push({
        level: 'error',
        text: `Топливный бак поз. ${i.pos} не проходит по высоте отсека: ${fmt(i.h)} мм, внутри ${fmt(Hi)} мм.`,
      });
    }
  }
}
