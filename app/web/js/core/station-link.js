/**
 * Станции и сборки (features/kit — состав, features/station — подбор и компоновка) для каталога: вкладки «Состав станции» и
 * «Компоновка» карточки позиции, картинки и описание станции, чертёж, автозаполнение станции и контейнер. Станции построены
 * поверх каталога и подключают себя (kit/index.js, station/index.js); каталог только просит — без import (циклы import).
 */
export class StationLink {
  static station = {
    enabled: () => false,
    kitTab: () => '',
    kitLabel: (item, label) => label,
    layoutTab: () => '',
    layoutBadge: () => '',
    syncImages: async () => false,
    soonImages: () => {},
    brief: () => '',
    drawHtml: () => '',
    uploadDraw: async draw => draw,
    autoFill: () => {},
    container: () => null,
  };

  /**
   * Состав станции и подбор подключают себя (каждый — свою часть).
   * @param {object} part {enabled, kitTab, kitLabel, drawHtml, uploadDraw, autoFill, container} или {layoutTab,
   *   layoutBadge, syncImages, soonImages, brief}
   */
  static connect(part) {
    this.station = { ...this.station, ...part };
  }

  /**
   * У позиции есть компоновка станции (вкладка «Компоновка», 3D и листы).
   * @param {object} item
   * @returns {boolean}
   */
  static enabled(item) {
    return this.station.enabled(item);
  }

  /**
   * Вкладка «Состав станции» карточки позиции.
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static kitTab(item, i) {
    return this.station.kitTab(item, i);
  }

  /**
   * Подпись вкладки состава (у сборного изделия — своя).
   * @param {object} item
   * @param {string} label
   * @returns {string}
   */
  static kitLabel(item, label) {
    return this.station.kitLabel(item, label);
  }

  /**
   * Вкладка «Компоновка» карточки позиции.
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static layoutTab(item, i) {
    return this.station.layoutTab(item, i);
  }

  /**
   * Значок замечаний на вкладке «Компоновка».
   * @param {object} item
   * @returns {string}
   */
  static layoutBadge(item) {
    return this.station.layoutBadge(item);
  }

  /**
   * Пересобрать картинки станций КП, которые устарели.
   * @returns {Promise<boolean>} что-то пересобрано
   */
  static syncImages() {
    return this.station.syncImages();
  }

  /**
   * Пересобрать картинки станции после паузы.
   * @param {object} item
   */
  static soonImages(item) {
    this.station.soonImages(item);
  }

  /**
   * Блок «Краткое описание станции — ИИ» во вкладке «Описание и фото».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static brief(item, i) {
    return this.station.brief(item, i);
  }

  /**
   * Чертёж позиции во вкладке «Описание и фото».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static drawHtml(item, i) {
    return this.station.drawHtml(item, i);
  }

  /**
   * Чертёж позиции — на сервер (при сохранении в каталог).
   * @param {object} draw
   * @param {object} doc позиция каталога
   * @returns {Promise<object>}
   */
  static uploadDraw(draw, doc) {
    return this.station.uploadDraw(draw, doc);
  }

  /**
   * Параметры станции — по составу.
   * @param {object} item
   */
  static autoFill(item) {
    this.station.autoFill(item);
  }

  /**
   * Новый контейнер станции.
   * @param {string} kind исполнение
   * @returns {object|null}
   */
  static container(kind) {
    return this.station.container(kind);
  }
}
