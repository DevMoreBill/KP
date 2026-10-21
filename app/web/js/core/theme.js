import { $ } from './util.js';
import { MyPrefs } from '../features/kp/my-prefs.js';
// Тема оформления: светлая, тёмная или как в системе (выбор хранится в браузере).

/** Светлая и тёмная тема: выбор хранится в браузере (и в «Моих настройках»); без выбора (auto) — как в системе. */
export class Theme {
  static NAMES = ['light', 'dark', 'auto'];
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
    const root = document.documentElement;
    const fixed = theme === 'light' || theme === 'dark';
    if (fixed) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } else {
      delete root.dataset.theme;
      root.style.colorScheme = '';
    }
    try {
      if (fixed) localStorage.setItem(this.STORE, theme);
      else localStorage.removeItem(this.STORE);
    } catch {
      // без хранилища браузера
    }
    this.paintButton();
  }

  /** Переключить светлую и тёмную (и запомнить в «Моих настройках»). */
  static toggle() {
    const theme = this.current() === 'dark' ? 'light' : 'dark';
    this.set(theme);
    MyPrefs.rememberTheme(theme);
  }

  /** Надпись пункта меню — тема, на которую переключит. */
  static paintButton() {
    $('#btnTheme').textContent = this.current() === 'dark' ? '☀  Светлая тема' : '☾  Тёмная тема';
  }

  /** Обработчики: пункт меню и смена темы системы. */
  static listen() {
    $('#btnTheme').addEventListener('click', () => Theme.toggle());
    this.SYSTEM.addEventListener('change', () => Theme.paintButton());
    this.paintButton();
  }
}
