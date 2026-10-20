import { Num } from './num.js';
import { StationHeat } from './station-heat.js';
import { StationMatrix } from './station-matrix.js';

/**
 * Электрические нагрузки: установленная мощность — сумма потребителей; расчётная — большее из режимов «работа» и «простой
 * зимой»; двигатели берут из сети P / η. Ток — 3 × 400 В, cos φ; вводной автомат — ближайший номинал не меньше k · I.
 */
export class StationPower {
  static get VOLTAGE() {
    return StationRules.raw('el.u');
  }
  static get COS() {
    return StationRules.raw('el.cos');
  }
  static get BREAKERS() {
    return StationRules.raw('el.breakers');
  }

  static fmt(v) {
    return String(Math.abs(v) < 1 ? Num.round(v, 100) : Num.round(v, 10)).replace('.', ',');
  }

  /** Мощность осушителя, кВт: по паспорту или оценка по производительности. */
  static dryer(i) {
    if (i.kw > 0) return i.kw;
    const flow = i.air && i.air.flow > 0 ? i.air.flow : 0;
    const type = i.air && i.air.type;
    const rules = StationMatrix.grp('power');
    return type === 'refrig' || !type ? Math.max(rules.dryerMin, Num.round(flow * rules.dryerK, 10)) : rules.dryerAds;
  }

  /** Потребители [{name, n, kw, kc, run, idle, el}] и итоги по режимам. */
  static calc(plan) {
    const out = [];
    const eta = StationRules.raw('el.eta') || 1;
    const add = (name, count, kw, { kc: demandK = 1, run = true, idle = true, motor = false } = {}) => {
      if (count > 0 && kw > 0)
        out.push({ name, n: count, kw: Num.round(kw, 100), kc: demandK, run, idle, el: motor ? 1 / eta : 1 });
    };
    StationPower.units(plan, add);
    StationPower.dgu(plan, add);
    StationPower.own(plan, add, out);
    const inst = out.reduce((acc, line) => acc + line.n * line.kw, 0);
    const mode = k =>
      out.reduce(
        (acc, line) => acc + (line[k] ? line.n * line.kw * (line.el || 1) * line.kc + (line.extra || 0) : 0),
        0,
      );
    const run = mode('run');
    const idle = mode('idle');
    const peak = Math.max(run, idle);
    const amps = (peak * 1000) / (Math.sqrt(3) * StationPower.VOLTAGE * StationPower.COS);
    return {
      list: out,
      inst: Num.round(inst, 10),
      run: Num.round(run, 10),
      idle: Num.round(idle, 10),
      kw: Num.round(peak, 10),
      mode: run >= idle ? 'run' : 'idle',
      amp: Num.round(amps, 10),
      breaker: StationPower.BREAKERS.find(rating => rating >= amps * StationRules.raw('el.breaker_k')) || null,
      dgu: (plan.items || []).some(i => i.kind === 'dgu' && !i.tank),
    };
  }

  /** Компрессоры, насосы, осушители: рабочие и резервные (резерв — у основного вида станции). */
  static units(plan, add) {
    const items = plan.items || [];
    const req = plan.req || {};
    const main = req.kind === 'pump' ? 'pump' : 'compressor';
    const group = (kind, name, kwOf) => {
      const units = items.filter(i => i.kind === kind && !i.tank);
      if (!units.length) return;
      const res = kind === main ? Math.max(0, Math.min(units.length - 1, Math.round(req.res || 0))) : 0;
      const kws = units.map(kwOf).sort((left, right) => right - left);
      const work = kws.slice(0, units.length - res);
      const spare = kws.slice(units.length - res);
      const motor = kind === 'compressor' || kind === 'pump';
      if (kws.every(v => Math.abs(v - kws[0]) < 1e-6)) {
        add(name, work.length, kws[0], { idle: false, motor });
        add(`${name} — резервный`, spare.length, kws[0], { kc: 0, run: false, idle: false, motor });
        return;
      }
      for (const v of work) add(name, 1, v, { idle: false, motor });
      for (const v of spare) add(`${name} — резервный`, 1, v, { kc: 0, run: false, idle: false, motor });
    };
    group('compressor', 'Компрессор', i => (i.kw > 0 ? i.kw : 0));
    group('pump', 'Насосный агрегат', i => (i.kw > 0 ? i.kw : 0));
    group('dryer', 'Осушитель', i => StationPower.dryer(i));
  }

  /** У каждой ДГУ — подогреватель двигателя и зарядное устройство АКБ; с баком — насос перекачки. */
  static dgu(plan, add) {
    const dgus = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank);
    if (!dgus.length) return;
    const rules = StationMatrix.grp('power');
    for (const big of [true, false]) {
      const count = dgus.filter(dgu => dgu.kw > rules.dguHeatKw === big).length;
      if (count) add('Подогреватель двигателя ДГУ', count, big ? rules.dguHeatBig : rules.dguHeat, { run: false });
    }
    add('Зарядное устройство АКБ ДГУ', dgus.length, rules.charger);
    if (plan.fuel) add('Насос перекачки топлива', 1, rules.fuelPumpKw);
  }

  /** Системы контейнера: отопление, подогрев воздуха, свет, розетки, клапаны, ОПС, АСУ ТП. */
  static own(plan, add, out) {
    const heat = plan.heat;
    if (heat && heat.on && heat.total > 0)
      add(`Электроконвекторы ${heat.n} × ${StationHeat.kw(heat.kw)} кВт`, 1, heat.total, { run: false });
    if (heat && heat.on && heat.qRun > 0)
      out.push({
        name: 'Подогрев воздуха при работе (часть конвекторов)',
        n: 1,
        kw: 0,
        kc: 1,
        run: true,
        idle: false,
        extra: Math.round(heat.qRun / 10) / 100,
      });
    StationPower.services(plan, add);
  }

  static services(plan, add) {
    const rules = StationMatrix.grp('power');
    if (plan.light && plan.light.on) add('Освещение (основное, аварийное, прожекторы)', 1, plan.light.kw);
    if (plan.sockets) {
      add('Розетки 230 В (группа 16 А)', 1, rules.s230, { kc: rules.s230k });
      add('Розетка 380 В 16 А', 1, rules.s380, { kc: rules.s380k });
      add('ЯТП-0,25 (36 В)', 1, rules.ytp, { kc: rules.ytpK });
    }
    if ((plan.sys || {}).vent !== false) add('Клапаны вентиляции с электроприводами', 1, rules.valves);
    const fire = plan.fire;
    if (fire && fire.ops) add(`Щит ОПС${fire.auto ? ' и пожаротушения' : ''}`, 1, rules.ops);
    if ((plan.items || []).some(i => i.kind === 'cabinet' && /АСУ|диспетч/i.test(i.name || '')))
      add('Шкаф АСУ ТП', 1, rules.asu);
  }

  /** Строки итога для ТЗ и вкладки «Компоновка». */
  static lines(power) {
    if (!power) return [];
    const fmt = StationPower.fmt;
    const own = power.dgu ? 'собственные нужды станции' : 'станция';
    const when = power.mode === 'run' ? 'при работе оборудования' : 'зимой при остановленном оборудовании (отопление)';
    return [
      `Установленная мощность (оборудование и системы контейнера) — ${fmt(power.inst)} кВт; расчётная (${own}) — ${fmt(power.kw)} кВт: ${when}; при работе — ${fmt(power.run)} кВт, в простое зимой — ${fmt(power.idle)} кВт.`,
      `Ввод — 3 × 400 В, 50 Гц: расчётный ток ${fmt(power.amp)} А (cos φ ${String(StationPower.COS).replace('.', ',')}); вводной автомат — ${power.breaker ? `${power.breaker} А` : 'по проекту'}${power.dgu ? '' : `; выделяемая мощность — не менее ${fmt(power.kw)} кВт`}.`,
    ];
  }
}
