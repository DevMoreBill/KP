import { FEAT } from '../core/features.js';
import { esc } from '../core/util.js';
import { CopyText } from '../core/files.js';
import { Toast } from '../core/toast.js';
import { HelpWindow } from '../features/kp/help-window.js';
import { Mobile } from './mobile.js';

/**
 * Своё меню по правой кнопке мыши: у каждого места программы — свои действия (разделы регистрирует ContextSections).
 * Меню браузера остаётся в полях ввода и по Shift + правая кнопка; на телефоне и планшете меню нет.
 */
export class ContextMenu {
  static FIELD =
    'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,select,[contenteditable="true"],[contenteditable=""]';
  static CLICKABLE = 'button,a[href],a.btn,[role="menuitem"],[role="tab"]';
  // «?» руководства и ⚙ параметров — уже есть пунктом «Как пользоваться этим разделом» и в «Настройках»
  static SKIP = '[data-helpsec],[data-admgear]';
  static HEADING = 'h1,h2,h3';
  static COPY_LABEL = 'Копировать';
  static MARGIN = 8;
  static LABEL_MAX = 60;
  static COPY_MIN = 2;
  static COPY_MAX = 80;
  static WORD = /[a-zа-яё]{3}/i;
  static sections = [];
  static box = null;
  static buttons = [];

  /**
   * Добавить раздел: где (селектор) и какие действия.
   * @param {{sel: string, title?: function(Element): string, prepare?: function(Element): void,
   *   items: function(Element): object[], help?: string}} section
   */
  static register(section) {
    this.sections.push(section);
  }

  /** Обработчики страницы. */
  static listen() {
    document.addEventListener('contextmenu', event => this._open(event));
    document.addEventListener(
      'pointerdown',
      event => {
        if (this.box && !this.box.contains(event.target)) this.close();
      },
      true,
    );
    document.addEventListener('keydown', event => this._key(event), true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
    document.addEventListener('scroll', () => this.close(), true);
  }

  static _off(event) {
    if (!FEAT.on('ctxMenu') || event.shiftKey || Mobile.isPhone()) return true;
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return true;
    return !!(event.target.closest && event.target.closest(this.FIELD));
  }

  static _open(event) {
    if (this._off(event)) {
      this.close();
      return;
    }
    const target = event.target;
    const found = this._match(target);
    if (found && found.section.prepare) found.section.prepare(found.el);
    const own = found ? found.section.items(found.el).filter(Boolean) : [];
    // у раздела свои «Копировать номер / клиента» — текст под курсором не дублируем (кроме выделенного)
    const copies = own.some(item => item.label.startsWith(this.COPY_LABEL)) ? this._picked() : this._copy(target);
    const groups = [own, copies, this._global(found && found.section.help)].filter(group => group.length);
    event.preventDefault();
    const title = found && found.section.title ? found.section.title(found.el) : '';
    this._show(groups, title, this._point(event, target));
  }

  static _match(target) {
    for (const section of this.sections) {
      const el = target.closest(section.sel);
      if (el) return { section, el };
    }
    return null;
  }

  // клавиша «меню» на клавиатуре — у элемента, а не в углу экрана
  static _point(event, target) {
    if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
    const rect = target.getBoundingClientRect();
    return { x: rect.left + this.MARGIN, y: rect.bottom };
  }

  /**
   * Подпись кнопки для меню: текст, иначе подсказка (для «✕», «↑» и т. п.).
   * @param {Element} el
   * @returns {string}
   */
  static label(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const spoken = el.getAttribute('aria-label') || (el.getAttribute('title') || '').split(/ — |\. /)[0];
    const label = this.WORD.test(text) ? text : spoken || text;
    return label.length > this.LABEL_MAX ? `${label.slice(0, this.LABEL_MAX - 1)}…` : label;
  }

  static _visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /**
   * Кнопки места — пунктами меню (нажатие пункта нажимает кнопку).
   * @param {Element|null} scope
   * @param {string} selector
   * @param {{hidden?: boolean}} [opts] hidden — брать и скрытые (пункты закрытого меню «⋯»)
   * @returns {object[]}
   */
  static harvest(scope, selector, opts = {}) {
    if (!scope) return [];
    return [...scope.querySelectorAll(selector)]
      .filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.matches(this.SKIP))
      .filter(el => opts.hidden || this._visible(el))
      .map(el => ({ label: this.label(el), act: () => el.click() }))
      .filter(item => item.label);
  }

  /**
   * Пункт, нажимающий кнопку по селектору (если она есть на странице).
   * @param {string} label
   * @param {string} selector
   * @param {Element|Document} [scope]
   * @returns {object|null}
   */
  static press(label, selector, scope = document) {
    const el = scope.querySelector(selector);
    return el && !el.disabled ? { label, act: () => el.click() } : null;
  }

  // «Копировать …» — короткий текст под курсором (номер, ИНН, название, телефон)
  static _picked() {
    const picked = (window.getSelection && String(window.getSelection())).trim();
    return picked ? [{ label: 'Копировать выделенное', act: () => this._copyText(picked) }] : [];
  }

  static _copy(target) {
    const picked = this._picked();
    if (picked.length) return picked;
    const node = target.closest('b,strong,span,td,a,h4,small,p,label,div');
    const plain = node && !node.querySelector(this.CLICKABLE) && !target.closest(this.HEADING);
    const text = plain ? (node.innerText || '').trim() : '';
    if (text.length < this.COPY_MIN || text.length > this.COPY_MAX || text.includes('\n')) return [];
    return [{ label: `Копировать «${text}»`, act: () => this._copyText(text) }];
  }

  /**
   * Пункт «Копировать …» с заданным текстом (пусто — пункта нет).
   * @param {string} label
   * @param {string} text
   * @returns {object|null}
   */
  static copyItem(label, text) {
    return text ? { label, act: () => this._copyText(text) } : null;
  }

  static async _copyText(text) {
    Toast.show((await CopyText.copy(text)) ? 'Скопировано' : 'Не удалось скопировать');
  }

  static _global(help) {
    return [
      this.press('Новое КП', '#btnNew'),
      this.press('Найти… (Ctrl+K)', 'header [data-a=find]'),
      { label: 'Как пользоваться этим разделом', act: () => HelpWindow.open(help || 'start') },
    ].filter(Boolean);
  }

  static _html(groups, title) {
    let index = 0;
    const blocks = groups.map(group =>
      group
        .map(
          item =>
            `<button type="button" role="menuitem" class="ctxm-i" data-ci="${index++}">${esc(item.label)}</button>`,
        )
        .join(''),
    );
    const head = title ? `<div class="ctxm-h">${esc(title)}</div>` : '';
    return `${head}${blocks.join('<div class="ctxm-sep" role="separator"></div>')}<div class="ctxm-f">Меню браузера — Shift + правая кнопка</div>`;
  }

  static _show(groups, title, point) {
    this.close();
    const items = groups.flat();
    const box = document.createElement('div');
    box.className = 'ctxm';
    box.setAttribute('role', 'menu');
    box.innerHTML = this._html(groups, title);
    box.addEventListener('click', event => {
      const button = event.target.closest('[data-ci]');
      if (!button) return;
      const item = items[+button.dataset.ci];
      this.close();
      item.act();
    });
    this._mount(box);
    this.box = box;
    this.buttons = [...box.querySelectorAll('[data-ci]')];
    this._place(box, point);
    this.buttons[0]?.focus({ preventScroll: true });
  }

  // поверх открытых окон: popover (верхний слой), иначе — внутрь открытого окна
  static _mount(box) {
    if (typeof box.showPopover === 'function') {
      box.setAttribute('popover', 'manual');
      document.body.append(box);
      box.showPopover();
      return;
    }
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).append(box);
  }

  static _place(box, point) {
    const rect = box.getBoundingClientRect();
    const x = Math.max(this.MARGIN, Math.min(point.x, innerWidth - rect.width - this.MARGIN));
    const y = point.y + rect.height + this.MARGIN > innerHeight ? point.y - rect.height : point.y;
    box.style.left = `${x}px`;
    box.style.top = `${Math.max(this.MARGIN, y)}px`;
  }

  /** Закрыть меню. */
  static close() {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.buttons = [];
  }

  static _key(event) {
    if (!this.box) return;
    const moves = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (moves[event.key]) {
      event.preventDefault();
      const pos = this.buttons.indexOf(document.activeElement);
      const next = (pos + moves[event.key] + this.buttons.length) % this.buttons.length;
      this.buttons[next].focus();
    }
  }
}
