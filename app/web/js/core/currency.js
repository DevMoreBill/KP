import { S } from './state.js';

/** Валюта КП и курсы: короткое обозначение, валюта открытого КП, курс к рублю по курсам КП. */
export class Currency {
  static LIST = ['RUB', 'USD', 'EUR', 'CNY'];

  /**
   * Короткое обозначение валюты («руб.», «$»).
   * @param {string} code
   * @returns {string}
   */
  static short(code) {
    return (KPGen.CURS[code] || KPGen.CURS.RUB).sh;
  }

  /**
   * Валюта текущего КП.
   * @returns {string}
   */
  static current() {
    return S.pricing.cur || 'RUB';
  }

  /**
   * Курс валюты к рублю по курсам КП (NaN — курса нет).
   * @param {string} code
   * @returns {number}
   */
  static rate(code) {
    return code === 'RUB' ? 1 : this.parseRate(S.pricing.rates[code]);
  }

  /**
   * Курс из поля «1 234,56» — единственный разбор курса (КП, экономика КП, отчёт); не число или 0 — NaN.
   * @param {*} raw
   * @returns {number}
   */
  static parseRate(raw) {
    const value = parseFloat(
      String(raw ?? '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
    return value > 0 ? value : NaN;
  }
}
