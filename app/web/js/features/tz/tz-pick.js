import { AirChain } from '../layout/air-chain.js';
import { DryerSizing } from '../calc/dryer-sizing.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { PressureVessel } from '../layout/pressure-vessel.js';
import { ReceiverPlan } from '../layout/receiver-plan.js';
import { StationClear } from '../layout/station-clear.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationRules } from '../rules/station-rules.js';
import { StationSup } from './station-sup.js';

/** Подбор оборудования станции из каталога по требованиям ТЗ — без недобора (в пользу заказчика). */
export class TzPick {
  /** Ступени фильтров, годные под рекомендацию, по порядку предпочтения. */
  static GRADE = { pre: ['pre', 'dust', 'fine'], dust: ['dust', 'fine'] };
  static DROP = { comp: /^(compressor|dryer|filter|receiver)$/, pump: /^pump$/, dgu: /^dgu$/ };
  static TYPE = { comp: 'st_comp', pump: 'st_pump', dgu: 'st_dgu' };
  static PICK = { comp: '_pickComp', pump: '_pickPump', dgu: '_pickDgu' };
  static RECV_ROLE = { dry: 'основной ресивер', wet: 'мокрый ресивер (до осушителя)', local: 'ресивер у потребителя' };

  /** Запас давления компрессора к требуемому, бар. */
  static get LOSS() {
    return StationRules.raw('loss.pick');
  }

  /** Добор производительности количеством: до стольких одинаковых агрегатов или аппаратов параллельно. */
  static get MAX() {
    return StationMatrix.grp('pick').max;
  }

  /** Подбор «чтобы поместилось»: наибольший запас производительности (множитель). */
  static get OVER() {
    return 1 + StationMatrix.grp('pick').over / 100;
  }

  /** Место над ресивером на арматуру, мм. */
  static get RECV_TOP() {
    return StationMatrix.grp('pick').recvFit;
  }

  static num(v) {
    return StationEquip.num(v);
  }

  /** Производительность позиции каталога: компрессоры и осушители — м³/мин, насосы — м³/ч. */
  static flow(c) {
    const a = attrsOf(c);
    const f = this.num(a.flow);
    if (!(f > 0)) return 0;
    return a.cat === 'comp_piston' ? f / 1000 : f;
  }

  /** Из подходящих — с наименьшим key. */
  static best(list, key) {
    return list.reduce((b, o) => (!b || o[key] < b[key] ? o : b), null);
  }

  static _pressOk(p, B, add = 0) {
    return !(B > 0) || !(p > 0) || p >= B + add - 0.05;
  }

  static _res(q) {
    return Math.max(0, Math.round(+q.reserve || 0));
  }

  /**
   * Рабочие агрегаты из pool [{c, v}] на нагрузку need: {o, n}; n0 — число рабочих из ТЗ, pen(o) — штраф позиции,
   * rank(o) — приоритет поставщика при том же числе агрегатов.
   */
  static units(pool, need, n0, pen = () => 0, rank = null) {
    const L = [];
    for (let n = n0 || 1; n <= (n0 || this.MAX); n++)
      for (const o of pool)
        if (o.v * n >= need - 1e-9) L.push({ o, n, score: (o.v * n - need) / need + 0.08 * (n - 1) + pen(o) });
    const b = StationSup.pick(L, () => 0, 0);
    if (!b || !rank) return b;
    return StationSup.pick(
      L.filter(z => z.n === b.n),
      z => rank(z.o),
      StationSup.TOL,
    );
  }

  /** Одинаковые аппараты параллельно на need (list — [{c, cap}]): наименьшее число, затем наименьший запас; {o, n} | null. */
  static many(list, need, max = this.MAX) {
    for (let n = 1; n <= max; n++) {
      const L = list
        .filter(z => z.cap * n >= need - 1e-9)
        .map(z => ({ ...z, over: z.cap * n - need, score: need > 0 ? (z.cap * n - need) / need : z.cap * n }));
      const o = StationSup.pick(L, z => StationSup.same(z.c), StationSup.TOL);
      if (o) return { o, n };
    }
    return null;
  }

  /** Компрессоры на Q, м³/мин, и B, бар, у потребителя; q — {oilFree, vsd, work, compact, ads}: {o, n} | null. */
  static comps(pool, Q, B, q) {
    const vsd = c => AirChain.info({ name: c.name, attrs: attrsOf(c), rows: [] }, 'compressor').vsd;
    const L = pool
      .filter(c => !q.oilFree || this.oilFree(c))
      .map(c => ({
        c,
        v: this.flow(c),
        p: this.num(attrsOf(c).pressure),
        vsd: vsd(c),
        f: !q.vsd || vsd(c),
        of: !q.oilFree && this.oilFree(c),
      }))
      .filter(o => o.v > 0 && this._pressOk(o.p, B) && !(q.compact && this._bulky(o, Q, B, q)));
    return this.units(
      L,
      Q,
      q.work,
      o => this.barPen(o.p, B, o.vsd) + (o.f ? 0 : 0.3) + (o.of ? 0.5 : 0) + (q.compact ? this.area(o.c) : 0),
      o => StationSup.same(o.c) * 10 + StationSup.cover(o.c, [q.ads ? 'dryer_ads' : 'dryer_refrig', 'filter']),
    );
  }

  /** Подбор «чтобы поместилось» не берёт безмасляный без требования, без запаса давления и с лишней производительностью. */
  static _bulky(o, Q, B, q) {
    return o.of || this.barPen(o.p, B, o.vsd) >= 0.5 || (q.work && o.v * q.work > Q * this.OVER);
  }

  /** Штраф за площадь агрегата: 0,3 на м² пола; габарит неизвестен — как 3,5 м². */
  static area(c) {
    const d = StationEquip.dims({ name: c.name, attrs: attrsOf(c), rows: [] }, 'compressor');
    return 0.3 * (d.known ? (d.l * d.w) / 1e6 : 3.5);
  }

  /**
   * Осушитель на Qd, м³/мин, с поправками производителя на давление B и температуру tmax; давление аппарата — не ниже Bc,
   * точка росы — не выше pdp, по высоте H и ширине W помещения: {o, n} | null.
   */
  static dryer(ads, Qd, B, Bc, { tmax, pdp = null, H = 0, W = 0 } = {}) {
    const t = DryerSizing.temps({ tmax, tin: null });
    const pb = B > 0 ? B : StationRules.raw('dryer.ref').p;
    const dc = ads ? 'dryer_ads' : 'dryer_refrig';
    const dp = c => this.num(String(attrsOf(c).dewPoint ?? '').replace(/[−–]/g, '-'));
    const fits = c =>
      (pdp == null || dp(c) == null || dp(c) <= pdp + 0.5) && this.fitsH(c, 'dryer', H) && this.fitsW(c, 'dryer', W);
    const L = catCache
      .filter(c => attrsOf(c).cat === dc && fits(c))
      .map(c => {
        const F = DryerSizing.factor({ name: c.name, attrs: attrsOf(c), rows: [] }, pb, t, ads ? 'ads' : 'refrig').F;
        return { c, v: this.flow(c), cap: this.flow(c) * F };
      })
      .filter(o => o.v > 0 && this._pressOk(this.num(attrsOf(o.c).pressure), Bc));
    return this.many(L, Qd);
  }

  /**
   * Фильтр ступени rec.key на Qf, м³/мин, с поправкой производителя на давление; давление фильтра — не ниже Bc;
   * Qf неизвестна — самый маленький этой ступени: {o, n} | null.
   */
  static filter(rec, Qf, B, Bc) {
    const pf = B > 0 ? B + StationRules.raw('loss.pipe') : StationRules.raw('dryer.ref').p;
    for (const g of this.GRADE[rec.key] || [rec.key]) {
      const L = catCache.filter(c => this._filterOk(c, g, Qf, Bc));
      const m =
        Qf > 0
          ? this.many(
              L.map(c => ({ c, cap: this.flow(c) * this._kf(c, pf) })),
              Qf,
            )
          : this._smallest(L);
      if (m) return m;
    }
    return null;
  }

  static _kf(c, pf) {
    const s = StationRules.series({ name: c.name, attrs: attrsOf(c), rows: [] }, 'filter');
    return s ? StationRules.interp(s.f.p, pf) : AirChain.kf(pf);
  }

  static _filterOk(c, g, Qf, Bc) {
    const a = attrsOf(c);
    const p = { name: c.name, attrs: a, rows: [] };
    if (a.cat !== 'filter' || AirChain.grade(p, a.cat, AirChain.text(p)) !== g) return false;
    if (Qf > 0 && !(this.flow(c) > 0)) return false;
    return this._pressOk(this.num(a.pressure), Bc);
  }

  static _smallest(L) {
    const flow = c => this.num(attrsOf(c).flow) || 0;
    const b = StationSup.pick(
      L.map(c => ({ c, v: flow(c), score: flow(c) })),
      z => StationSup.same(z.c),
      0,
    );
    return b ? { o: b, n: 1 } : null;
  }

  /** Давление компрессора, бар, для B у потребителя: потери в подготовке и — без частотника — диапазон регулирования. */
  static barNeed(B, vsd) {
    return B + this.LOSS + (vsd ? 0 : StationRules.raw('pressure.band'));
  }

  /** Штраф по давлению: меньше нужного — 0,5, больше — по 0,05 за бар. */
  static barPen(p, B, vsd) {
    if (!(B > 0) || !(p > 0)) return 0;
    const need = this.barNeed(B, vsd);
    return p < need - 0.05 ? 0.5 : 0.05 * (p - need);
  }

  /** Безмасляный: по полю «Безмасляный (класс 0)», не заполнено — по названию и характеристикам. */
  static oilFree(c) {
    const a = attrsOf(c);
    const f = String(a.oilFree ?? '').trim();
    if (/^(да|есть|true)/i.test(f) || /класс\w*\s*0(?![.,\d])/i.test(f)) return true;
    if (/^(нет|false)/i.test(f)) return false; // поле важнее описания серии
    return /безмасл|oil[\s-]?free|класс\w*\s*0(?![.,\d])/i.test(
      [c.name, a.model, a.series, a.lubrication, a.oil].filter(Boolean).join(' '),
    );
  }

  /** Передвижной или бензиновый — не для станции в контейнере. */
  static mobile(c) {
    const a = attrsOf(c);
    return (
      /шасси|передвижн|мобильн|колёсн|колесн/i.test(`${String(a.execution || '')} ${c.name}`) || /бензин/i.test(c.name)
    );
  }

  /** Насос для стационарной станции: электрический, не погружной, не скважинный, не дренажный, не мотопомпа. */
  static pumpOk(c) {
    const a = attrsOf(c);
    return (
      !/мотопомп|погружн|скважин|дренаж|фекал/i.test(`${String(a.kind || '')} ${c.name}`) &&
      !/дизел|бензин/i.test(String(a.drive || ''))
    );
  }

  /** ДГУ в кожухе шире — станция уходит в негабарит: штраф к оценке. */
  static dguPen(c) {
    return /кожух|капот|шумозащит/i.test(`${String(attrsOf(c).execution || '')} ${c.name}`) ? 0.15 : 0;
  }

  /** ДГУ для станции 0,4 кВ: трёхфазная 400 В, не однофазная и не высоковольтная; «400 / 230 В» — трёхфазная. */
  static dguOk(c) {
    const a = attrsOf(c);
    const t = `${String(a.voltage || '')} ${String(a.phases || '')} ${c.name}`;
    if (/\d{4,}\s*В(?![а-яё])|\d+(?:[.,]\d+)?\s*кВ(?![а-яёА-ЯЁ])/i.test(t.replace(/(\d)\s+(?=\d{3}\b)/g, '$1')))
      return false;
    if (/3\s*фаз|тр[её]хфазн/i.test(t)) return true;
    return !/однофазн|1\s*фаз|(?<![\d\/]\s*)(?<!\d)(?:220|230)\s*В(?![а-яё])(?!\s*\/)/i.test(t);
  }

  static stationPool(cats) {
    return catCache.filter(c => cats.includes(attrsOf(c).cat) && !this.mobile(c));
  }

  static electric(pool) {
    return pool.filter(c => attrsOf(c).cat !== 'comp_diesel');
  }

  static _recvAll() {
    return catCache
      .filter(c => attrsOf(c).cat === 'receiver')
      .map(c => {
        const a = attrsOf(c);
        return {
          c,
          v: this.num(a.volume) || 0,
          p: this.num(a.pressure),
          h: StationEquip.dims({ name: c.name, attrs: a, rows: [] }, 'receiver').h,
        };
      });
  }

  static _fitsTop(o, Hmax) {
    return !(Hmax > 0) || o.h + this.RECV_TOP <= Hmax;
  }

  /** Порядок ресиверов: производитель в приоритете, тот же поставщик, в наличии, меньшее давление, дешевле, ниже. */
  static _recvOrder() {
    const B0 = AirChain.BASE;
    const mk = String(B0?.maker || '')
      .trim()
      .toLowerCase();
    const pri = o =>
      mk &&
      String(attrsOf(o.c).maker || '')
        .trim()
        .toLowerCase() === mk
        ? 0
        : 1;
    return (a, b) =>
      pri(a) - pri(b) ||
      StationSup.same(b.c) - StationSup.same(a.c) ||
      this.stock(b.c) - this.stock(a.c) ||
      (a.p || 99) - (b.p || 99) ||
      this.cheaper(a.c, b.c) ||
      a.h - b.h;
  }

  /**
   * Ресиверы на объём V, л: по умолчанию одинаковые базового типоразмера; иначе наименьшее число, сначала без учёта в
   * Ростехнадзоре; давление — не ниже B, высота с арматурой — не выше Hmax (0 — снаружи): {o, n, free} | null.
   */
  static receivers(V, B, Hmax) {
    const L = this._recvAll().filter(o => o.v > 0 && this._pressOk(o.p, B) && this._fitsTop(o, Hmax));
    const free = o => !(B > 0) || ((B / 10) * o.v) / 1000 <= PressureVessel.LIMIT + 1e-9;
    const base = this._recvBase(L, V, B, free);
    if (base) return base;
    if (!(V > 0)) return L.length ? { o: this.best(L, 'v'), n: 1, free: true } : null;
    const P = StationMatrix.grp('pick');
    return this._recvN(L, V, free, true, P.recvFree) || this._recvN(L, V, free, false, P.recvAny);
  }

  static _recvBase(L, V, B, free) {
    const B0 = AirChain.BASE;
    const bs = B0 ? AirChain.base(V > 0 ? V : B0.volume, B) : null;
    if (!(bs && bs.n <= 6)) return null;
    const C = L.filter(o => Math.abs(o.v - bs.v) < 0.5 && free(o)).sort(this._recvOrder());
    return C.length ? { o: C[0], n: bs.n, free: true, base: true } : null;
  }

  static _recvN(L, V, free, only, max) {
    for (let n = 1; n <= max; n++) {
      const o = StationSup.pick(
        L.filter(z => z.v * n >= V - 1e-9 && (!only || free(z))).map(z => ({ ...z, score: z.v })),
        z => StationSup.same(z.c),
        0,
      );
      if (o) return { o, n, free: free(o) };
    }
    return null;
  }

  /**
   * Ресивер типоразмера size, л: давление — с запасом над компрессором, нет такого — не ниже; высота — не выше Hmax.
   * {o} | {o: null, tall — есть, но выше} | null.
   */
  static recvPick(size, B, Hmax) {
    const all = this._recvAll().filter(o => Math.abs(o.v - size) < 0.5 && this._pressOk(o.p, B));
    const fit = all.filter(o => this._fitsTop(o, Hmax));
    const order = this._recvOrder();
    for (const add of [ReceiverPlan.M.margin, 0]) {
      const o = fit.filter(z => this._pressOk(z.p, B, add)).sort(order)[0];
      if (o) return { o };
    }
    return all.length ? { o: null, tall: true } : null;
  }

  /** По закупке, иначе по цене (одна валюта; без цены — в конце): < 0 — a дешевле. */
  static cheaper(a, b) {
    const cost = (c, k) => (+c[k] > 0 ? +c[k] : Infinity);
    for (const [k, cur] of [
      ['cost', 'costCur'],
      ['price', 'priceCur'],
    ]) {
      const va = cost(a, k);
      const vb = cost(b, k);
      if (va === Infinity && vb === Infinity) continue;
      if (va !== Infinity && vb !== Infinity && (a[cur] || 'RUB') !== (b[cur] || 'RUB')) return 0;
      return Math.sign(va - vb);
    }
    return 0;
  }

  /** В наличии на складе поставщика: 1 / 0. */
  static stock(c) {
    return typeof CatalogIndex !== 'undefined' && CatalogIndex.inStock(c) ? 1 : 0;
  }

  static _roadInner(g) {
    return StationGeo.inner(g.type, [10000, StationGeo.ROAD_W, StationGeo.BLOCK.maxH], g.t);
  }

  /** Высота внутри контейнера станции, мм; по оборудованию — наибольшая высота ряда. */
  static hmax(x) {
    const g = StationGeo.of(kitContainer(x) || { ctype: 'block' });
    return g.int ? g.int[2] : this._roadInner(g)[2];
  }

  /** Полезная ширина помещения, мм; без размера — блок в ширину перевозки. */
  static wmax(x) {
    const g = StationGeo.of(kitContainer(x) || { ctype: 'block' });
    const Wi = g.int && !g.auto ? g.int[1] : this._roadInner(g)[1];
    return Wi - 2 * StationMatrix.gap();
  }

  /** Помещается в плане с проходом (W, мм; 0 — без ограничения): меньшая сторона + отступ «плотно» + проход «не менее». */
  static fitsW(c, kind, W) {
    if (!(W > 0)) return true;
    const d = StationEquip.dims({ name: c.name, attrs: attrsOf(c), rows: c.rows || [] }, kind);
    if (!d.known) return true;
    const s = Math.min(d.l, d.w);
    const wr = StationMatrix.wall({ kind, w: s });
    return s + (wr ? wr[1] : 100) + StationClear.aisle()[1] <= W;
  }

  /** Проходит по высоте H, мм (0 — без ограничения); над осушителем — место на подключение. */
  static fitsH(c, kind, H) {
    if (!(H > 0)) return true;
    const d = StationEquip.dims({ name: c.name, attrs: attrsOf(c), rows: [] }, kind);
    return !d.known || d.h + (kind === 'dryer' ? StationMatrix.grp('pick').dryerFit : 0) <= H;
  }

  /** «осушитель …» — без повтора слова, если оно уже есть в названии. */
  static lbl(word, name) {
    return String(name || '')
      .toLowerCase()
      .includes(word.slice(0, 5))
      ? name
      : `${word} ${name}`;
  }

  /** Подбор и сборка станции: шкафы по особым требованиям, оборудование, название, характеристики, контейнер. */
  static async assemble(x, q) {
    const added = StationReq.ensureParts(x);
    const note = await this.run(x, q);
    kitSync(x);
    StationUi.cache.delete(x.id);
    StationSize.apply(x, true);
    stationFill(x);
    stationAutoName(x);
    return [note, added.length ? `Добавлено по ТЗ: ${added.join(', ')}` : ''].filter(Boolean).join('. ');
  }

  /** Элемент состава из позиции каталога: полная карточка с сервера, нет связи — из кэша каталога. */
  static async part(c, qty, role) {
    let doc = c;
    try {
      doc = await api(`/api/catalog/${encodeURIComponent(c.id)}`);
    } catch {}
    const p = KitPart.fromCat(doc);
    p.qty = qty;
    if (role) p.role = role;
    return p;
  }

  /** Подбор с защитой состава: чего в каталоге не нашлось — прежнее оборудование этого вида остаётся. */
  static async run(x, q) {
    const drop = this.DROP[q.kind] || /^$/;
    const before = kitParts(x).filter(p => p.role !== 'container' && drop.test(StationEquip.kindOf(p) || ''));
    const note = await this.fit(x, q);
    const kept = this._restore(x, before);
    return kept.length ? `${note}. Оставлено прежнее: ${kept.join('; ')}` : note;
  }

  static _restore(x, before) {
    const kept = [];
    let air = null;
    // фильтры и ресиверы — только если цепочка воздуха их по-прежнему просит
    const need = k => {
      if (k !== 'filter' && k !== 'receiver') return true;
      air ??= StationLayout.solve(StationUi.input(x)).air || KitNeed.air(x) || { recs: [] };
      return (air.recs || []).some(r => r.cat === k && !r.replace);
    };
    for (const k of new Set(before.map(p => StationEquip.kindOf(p)))) {
      if (kitParts(x).some(p => StationEquip.kindOf(p) === k) || !need(k)) continue;
      const old = before.filter(p => StationEquip.kindOf(p) === k);
      const at = kitParts(x).findIndex(p => p.role === 'container');
      x.kit.parts.splice(at < 0 ? x.kit.parts.length : at, 0, ...old);
      kept.push(...old.map(p => p.name));
    }
    return kept;
  }

  /**
   * Подбор, при котором станция помещается в контейнер: для 1 … MAX одинаковых компрессоров — ресиверы 900 л внутри,
   * по 500 л внутри, затем снаружи; иначе — ресиверы вплотную, негабарит или подсказка разделить станцию.
   */
  static async fit(x, q) {
    q = this._fitReset(x, q);
    const note = await this.pick(x, q);
    if (q.work || q.kind !== 'comp' || !(q.flow > 0)) return note;
    const req = StationReq.ensure(x);
    const main = this._main(x);
    const f = {
      x,
      q,
      req,
      out0: !!req.recvOut,
      sz0: !!req.recvSize,
      n0: main ? main.qty - this._res(q) : 1,
      t5: false,
      hadR: true,
    };
    const s0 = this._state(x);
    if (s0 === 'ok') return note;
    f.first = this._keep(x, note, f.n0, f.out0, false);
    f.wide = s0 === 'wide' ? f.first : null;
    f.close = s0 === 'close' ? f.first : null;
    return (await this._fitTry(f)) || this._fitLast(f);
  }

  /** «Снаружи» и «по 500 л», выбранные программой, — каждый подбор заново. */
  static _fitReset(x, q) {
    const rq = StationReq.ensure(x);
    if (rq.recvSizeAuto) this._clearSize(rq);
    if (!rq.recvOutAuto) return q;
    this._clearOut(rq);
    return { ...q, recvOut: false };
  }

  static _clearOut(rq) {
    delete rq.recvOut;
    delete rq.recvOutAuto;
  }

  static _clearSize(rq) {
    delete rq.recvSize;
    delete rq.recvWhy;
    delete rq.recvSizeAuto;
  }

  static _main(x) {
    return kitParts(x).find(p => p.role === 'main');
  }

  /** Как встала станция: bad — ошибка или нет агрегата, wide — негабарит, close — ресиверы вплотную, ok. */
  static _state(x) {
    if (!this._main(x)) return 'bad';
    const p = StationLayout.solve(StationUi.input(x));
    if (p.level === 'error') return 'bad';
    const I = p.issues || [];
    return ['wide', 'close'].find(k => I.some(i => i[k])) || 'ok';
  }

  static _keep(x, note, n, out, s5) {
    return { parts: JSON.parse(JSON.stringify(x.kit.parts)), note, n, out, s5 };
  }

  static _fitSet(f, out, s5) {
    const { req } = f;
    if (out) Object.assign(req, { recvOut: true, recvOutAuto: true });
    else if (!f.out0) this._clearOut(req);
    if (s5) Object.assign(req, { recvSize: '500', recvWhy: 'space', recvSizeAuto: true });
    else if (req.recvSizeAuto) this._clearSize(req);
  }

  /** Варианты [агрегатов, снаружи, по 500 л] по порядку. */
  static _fitTries(f) {
    const tries = [];
    if (!f.out0)
      for (let n = f.n0; n <= this.MAX; n++) {
        tries.push([n, false, false]);
        if (!f.sz0) tries.push([n, false, true]);
      }
    for (let n = f.n0; n <= this.MAX; n++) tries.push([n, true, false]);
    return tries;
  }

  static async _fitTry(f) {
    for (const [n, out, s5] of this._fitTries(f)) {
      if (s5 && !f.hadR) continue; // в предыдущем варианте не было ресиверов — «по 500 л» не нужен
      if (out && f.close) break; // вплотную внутри лучше, чем снаружи
      const r = await this._fitStep(f, n, out, s5);
      if (!this._fitR(f, r, s5)) continue;
      r.v.t5 = f.t5;
      if (r.st === 'ok') return this._fitNote(r.v, f.n0, false);
      if (r.st === 'close') f.close ??= r.v;
      if (r.st === 'wide') f.wide ??= r.v;
    }
    return null;
  }

  /** Вариант «по 500 л» без ресиверов (их нет в каталоге) не годится. */
  static _fitR(f, r, s5) {
    if (!s5) {
      f.hadR = r.dryR;
      return true;
    }
    if (!r.dryR) return false;
    f.t5 = true;
    return true;
  }

  static async _fitStep(f, n, out, s5) {
    this._fitSet(f, out, s5);
    const nt = await this.pick(f.x, { ...f.q, work: n, compact: true, recvOut: out });
    const st = this._state(f.x);
    const v = this._keep(f.x, nt, n, out, s5);
    const dryR = kitParts(f.x).some(
      p => StationEquip.kindOf(p) === 'receiver' && p.recvRole !== 'local' && p.recvRole !== 'wet',
    );
    return { st, v, dryR };
  }

  static _fitLast(f) {
    const v = f.close || f.wide || f.first;
    f.x.kit.parts = v.parts;
    this._fitSet(f, v.out && !f.out0, v.s5);
    if (f.close) return this._fitNote(v, f.n0, false, true);
    if (f.wide) return this._fitNote(v, f.n0, true);
    return `${v.note}. Станция не помещается в один контейнер даже из ${this.MAX} одинаковых агрегатов${f.t5 ? ', с ресиверами по 500 л' : ''} и с ресиверами снаружи — разделите её на две станции (по половине производительности) или задайте контейнер вручную`;
  }

  /** Уведомление о том, как станция встала в контейнер. */
  static _fitNote(v, n0, wide, close) {
    const why = [];
    if (v.n > n0) why.push(`подобрано ${v.n} одинаковых`);
    if (close)
      why.push('ресиверы и фильтры — вплотную друг к другу (исключение: иначе ресиверы пришлось бы выносить наружу)');
    if (v.s5)
      why.push(
        'ресиверы — по 500 л (без учёта в Ростехнадзоре): с ресиверами 900 л станция не помещается в габарит перевозки',
      );
    if (v.out)
      why.push(
        `ресиверы — снаружи у стены станции (ФНП ОРПД, п. 65): внутри в габарите перевозки не помещаются${v.t5 ? ' — ни по 900 л, ни по 500 л' : ''}, хотя компоновка пробует два ряда, пары, поворот и плотные отступы`,
      );
    if (wide) why.push('ширина больше габарита перевозки — негабарит (исключение)');
    return why.length
      ? `${v.note}. Одним ${n0 > 1 ? 'набором' : 'агрегатом'} со всем оборудованием внутри станция не помещается в контейнер в габарите перевозки — ${why.join('; ')}`
      : v.note;
  }

  /** Подбор в станцию x по требованиям q (без защиты состава — run). */
  static pick(x, q) {
    const kind = q.kind;
    const drop = this.DROP[kind] || this.DROP.dgu;
    const cats = (typeById(this.TYPE[kind]).station || {}).main || [];
    const s = {
      x,
      q,
      res: this._res(q),
      got: [],
      miss: [],
      add: [],
      keep: kitParts(x).filter(p => p.role === 'container' || !drop.test(StationEquip.kindOf(p) || '')),
      pool: this.stationPool(cats),
      H: this.hmax(x),
    };
    StationSup.ctx = ''; // поставщик — по подобранным основным агрегатам
    const m = this.PICK[kind];
    return m ? this[m](s) : Promise.resolve(this._done(s));
  }

  static _done(s) {
    s.x.kit.parts = [...s.add, ...s.keep];
    return this.note(s.got, s.miss);
  }

  static async _pickComp(s) {
    const { x, q } = s;
    s.B = q.pressure;
    s.Bc = s.B; // давление аппаратов — не ниже наибольшего давления компрессора
    s.picked = null;
    this._recvWhere(x, q);
    const nd = this._need(s);
    if (s.Q > 0) {
      await this._compMain(s, nd);
      await this._compDryer(s);
    }
    x.kit.parts = [...s.add, ...s.keep];
    s.at = s.add.length;
    await this._chain(s);
    return this.note(s.got, s.miss);
  }

  /** Потребность — FAD с запасом; адсорбционный осушитель — компрессоры с запасом на продувку. */
  static _need(s) {
    const { q } = s;
    const wc = +(String(q.air || '').split('.')[1] || 0);
    s.ads = (wc && wc <= 3) || (q.pdp != null && +q.pdp <= -20);
    const nd = q.flow > 0 ? StationReq.need(q, q.flow) : { v: 0, why: '' };
    s.Q = s.ads && nd.v > 0 ? nd.v / (1 - AirChain.PURGE) : nd.v;
    return nd;
  }

  /** Фильтры и ресиверы — по цепочке воздуха, и когда компоновка не сложилась. */
  static async _chain(s) {
    const air = StationLayout.solve(StationUi.input(s.x)).air || KitNeed.air(s.x);
    for (const rec of (air?.recs || []).filter(r => (r.cat === 'filter' || r.cat === 'receiver') && !r.replace))
      await (rec.cat === 'receiver' ? this._compRecv(s, rec) : this._compFilter(s, rec));
  }

  static _recvWhere(x, q) {
    const rq = StationReq.ensure(x);
    if (q.recv === 'after' || q.recv === 'before') rq.recv = q.recv;
    if (q.recvOut) rq.recvOut = true;
  }

  static async _compMain(s, nd) {
    const { q, B } = s;
    const cp = s.pool.filter(c => this.fitsH(c, 'compressor', s.H));
    const cq = { ...q, ads: s.ads };
    // электрические — первыми; «чтобы поместилось» — не дизельный вместо электрического
    const u =
      this.comps(this.electric(cp), s.Q, B, cq) ||
      (q.compact && this.electric(cp).length ? null : this.comps(cp, s.Q, B, cq));
    if (!u) {
      s.miss.push(this._compMiss(s));
      return;
    }
    StationSup.ctx = StationSup.of(u.o.c);
    s.Bc = u.o.p || B;
    s.picked = u;
    s.add.push(await this.part(u.o.c, u.n + s.res, 'main'));
    this._compGot(s, u, nd);
  }

  static _compMiss(s) {
    const { q, B } = s;
    return `${q.oilFree ? 'безмасляный ' : ''}${q.work > 1 ? `${q.work} компрессора` : 'компрессор'} на ${AirChain.m3(s.Q)} м³/мин${B ? ` и ${AirChain.m3(B)} бар` : ''}`;
  }

  static _compGot(s, u, nd) {
    const { q, B } = s;
    s.got.push(
      `компрессоры ${u.n}${s.res ? ` + ${s.res} резервн.` : ''} × ${u.o.c.name}${nd.why ? ` (потребность: ${nd.why})` : ''}${s.ads ? ` (с запасом ${Math.round(AirChain.PURGE * 100)} % на продувку адсорбционного осушителя)` : ''}`,
    );
    if (B > 0 && u.o.p > 0 && u.o.p < this.barNeed(B, u.o.vsd) - 0.05)
      s.got.push(
        `давление компрессора ${AirChain.m3(u.o.p)} бар — без запаса на потери в осушителе и фильтрах${u.o.vsd ? '' : ' и диапазон регулирования'} (нужно около ${AirChain.m3(this.barNeed(B, u.o.vsd))})`,
      );
    if (q.vsd && !u.o.f) s.got.push('компрессора с частотным регулированием в каталоге нет — подобран без него');
  }

  /** Осушитель — на всю производительность рабочих компрессоров с поправками производителя. */
  static async _compDryer(s) {
    const u = s.picked;
    const Qd = u ? u.o.v * u.n : s.Q;
    const tmax = StationReq.num(String(s.q.tmax ?? '').replace(/[−–]/g, '-'));
    const dm = this.dryer(s.ads, Qd, s.B, s.Bc, { tmax, H: s.H, W: this.wmax(s.x) });
    if (!dm?.o) {
      s.miss.push(
        `${s.ads ? 'адсорбционный' : 'рефрижераторный'} осушитель на ${AirChain.m3(Qd)} м³/мин с поправками на давление и температуру`,
      );
      return;
    }
    const d = dm.o;
    const k = dm.n > 1;
    s.add.push(await this.part(d.c, dm.n));
    s.got.push(
      `${k ? `осушители ${dm.n} × ${d.c.name} параллельно` : this.lbl('осушитель', d.c.name)} (с поправками ${k ? `${dm.n} × ` : ''}${AirChain.m3(d.cap)}${k ? ` = ${AirChain.m3(d.cap * dm.n)}` : ''} м³/мин)`,
    );
  }

  /** Ресиверы — по методике ПНЕВМОТЕХ: типоразмер и число — из рекомендации цепочки. */
  static async _compRecv(s, rec) {
    const role = rec.role || 'dry';
    const size = this.num((rec.r.volume || [])[0]) || 0;
    const { r, n } = this._recvSize(s, rec, size, this._recvH(s, role));
    if (!r?.o) {
      s.miss.push(rec.title.toLowerCase() + (r?.tall ? ' — по высоте не помещается' : ' — подходящих в каталоге нет'));
      return;
    }
    const fp = await this.part(r.o.c, n);
    fp.recvRole = role;
    s.x.kit.parts.splice(s.at++, 0, fp);
    s.got.push(`${this.RECV_ROLE[role] || this.RECV_ROLE.dry}: ${n > 1 ? `${n} × ` : ''}${r.o.c.name}`);
  }

  /** Ресивер снаружи или у потребителя — без ограничения по высоте. */
  static _recvH(s, role) {
    return (s.q.recvOut && role === 'dry') || role === 'local' ? 0 : this.hmax(s.x);
  }

  /** 900 л не помещается по высоте, а нужно не больше 500 л — 500 л с обоснованием «нехватка места». */
  static _recvSize(s, rec, size, H) {
    const r = size > 0 ? this.recvPick(size, s.Bc, H) : null;
    const small = !r?.o && size === ReceiverPlan.UNIT && rec.need > 0 && rec.need <= ReceiverPlan.SMALL;
    const r5 = small ? this.recvPick(ReceiverPlan.SMALL, s.Bc, H) : null;
    if (!r5?.o) return { r, n: rec.qty || 1 };
    StationReq.ensure(s.x).recvWhy = 'space';
    return { r: r5, n: 1 };
  }

  static async _compFilter(s, rec) {
    const u = s.picked;
    const fm = this.filter(rec, u ? u.o.v * u.n : s.Q, s.B, s.Bc);
    if (!fm?.o) {
      s.miss.push(rec.title.toLowerCase());
      return;
    }
    const c = fm.o;
    const fp = await this.part(c.c, fm.n);
    fp.airGrade = rec.key; // ступень, под которую подобран
    s.x.kit.parts.splice(s.at++, 0, fp);
    s.got.push(fm.n > 1 ? `фильтры ${fm.n} × ${c.c.name} параллельно` : this.lbl('фильтр', c.c.name));
  }

  static async _pickPump(s) {
    if (s.q.q > 0) await this._pumps(s);
    return this._done(s);
  }

  static _top(v) {
    const t = StationEquip.top(v);
    return t ? t.v : null;
  }

  static async _pumps(s) {
    const { q } = s;
    const L = s.pool
      .filter(c => this.pumpOk(c))
      .map(c => ({ c, v: this._top(attrsOf(c).flow) || 0, h: this._top(attrsOf(c).head) }))
      .filter(o => o.v > 0 && (!(q.head > 0) || o.h >= q.head));
    const u = this.units(L, q.q, q.work, o => (q.head > 0 && o.h > 0 ? (0.3 * (o.h - q.head)) / q.head : 0));
    if (!u) {
      s.miss.push(
        `${q.work > 1 ? `${q.work} насоса` : 'насос'} на ${AirChain.m3(q.q)} м³/ч${q.head ? ` и ${AirChain.m3(q.head)} м` : ''}`,
      );
      return;
    }
    s.add.push(await this.part(u.o.c, u.n + s.res, 'main'));
    s.got.push(`насосы ${u.n}${s.res ? ` + ${s.res} резервн.` : ''} × ${u.o.c.name}`);
  }

  static async _pickDgu(s) {
    if (s.q.kw > 0) await this._dgu(s);
    return this._done(s);
  }

  /** Мощность — по назначению (резервный — ESP, иначе PRP); одной не хватает — несколько одинаковых параллельно. */
  static async _dgu(s) {
    const { q } = s;
    const L = s.pool
      .filter(c => this.dguOk(c))
      .map(c => ({ c, v: GensetSizing.cap(attrsOf(c), q.mode === 'standby') }))
      .filter(o => o.v > 0);
    const pen = o => this.dguPen(o.c);
    const u = this.units(L, q.kw, q.work || 1, pen) || (q.work ? null : this.units(L, q.kw, 0, pen));
    if (u) {
      const n = u.n + s.res;
      s.add.push(await this.part(u.o.c, n, 'main'));
      s.got.push(`ДГУ ${n > 1 ? `${u.n}${s.res ? ` + ${s.res} резервн.` : ''} × ` : ''}${u.o.c.name}`);
    } else s.miss.push(`ДГУ от ${AirChain.m3(q.kw)} кВт`);
    s.x.kit.parts = [...s.add, ...s.keep];
    this._tank(s);
  }

  static _tank(s) {
    const { x, q } = s;
    const v = q.hours > 0 ? StationDefaults.retank(x, q.hours) : null;
    if (!v) return;
    const fp = StationRules.ok() ? GensetSizing.plan(x) : null;
    s.got.push(
      `топливный бак ${v} л — на ${q.hours} ч при нагрузке ${fp ? Math.round(fp.x * 100) : 75} %${fp ? ` с запасом ${Math.round((StationRules.raw('dgu.fuel_margin') - 1) * 100)} %` : ''}`,
    );
  }

  static note(got, miss) {
    return (
      [
        got.length ? `Подобрано: ${got.join('; ')}` : '',
        miss.length ? `В каталоге нет: ${miss.join('; ')} — добавьте вручную` : '',
      ]
        .filter(Boolean)
        .join('. ') || 'Требования записаны; для подбора не хватило данных (производительность, подача или мощность)'
    );
  }
}
