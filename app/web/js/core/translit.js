/** Латинское имя из русского названия: для папок шаблонов, ключей категорий и параметров. */
export class Translit {
  static MAX = 40;
  static LETTERS = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  /**
   * «Шаблон ПНЕВМОТЕХ — копия» → «shablon-pnevmoteh-kopiya».
   * @param {string} text
   * @returns {string}
   */
  static slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[а-яё]/g, char => this.LETTERS[char] || '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, this.MAX);
  }
}
