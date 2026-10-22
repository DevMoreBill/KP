/** Крупный режим на этом устройстве (меню «Ещё» на телефоне): крупнее текст и кнопки; включается до отрисовки (boot.js). */
export class BigMode {
  static STORE = 'kp.big';

  /**
   * Включён ли.
   * @returns {boolean}
   */
  static active() {
    return document.documentElement.classList.contains('big');
  }

  /** Включить или выключить. */
  static toggle() {
    const next = !this.active();
    document.documentElement.classList.toggle('big', next);
    try {
      if (next) localStorage.setItem(this.STORE, '1');
      else localStorage.removeItem(this.STORE);
    } catch {
      // без хранилища браузера — до перезагрузки
    }
  }
}
