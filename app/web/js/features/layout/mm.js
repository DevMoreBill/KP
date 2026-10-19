/** Миллиметры и прочие целые для текста: 12345 → «12 345». */
export class Mm {
  /**
   * @param {number} v
   * @returns {string}
   */
  static text(v) {
    const s = String(Math.round(v));
    return s.length < 4 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** 0.75 → «0,75» */
  static dec(v) {
    return String(v).replace('.', ',');
  }
}
