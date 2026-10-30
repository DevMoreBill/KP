/**
 * Форма КП для разделов: перерисовать, открытый шаг, выбрать или открыть шаг, боковая панель, что мешает сохранить. Форма
 * (ui/) выше разделов и подключает себя при запуске (ui/index.js); разделы только просят — без import формы (циклы import).
 */
export class KpForm {
  static view = {
    render: () => {},
    step: () => 'client',
    select: () => {},
    open: () => {},
    side: () => {},
    live: () => {},
    problems: () => [],
  };

  /**
   * Форма подключает себя.
   * @param {object} view {render, step, select, open, side, live, problems}
   */
  static connect(view) {
    this.view = { ...this.view, ...view };
  }

  /** Перерисовать форму. */
  static render() {
    this.view.render();
  }

  /**
   * Открытый шаг формы.
   * @returns {string}
   */
  static step() {
    return this.view.step();
  }

  /**
   * Сделать шаг открытым без перерисовки (форма перерисуется позже).
   * @param {string} id
   */
  static select(id) {
    this.view.select(id);
  }

  /**
   * Открыть шаг формы.
   * @param {string} id
   * @param {string} [target] поле, к которому прокрутить
   */
  static open(id, target) {
    this.view.open(id, target);
  }

  /** Перерисовать боковую панель. */
  static renderSide() {
    this.view.side();
  }

  /** Обновить итоги боковой панели без перерисовки. */
  static updateLive() {
    this.view.live();
  }

  /**
   * Что мешает сохранить КП: [текст, шаг] по порядку шагов.
   * @returns {Array}
   */
  static problems() {
    return this.view.problems();
  }
}
