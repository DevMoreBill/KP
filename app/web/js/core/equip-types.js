import { Api } from './net.js';

/**
 * Типы оборудования (категории): справочник TYPES (встроенные из app/equipment_types.json + свои отдела, с сервера),
 * определение типа позиции, выбор типа, опции типа. TYPES и TYPES_BUILTIN — общие переменные core/state.js: загрузка
 * заменяет массив целиком (окна, которые помнят разбор по TYPES, видят, что справочник сменился).
 */
export class EquipTypes {
  static LEGACY = { ДГУ: 'dgu', 'Осветительная мачта': 'light', 'Шкаф АВР': 'ats', Прочее: 'other', Опция: 'ats' };
  static DEFAULT_OPTIONS = [
    ['Доставка до объекта', 'доставка', 'усл.'],
    ['Пусконаладочные работы', 'ПНР', 'усл.'],
  ];

  /**
   * Свои типы отдела: новые и изменённые относительно встроенного справочника (сохраняются в базе).
   * @returns {object[]}
   */
  static user() {
    const base = new Map(((TYPES_BUILTIN && TYPES_BUILTIN.types) || []).map(type => [type.id, JSON.stringify(type)]));
    return TYPES.filter(type => base.get(type.id) !== JSON.stringify(type));
  }

  /**
   * Тип по коду; неизвестный — «Прочее».
   * @param {string} id
   * @returns {object}
   */
  static byId(id) {
    return TYPES.find(type => type.id === id) || TYPES.find(type => type.id === 'other') || this._other();
  }

  // справочник ещё не загружен: каждый раз новый объект — его могут дополнить на месте
  static _other() {
    return {
      id: 'other',
      group: 'Прочее',
      name: 'Прочее оборудование',
      item: 'Оборудование',
      coverTitle: 'Оборудование',
      role: 'equipment',
      main: 'kw',
      fields: [],
      options: [],
    };
  }

  /**
   * Категория по названию: сначала наименование и заголовок страницы, затем заголовок титула; ДГУ — последней (так же
   * определяет app/catalog_migrate.py при обновлении каталога).
   * @param {object} item
   * @returns {string}
   */
  static detect(item) {
    const own = this._own(item);
    if (own) return own;
    for (const text of this._texts(item)) {
      const found = this._byText(text);
      if (found) return found;
    }
    return 'other';
  }

  // категория задана в позиции: своя, опция, прежнее название типа
  static _own(item) {
    const attrs = (item && item.attrs) || null;
    if (attrs && attrs.cat && TYPES.some(type => type.id === attrs.cat)) return attrs.cat;
    if (item && item.kind === 'option') return 'ats';
    return attrs && this.LEGACY[attrs.type] ? this.LEGACY[attrs.type] : '';
  }

  static _texts(item) {
    if (!item) return [' ', ''];
    return [[item.name, item.pageTitle].join(' '), String((item.hint && item.hint.title) || '')];
  }

  static _byText(text) {
    const hit = TYPES.find(type => type.id !== 'dgu' && type.match && this._test(type.match, text));
    if (hit) return hit.id;
    const dgu = TYPES.find(type => type.id === 'dgu');
    return dgu && this._test(dgu.match, text) ? 'dgu' : '';
  }

  // шаблон типа задаёт администратор: ошибочный — не совпадение
  static _test(pattern, text) {
    try {
      return new RegExp(pattern, 'i').test(text);
    } catch {
      return false;
    }
  }

  /** Справочник с сервера: свои типы отдела и встроенный (для сравнения). */
  static async load() {
    try {
      const reply = await Api.request('/api/types');
      if (reply && Array.isArray(reply.types)) TYPES = reply.types;
    } catch {
      // сервер недоступен — прежний справочник
    }
    try {
      if (!TYPES_BUILTIN) TYPES_BUILTIN = await Api.request('/api/types?builtin=1');
    } catch {
      // без встроенного — все типы считаются своими
    }
  }

  /**
   * Варианты выбора типа по группам.
   * @param {string} selected
   * @returns {string}
   */
  static optionsHtml(selected) {
    const groups = [...new Set(TYPES.map(type => type.group || 'Прочее'))];
    return groups
      .map(group => {
        const options = TYPES.filter(type => (type.group || 'Прочее') === group)
          .map(
            type =>
              `<option value="${esc(type.id)}"${type.id === selected ? ' selected' : ''}>${esc(type.name)}</option>`,
          )
          .join('');
        return `<optgroup label="${esc(group)}">${options}</optgroup>`;
      })
      .join('');
  }

  /**
   * Опция типа → {name, short, unit}.
   * @param {Array | object} option [название, кратко, единица] или готовый объект
   * @returns {object}
   */
  static option(option) {
    if (!Array.isArray(option)) return option;
    return { name: option[0], short: option[1] || option[0], unit: option[2] || 'шт.' };
  }

  /**
   * Опции всех типов.
   * @returns {object[]}
   */
  static allPresets() {
    return TYPES.flatMap(type => (type.options || []).map(option => this.option(option)));
  }

  /**
   * Опции типа позиции (у типа своих нет — доставка и ПНР).
   * @param {object} item
   * @returns {object[]}
   */
  static presetsFor(item) {
    const type = this.byId(attrsOf(item).cat);
    const list = type.options && type.options.length ? type.options : this.DEFAULT_OPTIONS;
    return list.map(option => this.option(option));
  }

  /**
   * Новая опция позиции: услуга — 1, остальное — по количеству позиции.
   * @param {object} item
   * @param {object} [preset]
   * @returns {object}
   */
  static newOpt(item, preset) {
    const from = preset || {};
    return {
      id: uid(),
      name: from.name || '',
      short: from.short || '',
      unit: from.unit || 'шт.',
      qty: from.unit === 'усл.' ? 1 : +item.qty || 1,
      price: from.price || 0,
      catId: from.catId,
    };
  }
}
