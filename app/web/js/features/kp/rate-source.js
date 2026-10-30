/**
 * Откуда курс валюты КП: из ЦБ РФ на дату или вписан вручную (договорной) — по каждой валюте (pricing.own). У КП прежних
 * версий отметок нет: источник «вручную» у последней правки — курс считается ручным (в документе не выдаётся за курс ЦБ).
 */
export class RateSource {
  static OWN = 'вручную';

  /**
   * Курс code вписан вручную.
   * @param {object} pricing S.pricing
   * @param {string} code
   */
  static mark(pricing, code) {
    pricing.own = { ...(pricing.own || {}), [code]: true };
    pricing.rateSrc = this.OWN;
  }

  /**
   * Курсы codes загружены из ЦБ на date: их отметки «вручную» снимаются; источник КП — ЦБ, если ручных не осталось.
   * @param {object} pricing
   * @param {string[]} codes
   * @param {{date: string, src: string}} from
   */
  static cbr(pricing, codes, { date, src }) {
    const own = { ...(pricing.own || {}) };
    for (const code of codes) delete own[code];
    pricing.own = own;
    pricing.rateDate = date;
    pricing.rateSrc = Object.keys(own).length ? this.OWN : src;
  }

  /**
   * Курс code вписан вручную.
   * @param {object} pricing
   * @param {string} code
   * @returns {boolean}
   */
  static manual(pricing, code) {
    if (pricing.own) return !!pricing.own[code];
    return pricing.rateSrc === this.OWN;
  }
}
