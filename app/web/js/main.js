// Запуск программы: проверка сервера, вход, загрузка справочников и каталога — последним модулем страницы.

/** Светлая и тёмная тема: выбор хранится в браузере (и в «Моих настройках»); без выбора (auto) — как в системе. */
export class Theme {
  static NAMES = ['light', 'dark', 'auto'];
  static SYSTEM = matchMedia('(prefers-color-scheme: dark)');
  static STORE = 'kp.theme';

  /**
   * Действующая тема.
   * @returns {'light' | 'dark'}
   */
  static current() {
    const theme = document.documentElement.dataset.theme;
    if (theme === 'dark' || theme === 'light') return theme;
    return this.SYSTEM.matches ? 'dark' : 'light';
  }

  /**
   * Выбрать тему: light, dark или auto (как в системе).
   * @param {string} theme
   */
  static set(theme) {
    const root = document.documentElement;
    const fixed = theme === 'light' || theme === 'dark';
    if (fixed) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } else {
      delete root.dataset.theme;
      root.style.colorScheme = '';
    }
    try {
      if (fixed) localStorage.setItem(this.STORE, theme);
      else localStorage.removeItem(this.STORE);
    } catch {
      // без хранилища браузера
    }
    this.paintButton();
  }

  /** Переключить светлую и тёмную (и запомнить в «Моих настройках»). */
  static toggle() {
    const theme = this.current() === 'dark' ? 'light' : 'dark';
    this.set(theme);
    MyPrefs.rememberTheme(theme);
  }

  /** Надпись пункта меню — тема, на которую переключит. */
  static paintButton() {
    $('#btnTheme').textContent = this.current() === 'dark' ? '☀  Светлая тема' : '☾  Тёмная тема';
  }

  /** Обработчики: пункт меню и смена темы системы. */
  static listen() {
    $('#btnTheme').addEventListener('click', () => Theme.toggle());
    this.SYSTEM.addEventListener('change', () => Theme.paintButton());
    this.paintButton();
  }
}

/** Порядок запуска: сервер, вход, умолчания, справочники, первая отрисовка, первый экран. */
export class App {
  static OFFLINE = `<div style="max-width:620px;margin:80px auto;font:16px/1.5 system-ui;padding:24px;border:1px solid #cfe0f2;border-radius:14px"><h2 style="margin-top:0;color:#0B45A0">Программа не запущена</h2><p>Откройте «Конструктор КП.exe» — он запустит программу и откроет её в браузере. Если вы работаете с сервером отдела, проверьте, что компьютер-сервер включён, и откройте ярлык «Конструктор КП (сервер …)».</p></div>`;

  /** Запустить программу. */
  static async start() {
    if (!(await this._ping())) {
      document.body.innerHTML = this.OFFLINE;
      return;
    }
    this._serverMenu();
    await authLoad();
    // вошёл с временным паролем — сначала свой
    if (AUTH.enabled && AUTH.user && AUTH.user.mustChange && !AUTH.admin) {
      AuthScreen.change();
      return;
    }
    aiStatusLoad();
    DefRegistry.load();
    if (AUTH.enabled && !AUTH.user && !AUTH.admin) {
      AuthScreen.show();
      return;
    }
    await this._adminSession();
    await this._load();
    this._open();
  }

  static async _ping() {
    try {
      Srv.info = await Api.request('/api/ping');
      Srv.on = true;
    } catch {
      // сервер не отвечает
    }
    return Srv.on;
  }

  static _serverMenu() {
    const remote = Srv.info.local === false || Srv.info.mode === 'server';
    $('#srvBtns').hidden = false;
    $('#btnExit').hidden = remote;
    document.title = 'Конструктор КП — ПНЕВМОТЕХ';
    if (!remote) return;
    const menu = document.querySelector('.topmenu .menu-l');
    if (menu) {
      menu.insertAdjacentHTML(
        'afterbegin',
        `<div class="menu-info" title="Общая база отдела">Сервер отдела: <b>${esc(Srv.info.host || location.hostname)}</b></div><hr>`,
      );
    }
  }

  // вход администратора действует и после обновления страницы
  static async _adminSession() {
    try {
      const status = await Api.request('/api/admin/status');
      AdminSession.set(status.admin, status.csrf);
    } catch {
      // не администратор
    }
  }

  // справочники — параллельно (каталогу нужны только категории); списки и выборы администратора — до первой отрисовки
  static async _load() {
    await EquipTypes.load();
    await Promise.all([
      loadClients(),
      loadManagers(),
      Templates.load(),
      refreshCat(),
      LISTS.load(),
      FEAT.load(),
      MyPrefs.load(),
    ]);
    loadLogos();
    loadAppVersion();
    uitLoad();
    renderForm();
    AuthMenu.mount();
  }

  static _open() {
    // поиск в каталоге — готов заранее
    (window.requestIdleCallback || setTimeout)(() => CW.prewarm());
    Drafts.start();
    Reminders.load();
    Reminders.poll();
    // «Мой день» — вместо каталога
    if (
      !showMigrationNotice(Srv.info.migrations) &&
      !MyPrefs.start() &&
      !MyDay.start() &&
      !S.items.length &&
      catCache.length
    ) {
      openCatalog({});
    }
  }
}

Object.assign(globalThis, { App, Theme });

App.start();
renderForm();
Theme.listen();
