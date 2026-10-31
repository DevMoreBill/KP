import { Attrs, CatAttrs } from '../../core/item-attrs.js';
import { Catalog } from '../catalog/catalog-store.js';
import { EquipTypes } from '../../core/equip-types.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Str } from '../../core/str.js';
import { TzPick } from './tz-pick.js';
import { esc } from '../../core/util.js';
/**
 * Быстрый поиск в окне подбора: строка поиска карточки и ключ сортировки — один раз на карточку (каталог 7 500+ позиций
 * перебирается на каждое нажатие); набор в поле поиска — с короткой задержкой.
 */
export class PickFind {
  static WAIT = 160;
  static LAST = 9e9;
  static _timer = null;

  /**
   * Строка поиска карточки (у карточки каталога — из памяти).
   * @param {object} card
   * @param {object} attrs
   * @returns {string}
   */
  static hay(card, attrs) {
    if (card._pq != null && CatAttrs.cards.has(card)) return card._pq;
    const hay = Str.norm([card.name, attrs.maker, attrs.model, attrs.series].join(' '));
    if (CatAttrs.cards.has(card)) card._pq = hay;
    return hay;
  }

  /**
   * Ключ сортировки: компрессоры — по производительности в м³/мин (у поршневых в каталоге — л/мин), прочие — по главному
   * параметру категории.
   * @param {object} card
   * @returns {number}
   */
  static key(card) {
    const attrs = Attrs.of(card);
    if (/^comp_/.test(attrs.cat)) return TzPick.flow(card) || this.LAST;
    return Str.num(attrs[EquipTypes.byId(attrs.cat).main || 'kw']) ?? this.LAST;
  }

  /**
   * Выполнить после паузы в наборе.
   * @param {Function} action
   */
  static later(action) {
    clearTimeout(this._timer);
    this._timer = setTimeout(action, this.WAIT);
  }
}

/**
 * Подбор по фильтрам категории: вид (если категорий несколько), производитель, списки и «от–до» по параметрам. Фильтр —
 * `{cat, maker, q, f: {ключ: значение}, r: {ключ: [от, до]}, min: {ключ: не меньше}, test(card)}`; cats — допустимые
 * категории (null — все); min и test — подбор по нужному (KitNeed).
 */
export class PickFilter {
  static FIELDS = 8;
  static VALUES = 40;
  static LIMIT = 40;
  static EPS = 1e-9;
  static MAIN_PARAMS = 3;

  /**
   * Новый фильтр.
   * @param {string[]|null} cats
   * @returns {object}
   */
  static create(cats) {
    return { cat: cats && cats.length === 1 ? cats[0] : '', maker: '', q: '', f: {}, r: {} };
  }

  /**
   * Число из поля «от / до» или null.
   * @param {*} value
   * @returns {number|null}
   */
  static num(value) {
    const number = parseFloat(
      String(value ?? '')
        .replace(/\s+/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(number) ? number : null;
  }

  static _pool(cats) {
    return Catalog.cache.filter(card => !cats || cats.includes(Attrs.of(card).cat));
  }

  static _fields(filter) {
    return filter.cat
      ? EquipTypes.byId(filter.cat)
          .fields.filter(field => field.facet || field.range)
          .slice(0, this.FIELDS)
      : [];
  }

  static _opt(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  }

  /**
   * Поля фильтра.
   * @param {object} filter
   * @param {string[]|null} cats
   * @returns {string}
   */
  static html(filter, cats) {
    const pool = this._pool(cats).filter(card => !filter.cat || Attrs.of(card).cat === filter.cat);
    const fields = this._fields(filter)
      .map(field => this._field(field, filter, pool))
      .join('');
    return `<div class="pf"><label class="f pf-q"><span>Модель или название</span><input type="search" data-pf="q" value="${esc(filter.q)}" placeholder="например, CR 32 или Cummins" autocomplete="off"></label>${this._catSelect(filter, cats)}${this._makerSelect(filter, pool)}${fields}</div>`;
  }

  static _catSelect(filter, cats) {
    if (cats && cats.length <= 1) return '';
    const options = (cats || EquipTypes.list.map(type => type.id))
      .filter(cat => !EquipTypes.byId(cat).station)
      .map(cat => this._opt(cat, EquipTypes.byId(cat).name, filter.cat === cat))
      .join('');
    return `<label class="f"><span>Вид</span><select data-pf="cat">${this._opt('', 'Все', !filter.cat)}${options}</select></label>`;
  }

  static _makerSelect(filter, pool) {
    const makers = [...new Set(pool.map(card => Attrs.of(card).maker).filter(Boolean))].sort((one, two) =>
      one.localeCompare(two, 'ru'),
    );
    const options = makers.map(maker => this._opt(maker, maker, filter.maker === maker)).join('');
    return `<label class="f"><span>Производитель</span><select data-pf="maker">${this._opt('', 'Все', !filter.maker)}${options}</select></label>`;
  }

  static _field(field, filter, pool) {
    const label = esc(field.label) + (field.unit ? `, ${esc(field.unit)}` : '');
    if (field.range) {
      const range = filter.r[field.key] || [];
      return `<label class="f pf-r"><span>${label}</span><span class="pf-rr"><input type="text" inputmode="decimal" data-pf="rmin:${esc(field.key)}" value="${esc(range[0] ?? '')}" placeholder="от"><input type="text" inputmode="decimal" data-pf="rmax:${esc(field.key)}" value="${esc(range[1] ?? '')}" placeholder="до"></span></label>`;
    }
    const values = this._values(field, pool);
    if (!values.length) return '';
    const options = values.map(value => this._opt(value, value, filter.f[field.key] === value)).join('');
    return `<label class="f"><span>${label}</span><select data-pf="f:${esc(field.key)}">${this._opt('', 'Все', !filter.f[field.key])}${options}</select></label>`;
  }

  static _values(field, pool) {
    const values =
      field.values && field.values.length
        ? field.values
        : [
            ...new Set(
              pool
                .map(card => Attrs.of(card)[field.key])
                .filter(value => value != null && value !== '')
                .map(String),
            ),
          ].sort();
    return values.slice(0, this.VALUES);
  }

  /**
   * Карточка проходит фильтр.
   * @param {object} card
   * @param {object} filter
   * @param {string[]|null} cats
   * @returns {boolean}
   */
  static matches(card, filter, cats) {
    const attrs = Attrs.of(card);
    return [
      () => this._category(attrs, filter, cats),
      () => !filter.maker || attrs.maker === filter.maker,
      () => Object.entries(filter.f).every(([key, value]) => !value || String(attrs[key] ?? '') === value),
      () => Object.entries(filter.r).every(([key, range]) => this._inRange(attrs[key], range)),
      () => Object.entries(filter.min || {}).every(([key, value]) => this._atLeast(attrs[key], value)),
      () => !filter.test || filter.test(card),
      () => this._query(card, attrs, filter),
    ].every(check => check());
  }

  static _category(attrs, filter, cats) {
    if (cats && !cats.includes(attrs.cat)) return false;
    return !filter.cat || attrs.cat === filter.cat;
  }

  static _inRange(value, [low, high]) {
    const from = this.num(low);
    const upTo = this.num(high);
    if (from == null && upTo == null) return true;
    const number = Str.num(value);
    if (number == null) return false;
    return !((from != null && number < from) || (upTo != null && number > upTo));
  }

  static _atLeast(value, need) {
    const top = PickFilter.top(value);
    return !(top != null && top < need - this.EPS);
  }

  /** слова поиска — разбор один раз на строку */
  static _query(card, attrs, filter) {
    if (!filter.q.trim()) return true;
    if (!(filter._w && filter._w.q === filter.q))
      filter._w = { q: filter.q, w: Str.norm(filter.q).split(' ').filter(Boolean) };
    const hay = PickFind.hay(card, attrs);
    return filter._w.w.every(word => hay.includes(word));
  }

  /**
   * Подходящие карточки по порядку ключа.
   * @param {object} filter
   * @param {string[]|null} cats
   * @param {number} [limit]
   * @returns {{n: number, list: object[]}}
   */
  static list(filter, cats, limit = this.LIMIT) {
    const found = this._pool(cats).filter(card => this.matches(card, filter, cats));
    const keys = new Map(found.map(card => [card, PickFind.key(card)]));
    return { n: found.length, list: found.sort((one, two) => keys.get(one) - keys.get(two)).slice(0, limit) };
  }

  /**
   * Изменение поля фильтра.
   * @param {object} filter
   * @param {HTMLElement} field
   * @returns {boolean} поменялся набор полей (перерисовать фильтры)
   */
  static set(filter, field) {
    const name = field.dataset.pf;
    const value = field.value;
    if (name === 'cat') {
      filter.cat = value;
      filter.f = {};
      filter.r = {};
      return true;
    }
    if (name === 'maker' || name === 'q') {
      filter[name] = value;
      return false;
    }
    const [kind, key] = name.split(':');
    if (kind === 'f') {
      filter.f[key] = value;
      return false;
    }
    const range = (filter.r[key] = filter.r[key] || ['', '']);
    range[kind === 'rmin' ? 0 : 1] = value;
    return false;
  }

  /**
   * Строка списка подбора.
   * @param {object} card
   * @param {string} attr атрибут кнопки
   * @param {string} [tag] метка перед названием
   * @param {string} [cls] класс кнопки
   * @returns {string}
   */
  static row(card, attr, tag = '', cls = '') {
    const photo =
      card.photo && card.photo.src
        ? `<img src="${esc(card.photo.src)}" alt="" loading="lazy" decoding="async">`
        : '<span class="kit-noimg"></span>';
    const params = ItemSpec.mainLine(card, this.MAIN_PARAMS);
    const cost = card.cost ? ` · закупка ${KPGen.money(card.cost)} ${esc(card.costCur || 'RUB')}` : '';
    return `<button type="button" class="kit-pick${cls}" ${attr}="${esc(card.id)}">${photo}<span>${tag}<b>${esc(card.name)}</b><small class="muted">${esc(EquipTypes.byId(Attrs.of(card).cat).name)}${params ? ` · ${esc(params)}` : ''}${cost}</small></span></button>`;
  }

  /**
   * Наибольшее число в значении («7,5 / 10 / 13 бар» → 13).
   * @param {*} value
   * @returns {number|null}
   */
  static top(value) {
    const found = String(value ?? '')
      .replace(/\s+/g, '')
      .replace(/[−–]/g, '-')
      .match(/-?\d+(?:[.,]\d+)?/g);
    return found ? Math.max(...found.map(text => +text.replace(',', '.'))) : null;
  }
}
