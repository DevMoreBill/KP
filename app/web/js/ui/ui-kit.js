import { esc } from '../core/util.js';
import { S } from '../core/state.js';
import { ObjPath } from '../core/str.js';
/** Общие элементы формы: подсказка «?» и поле ввода, привязанное к пути в данных КП. */
export class UiKit {
  // подписи, у которых «?» — прямо внутри: поле формы, заголовки разделов и блоков
  static TIP_HOSTS = '.f > span, h2, h3, .sub, .md-h > p, .dk-pb > p, legend';

  static AREA_ROWS = 3;

  /**
   * Подсказка «?»: пояснение открывается по нажатию и не занимает место в форме.
   * @param {string} html
   * @returns {string}
   */
  static tip(html) {
    return `<details class="tip"><summary title="Подсказка" aria-label="Подсказка">?</summary><div class="tip-b">${html}</div></details>`;
  }

  /** Подсказка «?» открывается и нажатием на саму подпись рядом — по маленькому кружку на телефоне попасть трудно. */
  static listenTips() {
    document.addEventListener('click', event => {
      const target = event.target;
      if (!target.closest || target.closest('details.tip, input, select, textarea, button, a')) return;
      const host = target.closest(this.TIP_HOSTS);
      const tip = host && [...host.children].find(child => child.matches('details.tip'));
      if (!tip) return;
      event.preventDefault();
      tip.open = !tip.open;
    });
  }

  /**
   * Поле ввода (или многострочное) для значения S по пути.
   * @param {string} label
   * @param {string} path путь в S («contact.name»)
   * @param {object} [opts] {req, area, rows, type, ph, list, cls}
   * @returns {string}
   */
  static field(label, path, opts = {}) {
    const value = ObjPath.get(S, path) ?? '';
    const req = opts.req ? ' class="req"' : '';
    return `<label class="f"><span${req}>${esc(label)}</span>${opts.area ? this._area(path, value, opts) : this._input(path, value, opts)}</label>`;
  }

  static _area(path, value, opts) {
    return `<textarea data-p="${path}" rows="${opts.rows || this.AREA_ROWS}" placeholder="${esc(opts.ph || '')}">${esc(value)}</textarea>`;
  }

  static _input(path, value, opts) {
    return `<input type="${opts.type || 'text'}" data-p="${path}" value="${esc(value)}" placeholder="${esc(opts.ph || '')}" ${opts.list ? `list="${opts.list}"` : ''} ${opts.cls ? `class="${opts.cls}"` : ''} autocomplete="off">`;
  }
}
