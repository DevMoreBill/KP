import { Str } from './str.js';

/**
 * Значения параметров типа из таблицы характеристик (поле find типа; единицы — как в app/catalog_migrate.py): число в
 * единицах поля с пересчётом из соседних единиц, текст — к варианту из списка категории.
 */
export class SpecValues {
  static PATTERN_TEXT = 200; // шаблоны администратора — по началу текста: длинный текст не «вешает» перебор
  static UNIT_RX = {
    'м³/мин': 'м[³3]\\s*/\\s*мин',
    'л/мин': 'л\\s*/\\s*мин',
    кВт: 'квт',
    бар: '(бар|атм|кгс)',
    л: 'л(?![а-я])',
    кг: 'кг',
    'дБ(А)': 'дб',
    мм: 'мм',
    '%': '%',
    'л/ч': 'л\\s*/\\s*ч',
    моточасов: '(моточас|ч(?![а-я]))',
    'м³/ч': 'м[³3]\\s*/\\s*ч(?:ас)?(?![а-я])',
  };
  static CONVERT = {
    'м³/мин': [
      ['л/мин', 0.001],
      ['м³/ч', 1 / 60],
    ],
    'л/мин': [
      ['м³/мин', 1000],
      ['м³/ч', 1000 / 60],
    ],
    'м³/ч': [
      ['м³/мин', 60],
      ['л/мин', 0.06],
    ],
  };
  static NUM_RX = '(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)';
  static PRECISION = 1000;
  static MAX_TEXT = 120;
  static MIN_PREFIX = 4;
  // точка росы из списка категории — если отличается не больше чем на 1 °C
  static DEW_TOLERANCE = 1;
  static VOLTAGE_ALIASES = { 230: '220', 400: '380' };

  static _num(text) {
    return +String(text).replace(/[  ]/g, '').replace(',', '.');
  }

  static _round(value) {
    return Math.round(value * this.PRECISION) / this.PRECISION;
  }

  /**
   * Число из текста в единицах unit: сначала в своих единицах, затем в соседних с пересчётом, затем первое число.
   * @param {*} text
   * @param {string} unit
   * @returns {number | null}
   */
  static numUnit(text, unit) {
    const low = String(text || '').toLowerCase();
    const own = unit && this.UNIT_RX[unit] && low.match(new RegExp(`${this.NUM_RX}\\s*${this.UNIT_RX[unit]}`));
    if (own) return this._round(this._num(own[1]));
    for (const [src, factor] of this.CONVERT[unit] || []) {
      const match = low.match(new RegExp(`${this.NUM_RX}\\s*${this.UNIT_RX[src]}`));
      if (match) return this._round(this._num(match[1]) * factor);
    }
    const first = low.match(new RegExp(this.NUM_RX));
    return first ? this._round(this._num(first[1])) : null;
  }

  /**
   * Точка росы: первое число со знаком; к значению из списка категории, если отличается не больше чем на 1 °C.
   * @param {*} text
   * @param {string[]} vals
   * @returns {string}
   */
  static dewPoint(text, vals) {
    const match = String(text || '').match(/([+\-−–]?)\s*(\d+(?:[.,]\d+)?)/);
    if (!match) return '';
    const value = +match[2].replace(',', '.') * (/[-−–]/.test(match[1]) ? -1 : 1);
    const hit = vals.find(option => Math.abs(+option.replace('−', '-').replace('+', '') - value) <= this.DEW_TOLERANCE);
    if (hit) return hit;
    return this._signed(value).replace('.', ',');
  }

  static _signed(value) {
    if (value > 0) return `+${value}`;
    if (value < 0) return `−${-value}`;
    return '0';
  }

  static _canon(text) {
    return String(text)
      .toLowerCase()
      .replace(/[−–]/g, '-')
      .replace(/[\s°c]/g, '');
  }

  static _voltage(text, vals) {
    const match = text.toLowerCase().match(/(\d{3})\s*в(?![а-я])/);
    const volts = match ? match[1] : '';
    return vals.includes('220') && vals.includes('380') ? this.VOLTAGE_ALIASES[volts] || volts : volts;
  }

  static _oilFree(text) {
    if (/безмасл|oil[- ]?free|класс 0/i.test(text)) return 'Да';
    return /масл/i.test(text) ? 'Нет' : '';
  }

  static _refrigerant(text) {
    // «Тип компрессора хладагента: поршневой» — не хладагент
    const match = text.match(/\bR-?\d{2,4}[A-Za-z]?\b/);
    return match ? match[0].replace('-', '').toUpperCase() : '';
  }

  // поля с особым разбором, до сверки со списком категории
  static _before(text, field, vals) {
    if (field.key === 'voltage') return this._voltage(text, vals);
    if (field.key === 'oilFree' && String(field.values) === 'Да,Нет') return this._oilFree(text);
    return undefined;
  }

  // поля с особым разбором, если в списке категории точного варианта нет
  static _after(text, field, vals) {
    if (field.key === 'dewPoint') return this.dewPoint(text, vals);
    if (field.key === 'refrigerant') return this._refrigerant(text);
    return undefined;
  }

  static _prefix(text, vals) {
    const canon = this._canon(text);
    if (canon.length < this.MIN_PREFIX) return undefined;
    const found = vals.filter(option => this._canon(option).startsWith(canon));
    return found.length === 1 ? found[0] : undefined;
  }

  /**
   * Текстовое значение поля: вариант из списка категории, иначе строка без единицы поля.
   * @param {*} text
   * @param {object} field
   * @returns {string}
   */
  static textVal(text, field) {
    const value = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    const vals = (field.values || []).filter(option => typeof option === 'string');
    const special = this._before(value, field, vals);
    if (special !== undefined) return special;
    const hit = vals.find(option => this._canon(option) && this._canon(option) === this._canon(value));
    if (hit) return hit;
    const parsed = this._after(value, field, vals) ?? this._prefix(value, vals);
    if (parsed !== undefined) return parsed;
    const unit = field.unit;
    const bare = unit && value.toLowerCase().endsWith(unit.toLowerCase()) ? value.slice(0, -unit.length).trim() : value;
    return bare.slice(0, this.MAX_TEXT);
  }

  /**
   * Параметры типа из таблицы характеристик: сначала строки в единицах поля, затем остальные — с пересчётом; «снижение
   * шума на 8 дБ» — не значение.
   * @param {object} item
   * @param {object} type
   * @returns {object}
   */
  static fromSpec(item, type) {
    const out = {};
    const rows = (item.groups || []).flatMap(group => (group.rows || []).filter(row => row.k && row.v));
    for (const field of type.fields || []) {
      const value = this._field(field, rows);
      if (value !== undefined) out[field.key] = value;
    }
    return out;
  }

  static _field(field, rows) {
    if (!field.find) return undefined;
    let pattern;
    try {
      pattern = new RegExp(field.find, 'i');
    } catch {
      return undefined;
    }
    const inUnit = field.num && this.UNIT_RX[field.unit] ? new RegExp(`\\d\\s*${this.UNIT_RX[field.unit]}`) : null;
    const own = row => (inUnit && inUnit.test(String(row.v).toLowerCase()) ? 1 : 0);
    const found = rows.filter(
      row =>
        pattern.test(String(row.k).trim().slice(0, this.PATTERN_TEXT)) &&
        !(field.num && /снижени|уменьшени/i.test(row.v)),
    );
    found.sort((left, right) => own(right) - own(left));
    for (const row of found) {
      const value = field.num ? this.numUnit(row.v, field.unit) : this.textVal(row.v, field);
      if (value !== null && value !== '') return value;
    }
    return undefined;
  }

  /**
   * Значение поля для показа: число — с запятой, с единицей поля.
   * @param {object} field
   * @param {*} value
   * @returns {string}
   */
  static show(field, value) {
    if (value == null || value === '') return '';
    const text = field.num && typeof value === 'number' ? Str.comma(value) : String(value);
    return field.unit && !text.includes(field.unit) ? `${text} ${field.unit}` : text;
  }
}
