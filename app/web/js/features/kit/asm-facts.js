/**
 * Проверка ответа ИИ по исходным данным: число в тексте ИИ допустимо, только если оно есть в данных частей или в файле
 * (или это небольшое целое — количество). Предложение с чужим числом отбрасывается, значение — не ставится.
 */
export class AsmFacts {
  static SMALL = 10;
  static NUMBER = /\d+(?:[.,]\d+)?/g;
  static THOUSANDS = /(\d)[\s  ](?=\d{3}(?!\d))/g;
  static SENTENCE = /(?<=[.!?…])\s+/;

  /**
   * Числа текста (тысячи без пробелов, запятая — точка).
   * @param {string} text
   * @returns {string[]}
   */
  static numbers(text) {
    const plain = String(text ?? '').replace(this.THOUSANDS, '$1');
    return (plain.match(this.NUMBER) || []).map(value => this._norm(value));
  }

  static _norm(value) {
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) ? String(number) : String(value);
  }

  /**
   * Набор известных чисел из исходных текстов.
   * @param {string[]} sources
   * @returns {Set<string>}
   */
  static known(sources) {
    return new Set(sources.flatMap(text => this.numbers(text)));
  }

  /**
   * Все числа текста известны (небольшие целые — всегда).
   * @param {string} text
   * @param {Set<string>} known
   * @returns {boolean}
   */
  static ok(text, known) {
    return this.numbers(text).every(value => known.has(value) || this._small(value));
  }

  static _small(value) {
    const number = Number(value);
    return Number.isInteger(number) && number <= this.SMALL;
  }

  /**
   * Текст без предложений с неизвестными числами.
   * @param {string} text
   * @param {Set<string>} known
   * @returns {string}
   */
  static keep(text, known) {
    return String(text ?? '')
      .split(this.SENTENCE)
      .filter(sentence => sentence.trim() && this.ok(sentence, known))
      .join(' ')
      .trim();
  }

  /**
   * Слово (производитель, модель) встречается в исходном тексте — иначе пусто.
   * @param {string} word
   * @param {string} source
   * @returns {string}
   */
  static word(word, source) {
    const text = String(word ?? '').trim();
    if (!text) return '';
    return String(source ?? '')
      .toLowerCase()
      .includes(text.toLowerCase())
      ? text
      : '';
  }
}
