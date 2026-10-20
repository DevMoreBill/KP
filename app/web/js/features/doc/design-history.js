import { Design } from './design.js';
import { DesignModel } from './design-model.js';
import { DesignPanels } from './design-panels.js';
import { DesignView } from './design-view.js';

/** Графический редактор шаблона: изменения рабочей копии с отменой и повтором. */
export class DesignHistory {
  static MERGE_MS = 1200;
  static DEPTH = 100;

  /**
   * Изменить рабочую копию: запись в историю отмены, панели, перестройка документа.
   * @param {function(object): void} change
   * @param {{merge?: string, panels?: boolean, now?: boolean}} [options] merge — склеивать частые изменения одного поля;
   *   panels: false — не перерисовывать панели (поле ввода не теряет фокус); now — перестроить документ сразу
   */
  static change(change, options = {}) {
    const state = Design.state;
    const before = JSON.stringify(state.work);
    change(state.work);
    if (JSON.stringify(state.work) === before) return;
    const last = state.undo[state.undo.length - 1];
    if (!(options.merge && last && last.tag === options.merge && Date.now() - last.at < this.MERGE_MS)) {
      state.undo.push({ snapshot: before, tag: options.merge || '', at: Date.now() });
    } else last.at = Date.now();
    if (state.undo.length > this.DEPTH) state.undo.shift();
    state.redo = [];
    state.note = '';
    if (options.panels !== false) DesignPanels.panels();
    else DesignPanels.top();
    if (options.now) DesignView.previewNow();
    else DesignView.preview();
  }

  /** Отменить последнее изменение. */
  static undo() {
    this._step(Design.state.undo, Design.state.redo);
  }

  /** Повторить отменённое. */
  static redo() {
    this._step(Design.state.redo, Design.state.undo);
  }

  static _step(source, target) {
    const state = Design.state;
    const entry = source.pop();
    if (!entry) return;
    target.push({ snapshot: JSON.stringify(state.work), tag: '', at: 0 });
    state.work = JSON.parse(entry.snapshot);
    const sel = state.sel;
    if (sel && (sel.kind === 'img' || sel.kind === 'label') && /^[XL]_/.test(sel.key) && !DesignModel.item(sel))
      state.sel = null;
    DesignPanels.panels();
    DesignView.previewNow();
  }

  /**
   * Есть несохранённые изменения.
   * @returns {boolean}
   */
  static dirty() {
    const state = Design.state;
    return state.work && JSON.stringify(state.work) !== state.saved;
  }
}
