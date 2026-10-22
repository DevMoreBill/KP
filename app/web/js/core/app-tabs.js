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
   * @param {{label: string|Function, short?: string, icon: string, fixed?: boolean, open?: Function, shown?: Function,
   *   many?: Function, pick?: Function, drop?: Function, add?: Function, roomy?: Function, menu?: Function}} spec
   *   short — подпись на телефоне; fixed — вкладка видна всегда; open — открыть раздел; shown — раздел доступен (функция включена);
   *   many … menu — у КП: открытые КП вкладками (на телефоне — список по повторному нажатию)
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
    const buttons = this._tabs().flatMap(([key, spec]) => this._buttons(key, spec));
    bar.innerHTML = buttons
      .map((html, index) => html.replace('{hint}', index < this.KEYS ? ` (Alt+${index + 1})` : ''))
      .join('');
  }

  // кнопки раздела; КП на ПК — по вкладке на каждое открытое КП и «＋»
  static _buttons(key, spec) {
    const phone = document.documentElement.classList.contains('mob');
    if (key === this.HOME && spec.many && !phone) return this._kpButtons(spec);
    const current = key === this.active;
    const closer =
      spec.fixed || key === this.HOME ? '' : `<span class="apt-x" data-tabx="${esc(key)}" title="Закрыть">✕</span>`;
    const label = esc(this._label(key, spec));
    const badge = key === this.HOME && spec.many ? this._many(spec) : this._badge(key);
    return [
      `<button type="button" class="apt-t${current ? ' on' : ''}" data-tab="${esc(key)}" aria-current="${current ? 'page' : 'false'}" title="${label}{hint}"><i aria-hidden="true">${spec.icon}</i><span>${label}</span>${badge}${closer}</button>`,
    ];
  }

  static _kpButtons(spec) {
    const items = spec.many();
    const tabs = items.map(item => {
      const current = this.active === this.HOME && item.on;
      const label = esc(item.label);
      const closer =
        items.length > 1 || item.full
          ? `<span class="apt-x" data-kpx="${esc(item.uid)}" title="Закрыть КП">✕</span>`
          : '';
      return `<button type="button" class="apt-t apt-kp${current ? ' on' : ''}${item.on ? ' kp-on' : ''}" data-tab="${this.HOME}" data-kpu="${esc(item.uid)}" aria-current="${current ? 'page' : 'false'}" title="${label}${item.title ? ` — ${esc(item.title)}` : ''}{hint}"><i aria-hidden="true">${spec.icon}</i><span>${label}</span>${closer}</button>`;
    });
    if (spec.roomy && spec.roomy()) {
      tabs.push(
        '<button type="button" class="apt-add" data-kpadd title="Новое КП в новой вкладке" aria-label="Новое КП в новой вкладке">＋</button>',
      );
    }
    return tabs;
  }

  // телефон: сколько КП открыто (больше одного)
  static _many(spec) {
    const count = spec.many().length;
    return count > 1 ? `<b class="apt-n">${count}</b>` : '';
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

  // Alt+1…9 — вкладка по порядку (как в полосе: у каждого КП — своя)
  static _digit(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || !/^Digit[1-9]$/.test(event.code)) return false;
    const bar = document.getElementById('appTabs');
    const button = bar && bar.querySelectorAll('.apt-t')[Number(event.code.slice(-1)) - 1];
    if (!button || document.querySelector('dialog[open]:modal')) return false;
    event.preventDefault();
    button.click();
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
    if (this._kpClick(event)) return;
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    const spec = this.specs.get(tab.dataset.tab);
    if (tab.dataset.tab === this.HOME && this.active === this.HOME && spec && spec.menu && !tab.dataset.kpu) {
      spec.menu();
      return;
    }
    this.open(tab.dataset.tab);
  }

  // вкладки КП: перейти, закрыть, новое
  static _kpClick(event) {
    const spec = this.specs.get(this.HOME);
    if (!spec || !spec.many) return false;
    const drop = event.target.closest('[data-kpx]');
    const pick = event.target.closest('[data-kpu]');
    if (event.target.closest('[data-kpadd]')) spec.add();
    else if (drop) {
      event.stopPropagation();
      spec.drop(drop.dataset.kpx);
    } else if (pick && !pick.classList.contains('kp-on')) spec.pick(pick.dataset.kpu);
    else return false;
    return true;
  }

  // высота шапки — откуда начинаются страницы-вкладки
  static _measure() {
    const header = document.querySelector('header.top');
    if (header)
      document.documentElement.style.setProperty('--apptop', `${Math.round(header.getBoundingClientRect().bottom)}px`);
  }
}
