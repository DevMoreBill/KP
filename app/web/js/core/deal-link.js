/**
 * Экономика сделки (features/deal) для КП и состава станции: перерисовать открытое окно, открыть его, сводка расчёта,
 * справочник поставщиков. Экономика построена поверх КП и состава и подключает себя (features/deal/index.js); они только
 * просят — без import экономики (циклы import).
 */
export class DealLink {
  static deal = {
    render: () => {},
    open: () => {},
    summary: () => null,
    suppliers: () => null,
  };

  /**
   * Экономика сделки подключает себя.
   * @param {object} deal {render, open, summary, suppliers}
   */
  static connect(deal) {
    this.deal = { ...this.deal, ...deal };
  }

  /** Перерисовать окно экономики, если оно открыто (курс, валюта, опции КП изменились). */
  static render() {
    this.deal.render();
  }

  /**
   * Открыть «Экономику сделки» открытого КП.
   * @returns {*}
   */
  static open() {
    return this.deal.open();
  }

  /**
   * Сводка расчёта экономики открытого КП; экономику не открывали — null.
   * @returns {object|null}
   */
  static summary() {
    return this.deal.summary();
  }

  /**
   * Справочник поставщиков, загруженный экономикой сделки (не загружен — пусто).
   * @returns {object[]}
   */
  static suppliers() {
    return this.deal.suppliers() || [];
  }
}
