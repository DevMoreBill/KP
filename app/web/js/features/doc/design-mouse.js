import { Design } from './design.js';
import { DesignClicks } from './design-clicks.js';
import { DesignInputs } from './design-inputs.js';
import { DesignInspector } from './design-inspector.js';
import { DesignModel } from './design-model.js';
import { DesignMove } from './design-move.js';
import { DesignResize } from './design-resize.js';
import { DesignSort } from './design-sort.js';
import { DesignView } from './design-view.js';

/** Графический редактор шаблона: обработчики документа — мышь, клавиши, поля, масштаб колесом, подсказки. */
export class DesignMouse {
  static ZOOM_STEP = 0.1;
  static HINT = '#tdPages [data-tds], #tdPages [data-tdi] img, #tdPages .kp-lbl';

  static _resize(event, handle) {
    const sel = Design.state.sel;
    const element = DesignModel.primary();
    if (!element || !(sel.kind === 'img' || sel.kind === 'label')) return;
    event.preventDefault();
    event.stopPropagation();
    new DesignResize(event, handle, element);
  }

  static _pointerDown(event) {
    const dialog = $('#tddlg');
    if (!dialog || !dialog.open || event.button !== 0 || !Design.state.work) return;
    const handle = event.target.closest('#tdSelBox .td-h');
    if (handle && Design.state.sel) {
      this._resize(event, handle.dataset.h);
      return;
    }
    if (!event.target.closest('#tdPages')) return;
    const sel = DesignModel.pointed(event.target);
    if (!sel || sel.key === 'headerText') return;
    event.preventDefault();
    new DesignMove(event, sel);
  }

  static _sortDown(event) {
    const row = event.target.closest && event.target.closest('#tdSecs li');
    if (!row || event.button !== 0 || event.target.closest('.sw')) return;
    new DesignSort(event, row);
  }

  static _hintText(element) {
    if (element.dataset.tds)
      return `${DesignModel.styleLabel(element.dataset.tds)} — щёлкните, чтобы изменить; перетащите, чтобы сдвинуть`;
    if (element.classList.contains('kp-lbl')) return 'Надпись — перетащите в любое место';
    const key = (element.closest('[data-tdi]') || {}).dataset?.tdi || '';
    if (/^X_/.test(key)) return 'Картинка шаблона — перетащите в любое место';
    return `${Design.IMAGES[element.closest('[data-tdi]').dataset.tdi] || 'Картинка'} — маркеры меняют размер`;
  }

  // наведение — подсказка, что можно выбрать
  static _hint(event) {
    const element = event.target.closest && event.target.closest(this.HINT);
    if (!element || !Design.state.work) return;
    const text = this._hintText(element);
    if (element.title !== text) element.title = text;
  }

  static _wheel(event) {
    if (!(event.ctrlKey || event.metaKey) || !event.target.closest || !event.target.closest('#tdCanvas')) return;
    event.preventDefault();
    DesignView.zoom(event.deltaY < 0 ? this.ZOOM_STEP : -this.ZOOM_STEP);
  }

  /** Обработчики документа. */
  static listen() {
    document.addEventListener('click', event => DesignClicks.handle(event));
    document.addEventListener('input', event => DesignInputs.input(event));
    document.addEventListener('change', event => DesignInputs.change(event));
    document.addEventListener('keydown', event => DesignInputs.keydown(event));
    document.addEventListener('wheel', event => this._wheel(event), { passive: false });
    document.addEventListener('pointerdown', event => this._pointerDown(event));
    document.addEventListener('mouseover', event => this._hint(event));
    document.addEventListener('pointerdown', event => this._sortDown(event));
    // встроенное перетаскивание браузера (картинки, выделенный текст) перехватывало мышь, и объект «возвращался» на место
    document.addEventListener(
      'dragstart',
      event => {
        if (event.target.closest && event.target.closest('#tdPages, #tdCanvas')) event.preventDefault();
      },
      true,
    );
    addEventListener('resize', () => {
      if (Design.state.sel) DesignView.markSelection();
    });
    document.addEventListener(
      'scroll',
      event => {
        if (event.target && event.target.id === 'tdCanvas' && Design.state.sel && !Design.state.drag)
          DesignInspector.mini();
      },
      true,
    );
  }
}
