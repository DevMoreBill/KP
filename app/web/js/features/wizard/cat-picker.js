import { CatSections } from '../catalog/cat-sections.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Attrs } from '../../core/item-attrs.js';
import { Fmt, Str } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * Выбор категории в окне «Добавить оборудование»: группы — карточками с пиктограммой раздела, категории — крупными
 * строками (число позиций в каталоге — сбоку), фильтр по названию и недавние категории этого браузера.
 */
export class CatPicker {
  static OTHER = 'Прочее';
  // фильтр нужен, когда категорий больше
  static FILTER_MIN = 10;
  static RECENT_MAX = 6;
  static RECENT_KEY = 'kp.nwRecent';
  static query = '';

  /** Сбросить фильтр (новое открытие окна). */
  static reset() {
    this.query = '';
  }

  /**
   * Фильтр, недавние и группы категорий.
   * @param {object[]} units категории единиц оборудования
   * @returns {string}
   */
  static html(units) {
    const filter =
      units.length > this.FILTER_MIN
        ? `<input type="search" id="nwCatQ" class="nw-catq" value="${esc(this.query)}" placeholder="Найти категорию…" autocomplete="off" aria-label="Найти категорию">`
        : '';
    return `<div class="nw-cbar">${filter}${this._recent(units)}</div><div class="nw-groups" id="nwGroups">${this.groups(units)}</div>`;
  }

  /**
   * Группы категорий по текущему фильтру.
   * @param {object[]} units
   * @returns {string}
   */
  static groups(units) {
    const counts = this._counts();
    const shown = this._matching(units);
    if (!shown.length)
      return `<p class="muted nw-none">Категория «${esc(this.query.trim())}» не найдена — проверьте написание.</p>`;
    const names = [...new Set(shown.map(type => this._group(type)))];
    return names
      .map(name =>
        this._card(
          name,
          shown.filter(type => this._group(type) === name),
          counts,
        ),
      )
      .join('');
  }

  /**
   * Сменить фильтр.
   * @param {string} query
   * @param {object[]} units
   * @returns {string} разметка групп
   */
  static filter(query, units) {
    this.query = query;
    return this.groups(units);
  }

  /**
   * Первая категория по фильтру (Enter в поле фильтра).
   * @param {object[]} units
   * @returns {string}
   */
  static first(units) {
    const [type] = this._matching(units);
    return type ? type.id : '';
  }

  /**
   * Запомнить выбранную категорию в недавних (только этот браузер).
   * @param {string} cat
   */
  static remember(cat) {
    const recent = [cat, ...this._stored().filter(id => id !== cat)].slice(0, this.RECENT_MAX);
    try {
      localStorage.setItem(this.RECENT_KEY, JSON.stringify(recent));
    } catch {
      // хранилище браузера недоступно — недавние просто не запоминаются
    }
  }

  static _stored() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.RECENT_KEY) || '[]');
      return Array.isArray(saved) ? saved.map(String) : [];
    } catch {
      return [];
    }
  }

  static _recent(units) {
    const byId = new Map(units.map(type => [type.id, type]));
    const recent = this._stored()
      .map(id => byId.get(id))
      .filter(Boolean);
    if (!recent.length) return '';
    const chips = recent
      .map(type => `<button type="button" class="nw-rc" data-nwcat="${esc(type.id)}">${esc(type.name)}</button>`)
      .join('');
    return `<div class="nw-recent"><span class="muted">Недавние:</span>${chips}</div>`;
  }

  static _group(type) {
    return type.group || this.OTHER;
  }

  static _matching(units) {
    const query = Str.norm(this.query);
    if (!query) return units;
    return units.filter(type => Str.norm(`${type.name} ${type.item || ''} ${this._group(type)}`).includes(query));
  }

  static _counts() {
    const counts = new Map();
    Catalog.cache.forEach(card => {
      const cat = Attrs.of(card).cat;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return counts;
  }

  static _card(name, types, counts) {
    const total = types.reduce((sum, type) => sum + (counts.get(type.id) || 0), 0);
    const buttons = types.map(type => this._button(type, counts.get(type.id))).join('');
    const icon = CatSections.svg(CatSections.iconOf(name), 'nw-gi');
    return `<section class="nw-grp"><h4 class="nw-gh">${icon}<span>${esc(name)}</span>${total ? `<small>${Fmt.num(total)}</small>` : ''}</h4><div class="nw-cats">${buttons}</div></section>`;
  }

  static _button(type, count) {
    const badge = count ? `<small>${Fmt.num(count)}</small>` : '';
    return `<button type="button" class="nw-cat" data-nwcat="${esc(type.id)}"><span>${esc(type.name)}</span>${badge}</button>`;
  }
}
