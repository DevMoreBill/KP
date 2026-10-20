import { AirChain } from '../layout/air-chain.js';
import { CalcNote } from './calc-note.js';

/**
 * Осушители: поправки производителя F = Fp · Fвх · Fокр (· Fтр — номинал серии не для +3 °C); серии нет — типовая
 * серия по виду (dryer.generic), нет и её — Kp ÷ запас. Точка росы — по классу ISO 8573-1.
 */
export class DryerSizing {
  static CLASS = /^([1-6])\.([1-6])\.([1-4])$/;
  /** Значение таблицы и признак «вне таблицы». */
  static k(table, station) {
    if (!Array.isArray(table) || !table.length || station == null) return { k: 1, out: false };
    return {
      k: StationRules.interp(table, station),
      out: station < table[0][0] - 1e-9 || station > table[table.length - 1][0] + 1e-9,
    };
  }

  /** Температуры: в помещении — наружная летом + нагрев вентиляцией; на входе — из ТЗ или помещение + dryer.inlet_dt. */
  static temps(req) {
    const amb =
      (req.tmax != null ? req.tmax : StationRules.raw('dryer.ref').ambient) + StationRules.raw('heat.vent_dt');
    return { amb, tin: req.tin != null ? req.tin : amb + StationRules.raw('dryer.inlet_dt') };
  }

  /** Серия производителя; нет — типовая серия по виду осушителя (generic). */
  static seriesOf(part, type) {
    const series = StationRules.series(part, 'dryer');
    if (series) return { s: series, generic: false };
    const title = (StationRules.raw('dryer.generic') || {})[type === 'ads' ? 'ads' : 'refrig'];
    const generic = ((StationRules.data || {}).series || []).find(z => z.kind === 'dryer' && z.title === title) || null;
    return { s: generic, generic: !!generic };
  }

  /** Поправка осушителя к номиналу: серия производителя или типовая таблица. */
  static factor(part, bar, temps, type) {
    const { s: series, generic } = DryerSizing.seriesOf(part, type);
    if (!series) {
      const kPress = AirChain.kp(bar);
      return { F: kPress / StationRules.raw('dryer.margin'), s: null, generic: false, kp: { k: kPress }, out: [] };
    }
    const kPress = DryerSizing.k(series.f.p, bar);
    const kInlet = DryerSizing.k(series.f.inlet, series.f.inlet ? temps.tin : null);
    const kAmbient = DryerSizing.k(series.f.ambient, series.f.ambient ? temps.amb : null);
    const kSeries = series.k > 0 ? series.k : 1;
    const out = [
      kPress.out && 'давление',
      kInlet.out && 'температура входа',
      kAmbient.out && 'температура помещения',
    ].filter(Boolean);
    return {
      F: kPress.k * kInlet.k * kAmbient.k * kSeries,
      s: series,
      generic,
      kp: kPress,
      ki: kInlet,
      ka: kAmbient,
      kc: kSeries,
      out,
    };
  }

  /** Осушители: производительность с поправками и точка росы. */
  static run(note, input, air, budget) {
    const req = input.req;
    const dryers = input.units.filter(unit => unit.kind === 'dryer' && unit.info.type !== 'gen');
    if (!dryers.length) {
      DryerSizing.none(note, input);
      return;
    }
    note.section('dryer', 'Осушители');
    const demand = air && air.sum > 0 ? air.sum : null;
    if (!demand) {
      note.issue('info', 'Нет производительности компрессоров — осушитель не проверен.');
      return;
    }
    const pressure = DryerSizing.pressure(req, budget, () => StationRules.raw('dryer.ref').p);
    const temps = DryerSizing.temps(req);
    DryerSizing._assumed(note, req, temps, pressure);
    const cls = String(input.cls || '').match(DryerSizing.CLASS);
    const pdpNeed = cls ? AirChain.PDP[+cls[2]] : null;
    for (const unit of dryers) DryerSizing._one(note, { q: input, u: unit, Q: demand, p: pressure, t: temps, pdpNeed });
  }

  /** Давление для поправок: у осушителя с потерями, иначе у потребителя, иначе по умолчанию. */
  static pressure(req, budget, def) {
    if (budget && budget.pOp > 0) return budget.pOp;
    return req.pressure > 0 ? req.pressure : def();
  }

  /** Класса с точкой росы нет без осушителя (если он не встроен в компрессор). */
  static none(note, input) {
    const cls = String(input.cls || '').match(DryerSizing.CLASS);
    if (!cls || input.units.some(unit => unit.kind === 'compressor' && unit.info.dryer)) return;
    const pdp = CalcNote.fmt(AirChain.PDP[+cls[2]], 0);
    note.section('dryer', 'Осушители');
    note.rule('air.pdp');
    note.step({
      what: `Осушитель для класса ${input.cls}`,
      formula: `точка росы под давлением ≤ ${pdp} °C`,
      rules: ['air.pdp'],
      ok: false,
      result: 'осушителя в составе нет',
    });
    note.issue('error', `Класс ${input.cls}: в составе нет осушителя (точка росы не выше ${pdp} °C).`);
  }

  static _assumed(note, req, temps, pressure) {
    const ventDt = StationRules.raw('heat.vent_dt');
    note.rule('heat.vent_dt');
    if (req.tin == null) {
      note.rule('dryer.inlet_dt');
      const out = req.tmax != null ? CalcNote.fmt(req.tmax, 0) : `по умолчанию ${CalcNote.fmt(temps.amb - ventDt, 0)}`;
      note.assume(
        `Температура воздуха на входе в осушитель — по правилу: в помещении станции ${CalcNote.fmt(temps.amb, 0)} °C (наружная ${out} °C + нагрев ${CalcNote.fmt(ventDt, 0)} °C) + ${CalcNote.fmt(temps.tin - temps.amb, 0)} °C после охладителя компрессора = ${CalcNote.fmt(temps.tin, 0)} °C.`,
      );
    }
    note.assume(
      `Давление на входе в осушитель и фильтры для поправок принято ${CalcNote.fmt(pressure, 1)} бар — не выше фактического (запас в меньшую сторону).`,
    );
  }

  static _one(note, { q: input, u: unit, Q: demand, p: pressure, t: temps, pdpNeed }) {
    const cap = (unit.info.flow || 0) * unit.qty;
    const factor = DryerSizing.factor(unit.p, pressure, temps, unit.info.type);
    const rules = ['heat.vent_dt', input.req.tin == null ? 'dryer.inlet_dt' : ''];
    if (!(cap > 0)) {
      note.missing(`dryer.flow.${unit.name}`, `Нет производительности осушителя ${unit.name}`);
      return;
    }
    const data = factor.s
      ? DryerSizing._series(note, unit, factor, { p: pressure, t: temps, rules })
      : DryerSizing._generic(note, unit, factor, { p: pressure, rules });
    const corr = cap * factor.F;
    const fit = note.fits(corr, demand);
    if (fit.edge) rules.push('calc.tolerance');
    const formula = DryerSizing._formula(factor);
    note.step({
      what: `${unit.name}${unit.qty > 1 ? ` × ${unit.qty} (параллельно)` : ''}`,
      formula,
      data: [
        ['номинал', `${CalcNote.fmt(cap)} м³/мин`],
        ...data,
        ['через осушитель', `${CalcNote.fmt(demand)} м³/мин`],
      ],
      rules,
      result: `с поправками ${CalcNote.fmt(corr)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(corr, demand),
      note: fit.note,
      pick: unit.name,
    });
    const name = CalcNote.lbl('Осушитель', unit.name);
    if (!fit.ok)
      note.issue(
        'error',
        `${name}: с поправками ${CalcNote.fmt(corr)} м³/мин — меньше производительности компрессоров ${CalcNote.fmt(demand)} м³/мин.`,
      );
    if (factor.out.length)
      note.issue(
        'warn',
        `${name}: условия вне таблицы производителя (${factor.out.join(', ')}) — взяты крайние значения, уточните у производителя.`,
      );
    if (pdpNeed != null) DryerSizing._dew(note, input, unit, pdpNeed);
  }

  static _formula(factor) {
    if (!factor.s) return 'Qосуш · Kp ÷ запас ≥ Σ Qраб';
    return `Qосуш · Fp · Fвх${factor.s.f.ambient ? ' · Fокр' : ''}${factor.kc !== 1 ? ' · Fтр' : ''} ≥ Σ Qраб`;
  }

  static _key(unit) {
    return `series.dryer.${unit.attrs.maker || ''}.${unit.attrs.model || unit.name}`;
  }

  static _series(note, unit, factor, { p: pressure, t: temps, rules }) {
    const data = [
      ['давление', `${CalcNote.fmt(pressure, 1)} бар → ${CalcNote.fmt(factor.kp.k, 3)}`],
      ...(factor.s.f.inlet ? [['вход', `${CalcNote.fmt(temps.tin, 0)} °C → ${CalcNote.fmt(factor.ki.k, 3)}`]] : []),
      ...(factor.s.f.ambient
        ? [['помещение', `${CalcNote.fmt(temps.amb, 0)} °C → ${CalcNote.fmt(factor.ka.k, 3)}`]]
        : []),
      ...(factor.kc !== 1 ? [[factor.s.kWhat || 'поправка серии', CalcNote.fmt(factor.kc, 2)]] : []),
      [
        'источник',
        (factor.generic ? `типовые поправки по таблице «${factor.s.title}» — ` : '') +
          [factor.s.source.doc, factor.s.source.item].filter(Boolean).join(', '),
      ],
    ];
    if (factor.generic) {
      note.rule('dryer.generic');
      rules.push('dryer.generic');
      note.missing(
        DryerSizing._key(unit),
        `Данные для расчёта неполные: поправок производителя для осушителя «${unit.name}» нет — типовые по таблице «${factor.s.title}»`,
      );
    }
    return data;
  }

  static _generic(note, unit, factor, { p: pressure, rules }) {
    note.rule('dryer.kp');
    note.rule('dryer.margin');
    rules.push('dryer.kp', 'dryer.margin');
    note.missing(
      DryerSizing._key(unit),
      `Данные для расчёта неполные: поправки производителя для осушителя «${unit.name}» не найдены — типовая таблица`,
    );
    return [
      ['давление', `${CalcNote.fmt(pressure, 1)} бар → ${CalcNote.fmt(factor.kp.k, 3)} (типовая таблица)`],
      ['запас на температуру', `÷ ${CalcNote.fmt(StationRules.raw('dryer.margin'))}`],
    ];
  }

  static _dew(note, input, unit, pdpNeed) {
    const pdp = unit.info.pdp;
    if (pdp == null) {
      note.missing(`dryer.pdp.${unit.name}`, `Нет точки росы осушителя ${unit.name}`);
      return;
    }
    const ok = pdp <= pdpNeed + 1e-9;
    note.step({
      what: 'Точка росы под давлением',
      formula: 'PDP осушителя ≤ PDP класса',
      rules: ['air.pdp'],
      data: [
        [`класс ${input.cls}`, `${CalcNote.fmt(pdpNeed, 0)} °C`],
        ['осушитель', `${CalcNote.fmt(pdp, 0)} °C`],
      ],
      ok,
      result: ok ? 'обеспечивает' : 'не обеспечивает',
    });
    note.rule('air.pdp');
    if (!ok)
      note.issue(
        'error',
        `${CalcNote.lbl('Осушитель', unit.name)}: точка росы ${CalcNote.fmt(pdp, 0)} °C — хуже требуемой по классу ${input.cls} (${CalcNote.fmt(pdpNeed, 0)} °C).`,
      );
  }
}
