import { $ } from '../../core/util.js';

/**
 * Прокрутка окна каталога. На ПК и планшете прокручивается список; на телефоне — всё окно (`.cw-main`): заголовок,
 * отбор и «Найдено» уходят вверх вместе со списком, строка поиска с «Фильтрами» остаётся у верхнего края.
 */
export class CatalogScroll {
  static observer = null;

  /**
   * Следить за высотой шапки окна: каталог открыт заново — шапка новая.
   * @param {HTMLDialogElement} dialog
   */
  static watch(dialog) {
    this.observer?.disconnect();
    const head = dialog.querySelector('.cw-h');
    if (!head) return;
    this.observer = new ResizeObserver(() => this._lift(dialog, head));
    this.observer.observe(head);
  }

  // насколько шапка уходит вверх: строка заголовка скрыта, строка поиска — на прежнем отступе от края окна
  static _lift(dialog, head) {
    const search = head.querySelector('.cw-q');
    const style = getComputedStyle(head);
    if (!search || !head.offsetHeight || style.position !== 'sticky') return;
    const lift = Math.max(0, search.offsetTop - parseFloat(style.paddingTop));
    dialog.style.setProperty('--cw-lift', `${lift}px`);
    dialog.style.setProperty('--cw-stuck', `${head.offsetHeight - lift}px`);
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
    if (!list || main === list) return;
    const stuck = parseFloat(getComputedStyle(main).scrollPaddingTop) || 0;
    const target = main.scrollTop + list.getBoundingClientRect().top - main.getBoundingClientRect().top - stuck;
    if (main.scrollTop > target) main.scrollTop = Math.max(0, target);
  }
}
