/** Окно мастера для его шагов (новая станция): состояние, перерисовка, готово — окно подключает себя (wizard/index.js). */
export class WizardState {
  static win = { state: () => ({}), draw: () => {}, finish: () => {} };

  /**
   * Окно мастера подключает себя.
   * @param {{state: function(): object, draw: function(): void, finish: function(object, string, ?function): void}} win
   */
  static connect(win) {
    this.win = { ...this.win, ...win };
  }

  /**
   * Состояние окна мастера (куда добавляем, категория).
   * @returns {object}
   */
  static get state() {
    return this.win.state();
  }

  /** Перерисовать окно мастера. */
  static draw() {
    this.win.draw();
  }

  /**
   * Готово: позиция — в КП или каталог.
   * @param {object} item
   * @param {string} kind
   * @param {?function} [after]
   */
  static finish(item, kind, after) {
    this.win.finish(item, kind, after);
  }
}
