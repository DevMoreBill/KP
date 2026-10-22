import { esc } from './util.js';

/**
 * Вкладки разделов сверху экрана (на телефоне — нижняя панель): постоянные (КП, Кабинет, Каталог, Журнал) и «по месту»
 * (Экономика сделки, позиция или станция, Настройки — пока открыты). Окно раздела — страница под полосой вкладок: при
 * переключении оно прячется, а не закрывается, поэтому набранное и открытое в нём остаётся.
 */
export class AppTabs {
  static HOME = 'kp';
  static OVERLAY = 'authWrap';
  static KEYS = 9;
  static specs = new Map();
  static dialogs = new Map();
  static titles = new Map();
  static counts = new Map();
  static active = AppTabs.HOME;
  static trail = [];

  /**
   * Раздел для полосы вкладок.
   * @param {string} key
   * @param {{label: string|Function, short?: string, icon: string, fixed?: boolean, open?: Function, shown?: Function}} spec
   *   short — подпись на телефоне; fixed — вкладка видна всегда; open — открыть раздел; shown — раздел доступен (функция включена)
   */
  static register(key, spec) {
    this.specs.set(key, spec);
    this.render();
  }

  /**
   * Показать окно раздела страницей-вкладкой (вместо окна поверх всего).
   * @param {HTMLDialogElement} dialog
   * @param {string} key
   * @param {string} [title] подпись вкладки «по месту» (например, название позиции)
   */
  static show(dialog, key, title) {
    if (this._overlaid()) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (title) this.titles.set(key, title);
    if (this.dialogs.get(key) !== dialog) {
      this.dialogs.set(key, dialog);
      dialog.addEventListener('close', () => this._closed(key, dialog));
    }
    dialog.classList.add('tabwin');
    dialog.dataset.apptab = key;
    if (!dialog.open) dialog.show();
    this._activate(key);
  }

  /**
   * Перейти на вкладку: открытый раздел — показать как есть, закрытый — открыть.
   * @param {string} key
   */
  static open(key) {
    if (key === this.HOME || this._isOpen(key)) {
      this._activate(key);
      return;
    }
    const spec = this.specs.get(key);
    if (spec && spec.open) spec.open();
  }

  /**
   * Окно видно сейчас (открыто и его вкладка выбрана).
   * @param {HTMLDialogElement|null} dialog
   * @returns {boolean}
   */
  static visible(dialog) {
    return !!dialog && dialog.open && !dialog.classList.contains('tab-off');
  }

  /**
   * Закрыть вкладку «по месту» (окно раздела закрывается как прежде — своей кнопкой).
   * @param {string} key
   */
  static close(key) {
    const dialog = this.dialogs.get(key);
    if (dialog && dialog.open) dialog.close();
  }

  // экран входа закрывает всю страницу: окно («Вход администратора» → «Настройки») — только поверх него
  static _overlaid() {
    return !!document.getElementById(this.OVERLAY);
  }

  static _isOpen(key) {
    const dialog = this.dialogs.get(key);
    return !!dialog && dialog.open;
  }

  static _activate(key) {
    if (key !== this.active) {
      this.trail = [...this.trail.filter(one => one !== key), this.active];
      this.active = key;
    }
    for (const [tab, dialog] of this.dialogs) dialog.classList.toggle('tab-off', tab !== key);
    document.body.classList.toggle('tab-other', key !== this.HOME);
    this.render();
  }

  static _closed(key, dialog) {
    dialog.classList.remove('tabwin', 'tab-off');
    this.titles.delete(key);
    this.trail = this.trail.filter(one => one !== key);
    if (this.active === key) {
      const back = [...this.trail].reverse().find(one => one === this.HOME || this._isOpen(one)) || this.HOME;
      this.active = '';
      this._activate(back);
      return;
    }
    this.render();
  }

  static _tabs() {
    return [...this.specs.entries()].filter(
      ([key, spec]) => (!spec.shown || spec.shown()) && (spec.fixed || key === this.HOME || this._isOpen(key)),
    );
  }

  /**
   * Число на вкладке (например, дела на сегодня в кабинете); 0 — без числа.
   * @param {string} key
   * @param {number} value
   * @param {string} [tone] 'bad' — красное (есть просроченное)
   */
  static count(key, value, tone = '') {
    const was = this.counts.get(key);
    if (was && was.value === value && was.tone === tone) return;
    this.counts.set(key, { value, tone });
    this.render();
  }

  static _label(key, spec) {
    const phone = document.documentElement.classList.contains('mob');
    const label = typeof spec.label === 'function' ? spec.label() : spec.label;
    if (phone && spec.short) return spec.short;
    return this.titles.get(key) || label;
  }

  static _badge(key) {
    const found = this.counts.get(key);
    if (!found || !found.value) return '';
    return `<b class="apt-n${found.tone ? ` ${found.tone}` : ''}">${found.value}</b>`;
  }

  /** Перерисовать полосу вкладок. */
  static render() {
    const bar = this._bar();
    if (!bar) return;
    bar.innerHTML = this._tabs()
      .map(([key, spec], index) => {
        const current = key === this.active;
        const closer =
          spec.fixed || key === this.HOME ? '' : `<span class="apt-x" data-tabx="${esc(key)}" title="Закрыть">✕</span>`;
        const label = esc(this._label(key, spec));
        const hint = index < this.KEYS ? ` (Alt+${index + 1})` : '';
        return `<button type="button" class="apt-t${current ? ' on' : ''}" data-tab="${esc(key)}" aria-current="${current ? 'page' : 'false'}" title="${label}${hint}"><i aria-hidden="true">${spec.icon}</i><span>${label}</span>${this._badge(key)}${closer}</button>`;
      })
      .join('');
  }

  static _bar() {
    const header = document.querySelector('header.top');
    if (!header) return null;
    let bar = document.getElementById('appTabs');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'appTabs';
      bar.className = 'apptabs';
      bar.setAttribute('aria-label', 'Разделы');
      bar.addEventListener('click', event => this._click(event));
      document.addEventListener('keydown', event => this._key(event));
      new ResizeObserver(() => this._measure()).observe(header);
    }
    this._place(bar, header);
    return bar;
  }

  // ПК — в шапке после названия программы; телефон — нижняя панель (шапка там уезжает при прокрутке)
  static _place(bar, header) {
    const phone = document.documentElement.classList.contains('mob');
    if (phone && bar.parentElement !== document.body) document.body.appendChild(bar);
    if (!phone && bar.parentElement !== header) header.querySelector('.brand')?.after(bar);
  }

  static _key(event) {
    if (this._digit(event)) return;
    this._escape(event);
  }

  // Alt+1…9 — вкладка по порядку
  static _digit(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || !/^Digit[1-9]$/.test(event.code)) return false;
    const found = this._tabs()[Number(event.code.slice(-1)) - 1];
    if (!found || document.querySelector('dialog[open]:modal')) return false;
    event.preventDefault();
    this.open(found[0]);
    return true;
  }

  // Esc во вкладке — как в окне поверх всего: окно может отменить (событие cancel), иначе закрывается
  static _escape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]:modal')) return;
    const dialog = this.dialogs.get(this.active);
    if (!this.visible(dialog)) return;
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) dialog.close();
  }

  static _click(event) {
    const closer = event.target.closest('[data-tabx]');
    if (closer) {
      event.stopPropagation();
      this.close(closer.dataset.tabx);
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) this.open(tab.dataset.tab);
  }

  // высота шапки — откуда начинаются страницы-вкладки
  static _measure() {
    const header = document.querySelector('header.top');
    if (header)
      document.documentElement.style.setProperty('--apptop', `${Math.round(header.getBoundingClientRect().bottom)}px`);
  }
}
