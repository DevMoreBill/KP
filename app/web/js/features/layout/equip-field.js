/** Поля позиции из каталога: категория и число из текста (общее у состава, воздушной цепочки, норм и баков). */
export class EquipField {
  /** Категория позиции каталога. */
  static cat(part) {
    return String((part.attrs && part.attrs.cat) || part.cat || '');
  }

  /** Число из текста («1 200,5 кг» → 1200.5). */
  static num(v) {
    const value = parseFloat(
      String(v ?? '')
        .replace(/\s+/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(value) ? value : null;
  }
}
