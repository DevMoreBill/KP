import { StationHeat } from './station-heat.js';
import { StationMatrix } from './station-matrix.js';

const round = (v, k) => Math.round(v * k) / k;

/**
 * Электрические нагрузки: установленная мощность — сумма потребителей; расчётная — большее из режимов «работа» и «простой
 * зимой»; двигатели берут из сети P / η. Ток — 3 × 400 В, cos φ; вводной автомат — ближайший номинал не меньше k · I.
 */
export class StationPower {
  static get U() {
    return StationRules.raw('el.u');
  }
  static get COS() {
    return StationRules.raw('el.cos');
  }
  static get BREAKERS() {
    return StationRules.raw('el.breakers');
  }

  static f(v) {
    return String(Math.abs(v) < 1 ? round(v, 100) : round(v, 10)).replace('.', ',');
  }

  /** Мощность осушителя, кВт: по паспорту или оценка по производительности. */
  static dryer(i) {
    if (i.kw > 0) return i.kw;
    const q = i.air && i.air.flow > 0 ? i.air.flow : 0;
    const t = i.air && i.air.type;
    const P = StationMatrix.grp('power');
    return t === 'refrig' || !t ? Math.max(P.dryerMin, round(q * P.dryerK, 10)) : P.dryerAds;
  }

  /** Потребители [{name, n, kw, kc, run, idle, el}] и итоги по режимам. */
  static calc(plan) {
    const out = [];
    const eta = StationRules.raw('el.eta') || 1;
    const add = (name, n, kw, { kc = 1, run = true, idle = true, motor = false } = {}) => {
      if (n > 0 && kw > 0) out.push({ name, n, kw: round(kw, 100), kc, run, idle, el: motor ? 1 / eta : 1 });
    };
    StationPower.units(plan, add);
    StationPower.dgu(plan, add);
    StationPower.own(plan, add, out);
    const inst = out.reduce((s, q) => s + q.n * q.kw, 0);
    const mode = k => out.reduce((s, q) => s + (q[k] ? q.n * q.kw * (q.el || 1) * q.kc + (q.extra || 0) : 0), 0);
    const run = mode('run');
    const idle = mode('idle');
    const P = Math.max(run, idle);
    const A = (P * 1000) / (Math.sqrt(3) * StationPower.U * StationPower.COS);
    return {
      list: out,
      inst: round(inst, 10),
      run: round(run, 10),
      idle: round(idle, 10),
      kw: round(P, 10),
      mode: run >= idle ? 'run' : 'idle',
      amp: round(A, 10),
      breaker: StationPower.BREAKERS.find(b => b >= A * StationRules.raw('el.breaker_k')) || null,
      dgu: (plan.items || []).some(i => i.kind === 'dgu' && !i.tank),
    };
  }

  /** Компрессоры, насосы, осушители: рабочие и резервные (резерв — у основного вида станции). */
  static units(plan, add) {
    const I = plan.items || [];
    const r = plan.req || {};
    const main = r.kind === 'pump' ? 'pump' : 'compressor';
    const group = (kind, name, kwOf) => {
      const L = I.filter(i => i.kind === kind && !i.tank);
      if (!L.length) return;
      const res = kind === main ? Math.max(0, Math.min(L.length - 1, Math.round(r.res || 0))) : 0;
      const kws = L.map(kwOf).sort((a, b) => b - a);
      const work = kws.slice(0, L.length - res);
      const spare = kws.slice(L.length - res);
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
    const DG = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank);
    if (!DG.length) return;
    const D = StationMatrix.grp('power');
    for (const big of [true, false]) {
      const q = DG.filter(g => g.kw > D.dguHeatKw === big).length;
      if (q) add('Подогреватель двигателя ДГУ', q, big ? D.dguHeatBig : D.dguHeat, { run: false });
    }
    add('Зарядное устройство АКБ ДГУ', DG.length, D.charger);
    if (plan.fuel) add('Насос перекачки топлива', 1, D.fuelPumpKw);
  }

  /** Системы контейнера: отопление, подогрев воздуха, свет, розетки, клапаны, ОПС, АСУ ТП. */
  static own(plan, add, out) {
    const h = plan.heat;
    if (h && h.on && h.total > 0)
      add(`Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт`, 1, h.total, { run: false });
    if (h && h.on && h.qRun > 0)
      out.push({
        name: 'Подогрев воздуха при работе (часть конвекторов)',
        n: 1,
        kw: 0,
        kc: 1,
        run: true,
        idle: false,
        extra: Math.round(h.qRun / 10) / 100,
      });
    StationPower.services(plan, add);
  }

  static services(plan, add) {
    const D = StationMatrix.grp('power');
    if (plan.light && plan.light.on) add('Освещение (основное, аварийное, прожекторы)', 1, plan.light.kw);
    if (plan.sockets) {
      add('Розетки 230 В (группа 16 А)', 1, D.s230, { kc: D.s230k });
      add('Розетка 380 В 16 А', 1, D.s380, { kc: D.s380k });
      add('ЯТП-0,25 (36 В)', 1, D.ytp, { kc: D.ytpK });
    }
    if ((plan.sys || {}).vent !== false) add('Клапаны вентиляции с электроприводами', 1, D.valves);
    const F = plan.fire;
    if (F && F.ops) add(`Щит ОПС${F.auto ? ' и пожаротушения' : ''}`, 1, D.ops);
    if ((plan.items || []).some(i => i.kind === 'cabinet' && /АСУ|диспетч/i.test(i.name || '')))
      add('Шкаф АСУ ТП', 1, D.asu);
  }

  /** Строки итога для ТЗ и вкладки «Компоновка». */
  static lines(W) {
    if (!W) return [];
    const f = StationPower.f;
    const own = W.dgu ? 'собственные нужды станции' : 'станция';
    const when = W.mode === 'run' ? 'при работе оборудования' : 'зимой при остановленном оборудовании (отопление)';
    return [
      `Установленная мощность (оборудование и системы контейнера) — ${f(W.inst)} кВт; расчётная (${own}) — ${f(W.kw)} кВт: ${when}; при работе — ${f(W.run)} кВт, в простое зимой — ${f(W.idle)} кВт.`,
      `Ввод — 3 × 400 В, 50 Гц: расчётный ток ${f(W.amp)} А (cos φ ${String(StationPower.COS).replace('.', ',')}); вводной автомат — ${W.breaker ? `${W.breaker} А` : 'по проекту'}${W.dgu ? '' : `; выделяемая мощность — не менее ${f(W.kw)} кВт`}.`,
    ];
  }
}
