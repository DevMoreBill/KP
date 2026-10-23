import { Auth } from './auth.js';
import { Managers } from './managers.js';
import { Cabinet } from '../crm/cabinet.js';
import { FEAT } from '../../core/features.js';

/** Кабинет менеджера — главный экран: открывается при запуске (иное — «Мои настройки → Стартовый экран»). */
export class MyDay {
  /**
   * Кабинет включён в «Функциях».
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('myDay');
  }

  /** Кнопки кабинета — только когда функция включена. */
  static badge() {
    document.querySelectorAll('[data-a=myDay]').forEach(button => {
      button.hidden = !this.enabled();
    });
  }

  /**
   * Имя вошедшего или выбранного менеджера.
   * @returns {string}
   */
  static myName() {
    return (Auth.state.user && Auth.state.user.name) || Managers.meName() || '';
  }

  /**
   * Блок вкладки «Сегодня».
   * @param {string} title
   * @param {string} body
   * @param {string} [more]
   * @returns {string}
   */
  static section(title, body, more = '') {
    return `<section class="md-s"><div class="md-h"><p class="sub">${title}</p>${more}</div>${body}</section>`;
  }

  /** «Мой день» стал вкладкой «Сегодня» кабинета менеджера. */
  static open() {
    return Cabinet.open();
  }

  /**
   * При запуске: кабинет вместо каталога.
   * @returns {boolean} открыт
   */
  static start() {
    this.badge();
    if (this.enabled()) {
      this.open();
      return true;
    }
    return false;
  }
}
