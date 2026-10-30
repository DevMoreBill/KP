/**
 * Налогообложение продавца — по «НДС продавца» юрлица («Наши реквизиты»): ОСНО и экспорт 0 % — входной НДС к вычету; УСН
 * с НДС 5 или 7 % и «без НДС» — вычета нет, входной НДС остаётся в себестоимости (НК РФ, ст. 164 п. 8, ст. 170 п. 2).
 */
export class SellerTax {
  static NO_VAT = 'без НДС';
  /** Значение поля «НДС продавца» и подпись режима; пусто — ОСНО со ставкой как в КП. */
  static OPTIONS = [
    ['', 'ОСНО — НДС как в КП'],
    ['22', 'ОСНО — НДС 22 %'],
    ['20', 'ОСНО — НДС 20 %'],
    ['10', 'ОСНО — НДС 10 %'],
    ['0', 'Экспорт — НДС 0 %'],
    ['7', 'УСН с НДС 7 % — без вычета'],
    ['5', 'УСН с НДС 5 % — без вычета'],
    ['без НДС', 'Без НДС (УСН или освобождение) — без вычета'],
  ];
  static NO_DEDUCT = new Set(['5', '7', 'без НДС']);

  /**
   * Есть ли вычет входного НДС.
   * @param {string} vat «НДС продавца»
   * @returns {boolean}
   */
  static deducts(vat) {
    return !this.NO_DEDUCT.has(String(vat ?? ''));
  }

  /**
   * Подпись режима.
   * @param {string} vat
   * @returns {string}
   */
  static label(vat) {
    const found = this.OPTIONS.find(([value]) => value === String(vat ?? ''));
    return (found || this.OPTIONS[0])[1];
  }

  /**
   * Ставка НДС продавца, %: «без НДС» — 0; «как в КП» — null.
   * @param {string} vat
   * @returns {number|null}
   */
  static rate(vat) {
    const text = String(vat ?? '');
    if (text === this.NO_VAT) return 0;
    return text === '' ? null : Number(text);
  }
}
