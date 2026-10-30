import { Str } from '../../core/str.js';
import { StationEquip } from '../layout/station-equip.js';
import { Attrs } from '../../core/item-attrs.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { PickFilter } from './kit-pick.js';
import { AirChain } from '../layout/air-chain.js';
import { Kit } from './kit.js';
import { TzPick } from '../tz/tz-pick.js';
import { StationSup } from '../tz/station-sup.js';
import { StationReq } from '../req/station-req.js';
import { KitNeed } from './kit-need.js';
import { ReqNum } from '../req/req-num.js';
import { StationPlan } from './station-plan.js';
/**
 * Подбор из каталога по строке «Нужно: …»: рекомендуемая позиция (тот же расчёт, что у автоподбора TzPick), фильтры и
 * подсказка окна каталога; основное оборудование — по требованиям «Подбора станции».
 */
export class NeedPick {
  static EPS = 1e-9;
  static ADS_CLASS_MAX = 3;
  static LABEL = { flow: 'производительность от', volume: 'объём от' };
  static UNIT = { flow: 'м³/мин', volume: 'л' };
  static MAIN = { comp: '_compressors', dgu: '_gensets', pump: '_pumps' };

  static _reserve(req) {
    return Math.max(0, Math.round(ReqNum.loose(req.reserve) || 0));
  }

  static _context(item) {
    const air = KitNeed.air(item);
    const req = StationReq.of(item);
    return { air, flow: air ? air.work : 0, req, bar: ReqNum.loose(req.pressure) || 0, compBar: KitNeed.bar(item) };
  }

  /**
   * Рекомендуемая позиция каталога по рекомендации.
   * @param {object} item позиция КП
   * @param {object} rec рекомендация KitNeed
   * @returns {{c: object, n: number, role?: string}|null} c — позиция, n — штук параллельно, role — роль ресивера
   */
  static best(item, rec) {
    StationSup.use(item); // при равных условиях — поставщик компрессоров станции
    const ctx = this._context(item);
    if (/^dryer-/.test(rec.key)) return this._found(this._dryer(item, rec, ctx)) || this._any(item, rec);
    if (rec.cat === 'filter') {
      return this._found(TzPick.filter(rec, ctx.flow, ctx.bar, ctx.compBar)) || this._any(item, rec);
    }
    if (rec.cat === 'receiver') return this._receiver(item, rec, ctx);
    return this._any(item, rec);
  }

  static _found(found) {
    return found ? { c: found.o.c, n: found.n } : null;
  }

  // поправки — те же, что у «Компоновки» и расчётной записки; точка росы — у осушителя, который её даёт (как у TzPick)
  static _dryer(item, rec, ctx) {
    if (!(ctx.flow > 0)) return null;
    const ads = rec.cat === 'dryer_ads';
    const need = { pdp: ctx.req.pdp, air: StationPlan.opts(item).air };
    const pdp = ads || !TzPick.adsNeed(need) ? TzPick.dewNeed(need) : null;
    const limits = { temps: ctx.air.dryer.temps, pdp, H: TzPick.hmax(item), W: TzPick.wmax(item) };
    return TzPick.dryer(ads, ctx.flow, ctx.air.dryer.bar, ctx.compBar, limits);
  }

  // замена ресиверов на учёте (recv-split) — по объёму заменяемых; остальные — типоразмер и число по методике
  static _receiver(item, rec, ctx) {
    if (rec.key === 'recv-split') return this._split(item, rec, ctx);
    const role = rec.role || 'dry';
    const outside = (StationReq.recvOut(item) && role === 'dry') || role === 'local';
    const volume = ReqNum.loose((rec.r.volume || [])[0]) || 0;
    const plan = TzPick.recvPick(volume, ctx.compBar, outside ? 0 : TzPick.hmax(item));
    return plan && plan.o ? { c: plan.o.c, n: Math.max(1, +rec.qty || 1), role } : null;
  }

  static _split(item, rec, ctx) {
    const old = Kit.parts(item)
      .filter(part => (rec.replace || []).includes(part.id))
      .reduce((sum, part) => sum + (AirChain.volume(part) || 0) * Math.max(1, +part.qty || 1), 0);
    if (!(old > 0)) return null;
    const plan = TzPick.receivers(old, ctx.compBar, StationReq.recvOut(item) ? 0 : TzPick.hmax(item));
    return plan ? { c: plan.o.c, n: plan.n } : null;
  }

  static _any(item, rec) {
    const list = PickFilter.list(this.filters(item, rec), [rec.cat], 1).list;
    return list.length ? { c: list[0], n: Math.max(1, +rec.qty || 1) } : null;
  }

  /**
   * Фильтры окна каталога по рекомендации: давление не ниже компрессорного (без данных не отсекается).
   * @param {object} item
   * @param {object} rec
   * @returns {object} {cat, f, r, min}
   */
  static filters(item, rec) {
    const compBar = KitNeed.bar(item);
    const filter = PickFilter.create([rec.cat]);
    Object.assign(filter.f, rec.f || {});
    for (const [key, range] of Object.entries(rec.r || {})) filter.r[key] = [...range];
    if (compBar > 0) filter.min = { pressure: compBar };
    return filter;
  }

  /**
   * Пресет окна подбора по рекомендации: фильтры, строка «что нужно», рекомендуемый, количество и замена.
   * @param {object} item
   * @param {object} rec
   * @returns {object}
   */
  static preset(item, rec) {
    const air = KitNeed.air(item);
    const filter = this.filters(item, rec);
    const best = this.best(item, rec);
    return {
      f: filter.f,
      r: filter.r,
      min: filter.min,
      rows: rec.rows,
      attrs: rec.attrs,
      qty: rec.qty,
      replace: rec.replace,
      role: rec.cat === 'receiver' ? rec.role || '' : '',
      grade: rec.cat === 'filter' && AirChain.GRADES[rec.key] ? rec.key : '',
      best: best
        ? { id: best.c.id, n: best.n, label: best.n > 1 && rec.cat === 'receiver' ? `${best.n} шт.` : '' }
        : null,
      title: rec.title,
      need: this._need(rec, air, filter),
    };
  }

  static _need(rec, air, filter) {
    const shown = [
      ...Object.entries(filter.r)
        .filter(([, range]) => range && range[0])
        .map(([key, range]) =>
          `${this.LABEL[key] || key} ${String(range[0]).replace('.', ',')} ${this.UNIT[key] || ''}`.trim(),
        ),
      ...(filter.min.pressure ? [`давление от ${AirChain.flowText(filter.min.pressure)} бар`] : []),
      ...Object.values(filter.f).filter(Boolean),
    ];
    const title = rec.title.charAt(0).toLowerCase() + rec.title.slice(1);
    const chain =
      air && air.work
        ? ` — к компрессорам ${AirChain.flowText(air.work)} м³/мин, ${AirChain.flowText(air.bar)} бар`
        : '';
    const tail = shown.length ? ` Показаны подходящие: ${shown.join(', ')}.` : '';
    return `${rec.swap ? 'Заменить: ' : 'Нужно: '}${title}${chain}.${tail}`;
  }

  /**
   * Основное оборудование по требованиям «Подбора станции»: подходящие на рабочий агрегат, рекомендуемый — первым, с
   * числом рабочих и резервных.
   * @param {object} item
   * @returns {object|null} {test, qty, best, need, min?}
   */
  static mainPreset(item) {
    const req = StationReq.of(item);
    const ctx = {
      item,
      req,
      reserve: this._reserve(req),
      work: +req.work || 0,
      pool: TzPick.stationPool((Kit.station(item) || {}).main || []),
    };
    const method = this.MAIN[StationReq.kind(item)];
    return method ? this[method](ctx) : null;
  }

  static _tail(ctx, count) {
    return `${count > 1 ? ` — ${count} рабочих` : ''}${ctx.reserve ? ` + ${ctx.reserve} в резерве` : ''}`;
  }

  static _result(ctx, { unit, count, test, need, extra = {} }) {
    const reserve = ctx.reserve;
    const best = unit
      ? {
          id: unit.o.c.id,
          n: unit.n + reserve,
          label:
            unit.n + reserve > 1
              ? `${unit.n} рабоч.${reserve ? ` + ${reserve} резерв.` : ''} = ${unit.n + reserve} шт.`
              : '',
        }
      : null;
    return { test, qty: count + reserve, best, need, ...extra };
  }

  static _compressors(ctx) {
    const { item, req, work, pool } = ctx;
    const flow = ReqNum.loose(req.flow);
    const bar = ReqNum.loose(req.pressure) || 0;
    if (!(flow > 0)) return null;
    const waterClass = +(String(StationPlan.opts(item).air || '').split('.')[1] || 0);
    const ads = waterClass > 0 && waterClass <= this.ADS_CLASS_MAX;
    const demand = StationReq.need(req, flow);
    const total = ads ? demand.v / (1 - AirChain.PURGE) : demand.v;
    const height = TzPick.hmax(item);
    const fitting = pool.filter(card => TzPick.fitsH(card, 'compressor', height));
    const query = { oilFree: StationReq.oilFree(item), vsd: !!req.vsd, work, ads };
    StationSup.use(item);
    const unit = TzPick.comps(TzPick.electric(fitting), total, bar, query) || TzPick.comps(fitting, total, bar, query);
    const count = unit ? unit.n : work || 1;
    const per = total / count;
    const oilFree = query.oilFree;
    return this._result(ctx, {
      unit,
      count,
      test: card => TzPick.flow(card) >= per - this.EPS && (!oilFree || TzPick.oilFree(card)),
      need: this._compNeed(ctx, { total, bar, demand, ads, count, per, oilFree }),
      extra: { min: bar > 0 ? { pressure: bar } : {} },
    });
  }

  static _compNeed(ctx, { total, bar, demand, ads, count, per, oilFree }) {
    const fmt = AirChain.flowText;
    const why = [demand.why, ads ? 'с запасом на продувку адсорбционного осушителя' : ''].filter(Boolean).join(', ');
    return `Нужно ${fmt(total)} м³/мин${bar ? ` при ${fmt(bar)} бар у потребителя` : ''}${demand.why || ads ? ` (${why})` : ''}${this._tail(ctx, count)}. Показаны компрессоры от ${fmt(per)} м³/мин${bar ? `, давление от ${fmt(bar)} бар` : ''}${oilFree ? `, безмасляные (${StationReq.oilWhy(ctx.item)})` : ''}.`;
  }

  static _gensets(ctx) {
    const { req, work, pool } = ctx;
    const power = ReqNum.loose(req.kw);
    if (!(power > 0)) return null;
    const standby = req.mode === 'standby';
    const capacity = card => GensetSizing.cap(Attrs.of(card), standby);
    const options = pool
      .filter(card => TzPick.dguOk(card))
      .map(card => ({ c: card, v: capacity(card) }))
      .filter(option => option.v > 0);
    const unit = TzPick.units(options, power, work || 1, option => TzPick.dguPen(option.c));
    const count = unit ? unit.n : work || 1;
    const per = power / count;
    const fmt = AirChain.flowText;
    return this._result(ctx, {
      unit,
      count,
      test: card => capacity(card) >= per - this.EPS,
      need: `Нужно ${fmt(power)} кВт${standby ? ' (резервный источник — по ESP)' : ''}${this._tail(ctx, count)}. Показаны ДГУ от ${fmt(per)} кВт.`,
    });
  }

  static _top(value) {
    const top = StationEquip.top(value);
    return top ? top.v : null;
  }

  static _pumps(ctx) {
    const { req, work, pool } = ctx;
    const flow = ReqNum.loose(req.q);
    const head = ReqNum.loose(req.head) || 0;
    if (!(flow > 0)) return null;
    const flowOf = card => this._top(Attrs.of(card).flow) || 0;
    const headOf = card => this._top(Attrs.of(card).head);
    const options = pool
      .filter(card => TzPick.pumpOk(card))
      .map(card => ({ c: card, v: flowOf(card), h: headOf(card) }))
      .filter(option => option.v > 0 && (!(head > 0) || option.h >= head));
    const unit = TzPick.units(options, flow, work, (option, count) => TzPick.pumpPen(option, count, { q: flow, head }));
    const count = unit ? unit.n : work || 1;
    const per = flow / count;
    const fmt = AirChain.flowText;
    return this._result(ctx, {
      unit,
      count,
      test: card => flowOf(card) >= per - this.EPS && (!(head > 0) || (headOf(card) || 0) >= head),
      need: `Нужно ${fmt(flow)} м³/ч${head ? `, напор ${fmt(head)} м` : ''}${this._tail(ctx, count)}. Показаны насосы от ${fmt(per)} м³/ч${head ? `, напор от ${fmt(head)} м` : ''}.`,
    });
  }

  /**
   * Подходит ли позиция каталога по пресету (отметка «мало» в окне подбора, когда показаны все).
   * @param {object} card позиция каталога
   * @param {object|null} preset
   * @returns {boolean}
   */
  static fits(card, preset) {
    if (!preset) return true;
    const attrs = Attrs.of(card);
    if (!this._rangesOk(attrs, preset.r) || !this._minOk(attrs, preset.min) || !this._fieldsOk(attrs, preset.f))
      return false;
    return !preset.test || preset.test(card);
  }

  static _rangesOk(attrs, ranges) {
    return Object.entries(ranges || {}).every(([key, [low]]) => {
      const limit = PickFilter.num(low);
      const value = Str.num(attrs[key]);
      return limit == null || (value != null && !(value < limit - this.EPS));
    });
  }

  static _minOk(attrs, min) {
    return Object.entries(min || {}).every(([key, limit]) => {
      const top = this.top(attrs[key]);
      return top == null || !(top < limit - this.EPS);
    });
  }

  static _fieldsOk(attrs, fields) {
    return Object.entries(fields || {}).every(([key, value]) => !value || String(attrs[key] ?? '') === value);
  }

  /**
   * Наибольшее число в значении («7,5 / 10 / 13 бар» → 13).
   * @param {*} value
   * @returns {number|null}
   */
  static top(value) {
    const found = String(value ?? '')
      .replace(/\s+/g, '')
      .replace(/[−–]/g, '-')
      .match(/-?\d+(?:[.,]\d+)?/g);
    return found ? Math.max(...found.map(text => +text.replace(',', '.'))) : null;
  }
}
