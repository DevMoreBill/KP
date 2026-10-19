import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { ReceiverPlan } from './receiver-plan.js';

const n = v => Mm.text(v);
const m3 = v => AirChain.m3(v);
const pos = e => `поз. ${e.pos}`;
const uniq = list => [...new Set(list)];
const sumFlow = list => list.reduce((s, e) => s + e.air.flow * e.qty, 0);

/** Проверка цепочки подготовки воздуха и что добавить в состав (рекомендации для подбора в каталоге). */
export class AirCheck {
  constructor(eq, cls, rq) {
    this.eq = eq;
    this.cls = cls;
    this.rq = rq;
    this.A = AirChain.expand(eq.filter(e => e.air && e.air.stage != null && (e.place !== false || e.outside)));
    this.C = this.A.filter(e => e.kind === 'compressor');
    this.D = this.A.filter(e => e.kind === 'dryer' && e.air.type !== 'gen');
    this.ads = this.D.filter(e => e.air.type === 'ads');
    this.refrig = this.D.filter(e => e.air.type === 'refrig');
    this.F = this.A.filter(e => e.kind === 'filter');
    this.R = this.A.filter(e => e.kind === 'receiver');
    this.q = sumFlow(this.C.filter(e => e.air.flow > 0));
    this.bar = Math.max(0, ...this.C.map(e => e.air.bar || 0)) || 8;
    this.builtDryer = this.C.some(e => e.air.dryer);
    this.builtFilter = this.C.some(e => e.air.filter) || this.D.some(e => e.air.filters);
    this.iss = [];
    this.recs = [];
    this.keys = new Set();
  }

  /** @returns {object | null} */
  run() {
    if (!this.C.length) return null;
    this.stages();
    this.capacity();
    this.registered();
    this.noDryer();
    this.receiverBar();
    const cl = this.purity();
    return this.result(cl);
  }

  grade(g) {
    return this.F.filter(e => e.air.grade === g);
  }

  issue(level, text) {
    this.iss.push({ level, air: true, text });
  }

  rec(key, o) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.recs.push({ key, ...o });
  }

  need(v, unit) {
    return {
      k: unit === 'л' ? 'Объём' : 'Производительность',
      v: `не менее ${unit === 'л' ? n(v) : m3(v)} ${unit}`,
    };
  }

  /** Что добавить: фильтр ступени grade. */
  filterRec(grade, why) {
    const G = AirChain.GRADES[grade];
    const q = this.q;
    const flow = q / AirChain.kf(this.bar);
    this.rec(grade, {
      title: G.name,
      why,
      cat: 'filter',
      name: G.name,
      f: G.stage ? { stage: G.stage } : {},
      r: q ? { flow: [m3(flow), ''] } : {},
      attrs: { cat: 'filter', stage: G.stage || undefined },
      rows: [...(G.stage ? [{ k: 'Ступень очистки', v: G.stage }] : []), ...(q ? [this.need(flow, 'м³/мин')] : [])],
    });
  }

  /** Ступени очистки по виду осушителя. */
  stages() {
    if (this.ads.length) this.adsStages();
    if (this.ads.length && this.q > 0) {
      const purge = AirChain.PURGE;
      this.issue(
        'info',
        `Адсорбционный осушитель (${this.ads.map(pos).join(', ')}) без нагрева расходует на продувку ${Math.round(purge * 100)}–20 % сжатого воздуха: потребителю останется около ${m3(this.q * (1 - purge))} м³/мин из ${m3(this.q)}. Учитывайте при подборе компрессоров; осушитель с нагревом или с управлением по точке росы расходует меньше.`,
      );
    }
    if (this.refrig.length && !this.F.length && !this.builtFilter) {
      this.issue(
        'info',
        'Фильтров в составе нет: перед рефрижераторным осушителем рекомендуется фильтр предварительной очистки (защищает теплообменник), после — тонкой очистки от масла (0,01 мкм), если в осушителе их нет.',
      );
      this.filterRec('pre', 'перед рефрижераторным осушителем — защищает теплообменник');
      this.filterRec('micro', 'после рефрижераторного осушителя — масляный аэрозоль');
    }
    if (this.grade('carbon').length && !this.grade('micro').length && !this.grade('fine').length) {
      this.issue(
        'info',
        `Угольный фильтр (${this.grade('carbon').map(pos).join(', ')}) ставят после фильтра тонкой очистки от масла — иначе уголь быстро насыщается.`,
      );
    }
  }

  adsStages() {
    const built = this.ads.every(e => e.air.filters);
    const before = this.F.filter(e => (e.air.grade === 'micro' || e.air.grade === 'fine') && e.air.stage < 45);
    if (!before.length && !built) {
      this.issue(
        'warn',
        `Перед адсорбционным осушителем (${this.ads.map(pos).join(', ')}) нужен фильтр очистки от масла (коалесцентный, 0,01 мкм): масло выводит адсорбент из строя. Добавьте фильтр в состав.`,
      );
      this.filterRec('micro', 'перед адсорбционным осушителем — всегда: масло выводит адсорбент из строя');
    }
    if (!this.grade('dust').length && !built) {
      this.issue(
        'info',
        'После адсорбционного осушителя рекомендуется пылевой фильтр (1 мкм) — задерживает пыль адсорбента.',
      );
      this.filterRec('dust', 'после адсорбционного осушителя — задерживает пыль адсорбента');
    }
  }

  /** Производительность осушителей и фильтров, ресиверы по методике. */
  capacity() {
    if (!(this.q > 0)) return;
    this.dryerCapacity();
    this.filterCapacity();
    this.receivers();
  }

  dryerNeed() {
    return (this.q * AirChain.MARGIN) / AirChain.kp(this.bar);
  }

  dryerRec(type, why, extra = {}) {
    const ads = type === 'ads';
    const cat = ads ? 'dryer_ads' : 'dryer_refrig';
    const word = ads ? 'Адсорбционный' : 'Рефрижераторный';
    const need = this.q ? this.dryerNeed() : 0;
    const flow = need ? ` не менее ${m3(need)} м³/мин` : '';
    this.rec(`dryer-${type}`, {
      title: extra.title || `${word} осушитель${flow}`,
      why,
      cat,
      name: `${word} осушитель`,
      f: extra.f || {},
      r: need ? { flow: [m3(need), ''] } : {},
      attrs: { cat },
      rows: extra.rows || (need ? [this.need(need, 'м³/мин')] : []),
    });
  }

  dryerCapacity() {
    const { q, bar } = this;
    const kp = AirChain.kp(bar);
    for (const [type, list] of [
      ['refrig', this.refrig],
      ['ads', this.ads],
    ]) {
      if (!list.length || list.some(e => !(e.air.flow > 0))) continue;
      const cap = sumFlow(list) * kp;
      const ids = list.map(pos).join(', ');
      if (cap < q * 0.98) {
        this.issue(
          'warn',
          `Осушитель (${ids}): ${m3(cap)} м³/мин при ${m3(bar)} бар — меньше производительности компрессоров ${m3(q)} м³/мин. Нужен не менее ${m3(this.dryerNeed())} м³/мин (номинал при 7 бар).`,
        );
        this.dryerRec(type, 'производительность — с запасом на лето и давление');
      } else if (cap < q * AirChain.MARGIN) {
        this.issue(
          'info',
          `Осушитель (${ids}) почти без запаса: ${m3(cap)} м³/мин при ${m3(bar)} бар на ${m3(q)} м³/мин компрессоров. Летом при +40 °C на входе производительность осушителя падает примерно на 20 % — рекомендуется запас ${Math.round((AirChain.MARGIN - 1) * 100)} % и больше.`,
        );
      }
    }
  }

  /** Фильтры одной ступени — параллельно: пропускная способность складывается. */
  filterCapacity() {
    const { q, bar } = this;
    const kf = AirChain.kf(bar);
    const groups = AirChain.groups([...this.F].sort((a, b) => a.air.stage - b.air.stage)).filter(
      L => L[0].air.grade !== 'cond' && L[0].air.grade !== 'sep' && L.every(e => e.air.flow > 0),
    );
    for (const G of groups) {
      const cap = sumFlow(G) * kf;
      if (cap >= q * 0.98) continue;
      const count = G.reduce((s, x) => s + x.qty, 0);
      const who =
        count > 1 ? `Фильтры ${uniq(G.map(pos)).join(', ')} (${count} шт. параллельно)` : `Фильтр ${pos(G[0])}`;
      this.issue(
        'warn',
        `${who} «${G[0].short}»: ${m3(cap)} м³/мин при ${m3(bar)} бар — меньше производительности компрессоров ${m3(q)} м³/мин: перепад давления растёт, фильтр не держит класс очистки. Нужно не менее ${m3(q / kf)} м³/мин.`,
      );
    }
  }

  recvRec(key, x, { role, title, why, need }) {
    this.rec(key, {
      title,
      why,
      cat: 'receiver',
      name: 'Воздушный ресивер',
      f: {},
      r: { volume: [String(x.size), String(x.size)] },
      total: x.total,
      qty: x.n,
      role,
      need,
      attrs: { cat: 'receiver' },
      rows: [{ k: 'Объём', v: `${n(x.size)} л` }],
    });
  }

  /** Ресиверы по методике ПНЕВМОТЕХ (ReceiverPlan): основной, мокрый, у потребителя. */
  receivers() {
    const RP = ReceiverPlan.from(this.eq, this.rq || {});
    if (!RP) return;
    const dry = this.R.filter(e => e.air.role !== 'wet');
    const wet = this.R.filter(e => e.air.role === 'wet');
    if (RP.main && !dry.length && !this.C.some(e => e.air.recv)) this.mainReceiver(RP);
    if (RP.wet && !wet.length) this.wetReceiver(RP);
    this.moreMain(RP, dry);
    if (RP.wet) this.more(wet, RP.wet, 'receiver-wet-more', 'wet', 'мокрый ресивер');
    if (RP.local && !this.eq.some(e => e.local)) this.localReceiver(RP);
  }

  moreMain(RP, dry) {
    const before = RP.mode === 'before';
    this.more(before ? [] : dry, RP.main, 'receiver-more', before ? 'wet' : 'dry', 'основной ресивер');
  }

  wetReceiver(RP) {
    this.recvRec('receiver-wet', RP.wet, {
      role: 'wet',
      title: `Мокрый ресивер ${n(RP.wet.size)} л (до осушителя)`,
      why: `30–50 % основного; ${RP.wet.why}`,
      need: RP.main.total * ReceiverPlan.M.wet[0],
    });
  }

  localReceiver(RP) {
    this.recvRec('receiver-local', RP.local, {
      role: 'local',
      title: `Локальный ресивер ${n(RP.local.size)} л у потребителя`,
      why: `пик точки больше 50 % производительности компрессора; ${RP.local.why}`,
    });
  }

  mainReceiver(RP) {
    const before = RP.mode === 'before';
    const count = RP.main.n > 1 ? `${RP.main.n} × ` : '';
    const after = this.D.length || this.builtDryer ? ' (после осушителя)' : '';
    this.issue(
      'info',
      `Ресивера в составе нет — по расчёту (приоритет ${RP.prio}) нужно ${n(RP.theor)} л: ${ReceiverPlan.text(RP)}. Ресивер сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже включается.`,
    );
    this.recvRec('receiver', RP.main, {
      role: before ? 'wet' : 'dry',
      title: `Воздушные ресиверы ${count}${n(RP.main.size)} л${before ? ' (до осушителя)' : after}`,
      why: `нужно ${n(RP.theor)} л (приоритет ${RP.prio}); ${RP.main.why}`,
      need: RP.theor,
    });
  }

  /** Ресиверы есть, но меньше расчёта — добрать по 900 л. */
  more(list, x, key, role, what) {
    const U = ReceiverPlan.UNIT;
    const have = list.reduce((t, e) => t + (e.air.vol || 0) * e.qty, 0);
    const add = x ? Math.ceil((x.total - have) / U - 1e-9) : 0;
    if (!list.length || !x || x.size !== U || !list.every(e => e.air.vol === U) || add <= 0) return;
    this.recvRec(
      key,
      { size: U, n: add, total: add * U },
      {
        role,
        title: `Ещё ${add} × ${n(U)} л (${what})`,
        why: `в составе ${n(have)} л, по расчёту — ${n(x.total)} л`,
        need: x.total - have,
      },
    );
  }

  /** Ресиверы на учёте в Ростехнадзоре: несколько меньших — каждый без учёта. */
  registered() {
    const { bar } = this;
    const reg = this.R.filter(e => e.air.vol > 0 && AirChain.pv(bar, e.air.vol) > PressureVessel.LIMIT + 1e-9);
    const total = reg.reduce((s, e) => s + e.air.vol * e.qty, 0);
    const rs = total ? AirChain.base(total, bar) || AirChain.split(total, bar) : null;
    if (!rs) return;
    const who = uniq(reg.map(pos)).join(', ');
    this.issue(
      'info',
      `Ресивер ${who}: p·V больше 1,0 МПа·м³ — подлежит учёту в Ростехнадзоре. Без учёта — ${rs.n} ресивера по ${n(rs.v)} л (p·V каждого — ${m3(AirChain.pv(bar, rs.v))} МПа·м³): замена — на вкладке «Компоновка».`,
    );
    this.rec('recv-split', {
      title: `Ресиверы ${rs.n} × ${n(rs.v)} л вместо ${who} — без учёта в Ростехнадзоре`,
      why: `вместе ${n(rs.n * rs.v)} л; p·V каждого не больше 1,0 МПа·м³`,
      cat: 'receiver',
      name: 'Воздушный ресивер',
      f: {},
      r: { volume: [String(Math.round(rs.v * 0.8)), String(rs.v)] },
      qty: rs.n,
      replace: uniq(reg.map(e => e.id)),
      attrs: { cat: 'receiver' },
      rows: [{ k: 'Объём', v: `${n(rs.v)} л` }],
    });
  }

  /** Осушителя нет и класс чистоты не задан — обычно рефрижераторный с байпасом. */
  noDryer() {
    if (this.D.length || this.builtDryer || String(this.cls || '').trim()) return;
    const need = this.q ? this.dryerNeed() : 0;
    const flow = need ? ` не менее ${m3(need)} м³/мин` : '';
    this.issue(
      'info',
      `Осушителя в составе нет: влага остаётся в сжатом воздухе — конденсат в трубах и у потребителей, зимой замерзает. Обычно ставят рефрижераторный осушитель (точка росы +3 °C)${flow} с байпасом — подбор на вкладке «Компоновка».`,
    );
    this.dryerRec('refrig', 'точка росы +3 °C: без конденсата в трубах; ставится с байпасом', {
      rows: need ? [{ k: 'Производительность', v: `не менее ${m3(need)} м³/мин` }] : [],
    });
  }

  /** Ресивер — на давление не ниже компрессорного. */
  receiverBar() {
    const cb = Math.max(0, ...this.C.map(e => e.air.bar || 0));
    for (const e of this.R.filter(x => x.air.bar > 0 && cb > x.air.bar + 0.05)) {
      this.issue(
        'warn',
        `Ресивер ${pos(e)} рассчитан на ${m3(e.air.bar)} бар — меньше давления компрессоров ${m3(cb)} бар: нужен ресивер не ниже ${m3(cb)} бар.`,
      );
    }
  }

  /** Класс чистоты по ISO 8573-1: какой осушитель и какие ступени фильтров нужны. */
  purity() {
    const cl = String(this.cls || '').match(/^([1-6])\.([1-6])\.([1-4])$/);
    if (!cl) return null;
    const before = this.recs.length;
    const [pc, wc, oc] = cl.slice(1).map(Number);
    this.purityDryer(wc);
    this.purityFilters(pc, oc);
    if (this.recs.length > before) {
      const missing = this.recs
        .slice(before)
        .map(x =>
          x.title
            .replace(/\s*\(.*?\)/g, '')
            .replace(/,.*$/, '')
            .toLowerCase(),
        )
        .join(', ');
      this.issue('info', `Для класса ${this.cls} в составе не хватает: ${missing} — подбор на вкладке «Компоновка».`);
    }
    return cl;
  }

  dewText(pdp) {
    return `${pdp > 0 ? '+' : '−'}${Math.abs(pdp)} °C`;
  }

  dewPoint(pdp) {
    if (pdp <= -70) return '−70';
    return pdp <= -40 ? '−40' : '−20';
  }

  purityDryer(wc) {
    const { cls, q } = this;
    const pdp = AirChain.PDP[wc];
    const dp = this.dewText(pdp);
    const need = q ? this.dryerNeed() : 0;
    if (wc <= 3 && !this.ads.some(e => e.air.pdp == null || e.air.pdp <= pdp)) {
      const refrig = this.refrig.length || this.builtDryer ? ' (рефрижераторный даёт +3 °C)' : '';
      this.issue('warn', `Класс ${cls}: точка росы ${dp} — нужен адсорбционный осушитель${refrig}.`);
      this.dryerRec('ads', `класс воды ${wc} по ISO 8573-1`, {
        title: `Адсорбционный осушитель (точка росы ${dp})${need ? `, не менее ${m3(need)} м³/мин` : ''}`,
        f: { dewPoint: this.dewPoint(pdp) },
        rows: [{ k: 'Точка росы', v: dp }, ...(need ? [this.need(need, 'м³/мин')] : [])],
      });
      if (!this.grade('micro').length) this.filterRec('micro', 'перед адсорбционным осушителем — всегда');
    } else if (wc <= 6 && !(this.D.length || this.builtDryer)) {
      this.issue('warn', `Класс ${cls}: точка росы ${dp} — нужен осушитель (рефрижераторный).`);
      this.dryerRec('refrig', `класс воды ${wc} по ISO 8573-1 — точка росы до ${dp}`);
    }
  }

  purityFilters(pc, oc) {
    const { cls } = this;
    const want = (grades, why) => {
      const have = grades.some(x => this.grade(x).length);
      const built = this.builtFilter && grades.some(x => x === 'pre' || x === 'fine');
      if (!have && !built) this.filterRec(grades[0], why);
    };
    if (pc === 1 || oc === 1) want(['micro'], `класс ${cls}: частицы и масло — до 0,01 мкм и 0,01 мг/м³`);
    else if (pc === 2 || oc === 2) want(['fine', 'micro'], `класс ${cls}: частицы до 1 мкм, масло до 0,1 мг/м³`);
    else if (pc <= 3 || oc <= 3) want(['pre', 'fine', 'micro'], `класс ${cls}: частицы до 5 мкм, масло до 1 мг/м³`);
    if (oc === 1 && !this.grade('carbon').length)
      this.filterRec('carbon', 'класс масла 1 — с парами масла (0,003 мг/м³)');
  }

  word(e) {
    const a = e.air;
    const words = {
      compressor: () => `компрессор${a.dryer ? ' со встроенным осушителем' : ''}`,
      receiver: () => `${this.receiverWord(a)}${a.out ? ' снаружи' : ''}`,
      dryer: () =>
        `${{ ads: 'адсорбционный осушитель', gen: 'генератор' }[a.type] || 'рефрижераторный осушитель'}${a.filters ? ' (встроенные фильтры)' : ''}`,
    }[e.kind];
    return words ? words() : `фильтр ${AirChain.GRADES[a.grade].short}`;
  }

  receiverWord(a) {
    if (a.role === 'dry' && this.D.length) return '«сухой» ресивер';
    return a.role === 'dry' && this.F.length ? 'ресивер после фильтров' : 'ресивер';
  }

  /** Цепочка по ходу воздуха, единицы для схемы и очистка конденсата (не на линии). */
  result(cl) {
    const order = this.A.filter(e => e.kind !== 'filter' || e.air.grade !== 'cond').sort(
      (a, b) => a.air.stage - b.air.stage,
    );
    const chain = order.map(e => ({ pos: e.pos, kind: e.kind, text: this.word(e), guess: Boolean(e.air.guess) }));
    const units = order.map(e => ({
      pos: e.pos,
      kind: e.kind,
      qty: e.qty || 1,
      name: e.name,
      brief: e.brief,
      short: e.short,
      air: e.air,
    }));
    const cond = this.eq
      .filter(e => e.kind === 'filter' && e.air && e.air.grade === 'cond' && e.place !== false)
      .map(e => ({ pos: e.pos, qty: e.qty || 1, name: e.name, brief: e.brief }));
    return {
      chain,
      q: this.q,
      bar: this.bar,
      issues: this.iss,
      recs: this.recs,
      cls: cl ? String(this.cls) : '',
      units,
      cond,
    };
  }
}
