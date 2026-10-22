import { Catalog } from './catalog-store.js';
import { CatalogIndex } from './catalog-index.js';
import { Attrs } from '../../core/item-attrs.js';
import { Str } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * Производитель позиции: обязателен у нового оборудования каталога; вписать вручную или выбрать из производителей,
 * которые уже есть в каталоге (подсказки поля — список `makerList`).
 */
export class Makers {
  static LIST_ID = 'makerList';
  static FIELD = 'maker';

  /**
   * Производители каталога по алфавиту (написание — как у большинства позиций).
   * @returns {string[]}
   */
  static list() {
    const seen = new Map();
    for (const card of Catalog.cache) {
      const name = String(CatalogIndex.attrs(card).maker || '').trim();
      const key = Str.norm(name);
      if (name && !seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((left, right) => left.localeCompare(right, 'ru'));
  }

  /**
   * Подсказки поля «Производитель».
   * @returns {string}
   */
  static datalist() {
    return `<datalist id="${this.LIST_ID}">${this.list()
      .map(name => `<option value="${esc(name)}">`)
      .join('')}</datalist>`;
  }

  /**
   * Производитель позиции: вписанный или определённый по названию и характеристикам.
   * @param {object} item
   * @returns {string}
   */
  static of(item) {
    return String((item.attrs && item.attrs[this.FIELD]) || Attrs.of(item)[this.FIELD] || '').trim();
  }

  /**
   * Производитель указан; определённый автоматически — записывается в позицию явно.
   * @param {object} item
   * @returns {boolean}
   */
  static ensure(item) {
    const maker = this.of(item);
    if (!maker) return false;
    item.attrs = { ...(item.attrs || {}), [this.FIELD]: maker };
    return true;
  }
}
