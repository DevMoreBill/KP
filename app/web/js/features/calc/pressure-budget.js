import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';
import { DryerDerate } from '../layout/dryer-derate.js';

/** Давление: у потребителя + потери на фильтрах, осушителях и трубах → давление компрессора; аппараты — не ниже. */
export class PressureBudget {
  /** Давление: потери в подготовке воздуха и запас компрессора. */
  static run(note, input) {
    const req = input.req;
    note.section('press', 'Давление');
    const comps = input.units.filter(unit => unit.kind === 'compressor');
    if (!comps.length) return null;
    const pmax = Math.min(...comps.map(unit => unit.info.bar || Infinity));
    const vsd = comps.every(unit => unit.info.vsd);
    if (!Number.isFinite(pmax)) {
      note.missing('comp.bar', 'Нет рабочего давления компрессора');
      return null;
    }
    const { loss, data, rules } = PressureBudget.losses(note, input);
    if (!(req.pressure > 0)) {
      note.issue('info', 'Давление у потребителя не задано — проверка давления не выполнена.');
      note.ask('Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.');
      return { pmax, loss, pOp: DryerDerate.bar({ pressure: null, pmax, vsd, loss }) };
    }
    const need = req.pressure + loss;
    note.step({
      what: 'Требуемое давление компрессора',
      formula: 'pтр = pпотр + Σ Δp',
      data: [['pпотр', `${CalcNote.fmt(req.pressure)} бар`], ...data],
      rules,
      result: `pтр = ${CalcNote.fmt(need)} бар`,
    });
    PressureBudget.compressor(note, { pmax, vsd, need, r: req, loss });
    for (const unit of input.units.filter(entry => /^(receiver|dryer|filter)$/.test(entry.kind))) {
      const bar = unit.info.bar || CalcInput.num(unit.attrs.pressure);
      if (bar > 0 && bar < pmax - 1e-9)
        note.issue(
          'error',
          `${unit.name}: рассчитан на ${CalcNote.fmt(bar)} бар — меньше наибольшего давления компрессора ${CalcNote.fmt(pmax)} бар.`,
        );
    }
    return { pmax, loss, need, pOp: DryerDerate.bar({ pressure: req.pressure, pmax, vsd, loss }) };
  }

  /** Потери: по паспорту, иначе по правилу; трубопровод станции. */
  static losses(note, input) {
    let loss = 0;
    const data = [];
    const rules = [];
    for (const unit of DryerDerate.lossUnits(input.units)) {
      const drop = DryerDerate.drop(unit);
      if (drop.rule) {
        note.rule(drop.rule);
        rules.push(drop.rule);
      }
      loss += drop.v;
      data.push([unit.name, `${CalcNote.fmt(drop.v)} бар (${drop.rule ? 'правило' : 'паспорт'})`]);
    }
    const pipeLoss = note.rule('loss.pipe');
    loss += pipeLoss;
    data.push(['трубопровод станции', `${CalcNote.fmt(pipeLoss)} бар`]);
    rules.push('loss.pipe');
    return { loss, data, rules };
  }

  /** Частотный — по наибольшему давлению; «нагрузка — холостой ход» — по давлению включения. */
  static compressor(note, { pmax, vsd, need, r: req, loss }) {
    const band = vsd ? 0 : note.rule('pressure.band');
    const low = pmax - band;
    const ok = low >= need - 1e-9;
    note.step({
      what: vsd
        ? 'Компрессоры с частотным регулированием: давление поддержания'
        : 'Компрессоры «нагрузка — холостой ход»: давление включения',
      formula: vsd ? 'pmax ≥ pтр' : 'pmax − Δpрег ≥ pтр',
      data: [['pmax (паспорт)', `${CalcNote.fmt(pmax)} бар`], ...(vsd ? [] : [['Δpрег', `${CalcNote.fmt(band)} бар`]])],
      rules: vsd ? [] : ['pressure.band'],
      result: `${vsd ? 'pmax = ' : 'pвкл = '}${CalcNote.fmt(low)} бар`,
      ok,
      margin: CalcNote.pct(low, need),
    });
    if (!note.fits(pmax, need).ok) {
      note.issue(
        'error',
        `Компрессор на ${CalcNote.fmt(pmax)} бар не обеспечит ${CalcNote.fmt(req.pressure)} бар у потребителя с потерями ${CalcNote.fmt(loss)} бар (нужно ${CalcNote.fmt(need)}).`,
      );
    } else if (!ok) {
      note.issue(
        'warn',
        `В нижней точке регулирования (${CalcNote.fmt(low)} бар) давление ниже требуемого ${CalcNote.fmt(need)} бар — сузьте диапазон регулирования или выберите компрессор на большее давление.`,
      );
    }
  }
}
