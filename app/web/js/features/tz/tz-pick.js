import { AirChain } from '../layout/air-chain.js';
import { DryerDerate } from '../layout/dryer-derate.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { PumpPoint } from '../calc/pump-point.js';
import { PressureVessel } from '../layout/pressure-vessel.js';
import { ReceiverPlan } from '../layout/receiver-plan.js';
import { StationClear } from '../layout/station-clear.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationRules } from '../rules/station-rules.js';
import { StationSup } from './station-sup.js';
import { TzFit } from './tz-fit.js';
import { StationDefaults } from '../kit/station-defaults.js';
import { EquipTypes } from '../../core/equip-types.js';
import { FieldUnit } from '../../core/field-unit.js';
import { KitNeed } from '../kit/kit-need.js';
import { KitPart } from '../kit/kit-part.js';
import { Api } from '../../core/net.js';
import { StationAuto, StationName } from '../kit/station-auto.js';
import { StationSize } from '../station/station-size.js';
import { StationUi } from '../station/station-ui.js';
import { StationReq } from '../req/station-req.js';
import { Kit } from '../kit/kit.js';
import { CatalogIndex } from '../catalog/catalog-index.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Attrs } from '../../core/item-attrs.js';

/** Подбор оборудования станции из каталога по требованиям ТЗ — без недобора (в пользу заказчика). */
export class TzPick {
  /** Ступени фильтров, годные под рекомендацию, по порядку предпочтения. */
  static GRADE = { pre: ['pre', 'dust', 'fine'], dust: ['dust', 'fine'] };
  static DROP = { comp: /^(compressor|dryer|filter|receiver)$/, pump: /^pump$/, dgu: /^dgu$/ };
  static TYPE = { comp: 'st_comp', pump: 'st_pump', dgu: 'st_dgu' };
  static PICK = { comp: '_pickComp', pump: '_pickPump', dgu: '_pickDgu' };
  static RECV_ROLE = { dry: 'основной ресивер', wet: 'мокрый ресивер (до осушителя)', local: 'ресивер у потребителя' };
  /** Оценка подбора: штрафы к запасу производительности (меньше — лучше). */
  static PENALTY = {
    unit: 0.08, // каждый следующий одинаковый агрегат
    barShort: 0.5, // давление без запаса на потери
    barOver: 0.05, // за каждый лишний бар
    noVsd: 0.3, // нет частотника, хотя он в ТЗ
    oilFree: 0.5, // безмасляный без требования — дороже
    area: 0.3, // за м² пола («чтобы поместилось»)
    dguHood: 0.15, // ДГУ в кожухе шире — негабарит
    head: 0.3, // лишний напор насоса, доля
    pumpCheck: 1, // рабочая точка между крайними точками паспорта — «уточните»: подходящий точно — важнее
  };
  static AREA_UNKNOWN = 3.5; // м², если габарит агрегата неизвестен
  static EPS = 1e-9;
  static BAR_TOL = 0.05; // давление «равно» с точностью 0,05 бар
  static DEW_TOL = 0.5; // точка росы, °C
  static VOL_TOL = 0.5; // объём ресивера, л
  static BASE_MAX = 6; // базовых ресиверов не больше
  static NO_BAR = 99; // давление не указано — в конец списка
  static SUP_WEIGHT = 10; // тот же поставщик важнее, чем закрытые им виды
  static PUMP = /pump$/;
  static WALL_DEFAULT = 100; // отступ от стены, если в матрице нет, мм
  static ROAD_LEN = 10000; // длина условного блока для ширины и высоты помещения, мм
  static ADS_CLASS = 3; // класс по влаге 1–3 — адсорбционный осушитель
  static ADS_PDP = -20; // точка росы ниже — адсорбционный, °C
  static DEGREES = /\s*°\s*[CcСс]?\s*$/;
  static LOAD_DEFAULT = 75; // нагрузка ДГУ без расчёта, %
  static STEM = 5; // начало слова для «уже есть в названии»

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

  /** Число из значения характеристики. */
  static num(value) {
    return StationEquip.num(value);
  }

  /** Производительность позиции каталога: компрессоры и осушители — м³/мин, насосы — м³/ч (из единицы поля категории). */
  static flow(item) {
    const attrs = Attrs.of(item);
    const value = this.num(attrs.flow);
    if (!(value > 0)) return 0;
    return value * FieldUnit.factor(attrs.cat, 'flow', this.PUMP.test(attrs.cat) ? 'м³/ч' : 'м³/мин');
  }

  /** Из подходящих — с наименьшим key. */
  static best(list, key) {
    return list.reduce((best, option) => (!best || option[key] < best[key] ? option : best), null);
  }

  static _pressOk(pressure, bar, add = 0) {
    return !(bar > 0) || !(pressure > 0) || pressure >= bar + add - this.BAR_TOL;
  }

  static _res(need) {
    return Math.max(0, Math.round(+need.reserve || 0));
  }

  /**
   * Рабочие агрегаты из pool [{c, v}] на нагрузку need: {o, n}; n0 — число рабочих из ТЗ, pen(o) — штраф позиции,
   * rank(o) — приоритет поставщика при том же числе агрегатов.
   */
  static units(pool, need, fixed, pen = () => 0, rank = null) {
    const options = [];
    for (let count = fixed || 1; count <= (fixed || this.MAX); count++)
      for (const option of pool)
        if (option.v * count >= need - this.EPS)
          options.push({
            o: option,
            n: count,
            score: (option.v * count - need) / need + this.PENALTY.unit * (count - 1) + pen(option, count),
          });
    const best = StationSup.pick(options, () => 0, 0);
    if (!best || !rank) return best;
    return StationSup.pick(
      options.filter(z => z.n === best.n),
      z => rank(z.o),
      StationSup.TOL,
    );
  }

  /** Одинаковые аппараты параллельно на need (list — [{c, cap}]): наименьшее число, затем наименьший запас; {o, n} | null. */
  static many(list, need, max = this.MAX) {
    for (let count = 1; count <= max; count++) {
      const options = list
        .filter(z => z.cap * count >= need - this.EPS)
        .map(z => ({
          ...z,
          over: z.cap * count - need,
          score: need > 0 ? (z.cap * count - need) / need : z.cap * count,
        }));
      const best = StationSup.pick(options, z => StationSup.same(z.c), StationSup.TOL);
      if (best) return { o: best, n: count };
    }
    return null;
  }

  /** Компрессоры на Q, м³/мин, и B, бар, у потребителя; q — {oilFree, vsd, work, compact, ads}: {o, n} | null. */
  static comps(pool, demand, bar, need) {
    const vsd = item => AirChain.info({ name: item.name, attrs: Attrs.of(item), rows: [] }, 'compressor').vsd;
    const options = pool
      .filter(item => !need.oilFree || this.oilFree(item))
      .map(item => ({
        c: item,
        v: this.flow(item),
        p: this.num(Attrs.of(item).pressure),
        vsd: vsd(item),
        f: !need.vsd || vsd(item),
        of: !need.oilFree && this.oilFree(item),
      }))
      .filter(
        option =>
          option.v > 0 && this._pressOk(option.p, bar) && !(need.compact && this._bulky(option, demand, bar, need)),
      );
    return this.units(
      options,
      demand,
      need.work,
      option =>
        this.barPen(option.p, bar, option.vsd) +
        (option.f ? 0 : this.PENALTY.noVsd) +
        (option.of ? this.PENALTY.oilFree : 0) +
        (need.compact ? this.area(option.c) : 0),
      option =>
        StationSup.same(option.c) * this.SUP_WEIGHT +
        StationSup.cover(option.c, [need.ads ? 'dryer_ads' : 'dryer_refrig', 'filter']),
    );
  }

  /** Подбор «чтобы поместилось» не берёт безмасляный без требования, без запаса давления и с лишней производительностью. */
  static _bulky(option, demand, bar, need) {
    return (
      option.of ||
      this.barPen(option.p, bar, option.vsd) >= this.PENALTY.barShort ||
      (need.work && option.v * need.work > demand * this.OVER)
    );
  }

  /** Штраф за площадь агрегата на полу; габарит неизвестен — как AREA_UNKNOWN. */
  static area(item) {
    const dims = StationEquip.dims({ name: item.name, attrs: Attrs.of(item), rows: [] }, 'compressor');
    return this.PENALTY.area * (dims.known ? (dims.l * dims.w) / 1e6 : this.AREA_UNKNOWN);
  }

  /**
   * Осушитель на Qd, м³/мин, с поправками производителя (DryerDerate) на давление B и температуры (temps или из tmax, tin);
   * давление аппарата — не ниже Bc, точка росы — не выше pdp, по высоте H и ширине W помещения: {o, n} | null. Условия вне
   * таблиц производителя (взяты крайние значения) — только если других нет.
   */
  static dryer(
    ads,
    demand,
    bar,
    barMin,
    { tmax, tin = null, temps = null, pdp = null, H: height = 0, W: width = 0 } = {},
  ) {
    const conditions = temps || DryerDerate.temps({ tmax, tin });
    const refBar = bar > 0 ? bar : StationRules.raw('dryer.ref').p;
    const category = ads ? 'dryer_ads' : 'dryer_refrig';
    const dewPoint = item => this.num(String(Attrs.of(item).dewPoint ?? '').replace(/[−–]/g, '-'));
    const fits = item =>
      (pdp == null || dewPoint(item) == null || dewPoint(item) <= pdp + this.DEW_TOL) &&
      this.fitsH(item, 'dryer', height) &&
      this.fitsW(item, 'dryer', width);
    const options = Catalog.cache
      .filter(item => Attrs.of(item).cat === category && fits(item))
      .map(item => {
        const card = { name: item.name, attrs: Attrs.of(item), rows: [] };
        const factor = DryerDerate.factor(card, refBar, conditions, ads ? 'ads' : 'refrig');
        return { c: item, v: this.flow(item), cap: this.flow(item) * factor.F, out: factor.out.length > 0 };
      })
      .filter(option => option.v > 0 && this._pressOk(this.num(Attrs.of(option.c).pressure), barMin));
    const inTable = options.filter(option => !option.out);
    return this.many(inTable, demand) || this.many(options, demand);
  }

  /**
   * Фильтр ступени rec.key на Qf, м³/мин, с поправкой производителя на давление; давление фильтра — не ниже Bc;
   * Qf неизвестна — самый маленький этой ступени: {o, n} | null.
   */
  static filter(rec, demand, bar, barMin) {
    const filterBar = bar > 0 ? bar + StationRules.raw('loss.pipe') : StationRules.raw('dryer.ref').p;
    for (const grade of this.GRADE[rec.key] || [rec.key]) {
      const options = Catalog.cache.filter(item => this._filterOk(item, grade, demand, barMin));
      const found =
        demand > 0
          ? this.many(
              options.map(item => ({ c: item, cap: this.flow(item) * this._kf(item, filterBar) })),
              demand,
            )
          : this._smallest(options);
      if (found) return found;
    }
    return null;
  }

  static _kf(item, bar) {
    const series = StationRules.series({ name: item.name, attrs: Attrs.of(item), rows: [] }, 'filter');
    return series ? StationRules.interp(series.f.p, bar) : AirChain.filterK(bar);
  }

  static _filterOk(item, grade, demand, barMin) {
    const attrs = Attrs.of(item);
    const probe = { name: item.name, attrs, rows: [] };
    if (attrs.cat !== 'filter' || AirChain.grade(probe, attrs.cat, AirChain.text(probe)) !== grade) return false;
    if (demand > 0 && !(this.flow(item) > 0)) return false;
    return this._pressOk(this.num(attrs.pressure), barMin);
  }

  static _smallest(options) {
    const flow = item => this.num(Attrs.of(item).flow) || 0;
    const best = StationSup.pick(
      options.map(item => ({ c: item, v: flow(item), score: flow(item) })),
      z => StationSup.same(z.c),
      0,
    );
    return best ? { o: best, n: 1 } : null;
  }

  /** Давление компрессора, бар, для B у потребителя: потери в подготовке и — без частотника — диапазон регулирования. */
  static barNeed(bar, vsd) {
    return bar + this.LOSS + (vsd ? 0 : StationRules.raw('pressure.band'));
  }

  /** Штраф по давлению: меньше нужного — barShort, больше — barOver за каждый бар. */
  static barPen(pressure, bar, vsd) {
    if (!(bar > 0) || !(pressure > 0)) return 0;
    const need = this.barNeed(bar, vsd);
    return pressure < need - this.BAR_TOL ? this.PENALTY.barShort : this.PENALTY.barOver * (pressure - need);
  }

  /** Безмасляный: по полю «Безмасляный (класс 0)», не заполнено — по названию и характеристикам. */
  static oilFree(item) {
    const attrs = Attrs.of(item);
    const field = String(attrs.oilFree ?? '').trim();
    if (/^(да|есть|true)/i.test(field) || /класс\w*\s*0(?![.,\d])/i.test(field)) return true;
    if (/^(нет|false)/i.test(field)) return false; // поле важнее описания серии
    return /безмасл|oil[\s-]?free|класс\w*\s*0(?![.,\d])/i.test(
      [item.name, attrs.model, attrs.series, attrs.lubrication, attrs.oil].filter(Boolean).join(' '),
    );
  }

  /** Передвижной или бензиновый — не для станции в контейнере. */
  static mobile(item) {
    const attrs = Attrs.of(item);
    return (
      /шасси|передвижн|мобильн|колёсн|колесн/i.test(`${String(attrs.execution || '')} ${item.name}`) ||
      /бензин/i.test(item.name)
    );
  }

  /** Насос для стационарной станции: электрический, не погружной, не скважинный, не дренажный, не мотопомпа. */
  static pumpOk(item) {
    const attrs = Attrs.of(item);
    return (
      !/мотопомп|погружн|скважин|дренаж|фекал/i.test(`${String(attrs.kind || '')} ${item.name}`) &&
      !/дизел|бензин/i.test(String(attrs.drive || ''))
    );
  }

  /** ДГУ в кожухе шире — станция уходит в негабарит: штраф к оценке. */
  static dguPen(item) {
    return /кожух|капот|шумозащит/i.test(`${String(Attrs.of(item).execution || '')} ${item.name}`)
      ? this.PENALTY.dguHood
      : 0;
  }

  /** ДГУ для станции 0,4 кВ: трёхфазная 400 В, не однофазная и не высоковольтная; «400 / 230 В» — трёхфазная. */
  static dguOk(item) {
    const attrs = Attrs.of(item);
    const text = `${String(attrs.voltage || '')} ${String(attrs.phases || '')} ${item.name}`;
    if (/\d{4,}\s*В(?![а-яё])|\d+(?:[.,]\d+)?\s*кВ(?![а-яёА-ЯЁ])/i.test(text.replace(/(\d)\s+(?=\d{3}\b)/g, '$1')))
      return false;
    if (/3\s*фаз|тр[её]хфазн/i.test(text)) return true;
    return !/однофазн|1\s*фаз|(?<![\d\/]\s*)(?<!\d)(?:220|230)\s*В(?![а-яё])(?!\s*\/)/i.test(text);
  }

  /** Позиции каталога видов cats, годные для станции в контейнере. */
  static stationPool(cats) {
    return Catalog.cache.filter(item => cats.includes(Attrs.of(item).cat) && !this.mobile(item));
  }

  /** Только с электроприводом. */
  static electric(pool) {
    return pool.filter(item => Attrs.of(item).cat !== 'comp_diesel');
  }

  static _recvAll() {
    return Catalog.cache
      .filter(item => Attrs.of(item).cat === 'receiver')
      .map(item => {
        const attrs = Attrs.of(item);
        return {
          c: item,
          v: this.num(attrs.volume) || 0,
          p: this.num(attrs.pressure),
          h: StationEquip.dims({ name: item.name, attrs, rows: [] }, 'receiver').h,
        };
      });
  }

  static _fitsTop(option, Hmax) {
    return !(Hmax > 0) || option.h + this.RECV_TOP <= Hmax;
  }

  /** Порядок ресиверов: производитель в приоритете, тот же поставщик, в наличии, меньшее давление, дешевле, ниже. */
  static _recvOrder() {
    const base = AirChain.BASE;
    const maker = String(base?.maker || '')
      .trim()
      .toLowerCase();
    const pri = option =>
      maker &&
      String(Attrs.of(option.c).maker || '')
        .trim()
        .toLowerCase() === maker
        ? 0
        : 1;
    return (first, second) =>
      pri(first) - pri(second) ||
      StationSup.same(second.c) - StationSup.same(first.c) ||
      this.stock(second.c) - this.stock(first.c) ||
      (first.p || this.NO_BAR) - (second.p || this.NO_BAR) ||
      this.cheaper(first.c, second.c) ||
      first.h - second.h;
  }

  /**
   * Ресиверы на объём V, л: по умолчанию одинаковые базового типоразмера; иначе наименьшее число, сначала без учёта в
   * Ростехнадзоре; давление — не ниже B, высота с арматурой — не выше Hmax (0 — снаружи): {o, n, free} | null.
   */
  static receivers(volume, bar, Hmax) {
    const options = this._recvAll().filter(
      option => option.v > 0 && this._pressOk(option.p, bar) && this._fitsTop(option, Hmax),
    );
    const free = option => !(bar > 0) || ((bar / 10) * option.v) / 1000 <= PressureVessel.LIMIT + this.EPS;
    const base = this._recvBase(options, volume, bar, free);
    if (base) return base;
    if (!(volume > 0)) return options.length ? { o: this.best(options, 'v'), n: 1, free: true } : null;
    const limits = StationMatrix.grp('pick');
    return (
      this._recvN(options, volume, free, true, limits.recvFree) ||
      this._recvN(options, volume, free, false, limits.recvAny)
    );
  }

  static _recvBase(options, volume, bar, free) {
    const base = AirChain.BASE;
    const baseSet = base ? AirChain.base(volume > 0 ? volume : base.volume, bar) : null;
    if (!(baseSet && baseSet.n <= this.BASE_MAX)) return null;
    const candidates = options
      .filter(option => Math.abs(option.v - baseSet.v) < this.VOL_TOL && free(option))
      .sort(this._recvOrder());
    return candidates.length ? { o: candidates[0], n: baseSet.n, free: true, base: true } : null;
  }

  static _recvN(options, volume, free, only, max) {
    for (let count = 1; count <= max; count++) {
      const best = StationSup.pick(
        options.filter(z => z.v * count >= volume - this.EPS && (!only || free(z))).map(z => ({ ...z, score: z.v })),
        z => StationSup.same(z.c),
        0,
      );
      if (best) return { o: best, n: count, free: free(best) };
    }
    return null;
  }

  /**
   * Ресивер типоразмера size, л: давление — с запасом над компрессором, нет такого — не ниже; высота — не выше Hmax.
   * {o} | {o: null, tall — есть, но выше} | null.
   */
  static recvPick(size, bar, Hmax) {
    const all = this._recvAll().filter(
      option => Math.abs(option.v - size) < this.VOL_TOL && this._pressOk(option.p, bar),
    );
    const fit = all.filter(option => this._fitsTop(option, Hmax));
    const order = this._recvOrder();
    for (const add of [ReceiverPlan.METHOD.margin, 0]) {
      const best = fit.filter(z => this._pressOk(z.p, bar, add)).sort(order)[0];
      if (best) return { o: best };
    }
    return all.length ? { o: null, tall: true } : null;
  }

  /** По закупке, иначе по цене (одна валюта; без цены — в конце): < 0 — a дешевле. */
  static cheaper(first, second) {
    const cost = (item, k) => (+item[k] > 0 ? +item[k] : Infinity);
    for (const [k, cur] of [
      ['cost', 'costCur'],
      ['price', 'priceCur'],
    ]) {
      const costA = cost(first, k);
      const costB = cost(second, k);
      if (costA === Infinity && costB === Infinity) continue;
      if (costA !== Infinity && costB !== Infinity && (first[cur] || 'RUB') !== (second[cur] || 'RUB')) return 0;
      return Math.sign(costA - costB);
    }
    return 0;
  }

  /** В наличии на складе поставщика: 1 / 0. */
  static stock(item) {
    return CatalogIndex.inStock(item) ? 1 : 0;
  }

  static _roadInner(grade) {
    return StationGeo.inner(grade.type, [this.ROAD_LEN, StationGeo.ROAD_W, StationGeo.BLOCK.maxH], grade.t);
  }

  /** Высота внутри контейнера станции, мм; по оборудованию — наибольшая высота ряда. */
  static hmax(station) {
    const grade = StationGeo.of(Kit.container(station) || { ctype: 'block' });
    return grade.int ? grade.int[2] : this._roadInner(grade)[2];
  }

  /** Полезная ширина помещения, мм; без размера — блок в ширину перевозки. */
  static wmax(station) {
    const grade = StationGeo.of(Kit.container(station) || { ctype: 'block' });
    const innerWidth = grade.int && !grade.auto ? grade.int[1] : this._roadInner(grade)[1];
    return innerWidth - 2 * StationMatrix.gap();
  }

  /** Помещается в плане с проходом (W, мм; 0 — без ограничения): меньшая сторона + отступ «плотно» + проход «не менее». */
  static fitsW(item, kind, width) {
    if (!(width > 0)) return true;
    const dims = StationEquip.dims({ name: item.name, attrs: Attrs.of(item), rows: item.rows || [] }, kind);
    if (!dims.known) return true;
    const side = Math.min(dims.l, dims.w);
    const wall = StationMatrix.wall({ kind, w: side });
    return side + (wall ? wall[1] : this.WALL_DEFAULT) + StationClear.aisle()[1] <= width;
  }

  /** Проходит по высоте H, мм (0 — без ограничения); над осушителем — место на подключение. */
  static fitsH(item, kind, height) {
    if (!(height > 0)) return true;
    const dims = StationEquip.dims({ name: item.name, attrs: Attrs.of(item), rows: [] }, kind);
    return !dims.known || dims.h + (kind === 'dryer' ? StationMatrix.grp('pick').dryerFit : 0) <= height;
  }

  /** «осушитель …» — без повтора слова, если оно уже есть в названии. */
  static lbl(word, name) {
    return String(name || '')
      .toLowerCase()
      .includes(word.slice(0, this.STEM))
      ? name
      : `${word} ${name}`;
  }

  /** Подбор и сборка станции: шкафы по особым требованиям, оборудование, название, характеристики, контейнер. */
  static async assemble(station, need) {
    const added = StationReq.ensureParts(station);
    const note = await this.run(station, need);
    Kit.sync(station);
    StationUi.cache.delete(station.id);
    StationSize.refresh(station);
    StationAuto.fill(station);
    StationName.apply(station);
    return [note, added.length ? `Добавлено по ТЗ: ${added.join(', ')}` : ''].filter(Boolean).join('. ');
  }

  /** Элемент состава из позиции каталога: полная карточка с сервера, нет связи — из кэша каталога. */
  static async part(item, qty, role) {
    let doc = item;
    try {
      doc = await Api.request(`/api/catalog/${encodeURIComponent(item.id)}`);
    } catch {}
    const part = KitPart.fromCat(doc);
    part.qty = qty;
    if (role) part.role = role;
    return part;
  }

  /** Подбор с защитой состава: чего в каталоге не нашлось — прежнее оборудование этого вида остаётся. */
  static async run(station, need) {
    const drop = this.DROP[need.kind] || /^$/;
    const before = Kit.parts(station).filter(
      part => part.role !== 'container' && drop.test(StationEquip.kindOf(part) || ''),
    );
    const note = await TzFit.fit(station, need);
    const kept = this._restore(station, before);
    return kept.length ? `${note}. Оставлено прежнее: ${kept.join('; ')}` : note;
  }

  static _restore(station, before) {
    const kept = [];
    let air = null;
    // фильтры и ресиверы — только если цепочка воздуха их по-прежнему просит
    const need = k => {
      if (k !== 'filter' && k !== 'receiver') return true;
      air ??= StationLayout.solve(StationUi.input(station)).air || KitNeed.air(station) || { recs: [] };
      return (air.recs || []).some(rec => rec.cat === k && !rec.replace);
    };
    for (const k of new Set(before.map(part => StationEquip.kindOf(part)))) {
      if (Kit.parts(station).some(part => StationEquip.kindOf(part) === k) || !need(k)) continue;
      const old = before.filter(part => StationEquip.kindOf(part) === k);
      const index = Kit.parts(station).findIndex(part => part.role === 'container');
      station.kit.parts.splice(index < 0 ? station.kit.parts.length : index, 0, ...old);
      kept.push(...old.map(part => part.name));
    }
    return kept;
  }

  /** Подбор в станцию x по требованиям q (без защиты состава — run). */
  static pick(station, need) {
    const kind = need.kind;
    const drop = this.DROP[kind] || this.DROP.dgu;
    const cats = (EquipTypes.byId(this.TYPE[kind]).station || {}).main || [];
    const job = {
      x: station,
      q: need,
      res: this._res(need),
      got: [],
      miss: [],
      add: [],
      keep: Kit.parts(station).filter(part => part.role === 'container' || !drop.test(StationEquip.kindOf(part) || '')),
      pool: this.stationPool(cats),
      H: this.hmax(station),
    };
    StationSup.ctx = ''; // поставщик — по подобранным основным агрегатам
    const method = this.PICK[kind];
    return method ? this[method](job) : Promise.resolve(this._done(job));
  }

  static _done(job) {
    job.x.kit.parts = [...job.add, ...job.keep];
    return this.note(job.got, job.miss);
  }

  static async _pickComp(job) {
    const { x: station, q: need } = job;
    job.B = need.pressure;
    job.Bc = job.B; // давление аппаратов — не ниже наибольшего давления компрессора
    job.picked = null;
    this._recvWhere(station, need);
    const demand = this._need(job);
    if (job.Q > 0) {
      await this._compMain(job, demand);
      await this._compDryer(job);
    }
    station.kit.parts = [...job.add, ...job.keep];
    job.at = job.add.length;
    await this._chain(job);
    return this.note(job.got, job.miss);
  }

  /**
   * Требуемая точка росы, °C: более строгая из ТЗ и класса воды ISO 8573-1 (air.pdp); нет ни той, ни другой — null.
   * @param {object} need запрос подбора
   * @returns {number|null}
   */
  static dewNeed(need) {
    const own = StationReq.num(
      String(need.pdp ?? '')
        .replace(/[−–]/g, '-')
        .replace(this.DEGREES, ''),
    );
    const water = +(String(need.air || '').split('.')[1] || 0);
    const known = [own, water ? AirChain.PDP[water] : null].filter(value => value != null);
    return known.length ? Math.min(...known) : null;
  }

  /**
   * Нужен ли адсорбционный осушитель: класс воды 1–3 или точка росы ниже ADS_PDP.
   * @param {object} need запрос подбора
   * @returns {boolean}
   */
  static adsNeed(need) {
    const moistClass = +(String(need.air || '').split('.')[1] || 0);
    return Boolean((moistClass && moistClass <= this.ADS_CLASS) || (need.pdp != null && +need.pdp <= this.ADS_PDP));
  }

  /** Потребность — FAD с запасом; адсорбционный осушитель — компрессоры с запасом на продувку. */
  static _need(job) {
    const { q: need } = job;
    job.ads = this.adsNeed(need);
    const demand = need.flow > 0 ? StationReq.need(need, need.flow) : { v: 0, why: '' };
    job.Q = job.ads && demand.v > 0 ? demand.v / (1 - AirChain.PURGE) : demand.v;
    return demand;
  }

  /** Фильтры и ресиверы — по цепочке воздуха, и когда компоновка не сложилась. */
  static async _chain(job) {
    const air = StationLayout.solve(StationUi.input(job.x)).air || KitNeed.air(job.x);
    for (const rec of (air?.recs || []).filter(
      entry => (entry.cat === 'filter' || entry.cat === 'receiver') && !entry.replace,
    ))
      await (rec.cat === 'receiver' ? this._compRecv(job, rec) : this._compFilter(job, rec));
  }

  static _recvWhere(station, need) {
    const req = StationReq.ensure(station);
    if (need.recv === 'after' || need.recv === 'before') req.recv = need.recv;
    if (need.recvOut) req.recvOut = true;
  }

  static async _compMain(job, demand) {
    const { q: need, B: bar } = job;
    const compressors = job.pool.filter(item => this.fitsH(item, 'compressor', job.H));
    const compNeed = { ...need, ads: job.ads };
    // электрические — первыми; «чтобы поместилось» — не дизельный вместо электрического
    const chosen =
      this.comps(this.electric(compressors), job.Q, bar, compNeed) ||
      (need.compact && this.electric(compressors).length ? null : this.comps(compressors, job.Q, bar, compNeed));
    if (!chosen) {
      job.miss.push(this._compMiss(job));
      return;
    }
    StationSup.ctx = StationSup.of(chosen.o.c);
    job.Bc = chosen.o.p || bar;
    job.picked = chosen;
    job.add.push(await this.part(chosen.o.c, chosen.n + job.res, 'main'));
    this._compGot(job, chosen, demand);
  }

  static _compMiss(job) {
    const { q: need, B: bar } = job;
    return `${need.oilFree ? 'безмасляный ' : ''}${need.work > 1 ? `${need.work} компрессора` : 'компрессор'} на ${AirChain.flowText(job.Q)} м³/мин${bar ? ` и ${AirChain.flowText(bar)} бар` : ''}`;
  }

  static _compGot(job, chosen, demand) {
    const { q: need, B: bar } = job;
    job.got.push(
      `компрессоры ${chosen.n}${job.res ? ` + ${job.res} резервн.` : ''} × ${chosen.o.c.name}${demand.why ? ` (потребность: ${demand.why})` : ''}${job.ads ? ` (с запасом ${Math.round(AirChain.PURGE * 100)} % на продувку адсорбционного осушителя)` : ''}`,
    );
    if (bar > 0 && chosen.o.p > 0 && chosen.o.p < this.barNeed(bar, chosen.o.vsd) - this.BAR_TOL)
      job.got.push(
        `давление компрессора ${AirChain.flowText(chosen.o.p)} бар — без запаса на потери в осушителе и фильтрах${chosen.o.vsd ? '' : ' и диапазон регулирования'} (нужно около ${AirChain.flowText(this.barNeed(bar, chosen.o.vsd))})`,
      );
    if (need.vsd && !chosen.o.f)
      job.got.push('компрессора с частотным регулированием в каталоге нет — подобран без него');
  }

  /** Осушитель — на всю производительность рабочих компрессоров с поправками производителя и точкой росы по ТЗ. */
  static async _compDryer(job) {
    const chosen = job.picked;
    const demand = chosen ? chosen.o.v * chosen.n : job.Q;
    const degrees = key => StationReq.num(String(job.q[key] ?? '').replace(/[−–]/g, '-'));
    const pdp = this.dewNeed(job.q);
    const limits = { tmax: degrees('tmax'), tin: degrees('tin'), pdp, H: job.H, W: this.wmax(job.x) };
    const dryers = this.dryer(job.ads, demand, job.B, job.Bc, limits);
    if (!dryers?.o) {
      const dew = pdp == null ? '' : ` и точкой росы не выше ${AirChain.dewText(pdp)}`;
      job.miss.push(
        `${job.ads ? 'адсорбционный' : 'рефрижераторный'} осушитель на ${AirChain.flowText(demand)} м³/мин с поправками на давление и температуру${dew}`,
      );
      return;
    }
    const best = dryers.o;
    const k = dryers.n > 1;
    job.add.push(await this.part(best.c, dryers.n));
    job.got.push(
      `${k ? `осушители ${dryers.n} × ${best.c.name} параллельно` : this.lbl('осушитель', best.c.name)} (с поправками ${k ? `${dryers.n} × ` : ''}${AirChain.flowText(best.cap)}${k ? ` = ${AirChain.flowText(best.cap * dryers.n)}` : ''} м³/мин)`,
    );
  }

  /** Ресиверы — по методике ПНЕВМОТЕХ: типоразмер и число — из рекомендации цепочки. */
  static async _compRecv(job, rec) {
    const role = rec.role || 'dry';
    const size = this.num((rec.r.volume || [])[0]) || 0;
    const { r: found, n: count } = this._recvSize(job, rec, size, this._recvH(job, role));
    if (!found?.o) {
      job.miss.push(
        rec.title.toLowerCase() + (found?.tall ? ' — по высоте не помещается' : ' — подходящих в каталоге нет'),
      );
      return;
    }
    const part = await this.part(found.o.c, count);
    part.recvRole = role;
    job.x.kit.parts.splice(job.at++, 0, part);
    job.got.push(`${this.RECV_ROLE[role] || this.RECV_ROLE.dry}: ${count > 1 ? `${count} × ` : ''}${found.o.c.name}`);
  }

  /** Ресивер снаружи или у потребителя — без ограничения по высоте. */
  static _recvH(job, role) {
    return (job.q.recvOut && role === 'dry') || role === 'local' ? 0 : this.hmax(job.x);
  }

  /** 900 л не помещается по высоте, а нужно не больше 500 л — 500 л с обоснованием «нехватка места». */
  static _recvSize(job, rec, size, height) {
    const found = size > 0 ? this.recvPick(size, job.Bc, height) : null;
    const small = !found?.o && size === ReceiverPlan.UNIT && rec.need > 0 && rec.need <= ReceiverPlan.SMALL;
    const found500 = small ? this.recvPick(ReceiverPlan.SMALL, job.Bc, height) : null;
    if (!found500?.o) return { r: found, n: rec.qty || 1 };
    StationReq.ensure(job.x).recvWhy = 'space';
    return { r: found500, n: 1 };
  }

  static async _compFilter(job, rec) {
    const chosen = job.picked;
    const filters = this.filter(rec, chosen ? chosen.o.v * chosen.n : job.Q, job.B, job.Bc);
    if (!filters?.o) {
      job.miss.push(rec.title.toLowerCase());
      return;
    }
    const best = filters.o;
    const part = await this.part(best.c, filters.n);
    part.airGrade = rec.key; // ступень, под которую подобран
    job.x.kit.parts.splice(job.at++, 0, part);
    job.got.push(filters.n > 1 ? `фильтры ${filters.n} × ${best.c.name} параллельно` : this.lbl('фильтр', best.c.name));
  }

  static async _pickPump(job) {
    if (job.q.q > 0) await this._pumps(job);
    return this._done(job);
  }

  static _top(value) {
    const top = StationEquip.top(value);
    return top ? top.v : null;
  }

  static async _pumps(job) {
    const { q: need } = job;
    const options = job.pool
      .filter(item => this.pumpOk(item))
      .map(item => ({ c: item, v: this._top(Attrs.of(item).flow) || 0, h: this._top(Attrs.of(item).head) }))
      .filter(option => option.v > 0 && (!(need.head > 0) || option.h >= need.head));
    const chosen = this.units(options, need.q, need.work, (option, count) => this.pumpPen(option, count, need));
    if (!chosen) {
      job.miss.push(
        `${need.work > 1 ? `${need.work} насоса` : 'насос'} на ${AirChain.flowText(need.q)} м³/ч${need.head ? ` и ${AirChain.flowText(need.head)} м` : ''}`,
      );
      return;
    }
    job.add.push(await this.part(chosen.o.c, chosen.n + job.res, 'main'));
    job.got.push(`насосы ${chosen.n}${job.res ? ` + ${job.res} резервн.` : ''} × ${chosen.o.c.name}`);
  }

  /**
   * Штраф насоса: лишний напор и рабочая точка, которую по крайним точкам паспорта не проверить (PumpPoint).
   * @param {{c: object, h: number|null}} option позиция каталога и её напор
   * @param {number} count рабочих насосов
   * @param {{q: number, head: number}} need подача станции, м³/ч, и напор, м
   * @returns {number}
   */
  static pumpPen(option, count, need) {
    if (!(need.head > 0)) return 0;
    const extra = option.h > 0 ? (this.PENALTY.head * (option.h - need.head)) / need.head : 0;
    const tol = StationRules.raw('calc.tolerance');
    const unsure = PumpPoint.verdict(Attrs.of(option.c), need.q / count, need.head, tol) === PumpPoint.CHECK;
    return extra + (unsure ? this.PENALTY.pumpCheck : 0);
  }

  static async _pickDgu(job) {
    if (job.q.kw > 0) await this._dgu(job);
    return this._done(job);
  }

  /** Мощность — по назначению (резервный — ESP, иначе PRP); одной не хватает — несколько одинаковых параллельно. */
  static async _dgu(job) {
    const { q: need } = job;
    const options = job.pool
      .filter(item => this.dguOk(item))
      .map(item => ({ c: item, v: GensetSizing.cap(Attrs.of(item), need.mode === 'standby') }))
      .filter(option => option.v > 0);
    const pen = option => this.dguPen(option.c);
    const chosen =
      this.units(options, need.kw, need.work || 1, pen) || (need.work ? null : this.units(options, need.kw, 0, pen));
    if (chosen) {
      const count = chosen.n + job.res;
      job.add.push(await this.part(chosen.o.c, count, 'main'));
      job.got.push(
        `ДГУ ${count > 1 ? `${chosen.n}${job.res ? ` + ${job.res} резервн.` : ''} × ` : ''}${chosen.o.c.name}`,
      );
    } else job.miss.push(`ДГУ от ${AirChain.flowText(need.kw)} кВт`);
    job.x.kit.parts = [...job.add, ...job.keep];
    this._tank(job);
  }

  static _tank(job) {
    const { x: station, q: need } = job;
    const volume = need.hours > 0 ? StationDefaults.retank(station, need.hours) : null;
    if (!volume) return;
    const fuel = StationRules.ok() ? GensetSizing.plan(station) : null;
    job.got.push(
      `топливный бак ${volume} л — на ${need.hours} ч при нагрузке ${fuel ? Math.round(fuel.x * 100) : this.LOAD_DEFAULT} %${fuel ? ` с запасом ${Math.round((StationRules.raw('dgu.fuel_margin') - 1) * 100)} %` : ''}`,
    );
  }

  /** Итог подбора для менеджера. */
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
