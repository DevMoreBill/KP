import { CatalogAnalogs } from './catalog-analogs.js';
import { CatalogCompare, CatalogSimilar } from './catalog-compare.js';
import { CatalogActions } from './catalog-actions.js';
import { CatalogScroll } from './catalog-scroll.js';
import { CatalogTree } from './catalog-nav.js';
import { ModerationList } from './moderation.js';
import { TypesEditor } from './types-editor.js';
import { XlsImport } from './excel-import.js';
import { $ } from '../../core/util.js';
import { CatalogExportDlg } from './catalog-export.js';
import { KpForm } from '../../core/kp-form.js';
import { WizardLink } from '../../core/wizard-link.js';

/** Щелчки в окне каталога: отметки, вкладки, плашки, категории, пакетные действия, карточка, меню. */
export class CatalogClicks {
  static BULK = {
    add: (win, ids) => CatalogActions.add(win, ids),
    move: (win, ids) => CatalogActions.moveDlg(win, ids),
    compare: (win, ids) =>
      CatalogCompare.open(ids.map(id => win.doc(id)).filter(Boolean), id => CatalogActions.add(win, [id])),
    trash: (win, ids) => CatalogActions.trash(win, ids),
    export: (win, ids) => CatalogExportDlg.open(ids, ids.map(id => win.doc(id)).filter(Boolean)),
    clear: win => {
      win.sel.clear();
      win.list();
      win.foot();
    },
  };
  static CARD = {
    add: (win, id) => CatalogActions.add(win, [id]),
    edit: (win, id) => CatalogActions.edit(win, id),
    dup: (win, id) => CatalogActions.dup(win, id),
    similar: (win, id) => CatalogSimilar.open(win.doc(id), other => win.activate(other)),
    analogs: (win, id) => CatalogAnalogs.open(win.doc(id), other => win.activate(other)),
    trash: (win, id) => CatalogActions.trash(win, [id]),
    wide: (win, id, dialog) => (dialog.classList.contains('pvwide') ? win.collapse() : win.expand()),
    close: (win, id, dialog) => {
      if (dialog.classList.contains('pvwide')) return win.collapse();
      win.active = null;
      return win.activate(null);
    },
  };
  static MENU = {
    close: win => win.close(),
    done: win => {
      win.close();
      if (win.optFor == null && KpForm.step() !== 'equip') KpForm.open('equip');
    },
    max: (win, dialog) => {
      dialog.classList.toggle('max');
      win.panes.saveSize();
    },
    nav: (win, dialog) => dialog.classList.toggle('navon'),
    reset: win => {
      win.F.resetParams();
      win.refresh();
    },
    resetall: win => {
      win.F.resetAll();
      const query = $('#cwQ');
      if (query) query.value = '';
      win.limit = win.constructor.PAGE;
      win.refresh();
    },
    undo: win => CatalogActions.undoMove(win),
    newtype: win =>
      win.newType(id => {
        Object.assign(win.F, { cat: id, f: {}, rng: {} });
        win.redraw();
      }),
    new: win => WizardLink.open('catalog', win.F.cat || ''),
    xls: win => XlsImport.open(win.F.cat),
    types: win => TypesEditor.open(win.F.cat || undefined),
    exp: win => win.exportFile(),
    xport: win => {
      const list = win.sel.size ? win.view.filter(card => win.sel.has(card.id)) : win.view;
      return CatalogExportDlg.open(
        list.map(card => card.id),
        list,
      );
    },
    modq: () => ModerationList.open(),
    imp: (win, dialog) => CatalogClicks._pickFile(win, dialog),
  };
  // плашка условия: что сбросить
  static CHIPS = {
    q: (win, filter) => {
      filter.q = '';
      const query = $('#cwQ');
      if (query) query.value = '';
    },
    cat: (win, filter) => {
      filter.pickCategory('');
      win.tab = '';
    },
    grp: (win, filter) => {
      filter.grp = '';
    },
    priced: (win, filter) => {
      filter.priced = false;
    },
    stock: (win, filter) => {
      filter.stock = false;
    },
    old: (win, filter) => {
      filter.old = false;
    },
  };

  static _pickFile(win, dialog) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (file) win.importFile(file);
    };
    dialog.appendChild(input);
    input.click();
  }

  static _check(win, event, box) {
    const id = box.closest('.cw-row').dataset.id;
    const ids = win.view.map(card => card.id);
    const checked = box.checked;
    const mark = one => (checked ? win.sel.add(one) : win.sel.delete(one));
    if (event.shiftKey && win.lastCk && ids.includes(win.lastCk)) {
      const [from, last] = [ids.indexOf(win.lastCk), ids.indexOf(id)].sort((first, second) => first - second);
      ids.slice(from, last + 1).forEach(mark);
    } else mark(id);
    win.lastCk = id;
    win.list();
    win.foot();
  }

  static _chip(win, key) {
    const filter = win.F;
    win.limit = win.constructor.PAGE;
    const reset = this.CHIPS[key];
    if (reset) reset(win, filter);
    else if (key.startsWith('f:')) filter.f[key.slice(2)] = '';
    else if (key.startsWith('r:')) filter.rng[key.slice(2)] = { min: '', max: '' };
    else filter[key] = '';
    win.refresh();
  }

  static _sectionCat(win, button) {
    win.F.pickCategory(button.dataset.gcat);
    win.limit = win.constructor.PAGE;
    win.tab = win.F.cat ? 'flt' : '';
    win.refresh();
    CatalogScroll.start();
  }

  static _cat(win, button, dialog) {
    win.F.setCategory(button.dataset.cat);
    win.limit = win.constructor.PAGE;
    win.tab = win.F.cat ? 'flt' : 'cats';
    if (!win.F.cat) dialog.classList.remove('navon');
    win.refresh();
    CatalogScroll.start();
  }

  static _range(win, button) {
    const key = button.dataset.rc;
    const range = win.F.rng[key] || { min: '', max: '' };
    const same = String(range.min) === button.dataset.lo && String(range.max) === button.dataset.hi;
    win.F.rng[key] = same ? { min: '', max: '' } : { min: button.dataset.lo, max: button.dataset.hi };
    win.refresh();
  }

  static _dir(win) {
    win.F.dir = -(win.F.dir || 1);
    win.list();
    CatalogScroll.start();
  }

  // цели щелчка по порядку: селектор → действие
  static TARGETS = [
    [
      '[data-cwfold]',
      (win, el) => {
        CatalogTree.fold(el.dataset.cwfold);
        win.nav();
      },
    ],
    ['#cwDir', win => CatalogClicks._dir(win)],
    [
      '[data-tab]',
      (win, el) => {
        win.tab = el.dataset.tab;
        win.nav();
      },
    ],
    ['[data-chip]', (win, el) => CatalogClicks._chip(win, el.dataset.chip)],
    ['[data-gcat]', (win, el) => CatalogClicks._sectionCat(win, el)],
    ['[data-cat]', (win, el, dialog) => CatalogClicks._cat(win, el, dialog)],
    ['[data-more]', win => win.more()],
    ['[data-add]', (win, el) => CatalogActions.add(win, [el.closest('.cw-row').dataset.id])],
    ['[data-rc]', (win, el) => CatalogClicks._range(win, el)],
    ['[data-bulk]', (win, el) => CatalogClicks.BULK[el.dataset.bulk]?.(win, [...win.sel])],
    ['[data-pv]', (win, el, dialog) => CatalogClicks._card(win, el, dialog)],
    ['.pv-photo>img:first-child, .pv-gal img', (win, el) => win.zoom(el.src, el.title || '')],
    ['.cw-lb', (win, el) => el.remove()],
    ['.cw-row', (win, el) => win.activate(el.dataset.id)],
    ['[data-cw]', (win, el, dialog) => CatalogClicks.MENU[el.dataset.cw]?.(win, dialog)],
  ];

  static _card(win, button, dialog) {
    if (!win.active) return;
    this.CARD[button.dataset.pv]?.(win, win.active, dialog);
  }

  static _closeMenu(target, dialog) {
    const menu = dialog.querySelector('.cw-menu');
    if (menu && menu.open && !target.closest('.cw-menu summary')) menu.open = false;
  }

  /**
   * Щелчок в окне каталога.
   * @param {object} win
   * @param {MouseEvent} event
   * @param {HTMLDialogElement} dialog
   */
  static handle(win, event, dialog) {
    const target = event.target;
    this._closeMenu(target, dialog);
    const box = target.closest('[data-ck]');
    if (box) {
      this._check(win, event, box);
      return;
    }
    if (target.closest('.ck')) return;
    for (const [selector, action] of this.TARGETS) {
      const el = target.closest(selector);
      if (el) {
        action(win, el, dialog);
        return;
      }
    }
  }
}
