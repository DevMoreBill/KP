import { LgCargo } from '../../core/lg-cargo.js';

/**
 * Груз, вписанный вручную на вкладке «Логистика»: габариты — в мм, масса — в кг; хранится как вписано
 * (sup.lg.items[позиция] = {lmm, wmm, hmm, kg}), прежние КП {l, w, h, m} в метрах и тоннах читаются с переводом.
 */
export class LgCargoIn {
  static KEY = { l: 'lmm', w: 'wmm', h: 'hmm', m: 'kg' };
  static THOUSAND = 1000;
  static TEN_THOUSAND = 10000;
  static TEN = 10;

  /**
   * Своё значение поля в единицах расчёта (м, т) или null.
   * @param {object} own
   * @param {string} field l | w | h | m
   * @returns {number|null}
   */
  static val(own, field) {
    const data = own || {};
    const value = LgCargo.num(data[this.KEY[field]]);
    if (value != null) return value / LgCargoIn.THOUSAND;
    return LgCargo.num(data[field]);
  }

  /**
   * Поле вписано.
   * @param {object} own
   * @param {string} field
   * @returns {boolean}
   */
  static has(own, field) {
    return this.val(own, field) != null;
  }

  /**
   * Текст поля: вписанное — как вписано; прежнее и значение из характеристик — в мм / кг.
   * @param {object} own
   * @param {string} field
   * @param {number|null} value
   * @returns {string}
   */
  static text(own, field, value) {
    const raw = (own || {})[this.KEY[field]];
    if (raw != null && String(raw).trim() !== '') return String(raw);
    return value == null ? '' : this.fmt(value, field);
  }

  /**
   * Значение расчёта (м, т) → мм / кг.
   * @param {number} value
   * @param {string} field
   * @returns {string}
   */
  static fmt(value, field) {
    if (field === 'm') return String(Math.round(value * LgCargoIn.TEN_THOUSAND) / LgCargoIn.TEN).replace('.', ',');
    return String(Math.round(value * LgCargoIn.THOUSAND));
  }

  /**
   * Ввод в поле: пусто — своё значение убирается (вернутся характеристики).
   * @param {object} own
   * @param {string} field
   * @param {string} text
   */
  static set(own, field, text) {
    delete own[field];
    const value = String(text ?? '').trim();
    if (value === '') delete own[this.KEY[field]];
    else own[this.KEY[field]] = value;
  }

  /**
   * Масса (т) → «12 400 кг».
   * @param {number} tons
   * @returns {string}
   */
  static kgText(tons) {
    return `${Math.round((+tons || 0) * LgCargoIn.THOUSAND).toLocaleString('ru-RU')} кг`;
  }

  /**
   * Длина (м) → «7 200 мм».
   * @param {number} meters
   * @returns {string}
   */
  static mmText(meters) {
    return `${Math.round((+meters || 0) * LgCargoIn.THOUSAND).toLocaleString('ru-RU')} мм`;
  }
}
