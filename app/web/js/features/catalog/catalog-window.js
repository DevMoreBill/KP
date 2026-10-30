import { CatalogCompare } from './catalog-compare.js';
import { CatalogActions } from './catalog-actions.js';
import { AppTabs } from '../../core/app-tabs.js';
import { CatalogCard } from './catalog-card.js';
import { CatalogEvents } from './catalog-events.js';
import { CatalogFilter } from './catalog-filter.js';
import { CatalogIndex } from './catalog-index.js';
import { CatalogNav } from './catalog-nav.js';
import { CatalogPanes } from './catalog-panes.js';
import { CatalogSorter } from './catalog-sorter.js';
import { NewTypeDialog } from './new-type.js';
import { Catalog, CatalogStore } from './catalog-store.js';
import { Suppliers } from './suppliers.js';
import { Morph } from '../../core/morph.js';
import { S } from '../../core/state.js';
import { FormView } from '../../ui/form-view.js';
import { Auth } from '../kp/auth.js';
import { Api } from '../../core/net.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Modal } from '../../core/modal.js';
import { $, esc } from '../../core/util.js';
import { Toast } from '../../core/toast.js';
import { DefRegistry } from '../../core/defaults.js';

/**
 * Окно каталога: отбор сверху, фильтры и категории слева, список с отметками, карточка-предпросмотр справа.
 * Пакетные действия над отмеченными позициями: добавить в КП, перенести в другую категорию (и перетаскиванием на категорию).
 */
export class CatalogWindow {
  static WARM_IDLE = 30;
  static WARM_SLICE = 8;
  static WARM_LEFT = 2;
  static MORE_MARGIN = '0px 0px 600px 0px';
  static FOCUS_DELAY = 30;
  static _win = null;

  /**
   * Окно каталога — создаётся при первом обращении: при загрузке модуля фильтр каталога может быть ещё не готов.
   * @returns {CatalogWindow}
   */
  static get win() {
    return (this._win ??= new CatalogWindow());
  }

  /**
   * Подменить окно (проверки).
   * @param {CatalogWindow} value
   */
  static set win(value) {
    this._win = value;
  }

  /**
   * Строк списка за раз: остальные — при прокрутке («Значения программы» — cat.page).
   * @returns {number}
   */
  static get PAGE() {
    return Math.round(DefRegistry.num('cat.page', 60));
  }

  /**
   * Открыть окно каталога.
   * @param {object} [mode] {opt, admin, cat, q, grp}
   * @returns {Promise<void>}
   */
  static open(mode = {}) {
    return this.win.open(mode);
  }

  /** После окон поверх каталога (категории, импорт из Excel) — обновить категории и список. */
  static listen() {
    document.addEventListener(
      'close',
      event => {
        const win = this.win;
        if (event.target.id === 'dlg' && $('#catdlg')?.open && !win.busy) win.redraw();
      },
      true,
    );
  }

  constructor() {
    Object.assign(this, {
      pend: new Set(),
      mod: false,
      admin: false,
      optFor: null,
      F: CatalogFilter.items,
      sel: new Set(),
      active: null,
      limit: CatalogWindow.PAGE,
      docs: [],
      view: [],
      lastCk: null,
      undo: null,
      note: '',
      busy: '',
      drag: null,
      tab: '', // вкладка слева: flt / cats
    });
    this.sorter = new CatalogSorter(this);
    this.panes = null;
  }

  /**
   * Окно (создаётся один раз).
   * @returns {HTMLDialogElement}
   */
  dlg() {
    const dialog = Modal.host('catdlg', 'catwin', 'Каталог');
    if (!this.panes || this.panes.d !== dialog) this.panes = new CatalogPanes(dialog);
    return dialog;
  }

  /**
   * Поставщик позиции.
   * @param {object} card
   * @returns {string}
   */
  supplierOf(card) {
    return Suppliers.of(card);
  }

  /**
   * Позиция подходит режиму окна (опции — только аксессуары и опции).
   * @param {object} card
   * @returns {boolean}
   */
  kindOk(card) {
    if (this.optFor == null) return true;
    const type = EquipTypes.byId(CatalogIndex.attrs(card).cat);
    return type.role === 'accessory' || card.kind === 'option';
  }

  /**
   * Позиция подходит под условия отбора, кроме skip.
   * @param {object} card
   * @param {string} [skip]
   * @returns {boolean}
   */
  pass(card, skip) {
    return this.F.pass(card, skip, this);
  }

  /**
   * Карточка по id — словарь строится один раз на список.
   * @param {string} id
   * @returns {object|undefined}
   */
  doc(id) {
    const docs = this.docs;
    if (this._byOf !== docs || this._byN !== docs.length) {
      this._byOf = docs;
      this._byN = docs.length;
      this._by = new Map();
      for (const card of docs) if (!this._by.has(card.id)) this._by.set(card.id, card);
    }
    return this._by.get(id);
  }

  /** Поисковые строки всех позиций — заранее, в простое браузера, пачками. */
  warm() {
    const docs = this.docs;
    let index = 0;
    const idle =
      window.requestIdleCallback ||
      (run => setTimeout(() => run({ timeRemaining: () => CatalogWindow.WARM_SLICE }), CatalogWindow.WARM_IDLE));
    const step = deadline => {
      if (docs !== this.docs) return;
      while (index < docs.length && deadline.timeRemaining() > CatalogWindow.WARM_LEFT) CatalogIndex.hay(docs[index++]);
      if (index < docs.length) idle(step);
    };
    idle(step);
  }

  /** Режим модерации и товары, правки которых ждут решения администратора. */
  async loadPending() {
    try {
      const answer = await Api.request('/api/catalog/pending');
      this.mod = !!answer.moderation;
      this.pend = new Set(answer.ids || []);
    } catch {
      // без связи — как было
    }
    const button = $('#catdlg .cw-modq');
    if (!button) return;
    button.hidden = !(this.pend.size && Auth.can('catSelfMod') && this.optFor == null);
    button.textContent = `На модерации · ${this.pend.size}`;
  }

  /** Поставщики позиций: фиды-источники и справочник поставщиков. */
  async loadSources() {
    await Suppliers.load(this.docs);
  }

  /** После запуска, в простое: поставщики и поисковые строки — первый поиск в каталоге без задержки. */
  async prewarm() {
    this.sorter.loadFx();
    await this.loadSources();
    if (!$('#catdlg')?.open) {
      this.docs = Catalog.cache;
      this.warm();
    }
  }

  /** Каталог заново с сервера. */
  async reload() {
    await Catalog.refresh();
    await this.loadPending();
    this.docs = Catalog.cache;
    FormView.render();
  }

  /** Левая панель. */
  nav() {
    CatalogNav.nav(this);
  }

  /**
   * Позиция уже в КП (или в опциях позиции).
   * @param {string} id
   * @returns {boolean}
   */
  inKp(id) {
    if (this.optFor != null) return (S.items[this.optFor]?.options || []).some(option => option.catId === id);
    return S.items.some(item => item.catId === id);
  }

  /**
   * Кнопка «В КП» в строке списка.
   * @param {string} id
   * @returns {string}
   */
  addLabel(id) {
    const inKp = this.inKp(id);
    if (this.optFor != null) return inKp ? '✓ Добавлено' : 'Опцией';
    return inKp ? '✓ +1 шт.' : 'В КП';
  }

  /**
   * Кнопка «Добавить в КП» в карточке.
   * @param {string} id
   * @returns {string}
   */
  addLabelLong(id) {
    const inKp = this.inKp(id);
    if (this.optFor != null) return inKp ? '✓ Добавлено' : 'Добавить опцией';
    return inKp ? 'Уже в КП: ещё 1 шт.' : 'Добавить в КП';
  }

  _checkAll(list) {
    const all = $('#cwAll');
    const marked = list.filter(card => this.sel.has(card.id)).length;
    all.checked = !!list.length && marked === list.length;
    all.indeterminate = marked > 0 && marked < list.length;
  }

  _rows(list) {
    if (!list.length) {
      return `<p class="empty">${this.docs.length ? 'Ничего не найдено — ослабьте фильтры или выберите «Все позиции».' : 'Каталог пуст. Добавьте позицию, загрузите файл каталога или импортируйте таблицу из Excel (меню «Ещё»).'}</p>`;
    }
    const more =
      list.length > this.limit
        ? `<div class="cw-more"><button class="btn" type="button" data-more>Показать ещё (${list.length - this.limit})</button></div>`
        : '';
    return (
      list
        .slice(0, this.limit)
        .map(card => CatalogCard.row(this, card))
        .join('') + more
    );
  }

  /** Отбор, сортировка и список. */
  list() {
    const filter = this.F;
    const list = this.docs.filter(card => this.pass(card));
    if (filter.sort === 'price') this.sorter.loadFx();
    list.sort(this.sorter.compare());
    this.sorter.renderBox();
    this.view = list;
    $('#cwCnt').innerHTML = this.docs.length ? `Найдено: <b>${list.length}</b> из ${this.docs.length}` : '';
    Morph.apply($('#cwChips'), CatalogNav.chips(this));
    CatalogNav.bar(this);
    this._checkAll(list);
    const navOk = $('#cwNavOk');
    if (navOk) navOk.textContent = list.length ? `Показать: ${list.length}` : 'Ничего не найдено';
    Morph.apply($('#cwList'), this._rows(list));
    this.autoMore();
  }

  /** Следующая порция строк: дописывается к уже готовому списку (без нового отбора, сортировки и счётчиков). */
  more() {
    const box = $('#cwList');
    const tail = box?.querySelector('.cw-more');
    const list = this.view || [];
    const from = this.limit;
    this.limit += CatalogWindow.PAGE * 2;
    if (!tail || !list.length) {
      this.list();
      return;
    }
    tail.insertAdjacentHTML(
      'beforebegin',
      list
        .slice(from, this.limit)
        .map(card => CatalogCard.row(this, card))
        .join(''),
    );
    if (list.length <= this.limit) {
      tail.remove();
      return;
    }
    const button = tail.querySelector('[data-more]');
    if (button) button.textContent = `Показать ещё (${list.length - this.limit})`;
    this.autoMore();
  }

  /** Строки дорисовываются сами, когда прокрутка подходит к концу списка. */
  autoMore() {
    this.io?.disconnect();
    const box = $('#cwList');
    const tail = box?.querySelector('.cw-more');
    if (!tail || !window.IntersectionObserver) return;
    this.io = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        this.io.disconnect();
        this.more();
      },
      { root: box, rootMargin: CatalogWindow.MORE_MARGIN },
    );
    this.io.observe(tail);
  }

  /** Обновить фильтры и список (после смены условий). */
  refresh() {
    this.nav();
    this.list();
  }

  _bulk(count) {
    const main = this.optFor == null;
    return `<b>Отмечено: ${count}</b>
        <button class="btn primary" type="button" data-bulk="add">${main ? 'Добавить в КП' : 'Добавить опциями'}</button>
        ${main && count >= CatalogCompare.MIN && count <= CatalogCompare.MAX ? '<button class="btn" type="button" data-bulk="compare">Сравнить</button>' : ''}
        ${main ? '<button class="btn" type="button" data-bulk="move">Перенести в категорию…</button>' : ''}
        ${main && Auth.can('export') ? '<button class="btn" type="button" data-bulk="export">Выгрузить…</button>' : ''}
        ${main && Auth.can('catDelete') ? '<button class="btn danger" type="button" data-bulk="trash">В корзину</button>' : ''}
<span class="sp"></span>
        <button class="btn ghost" type="button" data-bulk="clear">Снять отметки</button>`;
  }

  _done() {
    if (this.admin) return '<button class="btn primary" type="button" data-cw="close">Закрыть</button>';
    const main = this.optFor == null;
    const count = main
      ? S.items.filter(item => item.name).length
      : (S.items[this.optFor]?.options || []).filter(option => option.name).length;
    return `<span class="muted">${main ? 'Позиций в КП' : 'Опций у позиции'}: <b>${count}</b></span><button class="btn primary" type="button" data-cw="done">${main ? 'Готово — к КП' : 'Готово'}</button>`;
  }

  _hint() {
    if (this.note) return this.note;
    const drag = matchMedia('(pointer:coarse)').matches ? '' : ' Позиции можно перетащить мышью на категорию слева.';
    return `Отметьте галочками несколько позиций — появятся пакетные действия.${drag}`;
  }

  /** Подвал: подсказка, пакетные действия, «Готово». */
  foot() {
    const box = $('#cwF');
    if (!box) return;
    const count = this.sel.size;
    if (this.busy) {
      box.className = 'cw-f busy';
      box.innerHTML = `<span class="spin"></span><b>${esc(this.busy)}</b>`;
      return;
    }
    if (count) {
      box.className = 'cw-f bulk';
      box.innerHTML = this._bulk(count);
      return;
    }
    box.className = 'cw-f';
    box.innerHTML = `<span class="muted cw-note">${esc(this._hint())}</span>
      ${this.undo ? '<button class="btn ghost" type="button" data-cw="undo">Отменить перенос</button>' : ''}<span class="sp"></span>
      ${this._done()}`;
  }

  /**
   * Сообщение в подвале.
   * @param {string} text
   */
  say(text) {
    this.note = text || '';
    this.foot();
  }

  /**
   * Идёт долгое действие (текст в подвале).
   * @param {string} text
   */
  setBusy(text) {
    this.busy = text || '';
    this.foot();
  }

  /** Перерисовать всё окно. */
  redraw() {
    if (!$('#cwList')) return;
    this.nav();
    this.list();
    this.foot();
    this.preview();
  }

  /** Карточка-предпросмотр: сразу облегчённая, затем — полная. */
  async preview() {
    const box = $('#cwPv');
    const dialog = this.dlg();
    if (!box) return;
    const id = this.active;
    dialog.classList.toggle('pvon', !!id);
    const light = id && this.doc(id);
    if (!light) {
      this.active = null;
      dialog.classList.remove('pvon', 'pvwide');
      box.innerHTML = CatalogCard.EMPTY;
      return;
    }
    if (box.dataset.id !== id) {
      box.innerHTML = CatalogCard.html(this, light, { loading: !!light._light });
      box.dataset.id = id;
    }
    const full = await Catalog.fullDoc(light);
    if (this.active !== id) return;
    const top = box.querySelector('.pv-scroll')?.scrollTop || 0;
    Morph.apply(box, CatalogCard.html(this, full, { loading: false }));
    const scroll = box.querySelector('.pv-scroll');
    if (scroll) scroll.scrollTop = top;
  }

  /**
   * Изображение крупно поверх окна каталога; закрывается щелчком или Esc.
   * @param {string} src
   * @param {string} caption
   */
  zoom(src, caption) {
    const dialog = this.dlg();
    dialog.querySelector('.cw-lb')?.remove();
    const box = document.createElement('div');
    box.className = 'cw-lb';
    box.innerHTML = `<img src="${esc(src)}" alt=""><p>${esc(caption || 'Щелчок — закрыть')}</p>`;
    dialog.appendChild(box);
  }

  /**
   * Карточка крупно: занимает место списка, панель фильтров остаётся.
   * @param {string} [id] позиция (иначе открытая)
   */
  expand(id) {
    if (id) this.activate(id);
    if (!this.active) return;
    this.dlg().classList.add('pvwide');
    this.panes.pos();
    this.preview();
  }

  /** Карточка — обратно рядом со списком (Esc, «‹ К списку», «Свернуть»). */
  collapse() {
    this.dlg().classList.remove('pvwide');
    this.panes.pos();
    this.preview();
    if (!this.active) return;
    document
      .querySelector(`#cwList .cw-row[data-id="${CSS.escape(this.active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Открыть карточку позиции.
   * @param {string|null} id
   */
  activate(id) {
    this.active = id;
    document.querySelectorAll('#cwList .cw-row').forEach(row => row.classList.toggle('act', row.dataset.id === id));
    this.preview();
  }

  /**
   * Новая категория (окно поверх каталога).
   * @param {function(string): *} [then] категория создана
   * @param {string} [base] категория-образец
   * @returns {*}
   */
  newType(then, base) {
    return NewTypeDialog.open(this, then, base);
  }

  /**
   * Позиция сохранена в редакторе: обновить каталог, открыть её карточку.
   * @param {object} doc
   */
  async afterSave(doc) {
    await this.reload();
    this.active = doc.id;
    const box = $('#cwPv');
    if (box) box.dataset.id = '';
    this.note = `Сохранено: ${doc.name}`;
    this.redraw();
    requestAnimationFrame(() =>
      document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(doc.id)}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
  }

  /**
   * Загрузить файл каталога (.json).
   * @param {File} file
   * @returns {Promise<void>}
   */
  importFile(file) {
    return CatalogActions.importFile(this, file);
  }

  /**
   * Файл каталога для загрузки (.json).
   * @returns {Promise<void>}
   */
  exportFile() {
    return CatalogActions.exportFile(this);
  }

  /** Закрыть окно. */
  close() {
    const dialog = this.dlg();
    if (dialog.open) dialog.close();
  }

  _mode(mode) {
    const optFor = Number.isInteger(mode.opt) ? mode.opt : null;
    Object.assign(this, {
      optFor,
      admin: !!mode.admin && optFor == null,
      F: optFor != null ? CatalogFilter.options : CatalogFilter.items,
      active: null,
      limit: CatalogWindow.PAGE,
      lastCk: null,
      note: '',
      busy: '',
      tab: '',
    });
    this.sel.clear();
    const filter = this.F;
    if (mode.cat != null) Object.assign(filter, { cat: mode.cat, f: {}, rng: {}, grp: '' });
    if (mode.q != null) {
      filter.q = String(mode.q);
      filter.dropQuery();
    }
    if (mode.grp != null) Object.assign(filter, { grp: mode.grp, cat: '', f: {}, rng: {}, series: '' });
  }

  /**
   * Открыть окно каталога.
   * @param {object} [mode] {opt — опции позиции, admin — «Товары» в «Настройках», cat, q, grp}
   */
  async open(mode = {}) {
    this._mode(mode);
    const dialog = this.dlg();
    dialog.classList.remove('navon', 'pvon', 'pvwide');
    this.panes.loadSize();
    this.panes.load();
    dialog.innerHTML = CatalogEvents.html(this);
    AppTabs.show(dialog, 'cat');
    CatalogEvents.bind(this, dialog);
    this.panes.layout();
    this.docs = Catalog.cache.length
      ? Catalog.cache
      : await CatalogStore.list().catch(error => {
          Toast.show(`Каталог не загрузился: ${error.message || error}`);
          return [];
        });
    CatalogFilter.dropQueries();
    await Promise.all([this.loadPending(), this.loadSources()]);
    this.warm();
    this.redraw();
    setTimeout(() => {
      if (matchMedia('(pointer:fine)').matches) $('#cwQ')?.focus();
    }, CatalogWindow.FOCUS_DELAY);
  }
}
