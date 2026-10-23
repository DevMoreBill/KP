import { FormView } from './form-view.js';
import { UiKit } from './ui-kit.js';
import { Toast } from '../core/toast.js';
import { CatalogFill } from '../features/catalog/catalog-fill.js';
import { CatFind, Catalog } from '../features/catalog/catalog-store.js';
import { DefRegistry } from '../core/defaults.js';
import { Price, Str } from '../core/str.js';
import { Currency } from '../features/kp/currency.js';
import { StationUi } from '../features/station/station-ui.js';
import { ItemSpec } from '../core/item-spec.js';
import { Attrs } from '../core/item-attrs.js';
import { Kit } from '../features/kit/kit.js';
import { FEAT } from '../core/features.js';
import { CatSections } from '../features/catalog/cat-sections.js';
import { $, esc } from '../core/util.js';
import { EquipTypes } from '../core/equip-types.js';
import { KpState, S } from '../core/state.js';

/** Раздел 2 «Оборудование»: плитки видов оборудования (пустое КП) или карточки позиций; строка быстрого поиска. */
export class EquipStep {
  static NAME_WRAP = 60;
  static MAIN_PARAMS = 4;

  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    return S.items.length ? this._items() : this._empty();
  }

  static _quick() {
    return `<div class="qadd"><input type="text" id="quickAdd" placeholder="Быстрый поиск по каталогу: модель, производитель, мощность…  (Enter — добавить первую)" autocomplete="off" aria-label="Быстрый поиск по каталогу"><div id="qaList" class="qa-list" hidden></div></div>`;
  }

  static _empty() {
    const stations = EquipTypes.list
      .filter(type => type.station)
      .map(
        type =>
          `<button type="button" class="tile st" data-a="addStation" data-cat="${esc(type.id)}">${CatSections.svg('box')}<b>${esc(type.item)}</b><span>собрать →</span></button>`,
      )
      .join('');
    return `<section class="step" id="st-items"><h2><span class="n">2</span>Оборудование${UiKit.tip('Найдите модель в строке поиска или выберите вид оборудования — фото, характеристики и титул подставятся из каталога. Станцию в контейнере (насосную, компрессорную, ДГУ) собирают из контейнера, основного оборудования и систем. Чего нет в каталоге — «+ Новое оборудование»: по ссылке на сайт, с помощью любого ИИ, таблицей или вручную.')}</h2>
    ${this._quick()}
    <p class="sub tiles-h">Станции в контейнере</p><div class="tiles sts">${stations}</div>
    <p class="sub tiles-h">Оборудование из каталога</p>
    <div class="tiles secs">${CatSections.tiles()}<button type="button" class="tile add" data-a="addItem"><b>+ Новое оборудование</b><span>нет в каталоге — заполнить по ссылке, с ИИ или вручную</span></button></div></section>`;
  }

  static _items() {
    const count = S.items.length;
    const units = S.items.reduce((sum, item) => sum + (+item.qty || 0), 0);
    return `<section class="step" id="st-items"><h2><span class="n">2</span>Оборудование${UiKit.tip('<p>«Изменить» — описание, фото, характеристики и опции позиции.</p><p>«Страница оборудования» — отдельный лист в КП с фото и характеристиками.</p><p>Цены, закупка и скидка — в разделе «Цены и валюта».</p>')}</h2>
  <div class="eq-bar"><button class="btn primary" type="button" data-a="openCatalog">+ Из каталога</button><button class="btn" type="button" data-a="addItem" title="Нет в каталоге: по ссылке на сайт, с помощью ИИ, таблицей или вручную">+ Новое оборудование</button>${FEAT.on('stations') ? '<button class="btn" type="button" data-a="addStation">+ Станция в контейнере</button>' : ''}
    <span class="muted">${count} ${KPGen.plural(count, 'позиция', 'позиции', 'позиций')} · ${units} ед.</span></div>
  ${this._quick()}
  ${S.items.map((item, i) => this.card(item, i)).join('')}</section>`;
  }

  static CHECK = { ok: ['ok', '✓'], need: ['warn', '!'], none: ['', '+'] };

  static _checkKind(ok, need) {
    if (ok) return 'ok';
    return need ? 'need' : 'none';
  }

  static _check(i, { tab, label, ok, need }) {
    const [state, mark] = this.CHECK[this._checkKind(ok, need)];
    return `<button type="button" class="rd ${state}" data-a="${tab === 'price' ? 'toPrice' : 'edit'}" data-i="${i}" data-tab="${tab}" title="${ok ? 'Заполнено' : 'Не заполнено — нажмите, чтобы добавить'}">${mark} ${label}</button>`;
  }

  // показываем только то, чего не хватает: заполненное не отвлекает
  static _missing(item, i) {
    const features = (item.features || []).filter(feature => feature.label || feature.text).length;
    const rows = (item.groups || []).reduce(
      (sum, group) => sum + (group.rows || []).filter(row => row.k || row.v).length,
      0,
    );
    return [
      { tab: 'desc', label: 'Фото', ok: !!item.photo, need: item.page },
      { tab: 'desc', label: 'Описание', ok: features > 0, need: item.page },
      { tab: 'spec', label: 'Характеристики', ok: rows > 0, need: item.page },
      { tab: 'price', label: 'Цена', ok: item.price > 0, need: true },
    ]
      .map(check => this._check(i, check))
      .filter(html => !html.includes('class="rd ok"'));
  }

  static _options(item, i) {
    return (item.options || [])
      .filter(opt => opt.name)
      .map(opt => {
        const j = (item.options || []).indexOf(opt);
        return `<span class="oitem">${esc(opt.short || opt.name)}${+opt.qty > 1 ? ` × ${esc(opt.qty)}` : ''}${opt.price ? ` · ${KPGen.money(opt.price * (+opt.qty || 1))}` : ' · включено'}<button type="button" data-a="delOpt" data-i="${i}" data-j="${j}" aria-label="Убрать опцию">✕</button></span>`;
      })
      .join('');
  }

  static _kit(item, i) {
    if (!Kit.can(item)) return '';
    const parts = Kit.parts(item).length;
    const text = Kit.has(item)
      ? `Состав станции: ${parts} ${KPGen.plural(parts, 'элемент', 'элемента', 'элементов')}`
      : '+ Состав станции';
    return `<button type="button" class="chip sm${Kit.has(item) ? ' on' : ''}" data-a="edit" data-i="${i}" data-tab="kit" title="Контейнер, основное оборудование, обвязка и системы: у каждого элемента — своё описание, закупка и поставщик">${text}</button>`;
  }

  static _thumb(item) {
    return item.photo ? `<img src="${esc(item.photo.src)}" alt="">` : '<span>+ фото</span>';
  }

  static _handle(i) {
    if (S.items.length < 2) return '';
    return `<span class="idrag" draggable="true" data-drag="${i}" title="Перетащите, чтобы переставить" aria-hidden="true">⋮⋮</span>`;
  }

  /**
   * Карточка позиции.
   * @param {object} item
   * @param {number} i
   * @returns {string}
   */
  static card(item, i) {
    const path = `items.${i}`;
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const missing = this._missing(item, i);
    return `<div class="item" id="item-${item.id}" data-pos="${i}">
   <div class="icard">
     <button type="button" class="ithumb" data-a="edit" data-i="${i}" data-tab="desc" data-thumb="${i}" title="Нажмите — фото и описание. Главное фото можно перетащить сюда или вставить (Ctrl+V), наведя курсор">${this._thumb(item)}</button>
     <div class="imain">
       <div class="itop">${this._handle(i)}<span class="item-no">${i + 1}</span><span class="ttype">${esc(type.item || type.name)}</span></div>
       <textarea class="iname" rows="${item.name.length > this.NAME_WRAP ? 2 : 1}" data-p="${path}.name" placeholder="Наименование позиции" aria-label="Наименование">${esc(item.name)}</textarea>
       <div class="ikp">${esc(ItemSpec.mainLine(item, this.MAIN_PARAMS) || item.spec || 'Параметры не заполнены')}</div>
       ${missing.length ? `<div class="ready">${missing.join('')}</div>` : ''}
       <div class="iopts">${this._options(item, i)}
         <button type="button" class="chip sm" data-a="edit" data-i="${i}" data-tab="opts">+ Опции и услуги</button>
         ${StationUi.chip(item, i)}${this._kit(item, i)}</div>
     </div>
     <div class="iside">
       <label class="f"><span>Количество, шт.</span><div class="qty"><button type="button" data-a="qty" data-i="${i}" data-d="-1" aria-label="Меньше">−</button><input type="text" inputmode="numeric" data-p="${path}.qty" value="${esc(item.qty)}" class="${+item.qty >= 1 && Number.isInteger(+item.qty) ? '' : 'bad'}"><button type="button" data-a="qty" data-i="${i}" data-d="1" aria-label="Больше">+</button></div></label>
       <div class="f"><span>Цена за ед., ${Currency.short(Currency.current())}</span><button type="button" class="pricebox${item.price ? '' : ' empty'}" data-a="toPrice">${item.price ? Price.text(item.price) : 'задать цену'}</button></div>
       <div class="isum">Сумма: <b data-sum="${i}">${KPGen.money(KpState.itemSum(item))}</b></div>
     </div>
   </div>
   <div class="ifoot">
     <button class="btn primary" type="button" data-a="edit" data-i="${i}" data-tab="main">Изменить</button>
     <button class="btn ghost" type="button" data-a="dupItem" data-i="${i}" title="Добавить копию позиции — например, для варианта с другой опцией">Дублировать</button>
     <button class="sw" type="button" role="switch" aria-checked="${!!item.page}" data-a="togglePage" data-i="${i}" title="Отдельная страница с фото, описанием и характеристиками"><i></i>Страница оборудования</button>
     <span style="flex:1"></span>
     <button class="icon" type="button" data-a="up" data-i="${i}" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>↑</button>
     <button class="icon" type="button" data-a="down" data-i="${i}" aria-label="Ниже" ${i === S.items.length - 1 ? 'disabled' : ''}>↓</button>
     <button class="icon" type="button" data-a="delItem" data-i="${i}" aria-label="Удалить позицию">✕</button>
   </div>
  </div>`;
  }
}

/**
 * Быстрый поиск по каталогу («Быстро добавить»). Строка поиска карточки — одна на карточку и её разбор (карточки
 * каталога на месте не меняются, разбор сбрасывается при смене категорий): без запоминания каждое нажатие клавиши
 * нормализовало текст 7000+ карточек.
 */
export class QuickFind {
  static HAY = new WeakMap();
  static timer = 0;
  static TYPE_DELAY = 100;
  static FOCUS_DELAY = 80;
  static SCROLL_DELAY = 60;
  static SHOWN = 8;
  static SCAN_MIN = 40;
  static SCAN_TIMES = 5;
  static NO_VALUE = 9e9;
  static LIST_PARAMS = 3;

  /**
   * Подсказки под полем.
   * @param {HTMLInputElement} input
   */
  static show(input) {
    if (!input.isConnected) return;
    const list = $('#qaList');
    if (!list) return;
    const found = this.matches(input.value);
    list.hidden = !input.value.trim();
    list.innerHTML = found.length
      ? found.map((card, k) => this._row(card, k)).join('')
      : `<p class="muted" style="margin:10px 14px">Ничего не найдено. <button class="btn ghost" type="button" data-a="openCatalog">Открыть каталог с фильтрами</button></p>`;
  }

  static _row(card, k) {
    return `<button type="button" data-qa="${esc(card.id)}" class="${k === 0 ? 'first' : ''}">${card.photo ? `<img src="${esc(card.photo.src)}" alt="">` : '<i></i>'}<span><b>${esc(card.name)}</b><small>${esc(ItemSpec.mainLine(card, this.LIST_PARAMS) || card.spec || '')}${card.price ? ` · ${KPGen.money(card.price)} ${Currency.short(card.priceCur || 'RUB')}` : ''}</small></span><em>Добавить</em></button>`;
  }

  static _hay(card, attrs) {
    const cached = this.HAY.get(card);
    if (cached && cached.attrs === attrs) return cached.hay;
    const hay = Str.norm(
      [
        card.name,
        card.spec,
        attrs.maker,
        attrs.model,
        attrs.series,
        attrs.engine,
        attrs.alternator,
        card.art,
        card.feed && card.feed.sku,
        attrs.article,
      ].join(' '),
    );
    this.HAY.set(card, { attrs, hay });
    return hay;
  }

  static _main(card) {
    const attrs = Attrs.of(card);
    return Str.num(attrs[EquipTypes.byId(attrs.cat).main || 'kw']) ?? this.NO_VALUE;
  }

  /**
   * Карточки каталога по словам запроса (без принадлежностей), по категории и главному параметру.
   * @param {string} query
   * @returns {object[]}
   */
  static matches(query) {
    const words = Str.norm(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    const shown = DefRegistry.num('cat.quickN', this.SHOWN);
    const scan = Math.max(this.SCAN_MIN, this.SCAN_TIMES * shown);
    const found = [];
    for (const card of Catalog.cache) {
      const attrs = Attrs.of(card);
      if (EquipTypes.byId(attrs.cat).role === 'accessory') continue;
      const hay = this._hay(card, attrs);
      if (words.every(word => hay.includes(word))) found.push(card);
      if (found.length >= scan) break;
    }
    return found
      .sort(
        (left, right) =>
          String(Attrs.of(left).cat).localeCompare(Attrs.of(right).cat) || this._main(left) - this._main(right),
      )
      .slice(0, Math.round(shown));
  }

  /**
   * Добавить карточку каталога позицией КП (пустая единственная позиция заменяется).
   * @param {object} card
   */
  static async add(card) {
    const opened = S;
    const full = await Catalog.fullDoc(card);
    if (S !== opened) return;
    const item = KpState.newItem();
    CatalogFill.fill(item, full);
    const blank = S.items.length === 1 && !S.items[0].name.trim() && !S.items[0].price;
    if (blank) S.items = [item];
    else S.items.push(item);
    FormView.render();
    KpState.persist();
    Toast.show(`Добавлено: ${full.name}`);
    setTimeout(
      () => document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      this.SCROLL_DELAY,
    );
  }

  static _key(event) {
    if (event.target.id !== 'quickAdd') return;
    if (event.key === 'Enter') {
      const card = this.matches(event.target.value)[0];
      if (card) {
        event.preventDefault();
        event.target.value = '';
        this.add(card);
        setTimeout(() => $('#quickAdd')?.focus(), this.FOCUS_DELAY);
      }
    }
    if (event.key === 'Escape') {
      event.target.value = '';
      $('#qaList').hidden = true;
    }
  }

  static _click(event) {
    const button = event.target.closest('[data-qa]');
    if (button) {
      const card = CatFind.id(button.dataset.qa);
      if (card) this.add(card);
      return;
    }
    if (!event.target.closest('.qadd')) {
      const list = $('#qaList');
      if (list) list.hidden = true;
    }
  }

  /** Обработчики строки быстрого поиска: подсказки — через 100 мс после последней клавиши. */
  static listen() {
    document.addEventListener('input', event => {
      if (event.target.id !== 'quickAdd') return;
      clearTimeout(this.timer);
      const input = event.target;
      this.timer = setTimeout(() => this.show(input), this.TYPE_DELAY);
    });
    document.addEventListener('keydown', event => this._key(event));
    document.addEventListener('click', event => this._click(event));
  }
}
