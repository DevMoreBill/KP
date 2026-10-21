import { CatalogIndex } from './catalog-index.js';
import { CatalogSearch } from './catalog-cache.js';
import { Str } from '../../core/str.js';
import { CatSections } from './cat-sections.js';

/** Условия отбора окна каталога: поиск, раздел, категория, производитель, поставщик, параметры категории. */
export class CatalogFilter {
  static NOSUP = 'Не указан';
  static MIN_WHOLE = 3;
  static TOP_KEYS = ['maker', 'series'];
  static items = null; // каталог: позиции КП
  static options = null; // опции позиции

  /**
   * Задан диапазон «от / до».
   * @param {object} range
   * @returns {boolean}
   */
  static rngOn(range) {
    return !!range && ((range.min ?? '') !== '' || (range.max ?? '') !== '');
  }

  /** Сбросить совпадения с поиском у обоих отборов (позиции изменились). */
  static dropQueries() {
    this.items.dropQuery();
    this.options.dropQuery();
  }

  constructor() {
    Object.assign(this, {
      q: '',
      grp: '',
      cat: '',
      maker: '',
      series: '',
      sup: '',
      f: {},
      rng: {},
      priced: false,
      stock: false,
      sort: 'best',
      dir: 1,
    });
  }

  /** Совпадения с поиском — заново. */
  dropQuery() {
    this._qs = null;
  }

  _category(cat) {
    this.cat = cat;
    this.f = {};
    this.rng = {};
    this.series = '';
  }

  /**
   * Выбрана категория: её параметры — заново; раздел остаётся, пока категория из него.
   * @param {string} cat
   */
  setCategory(cat) {
    this._category(cat);
    if (!cat || CatSections.keyOf(cat) !== this.grp) this.grp = '';
  }

  /**
   * Выбрана категория внутри раздела: раздел остаётся.
   * @param {string} cat
   */
  pickCategory(cat) {
    this._category(cat);
  }

  /** Сбросить параметры категории. */
  resetParams() {
    Object.assign(this, { series: '', f: {}, rng: {} });
  }

  /** Сбросить все условия, кроме категории. */
  resetAll() {
    Object.assign(this, {
      grp: '',
      maker: '',
      series: '',
      sup: '',
      f: {},
      rng: {},
      priced: false,
      stock: false,
      q: '',
    });
  }

  /**
   * Включены фильтры по параметрам категории.
   * @returns {boolean}
   */
  isFiltered() {
    return !!(this.series || Object.values(this.f).some(Boolean) || Object.values(this.rng).some(CatalogFilter.rngOn));
  }

  /**
   * Сколько фильтров по параметрам категории включено (серия, значения, диапазоны).
   * @returns {number}
   */
  paramCount() {
    return (
      [this.series].filter(Boolean).length +
      Object.values(this.f).filter(Boolean).length +
      Object.values(this.rng).filter(CatalogFilter.rngOn).length
    );
  }

  /**
   * Сколько условий отбора включено (фильтры и строка поиска; категория — нет).
   * @returns {number}
   */
  count() {
    return (
      [this.maker, this.series, this.sup, this.priced, this.stock, String(this.q || '').trim()].filter(Boolean).length +
      Object.values(this.f).filter(Boolean).length +
      Object.values(this.rng).filter(CatalogFilter.rngOn).length
    );
  }

  _catOk(card, skip) {
    if (skip === 'cat') return true;
    const cat = CatalogIndex.attrs(card).cat;
    if (this.cat && cat !== this.cat) return false;
    return !(this.grp && !this.cat && CatSections.keyOf(cat) !== this.grp);
  }

  _valuesOk(card, skip) {
    for (const key of CatalogFilter.TOP_KEYS) {
      if (key !== skip && this[key] && CatalogIndex.normValue(card, key) !== Str.norm(this[key])) return false;
    }
    for (const key in this.f) {
      if (key !== skip && this.f[key] && CatalogIndex.normValue(card, key) !== Str.norm(this.f[key])) return false;
    }
    return true;
  }

  static _set(value) {
    return value !== '' && value != null;
  }

  _rangesOk(card, skip) {
    for (const key in this.rng) {
      const range = this.rng[key];
      if (key === skip || !range) continue;
      const value = Str.num(CatalogIndex.attrs(card)[key]);
      if (CatalogFilter._set(range.min) && !(value >= +range.min)) return false;
      if (CatalogFilter._set(range.max) && !(value <= +range.max)) return false;
    }
    return true;
  }

  _restOk(card, skip, win) {
    if (skip !== 'sup' && this.sup && Str.norm(win.supplierOf(card) || CatalogFilter.NOSUP) !== Str.norm(this.sup))
      return false;
    if (this.priced && !card.price) return false;
    if (this.stock && !CatalogIndex.inStock(card)) return false;
    return !(this.q && !this.qHit(card));
  }

  /**
   * Позиция подходит под все условия, кроме skip (счётчики вариантов фильтра не учитывают сам фильтр).
   * @param {object} card
   * @param {string} [skip]
   * @param {object} win окно каталога
   * @returns {boolean}
   */
  pass(card, skip, win) {
    if (win.optFor != null && !this.cat && !win.kindOk(card)) return false;
    return (
      this._catOk(card, skip) &&
      this._valuesOk(card, skip) &&
      this._rangesOk(card, skip) &&
      this._restOk(card, skip, win)
    );
  }

  _prepare() {
    if (this._qs === this.q) return;
    this._qs = this.q;
    this._qw = Str.norm(this.q)
      .split(' ')
      .filter(Boolean)
      .map(word => CatalogIndex.word(word));
    this._qf = CatalogIndex.fold(Str.norm(this.q));
    this._qm = new Map();
  }

  _whole(hay) {
    return this._qf.length >= CatalogFilter.MIN_WHOLE && (hay.fold.includes(this._qf) || hay.model2.includes(this._qf));
  }

  /**
   * Совпадение с поиском — один раз на позицию для текущего текста.
   * @param {object} card
   * @returns {boolean}
   */
  qHit(card) {
    this._prepare();
    let hit = this._qm.get(card.id);
    if (hit !== undefined) return hit;
    const hay = CatalogIndex.hay(card);
    const server = CatalogSearch.ids(this.q); // найденное сервером по характеристикам
    hit =
      this._qw.every(word => CatalogIndex.wordHit(hay, word)) || this._whole(hay) || (!!server && server.has(card.id));
    this._qm.set(card.id, hit);
    return hit;
  }

  /**
   * Пришёл ответ сервера по характеристикам: найденное им отмечается совпадением, остальное уже посчитано.
   * @param {string} query
   * @param {Set<string>} ids
   * @returns {number} сколько добавилось, −1 — пересчитать
   */
  addServer(query, ids) {
    if (this._qs !== query || !this._qm) return -1;
    let added = 0;
    for (const id of ids) {
      if (this._qm.get(id) === false) {
        this._qm.set(id, true);
        added++;
      }
    }
    return added;
  }

  /**
   * Насколько позиция подходит к запросу: модель начинается с запроса → 0, запрос целиком в названии → 1, остальное → 2.
   * @param {object} card
   * @returns {number}
   */
  rel(card) {
    const query = Str.norm(this.q);
    if (!query) return 2;
    const fold = this._qs === this.q ? this._qf : CatalogIndex.fold(query);
    const hay = CatalogIndex.hay(card);
    const model = hay.m0.startsWith(fold) || hay.model.includes(fold) || hay.model2.includes(fold);
    if (fold.length >= CatalogIndex.MIN_FOLD && model) return 0;
    return hay.name.includes(query) ? 1 : 2;
  }
}

CatalogFilter.items = new CatalogFilter();
CatalogFilter.options = new CatalogFilter();
