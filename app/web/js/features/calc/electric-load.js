import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const STARTS = [
  [/частот|чрп|vsd|преобразовател/, 'vsd'],
  [/звезд|треуг|y\s*\/\s*[dδ]|star/, 'stardelta'],
  [/плавн|soft/, 'soft'],
  [/прям/, 'direct'],
];
const START_NAME = {
  direct: 'прямой',
  stardelta: 'звезда — треугольник',
  soft: 'плавный пуск',
  vsd: 'частотный преобразователь',
};
const motorKw = u => CalcInput.num(u.attrs.kw);

/** Электропитание: мощность и ток станции, пуск наибольшего двигателя. */
export class ElectricLoad {
  /** Способ пуска: частотный — по полю vsd; иначе по строке «пуск» каталога; не указан — ''. */
  static start(u) {
    if (u.info && u.info.vsd) return 'vsd';
    const r = (u.rows || []).find(
      x => x && /^(?:тип|способ|система)\s+(?:за)?пуска|^пуск$/i.test(String(x.k || '').trim()),
    );
    const t = r ? String(r.v || '').toLowerCase() : '';
    const hit = STARTS.find(([re]) => re.test(t));
    return hit ? hit[1] : '';
  }

  static run(N, q, plan) {
    const W = plan && plan.power;
    N.section('el', 'Электропитание');
    const noKw = new Set(q.units.filter(u => /^(compressor|pump)$/.test(u.kind) && !(motorKw(u) > 0)).map(u => u.name));
    for (const nm of noKw)
      N.issue(
        'warn',
        `У «${nm}» в карточке не указана мощность двигателя — в электрическую нагрузку станции не вошёл; заполните карточку.`,
      );
    if (W) ElectricLoad.total(N, W);
    N.rule('el.breaker_k');
    const M = q.units.filter(u => (u.kind === 'compressor' || u.kind === 'pump') && motorKw(u) > 0);
    return M.length ? ElectricLoad.starting(N, M, W) : null;
  }

  static total(N, W) {
    N.step({
      what: 'Мощность и ток станции',
      formula: 'P = Σ P_двиг / η + Σ P_прочих; I = P / (√3 · U · cos φ)',
      rules: ['el.u', 'el.cos', 'el.eta', 'el.breaker_k'],
      data: [
        ['установленная', `${f(W.inst, 1)} кВт`],
        ['расчётная (из сети)', `${f(W.kw, 1)} кВт (${W.mode === 'run' ? 'работа' : 'простой зимой'})`],
        ['η двигателей', f(N.rule('el.eta'), 2)],
        ['U', `${N.rule('el.u')} В`],
        ['cos φ', f(N.rule('el.cos'))],
      ],
      result: `I = ${f(W.amp, 1)} А; вводной автомат ${W.breaker ? `${W.breaker} А` : 'по проекту'}`,
      ok: null,
    });
  }

  /** Пуск наибольшего двигателя: Iном = P / (√3 · U · cos φ · η); Iпуск = k · Iном. */
  static starting(N, M, W) {
    const big = M.reduce((m, u) => (motorKw(u) > motorKw(m) ? u : m), M[0]);
    const kw = motorKw(big);
    const K = N.rule('el.start');
    const how = ElectricLoad.start(big);
    const k = how ? K[how] : K.default;
    const U = N.rule('el.u');
    const cos = N.rule('el.cos');
    const eta = N.rule('el.eta');
    if (!how)
      N.missing(
        `start.${big.name}`,
        `Способ пуска «${big.name}» в каталоге не указан — принят прямой пуск (с запасом)`,
      );
    const In = (kw * 1000) / (Math.sqrt(3) * U * cos * eta);
    const Ist = k * In;
    const peak = (W ? W.amp : In) - In + Ist;
    const Sst = (Math.sqrt(3) * U * Ist) / 1000;
    N.step({
      what: `Пуск наибольшего двигателя: ${big.name}`,
      formula: 'Iном = P / (√3 · U · cos φ · η); Iпуск = k · Iном',
      rules: ['el.start', 'el.eta'],
      data: [
        ['P', `${f(kw, 1)} кВт`],
        ['способ пуска', START_NAME[how || 'direct'] + (how ? '' : ' (принят)')],
        ['k', f(k, 1)],
      ],
      result: `Iном ≈ ${f(In, 0)} А; Iпуск ≈ ${f(Ist, 0)} А; пик при пуске (остальные работают) ≈ ${f(peak, 0)} А; Sпуск ≈ ${f(Sst, 0)} кВА`,
      ok: null,
    });
    return { kw, how: how || 'direct', In, Ist, Sst, peak };
  }
}
