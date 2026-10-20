/**
 * Графический редактор шаблона КП: состояние окна, подписи и единицы (см, пт). Настройки шаблона правятся в рабочей копии
 * state.work и хранятся в template.json шаблона.
 */
export class Design {
  static state = {
    id: '',
    pack: null,
    form: null,
    work: null,
    saved: '',
    undo: [],
    redo: [],
    sel: null,
    tab: 'struct',
    zoom: 0,
    busy: false,
    again: false,
    timer: 0,
    demo: false,
    err: '',
    note: '',
    drag: false,
    clickBlock: false,
  };
  static SECTION_NAMES = {
    cover: 'Титульный лист',
    clients: 'Наши клиенты',
    equipment: 'Страницы оборудования',
    offer: 'Коммерческое предложение',
    conditions: 'Условия',
    contacts: 'Контакты',
  };
  // картинки макета: ключ (правило ширины) → подпись
  static IMAGES = {
    coverPhotoWidthCm: 'Фото на титуле',
    equipPhotoWidthCm: 'Главное фото оборудования',
    componentPhotoWidthCm: 'Фото узлов',
    logoWidthCm: 'Логотип производителя',
    clientsWidthCm: 'Картинка «Наши клиенты»',
    headerLogo: 'Логотип в шапке',
  };
  static VARS = ['клиент', 'номер', 'дата', 'менеджер', 'телефон', 'email', 'сайт'];
  static ALIGN = [
    ['left', '⯇', 'Влево'],
    ['center', '≡', 'По центру'],
    ['right', '⯈', 'Вправо'],
    ['both', '☰', 'По ширине'],
  ];
  static BLOCK_SECTIONS = [
    [/^cover/, 'cover'],
    [/^(equip|spec)/, 'equipment'],
    [/^(discount|amountInWords|currencyNote)$/, 'offer'],
  ];
  static CENTS = 100;
  static TENTHS = 10;
  static PT_PER_CM = 28.35;
  static UID_BASE = 36;
  static UID_FROM = 2;
  static UID_TO = 5;

  /**
   * Раздел, к которому относится блок шаблона (blocks.<ключ>).
   * @param {string} key
   * @returns {string}
   */
  static blockSection(key) {
    const row = this.BLOCK_SECTIONS.find(([pattern]) => pattern.test(key));
    return row ? row[1] : 'all';
  }

  /**
   * Сантиметры для подписи: «2,5».
   * @param {number|string} value
   * @returns {string}
   */
  static cmText(value) {
    return String(Math.round((+value || 0) * this.CENTS) / this.CENTS).replace('.', ',');
  }

  /**
   * Число из поля ввода (запятая — тоже) или NaN.
   * @param {*} value
   * @returns {number}
   */
  static num(value) {
    const number = +String(value ?? '').replace(',', '.');
    return isFinite(number) ? number : NaN;
  }

  /**
   * Округление: steps — долей единицы (10 — до десятых).
   * @param {number} value
   * @param {number} [steps]
   * @returns {number}
   */
  static round(value, steps = this.TENTHS) {
    return Math.round(value * steps) / steps;
  }

  /**
   * Новый код объекта шаблона.
   * @returns {string}
   */
  static uid() {
    return Date.now().toString(this.UID_BASE) + Math.random().toString(this.UID_BASE).slice(this.UID_FROM, this.UID_TO);
  }

  /**
   * Элемент документа в окне редактора.
   * @param {string} selector
   * @returns {HTMLElement|null}
   */
  static query(selector) {
    return document.querySelector(`#tdPages ${selector}`);
  }

  /**
   * Элементы документа в окне редактора.
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  static queryAll(selector) {
    return [...document.querySelectorAll(`#tdPages ${selector}`)];
  }

  /**
   * Адрес файла шаблона.
   * @param {string} file
   * @returns {string}
   */
  static imageUrl(file) {
    return `/tpl/${encodeURIComponent(this.state.id)}/${encodeURIComponent(file)}`;
  }
}
