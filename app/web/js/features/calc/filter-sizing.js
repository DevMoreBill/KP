import { AirChain } from '../layout/air-chain.js';
import { CalcNote } from './calc-note.js';
import { DryerSizing } from './dryer-sizing.js';

const f = CalcNote.f;
const grades = G => G.map(g => AirChain.GRADES[g].short).join(' или ');

/** Фильтры: поправка производительности на давление (серия производителя или типовая формула), ступени по классу ISO 8573-1. */
export class FilterSizing {
  static run(N, q, A, P) {
    const Fl = q.units.filter(u => u.kind === 'filter' && u.info.grade !== 'cond');
    if (!Fl.length && !q.cls) return;
    N.section('filter', 'Фильтры');
    const Q = A && A.sum > 0 ? A.sum : null;
    const p = DryerSizing.pressure(q.req, P, () => 7);
    if (Q) for (const u of Fl) FilterSizing.one(N, u, Q, p);
    const cls = String(q.cls || '').match(/^([1-6])\.([1-6])\.([1-4])$/);
    if (cls) FilterSizing.stages(N, q, Fl, cls);
    else if (Fl.length)
      N.ask('Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1 (частицы.вода.масло) или требуемая точка росы.', true);
  }

  static one(N, u, Q, p) {
    const cap = (u.info.flow || 0) * u.qty;
    if (!(cap > 0)) {
      N.missing(`filter.flow.${u.name}`, `Нет производительности фильтра ${u.name}`);
      return;
    }
    const { k, data, rules } = FilterSizing.factor(N, u, p);
    const corr = cap * k;
    const fit = N.fits(corr, Q);
    if (fit.edge) rules.push('calc.tolerance');
    const grade = AirChain.GRADES[u.info.grade] ? AirChain.GRADES[u.info.grade].short : 'ступень не определена';
    N.step({
      what: `${u.name}${u.qty > 1 ? ` × ${u.qty} (параллельно)` : ''} — ${grade}`,
      formula: 'Qф · Kp ≥ Σ Qраб',
      data: [['номинал', `${f(cap)} м³/мин`], ...data, ['через фильтр', `${f(Q)} м³/мин`]],
      rules,
      result: `с поправкой ${f(corr)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(corr, Q),
      note: fit.note,
      pick: u.name,
    });
    if (!fit.ok)
      N.issue(
        'error',
        `${CalcNote.lbl('Фильтр', u.name)}: с поправкой на давление ${f(corr)} м³/мин — меньше ${f(Q)} м³/мин.`,
      );
    if (!u.info.grade) N.missing(`filter.grade.${u.name}`, `Ступень очистки фильтра не определена: ${u.name}`);
  }

  static factor(N, u, p) {
    const s = StationRules.series(u.p, 'filter');
    if (s) {
      const o = DryerSizing.k(s.f.p, p);
      if (o.out) N.issue('warn', `${CalcNote.lbl('Фильтр', u.name)}: давление вне таблицы производителя.`);
      return {
        k: o.k,
        rules: [],
        data: [
          ['давление', `${f(p, 1)} бар → ${f(o.k, 3)}`],
          ['источник', [s.source.doc, s.source.item].filter(Boolean).join(', ')],
        ],
      };
    }
    const k = AirChain.kf(p);
    const a = u.attrs;
    const model = a.series || a.model || u.name;
    N.rule('filter.kp');
    N.missing(
      `series.filter.${a.maker || ''}.${model}`,
      `Данные для расчёта неполные: поправки производителя для фильтров «${[a.maker, model].filter(Boolean).join(' ')}» не найдены — типовая формула`,
    );
    return { k, rules: ['filter.kp'], data: [['давление', `${f(p, 1)} бар → ${f(k, 3)} (типовая формула)`]] };
  }

  /** Ступени по классу: частицы и масло класса 1–2, пары масла класса 1, пылевой после адсорбционного осушителя. */
  static stages(N, q, Fl, cls) {
    const R = N.rule('air.chain');
    const [pc, oc] = [+cls[1], +cls[3]];
    const have = new Set(Fl.map(u => u.info.grade));
    const lvl = Math.min(pc, oc);
    const need = [];
    if (lvl === 1 || lvl === 2) need.push([`частицы / масло класса ${lvl}`, R[String(lvl)]]);
    if (oc === 1) need.push(['масло класса 1 (пары)', R.oil1]);
    if (q.units.some(u => u.kind === 'dryer' && u.info.type === 'ads'))
      need.push(['после адсорбционного осушителя', R.afterAds]);
    const oilFree = q.units.filter(u => u.kind === 'compressor').every(u => FilterSizing.oilFree(u));
    for (const [why, G] of need) {
      const ok = G.some(g => have.has(g));
      const vapour = G === R.oil1 && oilFree;
      N.step({
        what: `Ступень очистки: ${why}`,
        formula: `в составе есть: ${grades(G)}`,
        rules: ['air.chain'],
        ok,
        result: ok ? 'есть' : 'нет',
      });
      if (!ok) {
        const note = vapour ? '; компрессоры безмасляные — по анализу всасываемого воздуха' : '';
        N.issue(
          why.startsWith('после') || vapour ? 'warn' : 'error',
          `Класс ${q.cls}: нет фильтра ${grades(G)} (${why}${note}).`,
        );
      }
    }
  }

  /** Безмасляный компрессор: пары масла — только из всасываемого воздуха, угольный фильтр — по анализу воздуха. */
  static oilFree(u) {
    if (/^(да|есть|true)$/i.test(String(u.attrs.oilFree ?? ''))) return true;
    return typeof TzPick !== 'undefined' && TzPick.oilFree({ name: u.name, attrs: u.attrs });
  }
}
