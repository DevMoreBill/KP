import { UiKit } from '../../core/ui-kit.js';

/**
 * Общее у вкладки «База и копии» и её панелей (выгрузка, загрузка, каталог по фильтру, файл настроек): строки и низ
 * формы, выбор формата (запоминается), открытая вкладка и выбранное в «Каталоге по фильтру»; сводка и переход к пункту
 * загрузки — у вкладки, она подключает их сама (admin/index.js).
 */
export class BackupKit {
  static FMT = [
    ['xlsx', 'Excel (.xlsx) — таблица, можно править'],
    ['json', 'JSON — данные как есть'],
    ['xml', 'XML'],
    ['yml', 'YML — для сайтов (только каталог, без закупки)'],
    ['zip', 'Архив .zip — данные и все фото'],
  ];
  static SQLITE = ['sqlite', 'Точная копия базы (.sqlite в архиве .zip)'];
  static FMT_TIP =
    '<p>У всех вариантов выгрузки — одни и те же форматы, и любой файл загружается обратно: «Загрузить → Копия или правки» (настройки — «Файл настроек»).</p><p><b>Excel</b> — лист на раздел: строка 2 — служебные ключи, столбец «Код» не меняйте; при загрузке можно взять только изменённые строки. <b>JSON</b> и <b>XML</b> — данные как есть. <b>YML</b> — каталог в формате Яндекса для сайтов и маркетплейсов (и данные для загрузки обратно). <b>Архив .zip</b> — JSON и все фото, на которые он ссылается.</p>';
  static FMT_KEY = 'kp.bk.fmt';
  static main = null;
  static flt = null; // «Каталог по фильтру»: выбранное (переживает переключение вариантов)

  /**
   * Строка «что — пояснение — кнопки» (и в «Файле настроек» на вкладке «Файл, изменения, откат»).
   * @param {string} title
   * @param {string} note
   * @param {string} acts
   * @param {string} [id]
   * @returns {string}
   */
  static row(title, note, acts, id = '') {
    return `<div class="bk-row"${id ? ` id="${id}"` : ''}><div class="bk-t"><b>${title}</b><small class="muted">${note}</small></div><div class="bk-a">${acts}</div></div>`;
  }

  /**
   * Низ формы: строка состояния и кнопка.
   * @param {string} button
   * @param {string} [note]
   * @returns {string}
   */
  static foot(button, note = '') {
    return `<div class="bk-foot"><span class="bk-note" id="bkSt">${note}</span>${button}</div>`;
  }

  /**
   * Запомненный формат выгрузки.
   * @returns {string}
   */
  static fmt() {
    try {
      return localStorage.getItem(this.FMT_KEY) || 'xlsx';
    } catch {
      return 'xlsx';
    }
  }

  /**
   * Варианты формата.
   * @param {{sqlite?: boolean}} [opts] sqlite — и точная копия базы
   * @returns {string}
   */
  static fmtOpts({ sqlite = false } = {}) {
    const current = this.fmt();
    const list = [...(sqlite ? [this.SQLITE] : []), ...this.FMT];
    return list
      .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`)
      .join('');
  }

  /**
   * Поле «Формат».
   * @param {{sqlite?: boolean}} [opts]
   * @returns {string}
   */
  static fmtSel(opts) {
    return `<label class="f"><span class="st-mh">Формат ${UiKit.tip(this.FMT_TIP)}</span><select id="bkFmt" data-nodirty>${this.fmtOpts(opts)}</select></label>`;
  }

  /**
   * Выбранный формат (запоминается для всех вариантов, кроме точной копии базы).
   * @param {HTMLElement} box
   * @returns {string}
   */
  static fmtOf(box) {
    const value = box.querySelector('#bkFmt').value;
    if (value !== 'sqlite')
      try {
        localStorage.setItem(this.FMT_KEY, value);
      } catch {
        // без запоминания
      }
    return value;
  }

  /** вкладка подключает себя: сводка заново, переход к своему пункту загрузки */
  static tab = {
    summary: async () => {},
    redirect: async () => {},
  };

  /**
   * Вкладка «База и копии» подключает себя.
   * @param {object} tab {summary, redirect}
   */
  static connect(tab) {
    this.tab = { ...this.tab, ...tab };
  }

  /**
   * Сводка вкладки (база, копии, вторая папка, диск) — заново.
   * @returns {Promise<void>}
   */
  static summary() {
    return this.tab.summary();
  }

  /**
   * Файл настроек или базы целиком, выбранный в «Копия или правки», — открыть свой пункт и продолжить там.
   * @param {string} kind settings | db
   * @param {File} file
   * @returns {Promise<*>}
   */
  static redirect(kind, file) {
    return this.tab.redirect(kind, file);
  }
}
