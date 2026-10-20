/**
 * Состояние окна «Экономика сделки»: справочники поставщиков и кодов ТН ВЭД, производственный календарь, ключевая ставка ЦБ,
 * открытая вкладка и навигация по шагам, список выбора поставщика и страны, раскрытые блоки, перетаскивание.
 */
export class DealUi {
  static cal = {};
  static calLoading = {};
  static key = null;
  static keyErr = '';
  static sups = null;
  static cus = null;
  static saveT = {};
  static open = undefined;
  static nav = {};
  static stepInfo = {};
  static combo = null;
  static comboIx = -1;
  static comboAll = false;
  static comboList = [];
  static more = null;
  static supNote = false;
  static drag = null;
  static sdrag = null;
}
