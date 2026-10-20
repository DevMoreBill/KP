import { DealCal } from './deal-cal.js';
import { DealRows } from './deal-rows.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';

/** Перетаскивание мышью: этапы оплаты (за «⠿» в строке этапа) и строки графика (платёж получит дату строки рядом). */
export class DealDrag {
  /**
   * @param {HTMLDialogElement} dlg
   * @param {Function} touch расчёт изменён
   */
  constructor(dlg, touch) {
    this.dlg = dlg;
    this.touch = touch;
  }

  /** Обработчики перетаскивания. */
  listen() {
    const dlg = this.dlg;
    dlg.addEventListener('dragstart', event => this._startStage(event));
    dlg.addEventListener('dragover', event => this._overStage(event));
    dlg.addEventListener('drop', event => this._dropStage(event));
    dlg.addEventListener('dragstart', event => this._startRow(event));
    dlg.addEventListener('dragover', event => this._overRow(event));
    dlg.addEventListener('drop', event => this._dropRow(event));
    dlg.addEventListener('dragend', () => this._endRow());
    dlg.addEventListener('dragend', () => this._endStage());
  }

  static _ghost(event, row, text) {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', text);
    } catch {
      // браузер не дал записать данные перетаскивания — не мешает
    }
    if (!row) return;
    row.classList.add('dragging');
    try {
      event.dataTransfer.setDragImage(row, 20, 20);
    } catch {
      // без картинки перетаскивания
    }
  }

  static _after(event, row) {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  _mark(event, row, selector) {
    const after = DealDrag._after(event, row);
    this.dlg.querySelectorAll(selector).forEach(other => {
      if (other !== row) other.classList.remove('drop-b', 'drop-a');
    });
    row.classList.toggle('drop-a', after);
    row.classList.toggle('drop-b', !after);
  }

  _startStage(event) {
    const handle = event.target.closest && event.target.closest('[data-dndh]');
    if (!handle) return;
    DealUi.drag = { grp: handle.dataset.dndh, from: +handle.dataset.i };
    DealDrag._ghost(event, handle.closest('.dl-tr'), 'stage');
  }

  static _stageRow(event) {
    const row = event.target.closest && event.target.closest('.dl-tr[data-dnd]');
    return row && DealUi.drag && row.dataset.dnd === DealUi.drag.grp ? row : null;
  }

  _overStage(event) {
    const row = DealDrag._stageRow(event);
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this._mark(event, row, '.dl-tr.drop-b,.dl-tr.drop-a');
  }

  _dropStage(event) {
    const row = DealDrag._stageRow(event);
    if (!row) return;
    event.preventDefault();
    const index = +row.dataset.i;
    const from = DealUi.drag.from;
    let target = DealDrag._after(event, row) ? index + 1 : index;
    if (target > from) target--;
    const message = DealRows.moveStage(DealUi.drag.grp, from, target);
    DealUi.drag = null;
    if (message) {
      this.touch();
      toast(message);
    }
    DealWin.render();
  }

  _startRow(event) {
    const handle = event.target.closest && event.target.closest('[data-dnds]');
    if (!handle) return;
    DealUi.sdrag = handle.dataset.dnds;
    DealDrag._ghost(event, handle.closest('tr'), 'row');
  }

  static _scheduleRow(event) {
    const row = event.target.closest && event.target.closest('.dl-t tr[data-skey]');
    return row && DealUi.sdrag ? row : null;
  }

  _overRow(event) {
    const row = DealDrag._scheduleRow(event);
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this._mark(event, row, '.dl-t tr.drop-b,.dl-t tr.drop-a');
    row.title =
      row.dataset.skey === DealUi.sdrag
        ? ''
        : `Платёж получит дату ${DealCal.dayRu(+row.dataset.sday) || `день ${row.dataset.sday}`}`;
  }

  _dropRow(event) {
    const row = DealDrag._scheduleRow(event);
    if (!row) return;
    event.preventDefault();
    const key = DealUi.sdrag;
    DealUi.sdrag = null;
    if (row.dataset.skey === key) {
      DealWin.render();
      return;
    }
    const message = DealRows.setRowDay(key, +row.dataset.sday);
    this.touch();
    toast(message);
    DealWin.render();
  }

  _endRow() {
    DealUi.sdrag = null;
    this.dlg
      .querySelectorAll('.dl-t tr.dragging,.dl-t tr.drop-b,.dl-t tr.drop-a')
      .forEach(row => row.classList.remove('dragging', 'drop-b', 'drop-a'));
  }

  _endStage() {
    DealUi.drag = null;
    this.dlg
      .querySelectorAll('.dl-tr.dragging,.dl-tr.drop-b,.dl-tr.drop-a')
      .forEach(row => row.classList.remove('dragging', 'drop-b', 'drop-a'));
  }
}
