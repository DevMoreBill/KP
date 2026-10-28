import { esc } from './util.js';

/** Адрес из внешних данных (Битрикс24, фиды, проверка контрагентов) в ссылке — только сайт, не javascript: и не file:. */
export class SafeLink {
  static WEB = /^https?:\/\//i;

  /**
   * Адрес — сайт (http или https).
   * @param {string} url
   * @returns {boolean}
   */
  static web(url) {
    return this.WEB.test(String(url || '').trim());
  }

  /**
   * Значение для href: экранированный адрес сайта, иначе «#».
   * @param {string} url
   * @returns {string}
   */
  static href(url) {
    return this.web(url) ? esc(String(url).trim()) : '#';
  }
}
