import { AirChain } from '../layout/air-chain.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

/** ДГУ: мощность PRP/ESP против нагрузки, средняя и малая нагрузка, высота и жара, пуск двигателя, топливо. */
export class GensetSizing {
  static LOAD_MAX = 1.1; // нагрузка с кратковременной перегрузкой 10 %
  static _each = units => units.flatMap(unit => Array.from({ length: unit.qty }, () => unit));
  static _prp = unit => CalcInput.num(unit.attrs.kw) || 0;
  static _tankVol = unit => AirChain.volume(unit.p) || CalcInput.num(unit.attrs.tank) || 0;
  /** Наибольший бак в отсеке контейнера, л (раздел tank матрицы). */
  static get TANK_MAX() {
    return StationMatrix.tank().max;
  }

  /** Расход топлива при доле нагрузки x, л/ч: строки «При нагрузке N %» / «Расход топлива при N % нагрузки»; нет — null. */
  static fuel(unit, station) {
    const table = [];
    for (const row of unit.rows || []) {
      const match = String((row && row.k) || '').match(/(\d{2,3})\s*%/);
      const value =
        match && /нагрузк/i.test(String(row.k)) && /л\s*\/\s*ч/i.test(`${String(row.k)} ${String(row.v)}`)
          ? AirChain.first(row.v)
          : null;
      if (value > 0) table.push([+match[1] / 100, value]);
    }
    table.sort((first, second) => first[0] - second[0]);
    return table.length >= 2 || (table.length === 1 && Math.abs(table[0][0] - station) < 0.01)
      ? StationRules.interp(table, station)
      : null;
  }

  /** Мощность, кВт: основной источник — PRP; резервный — ESP, нет ESP — PRP (в запас). */
  static cap(attrs, standby) {
    const prp = CalcInput.num((attrs || {}).kw) || 0;
    const esp = CalcInput.num((attrs || {}).kwMax) || 0;
    return standby && esp > 0 ? esp : prp;
  }

  /** Полная мощность генератора, кВА: паспорт, нет — PRP / cos φ ном. */
  static kva(attrs) {
    const k = CalcInput.num((attrs || {}).kva) || 0;
    const prp = CalcInput.num((attrs || {}).kw) || 0;
    if (k > 0) return { v: k, src: 'паспорт' };
    return prp > 0 ? { v: prp / StationRules.raw('dgu.cos'), src: 'по мощности' } : { v: 0, src: '' };
  }

  /** Топливо на автономность: расход рабочих ДГУ при доле нагрузки, с запасом; есть — баки ДГУ и дополнительные. */
  static fuelPlan(input) {
    const req = input.req;
    const gensets = input.units.filter(unit => unit.kind === 'dgu');
    if (!gensets.length || !(req.hours > 0)) return null;
    const units = GensetSizing._each(gensets)
      .map(unit => ({ u: unit, prp: GensetSizing._prp(unit) }))
      .sort((first, second) => second.prp - first.prp);
    const work = units.slice(req.reserve != null ? Math.min(req.reserve, units.length - 1) : 0);
    const PRP = work.reduce((sum, entry) => sum + entry.prp, 0);
    if (!(PRP > 0)) return null;
    const station =
      req.kw > 0
        ? Math.min(GensetSizing.LOAD_MAX, (req.load > 0 ? (req.kw * req.load) / 100 : req.kw) / PRP)
        : StationRules.raw('dgu.fuel_load');
    let lph = 0;
    let src = 'паспорт ДГУ';
    for (const entry of work) {
      const value = GensetSizing.fuel(entry.u, station);
      if (value == null) src = 'удельный расход (правило)';
      lph += value != null ? value : StationRules.raw('dgu.lph') * station * entry.prp;
    }
    const built = gensets.reduce((sum, unit) => sum + GensetSizing.tank(unit) * unit.qty, 0);
    const extra = input.units
      .filter(unit => unit.kind === 'tank')
      .reduce((sum, unit) => sum + GensetSizing._tankVol(unit) * unit.qty, 0);
    return {
      x: station,
      c: lph,
      src,
      n: work.length,
      need: lph * req.hours * StationRules.raw('dgu.fuel_margin'),
      built,
      extra,
      have: built + extra,
    };
  }

  /** Топливо станции ДГУ без записки — для бака и итога подбора. */
  static plan(station) {
    return GensetSizing.fuelPlan(CalcInput.of(station));
  }

  /** Встроенный бак ДГУ по характеристикам, л. */
  static tank(unit) {
    const row = CalcInput.row(
      unit,
      /^(?:встроенн\S*\s+)?топливн\S*\s+бак|объ[её]м\s+(?:топливного\s+)?бака|[её]мкость\s.*бака/i,
      /(?:^|[^а-я])л(?:[^а-я]|$)/i,
    );
    return row ? row.v : CalcInput.num(unit.attrs.tank) || 0;
  }

  /** ДГУ: мощность против нагрузки, условия площадки, пуск двигателя, топливо. */
  static run(note, input, load) {
    const req = input.req;
    const gensets = input.units.filter(unit => unit.kind === 'dgu');
    note.section('dgu', 'ДГУ');
    if (!gensets.length) {
      note.issue('error', 'В составе нет ДГУ.');
      return;
    }
    const standby = /standby|резерв|аварийн/i.test(req.mode || '');
    const units = GensetSizing._each(gensets)
      .map(unit => {
        const k = GensetSizing.kva(unit.attrs);
        return {
          u: unit,
          prp: GensetSizing._prp(unit),
          esp: CalcInput.num(unit.attrs.kwMax) || 0,
          cap: GensetSizing.cap(unit.attrs, standby),
          kva: k.v,
          ksrc: k.src,
        };
      })
      .sort((first, second) => second.prp - first.prp);
    const res = req.reserve != null ? Math.min(req.reserve, units.length - 1) : 0;
    const work = units.slice(res);
    const sum = k => work.reduce((acc, entry) => acc + entry[k], 0);
    const group = { G: gensets, work, res, standby, PRP: sum('prp'), CAP: sum('cap'), KVA: sum('kva') };
    GensetSizing._inputs(note, req, units, group);
    if (req.kw > 0 && group.CAP > 0) GensetSizing.power(note, req, group);
    GensetSizing.site(note, req);
    if (req.motor > 0 || (load && load.Sst)) GensetSizing.start(note, req, load, group);
    GensetSizing.fuelStep(note, input);
  }

  static _inputs(note, req, units, { work, standby }) {
    if (req.reserve == null)
      note.missing('dgu.reserve.tz', 'Резерв ДГУ в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный ДГУ (N+1)?');
    for (const name of new Set(units.filter(entry => !(entry.prp > 0)).map(entry => entry.u.name))) {
      note.issue(
        'warn',
        `У «${name}» в карточке не указана мощность (PRP) — проверки мощности, нагрузки и топлива по нему не выполнены; заполните карточку.`,
      );
    }
    if (standby && work.some(entry => entry.prp > 0 && !(entry.esp > 0)))
      note.assume('Мощность ESP (резервный режим) в карточке ДГУ не указана — для проверки взята PRP (в запас).');
    if (!(req.kw > 0)) {
      note.issue('info', 'Мощность нагрузки не задана — проверка мощности ДГУ не выполнена.');
      note.ask('Мощность нагрузки ДЭС, кВт (длительная и максимальная).');
    }
  }

  /** PRP (или ESP для резервного источника) против нагрузки; средняя нагрузка — не больше 70 % PRP и не меньше малой. */
  static power(note, req, { G: gensets, work, res, standby, CAP, PRP }) {
    const fit = note.fits(CAP, req.kw);
    const rid = standby ? 'dgu.esp_hours' : 'dgu.prp_avg';
    note.step({
      what: standby ? 'Мощность ESP (резервный источник) против нагрузки' : 'Мощность PRP против нагрузки',
      formula: 'Σ Pраб ≥ Pнагр',
      rules: [rid],
      data: [
        ['нагрузка', `${CalcNote.fmt(req.kw, 0)} кВт`],
        ['рабочих ДГУ', work.length + (res ? ` (+${res} резерв)` : '')],
        ...work
          .slice(0, 4)
          .map(entry => [
            'ДГУ',
            `${entry.u.name} — PRP ${CalcNote.fmt(entry.prp, 0)}${entry.esp > 0 ? ` / ESP ${CalcNote.fmt(entry.esp, 0)}` : ''} кВт`,
          ]),
      ],
      result: `${standby ? 'ESP = ' : 'PRP = '}${CalcNote.fmt(CAP, 0)} кВт`,
      ok: fit.ok,
      margin: CalcNote.pct(CAP, req.kw),
      note: fit.note,
      pick: [...new Set(gensets.map(unit => unit.name))].join('; '),
    });
    note.rule(rid);
    if (!fit.ok)
      note.issue('error', `Мощность ДГУ ${CalcNote.fmt(CAP, 0)} кВт меньше нагрузки ${CalcNote.fmt(req.kw, 0)} кВт.`);
    const avg = req.load > 0 ? (req.kw * req.load) / 100 : req.kw;
    const lim = note.rule('dgu.prp_avg') * PRP;
    const low = note.rule('dgu.minload') * PRP;
    if (!standby && PRP > 0) GensetSizing._average(note, req, { avg, lim, low });
  }

  static _average(note, req, { avg, lim, low }) {
    note.step({
      what: 'Средняя нагрузка за 24 ч',
      formula: 'Pср ≤ 0,7 · PRP',
      rules: ['dgu.prp_avg'],
      data: [
        [
          'Pср',
          `${CalcNote.fmt(avg, 0)} кВт${req.load > 0 ? ` (${CalcNote.fmt(req.load, 0)} % от нагрузки)` : ' (график не задан — принята постоянной)'}`,
        ],
      ],
      result: `0,7 · PRP = ${CalcNote.fmt(lim, 0)} кВт`,
      ok: avg <= lim + 1e-9 ? true : null,
    });
    if (!(req.load > 0)) note.ask('График нагрузки за сутки: средняя нагрузка, % от максимальной.', true);
    if (avg > lim + 1e-9) {
      note.issue(
        'warn',
        `Средняя нагрузка ${CalcNote.fmt(avg, 0)} кВт больше 70 % PRP (${CalcNote.fmt(lim, 0)} кВт): для постоянной круглосуточной нагрузки нужна мощность COP (уточните у производителя) или больше ДГУ.`,
      );
    }
    if (avg < low - 1e-9) {
      note.issue(
        'warn',
        `Средняя нагрузка ${CalcNote.fmt(avg, 0)} кВт меньше ${Math.round(note.rule('dgu.minload') * 100)} % PRP (${CalcNote.fmt(low, 0)} кВт): длительная работа на малой нагрузке ведёт к нагарообразованию — уточните у изготовителя минимальную нагрузку или подберите ДГУ меньшей мощности.`,
      );
    }
  }

  /** Выше базовых условий изготовителя (dgu.site) — мощность снижается по его таблице (в каталоге нет). */
  static site(note, req) {
    const site = note.rule('dgu.site');
    const hot = req.tmax != null && req.tmax > site.t;
    const high = (req.alt || 0) > site.alt;
    if (!hot && !high) return;
    const where = [high ? `высота ${CalcNote.fmt(req.alt, 0)} м` : '', hot ? `до +${CalcNote.fmt(req.tmax, 0)} °C` : '']
      .filter(Boolean)
      .join(', ');
    note.issue(
      'warn',
      `Условия площадки (${where}) выше базовых условий изготовителей ДГУ (до ${CalcNote.fmt(site.alt, 0)} м и +${CalcNote.fmt(site.t, 0)} °C): мощность снижается по таблице изготовителя — в каталоге её нет; проверьте запас мощности по паспорту.`,
    );
    note.missing(
      'dgu.derate',
      'Снижение мощности ДГУ по высоте и температуре — по таблице изготовителя (в каталоге нет)',
    );
    note.step({
      what: 'Высота и температура площадки',
      formula: 'местные условия против базовых условий изготовителя',
      rules: ['dgu.site', 'dgu.ref'],
      data: [
        ['высота', `${CalcNote.fmt(req.alt || 0, 0)} м → ${CalcNote.fmt(AirDemand.baro(req.alt || 0), 1)} кПа`],
        ['до', req.tmax != null ? `${CalcNote.fmt(req.tmax, 0)} °C` : 'не задано'],
      ],
      result: 'требуется снижение мощности по данным изготовителя',
      ok: null,
    });
  }

  /** Пуск наибольшего двигателя от ДГУ: Sпуск = k · P / (cos φ · η); провал напряжения — по ISO 8528-5. */
  static start(note, req, load, { work, KVA }) {
    const startRule = note.rule('el.start');
    const how = req.start && startRule[req.start] ? req.start : (load && load.how) || '';
    const cos = note.rule('el.cos');
    const eta = note.rule('el.eta');
    const motorKw = req.motor > 0 ? req.motor : load.kw;
    const k = how ? startRule[how] : startRule.default;
    const kva = (k * motorKw) / (cos * eta);
    const ratio = KVA > 0 ? kva / KVA : null;
    const dip = note.rule('dgu.dip');
    const byKw = work.some(entry => entry.ksrc === 'по мощности');
    if (byKw)
      note.assume(
        `Полная мощность генератора в карточке ДГУ не указана — принята PRP / ${CalcNote.fmt(note.rule('dgu.cos'), 2)} (cos φ ном.).`,
      );
    if (!how) note.missing('dgu.start', 'Способ пуска двигателя нагрузки не указан — принят прямой');
    note.step(GensetSizing._startStep({ P: motorKw, k, KVA, byKw, S: kva, ratio, dip }));
    note.missing(
      'dgu.skva',
      'Способность генератора к пуску двигателей (кВА пуска при допустимом провале) — по паспорту генератора',
    );
    if (ratio != null && ratio > 1) {
      note.issue(
        'warn',
        `Пусковая мощность двигателя ≈ ${CalcNote.fmt(kva, 0)} кВА больше мощности генератора ${CalcNote.fmt(KVA, 0)} кВА — нужен плавный пуск или частотный преобразователь, либо ДГУ больше (проверить по паспорту генератора).`,
      );
    }
  }

  static _startStep({ P: motorKw, k, KVA, byKw, S: kva, ratio, dip }) {
    return {
      what: 'Пуск наибольшего двигателя от ДГУ',
      formula: 'Sпуск = k · P / (cos φ · η)',
      rules: ['el.start', 'dgu.dip'],
      data: [
        ['P', `${CalcNote.fmt(motorKw, 1)} кВт`],
        ['k', CalcNote.fmt(k, 1)],
        ['генератор', KVA > 0 ? `${CalcNote.fmt(KVA, 0)} кВА${byKw ? ' (по мощности)' : ''}` : 'мощность не указана'],
      ],
      result: `Sпуск ≈ ${CalcNote.fmt(kva, 0)} кВА${ratio != null ? ` (${CalcNote.fmt(ratio * 100, 0)} % мощности генератора)` : ''}`,
      ok: null,
      note: `Допустимый провал напряжения по ISO 8528-5: G1 — ${dip.G1} %, G2 — ${dip.G2} %, G3 — ${dip.G3} %. Проверка — по паспорту генератора (кВА пуска при провале), в каталоге этих данных нет.`,
    };
  }

  /** Запас топлива на автономность против баков; дополнительный бак больше отсека — предупреждение. */
  static fuelStep(note, input) {
    const fuel = GensetSizing.fuelPlan(input);
    if (!fuel) return;
    const req = input.req;
    const passport = fuel.src === 'паспорт ДГУ';
    note.rule('dgu.fuel_margin');
    if (!passport) note.rule('dgu.lph');
    if (!(req.kw > 0)) note.rule('dgu.fuel_load');
    const { need, have } = fuel;
    note.step({
      what: 'Запас топлива на автономность',
      formula: 'V = Σ расход рабочих ДГУ(нагрузка) · часы · запас',
      rules: ['dgu.fuel_margin', passport ? '' : 'dgu.lph', req.kw > 0 ? '' : 'dgu.fuel_load'],
      data: [
        ['нагрузка', `${CalcNote.fmt(fuel.x * 100, 0)} % PRP`],
        ['расход', `${CalcNote.fmt(fuel.c, 1)} л/ч, все рабочие ДГУ (${fuel.src})`],
        ['рабочих ДГУ', String(fuel.n)],
        ['часы', CalcNote.fmt(req.hours, 0)],
        ['баки', `ДГУ ${CalcNote.fmt(fuel.built, 0)} л + дополнительные ${CalcNote.fmt(fuel.extra, 0)} л`],
      ],
      result: `нужно ${CalcNote.fmt(need, 0)} л; в баках ${CalcNote.fmt(have, 0)} л`,
      ok: note.fits(have, need).ok,
      margin: CalcNote.pct(have, need),
      note: note.fits(have, need).note,
    });
    if (!note.fits(have, need).ok)
      note.issue(
        'error',
        `Топлива в баках ${CalcNote.fmt(have, 0)} л — меньше нужного на ${CalcNote.fmt(req.hours, 0)} ч (${CalcNote.fmt(need, 0)} л).`,
      );
    const big = input.units
      .filter(unit => unit.kind === 'tank')
      .map(GensetSizing._tankVol)
      .filter(value => value > GensetSizing.TANK_MAX);
    if (big.length) {
      note.issue(
        'warn',
        `Дополнительный бак ${CalcNote.fmt(Math.max(...big), 0)} л больше ${CalcNote.fmt(GensetSizing.TANK_MAX, 0)} л (3 000 × 1 000 × 1 500 мм) — в отсеке не поместится одним баком: два бака или бак вне контейнера.`,
      );
    }
  }
}
