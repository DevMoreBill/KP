/** Округление чисел расчёта и общие действия над списками. */
export class Num {
  /**
   * До 1/k: round(1.234, 100) → 1.23.
   * @param {number} value
   * @param {number} k
   * @returns {number}
   */
  static round(value, k) {
    return Math.round(value * k) / k;
  }

  /**
   * До кратного step: roundTo(1234, 10) → 1230.
   * @param {number} value
   * @param {number} step
   * @returns {number}
   */
  static roundTo(value, step) {
    return Math.round(value / step) * step;
  }

  /**
   * Сумма списка.
   * @param {number[]} list
   * @returns {number}
   */
  static sum(list) {
    return list.reduce((acc, value) => acc + value, 0);
  }

  /**
   * Без повторов, в прежнем порядке.
   * @template T
   * @param {T[]} list
   * @returns {T[]}
   */
  static uniq(list) {
    return [...new Set(list)];
  }
}
