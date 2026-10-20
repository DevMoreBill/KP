import { Mm } from './mm.js';
import { StationFire } from './station-fire.js';
import { StationMatrix } from './station-matrix.js';

/**
 * Освещение: светильники в ряд по оси помещения, число — методом коэффициента использования N = E · S · Кз / (Φ · η)
 * (СП 52.13330.2016, табл. Л.2), не меньше двух и не реже 1,5 h; аварийное — половина с блоками на 1 ч (табл. 7.28).
 */
export class StationLight {
  static ETA = [
    [0.5, 0.34],
    [0.6, 0.39],
    [0.8, 0.46],
    [1, 0.51],
    [1.25, 0.56],
    [1.5, 0.6],
    [2, 0.65],
    [2.5, 0.69],
    [3, 0.71],
    [4, 0.74],
    [5, 0.76],
  ];

  static get LUX() {
    return StationRules.raw('norm.lux').lux;
  }
  static get PLANE() {
    return StationMatrix.grp('light').plane;
  }
  static get RESERVE_K() {
    return StationRules.raw('norm.lux').kz;
  }
  static get LAMP() {
    return StationMatrix.derive('lamp', () => {
      const lamp = StationMatrix.grp('light');
      return { w: lamp.lampW, lm: lamp.lampLm, len: lamp.lampLen };
    });
  }
  static get SMALL() {
    return StationMatrix.grp('light').small;
  }
  static get FLOOD() {
    return StationMatrix.grp('light').flood;
  }
  static get EXIT() {
    return StationMatrix.grp('light').exit;
  }

  /** Коэффициент использования по индексу помещения (линейно между точками таблицы). */
  static eta(i) {
    const table = StationLight.ETA;
    const last = table[table.length - 1];
    if (i <= table[0][0]) return table[0][1];
    if (i >= last[0]) return last[1];
    const k = table.findIndex(([lux]) => i <= lux);
    const [[lower, x], [upper, y]] = [table[k - 1], table[k]];
    return x + ((y - x) * (i - lower)) / (upper - lower);
  }

  static calc(plan) {
    const [Li, Wi, Hi] = plan.int;
    const lenM = (Li - (plan.geo.x0 || 0)) / 1000;
    const widM = Wi / 1000;
    const height = Math.max(0.8, (Hi - StationLight.PLANE) / 1000);
    const area = lenM * widM;
    const i = area / (height * (lenM + widM));
    const eta = StationLight.eta(i);
    const lamp = StationLight.LAMP;
    const count = Math.max(
      2,
      Math.ceil((StationLight.LUX * area * StationLight.RESERVE_K) / (lamp.lm * eta) - 1e-9),
      Math.ceil(lenM / (1.5 * height)),
    );
    const { small, floods, exits } = StationLight.fixtures(plan);
    const active = (plan.sys || {}).light !== false;
    const kw = active
      ? (count * lamp.w + small * StationLight.SMALL + floods * StationLight.FLOOD + exits * StationLight.EXIT) / 1000
      : 0;
    return {
      on: active,
      lux: StationLight.LUX,
      n: count,
      em: Math.max(1, Math.ceil(count / 2)),
      eta,
      i,
      area,
      E: (count * lamp.lm * eta) / (area * StationLight.RESERVE_K),
      small,
      floods,
      kw,
    };
  }

  /** Светильники в отсеке бака и тамбуре, прожекторы над дверями, табло «Выход». */
  static fixtures(plan) {
    const fuelCount = plan.fuel ? 1 : 0;
    const tambour = (plan.geo.x0 || 0) - (fuelCount ? plan.fuel.x1 + plan.fuel.part : 0);
    const two = Number(!!((plan.doors || []).some(door => door.kind === 'entry') || plan.exit));
    const entry = Number(!!(plan.entry && !plan.entry.sea));
    const wicket = !!(plan.gates && plan.gates.wicket);
    return {
      small: fuelCount + Number(tambour > 0),
      floods: entry + two + fuelCount,
      exits: 1 + Number(!!(two || wicket)),
    };
  }

  /** Строка системы контейнера «Освещение». */
  static text(light) {
    if (!light || !light.on) return '';
    const dec1 = StationFire.dec1;
    const lamp = StationLight.LAMP;
    const plural = StationFire.plural;
    const small = light.small
      ? `; отсек топливного бака${light.small > 1 ? ' и тамбур' : ''} — по светильнику ${StationLight.SMALL} Вт IP65`
      : '';
    const floods = light.floods
      ? `; снаружи над дверями — светодиодные прожекторы ${StationLight.FLOOD} Вт IP65 с фотореле и блоком аварийного питания (перед выходом — не менее 5 лк), ${light.floods} шт.`
      : '';
    return (
      `основное — ${plural(light.n, ['светодиодный светильник', 'светодиодных светильника', 'светодиодных светильников'])} IP65 по ${lamp.w} Вт (${lamp.lm} лм) в ряд под потолком: около ${Math.round(light.E)} лк на рабочей плоскости 0,8 м при норме ${light.lux} лк ` +
      `(СП 52.13330.2016, табл. Л.2; метод коэффициента использования: S = ${dec1(light.area)} м², индекс помещения ${dec1(light.i)}, η = ${Mm.dec(Math.round(light.eta * 100) / 100)}, Кз = ${Mm.dec(StationLight.RESERVE_K)}); ` +
      `аварийное — ${plural(light.em, ['светильник', 'светильника', 'светильников'])} из них — с блоком аварийного питания на 1 ч (на полу по оси прохода — не менее 1 лк, у выхода, огнетушителя и щита ОПС — не менее 5 лк; табл. 7.28), табло «Выход» над дверью — с аккумулятором` +
      `${small}${floods}`
    );
  }
}
