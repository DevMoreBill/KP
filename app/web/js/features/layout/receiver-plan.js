import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';

/**
 * Ресиверы по методике ПНЕВМОТЕХ: объём одного — кратно 900 л, 500 л — только при крайней необходимости. Нужный объём —
 * наибольший из приоритетов: 1 — цикл «нагрузка — разгрузка», 2 — пиковый разбор по циклограмме, 3 — базовый буфер
 * (поршневой без циклограммы), объём по ТЗ. Мокрый — до осушителя, локальный — у потребителя. Коэффициенты —
 * правило receiver.method.
 */
export class ReceiverPlan {
  static EPS = 1e-9;

  static PRIO = {
    1: '1 — цикл нагрузки/разгрузки',
    2: '2 — пиковый разбор по циклограмме',
    3: '3 — базовый буфер',
    ТЗ: 'объём по ТЗ заказчика',
  };

  /** Методика подбора ресиверов (правило receiver.method). */
  static get METHOD() {
    return StationRules.raw('receiver.method');
  }

  /** Основной типоразмер ресивера, л. */
  static get UNIT() {
    return this.METHOD.unit;
  }

  /** Малый ресивер для тесного помещения, л. */
  static get SMALL() {
    return this.METHOD.small;
  }

  /** Число с заданным числом знаков после запятой: «0,25». */
  static dec(v, digits = 2) {
    return String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');
  }

  /** Доля в процентах. */
  static pct(v) {
    return Math.round(v * 100);
  }

  /**
   * Типоразмер на объём V, л: {size, n, total, why}. o.min — наименьший допустимый объём, o.force — '500' | '900',
   * o.reason — 'space' | 'mass', o.space — 900 л не помещается по высоте, o.auto — 500 л ради габарита перевозки.
   */
  static size(volume, opts = {}) {
    if (!(volume > 0)) return null;
    const unitVol = this.UNIT;
    const small = this.SMALL;
    const excess = this.METHOD.excess;
    const need = opts.min > 0 ? opts.min : volume;
    const n900 = Math.max(1, Math.ceil(need / unitVol - ReceiverPlan.EPS));
    const by900 = { size: unitVol, n: n900, total: n900 * unitVol };
    if (opts.force === '900') return { ...by900, why: `${Mm.text(unitVol)} л — выбор вручную` };
    if (opts.force === '500' || opts.space) return this.small(need, opts);
    if (volume <= small && unitVol > excess * volume) {
      return {
        size: small,
        n: 1,
        total: small,
        why: `${Mm.text(small)} л — ресивер ${Mm.text(unitVol)} л дал бы запас ${this.pct(unitVol / volume)} % (больше ${this.pct(excess)} %)`,
        reason: 'excess',
      };
    }
    const least =
      need < volume - ReceiverPlan.EPS && by900.total < volume - ReceiverPlan.EPS
        ? ` — наименьшее допустимое по методике (${this.pct(by900.total / volume)} % нужного, не меньше ${this.pct(this.METHOD.low)} %)`
        : '';
    const notSmall =
      volume <= small
        ? ` (${Mm.text(small)} л не применён: ${Mm.text(unitVol)} л даёт запас не больше ${this.pct(excess)} %)`
        : '';
    return {
      ...by900,
      why: `кратно ${Mm.text(unitVol)} л: ${by900.n} × ${Mm.text(unitVol)} = ${Mm.text(by900.total)} л${least}${notSmall}`,
    };
  }

  /** По 500 л: выбор вручную, нехватка места или 900 л не встаёт по высоте. */
  static small(need, opts) {
    const small = this.SMALL;
    const count = Math.max(1, Math.ceil(need / small - ReceiverPlan.EPS));
    return {
      size: small,
      n: count,
      total: count * small,
      why: `${count > 1 ? `${count} × ` : ''}${Mm.text(small)} л — ${this._smallWhy(opts)}`,
      forced: true,
      reason: opts.space ? 'space' : opts.reason || '',
    };
  }

  static _smallWhy(opts) {
    if (opts.space) return 'ресивер 900 л не помещается по высоте';
    if (opts.auto) return 'нехватка места: с ресиверами 900 л станция не помещается в габарит перевозки';
    return (
      { space: 'нехватка места (вручную)', mass: 'ограничение по массе (вручную)' }[opts.reason] || 'выбор вручную'
    );
  }

  /**
   * Расчёт: o — {Q — наибольший компрессор, м³/мин, piston, S — подача рабочих, dp, cyc {T, C, drop}, point, tz, dryer,
   * dryerCap, mode, force, reason, space, auto, bar, valve, have}. Нет Q — null.
   */
  static calc(opts) {
    const flow = opts.Q > 0 ? opts.Q : 0;
    if (!flow) return null;
    const { dp: drop, dpSrc, cyc } = this.inputs(opts);
    const vols = this.volumes(opts, flow, drop, cyc);
    const gov = this.governing(vols);
    const theor = Math.round(vols[gov[0]]);
    const main = this.size(theor, { ...opts, min: this.least(gov, theor, flow) });
    const peak = Math.max(cyc ? cyc.C : 0, opts.point || 0);
    const risk = opts.dryerCap > 0 && peak > opts.dryerCap;
    const plan = {
      prio: gov[1],
      V: vols,
      theor,
      main,
      wet: this.wet(opts, main, risk),
      local: this.local(opts, flow),
      dp: drop,
      dpSrc,
      cyc,
      Q: flow,
      S: opts.S || flow,
      piston: Boolean(opts.piston),
      mode: opts.mode || '',
      risk,
      dryer: Boolean(opts.dryer),
      checks: [],
    };
    plan.checks = this.checks(plan, opts);
    return plan;
  }

  /** ΔP нагрузка/разгрузка (не задан — правило pressure.band) и циклограмма, если она полная. */
  static inputs(opts) {
    const own = opts.dp > 0;
    const cycle = opts.cyc;
    return {
      dp: own ? opts.dp : StationRules.raw('pressure.band'),
      dpSrc: own ? 'задан' : 'по правилу pressure.band',
      cyc: cycle && cycle.T > 0 && cycle.C > 0 && cycle.drop > 0 ? cycle : null,
    };
  }

  /** Локальный ресивер у потребителя: пик точки больше доли производительности компрессора. */
  static local(opts, flow) {
    return opts.point > this.METHOD.local * flow ? this.size(this.METHOD.base.screw * opts.point * 1000) : null;
  }

  /** Сработавший приоритет — давший наибольший объём: [ключ, приоритет]. */
  static governing(vols) {
    const cand = [
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
      ['tz', 'ТЗ'],
    ].filter(([k]) => vols[k] != null);
    return cand.reduce((best, cand1) => (vols[cand1[0]] > vols[best[0]] + ReceiverPlan.EPS ? cand1 : best), cand[0]);
  }

  /** Наименьшее допустимое: по ТЗ — полностью, иначе 80 % нужного и 15 % минутной производительности. */
  static least(gov, theor, flow) {
    return gov[0] === 'tz' ? theor : Math.max(this.METHOD.low * theor, this.METHOD.ratio[0] * flow * 1000);
  }

  /** Мокрый ресивер: задан («основной + мокрый») или по методике при риске проскока влаги. */
  static wet(opts, main, risk) {
    const wetOn = opts.dryer && (opts.mode === 'both' || (!opts.mode && risk));
    if (!wetOn || !main) return null;
    const v = main.total * this.METHOD.wet[0];
    return this.size(v, { min: v });
  }

  /** Объёмы по приоритетам, л: p1 всегда, p2 — с циклограммой, p3 — поршневой без неё, tz — по ТЗ. */
  static volumes(opts, flow, drop, cyc) {
    const method = this.METHOD;
    const vols = { p1: (flow / (method.cycles * drop)) * 1000 };
    if (cyc) vols.p2 = Math.max(0, ((cyc.T * (cyc.C - (opts.S || flow)) * method.pa) / cyc.drop) * 1000);
    else if (opts.piston) vols.p3 = method.base.piston * flow * 1000;
    if (opts.tz > 0) vols.tz = opts.tz;
    return vols;
  }

  /** Проверки «на здравый смысл» — по составу (если ресиверы в нём есть), иначе по рекомендации. */
  static checks(plan, opts) {
    const have = opts.have || [];
    const dry = have.filter(tank => tank.role !== 'wet' && tank.role !== 'local');
    const wets = have.filter(tank => tank.role === 'wet');
    const sum = list => list.reduce((acc, tank) => acc + (tank.vol || 0) * (tank.qty || 1), 0);
    const main = this._mainVolume(plan, dry, sum);
    const all = main + this._wetVolume(plan, wets, sum);
    const ctx = { R: plan, o: opts, have, dry, wets, main, all };
    return [
      ...this.checkVolume(ctx),
      ...this.checkPressure(ctx),
      ...this.checkDead(ctx),
      ...this.checkRow(ctx),
      ...this.checkMoisture(ctx),
    ];
  }

  static _mainVolume(plan, dry, sum) {
    if (dry.length && dry.every(tank => tank.vol > 0)) return sum(dry);
    return plan.main ? plan.main.total : 0;
  }

  static _wetVolume(plan, wets, sum) {
    if (wets.length) return sum(wets);
    return plan.wet ? plan.wet.total : 0;
  }

  /** Избыточность, недобор и объём к минутной производительности наибольшего компрессора. */
  static checkVolume({ R: plan, main }) {
    const method = this.METHOD;
    const fmt = v => Mm.text(v);
    const flowText = this.dec(plan.Q);
    const minute = plan.Q * 1000;
    return [
      main > method.excess * plan.theor && {
        level: 'warn',
        text: `Запас превышает 200% (${fmt(main)} л на ${fmt(plan.theor)} л). Рассмотреть переход на 500 л или пересмотр количества ресиверов.`,
      },
      main < method.low * plan.theor && {
        level: 'error',
        text: `Объём ниже минимально допустимого (${fmt(main)} л при нужных ${fmt(plan.theor)} л). Расчёт некорректен.`,
      },
      main < method.ratio[0] * minute && {
        level: 'warn',
        text: `Объём менее 15% минутной производительности (${fmt(main)} л при ${flowText} м³/мин) — риск частых циклов и пульсаций.`,
      },
      main > method.ratio[1] * minute && {
        level: 'warn',
        text: `Объём более 5-кратной минутной производительности (${fmt(main)} л при ${flowText} м³/мин) — неоправданно велик, если нет задачи длительного буфера.`,
      },
    ].filter(Boolean);
  }

  /** Давление: номинал ресивера — с запасом над компрессором, уставка клапана — не выше номинала. */
  static checkPressure({ o: opts, have }) {
    const rated = have.filter(tank => tank.bar > 0);
    const pmin = rated.length ? Math.min(...rated.map(tank => tank.bar)) : 0;
    if (!(pmin > 0)) return [];
    const fmt = v => this.dec(v);
    return [
      opts.bar > 0 &&
        pmin < opts.bar + this.METHOD.margin - ReceiverPlan.EPS && {
          level: 'error',
          text: `Ресивер должен иметь запас по давлению минимум 1–2 бар относительно максимального давления компрессора (ресивер ${fmt(pmin)} бар, компрессор ${fmt(opts.bar)} бар).`,
        },
      opts.valve > 0 &&
        opts.valve > pmin + ReceiverPlan.EPS && {
          level: 'error',
          text: `Уставка предохранительного клапана превышает номинал ресивера (${fmt(opts.valve)} бар > ${fmt(pmin)} бар).`,
        },
    ].filter(Boolean);
  }

  /** «Мёртвый объём» — к пиковому разбору за цикл. */
  static checkDead({ R: plan, all }) {
    if (!(plan.V.p2 > 0) || !(all > this.METHOD.dead * plan.V.p2)) return [];
    return [
      {
        level: 'warn',
        text: `Система имеет избыточную аккумулирующую способность (${Mm.text(all)} л при пиковом разборе ${Mm.text(plan.V.p2)} л за цикл). Возможно снижение энергоэффективности из-за длительного нахождения воздуха в ресивере (конденсат, потери тепла).`,
      },
    ];
  }

  static _offRow(v) {
    return Math.abs(v / this.UNIT - Math.round(v / this.UNIT)) > 1e-6;
  }

  /** Ряд 900 / 500 л и обоснование 500 л. */
  static checkRow(ctx) {
    return [this.rowError(ctx), this._smallWarn(ctx)].filter(Boolean);
  }

  /** Замечание о ресиверах разного объёма в одном ряду. */
  static rowError({ have, dry, main }) {
    const bad = have.filter(
      tank => tank.vol > 0 && tank.role !== 'local' && tank.vol !== this.SMALL && this._offRow(tank.vol),
    );
    const all500 = dry.length && dry.every(tank => tank.vol === this.SMALL);
    const mainOff = dry.length && main > 0 && main !== this.SMALL && !all500 && this._offRow(main);
    if (!bad.length && !mainOff) return null;
    const list = [...new Set(bad.map(tank => `${Mm.text(tank.vol)} л`))].join(', ') || `${Mm.text(main)} л`;
    return {
      level: 'error',
      text: `Нарушено правило типоразмерного ряда (${list}: объём — кратно ${Mm.text(this.UNIT)} л или ${Mm.text(this.SMALL)} л). Пересчитать.`,
    };
  }

  static _smallWarn({ R: plan, o: opts, dry }) {
    const small = dry.length ? dry.some(tank => tank.vol === this.SMALL) : plan.main && plan.main.size === this.SMALL;
    const grounded =
      this.UNIT > this.METHOD.excess * plan.theor || opts.space || ['space', 'mass'].includes(opts.reason);
    if (!small || grounded) return null;
    return {
      level: 'warn',
      text: '500 л применён без достаточного обоснования. Проверить необходимость использования 900 л.',
    };
  }

  /** Резкое падение давления: без мокрого ресивера — проскок влаги через осушитель. */
  static checkMoisture({ R: plan, o: opts, have, wets }) {
    const peak = Math.max(plan.cyc ? plan.cyc.C : 0, opts.point || 0);
    const wetPlanned = plan.wet && !have.length;
    if (!opts.dryer || !(opts.dryerCap > 0) || !(peak > opts.dryerCap) || wets.length || wetPlanned) return [];
    return [
      {
        level: 'warn',
        text: `Возможен проскок влаги через осушитель при резком падении давления (пик ${this.dec(peak)} м³/мин больше производительности осушителя ${this.dec(opts.dryerCap)} м³/мин). Рассмотреть установку мокрого ресивера.`,
      },
    ];
  }

  /** Одной строкой: «основной 900 л × 3 = 2 700 л (после осушителя); мокрый 500 л × 1 (до осушителя)». */
  static text(plan) {
    const unit = (x, title) =>
      x ? `${title} ${Mm.text(x.size)} л × ${x.n}${x.n > 1 ? ` = ${Mm.text(x.total)} л` : ''}` : '';
    return [
      unit(plan.main, 'основной') + this.where(plan),
      plan.wet ? `${unit(plan.wet, 'мокрый')} (до осушителя)` : '',
      plan.local ? unit(plan.local, 'у потребителя') : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  /** Где стоит основной ресивер относительно осушителя. */
  static where(plan) {
    if (plan.mode === 'before') return ' (до осушителя)';
    return plan.wet || plan.dryer || plan.mode === 'after' ? ' (после осушителя)' : '';
  }

  /** Расчёт по составу станции: eq — StationEquip.list, rq — StationReq.recvIn. */
  static from(equip, req = {}) {
    const comps = (equip || []).filter(unit => unit.kind === 'compressor' && unit.air && unit.air.flow > 0);
    if (!comps.length) return null;
    const big = comps.reduce((best, unit) => (unit.air.flow > best.air.flow ? unit : best), comps[0]);
    const total = comps.reduce((acc, unit) => acc + unit.air.flow * (unit.qty || 1), 0);
    const bar = Math.max(0, ...comps.map(unit => unit.air.bar || 0));
    const dryers = equip.filter(unit => unit.kind === 'dryer' && unit.air && unit.air.type !== 'gen');
    const dryerCap =
      dryers.length && dryers.every(unit => unit.air.flow > 0)
        ? dryers.reduce((acc, unit) => acc + unit.air.flow * (unit.qty || 1), 0) * AirChain.dryerK(bar)
        : 0;
    const have = this.have(equip);
    const plan = this.calc({
      Q: big.air.flow,
      piston: big.ctype === 'piston',
      S: Math.max(big.air.flow, total - Math.max(0, req.reserve || 0) * big.air.flow),
      dp: req.dp,
      cyc: req.cyc,
      point: req.point,
      tz: req.tz,
      dryer: dryers.length > 0 || comps.some(unit => unit.air.dryer),
      dryerCap,
      mode: req.mode,
      force: req.force,
      reason: req.reason,
      auto: req.auto,
      space: req.space,
      bar,
      valve: req.valve,
      have,
    });
    if (plan) Object.assign(plan, { big, have, bar, dryerCap });
    return plan;
  }

  /** Ресиверы состава: в станции и у потребителя. */
  static have(equip) {
    const inside = equip
      .filter(unit => unit.kind === 'receiver' && unit.air)
      .map(unit => ({
        vol: unit.air.vol || 0,
        qty: unit.qty || 1,
        bar: unit.air.bar || 0,
        role: unit.air.role === 'wet' ? 'wet' : 'dry',
        pos: unit.pos,
      }));
    const local = equip
      .filter(unit => unit.local)
      .map(unit => ({ vol: unit.vol || 0, qty: unit.qty || 1, bar: 0, role: 'local' }));
    return [...inside, ...local];
  }
}
