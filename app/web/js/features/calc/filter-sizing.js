import { AirChain } from '../layout/air-chain.js';
import { CalcNote } from './calc-note.js';
import { DryerSizing } from './dryer-sizing.js';
import { DryerDerate } from '../layout/dryer-derate.js';
import { TzPick } from '../tz/tz-pick.js';
import { StationRules } from '../rules/station-rules.js';

/** Фильтры: поправка производительности на давление (серия производителя или типовая формула), ступени по классу ISO 8573-1. */
export class FilterSizing {
  static _grades = grades => grades.map(grade => AirChain.GRADES[grade].short).join(' или ');
  /** Фильтры: производительность с поправкой на давление и ступени по классу воздуха. */
  static run(note, input, air, budget) {
    const filters = input.units.filter(unit => unit.kind === 'filter' && unit.info.grade !== 'cond');
    if (!filters.length && !input.cls) return;
    note.section('filter', 'Фильтры');
    const demand = air && air.sum > 0 ? air.sum : null;
    const pressure = DryerSizing.pressure(input.req, budget, () => 7);
    if (demand) for (const unit of filters) FilterSizing._one(note, unit, demand, pressure);
    const cls = String(input.cls || '').match(/^([1-6])\.([1-6])\.([1-4])$/);
    if (cls) FilterSizing.stages(note, input, filters, cls);
    else if (filters.length)
      note.ask(
        'Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1 (частицы.вода.масло) или требуемая точка росы.',
        true,
      );
  }

  static _one(note, unit, demand, pressure) {
    const cap = (unit.info.flow || 0) * unit.qty;
    if (!(cap > 0)) {
      note.missing(`filter.flow.${unit.name}`, `Нет производительности фильтра ${unit.name}`);
      return;
    }
    const { k, data, rules } = FilterSizing._factor(note, unit, pressure);
    const corr = cap * k;
    const fit = note.fits(corr, demand);
    if (fit.edge) rules.push('calc.tolerance');
    const grade = AirChain.GRADES[unit.info.grade] ? AirChain.GRADES[unit.info.grade].short : 'ступень не определена';
    note.step({
      what: `${unit.name}${unit.qty > 1 ? ` × ${unit.qty} (параллельно)` : ''} — ${grade}`,
      formula: 'Qф · Kp ≥ Σ Qраб',
      data: [['номинал', `${CalcNote.fmt(cap)} м³/мин`], ...data, ['через фильтр', `${CalcNote.fmt(demand)} м³/мин`]],
      rules,
      result: `с поправкой ${CalcNote.fmt(corr)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(corr, demand),
      note: fit.note,
      pick: unit.name,
    });
    if (!fit.ok)
      note.issue(
        'error',
        `${CalcNote.lbl('Фильтр', unit.name)}: с поправкой на давление ${CalcNote.fmt(corr)} м³/мин — меньше ${CalcNote.fmt(demand)} м³/мин.`,
      );
    if (!unit.info.grade)
      note.missing(`filter.grade.${unit.name}`, `Ступень очистки фильтра не определена: ${unit.name}`);
  }

  static _factor(note, unit, pressure) {
    const series = StationRules.series(unit.p, 'filter');
    if (series) {
      const kPress = DryerDerate.k(series.f.p, pressure);
      if (kPress.out) note.issue('warn', `${CalcNote.lbl('Фильтр', unit.name)}: давление вне таблицы производителя.`);
      return {
        k: kPress.k,
        rules: [],
        data: [
          ['давление', `${CalcNote.fmt(pressure, 1)} бар → ${CalcNote.fmt(kPress.k, 3)}`],
          ['источник', [series.source.doc, series.source.item].filter(Boolean).join(', ')],
        ],
      };
    }
    const k = AirChain.filterK(pressure);
    const attrs = unit.attrs;
    const model = attrs.series || attrs.model || unit.name;
    note.rule('filter.kp');
    note.missing(
      `series.filter.${attrs.maker || ''}.${model}`,
      `Данные для расчёта неполные: поправки производителя для фильтров «${[attrs.maker, model].filter(Boolean).join(' ')}» не найдены — типовая формула`,
    );
    return {
      k,
      rules: ['filter.kp'],
      data: [['давление', `${CalcNote.fmt(pressure, 1)} бар → ${CalcNote.fmt(k, 3)} (типовая формула)`]],
    };
  }

  /** Ступени по классу: частицы и масло класса 1–2, пары масла класса 1, пылевой после адсорбционного осушителя. */
  static stages(calcNote, input, filters, cls) {
    const chain = calcNote.rule('air.chain');
    const [particleClass, oilClass] = [+cls[1], +cls[3]];
    const have = new Set(filters.map(unit => unit.info.grade));
    const lvl = Math.min(particleClass, oilClass);
    const need = [];
    if (lvl === 1 || lvl === 2) need.push([`частицы / масло класса ${lvl}`, chain[String(lvl)]]);
    if (oilClass === 1) need.push(['масло класса 1 (пары)', chain.oil1]);
    if (input.units.some(unit => unit.kind === 'dryer' && unit.info.type === 'ads'))
      need.push(['после адсорбционного осушителя', chain.afterAds]);
    const oilFree = input.units.filter(unit => unit.kind === 'compressor').every(unit => FilterSizing.oilFree(unit));
    for (const [why, grades] of need) {
      const ok = grades.some(grade => have.has(grade));
      const vapour = grades === chain.oil1 && oilFree;
      calcNote.step({
        what: `Ступень очистки: ${why}`,
        formula: `в составе есть: ${FilterSizing._grades(grades)}`,
        rules: ['air.chain'],
        ok,
        result: ok ? 'есть' : 'нет',
      });
      if (!ok) {
        const note = vapour ? '; компрессоры безмасляные — по анализу всасываемого воздуха' : '';
        calcNote.issue(
          why.startsWith('после') || vapour ? 'warn' : 'error',
          `Класс ${input.cls}: нет фильтра ${FilterSizing._grades(grades)} (${why}${note}).`,
        );
      }
    }
  }

  /** Безмасляный компрессор: пары масла — только из всасываемого воздуха, угольный фильтр — по анализу воздуха. */
  static oilFree(unit) {
    if (/^(да|есть|true)$/i.test(String(unit.attrs.oilFree ?? ''))) return true;
    return TzPick.oilFree({ name: unit.name, attrs: unit.attrs });
  }
}
