import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

/** Электропитание: мощность и ток станции, пуск наибольшего двигателя. */
export class ElectricLoad {
  static STARTS = [
    [/частот|чрп|vsd|преобразовател/, 'vsd'],
    [/звезд|треуг|y\s*\/\s*[dδ]|star/, 'stardelta'],
    [/плавн|soft/, 'soft'],
    [/прям/, 'direct'],
  ];
  static START_NAME = {
    direct: 'прямой',
    stardelta: 'звезда — треугольник',
    soft: 'плавный пуск',
    vsd: 'частотный преобразователь',
  };
  static _motorKw = unit => CalcInput.num(unit.attrs.kw);
  /** Способ пуска: частотный — по полю vsd; иначе по строке «пуск» каталога; не указан — ''. */
  static start(unit) {
    if (unit.info && unit.info.vsd) return 'vsd';
    const row = (unit.rows || []).find(
      station => station && /^(?:тип|способ|система)\s+(?:за)?пуска|^пуск$/i.test(String(station.k || '').trim()),
    );
    const text = row ? String(row.v || '').toLowerCase() : '';
    const hit = ElectricLoad.STARTS.find(([pattern]) => pattern.test(text));
    return hit ? hit[1] : '';
  }

  /** Электропитание станции: мощность, ток, вводной автомат, пуск наибольшего двигателя. */
  static run(note, input, plan) {
    const power = plan && plan.power;
    note.section('el', 'Электропитание');
    const noKw = new Set(
      input.units
        .filter(unit => /^(compressor|pump)$/.test(unit.kind) && !(ElectricLoad._motorKw(unit) > 0))
        .map(unit => unit.name),
    );
    for (const unitName of noKw)
      note.issue(
        'warn',
        `У «${unitName}» в карточке не указана мощность двигателя — в электрическую нагрузку станции не вошёл; заполните карточку.`,
      );
    if (power) ElectricLoad._total(note, power);
    note.rule('el.breaker_k');
    const motors = input.units.filter(
      unit => (unit.kind === 'compressor' || unit.kind === 'pump') && ElectricLoad._motorKw(unit) > 0,
    );
    return motors.length ? ElectricLoad.starting(note, motors, power) : null;
  }

  static _total(note, power) {
    note.step({
      what: 'Мощность и ток станции',
      formula: 'P = Σ P_двиг / η + Σ P_прочих; I = P / (√3 · U · cos φ)',
      rules: ['el.u', 'el.cos', 'el.eta', 'el.breaker_k'],
      data: [
        ['установленная', `${CalcNote.fmt(power.inst, 1)} кВт`],
        [
          'расчётная (из сети)',
          `${CalcNote.fmt(power.kw, 1)} кВт (${power.mode === 'run' ? 'работа' : 'простой зимой'})`,
        ],
        ['η двигателей', CalcNote.fmt(note.rule('el.eta'), 2)],
        ['U', `${note.rule('el.u')} В`],
        ['cos φ', CalcNote.fmt(note.rule('el.cos'))],
      ],
      result: `I = ${CalcNote.fmt(power.amp, 1)} А; вводной автомат ${power.breaker ? `${power.breaker} А` : 'по проекту'}`,
      ok: null,
    });
  }

  /** Пуск наибольшего двигателя: Iном = P / (√3 · U · cos φ · η); Iпуск = k · Iном. */
  static starting(note, motors, power) {
    const big = motors.reduce(
      (motor, unit) => (ElectricLoad._motorKw(unit) > ElectricLoad._motorKw(motor) ? unit : motor),
      motors[0],
    );
    const kw = ElectricLoad._motorKw(big);
    const startRule = note.rule('el.start');
    const how = ElectricLoad.start(big);
    const k = how ? startRule[how] : startRule.default;
    const voltage = note.rule('el.u');
    const cos = note.rule('el.cos');
    const eta = note.rule('el.eta');
    if (!how)
      note.missing(
        `start.${big.name}`,
        `Способ пуска «${big.name}» в каталоге не указан — принят прямой пуск (с запасом)`,
      );
    const current = (kw * 1000) / (Math.sqrt(3) * voltage * cos * eta);
    const Ist = k * current;
    const peak = (power ? power.amp : current) - current + Ist;
    const Sst = (Math.sqrt(3) * voltage * Ist) / 1000;
    note.step({
      what: `Пуск наибольшего двигателя: ${big.name}`,
      formula: 'Iном = P / (√3 · U · cos φ · η); Iпуск = k · Iном',
      rules: ['el.start', 'el.eta'],
      data: [
        ['P', `${CalcNote.fmt(kw, 1)} кВт`],
        ['способ пуска', ElectricLoad.START_NAME[how || 'direct'] + (how ? '' : ' (принят)')],
        ['k', CalcNote.fmt(k, 1)],
      ],
      result: `Iном ≈ ${CalcNote.fmt(current, 0)} А; Iпуск ≈ ${CalcNote.fmt(Ist, 0)} А; пик при пуске (остальные работают) ≈ ${CalcNote.fmt(peak, 0)} А; Sпуск ≈ ${CalcNote.fmt(Sst, 0)} кВА`,
      ok: null,
    });
    return { kw, how: how || 'direct', In: current, Ist, Sst, peak };
  }
}
