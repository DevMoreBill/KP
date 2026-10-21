import { ContainerKind } from './container-kind.js';
import { Kit } from './kit.js';
import { StationSpec } from './station-spec.js';
import { LgCargo } from '../deal/lg-cargo.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMods } from '../layout/station-mods.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Str } from '../../core/str.js';

/** Значения, подставляемые в станцию из её оборудования. */
export class StationAutoVal {
  static ROUND = 1000;

  /**
   * Число поля × factor (подача — на число агрегатов) без дробного «мусора»; диапазон «8–10» — диапазоном; текст без
   * числа — как есть.
   * @param {*} value
   * @param {number} [factor]
   * @returns {number|string}
   */
  static of(value, factor = 1) {
    const text = String(value ?? '').trim();
    const range = text
      .replace(/\s/g, '')
      .replace(/,/g, '.')
      .match(/^(\d+(?:\.\d+)?)[–—-](\d+(?:\.\d+)?)$/);
    if (range) return factor === 1 ? text : `${this.round(range[1] * factor)}–${this.round(range[2] * factor)}`;
    const number = Str.num(text);
    return number == null || !Number.isFinite(number) ? text : this.round(number * factor);
  }

  /**
   * До тысячных.
   * @param {number} value
   * @returns {number}
   */
  static round(value) {
    return Math.round(value * this.ROUND) / this.ROUND;
  }

  /**
   * Таблица характеристик: новые автоматические строки + строки менеджера (новые или изменённые им — по разделу и
   * названию); автоматическая строка, которую не трогали, — берётся новая (или пропадает вместе с оборудованием).
   * @param {object[]} current
   * @param {object[]} old прежние автоматические
   * @param {object[]} now новые автоматические
   * @returns {object[]}
   */
  static merge(current, old, now) {
    const untouched = this._untouched(old);
    const out = now.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row })) }));
    for (const group of current || [])
      for (const row of group.rows || []) if ((row.k || row.v) && !untouched(group, row)) this._keep(out, group, row);
    return out;
  }

  /** строка совпадает с прежней автоматической (по разделу и названию) */
  static _untouched(old) {
    const key = (group, row) => `${group.name || ''}\u0001${row.k || ''}`;
    const auto = new Map();
    for (const group of old || []) for (const row of group.rows || []) auto.set(key(group, row), String(row.v ?? ''));
    return (group, row) => auto.get(key(group, row)) === String(row.v ?? '');
  }

  static _keep(out, group, row) {
    let target = out.find(line => (line.name || '') === (group.name || ''));
    if (!target) {
      target = { ...group, rows: [] };
      out.push(target);
    }
    const index = target.rows.findIndex(line => (line.k || '') === (row.k || ''));
    if (index >= 0 && row.k) target.rows[index] = { ...row };
    else target.rows.push({ ...row });
  }
}

/**
 * Параметры станции из её элементов — пересчитываются при любом изменении состава: контейнер, климат, габариты — из
 * контейнера; установленная мощность — сумма; подача, давление, мощность ДГУ — у основного оборудования; остальные — у
 * первого элемента, где они есть; масса — сумма, если известна у всех. `x._sa` — что подставлено автоматически: вписанное
 * менеджером не трогается.
 */
export class StationAuto {
  static MAIN_KEYS = ['flow', 'head', 'pressure', 'kw', 'kva', 'voltage', 'drive', 'automation'];
  static OWN_KEYS = ['container', 'climate', 'tmin', 'size', 'mass'];
  static KG_IN_TONNE = 1000;
  static KW_ROUND = 10;
  static SPEC_PARAMS = 3;

  /**
   * Подставляемые значения.
   * @param {object} item
   * @returns {object}
   */
  static of(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    if (!type.station) return {};
    const parts = Kit.parts(item);
    const main = Kit.main(item);
    const out = {};
    this._container(Kit.container(item), out);
    this._mass(parts, out);
    for (const field of type.fields) this._field(field, parts, main, out);
    return out;
  }

  /**
   * Подставить в станцию: параметры, строку под названием и таблицу характеристик (пока их не правили).
   * @param {object} item
   */
  static fill(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    if (!type.station) return;
    item.attrs = item.attrs || {};
    const old = item._sa || {};
    const now = this.of(item);
    for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) this._attr(item, key, old, now);
    item._sa = now;
    this._spec(item);
    this._groups(item);
  }

  static _attr(item, key, old, now) {
    const current = item.attrs[key];
    const mine = current != null && current !== '' && String(current ?? '') !== String(old[key] ?? '');
    if (mine) return;
    if (now[key] != null && now[key] !== '') item.attrs[key] = now[key];
    else delete item.attrs[key];
  }

  static _spec(item) {
    const container = Kit.container(item);
    const spec = [
      ItemSpec.mainLine(item, this.SPEC_PARAMS),
      container ? ContainerKind.of(container.ctype).name.toLowerCase() : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (!String(item.spec || '').trim() || item.spec === item._saSpec) {
      item.spec = spec;
      item._saSpec = spec;
    }
  }

  /** таблица характеристик: не правили — новая; правили вручную — автоматические строки обновить, свои оставить */
  static _groups(item) {
    const groups = StationSpec.groups(
      item,
      ItemSpec.groups(item).filter(group => group.rows.length),
    );
    const was = JSON.stringify(item.groups || []);
    const edited = (item.groups || []).some(group => (group.rows || []).some(row => row.k || row.v));
    if (!edited || was === item._saG) {
      item.groups = groups;
      item._saG = JSON.stringify(groups);
    } else if (item._saG) {
      item.groups = StationAutoVal.merge(item.groups, JSON.parse(item._saG), groups);
      item._saG = JSON.stringify(groups);
    }
  }

  static _container(container, out) {
    if (!container) return;
    const climate = ContainerKind.climate(container.climate);
    out.container = ContainerKind.of(container.ctype).name;
    if (container.climate) out.climate = container.climate;
    if (climate) out.tmin = climate[2];
    const dims = String((container.rows || []).find(row => /^Габариты/.test(row.k))?.v || '');
    if (/\d{3,}\s*[×xх*]\s*\d{3,}/.test(dims)) out.size = dims.replace(/\s*мм\s*$/, '');
    const mods = StationMods.of(container);
    const size = mods && StationGeo.parseMm(container.size);
    if (size) out.size = `${size[0] * mods.a} × ${size[1] * mods.b} × ${size[2]}`;
  }

  static _mass(parts, out) {
    const masses = parts.map(part => {
      const mass = this._partMass(part);
      return mass > 0 ? mass * this._qty(part) : null;
    });
    if (parts.length && masses.every(mass => mass > 0))
      out.mass = Math.round(masses.reduce((sum, mass) => sum + mass, 0));
  }

  static _partMass(part) {
    const own = Str.num((part.attrs || {}).mass);
    if (own != null) return own;
    return (LgCargo.of([{ rows: part.rows || [] }]).mass || 0) * this.KG_IN_TONNE;
  }

  static _field(field, parts, main, out) {
    const key = field.key;
    if (this.OWN_KEYS.includes(key)) return;
    if (key === 'kw' && /установленн/i.test(field.label)) {
      this._installed(parts, out);
      return;
    }
    if (main && this._filled(main, key)) {
      const value = main.attrs[key];
      out[key] = field.num ? StationAutoVal.of(value, key === 'flow' ? this._qty(main) : 1) : value;
      return;
    }
    if (this.MAIN_KEYS.includes(key)) return;
    const other = parts.find(part => part !== main && this._filled(part, key));
    if (other) out[key] = field.num ? StationAutoVal.of(other.attrs[key]) : other.attrs[key];
  }

  static _installed(parts, out) {
    const sum = parts.reduce((total, part) => {
      const power = Str.num((part.attrs || {}).kw);
      return power > 0 ? total + power * this._qty(part) : total;
    }, 0);
    if (sum > 0) out.kw = Math.round(sum * this.KW_ROUND) / this.KW_ROUND;
  }

  static _filled(part, key) {
    const value = (part.attrs || {})[key];
    return value != null && value !== '';
  }

  static _qty(part) {
    return +part.qty || 1;
  }
}

/** Название станции по умолчанию: «Модульная насосная станция Grundfos CR 32 в блок-контейнере». */
export class StationName {
  static MODEL_WORDS = 3;

  /**
   * @param {object} item
   * @returns {string}
   */
  static of(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const container = Kit.container(item);
    const main = Kit.main(item);
    const attrs = (main && main.attrs) || {};
    const model = [attrs.maker, attrs.model].filter(Boolean).join(' ') || this._fromName(main);
    return [type.item, model, container ? `в ${ContainerKind.of(container.ctype).short}` : '']
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Подставить название, пока менеджер его не менял сам.
   * @param {object} item
   */
  static apply(item) {
    if (!Kit.station(item)) return;
    if (!String(item.name || '').trim() || item.name === item._autoNameV) {
      item.name = this.of(item);
      item._autoNameV = item.name;
    }
  }

  /** латиница и цифры из наименования («Дизель-генераторная установка CU44D5A …» → «CU44D5A») */
  static _fromName(main) {
    if (!main) return '';
    return (String(main.name || '').match(/[A-Za-z0-9][A-Za-z0-9\-/.,]*[A-Za-z0-9]|[A-Za-z0-9]/g) || [])
      .filter(word => /\d/.test(word) || /[A-Z]{2,}/.test(word))
      .slice(0, this.MODEL_WORDS)
      .join(' ');
  }
}
