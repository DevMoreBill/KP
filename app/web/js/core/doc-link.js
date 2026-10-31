/**
 * Документ КП (features/doc) для КП: документы из КП (счёт, спецификация, договор), идёт ли сохранение КП, шаблоны КП,
 * предпросмотр рядом с формой. Документ построен поверх КП и подключает себя (features/doc/index.js); КП только просит —
 * без import документа (циклы import).
 */
export class DocLink {
  static doc = {
    docs: () => {},
    saving: () => false,
    templates: () => [],
    wantPreview: () => {},
    previewWanted: () => false,
    previewMinWidth: () => 0,
  };

  /**
   * Документ КП подключает себя.
   * @param {object} doc {docs, saving, templates, wantPreview, previewWanted, previewMinWidth}
   */
  static connect(doc) {
    this.doc = { ...this.doc, ...doc };
  }

  /**
   * Окно «Документы» сохранённого КП.
   * @param {string} kpId
   * @returns {*}
   */
  static docs(kpId) {
    return this.doc.docs(kpId);
  }

  /**
   * Идёт сохранение КП в журнал (сборка файла).
   * @returns {boolean}
   */
  static saving() {
    return this.doc.saving();
  }

  /**
   * Шаблоны КП.
   * @returns {object[]}
   */
  static templates() {
    return this.doc.templates();
  }

  /**
   * Показывать ли предпросмотр рядом с формой.
   * @param {boolean} shown
   */
  static wantPreview(shown) {
    this.doc.wantPreview(shown);
  }

  /**
   * Менеджер включил предпросмотр рядом (в этом браузере).
   * @returns {boolean}
   */
  static previewWanted() {
    return this.doc.previewWanted();
  }

  /**
   * Ширина экрана, с которой предпросмотр встаёт рядом, px.
   * @returns {number}
   */
  static previewMinWidth() {
    return this.doc.previewMinWidth();
  }
}
