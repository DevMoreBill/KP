import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;

/** Давление: у потребителя + потери на фильтрах, осушителях и трубах → давление компрессора; аппараты — не ниже. */
export class PressureBudget {
  static run(N, q) {
    const r = q.req;
    N.section('press', 'Давление');
    const C = q.units.filter(u => u.kind === 'compressor');
    if (!C.length) return null;
    const pmax = Math.min(...C.map(u => u.info.bar || Infinity));
    const vsd = C.every(u => u.info.vsd);
    if (!Number.isFinite(pmax)) {
      N.missing('comp.bar', 'Нет рабочего давления компрессора');
      return null;
    }
    const { loss, data, rules, lp } = PressureBudget.losses(N, q);
    if (!(r.pressure > 0)) {
      N.issue('info', 'Давление у потребителя не задано — проверка давления не выполнена.');
      N.ask('Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.');
      return { pmax, loss, pOp: Math.max(1, pmax - (vsd ? 0 : StationRules.raw('pressure.band')) - loss) };
    }
    const need = r.pressure + loss;
    N.step({
      what: 'Требуемое давление компрессора',
      formula: 'pтр = pпотр + Σ Δp',
      data: [['pпотр', `${f(r.pressure)} бар`], ...data],
      rules,
      result: `pтр = ${f(need)} бар`,
    });
    PressureBudget.compressor(N, { pmax, vsd, need, r, loss });
    for (const u of q.units.filter(o => /^(receiver|dryer|filter)$/.test(o.kind))) {
      const b = u.info.bar || CalcInput.num(u.attrs.pressure);
      if (b > 0 && b < pmax - 1e-9)
        N.issue(
          'error',
          `${u.name}: рассчитан на ${f(b)} бар — меньше наибольшего давления компрессора ${f(pmax)} бар.`,
        );
    }
    return { pmax, loss, need, pOp: r.pressure + lp };
  }

  /** Потери: по паспорту, иначе по правилу; трубопровод станции. */
  static losses(N, q) {
    let loss = 0;
    const data = [];
    const rules = [];
    const add = (u, d, rid, ruleV) => {
      const v = d != null ? d : ruleV();
      if (d == null) rules.push(rid);
      loss += v;
      data.push([u.name, `${f(v)} бар (${d != null ? 'паспорт' : 'правило'})`]);
    };
    for (const u of q.units.filter(o => o.kind === 'filter' && o.info.grade !== 'cond'))
      add(u, CalcInput.dp(u), 'loss.filter', () => N.rule('loss.filter'));
    for (const u of q.units.filter(o => o.kind === 'dryer'))
      add(u, CalcInput.dp(u), 'loss.dryer', () => N.rule('loss.dryer')[u.info.type === 'ads' ? 'ads' : 'refrig']);
    const lp = N.rule('loss.pipe');
    loss += lp;
    data.push(['трубопровод станции', `${f(lp)} бар`]);
    rules.push('loss.pipe');
    return { loss, data, rules, lp };
  }

  /** Частотный — по наибольшему давлению; «нагрузка — холостой ход» — по давлению включения. */
  static compressor(N, { pmax, vsd, need, r, loss }) {
    const band = vsd ? 0 : N.rule('pressure.band');
    const low = pmax - band;
    const ok = low >= need - 1e-9;
    N.step({
      what: vsd
        ? 'Компрессоры с частотным регулированием: давление поддержания'
        : 'Компрессоры «нагрузка — холостой ход»: давление включения',
      formula: vsd ? 'pmax ≥ pтр' : 'pmax − Δpрег ≥ pтр',
      data: [['pmax (паспорт)', `${f(pmax)} бар`], ...(vsd ? [] : [['Δpрег', `${f(band)} бар`]])],
      rules: vsd ? [] : ['pressure.band'],
      result: `${vsd ? 'pmax = ' : 'pвкл = '}${f(low)} бар`,
      ok,
      margin: CalcNote.pct(low, need),
    });
    if (!N.fits(pmax, need).ok) {
      N.issue(
        'error',
        `Компрессор на ${f(pmax)} бар не обеспечит ${f(r.pressure)} бар у потребителя с потерями ${f(loss)} бар (нужно ${f(need)}).`,
      );
    } else if (!ok) {
      N.issue(
        'warn',
        `В нижней точке регулирования (${f(low)} бар) давление ниже требуемого ${f(need)} бар — сузьте диапазон регулирования или выберите компрессор на большее давление.`,
      );
    }
  }
}
