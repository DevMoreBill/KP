/** Логистика: короткие помощники показа — метры, тонны, рубли, число для поля; поставщик в России. */
export class LgFmt {
  static HUNDRED = 100;
  static TEN = 10;
  static THOUSAND = 1000;

  /**
   * Метры: 2,55.
   * @param {number} value
   * @returns {string}
   */
  static meters(value) {
    return (Math.round(value * LgFmt.HUNDRED) / LgFmt.HUNDRED).toString().replace('.', ',');
  }

  /**
   * Тонны: 12,4.
   * @param {number} value
   * @returns {string}
   */
  static tons(value) {
    return (Math.round(value * LgFmt.TEN) / LgFmt.TEN).toString().replace('.', ',');
  }

  /**
   * Рубли; не посчитано (нет адресов, груза) — прочерк.
   * @param {number} value
   * @returns {string}
   */
  static rub(value) {
    return Money.rub(value);
  }

  /**
   * Число для поля ввода: запятая, до тысячных.
   * @param {*} value
   * @returns {string}
   */
  static num(value) {
    return value == null || value === ''
      ? ''
      : String(Math.round(value * LgFmt.THOUSAND) / LgFmt.THOUSAND).replace('.', ',');
  }

  /**
   * Поставщик в России.
   * @param {object} sup
   * @returns {boolean}
   */
  static isRu(sup) {
    return /^росс/i.test(sup.country || '') || sup.where === 'ru';
  }

  /**
   * Текст для сравнения.
   * @param {*} text
   * @returns {string}
   */
  static norm(text) {
    return String(text ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Десятичное с запятой.
   * @param {*} value
   * @returns {string}
   */
  static comma(value) {
    return String(value).replace('.', ',');
  }
}
