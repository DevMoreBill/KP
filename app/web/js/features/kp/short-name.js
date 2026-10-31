/** «Иванов И. П.» из полного ФИО. */
export class ShortName {
  // так сервер подписывает действие без выбранного менеджера — это не имя человека
  static NOBODY = 'Не выбран';

  /**
   * Фамилия и инициалы («Не выбран» — пусто).
   * @param {string} name
   * @returns {string}
   */
  static of(name) {
    if (String(name || '').trim() === this.NOBODY) return '';
    const parts = String(name || '')
      .trim()
      .split(/\s+/);
    if (parts.length <= 1) return parts[0] || '';
    return `${parts[0]} ${parts
      .slice(1)
      .map(part => `${part[0]}.`)
      .join(' ')}`;
  }
}
