import { AirChain } from '../layout/air-chain.js';
import { SummerTemp } from '../layout/summer-temp.js';
import { CalcNote } from './calc-note.js';
import { StationRules } from '../rules/station-rules.js';
import { ReserveCheck } from './reserve-check.js';

/**
 * Потребность → производительность компрессоров (ISO 1217, FAD). Н. м³ (DIN 1343) или ст. м³ (ГОСТ 2939-63) — в FAD по
 * давлению на высоте (ГОСТ 4401-81) и парциальному давлению пара (Магнус, WMO-No. 8); затем запас, продувка
 * адсорбционного осушителя и сравнение с рабочими компрессорами (резервные — самые крупные, не считаются).
 */
export class AirDemand {
  static KELVIN = 273.15;
  static P_NORMAL = 101.325; // кПа, нормальное атмосферное давление
  static REF = { normal: 'flow.normal', std: 'flow.standard' };

  /** Давление на высоте H, кПа. */
  static baro(alt) {
    const isa = StationRules.raw('flow.isa');
    return isa.p0 * Math.pow(1 - isa.a * Math.max(0, alt || 0), isa.n);
  }

  /** Давление насыщенного пара над водой при t, кПа. */
  static psat(temp) {
    const coef = StationRules.raw('flow.psat');
    return coef.c * Math.exp((coef.b * temp) / (coef.l + temp));
  }

  /** Единица потребности для основы пересчёта (FAD, н. м³, ст. м³). */
  static unit(basis) {
    return basis === 'std' ? 'ст. м³' : 'н. м³';
  }

  /** Условия приведения; ст. м³ в своей версии правил до 3.99 может не быть — 20 °C, 101,325 кПа. */
  static ref(basis) {
    return basis === 'std'
      ? StationRules.opt('flow.standard') || { t: 20, p: AirDemand.P_NORMAL }
      : StationRules.raw('flow.normal');
  }

  /** Н. м³/мин (или ст. м³/мин) → FAD при условиях всасывания. */
  static fad(normal, alt, temp, humidity, basis = 'normal') {
    const refCond = AirDemand.ref(basis);
    const vapor = ((humidity || 0) / 100) * AirDemand.psat(temp);
    return (
      (((normal * refCond.p) / (AirDemand.baro(alt) - vapor)) * (temp + AirDemand.KELVIN)) /
      (refCond.t + AirDemand.KELVIN)
    );
  }

  static _units(input) {
    return input.units
      .filter(unit => unit.kind === 'compressor')
      .flatMap(unit => Array.from({ length: unit.qty }, () => unit));
  }

  /** Потребность в воздухе: пересчёт в FAD, запас, сравнение с компрессорами; ответ — {sum, need}. */
  static run(note, input) {
    const req = input.req;
    note.section('air', 'Производительность');
    if (!(req.flow > 0)) {
      ReserveCheck.check(note, req, AirDemand._units(input).length, 'comp');
      note.issue('info', 'Производительность станции не задана — расчёт по потребности не выполнен.');
      note.ask(
        'Требуемая производительность станции, м³/мин, и к каким условиям она приведена (FAD — условия всасывания или нормальные м³).',
      );
      return null;
    }
    const alt = req.alt != null ? req.alt : 0;
    const tAir = SummerTemp.of(req.tmax);
    if (req.alt == null) {
      note.assume('Высота над уровнем моря в ТЗ не указана — принято 0 м.');
      note.ask('Высота площадки над уровнем моря, м.', true);
    }
    if (req.tmax == null) {
      // одна строка «требует подтверждения» на правило: осушитель и вентиляция ссылаются на него же
      note.missing(
        SummerTemp.RULE,
        `Наружная температура летом не задана — для расчёта принята ${CalcNote.fmt(tAir, 0)} °C`,
        'Максимальная температура наружного воздуха на площадке (летом), °C.',
      );
      note.rule(SummerTemp.RULE);
    }
    const demand = AirDemand.REF[req.basis] ? AirDemand._toFad(note, req, alt, tAir) : AirDemand._asFad(note, req.flow);
    note.rule('flow.fad_ref');
    const need = AirDemand.need(note, input, demand);
    const comps = AirDemand._units(input)
      .map(unit => ({ u: unit, v: unit.info.flow || 0 }))
      .sort((first, second) => second.v - first.v);
    if (!comps.length) {
      note.issue('error', 'В составе нет компрессоров.');
      return { need, Q: demand };
    }
    const out = AirDemand.compare(note, req, comps, need);
    if (!out) return { need, Q: demand };
    AirDemand.motor(note, req, alt);
    return { need, Q: demand, ...out };
  }

  static _asFad(note, demand) {
    note.step({
      what: 'Потребность — FAD (приведена к условиям всасывания, ISO 1217)',
      data: [['Q', `${CalcNote.fmt(demand)} м³/мин`]],
      rules: ['flow.fad_ref'],
      result: `Qfad = ${CalcNote.fmt(demand)} м³/мин`,
    });
    return demand;
  }

  static _toFad(note, req, alt, tAir) {
    const basis = req.basis;
    const basisUnit = AirDemand.unit(basis);
    const std = basis === 'std';
    const rid = std && StationRules.opt('flow.standard') ? 'flow.standard' : 'flow.normal';
    const refTemp = AirDemand.ref(basis).t;
    const humidity = req.rh != null ? req.rh : 100;
    if (req.rh == null)
      note.assume(`Влажность воздуха не указана — для перевода ${basisUnit} в FAD принято 100 % (с запасом).`);
    note.rule(rid);
    note.rule('flow.isa');
    note.rule('flow.psat');
    const baro = AirDemand.baro(alt);
    const psat = AirDemand.psat(tAir);
    const fad = AirDemand.fad(req.flow, alt, tAir, humidity, basis);
    const sym = std ? 'ст' : 'н';
    note.step({
      what: `Потребность в ${std ? 'стандартных' : 'нормальных'} м³ → FAD (условия всасывания)`,
      formula: `Qfad = Q${sym} · 101,325 / (pб − φ·pн.п) · (273,15 + t) / ${CalcNote.fmt(273.15 + refTemp, 2)}`,
      data: [
        [`Q${sym}`, `${CalcNote.fmt(req.flow)} ${basisUnit}/мин`],
        ['высота', `${CalcNote.fmt(alt, 0)} м → pб = ${CalcNote.fmt(baro, 3)} кПа`],
        ['t всасывания', `${CalcNote.fmt(tAir, 0)} °C`],
        ['φ', `${CalcNote.fmt(humidity, 0)} % → pн.п = ${CalcNote.fmt(psat, 3)} кПа`],
      ],
      rules: [rid, 'flow.isa', 'flow.psat'],
      result: `Qfad = ${CalcNote.fmt(fad)} м³/мин`,
    });
    return fad;
  }

  /** Запас — по ТЗ (нормами РФ не установлен); продувка адсорбционного осушителя. */
  static need(note, input, demand) {
    const req = input.req;
    const marginRule = note.rule('flow.margin');
    const margin = req.margin != null ? req.margin : marginRule.default;
    if (req.margin == null) {
      note.missing(
        'flow.margin.tz',
        `Запас производительности в ТЗ не задан — принят ${CalcNote.fmt(margin, 0)} % (нормами РФ не установлен)`,
        'Нужен ли запас производительности сверх потребности (утечки, развитие производства), %?',
      );
    }
    const ads = input.units.filter(unit => unit.kind === 'dryer' && unit.info.type === 'ads');
    const regen = ads.length ? String(ads[0].attrs.regen || '') : '';
    let sum = 0;
    if (ads.length) {
      note.rule('flow.purge');
      sum = AirChain.purge(regen);
    }
    const need = (demand * (1 + margin / 100)) / (1 - sum);
    note.step({
      what: 'Требуемая производительность рабочих компрессоров',
      formula: 'Qтр = Qfad · (1 + запас) / (1 − продувка)',
      data: [
        ['Qfad', `${CalcNote.fmt(demand)} м³/мин`],
        ['запас', `${CalcNote.fmt(margin, 1)} %${req.margin == null ? ' (не задан в ТЗ)' : ' (ТЗ)'}`],
        [
          'продувка осушителя',
          ads.length
            ? `${CalcNote.fmt(sum * 100, 0)} % (${regen || 'тип регенерации не указан'})`
            : 'нет адсорбционного осушителя',
        ],
      ],
      rules: ['flow.margin', ads.length ? 'flow.purge' : ''],
      result: `Qтр = ${CalcNote.fmt(need)} м³/мин`,
    });
    return need;
  }

  /** Рабочие против требуемой; резервные — самые крупные; без производительности — предупреждение. */
  static compare(note, req, comps, need) {
    const res = ReserveCheck.check(note, req, comps.length, 'comp');
    const work = comps.slice(res);
    const spare = comps.slice(0, res);
    const sum = work.reduce((first, entry) => first + entry.v, 0);
    if (req.reserve == null) {
      note.rule('flow.reserve');
      note.missing(
        'flow.reserve.tz',
        'Резерв компрессоров в ТЗ не задан — расчёт без резерва',
        'Нужен ли резервный компрессор (N+1)?',
      );
    }
    const unknown = [...new Set(comps.filter(entry => !(entry.v > 0)).map(entry => entry.u.name))];
    if (unknown.length) {
      note.missing('comp.flow', `Нет производительности: ${unknown.join(', ')}`);
      for (const name of unknown)
        note.issue(
          'warn',
          `У «${name}» в карточке не указана производительность — по нему проверка не выполнена; заполните карточку оборудования.`,
        );
    }
    if (!work.some(entry => entry.v > 0)) return null;
    const fit = note.fits(sum, need);
    note.step({
      what: 'Компрессоры: рабочие против требуемой',
      formula: 'Σ Qраб ≥ Qтр',
      data: [
        ['рабочих', `${work.length} шт.`],
        ['резервных', `${res} шт.${res ? ' (самые крупные — не учитываются)' : ''}`],
        ...work.slice(0, 6).map((entry, i) => [`№ ${i + 1}`, `${entry.u.name} — ${CalcNote.fmt(entry.v)} м³/мин`]),
      ],
      result: `Σ Qраб = ${CalcNote.fmt(sum)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(sum, need),
      note: fit.note,
      rules: fit.edge ? ['calc.tolerance'] : [],
      pick: [...new Set(comps.map(entry => entry.u.name))].join('; '),
    });
    if (!fit.ok)
      note.issue(
        'error',
        `Производительность рабочих компрессоров ${CalcNote.fmt(sum)} м³/мин меньше требуемой ${CalcNote.fmt(need)} м³/мин.`,
      );
    if (res) AirDemand._reserve(note, work, spare, res);
    return { sum, work, res };
  }

  static _reserve(note, work, spare, res) {
    const big = work.length ? work[0].v : 0;
    const low = spare.filter(entry => entry.v < big - 1e-9);
    note.step({
      what: 'Резерв',
      formula: 'резервный не меньше самого крупного рабочего',
      rules: ['flow.reserve'],
      data: spare.map(entry => ['резервный', `${entry.u.name} — ${CalcNote.fmt(entry.v)} м³/мин`]),
      ok: !low.length,
      result: low.length ? 'резервный меньше рабочего' : `N + ${res}`,
    });
    if (low.length)
      note.issue(
        'error',
        'Резервный компрессор меньше самого крупного рабочего — при его отказе станция не обеспечит потребность.',
      );
  }

  /** Электродвигатель на высоте и в жару — снижение мощности по данным изготовителя. */
  static motor(note, req, alt) {
    const motorAlt = note.rule('flow.motor_alt');
    const hot = req.tmax != null && req.tmax > motorAlt.t;
    if (alt <= motorAlt.h && !hot) return;
    const why = [
      alt > motorAlt.h ? `высота ${CalcNote.fmt(alt, 0)} м` : '',
      hot ? `до +${CalcNote.fmt(req.tmax, 0)} °C` : '',
    ]
      .filter(Boolean)
      .join(', ');
    note.issue(
      'warn',
      `Условия выше номинальных для электродвигателя (до ${motorAlt.h} м и +${motorAlt.t} °C): ${why} — снижение мощности по данным изготовителя.`,
    );
    note.missing(
      'motor.derate',
      'Снижение мощности двигателей компрессоров на высоте / в жару — по данным изготовителя',
    );
  }
}
