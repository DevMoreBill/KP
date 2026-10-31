/**
 * Окно «Добавить оборудование» (features/wizard) для каталога и состава станции: мастер построен поверх них и подключает
 * себя (wizard/index.js); они только просят — без import мастера (циклы import).
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
   * @param {object} [from] открыто из окна сборного изделия: {onSaved, onBack}
   * @returns {*}
   */
  static open(target, type, from) {
    return this.wizard.open(target, type, from);
  }
}
