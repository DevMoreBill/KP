import { Money } from './money.js';

/** Строки и числа из ввода: число из текста, нормализация для поиска и сравнения, имя файла. */
export class Str {
  /**
   * Число из текста («1 234,5 кг» → 1234.5); нет числа — null.
   * @param {*} value
   * @returns {number | null}
   */
  static num(value) {
    if (typeof value === 'number') return value;
    const match = String(value ?? '')
      .replace(/\s/g, '')
      .replace(',', '.')
      .match(/-?\d+(\.\d+)?/);
    return match ? +match[0] : null;
  }

  /**
   * Десятичная запятая: 1.5 → «1,5».
   * @param {*} value
   * @returns {string}
   */
  static comma(value) {
    return String(value).replace('.', ',');
  }

  /**
   * Для поиска и сравнения: строчные, «ё» → «е», без кавычек-ёлочек, один пробел.
   * @param {*} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[«»"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Часть имени файла: без запрещённых знаков, пробелы — «_».
   * @param {*} text
   * @returns {string}
   */
  static fileName(text) {
    return String(text || '')
      .replace(/[«»"'\\/:*?<>|]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
}

/** Значение по пути «a.b.c» в объекте; запись создаёт недостающие вложенные объекты. */
export class ObjPath {
  /**
   * @param {object} obj
   * @param {string} key
   * @returns {*}
   */
  static get(obj, key) {
    return String(key)
      .split('.')
      .reduce((node, part) => (node == null ? node : node[part]), obj);
  }

  /**
   * @param {object} obj
   * @param {string} key
   * @param {*} value
   */
  static set(obj, key, value) {
    const parts = String(key).split('.');
    let node = obj;
    parts.slice(0, -1).forEach(part => {
      if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
      node = node[part];
    });
    node[parts[parts.length - 1]] = value;
  }
}

/** Цена КП в копейках: ввод менеджера → копейки, копейки → «1 234,50», сумма прописью. */
export class Price {
  static KOPECKS = 100;

  /**
   * «1 234,5» → 123450; пусто — 0; не цена — NaN.
   * @param {*} text
   * @returns {number}
   */
  static parse(text) {
    const clean = String(text || '')
      .replace(/[\s ]/g, '')
      .replace(',', '.');
    if (!clean) return 0;
    if (!/^\d+(\.\d{0,2})?$/.test(clean)) return NaN;
    const [whole, frac = ''] = clean.split('.');
    return +whole * this.KOPECKS + +`${frac}00`.slice(0, 2);
  }

  /**
   * Копейки → «1 234,50»; ноль — пусто.
   * @param {number} kop
   * @returns {string}
   */
  static text(kop) {
    return kop ? KPGen.money(kop) : '';
  }

  /**
   * Сумма прописью в валюте КП.
   * @param {number} kop
   * @param {string} [cur]
   * @returns {string}
   */
  static words(kop, cur) {
    return KPGen.words(kop, cur || (S && S.pricing && S.pricing.cur) || 'RUB');
  }
}

/** Числа, деньги, размер файла и время для показа на экране («1 234 567 ₽», «16.10.2026, 14:05»). */
export class Fmt {
  static DATE_TIME = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  static BYTES_KB = 1024;
  static BYTES_MB = 1048576;
  static BYTES_GB = 1024 * Fmt.BYTES_MB;
  // меньше — с одним знаком после запятой
  static TENTHS_BELOW_MB = 10;
  static TENTHS_BELOW_GB = 100;

  /**
   * «1 234 567».
   * @param {*} value
   * @returns {string}
   */
  static num(value) {
    return Number(value || 0).toLocaleString('ru-RU');
  }

  /**
   * Рубли без копеек; не посчитано — прочерк.
   * @param {*} value
   * @returns {string}
   */
  static rub(value) {
    return Money.rub(value);
  }

  /**
   * «15 КБ», «1,5 МБ», «12 МБ», «2,1 ГБ».
   * @param {*} bytes
   * @returns {string}
   */
  static size(bytes) {
    const size = +bytes || 0;
    if (size < this.BYTES_MB) return `${Math.max(1, Math.round(size / this.BYTES_KB))} КБ`;
    if (size < this.BYTES_GB) return `${this._part(size, this.BYTES_MB, this.TENTHS_BELOW_MB)} МБ`;
    return `${this._part(size, this.BYTES_GB, this.TENTHS_BELOW_GB)} ГБ`;
  }

  static _part(size, unit, tenthsBelow) {
    return (size / unit).toFixed(size < tenthsBelow * unit ? 1 : 0).replace('.', ',');
  }

  /**
   * «16.10.2026, 14:05»; нет даты — пусто.
   * @param {string} iso
   * @returns {string}
   */
  static dateTime(iso) {
    const date = iso ? new Date(iso) : null;
    return date && !isNaN(date) ? date.toLocaleString('ru-RU', this.DATE_TIME) : '';
  }
}
