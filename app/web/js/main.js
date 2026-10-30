import { S } from './core/state.js';
import { MyDay } from './features/kp/my-day.js';
import { SectionMemory } from './ui/section-memory.js';
import { MigrationNotice } from './features/catalog/migration-notice.js';
import { Reminders } from './features/kp/reminders.js';
import { Drafts } from './features/kp/drafts.js';
import { CatalogWindow } from './features/catalog/catalog-window.js';
import { FormView } from './ui/form-view.js';
import { UiTexts } from './features/kp/ui-texts.js';
import { HelpWindow } from './features/kp/help-window.js';
import { Logos } from './features/catalog/image-slots.js';
import { FEAT } from './core/features.js';
import { LISTS } from './core/lists.js';
import { Catalog } from './features/catalog/catalog-store.js';
import { Templates } from './features/doc/templates.js';
import { Managers } from './features/kp/managers.js';
import { ClientStore } from './features/kp/client-store.js';
import { EquipTypes } from './core/equip-types.js';
import { AdminSession, Api, ServerDefaults, Srv } from './core/net.js';
import { AiDirect } from './features/catalog/ai-chat.js';
import { AuthMenu, AuthScreen } from './features/kp/auth-screen.js';
import { Auth } from './features/kp/auth.js';
import { $, esc } from './core/util.js';
import { Toast } from './core/toast.js';
import { MyPrefs } from './features/kp/my-prefs.js';
import { Theme } from './core/theme.js';
import { AppSections } from './ui/app-sections.js';
import { KpTabs } from './features/kp/kp-tabs.js';
import { Steps } from './ui/steps.js';
// Запуск программы: проверка сервера, вход, загрузка справочников и каталога — последним модулем страницы.

/** Порядок запуска: сервер, вход, умолчания, справочники, первая отрисовка, первый экран. */
export class App {
  static OFFLINE = `<div style="max-width:620px;margin:80px auto;font:16px/1.5 system-ui;padding:24px;border:1px solid #cfe0f2;border-radius:14px"><h2 style="margin-top:0;color:#0B45A0">Программа не запущена</h2><p>Откройте «Конструктор КП.exe» — он запустит программу и откроет её в браузере. Если вы работаете с сервером отдела, проверьте, что компьютер-сервер включён, и откройте ярлык «Конструктор КП (сервер …)».</p></div>`;

  static BOOT = 'app-boot';

  /** Запустить программу; форма КП показывается, только когда выбран первый экран (кабинет или КП). */
  static async start() {
    try {
      await this._run();
    } finally {
      document.documentElement.classList.remove(this.BOOT);
    }
  }

  static async _run() {
    if (!(await this._ping())) {
      document.body.innerHTML = this.OFFLINE;
      return;
    }
    this._serverMenu();
    AppSections.register();
    await Auth.load();
    // вошёл с временным паролем — сначала свой
    if (Auth.state.enabled && Auth.state.user && Auth.state.user.mustChange && !Auth.state.admin) {
      AuthScreen.change();
      return;
    }
    AiDirect.load();
    ServerDefaults.load();
    if (Auth.state.enabled && !Auth.state.user && !Auth.state.admin) {
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
      ClientStore.load(),
      Managers.load(),
      Templates.load(),
      Catalog.refresh(),
      LISTS.load(),
      FEAT.load(),
      MyPrefs.load(),
    ]);
    Logos.load();
    HelpWindow.loadVersion();
    UiTexts.load();
    FormView.render();
    AuthMenu.mount();
  }

  static _open() {
    // поиск в каталоге — готов заранее
    (window.requestIdleCallback || setTimeout)(() => CatalogWindow.win.prewarm());
    Drafts.start();
    Reminders.load();
    Reminders.poll();
    // кабинет — точка входа (сообщение об обновлении базы — поверх него); обновили страницу — тот же раздел, что был
    const cabinet = MyDay.start();
    const back = SectionMemory.restore();
    SectionMemory.listen();
    if (MigrationNotice.show(Srv.info.migrations) || cabinet || back) return;
    // пустое КП начинается с клиента, оборудование — следующим шагом
    if (!S.items.length) Steps.open('client');
  }
}

KpTabs.init();
App.start().catch(error => Toast.show(`Программа запустилась не полностью: ${error.message || error}`));
FormView.render();
Theme.listen();
