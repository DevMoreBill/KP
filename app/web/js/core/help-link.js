import { FEAT } from './features.js';
import { esc } from './util.js';

/**
 * Кнопка «?» в шапке окна — руководство сразу на разделе об этом окне (HELP_SECTIONS). Щелчок обрабатывает HelpLinkClicks.
 */
export class HelpLink {
  /**
   * Кнопка (пусто, если функция выключена).
   * @param {string} section раздел руководства, например «econ»
   * @param {string} what о чём раздел — для подсказки
   * @param {string} [cls] классы кнопки окна
   * @returns {string}
   */
  static html(section, what, cls = 'icon') {
    if (!FEAT.on('ctxHelp')) return '';
    return `<button class="${esc(cls)} help-link" type="button" data-helpsec="${esc(section)}" title="Как пользоваться: ${esc(what)}" aria-label="Руководство: ${esc(what)}">?</button>`;
  }
}
