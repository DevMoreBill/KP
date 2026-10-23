/**
 * Телефон в одном виде, как на сервере (app/phone.py): российский номер — «+7 (900) 123-45-67», добавочный — « доб. 12»,
 * иностранный — «+» и цифры. Поле телефона приводится к этому виду, когда из него уходят (событие change).
 */
export class Phone {
  static NATIONAL = 10;
  static WITH_CODE = 11;
  static TRUNK = ['7', '8'];
  static EXTENSION = /\s*(?:,|;)?\s*(?:доб(?:авочный)?|вн(?:утр(?:енний)?)?|ext)\.?\s*:?\s*(\d{1,6})\s*$/i;
  static NUMBER = /^\+?[\d\s().-]+$/;
  // поле телефона: type="tel" или имя поля (data-*, name) кончается на phone / mobile
  static FIELD = /(?:^|[._-])(?:phone|mobile)$|Phone$/;

  /**
   * Номер в одном виде; не похожее на номер (короткий городской, текст) — как ввели.
   * @param {string} value
   * @returns {string}
   */
  static format(value) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    const found = text.match(this.EXTENSION);
    const number = found ? text.slice(0, found.index).trim() : text;
    const extension = found ? ` доб. ${found[1]}` : '';
    if (!this.NUMBER.test(number)) return text;
    const digits = number.replace(/\D/g, '');
    const foreign = number.startsWith('+') && !number.startsWith('+7');
    const national = foreign ? '' : this._national(digits);
    if (national) {
      return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8)}${extension}`;
    }
    if (number.startsWith('+') && digits) return `+${digits}${extension}`;
    return text;
  }

  static _national(digits) {
    if (digits.length === this.WITH_CODE && this.TRUNK.includes(digits[0])) return digits.slice(1);
    return digits.length === this.NATIONAL ? digits : '';
  }

  /**
   * Это поле телефона?
   * @param {Element} field
   * @returns {boolean}
   */
  static isField(field) {
    if (!(field instanceof HTMLInputElement)) return false;
    if (field.type === 'tel') return true;
    const names = [field.name, ...Object.values(field.dataset)].filter(Boolean);
    return names.some(name => this.FIELD.test(name));
  }

  /** Привести номер к одному виду до того, как его прочтут обработчики сохранения (фаза захвата). */
  static listen() {
    document.addEventListener(
      'change',
      event => {
        const field = event.target;
        if (!this.isField(field)) return;
        const shown = this.format(field.value);
        if (shown === field.value) return;
        field.value = shown;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      true,
    );
  }
}
