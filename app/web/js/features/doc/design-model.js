import { Design } from './design.js';

/**
 * Графический редактор шаблона: подписи из формы редактора (editor.json), выбранный объект и его элементы в документе.
 * Выбор — {kind, key, el?, text?}: kind — style (стиль текста), img (картинка макета или своя X_…), label (своя надпись L_…),
 * sec (раздел).
 */
export class DesignModel {
  static SELECTORS = {
    style: key => `[data-tds="${key}"]`,
    img: key => `[data-tdi="${key}"] img`,
    label: key => `.kp-lbl[data-tdl="${key}"]`,
    sec: key => `[data-tdsec="${key}"]`,
  };
  static TEXTS_SHOWN = 4;
  static SPECIAL = /[.*+?^${}()|[\]\\]/g;
  static VARIABLE = /\{[^}]*\}/g;
  static VARIABLE_SPLIT = /\{[^}]*\}/;

  /**
   * Поля формы editor.json (все или одного типа).
   * @param {string} [type]
   * @returns {object[]}
   */
  static fields(type) {
    const form = Design.state.form;
    return ((form && form.tabs) || []).flatMap(tab => tab.fields || []).filter(field => !type || field.type === type);
  }

  /**
   * Подпись стиля текста.
   * @param {string} key
   * @returns {string}
   */
  static styleLabel(key) {
    if (key === 'headerText') return 'Шапка: реквизиты';
    const field = this.fields('style').find(row => row.key === `styles.${key}`);
    return field ? field.label : key;
  }

  /**
   * Подпись надписи шаблона.
   * @param {string} key
   * @returns {string}
   */
  static textLabel(key) {
    const field = this.fields().find(row => row.key === `texts.${key}`);
    return field ? field.label : key;
  }

  /**
   * Названия фирменных цветов.
   * @returns {object}
   */
  static colorNames() {
    return (Design.state.form && Design.state.form.colorNames) || {};
  }

  /**
   * Название раздела.
   * @param {string} id
   * @returns {string}
   */
  static sectionName(id) {
    const field = this.fields('sections')[0];
    return (field && field.names && field.names[id]) || Design.SECTION_NAMES[id] || id;
  }

  /**
   * Цвет RRGGBB: свой или фирменный по ключу.
   * @param {string} color
   * @returns {string}
   */
  static colorHex(color) {
    if (/^[0-9A-Fa-f]{6}$/.test(String(color || ''))) return String(color).toUpperCase();
    const work = Design.state.work;
    return ((work && work.colors) || {})[color] || '000000';
  }

  /**
   * Своя картинка шаблона по ключу X_…
   * @param {string} key
   * @returns {object|null}
   */
  static ownImage(key) {
    return /^X_/.test(key || '') ? Design.state.work.images.find(image => `X_${image.id}` === key) : null;
  }

  /**
   * Своя надпись по ключу L_…
   * @param {string} key
   * @returns {object|null}
   */
  static label(key) {
    return /^L_/.test(key || '') ? Design.state.work.labels.find(label => `L_${label.id}` === key) : null;
  }

  /**
   * Свой объект выбора (надпись или картинка) или null.
   * @param {object|null} sel
   * @returns {object|null}
   */
  static item(sel) {
    if (!sel) return null;
    if (sel.kind === 'label') return this.label(sel.key);
    return sel.kind === 'img' ? this.ownImage(sel.key) : null;
  }

  /**
   * Выбран свой объект (надпись или картинка).
   * @param {object|null} sel
   * @returns {boolean}
   */
  static isOwn(sel) {
    return !!this.item(sel);
  }

  /**
   * Ключ отступов абзаца для элемента макета ('' — у своих объектов и разделов).
   * @param {object|null} sel
   * @returns {string}
   */
  static paraKey(sel) {
    if (!sel) return '';
    if (sel.kind === 'style') return sel.key;
    return sel.kind === 'img' && !this.isOwn(sel) ? `IMG_${sel.key}` : '';
  }

  /**
   * Элементы выбора в документе.
   * @param {object|null} sel
   * @returns {HTMLElement[]}
   */
  static elements(sel) {
    const selector = sel && this.SELECTORS[sel.kind];
    return selector ? Design.queryAll(selector(CSS.escape(sel.key))) : [];
  }

  /**
   * Что под указателем в документе: своя надпись, картинка, текст стиля (иначе null).
   * @param {HTMLElement} target
   * @returns {object|null}
   */
  static pointed(target) {
    const label = target.closest('.kp-lbl[data-tdl]');
    if (label) return { kind: 'label', key: label.dataset.tdl, el: label };
    const image = target.tagName === 'IMG' && target.closest('[data-tdi]');
    if (image) return { kind: 'img', key: image.dataset.tdi, el: target };
    const styled = target.closest('[data-tds]');
    if (!styled) return null;
    return { kind: 'style', key: styled.dataset.tds, text: (styled.closest('p') || styled).textContent, el: styled };
  }

  /**
   * Главный элемент выбора: тот, по которому щёлкнули, иначе первый.
   * @param {object|null} [sel]
   * @returns {HTMLElement|null}
   */
  static primary(sel = Design.state.sel) {
    const list = this.elements(sel);
    if (sel && sel.el && sel.el.isConnected && list.includes(sel.el)) return sel.el;
    if (sel) sel.el = list[0];
    return list[0] || null;
  }

  /**
   * Надписи шаблона, из которых мог получиться выбранный текст: {подстановки} — любое значение.
   * @param {string} text
   * @returns {string[]}
   */
  static textsFor(text) {
    const target = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!target) return [];
    const out = [];
    for (const [key, value] of Object.entries(Design.state.work.texts || {})) {
      const source = String(value || '');
      if (!source.replace(this.VARIABLE, '').trim()) continue;
      if (this._pattern(source).test(target)) out.push(key);
    }
    return out.slice(0, this.TEXTS_SHOWN);
  }

  static _pattern(source) {
    const parts = source
      .split(this.VARIABLE_SPLIT)
      .map(part => part.replace(/\s+/g, ' ').trim().toLowerCase().replace(this.SPECIAL, '\\$&'));
    return new RegExp(parts.join('[\\s\\S]*?'));
  }

  /**
   * Места привязки: начало и конец включённых разделов.
   * @returns {string[][]} [[место, подпись]]
   */
  static places() {
    return Design.state.work.sections
      .filter(section => section.on)
      .flatMap(section => [
        [`${section.id}Top`, `${this.sectionName(section.id)} — начало`],
        [`${section.id}End`, `${this.sectionName(section.id)} — конец`],
      ]);
  }
}
