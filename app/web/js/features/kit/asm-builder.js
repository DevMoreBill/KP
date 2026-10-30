import { AsmAi } from './asm-ai.js';
import { EquipWizard } from '../wizard/equip-wizard.js';
import { StationWays } from '../wizard/station-ways.js';
import { AsmItem } from './asm-item.js';
import { Kit } from './kit.js';
import { PickFilter, PickFind } from './kit-pick.js';
import { Catalog } from '../catalog/catalog-store.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { Currency } from '../kp/currency.js';
import { Toast } from '../../core/toast.js';
import { FEAT } from '../../core/features.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Price } from '../../core/str.js';
import { ItemSpec } from '../../core/item-spec.js';
import { KpState, S } from '../../core/state.js';
import { $, esc } from '../../core/util.js';
import { KpForm } from '../../core/kp-form.js';

/**
 * Окно «Сборное изделие» (в окне «Добавить оборудование», `#dlg`, та же ширина и шапка, что у подбора станции):
 * контейнер и оборудование из каталога, название, главное фото, цена и работы по сборке → одна позиция КП без компоновки.
 * Тем же окном правится состав изделия из карточки позиции («Состав изделия» → «Изменить состав…», там и вид изделия).
 */
export class AsmBuilder {
  static state = null;
  // окно ждёт, пока открыта карточка каталога новой части; карточку закрыли без сохранения — сборка продолжается тут
  static held = null;
  static ROWS = 40;
  static PARAMS = 3;
  static FOCUS_DELAY = 40;
  static PICKS = {
    container: { title: 'Контейнер — выбор в каталоге', q: 'контейнер', role: 'container' },
    equip: { title: 'Оборудование — выбор в каталоге', q: '', role: '' },
    power: { title: 'ДГУ для автономности — выбор в каталоге', q: '', role: '', cat: 'dgu' },
  };
  static BUTTONS = {
    asmClose: '_close',
    asmBack: '_back',
    asmGo: '_apply',
  };

  /**
   * Открыть окно: новое изделие (index — null) или правка изделия позиции КП.
   * @param {string} cat st_pump | st_comp | st_dgu
   * @param {number|null} [index] позиция КП
   */
  static open(cat, index = null) {
    if (index == null && this.held) {
      this._resume(cat);
      return;
    }
    const kind = EquipTypes.byId(cat).station ? cat : 'st_pump';
    this.state = index == null ? this._fresh(kind) : this._fromItem(kind, index);
    if (this.state.priceAuto) this.state.price = AsmItem.sums(this.state.parts).sale;
    const dialog = $('#dlg');
    dialog.className = 'wide asm';
    this.draw();
    if (!dialog.open) dialog.showModal();
  }

  static _resume(cat) {
    const state = this.held;
    this.held = null;
    this.reopen(state);
    if (EquipTypes.byId(cat).station && cat !== state.cat) this._kind(cat);
    Toast.show('Продолжаем сборку изделия');
  }

  static _fresh(cat) {
    const work = this._work(null);
    return {
      cat,
      index: null,
      parts: [],
      name: '',
      nameAuto: true,
      price: 0,
      priceAuto: true,
      photo: '',
      work,
      pick: null,
      ai: null,
      busy: '',
    };
  }

  static _fromItem(cat, index) {
    const item = S.items[index];
    const parts = JSON.parse(JSON.stringify(Kit.parts(item)));
    return {
      cat,
      index,
      parts,
      name: item.name,
      nameAuto: item.name === AsmItem.name(cat, parts),
      price: item.price || 0,
      priceAuto: item.price === item._asmSum,
      photo: this._photoPart(item, parts),
      work: this._work(item),
      pick: null,
      ai: (item.kit && item.kit.ai) || null,
      busy: '',
    };
  }

  static _photoPart(item, parts) {
    const src = item.photo && item.photo.src;
    const part = parts.find(line => line.photo && line.photo.src === src);
    return part ? part.id : '';
  }

  static _work(item) {
    const option = item && (item.options || []).find(line => line.id === AsmItem.WORK_ID);
    return option
      ? { on: true, name: option.name, price: option.price || 0, cost: option.cost || 0 }
      : { on: false, name: AsmItem.WORK_NAME, price: 0, cost: 0 };
  }

  /** Перерисовать окно по состоянию. */
  static draw() {
    const dialog = $('#dlg');
    if (!this.state || !dialog.classList.contains('asm')) return;
    dialog.innerHTML = this.state.pick ? this._pickHtml() : this._mainHtml();
  }

  // шапка как у окна подбора станции: «← Назад» — к выбору станции (новое изделие) или из выбора в каталоге
  static _head(title) {
    const { pick, index } = this.state;
    const back =
      pick || index == null ? '<button class="btn ghost" type="button" data-asm="asmBack">← Назад</button>' : '';
    return `<div class="dlg-h"><h3>${title}</h3>${back}<button class="icon" type="button" data-asm="asmClose" aria-label="Закрыть">✕</button></div>`;
  }

  static _title() {
    const { cat, index } = this.state;
    return index == null
      ? `Добавить оборудование <small class="muted">· ${esc(EquipTypes.byId(cat).item)}</small>`
      : 'Сборное изделие <small class="muted">· без компоновки</small>';
  }

  static _mainHtml() {
    const { cat, index } = this.state;
    const top =
      index == null
        ? StationWays.html(cat, 'asm')
        : `<div class="asm-kind" role="radiogroup" aria-label="Вид изделия">${this._kinds(cat)}</div>`;
    return `${this._head(this._title())}<div class="dlg-b asm-b">
      ${top}
      ${this._filesBox()}
      ${this.state.busy ? `<p class="asm-busy" role="status">${esc(this.state.busy)}</p>` : ''}
      <div class="asm-cols"><div class="asm-col">${this._containerSec()}${this._equipSec()}</div>
      <div class="asm-col">${this._itemSec()}
      <div class="row asm-go"><button class="btn primary" type="button" data-asm="asmGo">${index == null ? 'Добавить в КП' : 'Сохранить изделие'}</button></div></div></div></div>`;
  }

  static _kinds(cat) {
    return EquipTypes.list
      .filter(type => type.station)
      .map(
        type =>
          `<button type="button" class="chip${type.id === cat ? ' on' : ''}" role="radio" aria-checked="${type.id === cat}" data-asmkind="${esc(type.id)}">${esc(type.item)}</button>`,
      )
      .join('');
  }

  static _row(part, j) {
    const photo =
      part.photo && part.photo.src
        ? `<img src="${esc(part.photo.src)}" alt="" loading="lazy">`
        : '<span class="kit-noimg"></span>';
    const sub = [
      ItemSpec.mainLine({ attrs: part.attrs || {} }, this.PARAMS),
      part.price ? `${KPGen.money(part.price)} ${Currency.short(part.priceCur)}` : 'без цены',
    ]
      .filter(Boolean)
      .join(' · ');
    const qty =
      part.role === 'container'
        ? ''
        : `<label class="asm-q"><span class="muted">шт.</span><input type="text" inputmode="numeric" data-asmqty="${j}" value="${esc(part.qty)}" aria-label="Количество"></label>`;
    return `<div class="asm-row${part.need ? ' need' : ''}">${photo}<span class="asm-nm"><b>${esc(part.name)}</b><small class="muted">${esc(sub)}</small>${this._need(part, j)}</span>${qty}<button class="icon" type="button" data-asmdel="${j}" aria-label="Убрать">✕</button></div>`;
  }

  /** часть из файла, не принятая каталогом: чего не хватает и «Заполнить карточку» */
  static _need(part, j) {
    if (!part.need || !part.need.length) return '';
    return `<small class="asm-need">Не в каталоге: ${esc(part.need.join('; '))}</small><button class="chip sm" type="button" data-asmfix="${j}">Заполнить карточку</button>`;
  }

  /** «Из техничек — ИИ»: ТЗ, КП поставщика, паспорта — части изделия сами */
  static _filesBox() {
    if (!AsmAi.filesEnabled() || this.state.index != null) return '';
    return `<div class="asm-files"><label class="btn"><input type="file" data-asmfiles multiple accept=".pdf,.docx,.xlsx,.txt" hidden>📄 Из техничек — ИИ</label><span class="muted">ТЗ, КП поставщика, паспорта (PDF, Word, Excel) — части станут карточками каталога и соберутся в изделие</span></div>`;
  }

  /** «Описание и сводные — ИИ»: состояние ответа для текущего состава */
  static _aiBox() {
    if (!AsmAi.enabled()) return '';
    const { ai, parts } = this.state;
    const fresh = AsmItem.fresh(ai, parts);
    const stale = ai && !fresh ? 'состав изменился — обновите' : '';
    const done = fresh
      ? `готово: блоков описания ${fresh.blocks.length}, строк характеристик ${fresh.rows.length}`
      : '';
    const note = stale || done || 'единое описание и сводные характеристики из данных частей';
    return `<div class="asm-ai"><button class="btn" type="button" data-asmai${parts.length ? '' : ' disabled'}>✨ Описание и сводные — ИИ</button><span class="muted${stale ? ' asm-stale' : ''}">${esc(note)}</span></div>`;
  }

  static _containerSec() {
    const parts = this.state.parts;
    const j = parts.findIndex(part => part.role === 'container');
    const body =
      j >= 0
        ? `${this._row(parts[j], j)}<div class="asm-add"><button class="chip sm ghost" type="button" data-asmpick="container">Заменить из каталога</button><button class="chip sm ghost" type="button" data-asmcard="container">Новый контейнер…</button></div>`
        : '<div class="asm-add"><button class="btn" type="button" data-asmpick="container">Выбрать в каталоге</button><button class="btn ghost" type="button" data-asmcard="container" title="Нет в каталоге: с ИИ (по ссылке, файлу или тексту), таблицей или вручную — карточка сохранится в каталог">Новый — нет в каталоге…</button></div>';
    return `<section class="asm-sec"><h4>1. Контейнер</h4>${body}</section>`;
  }

  static _equipSec() {
    const { parts, cat } = this.state;
    const rows = parts
      .map((part, j) => [part, j])
      .filter(([part]) => part.role !== 'container')
      .map(([part, j]) => this._row(part, j))
      .join('');
    const label = ((EquipTypes.byId(cat).station || {}).mainLabel || 'оборудование').toLowerCase();
    const power =
      cat === 'st_dgu'
        ? ''
        : '<button class="chip sm ghost" type="button" data-asmpick="power">+ ДГУ для автономности</button>';
    const empty = rows ? '' : `<p class="muted asm-empty">Добавьте ${esc(label)} и прочее оборудование.</p>`;
    return `<section class="asm-sec"><h4>2. Оборудование</h4>${rows}${empty}<div class="asm-add"><button class="chip sm" type="button" data-asmpick="equip">+ Из каталога</button><button class="chip sm" type="button" data-asmcard="equip" title="Нет в каталоге: с ИИ (по ссылке, файлу или тексту), таблицей или вручную — карточка сохранится в каталог">+ Новое — нет в каталоге…</button>${power}</div></section>`;
  }

  static _itemSec() {
    const { name, cat, parts, work } = this.state;
    const auto = AsmItem.name(cat, parts);
    return `<section class="asm-sec"><h4>3. Изделие</h4>
      <p class="muted asm-lead">Части — от разных поставщиков: описание, характеристики, фото и цена изделия соберутся из их карточек.</p>
      <label class="f"><span>Название</span><input type="text" id="asmName" value="${esc(this.state.nameAuto ? auto : name)}" placeholder="${esc(auto)}" autocomplete="off"></label>
      ${this._aiBox()}
      ${this._photos()}
      <div id="asmSum">${this._sum()}</div>
      <label class="asm-wk"><input type="checkbox" id="asmWork"${work.on ? ' checked' : ''}> Работы по сборке и монтажу — отдельной строкой</label>
      ${work.on ? this._workFields() : ''}</section>`;
  }

  static _photos() {
    const { parts } = this.state;
    const chosen = AsmItem.photoOf(parts, this.state.photo);
    const list = parts.filter(part => part.photo && part.photo.src);
    if (!list.length) return '';
    const items = list
      .map(
        part =>
          `<button type="button" class="asm-ph${part.id === chosen ? ' on' : ''}" data-asmphoto="${esc(part.id)}" title="${esc(part.name)}" aria-pressed="${part.id === chosen}"><img src="${esc(part.photo.src)}" alt="${esc(part.name)}"></button>`,
      )
      .join('');
    return `<div class="asm-phs"><span class="muted">Главное фото:</span>${items}</div>`;
  }

  static _sum() {
    const sums = AsmItem.sums(this.state.parts);
    const cur = Currency.short(Currency.current());
    const notes = [
      sums.noPrice.length ? `без цены в каталоге: ${sums.noPrice.join(', ')}` : '',
      sums.noRate.length ? `нет курса валюты: ${sums.noRate.join(', ')} — укажите курс в «Ценах и валюте»` : '',
    ].filter(Boolean);
    const price = this.state.priceAuto ? sums.sale : this.state.price;
    return `<div class="asm-sum"><span>Сумма частей: <b>${KPGen.money(sums.sale)} ${esc(cur)}</b> · закупка ${KPGen.money(sums.cost)} руб.</span>
      <label class="f asm-price"><span>Цена изделия, ${esc(cur)}</span><input type="text" inputmode="decimal" id="asmPrice" value="${esc(Price.text(price))}" placeholder="${esc(Price.text(sums.sale))}" autocomplete="off"></label></div>${notes.length ? `<p class="muted asm-note">${esc(notes.join('; '))}</p>` : ''}`;
  }

  static _workFields() {
    const { work } = this.state;
    const cur = Currency.short(Currency.current());
    return `<div class="asm-wf"><label class="f"><span>Наименование работ</span><input type="text" id="asmWorkName" value="${esc(work.name)}" autocomplete="off"></label>
      <label class="f"><span>Цена, ${esc(cur)}</span><input type="text" inputmode="decimal" id="asmWorkPrice" value="${esc(Price.text(work.price))}" autocomplete="off"></label>
      <label class="f"><span>Закупка, руб.</span><input type="text" inputmode="decimal" id="asmWorkCost" value="${esc(Price.text(work.cost))}" autocomplete="off"></label></div>`;
  }

  static _pickHtml() {
    const { pick } = this.state;
    return `${this._head(esc(this.PICKS[pick.kind].title))}<div class="dlg-b asm-b"><div id="asmPF">${PickFilter.html(pick.filter, null)}</div><div class="kit-pl" id="asmPL">${this._pickList()}</div></div>`;
  }

  static _pickList() {
    const found = PickFilter.list(this.state.pick.filter, null, this.ROWS);
    const more = found.n > this.ROWS ? ` — показаны первые ${this.ROWS}, уточните поиск` : '';
    const rows = found.list.map(card => PickFilter.row(card, 'data-asmcid')).join('');
    return `<p class="muted pf-n">Найдено: ${found.n}${more}</p>${rows || '<p class="muted">Ничего не найдено — измените поиск или фильтры.</p>'}`;
  }

  // каталог: контейнер — поиском «контейнер» по всем категориям; оборудование — основной категорией станции
  static _startPick(kind) {
    const conf = this.PICKS[kind];
    const filter = PickFilter.create(null);
    filter.q = conf.q;
    const mainCat = ((EquipTypes.byId(this.state.cat).station || {}).main || [])[0] || '';
    filter.cat = conf.cat || (kind === 'equip' ? mainCat : '');
    this.state.pick = { kind, filter };
    this.draw();
    setTimeout(() => $('#dlg.asm [data-pf="q"]')?.focus(), this.FOCUS_DELAY);
  }

  static async _take(cardId) {
    const { pick } = this.state;
    const lite = Catalog.cache.find(card => card.id === cardId);
    if (!lite) return;
    const doc = await Catalog.fullDoc(lite);
    this.state.pick = null;
    this.add(AsmItem.part(doc, this.roleOf(pick.kind, doc)));
    Toast.show(`Добавлено: ${doc.name}`);
  }

  /**
   * Часть — в состав: контейнер заменяет прежний, оборудование добавляется; окно перерисовывается.
   * @param {object} part
   */
  static add(part) {
    const parts = this.state.parts;
    if (part.role === 'container') {
      const was = parts.findIndex(line => line.role === 'container');
      if (was >= 0) parts.splice(was, 1, part);
      else parts.unshift(part);
    } else parts.push(part);
    this._changed();
  }

  /**
   * Роль части по способу добавления: контейнер; первое оборудование основных категорий вида — основное.
   * @param {string} kind container | equip | power
   * @param {object} doc карточка
   * @returns {string}
   */
  static roleOf(kind, doc) {
    if (kind === 'container') return 'container';
    if (kind !== 'equip' || this.state.parts.some(part => part.role === 'main')) return '';
    const cats = (EquipTypes.byId(this.state.cat).station || {}).main || [];
    return cats.includes((doc.attrs || {}).cat) ? 'main' : '';
  }

  /**
   * Вернуть окно с прежним состоянием (после карточки каталога или окна «Добавить оборудование»).
   * @param {object} state
   */
  static reopen(state) {
    this.state = state;
    const dialog = $('#dlg');
    dialog.className = 'wide asm';
    this.draw();
    if (!dialog.open) dialog.showModal();
  }

  /** Состав изменился: цена «по умолчанию» — заново, окно перерисовать. */
  static changed() {
    this._changed();
  }

  static _changed() {
    if (this.state.priceAuto) this.state.price = AsmItem.sums(this.state.parts).sale;
    this.draw();
  }

  static _close() {
    const dialog = $('#dlg');
    if (dialog.open) dialog.close();
    this.state = null;
    this.held = null;
  }

  static _back() {
    if (this.state.pick) {
      this.state.pick = null;
      this.draw();
      return;
    }
    this._leave('station');
  }

  static _readPrice(text) {
    const value = Price.parse(text);
    return Number.isFinite(value) ? value : 0;
  }

  static _apply() {
    const { parts, cat, index } = this.state;
    const missing = [
      parts.some(part => part.role === 'container') ? '' : 'контейнер',
      parts.some(part => part.role !== 'container') ? '' : 'оборудование',
    ].filter(Boolean);
    if (missing.length) {
      Toast.show(`Выберите в каталоге: ${missing.join(' и ')}`);
      return;
    }
    const work = this.state.work.on ? this.state.work : null;
    const input = {
      cat,
      parts,
      name: this.state.nameAuto ? '' : this.state.name.trim(),
      price: this.state.priceAuto ? AsmItem.sums(parts).sale : this.state.price,
      photo: this.state.photo,
      work,
      ai: this.state.ai,
    };
    const item = index == null ? KpState.newItem() : S.items[index];
    AsmItem.fill(item, input);
    if (index == null) this._add(item);
    this._close();
    KpForm.render();
    KpState.persist();
    if (ItemEditor.current) ItemEditor.render();
    Toast.show(index == null ? `В КП: ${item.name}` : 'Изделие обновлено');
  }

  static _add(item) {
    const blank = S.items.length === 1 && !S.items[0].name && !S.items[0].price;
    if (blank) S.items = [item];
    else S.items.push(item);
  }

  static _click(event) {
    const target = event.target;
    const start = target.closest('[data-asmnew],[data-asmedit]');
    if (start) {
      if (start.dataset.asmnew) this.open(start.dataset.asmnew);
      else this.open(this._catOf(+start.dataset.asmedit), +start.dataset.asmedit);
      return;
    }
    if (!target.closest('#dlg.asm') || !this.state) return;
    this._inside(target);
  }

  static _catOf(index) {
    return ((S.items[index] || {}).attrs || {}).cat || '';
  }

  static _inside(target) {
    const routes = [
      ['[data-asm]', button => this[this.BUTTONS[button.dataset.asm]]()],
      ['[data-asmkind]', button => this._kind(button.dataset.asmkind)],
      ['[data-asmway]', button => this._layout(button.dataset.asmway)],
      ['[data-asmpick]', button => this._startPick(button.dataset.asmpick)],
      ['[data-asmcid]', button => this._take(button.dataset.asmcid)],
      ['[data-asmdel]', button => this._remove(+button.dataset.asmdel)],
      ['[data-asmphoto]', button => this._photo(button.dataset.asmphoto)],
    ];
    for (const [selector, action] of routes) {
      const button = target.closest(selector);
      if (button) {
        action(button);
        return;
      }
    }
  }

  /** «Подобрать и скомпоновать»: окно подбора станции того же вида */
  static _layout(cat) {
    this._leave(cat);
  }

  // в окно «Добавить оборудование» (pre — его шаг); начатая сборка ждёт и вернётся по «Собрать из готовых позиций»
  static _leave(pre) {
    this.held = this.state.parts.length ? this.state : null;
    this.state = null;
    EquipWizard.open('kp', pre);
  }

  /** другой вид изделия — основное оборудование заново по основным категориям этого вида */
  static _kind(cat) {
    this.state.cat = cat;
    const parts = this.state.parts;
    parts.forEach(part => {
      if (part.role === 'main') delete part.role;
    });
    const main = AsmItem.main(cat, parts);
    if (main) main.role = 'main';
    this.draw();
  }

  static _remove(j) {
    this.state.parts.splice(j, 1);
    this._changed();
  }

  static _photo(id) {
    this.state.photo = id;
    this.draw();
  }

  static _input(event) {
    const target = event.target;
    if (!target.closest || !target.closest('#dlg.asm') || !this.state) return;
    if (target.dataset.pf) {
      this._filter(target);
      return;
    }
    if (target.dataset.asmqty) {
      const qty = Math.max(1, Math.round(+target.value) || 1);
      this.state.parts[+target.dataset.asmqty].qty = qty;
      this._refreshSum();
      return;
    }
    this._field(target);
  }

  static _filter(target) {
    const { filter } = this.state.pick;
    const redraw = PickFilter.set(filter, target);
    const list = () => {
      if (!this.state || !this.state.pick) return;
      if (redraw) $('#asmPF').innerHTML = PickFilter.html(filter, null);
      $('#asmPL').innerHTML = this._pickList();
    };
    if (target.dataset.pf === 'q') PickFind.later(list);
    else list();
  }

  static _field(target) {
    const { state } = this;
    const fields = {
      asmName: () => {
        state.name = target.value;
        state.nameAuto = !target.value.trim();
      },
      asmPrice: () => {
        state.priceAuto = !target.value.trim();
        state.price = this._readPrice(target.value);
      },
      asmWorkName: () => (state.work.name = target.value),
      asmWorkPrice: () => (state.work.price = this._readPrice(target.value)),
      asmWorkCost: () => (state.work.cost = this._readPrice(target.value)),
    };
    if (fields[target.id]) fields[target.id]();
  }

  static _change(event) {
    const target = event.target;
    if (!target.closest || !target.closest('#dlg.asm') || !this.state) return;
    if (target.id !== 'asmWork') return;
    this.state.work.on = target.checked;
    this.draw();
  }

  static _refreshSum() {
    if (this.state.priceAuto) this.state.price = AsmItem.sums(this.state.parts).sale;
    const box = $('#asmSum');
    if (box) box.innerHTML = this._sum();
  }

  /** Обработчики окна и входов (окно «Добавить оборудование» → станция; карточка позиции → «Состав изделия»). */
  static listen() {
    document.addEventListener('click', event => {
      if (FEAT.on('asmItem')) this._click(event);
    });
    document.addEventListener('input', event => this._input(event));
    document.addEventListener('change', event => this._change(event));
    document.addEventListener(
      'close',
      event => {
        const dialog = event.target;
        if (dialog.id === 'dlg' && !dialog.open && dialog.classList.contains('asm')) {
          dialog.className = '';
          this.state = null;
        }
      },
      true,
    );
  }
}
