import { CabLayout } from './cab-layout.js';

/**
 * Разделы карточки сделки: своё расположение менеджера (CabLayout, страница «deal») или как в программе — сводка и
 * «Что сделать сейчас» сверху, вкладки слева, лента справа (на телефоне лента — вкладкой).
 */
export class DealLayout {
  /**
   * Тело карточки.
   * @param {{sum: string, now: string, main: string, feed: string}} parts разметка разделов
   * @param {{feedTab: boolean}} view лента — вкладкой (телефон)
   * @returns {string}
   */
  static html(parts, view) {
    if (CabLayout.enabled('dealLayout') && !view.feedTab) return CabLayout.html('deal', parts);
    const side = view.feedTab ? '' : `<div class="dk-side">${parts.feed}</div>`;
    return `${parts.sum}${parts.now}<div class="dk-cols">${parts.main}${side}</div>`;
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
