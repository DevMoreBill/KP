import { CatalogFilter } from './catalog-filter.js';
import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { Api } from '../../core/net.js';
import { Str } from '../../core/str.js';

/** Поставщик позиции: фид-источник (или поставщик, к которому фид привязан), иначе — по производителю из справочника. */
export class Suppliers {
  static src = {}; // фиды-источники: id → поставщик
  static sups = []; // справочник поставщиков
  static srcKey = '';

  /**
   * Поставщик позиции (с запоминанием на позиции).
   * @param {object} card
   * @returns {string}
   */
  static of(card) {
    if (card._sup !== undefined) return card._sup;
    const src = CatalogIndex.src(card);
    card._sup = src ? (this.src[src] || {}).name || src : this._byMaker(card);
    return card._sup;
  }

  static _byMaker(card) {
    const maker = Str.norm(CatalogIndex.attrs(card).maker);
    if (!maker) return '';
    const found =
      this.sups.find(sup => Str.norm(sup.name) === maker) ||
      this.sups.find(sup => (sup.makers || []).some(name => Str.norm(name) === maker));
    return found ? found.name : '';
  }

  /**
   * Фиды-источники и справочник поставщиков (для фильтра «Поставщик» и поиска по нему).
   * @param {object[]} docs список окна каталога
   */
  static async load(docs) {
    const [src, sups] = await Promise.all([
      Api.request('/api/catalog/sources').catch(() => ({})),
      Api.request('/api/suppliers').catch(() => []),
    ]);
    const sources = src && typeof src === 'object' && !Array.isArray(src) ? src : {};
    const list = Array.isArray(sups) ? sups : [];
    const key = JSON.stringify([sources, list]);
    if (key === this.srcKey) return; // поставщики не менялись — готовые поисковые строки остаются
    this.srcKey = key;
    this.src = sources;
    this.sups = list;
    for (const cards of new Set([docs, Catalog.cache])) {
      cards.forEach(card => {
        delete card._sup;
        delete card._hay;
      });
    }
    CatalogFilter.dropQueries();
  }
}
