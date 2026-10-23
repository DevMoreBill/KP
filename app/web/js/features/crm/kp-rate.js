import { FEAT } from '../../core/features.js';
import { Money } from '../../core/money.js';
import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';

/**
 * Курс в сделке: КП в валюте — по какому курсу оно считалось в рублях (сумма в рублях ÷ в валюте при сохранении) и сколько
 * та же сумма стоит по сегодняшнему курсу ЦБ: «+» — в рублях выходит больше, «−» — меньше.
 */
export class KpRate {
  static rates = null;
  static asked = false;
  static DIGITS = 2;
  static PERCENT = 100;
  static KOPECKS = 100;

  /** Курсы ЦБ на сегодня — один раз (ответ придёт — карточка перерисуется при следующем показе). */
  static async load() {
    if (this.asked) return;
    this.asked = true;
    try {
      const rates = await Api.request('/api/cbr');
      this.rates = rates && rates.USD ? rates : null;
    } catch {
      this.rates = null;
    }
  }

  /**
   * Разница по курсу для КП (null — КП в рублях, нет суммы или курса).
   * @param {{cur?: string, sum?: number, sumCur?: number}} offer КП сделки: sum — копейки в рублях, sumCur — копейки в валюте
   * @returns {{cur: string, then: number, now: number, diff: number, pct: number}|null}
   */
  static diff(offer) {
    const cur = offer && offer.cur;
    if (!cur || cur === 'RUB' || !(offer.sumCur > 0) || !(offer.sum > 0)) return null;
    const now = parseFloat(this.rates && this.rates[cur]);
    if (!(now > 0)) return null;
    const then = offer.sum / offer.sumCur;
    const diff = Math.round((offer.sumCur * now - offer.sum) / this.KOPECKS);
    return { cur, then, now, diff, pct: ((now - then) / then) * this.PERCENT };
  }

  /**
   * Строка под КП в карточке сделки.
   * @param {object} offer
   * @returns {string}
   */
  static line(offer) {
    if (!FEAT.on('rateDiff') || !offer || !offer.cur || offer.cur === 'RUB') return '';
    if (!this.rates) {
      this.load();
      return '';
    }
    const found = this.diff(offer);
    if (!found) return '';
    const num = value => value.toFixed(this.DIGITS).replace('.', ',');
    const sign = found.diff > 0 ? '+' : '';
    const tone = found.diff >= 0 ? 'ok-t' : 'bad-t';
    return `<span class="muted dk-rate">Курс ${esc(found.cur)}: в КП ${num(found.then)} → сегодня ${num(found.now)} · <span class="${tone}">${sign}${Money.rub(found.diff)} (${sign}${num(found.pct)} %)</span> в рублях</span>`;
  }
}
