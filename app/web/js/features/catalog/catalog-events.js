import { CatalogActions } from './catalog-actions.js';
import { CatalogClicks } from './catalog-clicks.js';
import { CatalogSorter } from './catalog-sorter.js';
import { CatalogTree } from './catalog-nav.js';
import { DefRegistry } from '../../core/defaults.js';
import { CatalogSearch } from './catalog-cache.js';
import { Debounce } from '../../core/debounce.js';
import { $, esc } from '../../core/util.js';
import { AdminSession } from '../../core/net.js';
import { Auth } from '../kp/auth.js';
import { FEAT } from '../../core/features.js';

/** Разметка окна каталога и его события (вешаются один раз на элемент окна). */
export class CatalogEvents {
  static SAVE_DELAY = 500;
  static BIG = 2000;
  static FAST = 60;
  static ARROWS = { ArrowDown: 1, ArrowUp: -1 };

  static _menu() {
    const imp = FEAT.on('catImport')
      ? '<button type="button" data-cw="xls">Импорт из Excel…</button><button type="button" data-cw="imp">Загрузить файл каталога (.json)…</button>'
      : '';
    const xport = Auth.can('export')
      ? '<button type="button" data-cw="xport">Выгрузить найденное… (Excel, JSON, XML, YML)</button>'
      : '';
    const exp =
      AdminSession.on || Auth.state.admin
        ? '<button type="button" data-cw="exp">Файл каталога для загрузки (.json)</button>'
        : '';
    return `<details class="cw-menu"><summary class="btn" title="Импорт, выгрузка, категории оборудования">Ещё<span class="cw-lbl"> ▾</span></summary><div>
         ${imp}${xport}${exp}
         <hr><button type="button" data-cw="types">Категории оборудования…</button></div></details>`;
  }

  static _title(win) {
    if (win.optFor != null) return `Опции для позиции ${win.optFor + 1}`;
    return win.admin ? 'Товары' : 'Каталог';
  }

  /**
   * Разметка окна.
   * @param {object} win
   * @returns {string}
   */
  static html(win) {
    const main = win.optFor == null;
    return `<div class="cw-h"><button class="btn cw-navbtn" type="button" data-cw="nav" aria-label="Категории и фильтры" title="Категории и фильтры"><span aria-hidden="true">☰</span><span class="cw-lbl2"> Фильтры</span></button>
       <h3>${this._title(win)}</h3>
       <div class="cw-q"><input type="search" id="cwQ" placeholder="Модель, артикул, производитель, поставщик или характеристика" autocomplete="off" value="${esc(win.F.q)}" aria-label="Поиск по каталогу" title="Можно без пробелов и дефисов: «DVK3013» найдёт DVK D 30-13; «/» — перейти к поиску"><kbd aria-hidden="true">/</kbd></div>
       ${main ? '<button class="btn" type="button" data-cw="new" title="Новая позиция каталога">+<span class="cw-lbl"> Позиция</span></button>' : ''}
       <button class="btn cw-modq" type="button" data-cw="modq" hidden title="Правки товаров, ожидающие решения: посмотреть «было → стало», принять или отклонить"></button>
       ${this._menu()}
       <button class="icon" type="button" data-cw="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button>
       <button class="icon" type="button" data-cw="close" aria-label="Закрыть">✕</button></div>
     <div class="cw-fb" id="cwBar" role="group" aria-label="Отбор по категории, производителю, поставщику"></div>
     <div class="cw-b"><nav class="cw-nav" id="cwNav" aria-label="Категории и фильтры"></nav>
       <section class="cw-mid"><div class="cw-chips" id="cwChips" aria-live="polite"></div><div class="cw-tb"><label class="ck" title="Отметить все найденные"><input type="checkbox" id="cwAll" aria-label="Отметить все найденные"></label><span class="muted" id="cwCnt"></span><span class="sp"></span>
           <label class="cw-sortl" for="cwSort">Сортировка</label><select id="cwSort" aria-label="Сортировка"></select><button class="btn sm cw-dir" type="button" id="cwDir"></button></div>
         <div class="cw-list" id="cwList"><p class="empty">Загружаю…</p></div></section>
       <aside class="cw-pv" id="cwPv" aria-label="Карточка позиции"></aside>
       <div class="cw-split" data-split="nav" role="separator" aria-orientation="vertical" aria-label="Ширина панели фильтров" tabindex="0" title="Потяните, чтобы изменить ширину панели фильтров. Двойной щелчок — как было"></div>
       <div class="cw-split" data-split="pv" role="separator" aria-orientation="vertical" aria-label="Ширина карточки позиции" tabindex="0" title="Потяните, чтобы изменить ширину карточки. Двойной щелчок — как было"></div></div>
     <div class="cw-f" id="cwF"></div>`;
  }

  /**
   * Повесить события на окно (один раз).
   * @param {object} win
   * @param {HTMLDialogElement} dialog
   */
  static bind(win, dialog) {
    if (dialog._bound) return;
    dialog._bound = true;
    win.panes.bind();
    this._resize(win, dialog);
    const delay = new Debounce();
    dialog.addEventListener('input', event => this._input(win, event.target, delay));
    dialog.addEventListener('change', event => CatalogChanges.handle(win, event.target));
    dialog.addEventListener('click', event => CatalogClicks.handle(win, event, dialog));
    dialog.addEventListener('dblclick', event => this._dblclick(win, event));
    dialog.addEventListener('cancel', event => this._cancel(win, event, dialog));
    dialog.addEventListener('keydown', event => this._key(win, event));
    CatalogDrag.bind(win, dialog);
  }

  static _resize(win, dialog) {
    let timer = null;
    new ResizeObserver(() => {
      if (!dialog.open) return;
      win.panes.layout();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (dialog.open && !dialog.classList.contains('max')) win.panes.saveSize();
      }, this.SAVE_DELAY);
    }).observe(dialog);
  }

  // поиск по характеристикам — на сервере: ответ пришёл, запрос тот же → список с найденным по характеристикам
  static _server(win, filter) {
    const query = filter.q;
    if (CatalogSearch.has(query)) return;
    CatalogSearch.ask(query).then(ids => {
      if (!(ids && ids.size && filter.q === query && $('#catdlg')?.open)) return;
      const added = filter.addServer(query, ids);
      if (added < 0) filter.dropQuery();
      if (added) win.refresh();
    });
  }

  static _search(win, field, delay) {
    const filter = win.F;
    filter.q = field.value;
    win.limit = win.constructor.PAGE;
    const wait = DefRegistry.num('cat.qDelay', 180);
    delay.run(
      () => {
        win.refresh();
        this._server(win, filter);
      },
      win.docs.length > this.BIG ? wait : Math.min(this.FAST, wait),
    );
  }

  static _input(win, field, delay) {
    if (field.id === 'cwQ') {
      this._search(win, field, delay);
      return;
    }
    if (!field.dataset.rk) return;
    const rng = win.F.rng;
    if (!rng[field.dataset.rk]) rng[field.dataset.rk] = { min: '', max: '' };
    rng[field.dataset.rk][field.dataset.rs] = field.value.replace(',', '.').replace(/[^\d.]/g, '');
    win.list();
  }

  // двойной щелчок по позиции — карточка крупно (на месте списка); по границе панелей — ширина как была
  static _dblclick(win, event) {
    const split = event.target.closest('.cw-split');
    if (split) {
      win.panes.reset(split.dataset.split);
      return;
    }
    const row = event.target.closest('.cw-row');
    if (!row || event.target.closest('button,label,input')) return;
    getSelection()?.removeAllRanges();
    win.expand(row.dataset.id);
  }

  static _cancel(win, event, dialog) {
    const zoom = dialog.querySelector('.cw-lb');
    if (zoom) {
      event.preventDefault();
      zoom.remove();
      return;
    }
    if (!dialog.classList.contains('pvwide')) return;
    event.preventDefault();
    win.collapse();
  }

  static _slash(event) {
    if (event.key !== '/' || !FEAT.on('hotkeys') || event.ctrlKey || event.metaKey || event.altKey) return false;
    return !event.target.closest?.('input,textarea,select,[contenteditable]');
  }

  static _queryKey(win, event) {
    const field = event.target;
    if (field.id !== 'cwQ') return false;
    if (event.key === 'Escape' && field.value) {
      event.preventDefault();
      event.stopPropagation();
      field.value = '';
      win.F.q = '';
      win.refresh();
      return true;
    }
    if (event.key !== 'Enter') return false;
    event.preventDefault();
    const first = win.view[0];
    if (first) win.activate(first.id);
    return false;
  }

  static _arrow(win, event) {
    const step = this.ARROWS[event.key];
    const inList = event.target.id === 'cwQ' || event.target.closest?.('.cw-list');
    if (!step || !inList || !win.view.length) return;
    event.preventDefault();
    const ids = win.view.slice(0, win.limit).map(card => card.id);
    const cur = ids.indexOf(win.active);
    const next = cur < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, cur + step));
    win.activate(ids[next]);
    document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(ids[next])}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  static _key(win, event) {
    if (this._slash(event)) {
      event.preventDefault();
      const query = $('#cwQ');
      query?.focus();
      query?.select();
      return;
    }
    if (this._queryKey(win, event)) return;
    this._arrow(win, event);
  }
}

/** Смена условий отбора в окне каталога (списки, галочки, сортировка). */
export class CatalogChanges {
  static _top(win, field) {
    const filter = win.F;
    const key = field.dataset.top;
    win.limit = win.constructor.PAGE;
    if (key === 'cat') {
      filter.setCategory(field.value);
      win.tab = field.value ? 'flt' : '';
    } else filter[key] = field.value;
    win.refresh();
    $('#cwList').scrollTop = 0;
  }

  static _facet(win, field) {
    const filter = win.F;
    if (field.dataset.in) filter.f[field.dataset.f] = field.value;
    else filter[field.dataset.f] = field.value;
    win.limit = win.constructor.PAGE;
    win.refresh();
  }

  static _toggle(win, key, field) {
    win.F[key] = field.checked;
    win.limit = win.constructor.PAGE;
    win.refresh();
  }

  static _all(win, field) {
    win.view.forEach(card => (field.checked ? win.sel.add(card.id) : win.sel.delete(card.id)));
    win.list();
    win.foot();
  }

  static _sort(win, field) {
    win.F.sort = field.value;
    win.F.dir = CatalogSorter.def(field.value);
    win.list();
    $('#cwList').scrollTop = 0;
  }

  static _byId = {
    cwSort: (win, field) => CatalogChanges._sort(win, field),
    cwPriced: (win, field) => CatalogChanges._toggle(win, 'priced', field),
    cwStock: (win, field) => CatalogChanges._toggle(win, 'stock', field),
    cwAll: (win, field) => CatalogChanges._all(win, field),
  };

  /**
   * Изменено поле окна.
   * @param {object} win
   * @param {HTMLElement} field
   */
  static handle(win, field) {
    if (field.dataset.cwzero != null) {
      CatalogTree.hideZero(field.checked);
      win.nav();
      return;
    }
    const byId = this._byId[field.id];
    if (byId) byId(win, field);
    else if (field.dataset.f != null) this._facet(win, field);
    else if (field.dataset.top) this._top(win, field);
    else if (field.dataset.pvcat != null && win.active) CatalogActions.move(win, [win.active], field.value);
  }
}

/** Перенос перетаскиванием: позиция (или все отмеченные, если тянут отмеченную) → категория слева. */
export class CatalogDrag {
  static _start(win, event, dialog) {
    const row = event.target.closest?.('.cw-row');
    if (!row || win.optFor != null) return;
    const id = row.dataset.id;
    win.drag = win.sel.has(id) ? [...win.sel] : [id];
    if (win.tab !== 'cats' && !dialog.classList.contains('narrow')) {
      win.tab = 'cats'; // цели переноса — во вкладке «Категории»
      setTimeout(() => win.nav());
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'text/plain',
      win.drag.length > 1 ? `${win.drag.length} позиций` : win.doc(id)?.name || '',
    );
    dialog.classList.add('dragging');
  }

  static _end(win, dialog) {
    win.drag = null;
    dialog.classList.remove('dragging');
    dialog.querySelectorAll('.cw-cat.over').forEach(button => button.classList.remove('over'));
  }

  static _over(win, event, dialog) {
    const target = event.target.closest?.('[data-dropcat]');
    if (!target || !win.drag) return;
    event.preventDefault();
    target.classList.toggle('over', event.type === 'dragover');
    if (event.type !== 'drop') return;
    const ids = win.drag;
    win.drag = null;
    dialog.classList.remove('dragging');
    CatalogActions.move(win, ids, target.dataset.dropcat);
  }

  /**
   * Повесить события перетаскивания.
   * @param {object} win
   * @param {HTMLDialogElement} dialog
   */
  static bind(win, dialog) {
    dialog.addEventListener('dragstart', event => this._start(win, event, dialog));
    dialog.addEventListener('dragend', () => this._end(win, dialog));
    ['dragover', 'dragleave', 'drop'].forEach(type =>
      dialog.addEventListener(type, event => this._over(win, event, dialog)),
    );
  }
}
