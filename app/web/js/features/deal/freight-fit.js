import { LgFmt } from './lg-fmt.js';

/**
 * Раскладка груза по машинам и цена рейса: места на площадке (поворот в плане, кантовать нельзя), негабарит и тяжеловес
 * по правилам РФ (ПП РФ № 2200; Требования Минтранса № 343 — автомобили прикрытия), подача + ставки за км, план из одной
 * или нескольких машин.
 */
export class FreightFit {
  static EPS = 0.001;
  static SHELF_GAP = 0.1;
  static LEGAL_W = 2.55;
  static LEGAL_H = 4;
  static ESCORT_W = 3.5;
  static ESCORT_WIDE = 4.5;
  static ESCORT_H = 4.5;
  static GIBDD_W = 4;
  static BY_PROJECT = 5;
  static TINY = 1e-9;
  static ISO_ONLY = 'контейнеровоз возит только морские контейнеры 20 и 40 футов';
  static OPEN_ONLY = 'станцию в сборе возят только открытой машиной: контейнеровоз, площадка или трал';

  /**
   * Место — морской контейнер 20 или 40 футов.
   * @param {{l: number, w: number, h: number}} unit
   * @param {object} iso размеры ISO
   * @returns {boolean}
   */
  static isIso(unit, iso) {
    const near = (value, list) => list.some(size => Math.abs(value - size) <= iso.tol);
    return (
      near(Math.max(unit.l, unit.w), iso.l) &&
      Math.abs(Math.min(unit.l, unit.w) - iso.w) <= iso.tol &&
      near(unit.h, iso.h)
    );
  }

  /**
   * Грузоподъёмность без спецразрешения на тяжеловес.
   * @param {object} cls класс машины
   * @param {object} tariffs
   * @returns {number}
   */
  static legalT(cls, tariffs) {
    if (cls.tLegal > 0) return cls.tLegal;
    return cls.open && cls.t > tariffs.heavyFrom ? tariffs.heavyFrom : cls.t;
  }

  /**
   * Раскладка мест по площадке класса машины.
   * @param {object[]} units места груза {l, w, h, m, name, open}
   * @param {object} cls
   * @param {object} tariffs
   * @param {object} iso размеры морского контейнера
   * @returns {object} { ok, why } или { ok, mass, overW, overH, depth }
   */
  static fit(units, cls, tariffs, iso) {
    const state = { mass: 0, overW: 0, overH: 0, lay: [] };
    const legalW = (tariffs.legal && tariffs.legal.w) || this.LEGAL_W;
    for (const unit of units) {
      const why = this._place(unit, cls, { state, legalW, iso });
      if (why) return { ok: false, why };
    }
    if (state.mass > cls.t + this.EPS) {
      return { ok: false, why: `масса ${LgFmt.tons(state.mass)} т больше грузоподъёмности ${LgFmt.tons(cls.t)} т` };
    }
    const depth = this._shelves(state.lay, cls);
    if (depth - this.SHELF_GAP > cls.L + this.EPS) return { ok: false, why: 'не помещается по длине площадки' };
    return {
      ok: true,
      mass: state.mass,
      overW: state.overW,
      overH: state.overH,
      depth: Math.max(0, depth - this.SHELF_GAP),
    };
  }

  static _place(unit, cls, { state, legalW, iso }) {
    if (unit.open && !cls.open) return this.OPEN_ONLY;
    if (cls.iso && !this.isIso(unit, iso)) return this.ISO_ONLY;
    state.mass += unit.m;
    let length = unit.l;
    let width = unit.w;
    // повернуть поперёк, если так помещается
    if (width > cls.W && length <= cls.W && width <= cls.L) [length, width] = [width, length];
    const why = this._oversize(unit, cls, length, width);
    if (why) return why;
    // открытая площадка: груз шире кузова, но не шире 2,55 м, — без спецразрешения; шире — негабарит
    if (width > legalW + this.EPS) state.overW = Math.max(state.overW, width);
    if (unit.h > cls.h + this.EPS) state.overH = Math.max(state.overH, unit.h);
    state.lay.push({ l: length, w: width, u: unit });
    return '';
  }

  static _oversize(unit, cls, length, width) {
    const meters = LgFmt.meters;
    if (length > cls.L + this.EPS) return `длина ${meters(unit.l)} м больше площадки ${meters(cls.L)} м`;
    if (unit.h > cls.hMax + this.EPS) return `высота ${meters(unit.h)} м больше допустимой ${meters(cls.hMax)} м`;
    if (width > cls.wMax + this.EPS || (!cls.open && width > cls.W + this.EPS)) {
      return `ширина ${meters(width)} м больше допустимой ${meters(cls.open ? cls.wMax : cls.W)} м`;
    }
    return '';
  }

  // полки вдоль площадки: в полке места стоят рядом поперёк, глубина полки — самое длинное место
  static _shelves(lay, cls) {
    lay.sort((left, right) => right.l - left.l || right.w - left.w);
    const shelves = [];
    let depth = 0;
    for (const place of lay) {
      const shelf = shelves.find(
        row =>
          row.depth >= place.l - this.EPS &&
          row.used + place.w <= Math.max(cls.W, place.w) + this.EPS &&
          !(row.wide || place.w > cls.W),
      );
      if (shelf) shelf.used += place.w;
      else {
        shelves.push({ depth: place.l, used: place.w, wide: place.w > cls.W });
        depth += place.l + this.SHELF_GAP;
      }
    }
    return depth;
  }

  /**
   * Рейс: подача + км до far × ставка + км дальше × «дальняя» ставка (× надбавка негабарита), не меньше минимального заказа.
   * @param {object} cls
   * @param {number} dist
   * @param {object} tariffs
   * @param {number} [factor]
   * @returns {{v: number, raw: number, near: number, rest: number, kmFar: number}}
   */
  static run(cls, dist, tariffs, factor = 1) {
    const far = tariffs.far > 0 ? tariffs.far : Infinity;
    const near = Math.min(dist, far);
    const rest = Math.max(0, dist - far);
    const kmFar = cls.kmFar > 0 ? cls.kmFar : cls.km;
    const raw = (cls.base || 0) + (cls.km * near + kmFar * rest) * factor;
    return { v: Math.max(cls.min || 0, raw), raw, near, rest, kmFar };
  }

  /**
   * Автомобили прикрытия (Требования Минтранса № 343): п. 14 — по ширине (свыше 3,5 до 4,5 м — 2, свыше 4,5 — 3, свыше
   * 5 м — по проекту организации движения), п. 32 — спереди при высоте ТС с грузом 4,5 м и более.
   * @param {number} width ширина груза, м
   * @param {number} heightTotal высота ТС с грузом, м
   * @param {object} tariffs
   * @returns {number}
   */
  static escortCars(width, heightTotal, tariffs) {
    const from = tariffs.escortW > 0 ? tariffs.escortW : this.ESCORT_W;
    if (width > from + this.TINY) return width > this.ESCORT_WIDE + this.TINY ? 3 : 2;
    return heightTotal >= this.ESCORT_H - this.TINY ? 1 : 0;
  }

  /**
   * Цена машины с негабаритом, тяжеловесом и прикрытием — строками расчёта.
   * @param {object} cls
   * @param {object} fit раскладка
   * @param {number} dist
   * @param {object} tariffs
   * @returns {object}
   */
  static vehicleCost(cls, fit, dist, tariffs) {
    const legalH = (tariffs.legal && tariffs.legal.h) || this.LEGAL_H;
    // груз выше допустимого в этой машине
    const heightTotal = fit.overH > 0 ? legalH + (fit.overH - cls.h) : 0;
    const cars = this.escortCars(fit.overW, heightTotal, tariffs);
    const over = fit.overW > 0 || fit.overH > 0;
    const heavy = fit.mass > this.legalT(cls, tariffs) + this.EPS;
    const gibdd = fit.overW > (tariffs.gibddW || this.GIBDD_W);
    const factor = this._overK(over, cls, tariffs);
    const trip = this.run(cls, dist, tariffs, factor);
    const ctx = { cls, fit, dist, tariffs, factor, trip, over, heavy, cars, heightTotal };
    const parts = [this._tripPart(ctx), this._overPart(ctx), this._heavyPart(ctx), this._escortPart(ctx)].filter(
      Boolean,
    );
    return {
      cost: parts.reduce((sum, part) => sum + part[1], 0),
      parts,
      over,
      heavy,
      escort: cars > 0,
      escortCars: cars,
      gibdd,
    };
  }

  static _overK(over, cls, tariffs) {
    if (!over) return 1;
    return cls.id === 'lowbed' ? tariffs.overKLowbed : tariffs.overK;
  }

  static _tripPart({ cls, dist, factor, trip }) {
    const int = value => Money.int(value);
    const rub = LgFmt.rub;
    const seg =
      trip.rest > 0
        ? `${int(trip.near)} км × ${rub(cls.km * factor)} + ${int(trip.rest)} км × ${rub(trip.kmFar * factor)}`
        : `${int(dist)} км × ${rub(cls.km * factor)}`;
    const min = trip.raw < (cls.min || 0) ? ` (минимальный заказ ${rub(cls.min)})` : '';
    return [`${cls.name}: подача ${rub(cls.base || 0)} + ${seg}${min}`, trip.v];
  }

  static _overPart({ fit, tariffs, over }) {
    if (!over) return null;
    const what = [
      fit.overW ? `ширина ${LgFmt.meters(fit.overW)} м` : '',
      fit.overH ? `высота груза ${LgFmt.meters(fit.overH)} м` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `Негабарит (${what}): спецразрешение${tariffs.permitAgent ? ' и оформление' : ''}`,
      tariffs.permit + tariffs.permitAgent,
    ];
  }

  static _heavyPart({ cls, fit, dist, tariffs, over, heavy }) {
    if (!heavy) return null;
    const legal = LgFmt.tons(this.legalT(cls, tariffs));
    const title = `Тяжеловес (${LgFmt.tons(fit.mass)} т, без разрешения — до ${legal} т): ${over ? '' : 'разрешение и '}вред дорогам ${Money.int(dist)} км × ${LgFmt.rub(tariffs.harmKm)}`;
    return [title, (over ? 0 : tariffs.heavyPermit + tariffs.permitAgent) + tariffs.harmKm * dist];
  }

  static _escortPart({ fit, dist, tariffs, cars, heightTotal }) {
    if (!(cars > 0)) return null;
    const byWidth = fit.overW > (tariffs.escortW || this.ESCORT_W);
    const why = byWidth ? `ширина ${LgFmt.meters(fit.overW)} м` : `высота с грузом ${LgFmt.meters(heightTotal)} м`;
    const project = fit.overW > this.BY_PROJECT ? '; шире 5 м — по проекту организации движения' : '';
    const title = `Автомобили прикрытия: ${cars} × ${Money.int(dist)} км × ${LgFmt.rub(tariffs.escortKm)} (${why}; Требования Минтранса № 343, п. ${byWidth ? '14' : '32'}${project})`;
    return [title, cars * tariffs.escortKm * dist];
  }

  /**
   * Самый дешёвый класс машины, куда помещаются места.
   * @param {object[]} units
   * @param {number} dist
   * @param {object} tariffs
   * @param {object} iso
   * @returns {object|null}
   */
  static bestClass(units, dist, tariffs, iso) {
    let best = null;
    for (const cls of tariffs.classes) {
      const fit = this.fit(units, cls, tariffs, iso);
      if (!fit.ok) continue;
      const cost = this.vehicleCost(cls, fit, dist, tariffs);
      if (!best || cost.cost < best.cost) best = { C: cls, fit, ...cost };
    }
    return best;
  }

  /**
   * План перевозки: одна машина, если всё помещается; иначе — несколько (крупные места первыми).
   * @param {object[]} units
   * @param {number} dist
   * @param {object} tariffs
   * @param {object} iso
   * @returns {{vehicles: object[], unplaced: object[]}}
   */
  static plan(units, dist, tariffs, iso) {
    const one = this.bestClass(units, dist, tariffs, iso);
    if (one) return { vehicles: [{ ...one, units }], unplaced: [] };
    const sorted = [...units].sort((left, right) => right.l * right.w - left.l * left.w || right.m - left.m);
    const vehicles = [];
    const unplaced = [];
    for (const unit of sorted) {
      if (this._addTo(vehicles, unit, { dist, tariffs, iso })) continue;
      const alone = this.bestClass([unit], dist, tariffs, iso);
      if (alone) vehicles.push({ ...alone, units: [unit] });
      else unplaced.push({ u: unit, why: this._why(unit, tariffs, iso) });
    }
    return { vehicles, unplaced };
  }

  static _addTo(vehicles, unit, { dist, tariffs, iso }) {
    for (const vehicle of vehicles) {
      const best = this.bestClass(vehicle.units.concat(unit), dist, tariffs, iso);
      if (!best) continue;
      Object.assign(vehicle, best, { units: vehicle.units.concat(unit) });
      return true;
    }
    return false;
  }

  static _why(unit, tariffs, iso) {
    return (
      tariffs.classes
        .map(cls => this.fit([unit], cls, tariffs, iso).why)
        .filter(Boolean)
        .pop() || ''
    );
  }
}
