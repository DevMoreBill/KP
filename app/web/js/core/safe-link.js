import { esc } from './util.js';

/** Адрес из внешних данных (Битрикс24, фиды, проверка контрагентов) в ссылке — только сайт, не javascript: и не file:. */
export class SafeLink {
  static WEB = /^https?:\/\//i;
  static OWN = /^(\/(?!\/)|blob:|data:(image\/(png|jpe?g|gif|webp)|application\/pdf)[;,])/i;

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

  /**
   * Значение для href файла программы: сайт, адрес на этом сервере (/img/…), blob: или data: картинки и PDF; иначе «#».
   * @param {string} url
   * @returns {string}
   */
  static file(url) {
    const text = String(url || '').trim();
    return this.web(text) || this.OWN.test(text) ? esc(text) : '#';
  }
}
