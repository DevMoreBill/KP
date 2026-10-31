import { NeedPick } from './need-pick.js';
import { StationAuto, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Toast } from '../../core/toast.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { KpState, S } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { Catalog } from '../catalog/catalog-store.js';
import { StationLayout } from '../layout/station-layout.js';
import { Attrs } from '../../core/item-attrs.js';
import { Mm } from '../layout/mm.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { PumpPoint } from '../calc/pump-point.js';
import { ReqNum } from '../req/req-num.js';
import { AirChain } from '../layout/air-chain.js';
import { DryerDerate } from '../layout/dryer-derate.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationReq } from '../req/station-req.js';
import { KpForm } from '../../core/kp-form.js';
import { StationSize } from './station-size.js';
import { Kit } from '../../core/kit.js';
import { StationPlan } from '../req/station-plan.js';
import { AirDemand } from '../calc/air-demand.js';
import { TzPick } from './tz-pick.js';
import { KitAir } from './kit-air.js';

/**
 * Чего не хватает станции: основное оборудование против требований «Подбора станции» (сколько рабочих и резервных, мало —
 * «Заменить»), топливный бак ДГУ, подготовка воздуха компрессорной (осушитель, фильтры, ресиверы). В составе — строки
 * «Нужно: …» с «Подобрать», «Подобрать всё недостающее» — одной кнопкой; «⇄» в строке — замена из каталога.
 */
export class KitNeed {
  static EPS = 1e-9;
  static FILL_PASSES = 4;
  static MAIN = {
    comp: ['compressor', 'компрессор', 'м³/мин'],
    dgu: ['dgu', 'ДГУ', 'кВт'],
    pump: ['pump', 'насос', 'м³/ч'],
  };
  static RATING = { comp: '_compRating', dgu: '_gensetRating', pump: '_pumpRating' };
  static SWAP = /^(compressor|dryer|filter|receiver|dgu|pump|tank)$/;
  static ACTIONS = { kitNeed: '_need', kitNeedAll: '_needAll', kitSwap: '_swapRow' };
  // подбор по каталогу долгий, а в одной перерисовке его спрашивают и строки «Нужно…», и «эксперт» — ответ помнится до конца шага
  static memo = null;
  /**
   * Окно каталога для подбора (KitPick.open) — подключает kit/index.js: окно стоит на KitNeed (циклы import).
   * @type {(index: number, opts: object) => void}
   */
  static pickOpen = () => {};

  /**
   * Чего не хватает (или что мало — замена).
   * @param {object} item
   * @returns {object[]}
   */
  static recs(item) {
    return [...this.main(item), ...this.fuel(item), ...this.airRecs(item)];
  }

  static _reserve(req) {
    return Math.max(0, Math.round(ReqNum.loose(req.reserve) || 0));
  }

  /**
   * Основное оборудование против требований: одна модель в составе — сколько нужно рабочих и резервных; мало давления,
   * напора или больше TzPick.MAX рабочих — «Заменить». Несколько моделей — собрано вручную.
   * @param {object} item
   * @returns {object[]}
   */
  static main(item) {
    const kind = StationReq.kind(item);
    const spec = this.MAIN[kind];
    if (!spec) return [];
    const own = Kit.parts(item).filter(part => StationEquip.kindOf(part) === spec[0]);
    if (own.length !== 1) return [];
    const part = own[0];
    const req = StationReq.of(item);
    const units = Math.max(1, Math.round(+part.qty || 1));
    const reserve = this._reserve(req);
    const work = Math.max(0, Math.round(+req.work || 0));
    const { cap, need, bad: weak } = this[this.RATING[kind]](item, part, req);
    const working = Math.max(work, need > 0 && cap > 0 ? Math.ceil(need / cap - this.EPS) : 1);
    const fmt = AirChain.flowText;
    const bad =
      weak ||
      (working > TzPick.MAX
        ? `слишком мал: нужно ${fmt(need)} ${spec[2]}, у одного ${fmt(cap)} (больше ${TzPick.MAX} рабочих)`
        : '');
    if (bad) return [this._replaceMain(part, spec, bad)];
    if (units >= working + reserve) return [];
    return [this._moreMain({ part, spec, units, need }, working, reserve)];
  }

  static _replaceMain(part, spec, bad) {
    return {
      key: 'main',
      main: true,
      swap: true,
      replace: [part.id],
      head: `Заменить: ${spec[1]} — ${bad}`,
      why: '«Подобрать» откроет каталог с подходящими по требованиям «Подбора станции»',
    };
  }

  static _moreMain({ part, spec, units, need }, working, reserve) {
    const total = working + reserve;
    const name = String(part.name || '').trim() || StationEquip.LABEL[spec[0]];
    return {
      key: 'main-qty',
      act: 'qty',
      id: part.id,
      qty: total,
      head: `Нужно: ещё ${total - units} × ${name}`,
      why: `всего ${total}: ${working} рабоч.${reserve ? ` + ${reserve} резерв.` : ''}${need > 0 ? ` на ${AirChain.flowText(need)} ${spec[2]}` : ''} — по «Подбору станции»`,
    };
  }

  static _purge(item) {
    const ads = Kit.parts(item).find(
      part => StationEquip.kindOf(part) === 'dryer' && AirChain.info(part, 'dryer').type === 'ads',
    );
    return ads ? AirChain.purge((ads.attrs || {}).regen) : 0;
  }

  static _compRating(item, part, req) {
    const cap = (AirChain.flow(part) || 0) * (1 - this._purge(item));
    const flow = ReqNum.loose(req.flow);
    const need = flow > 0 ? AirDemand.required(req, flow).v : 0;
    return { cap, need, bad: this._compWeak(item, part, req) };
  }

  static _compWeak(item, part, req) {
    const fmt = AirChain.flowText;
    const bar = ReqNum.loose(req.pressure);
    const own = AirChain.bar(part) || 0;
    const loss = StationReq.loss(Kit.parts(item));
    if (bar > 0 && own > 0 && own - loss < bar - this.EPS) {
      return `давление ${fmt(own)} бар (с потерями в подготовке воздуха и трубопроводе ≈ ${fmt(own - loss)}) меньше ${fmt(bar)} бар у потребителя`;
    }
    if (StationReq.oilFree(item) && !AirChain.oilFree(part)) {
      return `масляный, а ${StationReq.oilWhy(item)} нужен безмасляный (класс 0 по маслу)`;
    }
    return '';
  }

  static _gensetRating(item, part, req) {
    return {
      cap: GensetSizing.cap(part.attrs || {}, req.mode === 'standby'),
      need: ReqNum.loose(req.kw) || 0,
      bad: '',
    };
  }

  // подача и напор диапазоном — крайние точки паспорта: наибольшая подача, наибольший напор (PumpPoint)
  static _pumpRating(item, part, req) {
    const { flow, head } = PumpPoint.of(part.attrs);
    const need = ReqNum.loose(req.head);
    const bad =
      need > 0 && head && head.hi > 0 && head.hi < need - this.EPS
        ? `напор ${AirChain.flowText(head.hi)} м меньше нужного ${AirChain.flowText(need)} м`
        : '';
    return { cap: flow ? flow.hi : 0, need: ReqNum.loose(req.q) || 0, bad };
  }

  /**
   * ДГУ: топливный бак под время работы без дозаправки: нет бака — «Нужно», мал — «Заменить» (как в расчётной записке).
   * @param {object} item
   * @returns {object[]}
   */
  static fuel(item) {
    if (StationReq.kind(item) !== 'dgu') return [];
    const hours = ReqNum.loose(StationReq.of(item).hours);
    const tank = hours > 0 ? StationDefaults.tankFor(item, hours) : null;
    if (!tank) return [];
    const tanks = Kit.parts(item).filter(
      part => StationEquip.kindOf(part) !== 'dgu' && StationDefaults.FUEL.test(String(part.name || '')),
    );
    const current = tanks.reduce((sum, part) => sum + (AirChain.volume(part) || 0) * Math.max(1, +part.qty || 1), 0);
    if (tanks.length && current >= tank.v) return [];
    const row = tank.rows[1];
    const note = row ? `; ${row.k.charAt(0).toLowerCase()}${row.k.slice(1)} — ${row.v}` : '';
    return [
      {
        key: 'tank',
        act: 'tank',
        hours,
        by: 'asm',
        match: StationDefaults.FUEL,
        swap: !!tanks.length,
        head: tanks.length
          ? `Заменить: топливный бак ${Mm.text(current)} л — нужен ${Mm.text(tank.v)} л`
          : `Нужно: топливный бак ${Mm.text(tank.v)} л`,
        why: `работа без дозаправки ${AirChain.flowText(hours)} ч — по «Подбору станции»${note}`,
      },
    ];
  }

  /**
   * Подготовка воздуха компрессорной: рекомендации цепочки по ходу воздуха; осушитель при уже выбранном того же вида —
   * замена.
   * @param {object} item
   * @returns {object[]}
   */
  static airRecs(item) {
    const air = KitAir.of(item);
    if (!air) return [];
    return [...air.recs, ...this.dryerFit(item, air)]
      .sort((first, second) => this._rank(first) - this._rank(second))
      .map(rec => this._withReplace(item, rec));
  }

  static _rank(rec) {
    if (/^dryer/.test(rec.cat)) return 0;
    return rec.cat === 'filter' ? 1 : 2;
  }

  static _withReplace(item, rec) {
    if (!/^dryer-/.test(rec.key) || rec.replace) return rec;
    const type = rec.cat === 'dryer_ads' ? 'ads' : 'refrig';
    const old = Kit.parts(item)
      .filter(
        part =>
          Attrs.of(part).cat === rec.cat ||
          (StationEquip.kindOf(part) === 'dryer' && AirChain.info(part, 'dryer').type === type),
      )
      .map(part => part.id);
    return old.length ? { ...rec, replace: old, swap: true } : rec;
  }

  /**
   * Осушитель состава не проходит по высоте или в плане с проходом — заменить на меньший или два параллельно.
   * @param {object} item
   * @param {object} air цепочка воздуха
   * @returns {object[]}
   */
  static dryerFit(item, air) {
    const limits = { height: TzPick.hmax(item), width: TzPick.wmax(item), flow: air.work || 0 };
    const out = [];
    for (const type of ['ads', 'refrig']) {
      const rec = this._dryerFit(item, air, { ...limits, type });
      if (rec) out.push(rec);
    }
    return out;
  }

  static _card(part) {
    return { name: part.name, attrs: part.attrs || {}, rows: part.rows || [] };
  }

  static _dryerFit(item, air, { type, height, width, flow }) {
    if ((air.recs || []).some(rec => rec.key === `dryer-${type}`)) return null; // уже замена по производительности
    const fits = card => TzPick.fitsH(card, 'dryer', height) && TzPick.fitsW(card, 'dryer', width);
    const bad = Kit.parts(item).filter(part => {
      if (StationEquip.kindOf(part) !== 'dryer' || AirChain.info(part, 'dryer').type !== type) return false;
      return StationEquip.dims(this._card(part), 'dryer').known && !fits(this._card(part));
    });
    if (!bad.length) return null;
    const first = this._card(bad[0]);
    const dims = StationEquip.dims(first, 'dryer');
    const why = TzPick.fitsH(first, 'dryer', height)
      ? `в плане с проходом (${Mm.text(Math.min(dims.l, dims.w))} мм, ширина ${Mm.text(width)} мм)`
      : `по высоте (${Mm.text(dims.h)} мм, помещение ${Mm.text(height)} мм)`;
    const word = type === 'ads' ? 'Адсорбционный' : 'Рефрижераторный';
    const cat = type === 'ads' ? 'dryer_ads' : 'dryer_refrig';
    const total = flow
      ? ` (всего не менее ${AirChain.flowText(flow / DryerDerate.factor(null, air.dryer.bar, air.dryer.temps, type).F)} м³/мин)`
      : '';
    return {
      key: `dryer-${type}`,
      cat,
      title: `${word} осушитель, который помещается — или два параллельно${total}`,
      why: `«${bad[0].name}» не проходит ${why} — меньший или два одинаковых параллельно на ту же производительность`,
      name: `${word} осушитель`,
      f: {},
      r: {},
      attrs: { cat },
      rows: [],
      replace: bad.map(part => part.id),
      swap: true,
      fit: true,
    };
  }

  /**
   * Рекомендуемая позиция каталога по рекомендации.
   * @param {object} item
   * @param {object} rec
   * @returns {object|null} {c, n, role?}
   */
  static best(item, rec) {
    return NeedPick.best(item, rec);
  }

  /**
   * Фильтры окна каталога по рекомендации.
   * @param {object} item
   * @param {object} rec
   * @returns {object}
   */
  static filters(item, rec) {
    return NeedPick.filters(item, rec);
  }

  /**
   * Пресет окна подбора по рекомендации.
   * @param {object} item
   * @param {object} rec
   * @returns {object}
   */
  static preset(item, rec) {
    return NeedPick.preset(item, rec);
  }

  /**
   * «+ Осушитель», «+ Фильтр», «+ Ресивер»: рекомендация этой категории (если есть) — иначе обычный подбор.
   * @param {object} item
   * @param {string} cat
   * @returns {object|null}
   */
  static presetFor(item, cat) {
    const rec = this.recs(item).find(row => row.cat === cat && !row.swap);
    return rec ? this.preset(item, rec) : null;
  }

  /**
   * Основное оборудование по требованиям «Подбора станции».
   * @param {object} item
   * @returns {object|null}
   */
  static mainPreset(item) {
    return NeedPick.mainPreset(item);
  }

  /**
   * Заголовок строки: «Нужно: …» / «Заменить: …».
   * @param {object} rec
   * @returns {string}
   */
  static head(rec) {
    return rec.head || (rec.swap ? 'Заменить: ' : 'Нужно: ') + rec.title.charAt(0).toLowerCase() + rec.title.slice(1);
  }

  /**
   * Есть чем закрыть: действие в составе или рекомендуемый из каталога (ответ помнится до конца шага).
   * @param {object} item
   * @param {object} rec
   * @returns {boolean}
   */
  static can(item, rec) {
    if (rec.act) return true;
    const input = StationPlan.input(item);
    const key = [
      item.id,
      StationLayout.hash(input),
      input.air,
      JSON.stringify(item.req || {}),
      Catalog.cache.length,
      JSON.stringify([rec.key, rec.main, rec.cat, rec.f, rec.r, rec.qty, rec.role, rec.replace]),
    ].join('|');
    if (!this.memo) {
      this.memo = new Map();
      setTimeout(() => {
        this.memo = null;
      }, 0);
    }
    let found = this.memo.get(key);
    if (found === undefined) {
      found = rec.main ? !!(this.mainPreset(item) || {}).best : !!this.best(item, rec);
      this.memo.set(key, found);
    }
    return found;
  }

  /**
   * Строки «Нужно: …» в группе (наше оборудование / сборщик контейнера).
   * @param {object} item
   * @param {number} index позиция КП
   * @param {string} scope our | asm
   * @returns {string}
   */
  static rows(item, index, scope = 'our') {
    return this.recs(item)
      .filter(rec => (rec.by || 'our') === scope)
      .map(rec => this._row(item, index, rec))
      .join('');
  }

  static _row(item, index, rec) {
    const has = this.can(item, rec);
    const swapLabel = rec.swap ? 'Заменить' : 'Добавить';
    const label = rec.act ? swapLabel : 'Подобрать';
    return `<div class="kt-r kt-need${rec.swap ? ' swap' : ''}" role="row"><span class="kt-n" aria-hidden="true">${rec.swap ? '⚠' : '+'}</span>
        <span class="kt-nw"><b>${esc(this.head(rec))}</b><small class="muted">${esc(rec.why || '')}${has ? '' : ' · в каталоге подходящего нет — «Подобрать» откроет каталог, можно добавить своё'}</small></span>
        <span class="kt-go"><button class="btn sm${has ? ' primary' : ''}" type="button" data-a="kitNeed" data-i="${index}" data-k="${esc(rec.key)}">${label}</button></span></div>`;
  }

  /**
   * Что закрывает «Подобрать всё недостающее»: всё, кроме замены основного оборудования (её выбирает менеджер).
   * @param {object} item
   * @returns {object[]}
   */
  static fillable(item) {
    return this.recs(item).filter(rec => !rec.main);
  }

  /**
   * Кнопка «Подобрать всё недостающее» (если рекомендаций больше одной).
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static allBtn(item, index) {
    const count = this.fillable(item).length;
    if (count <= 1) return '';
    return `<button class="btn primary sm kt-all" type="button" data-a="kitNeedAll" data-i="${index}">Подобрать всё недостающее (${count})</button>`;
  }

  /**
   * Окно каталога по рекомендации; основное — по требованиям, с заменой.
   * @param {number} index
   * @param {object} rec
   */
  static open(index, rec) {
    const item = S.items[index];
    if (!item || !rec) return;
    if (rec.main) {
      const preset = { ...(this.mainPreset(item) || {}), replace: rec.replace };
      this.pickOpen(index, { cats: (Kit.station(item) || {}).main, role: 'main', preset });
      return;
    }
    this.pickOpen(index, { cats: [rec.cat], name: rec.name, preset: this.preset(item, rec) });
  }

  /**
   * Действие в составе (без каталога): число агрегатов, топливный бак.
   * @param {object} item
   * @param {object} rec
   * @returns {string} что сделано (для сообщения)
   */
  static apply(item, rec) {
    if (rec.act === 'qty') {
      const part = Kit.parts(item).find(row => row.id === rec.id);
      if (!part) return '';
      part.qty = rec.qty;
      return `${String(part.name || '').trim()} — ${rec.qty} шт.`;
    }
    if (rec.act !== 'tank') return '';
    const hasTank = Kit.parts(item).some(
      part => StationEquip.kindOf(part) !== 'dgu' && StationDefaults.FUEL.test(String(part.name || '')),
    );
    if (!hasTank) item.kit.parts.push(StationDefaults.part(item, 'Дополнительный топливный бак'));
    const volume = StationDefaults.retank(item, rec.hours);
    return volume ? `топливный бак ${Mm.text(volume)} л` : '';
  }

  /**
   * Состав изменился: закупка, компоновка, характеристики и название станции, перерисовка.
   * @param {object} item
   */
  static done(item) {
    Kit.sync(item);
    StationPlan.cache.delete(item.id);
    StationSize.refresh(item);
    StationAuto.fill(item);
    StationName.apply(item);
    item.page = true;
    KpState.persist();
    ItemEditor.render();
    KpForm.render();
  }

  /**
   * Одна кнопка: число агрегатов и бак — в составе, остальное — рекомендуемый из каталога (после осушителя могут
   * понадобиться фильтры — несколько проходов).
   * @param {number} index
   */
  static async fillAll(index) {
    const item = S.items[index];
    if (!item) return;
    item.kit = item.kit || { parts: [] };
    const report = { got: [], none: [] };
    const seen = new Set();
    for (let pass = 0; pass < this.FILL_PASSES; pass++) {
      const recs = this.fillable(item).filter(rec => !seen.has(rec.key));
      if (!recs.length) break;
      for (const rec of recs) {
        seen.add(rec.key);
        await this._fillOne(item, rec, report);
      }
    }
    this.done(item);
    const got = report.got.length ? `Добавлено: ${report.got.join('; ')}` : 'Ничего не добавлено';
    const none = report.none.length ? `. В каталоге нет: ${report.none.join('; ')} — добавьте вручную` : '';
    Toast.show(got + none);
  }

  static async _fillOne(item, rec, report) {
    if (rec.act) {
      const text = this.apply(item, rec);
      if (text) report.got.push(text);
      return;
    }
    const best = this.best(item, rec);
    if (!best) {
      report.none.push(rec.title.replace(/\s*\(.*?\)/g, ''));
      return;
    }
    if (Array.isArray(rec.replace)) item.kit.parts = item.kit.parts.filter(part => !rec.replace.includes(part.id));
    const part = await TzPick.part(best.c, best.n);
    if (rec.cat === 'filter' && AirChain.GRADES[rec.key]) part.airGrade = rec.key;
    if (best.role) part.recvRole = best.role;
    item.kit.parts.push(part);
    report.got.push((best.n > 1 ? `${best.n} × ` : '') + best.c.name);
  }

  /**
   * Действия (data-a): kitNeed — строка «Нужно: …», kitNeedAll — всё недостающее, kitSwap — «⇄» в строке состава.
   * @param {string} action
   * @param {number} index
   * @param {HTMLElement} button
   * @returns {boolean|string}
   */
  static act(action, index, button) {
    const item = S.items[index];
    const method = this.ACTIONS[action];
    if (!item || !method) return false;
    return this[method](item, index, button);
  }

  static _need(item, index, button) {
    const rec = this.recs(item).find(row => row.key === button.dataset.k);
    if (!rec) return false;
    if (rec.act) {
      const text = this.apply(item, rec);
      this.done(item);
      if (text) Toast.show(`В составе: ${text}`);
      return 'async';
    }
    this.open(index, rec);
    return 'async';
  }

  static _needAll(item, index) {
    this.fillAll(index);
    return 'async';
  }

  static _swapRow(item, index, button) {
    const part = Kit.parts(item)[+button.dataset.j];
    if (part) this.swap(index, part);
    return 'async';
  }

  /**
   * Можно заменить из каталога прямо из строки состава.
   * @param {object} part
   * @returns {boolean}
   */
  static canSwap(part) {
    return !!(
      part &&
      (part.role === 'main' || this.SWAP.test(StationEquip.kindOf(part)) || (part.attrs && part.attrs.cat))
    );
  }

  /**
   * «⇄ Заменить» в строке: окно каталога с фильтрами по требованиям станции; выбранное встаёт вместо этой строки с тем же
   * количеством.
   * @param {number} index
   * @param {object} part
   */
  static swap(index, part) {
    const item = S.items[index];
    const name = String(part.name || '').trim();
    const tag = `Замена «${name || 'элемента'}». `;
    if (part.role === 'main') {
      this.pickOpen(index, {
        cats: (Kit.station(item) || {}).main,
        role: 'main',
        preset: this._swapMain(item, part, tag),
      });
      return;
    }
    const cat = (part.attrs || {}).cat;
    const cats = cat && EquipTypes.list.some(type => type.id === cat) ? [cat] : null;
    const preset = this._swapRowPreset(item, part, cats);
    preset.need = tag + this._swapNeed(preset.need);
    this.pickOpen(index, { cats, role: part.role || null, name: cats ? '' : name, preset, by: part.by });
  }

  static _swapRowPreset(item, part, cats) {
    const found = this._swapPreset(item, part, cats) || {};
    return {
      ...found,
      replace: [part.id],
      swapRow: true,
      qty: found.qty ? found.qty : Math.max(1, +part.qty || 1),
      grade: part.airGrade || found.grade || '',
      role: part.recvRole || found.role || '',
    };
  }

  static _swapMain(item, part, tag) {
    const main = this.mainPreset(item) || {};
    return {
      ...main,
      replace: [part.id],
      swapRow: true,
      qty: main.qty || Math.max(1, +part.qty || 1),
      need: tag + (main.need || 'Показано основное оборудование станции.'),
    };
  }

  static _swapNeed(need) {
    const text = need
      ? need.replace(/^(Нужно|Заменить): /, '')
      : 'Показан каталог этого вида — выберите, что поставить вместо.';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // своя рекомендация этого вида («Нужно» / «Заменить») — её фильтры; иначе — по требованиям станции
  static _swapPreset(item, part, cats) {
    if (!cats) return null;
    const cat = cats[0];
    const rec = this.recs(item).find(row => row.cat === cat && !row.main);
    if (rec) return this.preset(item, rec);
    const kind = StationEquip.kindOf(part);
    const qty = Math.max(1, +part.qty || 1);
    return this.preset(item, {
      key: this._swapKey(kind, cat, part),
      cat,
      name: String(part.name || '').trim(),
      title: StationEquip.LABEL[kind] || 'элемент',
      f: {},
      r: this._swapRange(item, kind, part),
      qty,
      swap: true,
      role: part.recvRole || '',
    });
  }

  static _swapKey(kind, cat, part) {
    if (kind === 'dryer') return `dryer-${cat === 'dryer_ads' ? 'ads' : 'refrig'}`;
    return kind === 'filter' ? part.airGrade || '' : 'swap';
  }

  static _swapRange(item, kind, part) {
    if (kind === 'receiver') {
      const volume = AirChain.volume(part) || 0;
      return volume > 0 ? { volume: [volume] } : {};
    }
    const air = KitAir.of(item);
    const flow = air && air.work > 0 ? air.work : 0;
    return (kind === 'dryer' || kind === 'filter') && flow ? { flow: [AirChain.flowText(flow).replace(',', '.')] } : {};
  }
}
