/** Окно поверх всего: new Modal(html, класс); m.$(селектор), m.close(); закрытое окно удаляется со страницы. */
export class Modal {
  // окна, которые открываются после ответа сервера: повторный вызов, пока первый ещё идёт (двойной щелчок), пропускается
  static busy = new Set();

  /**
   * @param {string} html
   * @param {string} [cls] класс окна
   */
  constructor(html, cls = '') {
    const dialog = document.createElement('dialog');
    this.d = dialog;
    dialog.className = `st-confirm ${cls}`;
    dialog.innerHTML = html;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('cancel', () => this.close());
    dialog.addEventListener('close', () => dialog.remove());
  }

  /** Закрыть окно. */
  close() {
    if (this.d.open) this.d.close();
  }

  // eslint-disable-next-line kp/jsdoc, id-length -- прежнее имя, как у $ страницы: элемент окна по селектору
  $(selector) {
    return this.d.querySelector(selector);
  }

  /**
   * Выбор кнопкой data-v: обещание со значением нажатой кнопки; data-v="0" и Esc — null.
   * @param {string} html
   * @returns {Promise<string | null>}
   */
  static ask(html) {
    return new Promise(resolve => {
      const modal = new Modal(html);
      let value = null;
      modal.d.addEventListener('click', event => {
        const button = event.target.closest('[data-v]');
        if (!button) return;
        value = button.dataset.v === '0' ? null : button.dataset.v;
        modal.close();
      });
      modal.d.addEventListener('close', () => resolve(value));
    });
  }

  /**
   * Открыть окно один раз за раз: иначе двойной щелчок открывал два одинаковых окна (фон появляется после ответа сервера).
   * @param {string} key
   * @param {Function} open
   * @returns {Promise<*>}
   */
  static async once(key, open) {
    if (this.busy.has(key)) return undefined;
    this.busy.add(key);
    try {
      return await open();
    } finally {
      this.busy.delete(key);
    }
  }

  /**
   * Постоянное окно раздела (каталог, «Настройки», руководство…): создаётся при первом открытии и остаётся на странице;
   * init(окно) — один раз, при создании.
   * @param {string} id
   * @param {string} cls
   * @param {string} label
   * @param {Function} [init]
   * @returns {HTMLDialogElement}
   */
  static host(id, cls, label, init) {
    const found = document.getElementById(id);
    if (found) return found;
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = cls;
    dialog.setAttribute('aria-label', label);
    document.body.appendChild(dialog);
    if (init) init(dialog);
    return dialog;
  }
}

/**
 * Второй щелчок двойного щелчка, попавший в окно, которое открыл первый щелчок, — не нажатие: «Каталог» в шапке двойным
 * щелчком открывал ещё и «Новую позицию». Окна, открытые до первого щелчка, работают как прежде; клавиатура не затрагивается.
 */
export class DblClickGuard {
  static before = new Set();

  /** Обработчики страницы. */
  static listen() {
    document.addEventListener(
      'mousedown',
      event => {
        if (event.detail <= 1) this.before = new Set(document.querySelectorAll('dialog[open]'));
      },
      true,
    );
    const stop = event => this._stop(event);
    document.addEventListener('click', stop, true);
    document.addEventListener('dblclick', stop, true);
  }

  static _stop(event) {
    if (event.detail < 2) return;
    const dialog = event.target.closest && event.target.closest('dialog');
    if (dialog && !this.before.has(dialog)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }
}
