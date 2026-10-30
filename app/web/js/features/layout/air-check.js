import { Num } from './num.js';
import { AirChain } from './air-chain.js';
import { DryerDerate } from './dryer-derate.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { ReceiverPlan } from './receiver-plan.js';
import { StationRules } from '../rules/station-rules.js';

/** Проверка цепочки подготовки воздуха и что добавить в состав (рекомендации для подбора в каталоге). */
export class AirCheck {
  static _pos = unit => `поз. ${unit.pos}`;

  static _sumFlow = list => list.reduce((acc, unit) => acc + unit.air.flow * unit.qty, 0);

  /**
   * @param {object[]} equip StationEquip.list
   * @param {string} cls класс чистоты ISO 8573-1
   * @param {object} req StationReq.recvIn
   * @param {{tmax?: number|null, tin?: number|null, pressure?: number|null}} [dryer] StationReq.dryer — условия поправок
   */
  constructor(equip, cls, req, dryer = {}) {
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
    const flows = AirCheck._flows(this.comps);
    this.total = flows.reduce((sum, value) => sum + value, 0);
    this.spare = Math.max(0, Math.min(Math.round((req && req.reserve) || 0), flows.length - 1));
    this.flow = flows.slice(this.spare).reduce((sum, value) => sum + value, 0);
    this.bar = Math.max(0, ...this.comps.map(unit => unit.air.bar || 0)) || StationRules.raw('pressure.default');
    this.builtDryer = this.comps.some(unit => unit.air.dryer);
    this.builtFilter = this.comps.some(unit => unit.air.filter) || this.dryers.some(unit => unit.air.filters);
    this.temps = DryerDerate.temps(dryer || {});
    this.dryerBar = this._dryerBar((dryer || {}).pressure);
    this.iss = [];
    this.recs = [];
    this.keys = new Set();
  }

  // производительность каждого компрессора, по убыванию: резервные — самые крупные (как в расчётной записке, AirDemand)
  static _flows(comps) {
    return comps
      .filter(unit => unit.air.flow > 0)
      .flatMap(unit => Array.from({ length: unit.qty }, () => unit.air.flow))
      .sort((left, right) => right - left);
  }

  /** Кого сравниваем с аппаратами: при резерве по ТЗ — рабочие компрессоры. */
  get _compsWord() {
    return this.spare ? 'рабочих компрессоров' : 'компрессоров';
  }

  /** @returns {object | null} */
  run() {
    if (!this.comps.length) return null;
    this.pressureNote();
    this.stages();
    this.capacity();
    this.registered();
    this.noDryer();
    this.receiverBar();
    const cls = this.purity();
    return this.result(cls);
  }

  /** Давления нет ни у одного компрессора — проверки по правилу pressure.default, с замечанием. */
  pressureNote() {
    if (this.comps.some(unit => unit.air.bar > 0)) return;
    this.issue(
      'info',
      `Давление компрессоров в составе не указано — проверки приняты при ${AirChain.flowText(this.bar)} бар; уточните по паспорту.`,
    );
  }

  /** Фильтры заданной степени очистки. */
  grade(grade) {
    return this.filters.filter(unit => unit.air.grade === grade);
  }

  /** Замечание проверки воздушной цепочки. */
  issue(level, text) {
    this.iss.push({ level, air: true, text });
  }

  /** Рекомендация по ключу (одна на ключ). */
  rec(key, rec) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.recs.push({ key, ...rec });
  }

  /** Строка рекомендации: чего не хватает агрегату и почему. */
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
    if (this.ads.length) this._adsStages();
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

  _adsStages() {
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
    this._dryerCapacity();
    this.filterCapacity();
    this.receivers();
  }

  // давление для поправок — как в расчётной записке (DryerDerate.bar): по всем компрессорам и аппаратам состава
  _dryerBar(pressure) {
    const comps = this.equip.filter(unit => unit.kind === 'compressor' && unit.air);
    const units = this.equip.filter(unit => unit.air).map(unit => ({ kind: unit.kind, info: unit.air }));
    return DryerDerate.bar({
      pressure,
      pmax: Math.min(...comps.map(unit => unit.air.bar || Infinity)),
      vsd: comps.every(unit => unit.air.vsd),
      loss: DryerDerate.loss(units),
    });
  }

  _dryerK(unit) {
    return DryerDerate.factor(unit.air.card, this.dryerBar, this.temps, unit.air.type).F;
  }

  /** Номинал осушителя вида type на производительность компрессоров — с поправками типовой серии вида. */
  _dryerNeed(type) {
    return this.flow / DryerDerate.factor(null, this.dryerBar, this.temps, type).F;
  }

  // условия поправок для текста
  _dryerAt() {
    const { tin, amb } = this.temps;
    return `${AirChain.flowText(this.dryerBar)} бар, воздух на входе ${AirChain.flowText(tin)} °C, в помещении ${AirChain.flowText(amb)} °C`;
  }

  _dryerRec(type, why, extra = {}) {
    const ads = type === 'ads';
    const cat = ads ? 'dryer_ads' : 'dryer_refrig';
    const word = ads ? 'Адсорбционный' : 'Рефрижераторный';
    const need = this.flow ? this._dryerNeed(type) : 0;
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

  _dryerCapacity() {
    const low = this.flow * (1 - StationRules.raw('calc.tolerance'));
    for (const [type, list] of [
      ['refrig', this.refrig],
      ['ads', this.ads],
    ]) {
      if (!list.length || list.some(unit => !(unit.air.flow > 0))) continue;
      const cap = list.reduce((acc, unit) => acc + unit.air.flow * unit.qty * this._dryerK(unit), 0);
      if (cap >= low) continue;
      this.issue(
        'warn',
        `Осушитель (${list.map(AirCheck._pos).join(', ')}): с поправками производителя ${AirChain.flowText(cap)} м³/мин (${this._dryerAt()}) — меньше производительности ${this._compsWord} ${AirChain.flowText(this.flow)} м³/мин. Нужен номинал не менее ${AirChain.flowText(this._dryerNeed(type))} м³/мин.`,
      );
      this._dryerRec(type, 'производительность — с поправками производителя на давление и температуру летом');
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
      if (cap >= flow * (1 - StationRules.raw('calc.tolerance'))) continue;
      const count = stageGroup.reduce((acc, x) => acc + x.qty, 0);
      const who =
        count > 1
          ? `Фильтры ${Num.uniq(stageGroup.map(AirCheck._pos)).join(', ')} (${count} шт. параллельно)`
          : `Фильтр ${AirCheck._pos(stageGroup[0])}`;
      this.issue(
        'warn',
        `${who} «${stageGroup[0].short}»: ${AirChain.flowText(cap)} м³/мин при ${AirChain.flowText(bar)} бар — меньше производительности ${this._compsWord} ${AirChain.flowText(flow)} м³/мин: перепад давления растёт, фильтр не держит класс очистки. Нужно не менее ${AirChain.flowText(flow / filterK)} м³/мин.`,
      );
    }
  }

  _recvRec(key, x, { role, title, why, need }) {
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
    if (plan.main && !dry.length && !this.comps.some(unit => unit.air.recv)) this._mainReceiver(plan);
    if (plan.wet && !wet.length) this._wetReceiver(plan);
    this._moreMain(plan, dry);
    if (plan.wet) this.more(wet, plan.wet, 'receiver-wet-more', 'wet', 'мокрый ресивер');
    if (plan.local && !this.equip.some(unit => unit.local)) this._localReceiver(plan);
  }

  _moreMain(plan, dry) {
    const before = plan.mode === 'before';
    this.more(before ? [] : dry, plan.main, 'receiver-more', before ? 'wet' : 'dry', 'основной ресивер');
  }

  _wetReceiver(plan) {
    this._recvRec('receiver-wet', plan.wet, {
      role: 'wet',
      title: `Мокрый ресивер ${Mm.text(plan.wet.size)} л (до осушителя)`,
      why: `30–50 % основного; ${plan.wet.why}`,
      need: plan.main.total * ReceiverPlan.METHOD.wet[0],
    });
  }

  _localReceiver(plan) {
    this._recvRec('receiver-local', plan.local, {
      role: 'local',
      title: `Локальный ресивер ${Mm.text(plan.local.size)} л у потребителя`,
      why: `пик точки больше 50 % производительности компрессора; ${plan.local.why}`,
    });
  }

  _mainReceiver(plan) {
    const before = plan.mode === 'before';
    const count = plan.main.n > 1 ? `${plan.main.n} × ` : '';
    const after = this.dryers.length || this.builtDryer ? ' (после осушителя)' : '';
    this.issue(
      'info',
      `Ресивера в составе нет — по расчёту (приоритет ${plan.prio}) нужно ${Mm.text(plan.theor)} л: ${ReceiverPlan.text(plan)}. Ресивер сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже включается.`,
    );
    this._recvRec('receiver', plan.main, {
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
    this._recvRec(
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
    const reg = this.recvUnits.filter(unit => unit.air.vol > 0 && PressureVessel.registered(bar, unit.air.vol));
    const total = reg.reduce((acc, unit) => acc + unit.air.vol * unit.qty, 0);
    const split = total ? AirChain.base(total, bar) || AirChain.split(total, bar) : null;
    if (!split) return;
    const who = Num.uniq(reg.map(AirCheck._pos)).join(', ');
    this.issue(
      'info',
      `Ресивер ${who}: p·V больше ${PressureVessel.limitText()} МПа·м³ — подлежит учёту в Ростехнадзоре. Без учёта — ${split.n} ресивера по ${Mm.text(split.v)} л (p·V каждого — ${AirChain.flowText(PressureVessel.product(bar, split.v))} МПа·м³): замена — на вкладке «Компоновка».`,
    );
    this.rec('recv-split', {
      title: `Ресиверы ${split.n} × ${Mm.text(split.v)} л вместо ${who} — без учёта в Ростехнадзоре`,
      why: `вместе ${Mm.text(split.n * split.v)} л; p·V каждого не больше ${PressureVessel.limitText()} МПа·м³`,
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
    const need = this.flow ? this._dryerNeed('refrig') : 0;
    const flow = need ? ` не менее ${AirChain.flowText(need)} м³/мин` : '';
    this.issue(
      'info',
      `Осушителя в составе нет: влага остаётся в сжатом воздухе — конденсат в трубах и у потребителей, зимой замерзает. Обычно ставят рефрижераторный осушитель (точка росы ${AirChain.refrigDew()})${flow} с байпасом — подбор на вкладке «Компоновка».`,
    );
    this._dryerRec('refrig', `точка росы ${AirChain.refrigDew()}: без конденсата в трубах; ставится с байпасом`, {
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
    this._purityDryer(waterCls);
    this._purityFilters(partCls, oilCls);
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

  /** Точка росы для текста: −70 и ниже — «−70». */
  dewPoint(pdp) {
    if (pdp <= -70) return '−70';
    return pdp <= -40 ? '−40' : '−20';
  }

  _purityDryer(waterCls) {
    const { cls, flow: flow } = this;
    const pdp = AirChain.PDP[waterCls];
    const dewText = AirChain.dewText(pdp);
    const need = flow ? this._dryerNeed('ads') : 0;
    if (waterCls <= 3 && !this.ads.some(unit => unit.air.pdp == null || unit.air.pdp <= pdp)) {
      const refrig = this.refrig.length || this.builtDryer ? ` (рефрижераторный даёт ${AirChain.refrigDew()})` : '';
      this.issue('warn', `Класс ${cls}: точка росы ${dewText} — нужен адсорбционный осушитель${refrig}.`);
      this._dryerRec('ads', `класс воды ${waterCls} по ISO 8573-1`, {
        title: `Адсорбционный осушитель (точка росы ${dewText})${need ? `, не менее ${AirChain.flowText(need)} м³/мин` : ''}`,
        f: { dewPoint: this.dewPoint(pdp) },
        rows: [{ k: 'Точка росы', v: dewText }, ...(need ? [this.need(need, 'м³/мин')] : [])],
      });
      if (!this.grade('micro').length) this.filterRec('micro', 'перед адсорбционным осушителем — всегда');
    } else if (waterCls <= 6 && !(this.dryers.length || this.builtDryer)) {
      this.issue('warn', `Класс ${cls}: точка росы ${dewText} — нужен осушитель (рефрижераторный).`);
      this._dryerRec('refrig', `класс воды ${waterCls} по ISO 8573-1 — точка росы до ${dewText}`);
    }
  }

  _purityFilters(partCls, oilCls) {
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

  /** Короткое описание агрегата в цепочке подготовки воздуха. */
  word(unit) {
    const air = unit.air;
    const words = {
      compressor: () => `компрессор${air.dryer ? ' со встроенным осушителем' : ''}`,
      receiver: () => `${this._receiverWord(air)}${air.out ? ' снаружи' : ''}`,
      dryer: () =>
        `${{ ads: 'адсорбционный осушитель', gen: 'генератор' }[air.type] || 'рефрижераторный осушитель'}${air.filters ? ' (встроенные фильтры)' : ''}`,
    }[unit.kind];
    return words ? words() : `фильтр ${AirChain.GRADES[air.grade].short}`;
  }

  _receiverWord(air) {
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
      q: this.total,
      work: this.flow,
      bar: this.bar,
      dryer: { bar: this.dryerBar, temps: this.temps },
      issues: this.iss,
      recs: this.recs,
      cls: cls ? String(this.cls) : '',
      units,
      cond,
    };
  }
}
