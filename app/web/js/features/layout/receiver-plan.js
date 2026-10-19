import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';

const EPS = 1e-9;

/**
 * Ресиверы по методике ПНЕВМОТЕХ: объём одного — кратно 900 л, 500 л — только при крайней необходимости. Нужный объём —
 * наибольший из приоритетов: 1 — цикл «нагрузка — разгрузка», 2 — пиковый разбор по циклограмме, 3 — базовый буфер
 * (поршневой без циклограммы), объём по ТЗ. Мокрый — до осушителя, локальный — у потребителя. Коэффициенты —
 * правило receiver.method.
 */
export class ReceiverPlan {
  static PRIO = {
    1: '1 — цикл нагрузки/разгрузки',
    2: '2 — пиковый разбор по циклограмме',
    3: '3 — базовый буфер',
    ТЗ: 'объём по ТЗ заказчика',
  };

  static get M() {
    return StationRules.raw('receiver.method');
  }

  static get UNIT() {
    return this.M.unit;
  }

  static get SMALL() {
    return this.M.small;
  }

  static l(v) {
    return Mm.text(Math.round(v));
  }

  static f(v, d = 2) {
    return String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
  }

  static pct(v) {
    return Math.round(v * 100);
  }

  /**
   * Типоразмер на объём V, л: {size, n, total, why}. o.min — наименьший допустимый объём, o.force — '500' | '900',
   * o.reason — 'space' | 'mass', o.space — 900 л не помещается по высоте, o.auto — 500 л ради габарита перевозки.
   */
  static size(V, o = {}) {
    if (!(V > 0)) return null;
    const U = this.UNIT;
    const Sm = this.SMALL;
    const ex = this.M.excess;
    const Vn = o.min > 0 ? o.min : V;
    const n900 = Math.max(1, Math.ceil(Vn / U - EPS));
    const by900 = { size: U, n: n900, total: n900 * U };
    if (o.force === '900') return { ...by900, why: `${this.l(U)} л — выбор вручную` };
    if (o.force === '500' || o.space) return this.small(Vn, o);
    if (V <= Sm && U > ex * V) {
      return {
        size: Sm,
        n: 1,
        total: Sm,
        why: `${this.l(Sm)} л — ресивер ${this.l(U)} л дал бы запас ${this.pct(U / V)} % (больше ${this.pct(ex)} %)`,
        reason: 'excess',
      };
    }
    const least =
      Vn < V - EPS && by900.total < V - EPS
        ? ` — наименьшее допустимое по методике (${this.pct(by900.total / V)} % нужного, не меньше ${this.pct(this.M.low)} %)`
        : '';
    const notSmall =
      V <= Sm ? ` (${this.l(Sm)} л не применён: ${this.l(U)} л даёт запас не больше ${this.pct(ex)} %)` : '';
    return {
      ...by900,
      why: `кратно ${this.l(U)} л: ${by900.n} × ${this.l(U)} = ${this.l(by900.total)} л${least}${notSmall}`,
    };
  }

  /** По 500 л: выбор вручную, нехватка места или 900 л не встаёт по высоте. */
  static small(Vn, o) {
    const Sm = this.SMALL;
    const n = Math.max(1, Math.ceil(Vn / Sm - EPS));
    return {
      size: Sm,
      n,
      total: n * Sm,
      why: `${n > 1 ? `${n} × ` : ''}${this.l(Sm)} л — ${this.smallWhy(o)}`,
      forced: true,
      reason: o.space ? 'space' : o.reason || '',
    };
  }

  static smallWhy(o) {
    if (o.space) return 'ресивер 900 л не помещается по высоте';
    if (o.auto) return 'нехватка места: с ресиверами 900 л станция не помещается в габарит перевозки';
    return { space: 'нехватка места (вручную)', mass: 'ограничение по массе (вручную)' }[o.reason] || 'выбор вручную';
  }

  /**
   * Расчёт: o — {Q — наибольший компрессор, м³/мин, piston, S — подача рабочих, dp, cyc {T, C, drop}, point, tz, dryer,
   * dryerCap, mode, force, reason, space, auto, bar, valve, have}. Нет Q — null.
   */
  static calc(o) {
    const Q = o.Q > 0 ? o.Q : 0;
    if (!Q) return null;
    const { dp, dpSrc, cyc } = this.inputs(o);
    const V = this.volumes(o, Q, dp, cyc);
    const gov = this.governing(V);
    const theor = Math.round(V[gov[0]]);
    const main = this.size(theor, { ...o, min: this.least(gov, theor, Q) });
    const peak = Math.max(cyc ? cyc.C : 0, o.point || 0);
    const risk = o.dryerCap > 0 && peak > o.dryerCap;
    const R = {
      prio: gov[1],
      V,
      theor,
      main,
      wet: this.wet(o, main, risk),
      local: this.local(o, Q),
      dp,
      dpSrc,
      cyc,
      Q,
      S: o.S || Q,
      piston: Boolean(o.piston),
      mode: o.mode || '',
      risk,
      dryer: Boolean(o.dryer),
      checks: [],
    };
    R.checks = this.checks(R, o);
    return R;
  }

  /** ΔP нагрузка/разгрузка (не задан — правило pressure.band) и циклограмма, если она полная. */
  static inputs(o) {
    const own = o.dp > 0;
    const c = o.cyc;
    return {
      dp: own ? o.dp : StationRules.raw('pressure.band'),
      dpSrc: own ? 'задан' : 'по правилу pressure.band',
      cyc: c && c.T > 0 && c.C > 0 && c.drop > 0 ? c : null,
    };
  }

  /** Локальный ресивер у потребителя: пик точки больше доли производительности компрессора. */
  static local(o, Q) {
    return o.point > this.M.local * Q ? this.size(this.M.base.screw * o.point * 1000) : null;
  }

  /** Сработавший приоритет — давший наибольший объём: [ключ, приоритет]. */
  static governing(V) {
    const cand = [
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
      ['tz', 'ТЗ'],
    ].filter(([k]) => V[k] != null);
    return cand.reduce((m, c) => (V[c[0]] > V[m[0]] + EPS ? c : m), cand[0]);
  }

  /** Наименьшее допустимое: по ТЗ — полностью, иначе 80 % нужного и 15 % минутной производительности. */
  static least(gov, theor, Q) {
    return gov[0] === 'tz' ? theor : Math.max(this.M.low * theor, this.M.ratio[0] * Q * 1000);
  }

  /** Мокрый ресивер: задан («основной + мокрый») или по методике при риске проскока влаги. */
  static wet(o, main, risk) {
    const on = o.dryer && (o.mode === 'both' || (!o.mode && risk));
    if (!on || !main) return null;
    const v = main.total * this.M.wet[0];
    return this.size(v, { min: v });
  }

  /** Объёмы по приоритетам, л: p1 всегда, p2 — с циклограммой, p3 — поршневой без неё, tz — по ТЗ. */
  static volumes(o, Q, dp, cyc) {
    const M = this.M;
    const V = { p1: (Q / (M.cycles * dp)) * 1000 };
    if (cyc) V.p2 = Math.max(0, ((cyc.T * (cyc.C - (o.S || Q)) * M.pa) / cyc.drop) * 1000);
    else if (o.piston) V.p3 = M.base.piston * Q * 1000;
    if (o.tz > 0) V.tz = o.tz;
    return V;
  }

  /** Проверки «на здравый смысл» — по составу (если ресиверы в нём есть), иначе по рекомендации. */
  static checks(R, o) {
    const have = o.have || [];
    const dry = have.filter(h => h.role !== 'wet' && h.role !== 'local');
    const wets = have.filter(h => h.role === 'wet');
    const sum = list => list.reduce((s, h) => s + (h.vol || 0) * (h.qty || 1), 0);
    const main = this.mainVolume(R, dry, sum);
    const all = main + this.wetVolume(R, wets, sum);
    const ctx = { R, o, have, dry, wets, main, all };
    return [
      ...this.checkVolume(ctx),
      ...this.checkPressure(ctx),
      ...this.checkDead(ctx),
      ...this.checkRow(ctx),
      ...this.checkMoisture(ctx),
    ];
  }

  static mainVolume(R, dry, sum) {
    if (dry.length && dry.every(h => h.vol > 0)) return sum(dry);
    return R.main ? R.main.total : 0;
  }

  static wetVolume(R, wets, sum) {
    if (wets.length) return sum(wets);
    return R.wet ? R.wet.total : 0;
  }

  /** Избыточность, недобор и объём к минутной производительности наибольшего компрессора. */
  static checkVolume({ R, main }) {
    const M = this.M;
    const l = v => this.l(v);
    const q = this.f(R.Q);
    const minute = R.Q * 1000;
    return [
      main > M.excess * R.theor && {
        level: 'warn',
        text: `Запас превышает 200% (${l(main)} л на ${l(R.theor)} л). Рассмотреть переход на 500 л или пересмотр количества ресиверов.`,
      },
      main < M.low * R.theor && {
        level: 'error',
        text: `Объём ниже минимально допустимого (${l(main)} л при нужных ${l(R.theor)} л). Расчёт некорректен.`,
      },
      main < M.ratio[0] * minute && {
        level: 'warn',
        text: `Объём менее 15% минутной производительности (${l(main)} л при ${q} м³/мин) — риск частых циклов и пульсаций.`,
      },
      main > M.ratio[1] * minute && {
        level: 'warn',
        text: `Объём более 5-кратной минутной производительности (${l(main)} л при ${q} м³/мин) — неоправданно велик, если нет задачи длительного буфера.`,
      },
    ].filter(Boolean);
  }

  /** Давление: номинал ресивера — с запасом над компрессором, уставка клапана — не выше номинала. */
  static checkPressure({ o, have }) {
    const rated = have.filter(h => h.bar > 0);
    const pmin = rated.length ? Math.min(...rated.map(h => h.bar)) : 0;
    if (!(pmin > 0)) return [];
    const f = v => this.f(v);
    return [
      o.bar > 0 &&
        pmin < o.bar + this.M.margin - EPS && {
          level: 'error',
          text: `Ресивер должен иметь запас по давлению минимум 1–2 бар относительно максимального давления компрессора (ресивер ${f(pmin)} бар, компрессор ${f(o.bar)} бар).`,
        },
      o.valve > 0 &&
        o.valve > pmin + EPS && {
          level: 'error',
          text: `Уставка предохранительного клапана превышает номинал ресивера (${f(o.valve)} бар > ${f(pmin)} бар).`,
        },
    ].filter(Boolean);
  }

  /** «Мёртвый объём» — к пиковому разбору за цикл. */
  static checkDead({ R, all }) {
    if (!(R.V.p2 > 0) || !(all > this.M.dead * R.V.p2)) return [];
    return [
      {
        level: 'warn',
        text: `Система имеет избыточную аккумулирующую способность (${this.l(all)} л при пиковом разборе ${this.l(R.V.p2)} л за цикл). Возможно снижение энергоэффективности из-за длительного нахождения воздуха в ресивере (конденсат, потери тепла).`,
      },
    ];
  }

  static offRow(v) {
    return Math.abs(v / this.UNIT - Math.round(v / this.UNIT)) > 1e-6;
  }

  /** Ряд 900 / 500 л и обоснование 500 л. */
  static checkRow(ctx) {
    return [this.rowError(ctx), this.smallWarn(ctx)].filter(Boolean);
  }

  static rowError({ have, dry, main }) {
    const bad = have.filter(h => h.vol > 0 && h.role !== 'local' && h.vol !== this.SMALL && this.offRow(h.vol));
    const all500 = dry.length && dry.every(h => h.vol === this.SMALL);
    const mainOff = dry.length && main > 0 && main !== this.SMALL && !all500 && this.offRow(main);
    if (!bad.length && !mainOff) return null;
    const list = [...new Set(bad.map(h => `${this.l(h.vol)} л`))].join(', ') || `${this.l(main)} л`;
    return {
      level: 'error',
      text: `Нарушено правило типоразмерного ряда (${list}: объём — кратно ${this.l(this.UNIT)} л или ${this.l(this.SMALL)} л). Пересчитать.`,
    };
  }

  static smallWarn({ R, o, dry }) {
    const small = dry.length ? dry.some(h => h.vol === this.SMALL) : R.main && R.main.size === this.SMALL;
    const grounded = this.UNIT > this.M.excess * R.theor || o.space || ['space', 'mass'].includes(o.reason);
    if (!small || grounded) return null;
    return {
      level: 'warn',
      text: '500 л применён без достаточного обоснования. Проверить необходимость использования 900 л.',
    };
  }

  /** Резкое падение давления: без мокрого ресивера — проскок влаги через осушитель. */
  static checkMoisture({ R, o, have, wets }) {
    const peak = Math.max(R.cyc ? R.cyc.C : 0, o.point || 0);
    const wetPlanned = R.wet && !have.length;
    if (!o.dryer || !(o.dryerCap > 0) || !(peak > o.dryerCap) || wets.length || wetPlanned) return [];
    return [
      {
        level: 'warn',
        text: `Возможен проскок влаги через осушитель при резком падении давления (пик ${this.f(peak)} м³/мин больше производительности осушителя ${this.f(o.dryerCap)} м³/мин). Рассмотреть установку мокрого ресивера.`,
      },
    ];
  }

  /** Одной строкой: «основной 900 л × 3 = 2 700 л (после осушителя); мокрый 500 л × 1 (до осушителя)». */
  static text(R) {
    const unit = (x, w) => (x ? `${w} ${this.l(x.size)} л × ${x.n}${x.n > 1 ? ` = ${this.l(x.total)} л` : ''}` : '');
    return [
      unit(R.main, 'основной') + this.where(R),
      R.wet ? `${unit(R.wet, 'мокрый')} (до осушителя)` : '',
      R.local ? unit(R.local, 'у потребителя') : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  static where(R) {
    if (R.mode === 'before') return ' (до осушителя)';
    return R.wet || R.dryer || R.mode === 'after' ? ' (после осушителя)' : '';
  }

  /** Расчёт по составу станции: eq — StationEquip.list, rq — StationReq.recvIn. */
  static from(eq, rq = {}) {
    const C = (eq || []).filter(e => e.kind === 'compressor' && e.air && e.air.flow > 0);
    if (!C.length) return null;
    const big = C.reduce((m, e) => (e.air.flow > m.air.flow ? e : m), C[0]);
    const total = C.reduce((s, e) => s + e.air.flow * (e.qty || 1), 0);
    const bar = Math.max(0, ...C.map(e => e.air.bar || 0));
    const D = eq.filter(e => e.kind === 'dryer' && e.air && e.air.type !== 'gen');
    const dryerCap =
      D.length && D.every(e => e.air.flow > 0)
        ? D.reduce((s, e) => s + e.air.flow * (e.qty || 1), 0) * AirChain.kp(bar)
        : 0;
    const have = this.have(eq);
    const R = this.calc({
      Q: big.air.flow,
      piston: big.ctype === 'piston',
      S: Math.max(big.air.flow, total - Math.max(0, rq.reserve || 0) * big.air.flow),
      dp: rq.dp,
      cyc: rq.cyc,
      point: rq.point,
      tz: rq.tz,
      dryer: D.length > 0 || C.some(e => e.air.dryer),
      dryerCap,
      mode: rq.mode,
      force: rq.force,
      reason: rq.reason,
      auto: rq.auto,
      space: rq.space,
      bar,
      valve: rq.valve,
      have,
    });
    if (R) Object.assign(R, { big, have, bar, dryerCap });
    return R;
  }

  /** Ресиверы состава: в станции и у потребителя. */
  static have(eq) {
    const inside = eq
      .filter(e => e.kind === 'receiver' && e.air)
      .map(e => ({
        vol: e.air.vol || 0,
        qty: e.qty || 1,
        bar: e.air.bar || 0,
        role: e.air.role === 'wet' ? 'wet' : 'dry',
        pos: e.pos,
      }));
    const local = eq.filter(e => e.local).map(e => ({ vol: e.vol || 0, qty: e.qty || 1, bar: 0, role: 'local' }));
    return [...inside, ...local];
  }
}
