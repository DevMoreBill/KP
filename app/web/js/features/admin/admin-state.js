/** Состояние окна «Настройки»: вкладка, выбор записей, журнал действий, график, вход администратора, открытая карточка. */
export class AdminState {
  static tab = 'home';
  static del = { type: 'kp', q: '', sel: new Set() };
  static audit = { page: 0, f: {} };
  static imp = null;
  static chart = 'day';
  static chartOpen = false;
  static status = null;
  static editing = null;
  /** окно «Настроек» подключает себя (admin/index.js): вкладки и панели его не подключают (циклы import) */
  static win = {
    dialog: () => null,
    show: async () => {},
    route: key => key,
    tabKey: key => key,
  };

  /**
   * Окно «Настроек» подключает себя.
   * @param {object} win {dialog, show, route, tabKey}
   */
  static connect(win) {
    this.win = { ...this.win, ...win };
  }

  /**
   * Окно «Настроек» (создаётся один раз).
   * @returns {HTMLDialogElement}
   */
  static dialog() {
    return this.win.dialog();
  }

  /**
   * Показать выбранную вкладку заново.
   * @param {{click?: boolean}} [opts] click — открыта щелчком по меню
   * @returns {Promise<void>}
   */
  static show(opts) {
    return this.win.show(opts);
  }

  /**
   * Перейти по ключу: прежний ключ или «вкладка:часть» — открыть нужную часть.
   * @param {string} key
   * @returns {string} ключ вкладки
   */
  static route(key) {
    return this.win.route(key);
  }

  /**
   * Ключ вкладки (прежние ключи — в нынешние, неизвестный — главная).
   * @param {string} key
   * @returns {string}
   */
  static tabKey(key) {
    return this.win.tabKey(key);
  }
}
