import { CabLayout } from './cab-layout.js';

/**
 * Разделы карточки сделки: сводка (полоса стадий, сумма, дата) — всегда во всю ширину под шапкой; ниже — своё
 * расположение менеджера (CabLayout, страница «deal») или как в программе — «Что сделать сейчас», вкладки слева, лента
 * справа (на телефоне лента — вкладкой).
 */
export class DealLayout {
  /**
   * Тело карточки.
   * @param {{sum: string, now: string, main: string, feed: string}} parts разметка разделов
   * @param {{feedTab: boolean}} view лента — вкладкой (телефон)
   * @returns {string}
   */
  static html(parts, view) {
    const { sum, ...rest } = parts;
    if (CabLayout.enabled('dealLayout') && !view.feedTab) return `${sum}${CabLayout.html('deal', rest)}`;
    const side = view.feedTab ? '' : `<div class="dk-side">${rest.feed}</div>`;
    return `${sum}${rest.now}<div class="dk-cols">${rest.main}${side}</div>`;
  }

  /**
   * Перетаскивание и размеры разделов — один раз на окно карточки.
   * @param {HTMLElement} box
   * @param {Function} redraw
   */
  static bind(box, redraw) {
    CabLayout.bind(box, 'deal', redraw);
  }
}
