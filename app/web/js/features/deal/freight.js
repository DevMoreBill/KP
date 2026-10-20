import { FreightFit } from './freight-fit.js';
import { FreightTariffs } from './freight-tariffs.js';
import { LgCargo } from './lg-cargo.js';
import { LgFmt } from './lg-fmt.js';
import { LgGeo } from './lg-geo.js';
import { LgValues } from './lg-values.js';

/**
 * Перевозка по России целиком: точки и расстояние, места груза с упаковкой, машины, разгрузка, агент, страхование, срок,
 * разброс оценки; сверка тарифов с фактическими счетами перевозчиков.
 */
export class Freight {
  static DEFAULTS = FreightTariffs.DEFAULTS;
  static NEAR_KM = 40;
  static MAX_UNITS = 300;
  static PCT = 100;
  static ROUND = 100;
  static GIBDD_W = 4;
  static EPS = 0.001;
  static MIN_FACTS = 3;
  static SPREAD = 2;
  static FIT_MIN = 0.2;
  static FIT_MAX = 5;
  static DET_EPS = 1e-18;

  /**
   * Тарифы: стандартные + сохранённые + автообновление.
   * @param {object} [saved]
   * @returns {object}
   */
  static tariffs(saved) {
    return FreightTariffs.of(saved);
  }

  /**
   * Рейс по тарифу класса.
   * @param {object} cls
   * @param {number} dist
   * @param {object} tariffs
   * @param {number} [factor]
   * @returns {object}
   */
  static run(cls, dist, tariffs, factor = 1) {
    return FreightFit.run(cls, dist, tariffs, factor);
  }

  /**
   * Число автомобилей прикрытия.
   * @param {number} width
   * @param {number} heightTotal
   * @param {object} tariffs
   * @returns {number}
   */
  static escortCars(width, heightTotal, tariffs) {
    return FreightFit.escortCars(width, heightTotal, tariffs);
  }

  /**
   * Цена машины строками расчёта.
   * @param {object} cls
   * @param {object} fit
   * @param {number} dist
   * @param {object} tariffs
   * @returns {object}
   */
  static vehicleCost(cls, fit, dist, tariffs) {
    return FreightFit.vehicleCost(cls, fit, dist, tariffs);
  }

  /**
   * Ключ маршрута по дорогам: обе точки с координатами (один город без адресов — по городу, ключа нет).
   * @param {object} from
   * @param {object} dest
   * @returns {string}
   */
  static routeKey(from, dest) {
    const coords = [from, dest].every(point => point && Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (!coords) return '';
    if (!from.exact && !dest.exact && from.name === dest.name) return '';
    return `${from.lat.toFixed(4)},${from.lon.toFixed(4)}|${dest.lat.toFixed(4)},${dest.lon.toFixed(4)}`;
  }

  /**
   * Расчёт целиком.
   * @param {object} inp { from, to, km, route, items, unload, value }
   * @param {object} [tariffsIn]
   * @returns {object}
   */
  static calc(inp, tariffsIn) {
    const tariffs = tariffsIn || Freight.tariffs();
    const warn = [];
    const missing = [];
    const from = LgGeo.point(inp.from);
    const dest = LgGeo.point(inp.to);
    const routeKey = Freight.routeKey(from, dest);
    const way = Freight._distance(inp, { from, dest, routeKey, tariffs });
    Freight._roadWarn({ from, dest }, warn);
    const units = Freight._units(inp.items || [], { tariffs, warn, missing });
    const res = {
      from,
      to: dest,
      km: way.km,
      kmSrc: way.src,
      routeKey,
      units: units.length,
      openOnly: units.some(unit => unit.open),
      mass: units.reduce((sum, unit) => sum + unit.m, 0),
      missing,
      warn,
      vehicles: [],
      unplaced: [],
      unload: null,
      total: 0,
      lo: 0,
      hi: 0,
      days: 0,
      ok: false,
    };
    if (!(way.km > 0)) return { ...res, need: 'Укажите, откуда и куда везём (город в адресе) или расстояние в км' };
    if (!units.length) {
      return {
        ...res,
        need: missing.length ? 'Укажите массу и габариты позиций' : 'В КП нет позиций этого поставщика',
      };
    }
    return Freight._priced(res, { inp, units, tariffs });
  }

  static _distance(inp, { from, dest, routeKey, tariffs }) {
    const own = LgCargo.num(inp.km);
    if (own > 0) return { km: own, src: 'вручную' };
    const route = inp.route;
    if (routeKey && route && route.key === routeKey && route.km > 0) {
      return { km: route.km, src: (route.src || 'по дорогам') + Freight._routeTail(from, dest) };
    }
    const road = LgGeo.roadKm(from, dest, tariffs);
    return { km: road, src: road ? Freight._straightSrc(from, dest) : '' };
  }

  static _routeTail(from, dest) {
    if (from.exact && dest.exact) return '';
    return from.exact || dest.exact ? ', от центра города' : ', между центрами городов';
  }

  static _straightSrc(from, dest) {
    if (from.exact && dest.exact) {
      return LgGeo.hav(from, dest) < Freight.NEAR_KM
        ? 'по городу между адресами'
        : 'по прямой между адресами с поправкой на дороги';
    }
    return from.name === dest.name ? 'в пределах города' : 'по прямой с поправкой на дороги';
  }

  static _roadWarn({ from, dest }, warn) {
    if ((from && from.noRoad) || (dest && dest.noRoad)) {
      const name = (dest && dest.noRoad ? dest : from).name;
      warn.push(`${name}: нет круглогодичной дороги — доставка морем, по зимнику или авиа, нужен расчёт перевозчика`);
    }
    if (from && dest && (from.name === 'Калининград') !== (dest.name === 'Калининград')) {
      warn.push('Калининград: транзит через страны ЕС или паром — нужен расчёт перевозчика');
    }
  }

  static _units(items, { tariffs, warn, missing }) {
    const units = [];
    for (const item of items) {
      const qty = Math.max(0, Math.round(+item.qty || 0));
      if (!qty) continue;
      const [length, width, height, mass] = [+item.l, +item.w, +item.h, +item.m];
      if (!(length > 0 && width > 0 && height > 0) || !(mass > 0)) {
        missing.push(item.name || 'позиция');
        continue;
      }
      const packed = mass < tariffs.packMax ? mass * (1 + tariffs.pack / Freight.PCT) : mass;
      const unit = {
        name: item.name,
        l: Math.max(length, width),
        w: Math.min(length, width),
        h: height,
        m: packed,
        open: !!item.open,
      };
      for (let i = 0; i < Math.min(qty, Freight.MAX_UNITS); i++) units.push({ ...unit });
      if (qty > Freight.MAX_UNITS) warn.push(`${item.name}: больше 300 мест — посчитаны первые 300`);
    }
    return units;
  }

  static _priced(res, { inp, units, tariffs }) {
    const iso = FreightTariffs.ISO;
    const plan = FreightFit.plan(units, res.km, tariffs, iso);
    res.vehicles = plan.vehicles;
    res.unplaced = plan.unplaced;
    Freight._planWarn(res, plan, tariffs);
    const maxUnit = units.reduce((max, unit) => Math.max(max, unit.m), 0);
    res.unload = Freight._unloadPick(maxUnit, tariffs, inp.unload || LgValues.unload());
    if (res.unload && maxUnit > res.unload.max + Freight.EPS) {
      res.warn.push(`Самое тяжёлое место ${LgFmt.tons(maxUnit)} т — больше, чем поднимет «${res.unload.name}»`);
    }
    Freight._money(res, { inp, units, tariffs, iso });
    const over = res.vehicles.some(vehicle => vehicle.over || vehicle.heavy);
    res.days = Math.ceil(res.km / (over ? tariffs.kmDayOver : tariffs.kmDay)) + 1 + (over ? tariffs.permitDays : 0);
    res.over = over;
    res.ok = !plan.unplaced.length && !res.missing.length;
    return res;
  }

  static _planWarn(res, plan, tariffs) {
    if (plan.unplaced.length) {
      const names = [...new Set(plan.unplaced.map(row => row.u.name))].join(', ');
      res.warn.push(`Не помещается ни в одну машину из тарифов: ${names} — нужен индивидуальный расчёт`);
    }
    if (res.vehicles.some(vehicle => vehicle.gibdd)) {
      res.warn.push(
        `Груз шире ${LgFmt.meters(tariffs.gibddW || Freight.GIBDD_W)} м — возможно сопровождение патрульным автомобилем ГИБДД: решает Госавтоинспекция при согласовании маршрута (Требования Минтранса № 343, п. 30); стоимость уточните у перевозчика (в расчёт не входит)`,
      );
    }
  }

  static _unloadPick(maxUnit, tariffs, want) {
    if (want === 'none') return null;
    if (want && want !== 'auto') return tariffs.unload.find(row => row.id === want) || null;
    return tariffs.unload.find(row => maxUnit <= row.max) || tariffs.unload[tariffs.unload.length - 1];
  }

  // агент — на рейс, разрешения, прикрытие и разгрузку; страхование — обязательно, без агентских
  static _money(res, { inp, units, tariffs, iso }) {
    const pct = Freight.PCT;
    res.transport = res.vehicles.reduce((sum, vehicle) => sum + vehicle.cost, 0);
    const unloadCost = LgValues.agentUnload() && res.unload ? res.unload.cost : 0;
    res.agent = Math.round(((res.transport + unloadCost) * tariffs.agentPct) / pct);
    const value = +inp.value || 0;
    res.ins = Math.round(Math.max(tariffs.insMin, (value * tariffs.insPct) / pct));
    res.insBase = value;
    // забор у отправителя и доставка получателю по городу (для «терминал — терминал»)
    const local = FreightFit.plan(units, tariffs.localKm, tariffs, iso);
    res.localLeg = local.unplaced.length
      ? 0
      : Math.round(local.vehicles.reduce((sum, vehicle) => sum + vehicle.cost, 0));
    res.total = res.transport + res.agent + res.ins + (res.unload ? res.unload.cost : 0);
    res.lo = Math.round((res.total * (1 - tariffs.range / pct)) / Freight.ROUND) * Freight.ROUND;
    res.hi = Math.round((res.total * (1 + tariffs.range / pct)) / Freight.ROUND) * Freight.ROUND;
  }

  /**
   * Сверка с фактическими счетами: для записи — цена рейса по тарифу и отклонение; для класса — поправка: при 3+ счетах на
   * разных расстояниях — множители к подаче и к ставкам за км (взвешенный МНК по относительной ошибке), иначе — медиана.
   * @param {object[]} facts [{at, route, km, cls, sum, note}]
   * @param {object} tariffs
   * @returns {{rows: object[], classes: object[]}}
   */
  static calibrate(facts, tariffs) {
    const rows = (facts || []).map(fact => Freight._factRow(fact, tariffs));
    const out = [];
    for (const cls of tariffs.classes) {
      const own = rows.filter(row => row.ok && row.cls === cls.id);
      if (own.length) out.push(Freight._fitClass(cls, own, tariffs));
    }
    return { rows, classes: out };
  }

  static _factRow(fact, tariffs) {
    const cls = tariffs.classes.find(row => row.id === fact.cls);
    const dist = +fact.km;
    const sum = +fact.sum;
    if (!cls || !(dist > 0) || !(sum > 0)) return { ...fact, ok: false };
    const trip = Freight.run(cls, dist, tariffs);
    return { ...fact, ok: true, model: trip.v, dev: sum / trip.v - 1 };
  }

  static _median(rows) {
    const ratios = rows.map(row => 1 + row.dev).sort((left, right) => left - right);
    const count = ratios.length;
    return count % 2 ? ratios[(count - 1) / 2] : (ratios[count / 2 - 1] + ratios[count / 2]) / 2;
  }

  static _fitClass(cls, rows, tariffs) {
    const med = Freight._median(rows);
    const pair = Freight._leastSquares(cls, rows, tariffs) || {
      base: med,
      km: med,
      how: 'один множитель — медиана по счетам',
    };
    const fitted = {
      ...cls,
      base: Math.round(((cls.base || 0) * pair.base) / Freight.ROUND) * Freight.ROUND,
      min: Math.round(((cls.min || 0) * pair.base) / Freight.ROUND) * Freight.ROUND,
      km: Math.round(cls.km * pair.km),
      kmFar: Math.round((cls.kmFar > 0 ? cls.kmFar : cls.km) * pair.km),
    };
    const err = model =>
      (rows.reduce((sum, row) => sum + Math.abs(row.sum / Freight.run(model, +row.km, tariffs).v - 1), 0) /
        rows.length) *
      Freight.PCT;
    return {
      id: cls.id,
      name: cls.name,
      n: rows.length,
      a: pair.base,
      b: pair.km,
      how: pair.how,
      before: err(cls),
      after: err(fitted),
      fitted,
    };
  }

  // sum ≈ α·base + β·D, D — часть рейса за км; вес 1/sum² (относительная ошибка)
  static _leastSquares(cls, rows, tariffs) {
    const kms = rows.map(row => +row.km);
    const enough = rows.length >= Freight.MIN_FACTS && Math.max(...kms) >= Freight.SPREAD * Math.min(...kms);
    if (!enough || !((cls.base || 0) > 0)) return null;
    const acc = { s11: 0, s12: 0, s22: 0, t1: 0, t2: 0 };
    for (const row of rows) {
      const base = cls.base || 0;
      const perKm = Freight.run(cls, +row.km, tariffs).raw - base;
      const weight = 1 / (row.sum * row.sum);
      acc.s11 += weight * base * base;
      acc.s12 += weight * base * perKm;
      acc.s22 += weight * perKm * perKm;
      acc.t1 += weight * base * row.sum;
      acc.t2 += weight * perKm * row.sum;
    }
    const det = acc.s11 * acc.s22 - acc.s12 * acc.s12;
    if (!(Math.abs(det) > Freight.DET_EPS)) return null;
    const alpha = (acc.t1 * acc.s22 - acc.t2 * acc.s12) / det;
    const beta = (acc.s11 * acc.t2 - acc.s12 * acc.t1) / det;
    const sane = value => value > Freight.FIT_MIN && value < Freight.FIT_MAX;
    if (!sane(alpha) || !sane(beta)) return null;
    return { base: alpha, km: beta, how: 'подача и ставки за км отдельно — по счетам на разных расстояниях' };
  }
}
