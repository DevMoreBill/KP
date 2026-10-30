/**
 * Размер и место окна, выбранные пользователем (потянул за угол или кромку, перенёс, запомнено в браузере), — в свойствах
 * окна --dlg-w, --dlg-h, --dlg-x, --dlg-y, а не в style.width: режимы окна (во весь экран, вкладка, телефон) перекрывают их
 * стилями, без !important.
 */
export class WinSize {
  static PROPS = { width: '--dlg-w', height: '--dlg-h', left: '--dlg-x', top: '--dlg-y' };

  /**
   * Поставить размер или место (пустое значение — убрать). Размер, который браузер сам вписал в style окна, пока его тянули
   * за угол, переносится туда же.
   * @param {HTMLElement} dialog
   * @param {{width?: string, height?: string, left?: string, top?: string}} box значения с единицами, например '900px'
   */
  static set(dialog, box) {
    for (const [key, value] of Object.entries(box)) {
      if (value) dialog.style.setProperty(this.PROPS[key], value);
      else dialog.style.removeProperty(this.PROPS[key]);
      dialog.style.removeProperty(key);
    }
  }

  /**
   * Запомненное значение ('' — не задано).
   * @param {HTMLElement} dialog
   * @param {'width'|'height'|'left'|'top'} key
   * @returns {string}
   */
  static get(dialog, key) {
    return dialog.style.getPropertyValue(this.PROPS[key]).trim();
  }
}
