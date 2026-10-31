/** Число из поля ввода: пробелы между разрядами, запятая; null — пусто, NaN — ошибка ввода. */
export class InputNum {
  static NUMBER = /^-?\d*\.?\d+$/;

  /**
   * Разобрать число из поля.
   * @param {*} value
   * @returns {number|null} null — пусто, NaN — не число
   */
  static parse(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const text = String(value)
      .replace(/[\s\u00a0]/g, '')
      .replace(',', '.');
    if (!text) return null;
    return this.NUMBER.test(text) ? +text : NaN;
  }
}
