import { S } from './state.js';
import { FEAT } from './features.js';

/** Вид КП «для тендера»: номер и ссылка на закупку — в КП, журнале и имени файла «<номер> КП …». */
export class Tender {
  static URL = /^https?:\/\/\S+$/i;
  // номер закупки в ссылке: ЕИС (regNumber=…), площадки (…/tender/123456, …?id=…)
  static URL_NUMBER = [
    /[?&](?:regNumber|purchaseNumber|noticeNumber|lotNumber)=(\d{5,})/i,
    /(?:tender|purchase|trade|lot|procedure|auction|zakupk\w*|notice)[\w-]*[/=_-](\d{5,})/i,
  ];

  /**
   * КП для тендера.
   * @returns {boolean}
   */
  static active() {
    return FEAT.on('tender') && !!(S.tender && S.tender.on);
  }

  /**
   * № закупки (у обычного КП — пусто).
   * @returns {string}
   */
  static number() {
    return this.active() ? String(S.tender.number || '').trim() : '';
  }

  /**
   * Ссылка на закупку, если она правильная.
   * @returns {string}
   */
  static url() {
    const url = this.active() ? String(S.tender.url || '').trim() : '';
    return this.URL.test(url) ? url : '';
  }

  /**
   * № закупки из ссылки; не нашёлся по шаблонам — самая длинная группа цифр от 6 знаков.
   * @param {string} link
   * @returns {string}
   */
  static numberFromUrl(link) {
    const url = String(link || '');
    for (const pattern of this.URL_NUMBER) {
      const found = pattern.exec(url);
      if (found) return found[1];
    }
    const all = url.replace(/^https?:\/\/[^/]+/i, '').match(/\d{6,}/g) || [];
    return all.sort((left, right) => right.length - left.length)[0] || '';
  }
}
