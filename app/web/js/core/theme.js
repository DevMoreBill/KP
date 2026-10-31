import { $ } from './util.js';
// Тема оформления: светлая, тёмная или как в системе (выбор хранится в браузере).

/**
 * Светлая и тёмная тема: выбор хранится в браузере (и в «Моих настройках»); без выбора (auto) — как в системе;
 * time — по времени суток (тёмная вечером и ночью).
 */
export class Theme {
  static NAMES = ['light', 'dark', 'auto', 'time'];
  static NIGHT_FROM = 19; // часы тёмной темы «по времени суток» — как в boot.js
  static NIGHT_TO = 7;
  static RECHECK_MS = 300000;
  static timer = null;
  static SYSTEM = matchMedia('(prefers-color-scheme: dark)');
  static STORE = 'kp.theme';

  /**
   * Действующая тема.
   * @returns {'light' | 'dark'}
   */
  static current() {
    const theme = document.documentElement.dataset.theme;
    if (theme === 'dark' || theme === 'light') return theme;
    return this.SYSTEM.matches ? 'dark' : 'light';
  }

  /**
   * Выбрать тему: light, dark или auto (как в системе).
   * @param {string} theme
   */
  static set(theme) {
    clearInterval(this.timer);
    this.timer = null;
    const shown = theme === 'time' ? this.byTime() : theme;
    this._paint(shown);
    if (theme === 'time') this.timer = setInterval(() => this._paint(this.byTime()), this.RECHECK_MS);
    try {
      if (theme === 'light' || theme === 'dark' || theme === 'time') localStorage.setItem(this.STORE, theme);
      else localStorage.removeItem(this.STORE);
    } catch {
      // без хранилища браузера
    }
    this.paintButton();
  }

  /**
   * Тема по времени суток сейчас.
   * @returns {'light' | 'dark'}
   */
  static byTime() {
    const hour = new Date().getHours();
    return hour >= this.NIGHT_FROM || hour < this.NIGHT_TO ? 'dark' : 'light';
  }

  static _paint(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } else {
      delete root.dataset.theme;
      root.style.colorScheme = '';
    }
    this._statusBar();
  }

  // строка состояния телефона и панель браузера — цветом шапки программы в этой теме
  static _statusBar() {
    const meta = document.querySelector('meta[name="theme-color"]');
    const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    if (meta && card) meta.content = card;
  }

  /** Переключить светлую и тёмную (запомнят «Мои настройки» — событие kp:theme). */
  static toggle() {
    const theme = this.current() === 'dark' ? 'light' : 'dark';
    this.set(theme);
    document.dispatchEvent(new CustomEvent('kp:theme', { detail: { theme } }));
  }

  /** Надпись пункта меню — тема, на которую переключит. */
  static paintButton() {
    $('#btnTheme').textContent = this.current() === 'dark' ? '☀  Светлая тема' : '☾  Тёмная тема';
  }

  /** Обработчики: пункт меню и смена темы системы. */
  static listen() {
    try {
      if (localStorage.getItem(this.STORE) === 'time') this.set('time');
    } catch {
      // без хранилища браузера
    }
    $('#btnTheme').addEventListener('click', () => Theme.toggle());
    this.SYSTEM.addEventListener('change', () => {
      Theme.paintButton();
      Theme._statusBar();
    });
    this.paintButton();
    this._statusBar();
  }
}
