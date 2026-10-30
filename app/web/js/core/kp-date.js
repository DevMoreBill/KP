import { S } from './state.js';
import { today } from './util.js';
/** Даты хода сделки: ДД.ММ.ГГГГ, сдвиг на дни, срок действия КП (как kp_track.OfferTerm на сервере). */
export class KpDate {
  static NOON = 'T12:00:00';
  static WEEKEND = 6;
  static DAYS = [
    [/дн|ден|сут/, 1],
    [/недел/, 7],
    [/мес/, 30],
  ];

  /**
   * Дата ГГГГ-ММ-ДД → ДД.ММ.ГГГГ ('' — не дата).
   * @param {string} iso
   * @returns {string}
   */
  static ddmm(iso) {
    const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
  }

  /**
   * Дата через n дней.
   * @param {string} iso
   * @param {number} days
   * @returns {string} ГГГГ-ММ-ДД
   */
  static addDays(iso, days) {
    const date = new Date((iso || today()) + this.NOON);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Дата через n рабочих дней (без субботы и воскресенья).
   * @param {string} base
   * @param {number} days
   * @returns {string} ГГГГ-ММ-ДД
   */
  static workDays(base, days) {
    const date = new Date(base + this.NOON);
    for (let k = 0; k < days; ) {
      date.setDate(date.getDate() + 1);
      if (date.getDay() % this.WEEKEND) k++;
    }
    return date.toISOString().slice(0, 10);
  }

  /**
   * Срок действия КП по условию «Срок действия предложения»: «30 дней», «10 рабочих дней», «2 недели», «1 месяц»,
   * «до 31.12.2026» — от даты КП.
   * @param {object} [state] КП
   * @returns {string} ГГГГ-ММ-ДД или '' — не указан или не распознан
   */
  static validUntil(state = S) {
    const cond = (state.conditions || []).find(row => /действ/i.test(row.label || ''));
    const text = String((cond && cond.value) || '').toLowerCase();
    if (!text) return '';
    const date = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (date) return `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
    const term = text.match(/(\d{1,3})\s*([а-яё]*)\s*([а-яё]*)/);
    const base = state.date;
    if (!term || !base) return '';
    const count = +term[1];
    const words = `${term[2]} ${term[3]}`;
    if (/раб/.test(words)) return this.workDays(base, count);
    const unit = this.DAYS.find(([pattern]) => pattern.test(words));
    return unit ? this.addDays(base, count * unit[1]) : '';
  }
}
