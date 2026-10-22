import { AdminApi, AdminState } from './admin-core.js';
import { AppTabs } from '../../core/app-tabs.js';
import { AdminNav } from './admin-nav.js';
import { SettingsSearch, StAutoSave, StDirty, StNav } from './settings-tools.js';
import { UiKit } from '../../ui/ui-kit.js';
import { DefRegistry } from '../../core/defaults.js';
import { LoginForm } from '../kp/login-form.js';
import { Toast } from '../../core/toast.js';
import { FEAT } from '../../core/features.js';
import { $, esc } from '../../core/util.js';
import { AdminSession, Api } from '../../core/net.js';
import { Mobile } from '../../ui/mobile.js';
import { Modal } from '../../core/modal.js';

/**
 * Окно «Настройки» — админ-панель под паролем администратора (сервер: app/admin.py): размер окна запоминается, вход,
 * меню разделов и открытая вкладка. Сессия — 15 минут бездействия.
 */
export class SettingsWindow {
  static RESIZE_WAIT = 600;
  static MIN_WIDTH = 300;
  static STORE = 'kp.setwin';

  /**
   * Окно (создаётся один раз): размер запоминается, «⤢» — во весь экран.
   * @returns {HTMLDialogElement}
   */
  static dialog() {
    return Modal.host('setdlg', 'setwin', 'Настройки', dialog => this._setup(dialog));
  }

  static _setup(dialog) {
    this._restoreSize(dialog);
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-st="max"]')) {
        dialog.classList.toggle('max');
        this._saveSize(dialog);
      }
    });
    let timer = null;
    new ResizeObserver(() => {
      if (!dialog.open || Mobile.isPhone() || dialog.classList.contains('max') || dialog.classList.contains('login'))
        return;
      clearTimeout(timer);
      timer = setTimeout(() => this._resized(dialog), this.RESIZE_WAIT);
    }).observe(dialog);
  }

  static _resized(dialog) {
    const rect = dialog.getBoundingClientRect();
    if (rect.width <= this.MIN_WIDTH) return;
    dialog.style.width = `${Math.round(rect.width)}px`;
    dialog.style.height = `${Math.round(rect.height)}px`;
    this._saveSize(dialog);
  }

  static _saveSize(dialog) {
    try {
      const size = { max: dialog.classList.contains('max'), w: dialog.style.width || '', h: dialog.style.height || '' };
      localStorage.setItem(this.STORE, JSON.stringify(size));
    } catch {
      // хранилище браузера недоступно — размер не запоминается
    }
  }

  static _restoreSize(dialog) {
    try {
      const size = JSON.parse(localStorage.getItem(this.STORE) || '{}') || {};
      dialog.classList.toggle('max', !!size.max);
      if (size.w) dialog.style.width = size.w;
      if (size.h) dialog.style.height = size.h;
    } catch {
      // хранилище браузера недоступно — размер по умолчанию
    }
  }

  /**
   * Открыть «Настройки».
   * @param {string} [tab] ключ вкладки
   */
  static async open(tab) {
    if (tab) AdminState.tab = tab;
    const dialog = this.dialog();
    if (!AdminSession.on) dialog.classList.add('login');
    AppTabs.show(dialog, 'set');
    dialog.innerHTML = '<p class="empty">Загружаю…</p>';
    try {
      const status = await Api.request('/api/admin/status');
      AdminSession.set(status.admin, status.csrf);
      AdminState.status = status;
    } catch {
      AdminState.status = {};
    }
    this.render();
  }

  static _head(status) {
    const who = AdminSession.on && status.name ? `<small>${esc(status.name)} · ${esc(status.login || '')}</small>` : '';
    const logout = AdminSession.on ? '<button class="btn ghost" type="button" data-st="logout">Выйти</button>' : '';
    return `<div class="dlg-h"><h3>Настройки${who}</h3>${logout}<button class="icon st-maxb" type="button" data-st="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна меняется, если потянуть за правый нижний угол">⤢</button><button class="icon" type="button" data-st="close" aria-label="Закрыть">✕</button></div>`;
  }

  /** Перерисовать окно: вход или меню и вкладка. */
  static render() {
    const dialog = this.dialog();
    const status = AdminState.status || {};
    const head = this._head(status);
    dialog.classList.toggle('login', !AdminSession.on);
    if (!AdminSession.on) {
      AdminLogin.render(dialog, head, status);
      return;
    }
    AdminState.tab = AdminNav.route(AdminState.tab);
    dialog.innerHTML = `${head}<div class="st-b">${AdminNav.html(AdminState.tab)}
    <section class="st-main" id="stMain"><p class="empty">Загружаю…</p></section></div>`;
    dialog.querySelector('.st-nav .on')?.scrollIntoView({ block: 'nearest' });
    SettingsSearch.bind(dialog);
    StDirty.watch(dialog);
    StAutoSave.watch(dialog);
    this.tab();
  }

  /**
   * Показать выбранную вкладку.
   * @param {{click?: boolean}} [opts] click — открыта щелчком по меню
   */
  static async tab({ click = false } = {}) {
    const main = $('#stMain');
    if (!main) return;
    try {
      await AdminNav.open(main, AdminState.tab, { click });
    } catch (error) {
      if (AdminSession.on) main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
    }
  }

  /** Щелчки в окне: вкладка, закрыть, выйти. */
  static listen() {
    document.addEventListener('click', event => this._click(event));
  }

  static async _click(event) {
    const dialog = event.target.closest('#setdlg');
    if (!dialog) return;
    const tab = event.target.closest('[data-sttab]');
    if (tab) {
      await this._openTab(tab.dataset.sttab);
      return;
    }
    const action = event.target.closest('[data-st]');
    if (action && action.dataset.st === 'close') {
      if (await StDirty.leave()) dialog.close();
      return;
    }
    if (action && action.dataset.st === 'logout') await this._logout();
  }

  static async _openTab(key) {
    if (!(await StDirty.leave())) return;
    const find = $('#stFind');
    if (find) find.value = '';
    StNav.select(key);
    this.tab({ click: true });
  }

  static async _logout() {
    if (!(await StDirty.leave())) return;
    AdminApi.post('logout')
      .catch(() => {})
      .then(() => {
        AdminSession.set(false);
        this.render();
        FEAT.refresh();
        Toast.show('Вы вышли из «Настроек»');
      });
  }
}

/** Вход администратора в «Настройки» (и создание первой учётной записи на компьютере-сервере): компактное окно. */
export class AdminLogin {
  static PW_MIN = 8;
  static IDLE_MIN = 15;
  static FOCUS_WAIT = 30;
  static STORE = 'kp.adminLogin';

  /**
   * Форма входа.
   * @param {HTMLDialogElement} dialog
   * @param {string} head заголовок окна
   * @param {object} status ответ /api/admin/status
   */
  static render(dialog, head, status) {
    const setup = !status.hasPassword;
    const body = setup && !status.canSetup ? this._noSetup() : this._fields(setup, status);
    dialog.innerHTML = `${head}<div class="st-login"><form id="stLogin" autocomplete="on" novalidate>
      <p class="st-login-h">${setup ? 'Создайте учётную запись администратора' : 'Вход администратора'}</p>${body}</form></div>`;
    const form = $('#stLogin');
    const err = $('#stErr');
    if (err) LoginForm.bind(form, () => this._send(setup, status), err);
    setTimeout(() => {
      const login = $('#stLg');
      (login && login.value ? $('#stPw') : login)?.focus();
    }, this.FOCUS_WAIT);
  }

  static _noSetup() {
    return '<p class="msg warn">Администратор ещё не создан. Создайте учётную запись на компьютере, где работает программа (сервер отдела): откройте программу там и нажмите «Настройки».</p>';
  }

  static _last() {
    try {
      return localStorage.getItem(this.STORE) || '';
    } catch {
      return '';
    }
  }

  static _fields(setup, status) {
    const min = DefRegistry.num('srv.adminPwMin', this.PW_MIN);
    return `${LoginForm.login('stLg', 'Логин', setup ? 'admin' : this._last(), 'placeholder="admin"')}
        ${setup ? '<label class="f"><span>Имя (для журнала действий)</span><input type="text" id="stNm" autocomplete="name" placeholder="Например, Петров А. В."></label>' : ''}
        ${LoginForm.password('stPw', setup ? `Пароль — не короче ${min} символов, буквы и цифры` : 'Пароль', setup ? 'new-password' : 'current-password')}
        ${setup ? LoginForm.password('stPw2', 'Повторите пароль', 'new-password') : ''}
        <p class="auth-err" id="stErr" role="alert" aria-live="assertive" hidden></p>
        <button class="btn primary auth-go" type="submit">${setup ? 'Создать и войти' : 'Войти'}</button>
        <div class="muted st-login-note">Через ${status.idleMinutes || this.IDLE_MIN} мин бездействия вход закрывается.${UiKit.tip('Только в «Настройках»: удаление и правка данных, модерация, резервные копии, шаблоны, ключи API, вход менеджеров и администраторы. Забыли пароль — его меняет другой администратор («Сотрудники и вход → Администраторы»).')}</div>`;
  }

  static async _send(setup, status) {
    const login = $('#stLg').value.trim();
    const password = $('#stPw').value;
    if (!login || !password) throw new Error(login ? 'Введите пароль' : 'Введите логин');
    if (setup && password !== $('#stPw2').value) throw new Error('Пароли не совпадают');
    const body = setup ? { login, name: $('#stNm').value.trim(), password } : { login, password };
    const reply = await LoginForm.post(`/api/admin/${setup ? 'setup' : 'login'}`, body);
    try {
      localStorage.setItem(this.STORE, login);
    } catch {
      // хранилище браузера недоступно — логин не запоминается
    }
    AdminSession.set(true, reply.csrf);
    const fresh = await Api.request('/api/admin/status').catch(() => ({}));
    AdminState.status = { ...status, ...fresh, hasPassword: true };
    SettingsWindow.render();
    FEAT.refresh();
  }
}
