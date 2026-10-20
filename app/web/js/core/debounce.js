/**
 * Задержка ввода — одна на всю программу: q = new Debounce(мс); q.run(fn) — fn через мс после последнего вызова (повторный
 * вызов откладывает); q.run(fn, мс) — своя задержка; q.cancel() — отменить; q.pending — ждёт.
 */
export class Debounce {
  static DEFAULT_MS = 200;

  /** @param {number} [delay] мс */
  constructor(delay = Debounce.DEFAULT_MS) {
    this.ms = delay;
    this.timer = null;
  }

  /**
   * @param {Function} task
   * @param {number} [delay] мс
   * @returns {Debounce}
   */
  run(task, delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      task();
    }, delay ?? this.ms);
    return this;
  }

  /**
   * Отменить отложенный вызов.
   * @returns {Debounce}
   */
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    return this;
  }

  /** Ждёт ли вызов. */
  get pending() {
    return this.timer != null;
  }
}
