/** Миллиметры и прочие целые для текста: 12345 → «12 345». */
export class Mm {
  /**
   * @param {number} v
   * @returns {string}
   */
  static text(v) {
    const digits = String(Math.round(v));
    return digits.length < 4 ? digits : digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** 0.75 → «0,75» */
  static dec(v) {
    return String(v).replace('.', ',');
  }

  /** Миллиметры → метры. */
  static meters(v) {
    return v / 1000;
  }
}
