/**
 * Кабинет (features/crm) для КП: открыть кабинет или сделку, обновить карточку сделки клиента, сделки и стадии. Кабинет
 * построен поверх КП и подключает себя (features/crm/index.js); КП только просит — без import кабинета (циклы import).
 */
export class CabinetLink {
  static cabinet = {
    open: () => {},
    openFreeDeals: () => {},
    openDeal: () => {},
    lastDeal: () => null,
    reloadDealOf: () => {},
    deals: () => [],
    closed: () => false,
    stageLabel: () => '',
  };

  /**
   * Кабинет подключает себя.
   * @param {object} cabinet {open, openFreeDeals, openDeal, lastDeal, reloadDealOf, deals, closed, stageLabel}
   */
  static connect(cabinet) {
    this.cabinet = { ...this.cabinet, ...cabinet };
  }

  /**
   * Открыть кабинет на вкладке.
   * @param {string} tab
   * @returns {*}
   */
  static open(tab) {
    return this.cabinet.open(tab);
  }

  /**
   * Открыть сделки без ответственного.
   * @returns {*}
   */
  static openFreeDeals() {
    return this.cabinet.openFreeDeals();
  }

  /**
   * Открыть карточку сделки.
   * @param {string} id
   */
  static openDeal(id) {
    this.cabinet.openDeal(id);
  }

  /**
   * Последняя открытая сделка или null.
   * @returns {object|null}
   */
  static lastDeal() {
    return this.cabinet.lastDeal();
  }

  /**
   * Карточка сделки этого клиента открыта — обновить её (контакты изменились).
   * @param {string} clientId
   */
  static reloadDealOf(clientId) {
    this.cabinet.reloadDealOf(clientId);
  }

  /**
   * Сделки кабинета (загруженные).
   * @returns {object[]}
   */
  static deals() {
    return this.cabinet.deals();
  }

  /**
   * Сделка закрыта (успех или провал).
   * @param {object} deal
   * @returns {boolean}
   */
  static closed(deal) {
    return this.cabinet.closed(deal);
  }

  /**
   * Название стадии сделки.
   * @param {object} deal
   * @returns {string}
   */
  static stageLabel(deal) {
    return this.cabinet.stageLabel(deal);
  }
}
