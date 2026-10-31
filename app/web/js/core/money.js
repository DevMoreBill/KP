/**
 * Деньги для показа — одно место для всей программы: kop — «1 234 567,89» (цены и суммы КП, KPGen.money), rub — «1 234 568 ₽»
 * (целые рубли), rub2 — с копейками, int — без знака валюты, short — «1,2 млн ₽». Половина округляется от нуля одинаково для
 * прибыли и убытка, «−0» не бывает, не посчитано — прочерк. Без DOM — работает и в проверках (node).
 */
export class Money {
  // валюты цен закупки, опций и перевозки — порядок в списках выбора
  static CURS = ['RUB', 'CNY', 'USD', 'EUR'];
  static SPACE = ' ';
  static MINUS = '−';
  static DASH = '—';
  static EPS = 1e-9;
  static THOUSAND = 1e3;
  static MILLION = 1e6;
  static KOPECKS = 100;

  /**
   * Число, округлённое до digits знаков: половина — от нуля; −0 → 0.
   * @param {number} value
   * @param {number} [digits]
   * @returns {number}
   */
  static round(value, digits = 0) {
    const scale = 10 ** digits;
    const rounded = (Math.sign(value) * Math.round(Math.abs(value) * scale + this.EPS)) / scale;
    return rounded === 0 ? 0 : rounded;
  }

  /**
   * «1 234 567» / «1 234 567,89»: группы через пробел, запятая, минус «−».
   * @param {number} value
   * @param {number} [digits]
   * @returns {string}
   */
  static text(value, digits = 0) {
    const rounded = this.round(value, digits);
    const abs = Math.abs(rounded);
    const whole = Math.floor(abs + this.EPS);
    const groups = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, this.SPACE);
    const frac = digits ? `,${String(Math.round((abs - whole) * 10 ** digits)).padStart(digits, '0')}` : '';
    return `${rounded < 0 ? this.MINUS : ''}${groups}${frac}`;
  }

  /**
   * Посчитано ли: конечное число.
   * @param {*} value
   * @returns {boolean}
   */
  static ok(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /**
   * «1 234 568» — рубли без знака валюты.
   * @param {*} value
   * @returns {string}
   */
  static int(value) {
    return this.ok(value) ? this.text(value) : this.DASH;
  }

  /**
   * «1 234 568 ₽» — целые рубли.
   * @param {*} value
   * @returns {string}
   */
  static rub(value) {
    return this.ok(value) ? `${this.text(value)}${this.SPACE}₽` : this.DASH;
  }

  /**
   * «1 234 567,89 ₽» — рубли с копейками.
   * @param {*} value
   * @returns {string}
   */
  static rub2(value) {
    return this.ok(value) ? `${this.text(value, 2)}${this.SPACE}₽` : this.DASH;
  }

  /**
   * Копейки — «1 234 567,89», как в документе КП.
   * @param {*} kop
   * @returns {string}
   */
  static kop(kop) {
    return typeof KPGen !== 'undefined' ? KPGen.money(kop) : this.text((+kop || 0) / this.KOPECKS, 2);
  }

  /**
   * «1,2 млн ₽», «350 тыс. ₽»: порог — по уже округлённому числу (999 500 ₽ → «1 млн ₽», а не «1 000 тыс. ₽»).
   * @param {*} value
   * @returns {string}
   */
  static short(value) {
    const rub = +value || 0;
    if (Math.abs(this.round(rub / this.THOUSAND)) >= this.THOUSAND) {
      return `${this.text(rub / this.MILLION, 1).replace(/,0$/, '')}${this.SPACE}млн${this.SPACE}₽`;
    }
    if (Math.abs(this.round(rub)) >= this.THOUSAND)
      return `${this.text(rub / this.THOUSAND)}${this.SPACE}тыс.${this.SPACE}₽`;
    return this.rub(rub);
  }
}
