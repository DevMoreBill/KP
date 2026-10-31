/**
 * Каталог (features/catalog) для КП: позиция каталога по коду или названию, полная карточка, наличие словами, поиск
 * моделей и «В КП», окно каталога. Каталог построен поверх КП и подключает себя (features/catalog/index.js); КП только
 * просит — без import каталога (циклы import). Части каталога ниже окна (карточка позиции, правка, разделы, категории,
 * модерация, загрузка из Excel) так же просят окно: открыть, модерация правок, сообщение, перерисовать.
 */
export class CatalogLink {
  static catalog = {
    find: () => null,
    findByName: () => null,
    fullDoc: async card => card,
    stockText: () => '',
    matches: () => [],
    add: () => {},
    open: () => {},
    moderated: () => false,
    say: () => {},
    redraw: () => {},
    reloadPending: async () => {},
  };

  /**
   * Каталог подключает себя.
   * @param {object} catalog {find, findByName, fullDoc, stockText, matches, add, open, moderated, say, redraw,
   *   reloadPending}
   */
  static connect(catalog) {
    this.catalog = { ...this.catalog, ...catalog };
  }

  /**
   * Позиция каталога по коду.
   * @param {string} id
   * @returns {object|null}
   */
  static find(id) {
    return this.catalog.find(id);
  }

  /**
   * Позиция каталога по названию.
   * @param {string} name
   * @returns {object|null}
   */
  static findByName(name) {
    return this.catalog.findByName(name);
  }

  /**
   * Полная карточка позиции (описание, характеристики, фото).
   * @param {object} card
   * @returns {Promise<object>}
   */
  static fullDoc(card) {
    return this.catalog.fullDoc(card);
  }

  /**
   * Наличие словами.
   * @param {*} stock
   * @returns {string}
   */
  static stockText(stock) {
    return this.catalog.stockText(stock);
  }

  /**
   * Модели каталога по строке поиска.
   * @param {string} query
   * @returns {object[]}
   */
  static matches(query) {
    return this.catalog.matches(query);
  }

  /**
   * Позицию каталога — в КП.
   * @param {object} card
   * @returns {*}
   */
  static add(card) {
    return this.catalog.add(card);
  }

  /**
   * Открыть окно каталога.
   * @param {object} [opts] {q}
   * @returns {*}
   */
  static open(opts) {
    return this.catalog.open(opts);
  }

  /**
   * Правки каталога — на модерацию (включено в окне каталога).
   * @returns {boolean}
   */
  static moderated() {
    return this.catalog.moderated();
  }

  /**
   * Сообщение в подвале окна каталога.
   * @param {string} text
   */
  static say(text) {
    this.catalog.say(text);
  }

  /** Перерисовать окно каталога (категории, фильтры, список). */
  static redraw() {
    this.catalog.redraw();
  }

  /**
   * Правки на модерации — заново с сервера, окно каталога — перерисовать.
   * @returns {Promise<void>}
   */
  static reloadPending() {
    return this.catalog.reloadPending();
  }
}
