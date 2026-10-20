import { AiTab } from './ai-tab.js';
import { CatalogEditor } from './catalog-edit.js';
import { CatalogWindow } from './catalog-window.js';
import { Logos } from './image-slots.js';
import { DescTab } from './item-desc.js';
import { ItemLinks } from './item-links.js';
import { ItemTabs } from './item-tabs.js';

/**
 * Карточка позиции (окно с вкладками): основное, состав и компоновка станции, автозаполнение, описание и фото,
 * характеристики, опции. Открытая карточка — EDIT {i, tab}; в каталоге (CATED) — та же карточка с ценой в каталоге.
 */
export class ItemEditor {
  static TABS = [
    ['main', 'Основное'],
    ['kit', 'Состав станции'],
    ['layout', 'Компоновка'],
    ['ai', '✨ Заполнить с ИИ'],
    ['desc', 'Описание и фото'],
    ['spec', 'Характеристики'],
    ['opts', 'Опции и услуги'],
  ];
  static STATION_FIRST = ['kit', 'layout'];
  static BODIES = {
    main: (item, i) => ItemTabs.main(item, i),
    kit: (item, i) => KitView.render(item, i),
    layout: (item, i) => StationUi.tab(item, i),
    desc: (item, i) => DescTab.html(item, i),
    spec: (item, i) => ItemTabs.spec(item, i),
    opts: (item, i) => ItemTabs.opts(item, i),
    ai: (item, i) => AiTab.html(item, i),
  };

  static _shown(item, station) {
    return ([key]) =>
      (key !== 'kit' || Kit.can(item)) &&
      (key !== 'layout' || StationUi.enabled(item)) &&
      (key !== 'ai' || (FEAT.on('ai') && !station));
  }

  /**
   * Вкладки позиции: «Состав станции» — только у станций (и у сборок, заведённых раньше), «Компоновка» — у станций;
   * у станции состав и компоновка — первыми.
   * @param {object} item
   * @returns {string[][]}
   */
  static tabs(item) {
    const station = !!Kit.station(item);
    const tabs = this.TABS.filter(this._shown(item, station));
    if (!station) return tabs;
    const first = this.STATION_FIRST;
    return [...tabs.filter(([key]) => first.includes(key)), ...tabs.filter(([key]) => !first.includes(key))];
  }

  /**
   * Открыть карточку позиции.
   * @param {number} i позиция КП
   * @param {string} [tab]
   */
  static open(i, tab) {
    const item = S.items[i];
    if (item && Logos.auto(item)) persist();
    EDIT = { i, tab: tab || (item && Kit.station(item) ? 'kit' : 'main') };
    const dialog = $('#edlg');
    this.render();
    if (!dialog.open) dialog.showModal();
  }

  /** Закрыть карточку («Готово»). */
  static close() {
    const dialog = $('#edlg');
    EDIT = null;
    if (dialog.open) dialog.close();
    renderForm();
    persist();
    StationImages.syncAll().then(changed => {
      if (changed) renderForm();
    });
  }

  static _head(item, i) {
    if (CATED) {
      const note =
        CatalogWindow.win.mod && !ADMIN.on
          ? '<span class="muted ed-modnote">Изменения будут отправлены на модерацию</span>'
          : '';
      return `<h3><span class="ed-cat">Каталог</span>${esc(item.name || 'Новая позиция')}</h3><button class="btn" type="button" data-catcancel>Отмена</button>${note}<button class="btn primary" type="button" data-catsave>${CatalogEditor.saveLabel()}</button>`;
    }
    const nav =
      S.items.length > 1
        ? `<button class="btn ghost" type="button" data-ednav="-1" ${i === 0 ? 'disabled' : ''} title="Предыдущая позиция">←</button><button class="btn ghost" type="button" data-ednav="1" ${i === S.items.length - 1 ? 'disabled' : ''} title="Следующая позиция">→</button>`
        : '';
    return `<h3>${i + 1}. ${esc(item.name || 'Новая позиция')}</h3>${nav}<button class="btn primary" type="button" data-edclose>Готово</button>`;
  }

  // активная вкладка — в середину полосы; окно могло быть ещё не показано (ширины 0) — после отрисовки
  static _center(dialog) {
    const bar = dialog.querySelector('.ed-tabs');
    const tab = bar.querySelector('.ed-tab.on');
    if (!tab) return;
    const mid = () => {
      if (tab.isConnected && bar.scrollWidth > bar.clientWidth)
        bar.scrollLeft = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
    };
    mid();
    requestAnimationFrame(mid);
  }

  static _refocus(dialog, path, active) {
    if (!path || active.isConnected) return;
    const field = dialog.querySelector(`[data-p="${CSS.escape(path)}"]`);
    if (!field) return;
    field.focus();
    try {
      const end = field.value.length;
      field.setSelectionRange(end, end);
    } catch {
      // поле без выделения (список)
    }
  }

  static _tabsHtml(item) {
    return this.tabs(item)
      .map(
        ([key, label]) =>
          `<button type="button" class="ed-tab${EDIT.tab === key ? ' on' : ''}" data-edtab="${key}">${label}${key === 'layout' ? StationUi.badge(item) : ''}</button>`,
      )
      .join('');
  }

  static _prepare(item) {
    if (!this.tabs(item).some(([key]) => key === EDIT.tab)) EDIT.tab = 'main';
    if (!CATED && EDIT.tab !== 'layout' && StationUi.enabled(item)) StationImages.soon(item); // 3D и листы — сразу по составу
  }

  /** Перерисовать карточку (фокус и прокрутка сохраняются). */
  static render() {
    const dialog = $('#edlg');
    if (!EDIT) return;
    const i = EDIT.i;
    const item = S.items[i];
    if (!item) {
      this.close();
      return;
    }
    this._prepare(item);
    const path = document.activeElement?.dataset?.p;
    const top = dialog.querySelector('.ed-b')?.scrollTop || 0;
    const body = (this.BODIES[EDIT.tab] || this.BODIES.ai)(item, i);
    const head = this._head(item, i);
    dialog.classList.toggle('catmode', !!CATED);
    const active = document.activeElement;
    const switched = dialog.dataset.tab !== EDIT.tab;
    dialog.dataset.tab = EDIT.tab;
    morph(
      dialog,
      `<div class="dlg-h">${head}</div>
    <div class="ed-tabs">${this._tabsHtml(item)}</div>
    <div class="ed-b">${body}</div>`,
    );
    dialog.querySelector('.ed-b').scrollTop = switched ? 0 : top;
    this._center(dialog);
    this._refocus(dialog, path, active);
  }

  static _click(event) {
    const dialog = event.target.closest('#edlg');
    if (!dialog) return;
    if (event.target.closest('[data-edclose]')) {
      this.close();
      return;
    }
    const tab = event.target.closest('[data-edtab]');
    if (tab) {
      EDIT.tab = tab.dataset.edtab;
      this.render();
      return;
    }
    const nav = event.target.closest('[data-ednav]');
    if (nav) {
      this._go(dialog, EDIT.i + +nav.dataset.ednav);
      return;
    }
    const photo = event.target.closest('[data-fimg]');
    if (photo && !event.target.closest('[data-a]')) this._pickFeat(photo);
  }

  static _go(dialog, k) {
    if (!S.items[k]) return;
    EDIT.i = k;
    this.render();
    dialog.querySelector('.ed-b').scrollTop = 0;
  }

  static _pickFeat(box) {
    const input = $('#filePick');
    input.value = '';
    input.multiple = false;
    input.onchange = () =>
      input.files[0] && ItemLinks.addFeatImage(+box.dataset.fimg, box.dataset.fid, [input.files[0]]);
    input.click();
  }

  // закрытие пришло позже повторного открытия — не сбрасывать
  static _closed(event) {
    if (event.target.id !== 'edlg' || event.target.open) return;
    if (CATED) {
      S.items = CATED.items; // окно закрыто не кнопками карточки каталога — правки не сохраняются
      CATED = null;
      EDIT = null;
      renderForm();
      return;
    }
    if (!EDIT) return;
    EDIT = null;
    renderForm();
    persist();
  }

  /** Обработчики карточки (вешаются один раз). */
  static listen() {
    document.addEventListener('click', event => this._click(event));
    document.addEventListener('close', event => this._closed(event), true);
    document.addEventListener('change', event => {
      const field = event.target;
      if (field.dataset.gat == null) return;
      const pic = S.items[+field.dataset.gat].gallery[+field.dataset.j];
      pic.at = field.value === 'free' ? 'free' : field.value;
      renderForm();
      persist();
    });
    EditorDrag.listen();
  }
}

/** Порядок блоков описания и изображений: перетаскивание за «⠿» (стрелки ↑↓ — ui/events.js). */
export class EditorDrag {
  static drag = { kind: '', i: -1, j: -1 };
  static MARKS = ['dragging', 'drop-b', 'drop-a'];
  static IMG_OFFSET = 20;

  static _box(event) {
    if (!this.drag.kind) return null;
    const selector = this.drag.kind === 'feat' ? '.fblock[data-fj]' : '.gcard[data-gj]';
    return (event.target.closest && event.target.closest(selector)) || null;
  }

  static _after(kind, box, event) {
    const rect = box.getBoundingClientRect();
    return kind === 'feat' ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
  }

  static _clear() {
    document.querySelectorAll('.dragging,.drop-b,.drop-a').forEach(el => el.classList.remove(...this.MARKS));
  }

  static _start(event) {
    const handle = event.target.closest && event.target.closest('[data-edrag]');
    if (!handle) return;
    Object.assign(this.drag, { kind: handle.dataset.edrag, i: +handle.dataset.i, j: +handle.dataset.j });
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('application/x-kp-move', handle.dataset.edrag);
    } catch {
      // браузер не принимает свой тип
    }
    const box = handle.closest('.fblock,.gcard');
    if (!box) return;
    box.classList.add('dragging');
    try {
      event.dataTransfer.setDragImage(box, this.IMG_OFFSET, this.IMG_OFFSET);
    } catch {
      // без картинки перетаскивания
    }
  }

  static _over(event) {
    if (!this.drag.kind) return;
    event.preventDefault();
    event.stopPropagation();
    const box = this._box(event);
    document.querySelectorAll('.drop-b,.drop-a').forEach(el => {
      if (el !== box) el.classList.remove('drop-b', 'drop-a');
    });
    if (!box) return;
    const after = this._after(this.drag.kind, box, event);
    box.classList.toggle('drop-a', after);
    box.classList.toggle('drop-b', !after);
  }

  static _moveGal(item, from, { target, after }) {
    const free = ItemLinks.freeGal(item);
    const cur = free.indexOf(from);
    let place = free.indexOf(target) + after;
    if (place > cur) place--;
    return cur >= 0 && place >= 0 && place < free.length && ItemLinks.moveGal(item, from, free[place]);
  }

  static _drop(event) {
    if (!this.drag.kind) return;
    event.preventDefault();
    event.stopPropagation();
    const box = this._box(event);
    const item = S.items[this.drag.i];
    const kind = this.drag.kind;
    const from = this.drag.j;
    this.drag.kind = '';
    this._clear();
    if (!box || !item) return;
    const after = this._after(kind, box, event) ? 1 : 0;
    let moved;
    if (kind === 'feat') {
      let place = +box.dataset.fj + after;
      if (place > from) place--;
      moved = ItemLinks.moveFeat(item, from, place);
    } else moved = this._moveGal(item, from, { target: +box.dataset.gj, after });
    if (!moved) return;
    renderForm();
    persist();
  }

  /** Перетаскивание блоков и изображений. */
  static listen() {
    document.addEventListener('dragstart', event => this._start(event), true);
    document.addEventListener('dragover', event => this._over(event), true);
    document.addEventListener('drop', event => this._drop(event), true);
    document.addEventListener(
      'dragend',
      () => {
        if (!this.drag.kind) return;
        this.drag.kind = '';
        this._clear();
      },
      true,
    );
  }
}
