import { StickyHead } from '../../core/sticky-head.js';
import { $ } from '../../core/util.js';

/**
 * Прокрутка окна каталога. На ПК и планшете прокручивается список; на телефоне — всё окно (`.cw-main`): заголовок,
 * отбор и «Найдено» уходят вверх вместе со списком, строка поиска с «Фильтрами» остаётся у верхнего края.
 */
export class CatalogScroll {
  static HEAD = { head: '.cw-h', keep: '.cw-q', prefix: '--cw' };

  /**
   * Следить за высотой шапки окна: каталог открыт заново — шапка новая.
   * @param {HTMLDialogElement} dialog
   */
  static watch(dialog) {
    StickyHead.watch(dialog, this.HEAD);
  }

  /** В начало списка: новый отбор или сортировка. */
  static start() {
    const list = $('#cwList');
    if (list) list.scrollTop = 0;
    this.results();
  }

  /**
   * Что прокручивается вместе со списком: на телефоне — всё окно, иначе — сам список.
   * @returns {HTMLElement|null}
   */
  static box() {
    const main = $('#catdlg .cw-main');
    return main && getComputedStyle(main).overflowY !== 'visible' ? main : $('#cwList');
  }

  /** Телефон: первая строка списка — сразу под строкой поиска; если верх окна виден, прокрутка остаётся. */
  static results() {
    const main = this.box();
    const list = $('#cwList');
    if (list && main !== list) StickyHead.reveal(main, list);
  }
}
