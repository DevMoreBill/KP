import { Num } from './num.js';
import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { ReceiverPlan } from './receiver-plan.js';

/** Проверка цепочки подготовки воздуха и что добавить в состав (рекомендации для подбора в каталоге). */
export class AirCheck {
  static _pos = unit => `поз. ${unit.pos}`;

  static _sumFlow = list => list.reduce((acc, unit) => acc + unit.air.flow * unit.qty, 0);

  constructor(equip, cls, req) {
    this.equip = equip;
    this.cls = cls;
    this.req = req;
    this.units = AirChain.expand(
      equip.filter(unit => unit.air && unit.air.stage != null && (unit.place !== false || unit.outside)),
    );
    this.comps = this.units.filter(unit => unit.kind === 'compressor');
    this.dryers = this.units.filter(unit => unit.kind === 'dryer' && unit.air.type !== 'gen');
    this.ads = this.dryers.filter(unit => unit.air.type === 'ads');
    this.refrig = this.dryers.filter(unit => unit.air.type === 'refrig');
    this.filters = this.units.filter(unit => unit.kind === 'filter');
    this.recvUnits = this.units.filter(unit => unit.kind === 'receiver');
    this.flow = AirCheck._sumFlow(this.comps.filter(unit => unit.air.flow > 0));
    this.bar = Math.max(0, ...this.comps.map(unit => unit.air.bar || 0)) || 8;
    this.builtDryer = this.comps.some(unit => unit.air.dryer);
    this.builtFilter = this.comps.some(unit => unit.air.filter) || this.dryers.some(unit => unit.air.filters);
    this.iss = [];
    this.recs = [];
    this.keys = new Set();
  }

  /** @returns {object | null} */
  run() {
    if (!this.comps.length) return null;
    this.stages();
    this.capacity();
    this.registered();
    this.noDryer();
    this.receiverBar();
    const cls = this.purity();
    return this.result(cls);
  }

  grade(grade) {
    return this.filters.filter(unit => unit.air.grade === grade);
  }

  issue(level, text) {
    this.iss.push({ level, air: true, text });
  }

  rec(key, rec) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.recs.push({ key, ...rec });
  }

  need(v, unit) {
    return {
      k: unit === 'л' ? 'Объём' : 'Производительность',
      v: `не менее ${unit === 'л' ? Mm.text(v) : AirChain.flowText(v)} ${unit}`,
    };
  }

  /** Что добавить: фильтр ступени grade. */
  filterRec(grade, why) {
    const gradeInfo = AirChain.GRADES[grade];
    const rate = this.flow;
    const flow = rate / AirChain.filterK(this.bar);
    this.rec(grade, {
      title: gradeInfo.name,
      why,
      cat: 'filter',
      name: gradeInfo.name,
      f: gradeInfo.stage ? { stage: gradeInfo.stage } : {},
      r: rate ? { flow: [AirChain.flowText(flow), ''] } : {},
      attrs: { cat: 'filter', stage: gradeInfo.stage || undefined },
      rows: [
        ...(gradeInfo.stage ? [{ k: 'Ступень очистки', v: gradeInfo.stage }] : []),
        ...(rate ? [this.need(flow, 'м³/мин')] : []),
      ],
    });
  }

  /** Ступени очистки по виду осушителя. */
  stages() {
    if (this.ads.length) this.adsStages();
    if (this.ads.length && this.flow > 0) {
      const purge = AirChain.PURGE;
      this.issue(
        'info',
        `Адсорбционный осушитель (${this.ads.map(AirCheck._pos).join(', ')}) без нагрева расходует на продувку ${Math.round(purge * 100)}–20 % сжатого воздуха: потребителю останется около ${AirChain.flowText(this.flow * (1 - purge))} м³/мин из ${AirChain.flowText(this.flow)}. Учитывайте при подборе компрессоров; осушитель с нагревом или с управлением по точке росы расходует меньше.`,
      );
    }
    if (this.refrig.length && !this.filters.length && !this.builtFilter) {
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
        `Угольный фильтр (${this.grade('carbon').map(AirCheck._pos).join(', ')}) ставят после фильтра тонкой очистки от масла — иначе уголь быстро насыщается.`,
      );
    }
  }

  adsStages() {
    const built = this.ads.every(unit => unit.air.filters);
    const before = this.filters.filter(
      unit => (unit.air.grade === 'micro' || unit.air.grade === 'fine') && unit.air.stage < 45,
    );
    if (!before.length && !built) {
      this.issue(
        'warn',
        `Перед адсорбционным осушителем (${this.ads.map(AirCheck._pos).join(', ')}) нужен фильтр очистки от масла (коалесцентный, 0,01 мкм): масло выводит адсорбент из строя. Добавьте фильтр в состав.`,
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
    if (!(this.flow > 0)) return;
    this.dryerCapacity();
    this.filterCapacity();
    this.receivers();
  }

  dryerNeed() {
    return (this.flow * AirChain.MARGIN) / AirChain.dryerK(this.bar);
  }

  dryerRec(type, why, extra = {}) {
    const ads = type === 'ads';
    const cat = ads ? 'dryer_ads' : 'dryer_refrig';
    const word = ads ? 'Адсорбционный' : 'Рефрижераторный';
    const need = this.flow ? this.dryerNeed() : 0;
    const flow = need ? ` не менее ${AirChain.flowText(need)} м³/мин` : '';
    this.rec(`dryer-${type}`, {
      title: extra.title || `${word} осушитель${flow}`,
      why,
      cat,
      name: `${word} осушитель`,
      f: extra.f || {},
      r: need ? { flow: [AirChain.flowText(need), ''] } : {},
      attrs: { cat },
      rows: extra.rows || (need ? [this.need(need, 'м³/мин')] : []),
    });
  }

  dryerCapacity() {
    const { flow: flow, bar } = this;
    const dryerK = AirChain.dryerK(bar);
    for (const [type, list] of [
      ['refrig', this.refrig],
      ['ads', this.ads],
    ]) {
      if (!list.length || list.some(unit => !(unit.air.flow > 0))) continue;
      const cap = AirCheck._sumFlow(list) * dryerK;
      const ids = list.map(AirCheck._pos).join(', ');
      if (cap < flow * 0.98) {
        this.issue(
          'warn',
          `Осушитель (${ids}): ${AirChain.flowText(cap)} м³/мин при ${AirChain.flowText(bar)} бар — меньше производительности компрессоров ${AirChain.flowText(flow)} м³/мин. Нужен не менее ${AirChain.flowText(this.dryerNeed())} м³/мин (номинал при 7 бар).`,
        );
        this.dryerRec(type, 'производительность — с запасом на лето и давление');
      } else if (cap < flow * AirChain.MARGIN) {
        this.issue(
          'info',
          `Осушитель (${ids}) почти без запаса: ${AirChain.flowText(cap)} м³/мин при ${AirChain.flowText(bar)} бар на ${AirChain.flowText(flow)} м³/мин компрессоров. Летом при +40 °C на входе производительность осушителя падает примерно на 20 % — рекомендуется запас ${Math.round((AirChain.MARGIN - 1) * 100)} % и больше.`,
        );
      }
    }
  }

  /** Фильтры одной ступени — параллельно: пропускная способность складывается. */
  filterCapacity() {
    const { flow: flow, bar } = this;
    const filterK = AirChain.filterK(bar);
    const groups = AirChain.groups([...this.filters].sort((left, right) => left.air.stage - right.air.stage)).filter(
      group => group[0].air.grade !== 'cond' && group[0].air.grade !== 'sep' && group.every(unit => unit.air.flow > 0),
    );
    for (const stageGroup of groups) {
      const cap = AirCheck._sumFlow(stageGroup) * filterK;
      if (cap >= flow * 0.98) continue;
      const count = stageGroup.reduce((acc, x) => acc + x.qty, 0);
      const who =
        count > 1
          ? `Фильтры ${Num.uniq(stageGroup.map(AirCheck._pos)).join(', ')} (${count} шт. параллельно)`
          : `Фильтр ${AirCheck._pos(stageGroup[0])}`;
      this.issue(
        'warn',
        `${who} «${stageGroup[0].short}»: ${AirChain.flowText(cap)} м³/мин при ${AirChain.flowText(bar)} бар — меньше производительности компрессоров ${AirChain.flowText(flow)} м³/мин: перепад давления растёт, фильтр не держит класс очистки. Нужно не менее ${AirChain.flowText(flow / filterK)} м³/мин.`,
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
      rows: [{ k: 'Объём', v: `${Mm.text(x.size)} л` }],
    });
  }

  /** Ресиверы по методике ПНЕВМОТЕХ (ReceiverPlan): основной, мокрый, у потребителя. */
  receivers() {
    const plan = ReceiverPlan.from(this.equip, this.req || {});
    if (!plan) return;
    const dry = this.recvUnits.filter(unit => unit.air.role !== 'wet');
    const wet = this.recvUnits.filter(unit => unit.air.role === 'wet');
    if (plan.main && !dry.length && !this.comps.some(unit => unit.air.recv)) this.mainReceiver(plan);
    if (plan.wet && !wet.length) this.wetReceiver(plan);
    this.moreMain(plan, dry);
    if (plan.wet) this.more(wet, plan.wet, 'receiver-wet-more', 'wet', 'мокрый ресивер');
    if (plan.local && !this.equip.some(unit => unit.local)) this.localReceiver(plan);
  }

  moreMain(plan, dry) {
    const before = plan.mode === 'before';
    this.more(before ? [] : dry, plan.main, 'receiver-more', before ? 'wet' : 'dry', 'основной ресивер');
  }

  wetReceiver(plan) {
    this.recvRec('receiver-wet', plan.wet, {
      role: 'wet',
      title: `Мокрый ресивер ${Mm.text(plan.wet.size)} л (до осушителя)`,
      why: `30–50 % основного; ${plan.wet.why}`,
      need: plan.main.total * ReceiverPlan.METHOD.wet[0],
    });
  }

  localReceiver(plan) {
    this.recvRec('receiver-local', plan.local, {
      role: 'local',
      title: `Локальный ресивер ${Mm.text(plan.local.size)} л у потребителя`,
      why: `пик точки больше 50 % производительности компрессора; ${plan.local.why}`,
    });
  }

  mainReceiver(plan) {
    const before = plan.mode === 'before';
    const count = plan.main.n > 1 ? `${plan.main.n} × ` : '';
    const after = this.dryers.length || this.builtDryer ? ' (после осушителя)' : '';
    this.issue(
      'info',
      `Ресивера в составе нет — по расчёту (приоритет ${plan.prio}) нужно ${Mm.text(plan.theor)} л: ${ReceiverPlan.text(plan)}. Ресивер сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже включается.`,
    );
    this.recvRec('receiver', plan.main, {
      role: before ? 'wet' : 'dry',
      title: `Воздушные ресиверы ${count}${Mm.text(plan.main.size)} л${before ? ' (до осушителя)' : after}`,
      why: `нужно ${Mm.text(plan.theor)} л (приоритет ${plan.prio}); ${plan.main.why}`,
      need: plan.theor,
    });
  }

  /** Ресиверы есть, но меньше расчёта — добрать по 900 л. */
  more(list, x, key, role, what) {
    const unitVol = ReceiverPlan.UNIT;
    const have = list.reduce((acc, unit) => acc + (unit.air.vol || 0) * unit.qty, 0);
    const add = x ? Math.ceil((x.total - have) / unitVol - 1e-9) : 0;
    if (!list.length || !x || x.size !== unitVol || !list.every(unit => unit.air.vol === unitVol) || add <= 0) return;
    this.recvRec(
      key,
      { size: unitVol, n: add, total: add * unitVol },
      {
        role,
        title: `Ещё ${add} × ${Mm.text(unitVol)} л (${what})`,
        why: `в составе ${Mm.text(have)} л, по расчёту — ${Mm.text(x.total)} л`,
        need: x.total - have,
      },
    );
  }

  /** Ресиверы на учёте в Ростехнадзоре: несколько меньших — каждый без учёта. */
  registered() {
    const { bar } = this;
    const reg = this.recvUnits.filter(
      unit => unit.air.vol > 0 && AirChain.pvProduct(bar, unit.air.vol) > PressureVessel.LIMIT + 1e-9,
    );
    const total = reg.reduce((acc, unit) => acc + unit.air.vol * unit.qty, 0);
    const split = total ? AirChain.base(total, bar) || AirChain.split(total, bar) : null;
    if (!split) return;
    const who = Num.uniq(reg.map(AirCheck._pos)).join(', ');
    this.issue(
      'info',
      `Ресивер ${who}: p·V больше 1,0 МПа·м³ — подлежит учёту в Ростехнадзоре. Без учёта — ${split.n} ресивера по ${Mm.text(split.v)} л (p·V каждого — ${AirChain.flowText(AirChain.pvProduct(bar, split.v))} МПа·м³): замена — на вкладке «Компоновка».`,
    );
    this.rec('recv-split', {
      title: `Ресиверы ${split.n} × ${Mm.text(split.v)} л вместо ${who} — без учёта в Ростехнадзоре`,
      why: `вместе ${Mm.text(split.n * split.v)} л; p·V каждого не больше 1,0 МПа·м³`,
      cat: 'receiver',
      name: 'Воздушный ресивер',
      f: {},
      r: { volume: [String(Math.round(split.v * 0.8)), String(split.v)] },
      qty: split.n,
      replace: Num.uniq(reg.map(unit => unit.id)),
      attrs: { cat: 'receiver' },
      rows: [{ k: 'Объём', v: `${Mm.text(split.v)} л` }],
    });
  }

  /** Осушителя нет и класс чистоты не задан — обычно рефрижераторный с байпасом. */
  noDryer() {
    if (this.dryers.length || this.builtDryer || String(this.cls || '').trim()) return;
    const need = this.flow ? this.dryerNeed() : 0;
    const flow = need ? ` не менее ${AirChain.flowText(need)} м³/мин` : '';
    this.issue(
      'info',
      `Осушителя в составе нет: влага остаётся в сжатом воздухе — конденсат в трубах и у потребителей, зимой замерзает. Обычно ставят рефрижераторный осушитель (точка росы +3 °C)${flow} с байпасом — подбор на вкладке «Компоновка».`,
    );
    this.dryerRec('refrig', 'точка росы +3 °C: без конденсата в трубах; ставится с байпасом', {
      rows: need ? [{ k: 'Производительность', v: `не менее ${AirChain.flowText(need)} м³/мин` }] : [],
    });
  }

  /** Ресивер — на давление не ниже компрессорного. */
  receiverBar() {
    const compBar = Math.max(0, ...this.comps.map(unit => unit.air.bar || 0));
    for (const bad of this.recvUnits.filter(x => x.air.bar > 0 && compBar > x.air.bar + 0.05)) {
      this.issue(
        'warn',
        `Ресивер ${AirCheck._pos(bad)} рассчитан на ${AirChain.flowText(bad.air.bar)} бар — меньше давления компрессоров ${AirChain.flowText(compBar)} бар: нужен ресивер не ниже ${AirChain.flowText(compBar)} бар.`,
      );
    }
  }

  /** Класс чистоты по ISO 8573-1: какой осушитель и какие ступени фильтров нужны. */
  purity() {
    const match = String(this.cls || '').match(/^([1-6])\.([1-6])\.([1-4])$/);
    if (!match) return null;
    const before = this.recs.length;
    const [partCls, waterCls, oilCls] = match.slice(1).map(Number);
    this.purityDryer(waterCls);
    this.purityFilters(partCls, oilCls);
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
    return match;
  }

  dewText(pdp) {
    return `${pdp > 0 ? '+' : '−'}${Math.abs(pdp)} °C`;
  }

  dewPoint(pdp) {
    if (pdp <= -70) return '−70';
    return pdp <= -40 ? '−40' : '−20';
  }

  purityDryer(waterCls) {
    const { cls, flow: flow } = this;
    const pdp = AirChain.PDP[waterCls];
    const dewText = this.dewText(pdp);
    const need = flow ? this.dryerNeed() : 0;
    if (waterCls <= 3 && !this.ads.some(unit => unit.air.pdp == null || unit.air.pdp <= pdp)) {
      const refrig = this.refrig.length || this.builtDryer ? ' (рефрижераторный даёт +3 °C)' : '';
      this.issue('warn', `Класс ${cls}: точка росы ${dewText} — нужен адсорбционный осушитель${refrig}.`);
      this.dryerRec('ads', `класс воды ${waterCls} по ISO 8573-1`, {
        title: `Адсорбционный осушитель (точка росы ${dewText})${need ? `, не менее ${AirChain.flowText(need)} м³/мин` : ''}`,
        f: { dewPoint: this.dewPoint(pdp) },
        rows: [{ k: 'Точка росы', v: dewText }, ...(need ? [this.need(need, 'м³/мин')] : [])],
      });
      if (!this.grade('micro').length) this.filterRec('micro', 'перед адсорбционным осушителем — всегда');
    } else if (waterCls <= 6 && !(this.dryers.length || this.builtDryer)) {
      this.issue('warn', `Класс ${cls}: точка росы ${dewText} — нужен осушитель (рефрижераторный).`);
      this.dryerRec('refrig', `класс воды ${waterCls} по ISO 8573-1 — точка росы до ${dewText}`);
    }
  }

  purityFilters(partCls, oilCls) {
    const { cls } = this;
    const want = (grades, why) => {
      const have = grades.some(x => this.grade(x).length);
      const built = this.builtFilter && grades.some(x => x === 'pre' || x === 'fine');
      if (!have && !built) this.filterRec(grades[0], why);
    };
    if (partCls === 1 || oilCls === 1) want(['micro'], `класс ${cls}: частицы и масло — до 0,01 мкм и 0,01 мг/м³`);
    else if (partCls === 2 || oilCls === 2)
      want(['fine', 'micro'], `класс ${cls}: частицы до 1 мкм, масло до 0,1 мг/м³`);
    else if (partCls <= 3 || oilCls <= 3)
      want(['pre', 'fine', 'micro'], `класс ${cls}: частицы до 5 мкм, масло до 1 мг/м³`);
    if (oilCls === 1 && !this.grade('carbon').length)
      this.filterRec('carbon', 'класс масла 1 — с парами масла (0,003 мг/м³)');
  }

  word(unit) {
    const air = unit.air;
    const words = {
      compressor: () => `компрессор${air.dryer ? ' со встроенным осушителем' : ''}`,
      receiver: () => `${this.receiverWord(air)}${air.out ? ' снаружи' : ''}`,
      dryer: () =>
        `${{ ads: 'адсорбционный осушитель', gen: 'генератор' }[air.type] || 'рефрижераторный осушитель'}${air.filters ? ' (встроенные фильтры)' : ''}`,
    }[unit.kind];
    return words ? words() : `фильтр ${AirChain.GRADES[air.grade].short}`;
  }

  receiverWord(air) {
    if (air.role === 'dry' && this.dryers.length) return '«сухой» ресивер';
    return air.role === 'dry' && this.filters.length ? 'ресивер после фильтров' : 'ресивер';
  }

  /** Цепочка по ходу воздуха, единицы для схемы и очистка конденсата (не на линии). */
  result(cls) {
    const order = this.units
      .filter(unit => unit.kind !== 'filter' || unit.air.grade !== 'cond')
      .sort((left, right) => left.air.stage - right.air.stage);
    const chain = order.map(unit => ({
      pos: unit.pos,
      kind: unit.kind,
      text: this.word(unit),
      guess: Boolean(unit.air.guess),
    }));
    const units = order.map(unit => ({
      pos: unit.pos,
      kind: unit.kind,
      qty: unit.qty || 1,
      name: unit.name,
      brief: unit.brief,
      short: unit.short,
      air: unit.air,
    }));
    const cond = this.equip
      .filter(unit => unit.kind === 'filter' && unit.air && unit.air.grade === 'cond' && unit.place !== false)
      .map(unit => ({ pos: unit.pos, qty: unit.qty || 1, name: unit.name, brief: unit.brief }));
    return {
      chain,
      q: this.flow,
      bar: this.bar,
      issues: this.iss,
      recs: this.recs,
      cls: cls ? String(this.cls) : '',
      units,
      cond,
    };
  }
}
