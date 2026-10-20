import { Auth } from './auth.js';
import { Managers } from './managers.js';

/** Кабинет менеджера — первый экран при запуске («Показывать при запуске» — настройка этого браузера). */
export class MyDay {
  static KEY = 'kp.myday.off';
  static GREETINGS = [
    [5, 'Доброй ночи'],
    [12, 'Доброе утро'],
    [18, 'Добрый день'],
    [24, 'Добрый вечер'],
  ];

  /**
   * Кабинет включён в «Функциях».
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('myDay');
  }

  /**
   * Открывать кабинет при запуске (этот браузер).
   * @returns {boolean}
   */
  static atStart() {
    try {
      return localStorage.getItem(this.KEY) !== '1';
    } catch {
      return true;
    }
  }

  /**
   * Запомнить «открывать при запуске».
   * @param {boolean} value
   */
  static setAtStart(value) {
    try {
      if (value) localStorage.removeItem(this.KEY);
      else localStorage.setItem(this.KEY, '1');
    } catch {
      // без хранилища — каждый раз как по умолчанию
    }
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
   * Приветствие по времени суток.
   * @returns {string}
   */
  static hello() {
    const hour = new Date().getHours();
    return this.GREETINGS.find(([until]) => hour < until)[1];
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
    if (this.enabled() && this.atStart()) {
      this.open();
      return true;
    }
    return false;
  }
}
