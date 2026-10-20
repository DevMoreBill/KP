import { KpModels } from './kp-models.js';
import { Templates } from './templates.js';

/**
 * Имя файла КП и папка менеджера: по образцу из шаблона (fileName) с метками {номер} {префикс} {клиент} {оборудование}
 * {дата}; у тендерного КП — «<№ закупки> КП <поставщик> <заказчик>.docx».
 */
export class KpFile {
  static PATTERN = '{номер}_{префикс}_{клиент}_{оборудование}_{дата}';
  static FORM = /^(ООО|АО|ПАО|ЗАО|ИП|ОАО)\s+/i;
  static TENDER_FORM = /^(ООО|АО|ПАО|ЗАО|ИП|ОАО|НАО)\s+/i;
  static CLIENT_MAX = 40;
  static MODELS_MAX = 60;
  static PREFIX_MAX = 40;
  static NAME_MAX = 60;
  static SUPPLIER_MAX = 40;
  static FOLDER_MAX = 40;

  static _settings(settings) {
    const pack = Templates.cache[S.template];
    return settings || (pack && pack.settings) || {};
  }

  /**
   * Имя файла .docx.
   * @param {object} [settings] настройки шаблона (пусто — загруженного)
   * @returns {string}
   */
  static name(settings) {
    if (tenderNo()) return this.tender(settings);
    const client =
      Str.fileName(String(S.client || 'клиент').replace(this.FORM, '')).slice(0, this.CLIENT_MAX) || 'клиент';
    const models = Str.fileName(KpModels.short()).slice(0, this.MODELS_MAX);
    const template = Templates.current() || {};
    const own = this._settings(settings);
    const prefix = Str.fileName(own.filePrefix || template.filePrefix || 'КП');
    const pattern = own.fileName || template.fileName || this.PATTERN;
    const name = KPGen.fill(pattern, {
      номер: S.number || '',
      префикс: prefix,
      клиент: client,
      оборудование: models,
      дата: S.date || today(),
    })
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/_{2,}/g, '_')
      .replace(/^[_\s-]+|[_\s-]+$/g, '');
    return `${name || 'КП'}.docx`;
  }

  /**
   * Имя файла, как его сохранил сервер: «4567892 КП (2).docx», если «4567892 КП» уже у другого КП той же закупки.
   * @returns {string}
   */
  static saved() {
    const name = this.name();
    const stored = S._file || '';
    return stored && stored.replace(/ \(\d+\)(?=\.docx$)/i, '') === name ? stored : name;
  }

  static _clean(text) {
    return String(text || '')
      .replace(/[«»"'\\/:*?<>|\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Тендер: «<№ закупки> КП <поставщик> <заказчик>.docx», например «4567892 КП ПНЕВМОТЕХ ПАВЛИК.docx».
   * @param {object} [settings]
   * @returns {string}
   */
  static tender(settings) {
    const own = this._settings(settings);
    const template = Templates.current() || {};
    const brand = (own.brandParts || []).map(part => part[0]).join('');
    const supplier = this._clean(own.company || template.company || brand || 'ПНЕВМОТЕХ').slice(0, this.SUPPLIER_MAX);
    const client = this._clean(String(S.client || '').replace(this.TENDER_FORM, '')).slice(0, this.NAME_MAX);
    return `${[this._clean(tenderNo()).slice(0, this.NAME_MAX) || 'Тендер', 'КП', supplier, client].filter(Boolean).join(' ')}.docx`;
  }

  /**
   * Папка КП менеджера: своя или по фамилии.
   * @returns {string}
   */
  static folder() {
    const manager = S.manager || {};
    const surname = String(manager.name || '')
      .trim()
      .split(/\s+/)[0];
    return Str.fileName(manager.folder || surname || '').slice(0, this.FOLDER_MAX);
  }
}
