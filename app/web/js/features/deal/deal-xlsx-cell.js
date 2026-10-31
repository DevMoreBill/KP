/** Ячейки листов Excel экономики: пояснение, число, заголовок группы. */
export class DealXlsxCell {
  static GRP = [
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
  ];

  /**
   * Ячейка пояснения.
   * @param {string} text
   * @returns {object}
   */
  static note(text) {
    return { v: text, s: 'note' };
  }

  /**
   * Число или 0.
   * @param {number} value
   * @returns {number}
   */
  static num(value) {
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * Строка-заголовок группы.
   * @param {string} title
   * @returns {object[]}
   */
  static group(title) {
    return [{ v: title, s: 'grp' }, ...DealXlsxCell.GRP.map(cell => ({ ...cell }))];
  }
}
