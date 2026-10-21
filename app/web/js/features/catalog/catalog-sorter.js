import { CatalogIndex } from './catalog-index.js';
import { Morph } from '../../core/morph.js';
import { $, esc } from '../../core/util.js';
import { Str } from '../../core/str.js';
import { Api } from '../../core/net.js';
import { S } from '../../core/state.js';
import { EquipTypes } from '../../core/equip-types.js';

/** Сортировки окна каталога: поле + направление (↑ / ↓); позиции без значения — всегда в конце; цены — в рублях по курсу ЦБ. */
export class CatalogSorter {
  static SORTS = [
    [
      'best',
      'Рекомендуемые',
      1,
      'Сначала в наличии и с ценой, затем по основному параметру категории (при поиске — сначала точные совпадения модели)',
    ],
    ['price', 'Цена', 1, 'В рублях по курсу ЦБ; без цены — закупочная цена, иначе в конце'],
    ['stock', 'Наличие', -1, 'Больше всего на складе — первыми'],
    ['name', 'Название', 1, 'По алфавиту, номера моделей — по возрастанию чисел'],
    ['kp', 'Популярные в КП', -1, 'Чаще всего попадали в коммерческие предложения'],
    ['upd', 'Обновлённые', -1, 'Недавно изменённые позиции'],
  ];
  static COLL = new Intl.Collator('ru', { numeric: true }); // в разы быстрее localeCompare
  static NO_ORDER = 999;
  static NO_PRICE = 2;
  static FIELD = 'f:';
  static GETTERS = {
    price: (sorter, card) => sorter.priceRub(card),
    stock: (sorter, card) => CatalogSorter.stockN(card),
    kp: (sorter, card) => card.pricesCount || (card.prices || []).length,
    upd: (sorter, card) => Date.parse(card.updatedAt || '') || null,
  };

  /**
   * Направление сортировки по умолчанию.
   * @param {string} key
   * @returns {number}
   */
  static def(key) {
    const sort = this.SORTS.find(row => row[0] === key);
    return sort ? sort[2] : 1;
  }

  /**
   * Остаток на складе (или null).
   * @param {object} card
   * @returns {number|null}
   */
  static stockN(card) {
    const stock = card.stock;
    if (!stock || stock.gone) return null;
    if (stock.qty != null) return stock.qty > 0 ? stock.qty : null;
    return stock.available ? 1 : null;
  }

  static _byName(first, second) {
    return CatalogSorter.COLL.compare(String(first.name), String(second.name));
  }

  static _value(value) {
    return value == null || !isFinite(value) || value === 0 ? null : value;
  }

  // пустые — в конце при любом направлении
  static _cmpNull(first, second, dir) {
    if (first == null) return second == null ? 0 : 1;
    if (second == null) return -1;
    return (first - second) * dir;
  }

  constructor(win) {
    this.win = win;
    this.fx = null; // курсы ЦБ к рублю: цены в разных валютах сравниваются в рублях
    this.fxLoading = false;
  }

  /**
   * Числовые параметры выбранной категории.
   * @returns {object[]}
   */
  fields() {
    const filter = this.win.F;
    const type = filter.cat ? EquipTypes.byId(filter.cat) : null;
    return type ? type.fields.filter(field => field.num) : [];
  }

  /**
   * Сумма в рублях по курсу (или null).
   * @param {number} value
   * @param {string} cur
   * @returns {number|null}
   */
  rub(value, cur) {
    if (!value) return null;
    const code = cur || 'RUB';
    if (code === 'RUB') return value;
    const rate = +this.fx?.[code] || +String(S.pricing?.rates?.[code] || '').replace(',', '.');
    return rate > 0 ? value * rate : null;
  }

  /**
   * Цена позиции в рублях: цена, иначе закупка.
   * @param {object} card
   * @returns {number|null}
   */
  priceRub(card) {
    if (card.price) return this.rub(card.price, card.priceCur);
    return card.cost ? this.rub(card.cost, card.costCur) : null;
  }

  /** Курсы ЦБ — один раз; сортировка по цене перерисовывается. */
  loadFx() {
    if (this.fx || this.fxLoading) return;
    this.fxLoading = true;
    Api.request('/api/cbr')
      .then(rates => {
        if (rates && (rates.EUR || rates.USD)) {
          this.fx = rates;
          if (this.win.F.sort === 'price') this.win.list();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.fxLoading = false;
      });
  }

  _by(getter, dir) {
    const memo = new Map();
    const value = card => {
      if (!memo.has(card.id)) memo.set(card.id, CatalogSorter._value(getter(card)));
      return memo.get(card.id);
    };
    return (first, second) =>
      CatalogSorter._cmpNull(value(first), value(second), dir) || CatalogSorter._byName(first, second);
  }

  _getter(sort) {
    if (sort.startsWith(CatalogSorter.FIELD)) {
      const key = sort.slice(CatalogSorter.FIELD.length);
      return card => Str.num(CatalogIndex.attrs(card)[key]);
    }
    const getter = CatalogSorter.GETTERS[sort];
    return getter ? card => getter(this, card) : null;
  }

  /**
   * Сравнение позиций для текущей сортировки.
   * @returns {function(object, object): number}
   */
  compare() {
    const filter = this.win.F;
    const dir = filter.dir || 1;
    if (filter.sort === 'name') return (first, second) => CatalogSorter._byName(first, second) * dir;
    const getter = this._getter(filter.sort);
    return getter ? this._by(getter, dir) : this._best(filter, dir);
  }

  // рекомендуемые: точные совпадения → в наличии с ценой → с ценой → остальные; внутри — по разделам и основному параметру;
  // ключ позиции считается один раз (сравнений — сотни тысяч на 20 000 позиций)
  _best(filter, dir) {
    const order = new Map(EquipTypes.list.map((type, i) => [type.id, i]));
    const query = String(filter.q || '').trim();
    const keys = new Map();
    const key = card => {
      let found = keys.get(card.id);
      if (found) return found;
      const attrs = CatalogIndex.attrs(card);
      const type = EquipTypes.byId(attrs.cat);
      found = {
        r: query ? filter.rel(card) : 0,
        t: (card.price || card.cost ? 0 : CatalogSorter.NO_PRICE) + (CatalogIndex.inStock(card) ? 0 : 1),
        o: order.get(attrs.cat) ?? CatalogSorter.NO_ORDER,
        m: CatalogSorter._value(Str.num(attrs[type.main || 'kw'])),
      };
      keys.set(card.id, found);
      return found;
    };
    return (first, second) => {
      const one = key(first);
      const two = key(second);
      return (
        one.r - two.r ||
        one.t - two.t ||
        one.o - two.o ||
        CatalogSorter._cmpNull(one.m, two.m, dir) ||
        CatalogSorter._byName(first, second)
      );
    };
  }

  _options(fields) {
    const filter = this.win.F;
    const sorts = CatalogSorter.SORTS.map(
      ([key, label, , hint]) =>
        `<option value="${key}" title="${esc(hint)}"${filter.sort === key ? ' selected' : ''}>${label}</option>`,
    ).join('');
    if (!fields.length) return sorts;
    const params = fields
      .map(
        field =>
          `<option value="f:${esc(field.key)}"${filter.sort === `f:${field.key}` ? ' selected' : ''}>${esc(field.label)}${field.unit ? `, ${esc(field.unit)}` : ''}</option>`,
      )
      .join('');
    return `${sorts}<optgroup label="Параметры: ${esc(EquipTypes.byId(filter.cat).name)}">${params}</optgroup>`;
  }

  _dirText(rising) {
    if (this.win.F.sort === 'name') return rising ? 'А→Я' : 'Я→А';
    return rising ? '↑ по возрастанию' : '↓ по убыванию';
  }

  /** Список сортировок (плюс числовые параметры выбранной категории) и кнопка направления. */
  renderBox() {
    const filter = this.win.F;
    const select = $('#cwSort');
    const dirButton = $('#cwDir');
    if (!select) return;
    const fields = this.fields();
    const known = CatalogSorter.SORTS.some(row => row[0] === filter.sort);
    const param = filter.sort.startsWith('f:') && fields.some(field => `f:${field.key}` === filter.sort);
    if (!known && !param) {
      filter.sort = 'best';
      filter.dir = 1;
    }
    Morph.apply(select, this._options(fields));
    select.value = filter.sort;
    const rising = filter.dir > 0;
    dirButton.textContent = this._dirText(rising);
    dirButton.title = 'Сменить направление сортировки';
    dirButton.setAttribute(
      'aria-label',
      rising ? 'По возрастанию — сменить на убывание' : 'По убыванию — сменить на возрастание',
    );
    dirButton.hidden = filter.sort === 'best';
  }
}
