/** Общие элементы формы: подсказка «?» и поле ввода, привязанное к пути в данных КП. */
export class UiKit {
  static AREA_ROWS = 3;

  /**
   * Подсказка «?»: пояснение открывается по нажатию и не занимает место в форме.
   * @param {string} html
   * @returns {string}
   */
  static tip(html) {
    return `<details class="tip"><summary title="Подсказка" aria-label="Подсказка">?</summary><div class="tip-b">${html}</div></details>`;
  }

  /**
   * Поле ввода (или многострочное) для значения S по пути.
   * @param {string} label
   * @param {string} path путь в S («contact.name»)
   * @param {object} [opts] {req, area, rows, type, ph, list, cls}
   * @returns {string}
   */
  static field(label, path, opts = {}) {
    const value = getPath(S, path) ?? '';
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
