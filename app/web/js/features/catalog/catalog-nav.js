import { CatalogFilter } from './catalog-filter.js';
import { CatalogIndex } from './catalog-index.js';

/** Отбор в окне каталога: верхняя панель, плашки условий, левая панель (фильтры по параметрам и дерево категорий). */
export class CatalogNav {
  static OTHER = 'Прочее';
  static QUICK_CATS = 10;
  static FOLD_KEY = 'kp.cwfold';
  static ZERO_KEY = 'kp.cwzero';

  static _sorted(counts) {
    return [...counts.values()].sort((first, second) =>
      String(first.v).localeCompare(String(second.v), 'ru', { numeric: true }),
    );
  }

  static _groups() {
    return [...new Set(TYPES.map(type => type.group || this.OTHER))];
  }

  static _count(counts, value) {
    if (value == null || value === '') return;
    const key = norm(value);
    const found = counts.get(key) || { v: String(value), n: 0 };
    found.n++;
    counts.set(key, found);
  }

  static _facetOptions(opts, cur) {
    return opts
      .map(
        opt =>
          `<option value="${esc(opt.v)}"${norm(cur) === norm(opt.v) ? ' selected' : ''}>${esc(opt.v)} (${opt.n})</option>`,
      )
      .join('');
  }

  /**
   * Фильтр-список по параметру с числом позиций у каждого значения.
   * @param {object} win окно каталога
   * @param {{key: string, label: string, inF: boolean}} facet inF — параметр категории (иначе поле отбора)
   * @returns {string}
   */
  static facet(win, { key, label, inF }) {
    const filter = win.F;
    const counts = new Map();
    win.docs
      .filter(card => win.pass(card, key))
      .forEach(card => {
        const value = CatalogIndex.attrs(card)[key];
        if (value == null || value === '') return;
        const found = counts.get(CatalogIndex.normValue(card, key)) || { v: String(value), n: 0 };
        found.n++;
        counts.set(CatalogIndex.normValue(card, key), found);
      });
    const cur = inF ? filter.f[key] : filter[key];
    const opts = this._sorted(counts);
    if (!opts.length && !cur) return '';
    const extra = cur && !counts.has(norm(cur)) ? `<option selected>${esc(cur)}</option>` : '';
    return `<label class="f"><span>${esc(label)}</span><select data-f="${key}" data-in="${inF ? 1 : ''}"><option value="">Все</option>${this._facetOptions(opts, cur)}${extra}</select></label>`;
  }

  static _chipText(low, high) {
    if (high == null) return `от ${Str.comma(low)}`;
    return low ? `${Str.comma(low)}–${Str.comma(high)}` : `до ${Str.comma(high)}`;
  }

  static _rangeChips(field, range) {
    const chips = field.chips || [];
    if (!chips.length) return '';
    const html = chips
      .map(([low, high]) => {
        const picked = String(range.min) === String(low || '') && String(range.max) === String(high ?? '');
        return `<button class="chip${picked ? ' on' : ''}" type="button" data-rc="${esc(field.key)}" data-lo="${low || ''}" data-hi="${high ?? ''}">${this._chipText(low, high)}</button>`;
      })
      .join('');
    return `<div class="chips">${html}</div>`;
  }

  /**
   * Диапазон «от / до» по числовому параметру и быстрые кнопки диапазонов.
   * @param {object} win
   * @param {object} field
   * @returns {string}
   */
  static range(win, field) {
    const range = win.F.rng[field.key] || { min: '', max: '' };
    const has = win.docs.some(card => win.pass(card, field.key) && numOf(CatalogIndex.attrs(card)[field.key]) != null);
    if (!has && range.min === '' && range.max === '') return '';
    return `<div class="f"><span class="muted">${esc(field.label)}${field.unit ? `, ${esc(field.unit)}` : ''}</span><div class="kw"><input type="text" inputmode="decimal" data-rk="${esc(field.key)}" data-rs="min" placeholder="от" value="${esc(range.min ?? '')}"><input type="text" inputmode="decimal" data-rk="${esc(field.key)}" data-rs="max" placeholder="до" value="${esc(range.max ?? '')}"></div>
      ${this._rangeChips(field, range)}</div>`;
  }

  /**
   * Сколько позиций у каждого значения (без учёта этого же условия).
   * @param {object} win
   * @param {string} key
   * @param {function(object): *} value
   * @returns {Map<string, {v: string, n: number}>}
   */
  static counts(win, key, value) {
    const counts = new Map();
    win.docs.forEach(card => {
      if (!win.kindOk(card) || !win.pass(card, key)) return;
      this._count(counts, value(card));
    });
    return counts;
  }

  /**
   * Выпадающий список верхней панели.
   * @param {{key: string, label: string, counts: Map, cur: string, all: string}} select
   * @returns {string}
   */
  static selHtml({ key, label, counts, cur, all }) {
    const opts = this._sorted(counts)
      .map(
        opt =>
          `<option value="${esc(opt.v)}"${norm(cur) === norm(opt.v) ? ' selected' : ''}>${esc(opt.v)} · ${opt.n}</option>`,
      )
      .join('');
    const has = !cur || counts.has(norm(cur));
    return `<label class="cw-sel${cur ? ' on' : ''}"><span>${label}</span><select data-top="${key}" aria-label="${label}"><option value="">${all}</option>${opts}${has ? '' : `<option selected>${esc(cur)} · 0</option>`}</select></label>`;
  }

  static _catGroup(filter, counts, group) {
    const types = TYPES.filter(
      type => (type.group || this.OTHER) === group && ((counts.get(norm(type.id)) || {}).n || filter.cat === type.id),
    );
    if (!types.length) return '';
    const opts = types
      .map(
        type =>
          `<option value="${esc(type.id)}"${filter.cat === type.id ? ' selected' : ''}>${esc(type.name)} · ${(counts.get(norm(type.id)) || {}).n || 0}</option>`,
      )
      .join('');
    return `<optgroup label="${esc(group)}">${opts}</optgroup>`;
  }

  static _catSelect(win) {
    const filter = win.F;
    const counts = this.counts(win, 'cat', card => CatalogIndex.attrs(card).cat);
    const total = [...counts.values()].reduce((sum, found) => sum + found.n, 0);
    const groups = this._groups()
      .map(group => this._catGroup(filter, counts, group))
      .join('');
    return `<label class="cw-sel cw-selcat${filter.cat ? ' on' : ''}"><span>Категория</span><select data-top="cat" aria-label="Категория"><option value="">Все категории · ${total}</option>${groups}</select></label>`;
  }

  static _toggles(filter) {
    return `<div class="cw-togs"><label class="cw-tog${filter.priced ? ' on' : ''}"><input type="checkbox" id="cwPriced" ${filter.priced ? 'checked' : ''}> С ценой</label>
         <label class="cw-tog${filter.stock ? ' on' : ''}" title="Есть на складе поставщика (по фиду или файлу остатков)"><input type="checkbox" id="cwStock" ${filter.stock ? 'checked' : ''}> В наличии</label></div>`;
  }

  /**
   * Верхняя панель: категория, производитель, поставщик, «с ценой», «в наличии» — видны всегда, без прокрутки.
   * @param {object} win
   */
  static bar(win) {
    const filter = win.F;
    const box = $('#cwBar');
    if (!box) return;
    const maker = this.selHtml({
      key: 'maker',
      label: 'Производитель',
      counts: this.counts(win, 'maker', card => CatalogIndex.attrs(card).maker),
      cur: filter.maker,
      all: 'Все производители',
    });
    const sup = this.selHtml({
      key: 'sup',
      label: 'Поставщик',
      counts: this.counts(win, 'sup', card => win.supplierOf(card) || CatalogFilter.NOSUP),
      cur: filter.sup,
      all: 'Все поставщики',
    });
    morph(box, this._catSelect(win) + maker + sup + this._toggles(filter));
  }

  static _rangeText(field, range) {
    const min = (range.min ?? '') !== '';
    const max = (range.max ?? '') !== '';
    return `${field.label}: ${min ? `от ${Str.comma(+range.min)}` : ''}${min && max ? ' ' : ''}${max ? `до ${Str.comma(+range.max)}` : ''}${field.unit ? ` ${field.unit}` : ''}`;
  }

  static _topChips(filter, type, chip) {
    if (String(filter.q || '').trim()) chip('q', `«${filter.q.trim()}»`);
    if (filter.grp) chip('grp', `Раздел: ${filter.grp}`);
    if (type) chip('cat', type.name);
    if (filter.maker) chip('maker', filter.maker);
    if (filter.sup) chip('sup', `Поставщик: ${filter.sup}`);
    if (filter.series) chip('series', `Серия ${filter.series}`);
  }

  static _chipList(filter, type) {
    const out = [];
    const chip = (key, text) => out.push([key, text]);
    this._topChips(filter, type, chip);
    for (const key in filter.f) {
      if (!filter.f[key]) continue;
      const field = type?.fields.find(row => row.key === key);
      chip(`f:${key}`, (field ? `${field.label}: ` : '') + filter.f[key]);
    }
    for (const key in filter.rng) {
      const range = filter.rng[key];
      if (!CatalogFilter.rngOn(range)) continue;
      chip(`r:${key}`, this._rangeText(type?.fields.find(row => row.key === key) || { label: key }, range));
    }
    if (filter.priced) chip('priced', 'С ценой');
    if (filter.stock) chip('stock', 'В наличии');
    return out;
  }

  // раздел: его категории — кнопками над списком (число позиций — во всём каталоге)
  static _subs(filter) {
    const section = filter.grp ? CatSections.get(filter.grp) : null;
    if (!section) return '';
    const buttons = [{ id: '', name: 'Все', n: section.n }, ...section.types.filter(type => type.n)]
      .map(
        type =>
          `<button type="button" class="chip${(filter.cat || '') === type.id ? ' on' : ''}" data-gcat="${esc(type.id)}">${esc(type.name)} · ${Fmt.num(type.n)}</button>`,
      )
      .join('');
    return `<div class="cw-subs" role="group" aria-label="Категории раздела">${buttons}</div>`;
  }

  /**
   * Выбранные условия — плашками с крестиком над списком.
   * @param {object} win
   * @returns {string}
   */
  static chips(win) {
    const filter = win.F;
    const type = filter.cat ? typeById(filter.cat) : null;
    const out = this._chipList(filter, type).map(
      ([key, text]) =>
        `<button type="button" class="cw-chip" data-chip="${esc(key)}" title="Убрать условие">${esc(text)}<i aria-hidden="true">✕</i></button>`,
    );
    const clear = out.length
      ? `${out.join('')}<button type="button" class="lnk cw-clr" data-cw="resetall">Сбросить всё</button>`
      : '';
    return this._subs(filter) + clear;
  }

  static _tabs(tab, filter) {
    const params = filter.paramCount();
    return `<div class="cw-tabs" role="tablist"><button type="button" role="tab" class="${tab === 'flt' ? 'on' : ''}" aria-selected="${tab === 'flt'}" data-tab="flt">Фильтры${params ? ` <b>${params}</b>` : ''}</button>
      <button type="button" role="tab" class="${tab === 'cats' ? 'on' : ''}" aria-selected="${tab === 'cats'}" data-tab="cats">Категории</button></div>`;
  }

  static _countCats(win) {
    const counts = new Map();
    let all = 0;
    win.docs.forEach(card => {
      if (!win.kindOk(card)) return;
      const cat = CatalogIndex.attrs(card).cat;
      counts.set(cat, (counts.get(cat) || 0) + 1);
      all++;
    });
    return { counts, all };
  }

  /**
   * Левая панель: вкладки «Фильтры» (параметры категории — сразу сверху) и «Категории» (дерево, перенос перетаскиванием).
   * @param {object} win
   */
  static nav(win) {
    const filter = win.F;
    const { counts, all } = this._countCats(win);
    const type = filter.cat ? typeById(filter.cat) : null;
    const tab = win.tab || (type ? 'flt' : 'cats');
    const body = tab === 'cats' ? CatalogTree.html(win, counts, all) : this._filters(win, counts, type);
    morph(
      $('#cwNav'),
      `${this._tabs(tab, filter)}${body}<div class="cw-navok"><button class="btn primary" type="button" data-cw="nav" id="cwNavOk">Показать позиции</button></div>`,
    );
  }

  static _params(win, type) {
    let html = this.facet(win, { key: 'series', label: 'Серия', inF: false });
    if (!type) return html;
    for (const field of type.fields) if (field.range) html += this.range(win, field);
    for (const field of type.fields) {
      if (field.facet) html += this.facet(win, { key: field.key, label: field.label, inF: true });
    }
    return html;
  }

  static _quickCats(counts) {
    const top = [...counts.entries()]
      .filter(([, count]) => count)
      .sort((first, second) => second[1] - first[1])
      .slice(0, this.QUICK_CATS);
    return `<p class="cw-hint" style="margin:0">Выберите категорию — появятся фильтры по её параметрам: мощность, давление, производительность…</p>
            <div class="cw-qcat">${top.map(([id, count]) => `<button type="button" class="chip" data-cat="${esc(id)}">${esc(typeById(id).name)} <i>${count}</i></button>`).join('')}</div>`;
  }

  static _filters(win, counts, type) {
    const filter = win.F;
    const reset = filter.isFiltered() ? '<button type="button" class="lnk" data-cw="reset">сбросить</button>' : '';
    const setup =
      type && win.optFor == null
        ? `<button type="button" class="lnk cw-tset2" data-cw="types">⚙ Какие параметры показывать в фильтрах</button>`
        : '';
    return `<p class="cw-cap">${type ? esc(type.name) : 'Все категории'} ${reset}</p>
        <div class="cw-flt">${this._params(win, type)}
          ${type ? '' : this._quickCats(counts)}
          ${setup}</div>`;
  }
}

/** Дерево категорий окна каталога: разделы сворачиваются, пустые категории скрываются, позиции переносятся перетаскиванием. */
export class CatalogTree {
  static _prefs() {
    let fold = {};
    let hideZero = false;
    try {
      fold = JSON.parse(localStorage.getItem(CatalogNav.FOLD_KEY) || '{}') || {};
      hideZero = localStorage.getItem(CatalogNav.ZERO_KEY) === '1';
    } catch {
      // браузер не хранит
    }
    return { fold, hideZero };
  }

  static _shown(win, counts, hideZero) {
    const filter = win.F;
    return type => {
      const own = counts.get(type.id) || filter.cat === type.id;
      return (win.optFor == null || type.role === 'accessory' || own) && (!hideZero || own);
    };
  }

  static _cat(filter, type, count) {
    return `<button type="button" class="cw-cat${filter.cat === type.id ? ' on' : ''}${count ? '' : ' zero'}" data-cat="${esc(type.id)}" data-dropcat="${esc(type.id)}" title="${esc(type.name)}"><span>${esc(type.name)}</span><i>${count}</i></button>`;
  }

  static _group(win, { group, counts, prefs }) {
    const filter = win.F;
    const shown = this._shown(win, counts, prefs.hideZero);
    const types = TYPES.filter(type => (type.group || CatalogNav.OTHER) === group && shown(type));
    if (!types.length) return '';
    const total = types.reduce((sum, type) => sum + (counts.get(type.id) || 0), 0);
    const shut = !!prefs.fold[group] && !types.some(type => type.id === filter.cat);
    const head = `<button type="button" class="cw-grp${shut ? ' shut' : ''}" data-cwfold="${esc(group)}" aria-expanded="${!shut}" title="${shut ? 'Развернуть' : 'Свернуть'} раздел"><span>${esc(group)}</span><i>${total}</i></button>`;
    if (shut) return head;
    return head + types.map(type => this._cat(filter, type, counts.get(type.id) || 0)).join('');
  }

  /**
   * Вкладка «Категории».
   * @param {object} win
   * @param {Map<string, number>} counts
   * @param {number} all
   * @returns {string}
   */
  static html(win, counts, all) {
    const filter = win.F;
    const prefs = this._prefs();
    const cats = CatalogNav._groups()
      .map(group => this._group(win, { group, counts, prefs }))
      .join('');
    const main = win.optFor == null;
    return `${main ? '<p class="cw-hint">Позиции можно перетащить мышью на другую категорию.</p>' : ''}<div class="cw-cats">
          <button type="button" class="cw-cat all${!filter.cat ? ' on' : ''}" data-cat=""><span>Все позиции</span><i>${all}</i></button>${cats}
          ${main ? '<button type="button" class="cw-cat add" data-cw="newtype">+ Новая категория</button>' : ''}
          <label class="cw-chk cw-zero"><input type="checkbox" data-cwzero ${prefs.hideZero ? 'checked' : ''}> Скрыть пустые категории</label></div>
        ${main ? `<p class="cw-cap"><button type="button" class="lnk cw-tset" data-cw="types" title="Параметры, фильтры, ключевые параметры на титуле, быстрые опции">⚙ Настроить категории</button></p>` : ''}`;
  }

  /**
   * Свернуть или развернуть раздел.
   * @param {string} group
   */
  static fold(group) {
    let fold = {};
    try {
      fold = JSON.parse(localStorage.getItem(CatalogNav.FOLD_KEY) || '{}') || {};
    } catch {
      // браузер не хранит
    }
    fold[group] = !fold[group];
    try {
      localStorage.setItem(CatalogNav.FOLD_KEY, JSON.stringify(fold));
    } catch {
      // браузер не хранит
    }
  }

  /**
   * Скрывать пустые категории.
   * @param {boolean} hide
   */
  static hideZero(hide) {
    try {
      localStorage.setItem(CatalogNav.ZERO_KEY, hide ? '1' : '0');
    } catch {
      // браузер не хранит
    }
  }
}
