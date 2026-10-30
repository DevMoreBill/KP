import { esc } from './util.js';
/** Раскрывающийся блок <details>: помнит, раскрыт ли он (окно перерисовывается целиком). */
export class Spoiler {
  /** ключ → раскрыт (true / false), если менеджер менял сам */
  static open = new Map();

  /**
   * Атрибуты <details>: data-sp и open — по выбору менеджера, иначе по умолчанию.
   * @param {string} key
   * @param {boolean} [opened]
   * @returns {string}
   */
  static attr(key, opened = false) {
    const isOpen = this.open.has(key) ? this.open.get(key) : opened;
    return ` data-sp="${esc(key)}"${isOpen ? ' open' : ''}`;
  }

  /**
   * Запомнить, что менеджер раскрыл или свернул блок.
   * @param {HTMLDetailsElement} details
   */
  static toggle(details) {
    if (details && details.dataset && details.dataset.sp) this.open.set(details.dataset.sp, details.open);
  }

  /** Слушать раскрытие блоков на всей странице. */
  static listen() {
    document.addEventListener(
      'toggle',
      event => {
        if (event.target && event.target.matches && event.target.matches('details[data-sp]')) this.toggle(event.target);
      },
      true,
    );
  }
}
