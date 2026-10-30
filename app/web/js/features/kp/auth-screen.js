import { Auth } from './auth.js';
import { HelpWindow } from './help-window.js';
import { LoginForm } from './login-form.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { AdminSession, Api } from '../../core/net.js';
import { SettingsWindow } from '../admin/settings-window.js';
import { UiKit } from '../../ui/ui-kit.js';
import { AppVersion } from '../help.js';
import { $, esc } from '../../core/util.js';

/** Экран входа менеджера (вход по паролю включён, сессии нет). */
export class AuthScreen {
  static SESSION_DAYS = 30;
  static SHORT_HOURS = 12;
  static FOCUS_DELAY = 30;
  static BRAND = '<div class="auth-logo">ПНЕВМО<span>ТЕХ</span></div>';

  /**
   * Показать экран входа.
   * @param {string} [msg] почему (сессия закончилась)
   */
  static show(msg) {
    const state = Auth.state;
    if (state.shown) return;
    state.shown = true;
    document.body.insertAdjacentHTML('beforeend', this._html(msg));
    const form = $('#authForm');
    LoginForm.bind(form, () => this._send(), $('#authErr'));
    form.querySelector('#authLogin').addEventListener('input', () => {
      $('#authErr').hidden = true;
    });
    $('#authAdm').onclick = () => this._admin();
    $('#authForgot').onclick = event => {
      const help = $('#authHelp');
      const open = help.hidden;
      help.hidden = !open;
      event.currentTarget.setAttribute('aria-expanded', String(open));
    };
    HelpWindow.loadVersion().then(() => {
      const version = $('#authVer');
      if (version && AppVersion.current) version.textContent = `версия ${AppVersion.current}`;
    });
    setTimeout(() => {
      const login = $('#authLogin');
      (login && login.value ? $('#authPw') : login)?.focus();
    }, this.FOCUS_DELAY);
  }

  static _html(msg) {
    const state = Auth.state;
    const days = state.sessionDays || this.SESSION_DAYS;
    const hours = state.shortHours || this.SHORT_HOURS;
    const help = state.help ? `<p><b>${esc(state.help)}</b></p>` : '';
    const note = msg
      ? `<p class="msg warn auth-note">${esc(msg)}</p>`
      : '<p class="muted auth-note">Войдите под своим логином — его и пароль выдаёт администратор.</p>';
    return `<div class="auth-wrap" id="authWrap"><form class="auth-card" id="authForm" autocomplete="on" novalidate>
      <div class="auth-brand">${this.BRAND}<div class="auth-app">Конструктор КП<small id="authVer"></small></div></div>
      ${note}
      ${LoginForm.login('authLogin', 'Логин', this._last())}
      ${LoginForm.password('authPw', 'Пароль', 'current-password', 'name="password"')}
      <div class="auth-rem"><label><input type="checkbox" id="authRem"${this._remember() ? ' checked' : ''}> Запомнить меня на этом устройстве</label>
        ${UiKit.tip(`<p>С галочкой вход действует ${days} дн. — пароль не нужно вводить каждый день.</p><p>На чужом или общем компьютере снимите её: вход закроется, когда закроете браузер (и не позже чем через ${hours} ч).</p>`)}</div>
      <p class="auth-err" id="authErr" role="alert" aria-live="assertive" hidden></p>
      <button class="btn primary auth-go" type="submit">Войти</button>
      <div class="auth-foot"><button type="button" class="auth-lnk" id="authForgot" aria-expanded="false" aria-controls="authHelp">Забыли пароль?</button>
        <button type="button" class="auth-lnk" id="authAdm">Вход администратора</button></div>
      <div class="auth-help" id="authHelp" hidden>${help}<p>Пароль не восстанавливается автоматически: новый задаёт администратор программы в «Настройках» («Люди и доступ → Менеджеры»). Обратитесь к нему — после смены пароля войдите с новым.</p></div></form></div>`;
  }

  static async _send() {
    const login = $('#authLogin').value.trim();
    const password = $('#authPw').value;
    if (!login) throw new Error('Введите логин');
    if (!password) throw new Error('Введите пароль');
    const remember = $('#authRem').checked;
    await LoginForm.post('/api/auth/login', { login, password, remember });
    try {
      localStorage.setItem('kp.userLogin', remember ? login : '');
      localStorage.setItem('kp.userRemember', remember ? '1' : '0');
    } catch {
      // без хранилища — логин не запоминается
    }
    location.reload();
  }

  /** Вошёл с временным паролем от администратора: сначала свой пароль (сервер до смены ничего другого не выполняет). */
  static change() {
    const state = Auth.state;
    if (state.changing) return;
    state.changing = state.shown = true;
    $('#authWrap')?.remove();
    const user = state.user || {};
    const min = state.pwMin || Auth.PW_MIN;
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="auth-wrap" id="authWrap"><form class="auth-card" id="authNew" autocomplete="on" novalidate>
      <div class="auth-brand">${this.BRAND}<div class="auth-app">Задайте свой пароль</div></div>
      <p class="muted auth-note">${user.name ? `<b>${esc(user.name)}</b>, в` : 'В'}ы вошли с временным паролем от администратора. Придумайте свой — не короче ${min} символов; его будете знать только вы.</p>
      <input type="text" name="username" autocomplete="username" value="${esc(user.login || '')}" hidden>
      ${LoginForm.password('authNew1', 'Новый пароль', 'new-password', `name="new-password" minlength="${min}"`)}
      ${LoginForm.password('authNew2', 'Новый пароль ещё раз', 'new-password')}
      <p class="auth-err" id="authErr" role="alert" aria-live="assertive" hidden></p>
      <button class="btn primary auth-go" type="submit">Сохранить и продолжить</button>
      <div class="auth-foot"><span class="muted auth-small">После сохранения временный пароль не подойдёт</span><button type="button" class="auth-lnk" id="authOut">Выйти</button></div></form></div>`,
    );
    const form = $('#authNew');
    LoginForm.bind(
      form,
      async () => {
        const [value, again] = LoginForm.newPw(form, 'authNew1', 'authNew2');
        await LoginForm.post('/api/auth/password', { new: value, new2: again });
        location.reload();
      },
      $('#authErr'),
      'Сохраняю…',
    );
    $('#authOut').onclick = () => AuthMenu.leave();
    setTimeout(() => $('#authNew1')?.focus(), this.FOCUS_DELAY);
  }

  static _last() {
    try {
      return localStorage.getItem('kp.userLogin') || '';
    } catch {
      return '';
    }
  }

  static _remember() {
    try {
      return localStorage.getItem('kp.userRemember') !== '0';
    } catch {
      return true;
    }
  }

  // «Вход администратора»: «Настройки» поверх экрана входа; закрыли — вошёл администратор: программа открывается
  static _admin() {
    SettingsWindow.open();
    const dialog = $('#setdlg');
    if (!dialog) return;
    dialog.addEventListener(
      'close',
      () => {
        if (AdminSession.on) location.reload();
        else $('#authLogin')?.focus();
      },
      { once: true },
    );
  }
}

/** «⋯»: «Вы вошли как …», «Сменить пароль», «Выйти на всех устройствах», «Выйти» (на телефоне — в меню «☰»). */
export class AuthMenu {
  /**
   * Менеджер вошёл по паролю.
   * @returns {boolean}
   */
  static signedIn() {
    return !!(Auth.state.enabled && Auth.state.user);
  }

  /** Пункты в меню «⋯». */
  static mount() {
    if (!this.signedIn()) return;
    const menu = document.querySelector('.topmenu .menu-l');
    if (!menu || $('#btnLogout')) return;
    menu.insertAdjacentHTML(
      'afterbegin',
      `<div class="auth-me"><small class="muted">Вы вошли как</small><b>${esc(Auth.state.user.name)}</b></div>
      <button type="button" id="btnPw">Сменить пароль</button><button type="button" id="btnLogoutAll">Выйти на всех устройствах</button>
      <button type="button" id="btnLogout">Выйти из учётной записи</button><hr>`,
    );
    const closing = action => () => {
      menu.closest('details')?.removeAttribute('open');
      action();
    };
    $('#btnPw').onclick = closing(() => this.password());
    $('#btnLogoutAll').onclick = closing(() => this.logoutAll());
    $('#btnLogout').onclick = closing(() => this.logout());
  }

  /**
   * Пункты меню телефона.
   * @param {Function} item (ключ, значок, название, пояснение) — как в меню телефона
   * @returns {string}
   */
  static mobileItems(item) {
    if (!this.signedIn()) return '';
    return (
      item('authPw', '⚿', 'Сменить пароль', esc(Auth.state.user.name)) +
      item('authOut', '⎋', 'Выйти', 'Здесь или на всех устройствах')
    );
  }

  /**
   * Пункт меню телефона нажат.
   * @param {string} key
   */
  static mobile(key) {
    if (key === 'authPw') this.password();
    else if (key === 'authOut') this.logout();
  }

  /** Выйти здесь — или сразу на всех устройствах. */
  static async logout() {
    const answer = await Modal.ask(`<h3>Выйти из программы?</h3><p>Черновик КП останется в этом браузере.</p>
      <div class="row auth-row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn" type="button" data-v="all">Выйти на всех устройствах</button><button class="btn primary" type="button" data-v="here">Выйти</button></div>`);
    if (answer === 'all') this._all();
    else if (answer === 'here') this.leave();
  }

  /** Выйти на этом устройстве. */
  static async leave() {
    try {
      await Api.request('/api/auth/logout', { method: 'POST' });
    } catch {
      // всё равно на экран входа
    }
    location.reload();
  }

  /** Выйти на всех устройствах (с вопросом). */
  static async logoutAll() {
    const answer =
      await Modal.ask(`<h3>Выйти на всех устройствах?</h3><p>Вход закроется везде, где вы входили: на этом и других компьютерах и телефонах. Дальше — снова логин и пароль. Пригодится, если входили на чужом компьютере или потеряли телефон.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="button" data-v="1">Выйти везде</button></div>`);
    if (answer) this._all();
  }

  static async _all() {
    try {
      await Api.request('/api/auth/logout-all', { method: 'POST' });
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    location.reload();
  }

  /** «Сменить пароль»: текущий + новый дважды; другие входы закрываются, этот остаётся. */
  static password() {
    const user = Auth.state.user;
    const min = Auth.state.pwMin || Auth.PW_MIN;
    const modal = new Modal(
      `<form class="auth-pwf" novalidate><div class="dlg-h"><h3>Сменить пароль<small>${esc(user.name)}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <input type="text" name="username" autocomplete="username" value="${esc(user.login || '')}" hidden>
      ${LoginForm.password('pwOld', 'Текущий пароль', 'current-password')}
      ${LoginForm.password('pwNew1', `Новый пароль — не короче ${min} символов`, 'new-password', `minlength="${min}"`)}
      ${LoginForm.password('pwNew2', 'Новый пароль ещё раз', 'new-password')}
      <p class="muted auth-note">На других компьютерах и телефонах вход закроется — там войдите с новым паролем. Здесь вы останетесь в программе.</p>
      <p class="auth-err" id="pwErr" role="alert" aria-live="assertive" hidden></p>
      <div class="row"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Сменить пароль</button></div></form>`,
      'auth-pwd',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    const form = modal.$('form');
    LoginForm.bind(form, () => this._change(modal, form), modal.$('#pwErr'), 'Сохраняю…');
    setTimeout(() => modal.$('#pwOld')?.focus(), AuthScreen.FOCUS_DELAY);
  }

  static async _change(modal, form) {
    const old = form.querySelector('#pwOld').value;
    if (!old) throw new Error('Введите текущий пароль');
    const [value, again] = LoginForm.newPw(form, 'pwNew1', 'pwNew2');
    const answer = await LoginForm.post('/api/auth/password', { old, new: value, new2: again });
    modal.close();
    Toast.show(`Пароль изменён${answer.closed ? ' — на других устройствах вход закрыт' : ''}`);
  }
}
