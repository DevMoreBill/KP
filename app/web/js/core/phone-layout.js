/** Телефонная раскладка: класс «mob» у <html> — ставит форма (ui/mobile.js) по ширине экрана. */
export class PhoneLayout {
  static CLASS = 'mob';

  /**
   * Телефонная раскладка включена.
   * @returns {boolean}
   */
  static active() {
    return document.documentElement.classList.contains(this.CLASS);
  }
}
