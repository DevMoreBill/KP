import { KpDate } from '../kp/kp-date.js';
import { esc, today } from '../../core/util.js';
import { Money } from '../../core/money.js';
/** Показ сумм и дат кабинета: суммы сделок — в копейках, даты — ГГГГ-ММ-ДД. */
export class CrmFmt {
  static KOPECKS = 100;
  static DAY_MS = 864e5;
  static WEEK = 7;
  static NEAR = { 0: 'сегодня', 1: 'завтра', '-1': 'вчера' };

  /**
   * Сумма полностью: «1 250 000 ₽».
   * @param {number} kop
   * @returns {string}
   */
  static rub(kop) {
    return Money.rub((+kop || 0) / this.KOPECKS);
  }

  /**
   * Коротко для карточек: «1,2 млн ₽».
   * @param {number} kop
   * @returns {string}
   */
  static short(kop) {
    return Money.short((+kop || 0) / this.KOPECKS);
  }

  /**
   * «19.11».
   * @param {string} iso
   * @returns {string}
   */
  static day(iso) {
    const found = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/);
    return found ? `${found[2]}.${found[1]}` : '';
  }

  /**
   * Номер дня (для графика и сравнения).
   * @param {string} iso
   * @returns {number}
   */
  static dayNo(iso) {
    return Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / this.DAY_MS);
  }

  /**
   * Дата по номеру дня.
   * @param {number} number
   * @returns {string}
   */
  static iso(number) {
    return new Date(number * this.DAY_MS).toISOString().slice(0, 10);
  }

  /**
   * Дней от сегодня (минус — в прошлом).
   * @param {string} iso
   * @returns {number}
   */
  static diff(iso) {
    return Math.round(this.dayNo(iso) - this.dayNo(today()));
  }

  /**
   * «сегодня», «завтра», «через 5 дн.», «3 дн. назад», иначе дата.
   * @param {string} iso
   * @returns {string}
   */
  static rel(iso) {
    const days = this.diff(iso);
    if (this.NEAR[days]) return this.NEAR[days];
    if (days > 0 && days < this.WEEK) return `через ${days} дн.`;
    if (days < 0 && days > -this.WEEK) return `${-days} дн. назад`;
    return this.day(iso);
  }

  /**
   * Дата через days дней от сегодня.
   * @param {number} days
   * @returns {string}
   */
  static after(days) {
    return KpDate.addDays(today(), days);
  }

  /**
   * Ближайший понедельник (не сегодня).
   * @returns {string}
   */
  static monday() {
    const weekday = new Date(`${today()}T12:00:00`).getDay();
    return this.after((this.WEEK + 1 - weekday) % this.WEEK || this.WEEK);
  }
}

/** Быстрый выбор даты чипами: «Сегодня», «Завтра», «Пн», «Через неделю» — один щелчок вместо календаря. */
export class DateChips {
  static TASK = [
    ['Сегодня', () => today()],
    ['Завтра', () => CrmFmt.after(1)],
    ['Пн', () => CrmFmt.monday()],
    ['Через неделю', () => CrmFmt.after(CrmFmt.WEEK)],
  ];
  static DEAL = [
    ['2 недели', () => CrmFmt.after(14)],
    ['Месяц', () => CrmFmt.after(30)],
    ['3 месяца', () => CrmFmt.after(91)],
  ];

  /**
   * Чипы для поля даты name.
   * @param {Array} list TASK или DEAL
   * @param {string} name имя поля даты в форме
   * @param {string} cur выбранная дата
   * @returns {string}
   */
  static html(list, name, cur) {
    return `<span class="dchips" role="group" aria-label="Быстрый выбор даты">${list
      .map(([label, value]) => {
        const day = value();
        return `<button type="button" class="chip sm${day === cur ? ' on' : ''}" data-dchip="${esc(name)}" data-day="${day}" title="${esc(KpDate.ddmm(day))}">${esc(label)}</button>`;
      })
      .join('')}</span>`;
  }

  /**
   * Щелчок по чипу: дата — в поле формы, отметка — на чипе. true — щелчок был по чипу.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const chip = event.target.closest('[data-dchip]');
    if (!chip) return false;
    const form = chip.closest('form') || chip.closest('dialog');
    const input = form && form.querySelector(`[name="${chip.dataset.dchip}"]`);
    if (input) {
      input.value = chip.dataset.day;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    chip.parentElement.querySelectorAll('[data-dchip]').forEach(one => one.classList.toggle('on', one === chip));
    return true;
  }
}
