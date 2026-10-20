/** Короткое уведомление внизу экрана — поверх открытого окна: всё вне модального окна браузер прячет под затемнением. */
export class Toast {
  static SHOW_MS = 2600;

  /**
   * @param {string} text
   * @param {number} [delay] сколько показывать, мс
   */
  static show(text, delay = this.SHOW_MS) {
    const el = this._element();
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), delay);
  }

  // окно могло перерисоваться вместе с уведомлением
  static _element() {
    const found = document.querySelector('#toast');
    if (found) return found;
    const el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    return el;
  }
}
