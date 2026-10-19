import { StationFire } from './station-fire.js';
import { StationMatrix } from './station-matrix.js';

const dec = v => String(v).replace('.', ',');

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
  static get KZ() {
    return StationRules.raw('norm.lux').kz;
  }
  static get LAMP() {
    return StationMatrix.derive('lamp', () => {
      const L = StationMatrix.grp('light');
      return { w: L.lampW, lm: L.lampLm, len: L.lampLen };
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
    const T = StationLight.ETA;
    const last = T[T.length - 1];
    if (i <= T[0][0]) return T[0][1];
    if (i >= last[0]) return last[1];
    const k = T.findIndex(([a]) => i <= a);
    const [[a, x], [b, y]] = [T[k - 1], T[k]];
    return x + ((y - x) * (i - a)) / (b - a);
  }

  static calc(plan) {
    const [L, W, H] = plan.int;
    const A = (L - (plan.geo.x0 || 0)) / 1000;
    const B = W / 1000;
    const h = Math.max(0.8, (H - StationLight.PLANE) / 1000);
    const S = A * B;
    const i = S / (h * (A + B));
    const eta = StationLight.eta(i);
    const M = StationLight.LAMP;
    const n = Math.max(
      2,
      Math.ceil((StationLight.LUX * S * StationLight.KZ) / (M.lm * eta) - 1e-9),
      Math.ceil(A / (1.5 * h)),
    );
    const { small, floods, exits } = StationLight.fixtures(plan);
    const on = (plan.sys || {}).light !== false;
    const kw = on
      ? (n * M.w + small * StationLight.SMALL + floods * StationLight.FLOOD + exits * StationLight.EXIT) / 1000
      : 0;
    return {
      on,
      lux: StationLight.LUX,
      n,
      em: Math.max(1, Math.ceil(n / 2)),
      eta,
      i,
      area: S,
      E: (n * M.lm * eta) / (S * StationLight.KZ),
      small,
      floods,
      kw,
    };
  }

  /** Светильники в отсеке бака и тамбуре, прожекторы над дверями, табло «Выход». */
  static fixtures(plan) {
    const f = plan.fuel ? 1 : 0;
    const tb = (plan.geo.x0 || 0) - (f ? plan.fuel.x1 + plan.fuel.part : 0);
    const two = Number(!!((plan.doors || []).some(d => d.kind === 'entry') || plan.exit));
    const entry = Number(!!(plan.entry && !plan.entry.sea));
    const wicket = !!(plan.gates && plan.gates.wicket);
    return { small: f + Number(tb > 0), floods: entry + two + f, exits: 1 + Number(!!(two || wicket)) };
  }

  /** Строка системы контейнера «Освещение». */
  static text(Lt) {
    if (!Lt || !Lt.on) return '';
    const f = StationFire.f1;
    const M = StationLight.LAMP;
    const pl = StationFire.pl;
    const small = Lt.small
      ? `; отсек топливного бака${Lt.small > 1 ? ' и тамбур' : ''} — по светильнику ${StationLight.SMALL} Вт IP65`
      : '';
    const floods = Lt.floods
      ? `; снаружи над дверями — светодиодные прожекторы ${StationLight.FLOOD} Вт IP65 с фотореле и блоком аварийного питания (перед выходом — не менее 5 лк), ${Lt.floods} шт.`
      : '';
    return (
      `основное — ${pl(Lt.n, ['светодиодный светильник', 'светодиодных светильника', 'светодиодных светильников'])} IP65 по ${M.w} Вт (${M.lm} лм) в ряд под потолком: около ${Math.round(Lt.E)} лк на рабочей плоскости 0,8 м при норме ${Lt.lux} лк ` +
      `(СП 52.13330.2016, табл. Л.2; метод коэффициента использования: S = ${f(Lt.area)} м², индекс помещения ${f(Lt.i)}, η = ${dec(Math.round(Lt.eta * 100) / 100)}, Кз = ${dec(StationLight.KZ)}); ` +
      `аварийное — ${pl(Lt.em, ['светильник', 'светильника', 'светильников'])} из них — с блоком аварийного питания на 1 ч (на полу по оси прохода — не менее 1 лк, у выхода, огнетушителя и щита ОПС — не менее 5 лк; табл. 7.28), табло «Выход» над дверью — с аккумулятором` +
      `${small}${floods}`
    );
  }
}
