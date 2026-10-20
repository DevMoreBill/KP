import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignModel } from './design-model.js';
import { DesignObjects } from './design-objects.js';
import { DesignPanels } from './design-panels.js';
import { DesignView } from './design-view.js';
import { TemplateDesigner } from './template-designer.js';

/** Графический редактор шаблона: щелчки — выбор в документе, кнопки панелей. */
export class DesignClicks {
  static ZOOM_STEP = 0.1;
  static STEP_MIN = 5;
  static STEP_MAX = 96;
  static STEP_DEFAULT = 10;
  static HALVES = 2;
  static ACTIONS = {
    close: () => TemplateDesigner.close(),
    undo: () => DesignHistory.undo(),
    redo: () => DesignHistory.redo(),
    zin: () => DesignView.zoom(DesignClicks.ZOOM_STEP),
    zout: () => DesignView.zoom(-DesignClicks.ZOOM_STEP),
    zfit: () => DesignView.fit(),
    save: () => TemplateDesigner.save(),
    saveas: () => TemplateDesigner.saveAs(),
    addlabel: () => DesignObjects.addLabel(),
    dup: () => DesignObjects.duplicate(),
    del: () => DesignObjects.remove(),
    docx: () => TemplateDesigner.trial(),
    form: () => TemplateDesigner.toForm(),
    brandadd: () =>
      DesignHistory.change(work => {
        (work.brandParts = work.brandParts || []).push(['', 'BLUE']);
      }),
    hdrlogodel: () =>
      DesignHistory.change(work => {
        work.header.logo = '';
      }),
    clientsdel: () =>
      DesignHistory.change(work => {
        work.clientsImage = '';
      }),
    resetmoves: () => DesignClicks._resetMoves(),
  };
  // [атрибут, обработчик, достаточно наличия атрибута (пустое значение — тоже)]
  static BUTTONS = [
    ['tdtab', '_tab'],
    ['tdpick', '_pick'],
    ['tdgo', '_go'],
    ['tdstyle', '_style'],
    ['tdvar', '_variable'],
    ['tdsecon', '_sectionOn', 'present'],
    ['tdsecmv', '_sectionMove'],
    ['tdtog', '_toggle'],
    ['tdset', '_set'],
    ['tdsetc', '_setColor', 'present'],
    ['tdstep', '_step'],
    ['tdparareset', '_paraReset'],
    ['tdimgreset', '_imageReset'],
    ['tdbranddel', '_brandDelete', 'present'],
  ];

  /**
   * Щелчок в окне редактора.
   * @param {MouseEvent} event
   */
  static async handle(event) {
    const state = Design.state;
    const dialog = $('#tddlg');
    if (!dialog || !dialog.open || !dialog.contains(event.target)) return;
    if (state.clickBlock) {
      state.clickBlock = false;
      if (event.target.closest('#tdPages, #tdSecs')) return;
    }
    const button = event.target.closest('button');
    try {
      if (!button) this._page(event);
      else await this._button(button);
    } catch (error) {
      alert(`Не получилось: ${error.message || error}`);
    }
  }

  // щелчок по документу: надпись, картинка, текст стиля, иначе раздел под точкой
  static _page(event) {
    if (!event.target.closest('#tdPages')) return;
    const sel = DesignModel.pointed(event.target);
    if (sel) {
      DesignView.select(sel);
      return;
    }
    const section = DesignView.sectionAt(event.clientY);
    DesignView.select(section ? { kind: 'sec', key: section } : null);
  }

  static async _button(button) {
    const action = this.ACTIONS[button.dataset.td];
    if (action) return action();
    const row = this.BUTTONS.find(([key, , present]) => (present ? button.dataset[key] != null : button.dataset[key]));
    return row ? this[row[1]](button) : undefined;
  }

  static _resetMoves() {
    if (!confirm('Вернуть все сдвинутые мышью тексты и картинки макета на места и к размерам по макету?')) return;
    DesignHistory.change(work => {
      work.para = {};
      work.imgSize = {};
    });
  }

  static _tab(button) {
    Design.state.tab = button.dataset.tdtab;
    DesignPanels.panels();
  }

  static _pick(button) {
    DesignView.select({ kind: button.dataset.tdpick, key: button.dataset.key }, { scroll: true });
  }

  static _go(button) {
    DesignView.select({ kind: 'sec', key: button.dataset.tdgo }, { scroll: true });
  }

  static _style(button) {
    const key = button.dataset.tdstyle;
    const element = Design.query(`[data-tds="${CSS.escape(key)}"]`);
    const text = element ? (element.closest('p') || element).textContent : '';
    DesignView.select({ kind: 'style', key, text, el: element }, { scroll: true });
  }

  static _variable(button) {
    const area = $('#tdLblText');
    if (!area) return;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const name = button.dataset.tdvar;
    area.value = area.value.slice(0, start) + name + area.value.slice(end);
    area.focus();
    area.selectionStart = area.selectionEnd = start + name.length;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  static _sectionOn(button) {
    DesignHistory.change(work => {
      const section = work.sections[+button.dataset.tdsecon];
      section.on = !section.on;
    });
  }

  static _sectionMove(button) {
    const sections = Design.state.work.sections;
    const from = sections.findIndex(section => section.id === Design.state.sel.key);
    const target = from + +button.dataset.tdsecmv;
    if (target < 0 || target >= sections.length) return;
    DesignHistory.change(work => {
      const list = work.sections;
      [list[from], list[target]] = [list[target], list[from]];
    });
  }

  static _toggle(button) {
    const path = button.dataset.tdtog;
    DesignHistory.change(work => setPath(work, path, !getPath(work, path)));
  }

  static _set(button) {
    const value = button.dataset.v;
    const path = button.dataset.tdset;
    if (/\.float$/.test(path)) return DesignObjects.position(path.replace(/\.float$/, ''), value);
    return DesignHistory.change(work => {
      if (value !== '') {
        setPath(work, path, /^-?\d+(\.\d+)?$/.test(value) && !/align|Side/.test(path) ? +value : value);
        return;
      }
      const parts = path.split('.');
      const owner = getPath(work, parts.slice(0, -1).join('.'));
      if (owner) delete owner[parts[parts.length - 1]];
    });
  }

  static _setColor(button) {
    const { v: value, tdsetc: path } = button.dataset;
    DesignHistory.change(work => setPath(work, path, value));
  }

  static _step(button) {
    const path = button.dataset.tdstep;
    const delta = +button.dataset.d;
    DesignHistory.change(
      work => {
        const size = Design.round((+getPath(work, path) || this.STEP_DEFAULT) + delta, this.HALVES);
        setPath(work, path, Math.max(this.STEP_MIN, Math.min(this.STEP_MAX, size)));
      },
      { merge: `step${path}` },
    );
  }

  static _paraReset(button) {
    const key = button.dataset.tdparareset;
    DesignHistory.change(work => {
      delete work.para[key];
    });
  }

  static _imageReset(button) {
    const key = button.dataset.tdimgreset;
    DesignHistory.change(work => {
      delete work.imgSize[key];
    });
  }

  static _brandDelete(button) {
    DesignHistory.change(work => {
      work.brandParts.splice(+button.dataset.tdbranddel, 1);
    });
  }
}
