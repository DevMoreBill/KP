/**
 * Окно «Добавить оборудование» (features/wizard) для каталога: мастер построен поверх каталога и подключает себя
 * (wizard/index.js); каталог только просит — без import мастера (циклы import).
 */
export class WizardLink {
  static wizard = { open: () => {} };

  /**
   * Мастер подключает себя.
   * @param {object} wizard {open}
   */
  static connect(wizard) {
    this.wizard = { ...this.wizard, ...wizard };
  }

  /**
   * Открыть «Добавить оборудование».
   * @param {string} target 'kp' — в КП, 'catalog' — в каталог
   * @param {string} [type] категория
   * @returns {*}
   */
  static open(target, type) {
    return this.wizard.open(target, type);
  }
}
