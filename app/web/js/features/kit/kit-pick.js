import { Kit } from './kit.js';
import { KitPart } from './kit-part.js';
import { StationDefaults } from './station-defaults.js';
import { StationAuto, StationName } from './station-auto.js';
import { StationUi } from '../station/station-ui.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { FormView } from '../../ui/form-view.js';
import { KitScope } from './kit-scope.js';
import { KpState, S } from '../../core/state.js';
import { ItemSpec } from '../../core/item-spec.js';
import { KitNeed } from './kit-need.js';
import { $, esc } from '../../core/util.js';
import { Catalog } from '../catalog/catalog-store.js';
import { EquipTypes } from '../../core/equip-types.js';
import { TzPick } from '../tz/tz-pick.js';
import { Str } from '../../core/str.js';
import { Attrs, CatAttrs } from '../../core/item-attrs.js';

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
    const top = KitNeed.top(value);
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
}

/**
 * Окно выбора позиции каталога для элемента состава: cats — только эти категории, role — роль элемента, preset — подбор по
 * нужному (KitNeed): фильтры {f, r, min, test}, строка need («что нужно» — над списком, с «Показать все»), рекомендуемый
 * best {id, n} — первым, количество, замена прежних элементов; для нового элемента — строки rows и attrs.
 */
export class KitPick {
  static ROWS = 60;
  static FOCUS_DELAY = 30;

  /**
   * Открыть окно подбора.
   * @param {number} index позиция КП
   * @param {{cats?: string[], role?: string, name?: string, preset?: object, by?: string}} [options]
   */
  static open(index, options = {}) {
    new KitPick(index, options)._show();
  }

  constructor(index, { cats = null, role = null, name = '', preset = null, by: scope = '' } = {}) {
    Object.assign(this, { index, cats, role, name, preset, by: scope });
    this.dialog = $('#dlg');
    this.dialog.classList.add('wide');
    this.filter = PickFilter.create(cats);
    if (name && !cats) this.filter.q = name;
    this.all = false;
    this._usePreset();
    this.best = preset && preset.best ? Catalog.cache.find(card => card.id === preset.best.id) : null;
  }

  _usePreset() {
    const { preset, filter } = this;
    if (!preset) return;
    Object.assign(filter.f, preset.f || {});
    for (const [key, range] of Object.entries(preset.r || {})) filter.r[key] = [...range];
    filter.min = { ...(preset.min || {}) };
    filter.test = preset.test || null;
  }

  _newButton() {
    return `<button class="btn" type="button" data-kitnew="1">+ Новый элемент${this.name ? ` «${esc(this.name)}»` : ''}</button>`;
  }

  _title() {
    if (this.role === 'main') return `${esc(Kit.station(S.items[this.index]).mainLabel)} — подбор в каталоге`;
    return this.name ? `${esc(this.name)} — подбор в каталоге` : 'Элемент из каталога';
  }

  _head() {
    const { preset, all } = this;
    if (!preset || !preset.need) return '';
    const text = all ? 'Показаны все. Отметка «мало» — не подходит по нужному.' : `✓ ${esc(preset.need)}`;
    return `<div class="pf-need${all ? ' all' : ''}"><span>${text}</span><button class="btn sm ghost" type="button" data-pfall>${all ? 'Только подходящие' : 'Показать все'}</button></div>`;
  }

  /** рекомендуемый — первым, даже если считан точнее фильтров; поиск, вид и производитель — соблюдаем */
  _top() {
    if (!this.best) return false;
    const filter = this.all ? this.filter : { ...this.filter, f: {}, r: {}, min: {}, test: null };
    return PickFilter.matches(this.best, filter, this.cats);
  }

  _tag(card) {
    const { preset } = this;
    if (card === this.best) return `<span class="pf-best">★ Рекомендуем${this._bestNote()}</span>`;
    return this.all && preset && !KitNeed.fits(card, preset) ? '<span class="pf-low">мало</span>' : '';
  }

  _bestNote() {
    const best = this.preset.best;
    if (best.label) return `: ${esc(best.label)}`;
    return best.n > 1 ? `: ${best.n} шт. параллельно` : '';
  }

  _list() {
    const found = PickFilter.list(this.filter, this.cats, KitPick.ROWS);
    const cards = this._top() ? [this.best, ...found.list.filter(card => card.id !== this.best.id)] : found.list;
    const more = found.n > KitPick.ROWS ? ' — показаны первые 60, уточните фильтры' : '';
    const rows = cards
      .map(card => PickFilter.row(card, 'data-cid', this._tag(card), card === this.best ? ' best' : ''))
      .join('');
    return `<p class="muted pf-n">Найдено: ${found.n}${more}</p>${rows || this._none()}`;
  }

  _none() {
    return `<div class="kit-none"><p>В каталоге нет подходящего${this.name ? ` для «${esc(this.name)}»` : ''}.</p>${this._newButton()}<small class="muted">Элемент появится в составе — описание и характеристики заполните вручную или кнопкой «✨ ИИ».</small></div>`;
  }

  _draw() {
    $('#kitPN').innerHTML = this._head();
    $('#kitPF').innerHTML = PickFilter.html(this.filter, this.cats);
    $('#kitPL').innerHTML = this._list();
  }

  _show() {
    const dialog = this.dialog;
    dialog.innerHTML = `<div class="dlg-h"><h3>${this._title()}</h3>${this._newButton()}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><div id="kitPN"></div><div id="kitPF"></div><div class="kit-pl" id="kitPL"></div></div>`;
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    this._draw();
    if (!this.preset) setTimeout(() => dialog.querySelector('[data-pf="q"]')?.focus(), KitPick.FOCUS_DELAY);
    $('#kitPF').oninput = event => this._input(event);
    $('#kitPF').onchange = event => {
      if (event.target.tagName === 'SELECT') this._filterChanged(event);
    };
    dialog.querySelector('.dlg-h [data-kitnew]').onclick = () => this._addNew();
    $('#kitPN').onclick = event => this._toggleAll(event);
    $('#kitPL').onclick = event => this._click(event);
  }

  _input(event) {
    if (event.target.tagName !== 'INPUT') return;
    if (event.target.dataset.pf === 'q') PickFind.later(() => this.dialog.open && this._filterChanged(event));
    else this._filterChanged(event);
  }

  _filterChanged(event) {
    const field = event.target.closest('[data-pf]');
    if (!field) return;
    if (PickFilter.set(this.filter, field)) this._draw();
    else $('#kitPL').innerHTML = this._list();
  }

  /** «Показать все» — без фильтров по нужному (неподходящие — с отметкой «мало»), «Только подходящие» — вернуть */
  _toggleAll(event) {
    if (!event.target.closest('[data-pfall]')) return;
    this.all = !this.all;
    if (this.all) Object.assign(this.filter, { f: {}, r: {}, min: {}, test: null, maker: '' });
    else this._usePreset();
    this._draw();
  }

  _click(event) {
    if (event.target.closest('[data-kitnew]')) {
      this._addNew();
      return;
    }
    const button = event.target.closest('[data-cid]');
    if (button) this._pick(button.dataset.cid);
  }

  _item() {
    const item = S.items[this.index];
    item.kit = item.kit || { parts: [] };
    return item;
  }

  _role(part) {
    if (this.role) part.role = this.role;
    if (this.by && this.by !== KitScope.def(part)) part.by = this.by;
  }

  /** количество (рекомендуемый — сколько нужно параллельно), ступень фильтра, роль ресивера, замена прежних элементов */
  _put(item, part, cardId) {
    const { preset, best } = this;
    const qty = best && cardId === best.id ? preset.best.n : preset && preset.qty;
    if (qty > 1) part.qty = qty;
    if (!preset) return;
    if (preset.grade) part.airGrade = preset.grade;
    if (preset.role) part.recvRole = preset.role;
    if (!Array.isArray(preset.replace)) return;
    const place = item.kit.parts.findIndex(line => preset.replace.includes(line.id));
    if (preset.swapRow && place >= 0) part._at = place;
    item.kit.parts = item.kit.parts.filter(line => !preset.replace.includes(line.id));
  }

  _addNew() {
    const item = this._item();
    const part = StationDefaults.fill(Kit.newPart({ name: this.name || (this.filter.q || '').trim() }), item);
    if (this.role) part.role = this.role;
    this._presetRows(part);
    if (this.by && this.by !== KitScope.def(part)) part.by = this.by;
    this._put(item, part);
    item.kit.parts.push(part);
    item.page = true;
    this.dialog.close();
    FormView.render();
    KpState.persist();
    Toast.show('Элемент добавлен — описание и характеристики: вручную или кнопкой «✨ ИИ»');
  }

  _presetRows(part) {
    const { preset } = this;
    if (!preset) return;
    if (preset.attrs)
      part.attrs = Object.fromEntries(
        Object.entries(preset.attrs).filter(([, value]) => value != null && value !== ''),
      );
    for (const row of preset.rows || []) if (!part.rows.some(line => line.k === row.k)) part.rows.push({ ...row });
  }

  async _pick(cardId) {
    const lite = Catalog.cache.find(card => card.id === cardId);
    let doc = lite;
    try {
      doc = await Api.request(`/api/catalog/${encodeURIComponent(lite.id)}`);
    } catch {
      // нет связи — элемент из краткой карточки
    }
    const item = this._item();
    const part = KitPart.fromCat(doc);
    this._role(part);
    this._put(item, part, lite.id);
    this._insert(item, part);
    Kit.sync(item);
    StationAuto.fill(item);
    StationName.apply(item);
    StationUi.cache.delete(item.id);
    this.dialog.close();
    FormView.render();
    KpState.persist();
    const qty = +part.qty > 1 ? `${part.qty} × ` : '';
    Toast.show(`${this.preset && this.preset.replace ? 'Заменено: ' : 'Добавлено в состав: '}${qty}${doc.name}`);
  }

  /** «⇄ Заменить» в строке — на её место; основное оборудование — перед контейнером */
  _insert(item, part) {
    const parts = item.kit.parts;
    if (part._at != null) {
      parts.splice(Math.min(part._at, parts.length), 0, part);
      delete part._at;
    } else if (this.role === 'main') {
      const place = parts.findIndex(line => line.role === 'container');
      parts.splice(place >= 0 ? place : 0, 0, part);
    } else parts.push(part);
  }
}
