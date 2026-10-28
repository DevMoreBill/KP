// Основа разметки и дат: поиск элемента, экранирование текста для HTML, сегодняшняя дата, номера записей.

// eslint-disable-next-line id-length -- короткое имя поиска элемента, им пользуются все разделы
export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = text =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'); // и в атрибуте в одинарных кавычках

// по местному времени: toISOString дал бы дату по Гринвичу — ночью это вчерашний день
export const isoDay = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const today = () => isoDay(new Date());

/** Короткий случайный номер записи (позиции, опции, строки). */
export class Uid {
  static LENGTH = 7;

  /**
   * Новый номер.
   * @returns {string}
   */
  static next() {
    return Math.random()
      .toString(36)
      .slice(2, 2 + this.LENGTH);
  }
}
