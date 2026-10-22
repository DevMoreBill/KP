import { AdminSession } from './net.js';
import { esc } from './util.js';

/**
 * ⚙ в окнах менеджера — видна только после входа администратора в «Настройки»: открывает параметры, которые действуют
 * в этом окне (раздел «Параметров», нормы станций, тарифы). Щелчок обрабатывает AdminGearClicks.
 */
export class AdminGear {
  /**
   * Кнопка (пусто, если администратор не вошёл).
   * @param {string} where ключ вкладки «Настроек», например «params:deal»
   * @param {string} what что настраивается — для подсказки
   * @returns {string}
   */
  static html(where, what) {
    if (!AdminSession.on) return '';
    return `<button class="icon adm-gear" type="button" data-admgear="${esc(where)}" title="Параметры: ${esc(what)} (видно только администратору)" aria-label="Параметры: ${esc(what)}">⚙</button>`;
  }
}
