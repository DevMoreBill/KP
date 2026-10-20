/**
 * Состояние логистики в окне сделки и «Настройках»: тарифы, маршруты по дорогам, расчёты и предложения перевозчиков по
 * поставщикам, запросы в работе.
 */
export class LgState {
  static routes = {};
  static tar = null;
  static saved = null;
  static status = null;
  static res = {};
  static fin = {};
  static busy = {};
  static err = {};
  static tried = {};
  static quoteTimers = {};
  static whTimer = null;
}
