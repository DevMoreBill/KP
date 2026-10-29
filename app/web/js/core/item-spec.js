import { EquipTypes } from './equip-types.js';
import { Attrs } from './item-attrs.js';
import { SpecValues } from './spec-values.js';
import { Str } from './str.js';
import { Kit } from '../features/kit/kit.js';

/** Характеристики позиции по параметрам её типа: строка главного, таблица характеристик, шаблон таблицы, место картинки. */
export class ItemSpec {
  static MAIN = 'Основные';
  static MAIN_LINE = 3;

  static _filled(attrs, field) {
    return field.kpi && attrs[field.key] != null && attrs[field.key] !== '';
  }

  /**
   * Ключевые параметры одной строкой: «15 кВт · 8 бар».
   * @param {object} item
   * @param {number} [max]
   * @returns {string}
   */
  static mainLine(item, max = this.MAIN_LINE) {
    const attrs = Attrs.of(item);
    const type = EquipTypes.byId(attrs.cat);
    return type.fields
      .filter(field => this._filled(attrs, field))
      .slice(0, max)
      .map(field => SpecValues.show(field, attrs[field.key]))
      .join(' · ');
  }

  /**
   * Ключевые параметры для титула (до limit): число, единица, подпись.
   * @param {object} item
   * @param {number} limit
   * @returns {{num: string, unit: string, cap: string}[]}
   */
  static kpis(item, limit) {
    const attrs = Attrs.of(item);
    return EquipTypes.byId(attrs.cat)
      .fields.filter(field => this._filled(attrs, field))
      .slice(0, limit)
      .map(field => ({
        num: Str.comma(attrs[field.key]).replace(/\s*[^\d,./-].*$/, ''),
        unit: field.unit || '',
        cap: field.label.toLowerCase(),
      }));
  }

  /**
   * Таблица характеристик из параметров: группы и строки.
   * @param {object} item
   * @returns {{name: string, rows: object[]}[]}
   */
  static groups(item) {
    const attrs = Attrs.of(item);
    const type = EquipTypes.byId(attrs.cat);
    const groups = new Map();
    const add = (group, key, value, highlight) => {
      if (!value) return;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ k: key, v: value, hl: !!highlight });
    };
    add(this.MAIN, 'Производитель', attrs.maker);
    add(this.MAIN, 'Модель', attrs.model);
    for (const field of type.fields) {
      add(field.group || this.MAIN, field.label, SpecValues.show(field, attrs[field.key]), field.kpi);
    }
    return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
  }

  /**
   * Шаблон таблицы характеристик категории: недостающие строки по параметрам типа (значения — из параметров позиции),
   * заполненное не меняется.
   * @param {object} item
   * @returns {number} сколько строк добавлено
   */
  static applyTemplate(item) {
    const attrs = Attrs.of(item);
    const type = EquipTypes.byId(attrs.cat);
    item.groups = item.groups || [];
    let added = 0;
    const rowsOf = [
      [this.MAIN, { key: 'maker', label: 'Производитель' }],
      [this.MAIN, { key: 'model', label: 'Модель' }],
      ...type.fields.map(field => [field.group || this.MAIN, field]),
    ];
    for (const [groupName, field] of rowsOf) {
      const group = this._group(item, groupName);
      if (this._hasRow(item, field)) continue;
      group.rows.push({
        k: field.label + (field.unit ? `, ${field.unit}` : ''),
        v: this._value(attrs, field),
        hl: !!field.kpi,
      });
      added++;
    }
    item.groups = item.groups.filter(group => group.rows.length);
    return added;
  }

  static _group(item, name) {
    const found = item.groups.find(group => Str.norm(group.name) === Str.norm(name));
    if (found) return found;
    const group = { name, rows: [] };
    item.groups.push(group);
    return group;
  }

  // строка уже есть — с единицей после запятой или без
  static _hasRow(item, field) {
    const label = Str.norm(field.label);
    const bare = text => Str.norm(String(text).replace(/,\s*[^,]*$/, ''));
    return item.groups.some(group =>
      (group.rows || []).some(row => bare(row.k) === label || Str.norm(row.k) === label),
    );
  }

  static _value(attrs, field) {
    const value = attrs[field.key];
    if (value == null || value === '') return '';
    return String(field.num && typeof value === 'number' ? Str.comma(value) : value);
  }

  /**
   * Что за изображение: по этим данным сервер выбирает папку data/img/<раздел>/<категория>/<производитель> (app/images.py).
   * @param {object} item
   * @param {string} kind
   * @param {{caption?: string, slot?: string}} [img]
   * @returns {object}
   */
  static imgPlace(item, kind, img) {
    const attrs = Attrs.of(item);
    return {
      cat: attrs.cat,
      maker: attrs.maker || '',
      model: attrs.model || '',
      name: item.name || '',
      kind,
      caption: (img && (img.caption || img.slot)) || '',
    };
  }
}

/**
 * Заголовок титула по позиции: вид оборудования, модель, ключевые параметры. Станция в контейнере — по основному
 * оборудованию («Dalgakiran EAGLE 315W»), а не по разбору своего названия («EAGLE»).
 */
export class CoverHint {
  static KPIS = 4;

  /**
   * @param {object} item
   * @returns {{title: string, model: string, desc: string, kpis: object[]}}
   */
  static of(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const simple = Kit.simple(item);
    return {
      title: simple ? type.item || type.name : type.coverTitle || type.name,
      model: simple ? CoverHint.asmModel(item, type) : CoverHint.model(item),
      desc: '',
      kpis: ItemSpec.kpis(item, this.KPIS),
    };
  }

  /**
   * Сборное изделие — по своему названию: вид — строкой заголовка, крупно — остальное название («Grundfos CR 32-4 с ДГУ
   * в контейнере»); название не начинается с вида — целиком.
   * @param {object} item
   * @param {object} type категория изделия
   * @returns {string}
   */
  static asmModel(item, type) {
    const name = String(item.name || '').trim();
    const kind = String(type.item || '').trim();
    const rest = kind && name.toLowerCase().startsWith(kind.toLowerCase()) ? name.slice(kind.length).trim() : '';
    return rest || name;
  }

  /**
   * Производитель и модель (у станции — основного оборудования).
   * @param {object} item
   * @returns {string}
   */
  static model(item) {
    const main = Kit.station(item) ? Kit.main(item) : null;
    const mainAttrs = (main && main.attrs) || {};
    if (mainAttrs.model) return [mainAttrs.maker, mainAttrs.model].filter(Boolean).join(' ');
    const attrs = Attrs.of(item);
    return [attrs.maker, attrs.model].filter(Boolean).join(' ') || item.name;
  }
}
