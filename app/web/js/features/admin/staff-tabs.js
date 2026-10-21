import { AdminApi, AdminDialog, AdminState } from './admin-core.js';
import { CopyText } from '../../core/files.js';
import { Modal } from '../../core/modal.js';
import { Powers } from '../kp/auth.js';
import { UiKit } from '../../ui/ui-kit.js';
import { Fmt } from '../../core/str.js';
import { DefRegistry } from '../../core/defaults.js';
import { Toast } from '../../core/toast.js';
import { $, esc } from '../../core/util.js';

/** «Мой пароль»: смена своего пароля и правила доступа. */
export class SecurityTab {
  static IDLE_MIN = 15;

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static render(main) {
    const status = AdminState.status || {};
    main.innerHTML = `<div class="st-card"><form id="pwF" autocomplete="off"><p class="sub">Сменить свой пароль${status.login ? ` (${esc(status.login)})` : ''}</p>
      <div class="grid g2"><label class="f"><span>Текущий пароль</span><input type="password" id="pwO" autocomplete="current-password" required></label>
      <label class="f"><span>Новый пароль</span><input type="password" id="pwN" autocomplete="new-password" required></label></div>
      <p class="msg err" id="pwE" style="text-align:left"></p><button class="btn primary" type="submit">Сменить пароль</button></form></div>
    <div class="st-card"><p class="sub">Доступ</p><p class="muted">Вход закрывается через ${status.idleMinutes || this.IDLE_MIN} минут бездействия. Пять неверных паролей за 10 минут — пауза 10 минут.
      Пароль другого администратора меняется во вкладке «Администраторы». Забыли пароль все администраторы: на компьютере, где работает программа, создайте файл <b>data\\admin-reset.txt</b> и перезапустите программу — учётные записи администраторов удалятся, создайте новую здесь.</p></div>
`;
    $('#pwF').onsubmit = async event => {
      event.preventDefault();
      try {
        await AdminApi.post('password', { old: $('#pwO').value, new: $('#pwN').value });
        Toast.show('Пароль изменён');
        this.render(main);
      } catch (error) {
        $('#pwE').textContent = error.message;
      }
    };
  }
}

/** Администраторы: логин, имя, пароль. */
export class AdminsTab {
  static PW_MIN = 8;
  static ACTIONS = { delete: '_delete', edit: '_edit', password: '_password' };

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    const reply = await AdminApi.get('users');
    main.innerHTML = `<div class="st-card"><p class="sub">Учётные записи · ${reply.items.length}</p>
    ${reply.items.map(user => this._row(user, reply)).join('')}</div>
    <div class="st-card"><form id="uAdd" autocomplete="off"><p class="sub">Добавить администратора</p>
      <div class="grid g3"><label class="f"><span>Логин</span><input type="text" id="uL" required placeholder="ivanov" autocomplete="off"></label>
      <label class="f"><span>Имя</span><input type="text" id="uN" placeholder="Иванов И. И."></label>
      <label class="f"><span>Пароль</span><input type="password" id="uP" required autocomplete="new-password" placeholder="не короче ${this._min()}, буквы и цифры"></label></div>
      <p class="msg err" id="uE" style="text-align:left"></p><button class="btn primary" type="submit">Добавить</button></form>
      <p class="muted">Каждый администратор входит под своим логином; в журнале действий видно, кто что изменил.</p></div>`;
    $('#uAdd').onsubmit = event => this._add(main, event);
    main.onclick = event => this._click(main, event, reply);
  }

  static _min() {
    return DefRegistry.num('srv.adminPwMin', this.PW_MIN);
  }

  static _row(user, reply) {
    const info = `логин <b>${esc(user.login)}</b>${user.login === reply.me ? ' · это вы' : ''} · создан ${esc(Fmt.dateTime(user.created))}${user.by ? ` (${esc(user.by)})` : ''}${user.lastLogin ? ` · последний вход ${esc(Fmt.dateTime(user.lastLogin))}` : ''}`;
    const remove =
      reply.items.length > 1 && user.login !== reply.me
        ? '<button class="btn danger" type="button" data-uact="delete">Удалить</button>'
        : '';
    return `<div class="st-row" data-ulogin="${esc(user.login)}"><div><b>${esc(user.name || user.login)}</b><span class="muted">${info}</span></div>
      <div class="acts"><button class="btn" type="button" data-uact="edit">Изменить</button><button class="btn" type="button" data-uact="password">Пароль</button>${remove}</div></div>`;
  }

  static async _add(main, event) {
    event.preventDefault();
    try {
      await AdminApi.post('users', {
        action: 'add',
        login: $('#uL').value.trim(),
        name: $('#uN').value.trim(),
        password: $('#uP').value,
      });
      Toast.show('Администратор добавлен');
      this.render(main);
    } catch (error) {
      $('#uE').textContent = error.message;
    }
  }

  static async _click(main, event, reply) {
    const button = event.target.closest('[data-uact]');
    if (!button) return;
    const login = button.closest('[data-ulogin]').dataset.ulogin;
    const user = reply.items.find(row => row.login === login);
    try {
      if (!(await this[this.ACTIONS[button.dataset.uact]](login, user, reply))) return;
      this.render(main);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _delete(login) {
    if (
      !(await AdminDialog.confirm(
        `Удалить администратора ${login}?`,
        'Он больше не сможет войти в «Настройки». Записи журнала действий сохранятся.',
        'Удалить',
      ))
    )
      return false;
    await AdminApi.post('users', { action: 'delete', login });
    Toast.show('Удалён');
    return true;
  }

  static async _edit(login, user, reply) {
    const values = await AdminDialog.form(`Изменить: ${login}`, [
      ['newLogin', 'Логин', user.login],
      ['name', 'Имя', user.name || ''],
    ]);
    if (!values) return false;
    await AdminApi.post('users', { action: 'edit', login, newLogin: values.newLogin, name: values.name });
    Toast.show('Сохранено');
    if (login === reply.me)
      AdminState.status = { ...AdminState.status, login: values.newLogin, name: values.name || values.newLogin };
    return true;
  }

  static async _password(login) {
    const values = await AdminDialog.form(`Новый пароль: ${login}`, [
      ['password', `Новый пароль (не короче ${this._min()}, буквы и цифры)`, '', 'password'],
    ]);
    if (!values) return false;
    await AdminApi.post('users', { action: 'password', login, password: values.password });
    Toast.show('Пароль изменён');
    return true;
  }
}

/** Вход менеджеров в конструктор по паролю и права; сброс пароля (временный), «выйти на всех устройствах». */
export class AccessPanel {
  static PW_MIN = 4;
  // короткие подписи столбцов прав (полная — в подсказке)
  static SHORT = {
    catAdd: 'Добавлять',
    catEdit: 'Править',
    kpOthers: 'Чужие КП',
    dealView: 'Экономика',
    catDelete: 'Удалять',
    catSelfMod: 'Без модерации',
    export: 'Выгрузка',
  };
  static HELP =
    '<p><b>Сбросить пароль</b> — менеджер забыл пароль: программа выдаст временный пароль (покажет один раз — передайте менеджеру). Прежний пароль перестаёт действовать, открытые входы менеджера закрываются. Войдя с временным паролем, менеджер сразу задаёт свой; срок временного пароля — «Значения программы» → «Временный пароль… действует».</p>' +
    '<p><b>Выйти везде</b> — закрыть все входы менеджера (например, потерял телефон); пароль не меняется. Менеджер может сделать это и сам: «⋯ → Выйти на всех устройствах», а пароль сменить — «⋯ → Сменить пароль».</p>';
  static ACTIONS = { login: '_login', block: '_block', reset: '_reset', out: '_out' };

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async open(main) {
    const reply = await AdminApi.get('access');
    main.innerHTML = `${this._switch(reply)}
      <div class="st-card"><div class="row"><div class="sub" style="margin:0">Менеджеры и права · ${reply.managers.length} ${UiKit.tip(this.HELP)}</div></div>
      ${reply.managers.length ? this._table(reply) : '<p class="muted">Менеджеров ещё нет — их добавляют в шаге «Менеджер» конструктора или ниже, в «Контактах».</p>'}
      <p class="muted">Права действуют, когда вход по паролю включён. «Чужие КП» — видеть их в журнале, открывать и сохранять; без него менеджер видит только свои КП. «Экономика» — своих КП (чужих — вместе с правом на чужие КП).
        <b>Особые права</b> (выделены, по умолчанию выключены): «Удалять» — товары в корзину (восстанавливает и чистит корзину администратор); «Без модерации» — свои правки товаров сразу в каталог, принимать и отклонять правки других, править справочник поставщиков; «Выгрузка» — каталог и клиентов в файл (без закупки).</p></div>`;
    this._bind(main, reply);
  }

  static _switch(reply) {
    const text = reply.enabled
      ? 'Без входа программа не открывается. Кто работает, программа знает по входу; права ниже проверяются на сервере.'
      : 'Сейчас менеджер выбирается на устройстве, пароль не нужен, права не проверяются. Чтобы включить вход, задайте логин и пароль хотя бы одному менеджеру.';
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Вход в конструктор по логину и паролю</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="acOn"${reply.enabled ? ' checked' : ''}><span>${reply.enabled ? 'включён' : 'выключен'}</span></label></div>
      <p class="muted">${text}
        Администратор входит в «Настройки» своим паролем и может всё.</p>
      <div class="ac-help"><label class="f"><span>«Забыли пароль?» на экране входа — к кому обращаться ${UiKit.tip('Менеджер видит этот текст до входа, под ссылкой «Забыли пароль?». Укажите, кто сбрасывает пароль и как с ним связаться. Пусто — только общая подсказка «обратитесь к администратору».')}</span>
        <input type="text" id="acHelp" maxlength="200" value="${esc(reply.help || '')}" placeholder="Например: пароль сбросит Иванов Иван, доб. 123"></label><button class="btn" type="button" id="acHelpSave">Сохранить</button></div></div>`;
  }

  static _special(key) {
    return Powers.STRICT.includes(key) ? ' ac-sp' : '';
  }

  static _table(reply) {
    const perms = reply.perms;
    const heads = perms
      .map(
        perm =>
          `<th class="c${this._special(perm.key)}" title="${esc(perm.label)}">${esc(this.SHORT[perm.key] || perm.label)}</th>`,
      )
      .join('');
    return `<div class="ac-tw"><table class="pv-t ac-t"><thead><tr><th>Менеджер</th><th>Логин</th>${heads}<th></th></tr></thead><tbody>${reply.managers.map(row => this._row(row, perms)).join('')}</tbody></table></div>`;
  }

  static _row(manager, perms) {
    const checks = perms
      .map(
        perm =>
          `<td class="c${this._special(perm.key)}"><label class="ac-ck" title="${esc(perm.label)}"><input type="checkbox" data-perm="${perm.key}"${manager.perms[perm.key] ? ' checked' : ''} aria-label="${esc(perm.label)}"></label></td>`,
      )
      .join('');
    const position = manager.position || '';
    const last = manager.lastLogin ? `${position ? ' · ' : ''}вход ${esc(Fmt.dateTime(manager.lastLogin))}` : '';
    return `<tr data-mid="${esc(manager.id)}"${manager.blocked ? ' class="off"' : ''}><td><b>${esc(manager.name || 'Без имени')}</b><small class="muted">${esc(position)}${last}</small></td>
      <td>${manager.login ? `<b>${esc(manager.login)}</b>${this._state(manager)}` : '<span class="muted">не задан</span>'}</td>
      ${checks}
      <td class="acts"><div class="ac-acts">${this._buttons(manager)}</div></td></tr>`;
  }

  static _buttons(manager) {
    const login = `<button class="btn sm" type="button" data-ac="login">${manager.login ? 'Логин и пароль' : 'Задать вход'}</button>`;
    const more = manager.login
      ? `<button class="btn sm" type="button" data-ac="reset">Сбросить пароль</button>
        <button class="btn sm ghost" type="button" data-ac="block">${manager.blocked ? 'Разрешить вход' : 'Запретить вход'}</button>`
      : '';
    const out = manager.sessions
      ? `<button class="btn sm ghost" type="button" data-ac="out" title="Закрыть все входы менеджера: компьютеры и телефоны">Выйти везде (${manager.sessions})</button>`
      : '';
    return login + more + out;
  }

  static _post(id, body) {
    return AdminApi.post(`access/${encodeURIComponent(id)}`, body);
  }

  static _bind(main, reply) {
    $('#acHelpSave').onclick = async () => {
      try {
        const saved = await AdminApi.post('access', { help: $('#acHelp').value });
        $('#acHelp').value = saved.help || '';
        Toast.show('Подсказка сохранена');
      } catch (error) {
        Toast.show(error.message || String(error));
      }
    };
    $('#acOn').onchange = async event => {
      try {
        await AdminApi.post('access', { enabled: event.target.checked });
        Toast.show(event.target.checked ? 'Вход по паролю включён' : 'Вход по паролю выключен');
      } catch (error) {
        Toast.show(error.message || String(error));
      }
      this.open(main);
    };
    main.onchange = event => this._perms(main, event);
    main.onclick = event => this._click(main, event, reply);
  }

  static async _perms(main, event) {
    const box = event.target.closest('[data-perm]');
    if (!box) return;
    const id = box.closest('[data-mid]').dataset.mid;
    const perms = {};
    box
      .closest('tr')
      .querySelectorAll('[data-perm]')
      .forEach(input => {
        perms[input.dataset.perm] = input.checked;
      });
    try {
      await this._post(id, { perms });
      Toast.show('Права сохранены');
    } catch (error) {
      Toast.show(error.message || String(error));
      this.open(main);
    }
  }

  static async _click(main, event, reply) {
    const button = event.target.closest('[data-ac]');
    if (!button) return;
    const id = button.closest('[data-mid]').dataset.mid;
    const manager = reply.managers.find(row => row.id === id);
    try {
      if ((await this[this.ACTIONS[button.dataset.ac]](manager)) === false) return;
      this.open(main);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _login(manager) {
    const min = DefRegistry.num('srv.userPwMin', this.PW_MIN);
    const label = manager.hasPassword
      ? `Новый пароль (пусто — не менять), не короче ${min} символов`
      : `Пароль, не короче ${min} символов`;
    const values = await AdminDialog.form(`Вход: ${manager.name}`, [
      ['login', 'Логин (латиница или кириллица, без пробелов)', manager.login || ''],
      ['password', label, '', 'password'],
    ]);
    if (!values) return false;
    if (!manager.hasPassword && !values.password) {
      Toast.show('Задайте пароль');
      return false;
    }
    await this._post(manager.id, { login: values.login, ...(values.password ? { password: values.password } : {}) });
    Toast.show('Сохранено');
    return true;
  }

  static async _block(manager) {
    await this._post(manager.id, { blocked: !manager.blocked });
    Toast.show(manager.blocked ? 'Вход разрешён' : 'Вход запрещён, сессии закрыты');
    return true;
  }

  static _reset(manager) {
    return this.reset(manager);
  }

  static async _out(manager) {
    const text = `${manager.name || manager.login}: закроются все входы (${manager.sessions}) — на компьютерах и телефонах. Пароль не меняется: менеджер войдёт снова своим.`;
    if (!(await AdminDialog.confirm('Выйти на всех устройствах?', text, 'Закрыть входы'))) return false;
    const reply = await AdminApi.post(`access/${encodeURIComponent(manager.id)}/logout`);
    Toast.show(reply.closed ? `Входы закрыты: ${reply.closed}` : 'Открытых входов не было');
    return true;
  }

  // отметки у логина: нет пароля, вход запрещён, временный пароль (до какого времени), открытые входы
  static _state(manager) {
    const temp = manager.temp;
    const out = [];
    if (!manager.hasPassword) out.push('<small class="bad-t">нет пароля</small>');
    if (manager.blocked) out.push('<small class="bad-t">вход запрещён</small>');
    if (temp) {
      out.push(
        temp.expired
          ? '<small class="bad-t">временный пароль истёк</small>'
          : `<small class="warn-t">временный пароль до ${esc(Fmt.dateTime(temp.until))}</small>`,
      );
    }
    if (manager.sessions) out.push(`<small class="muted">входов открыто: ${manager.sessions}</small>`);
    return out.join('');
  }

  /**
   * «Сбросить пароль»: подтверждение → временный пароль на экран один раз (с «Копировать»).
   * @param {object} manager
   * @returns {Promise<boolean>} false — отменено
   */
  static async reset(manager) {
    const text = `${manager.name || manager.login} получит временный пароль. Прежний пароль перестанет действовать, открытые входы менеджера закроются.`;
    if (!(await AdminDialog.confirm('Сбросить пароль?', text, 'Сбросить пароль'))) return false;
    const reply = await AdminApi.post(`access/${encodeURIComponent(manager.id)}/reset`);
    await new Promise(resolve => this._showTemp(manager, reply, resolve));
    return true;
  }

  static _showTemp(manager, reply, resolve) {
    const modal = new Modal(
      `<h3>Временный пароль</h3><p>Передайте менеджеру <b>${esc(manager.name || '')}</b> — пароль показывается только сейчас.</p>
        <div class="ac-tmp"><span class="ac-tmp-l">Логин <b>${esc(manager.login)}</b></span><code id="acTmp">${esc(reply.password)}</code><button class="btn" type="button" id="acCopy">Копировать</button></div>
        <p class="muted">Действует до ${esc(Fmt.dateTime(reply.until))} (${reply.hours} ч). При входе менеджер сразу задаст свой пароль.</p>
        <div class="row"><button class="btn primary" type="button" data-x>Готово</button></div>`,
      'ac-tmp-dlg',
    );
    modal.$('#acCopy').onclick = async () => {
      const ok = await CopyText.copy(reply.password);
      Toast.show(ok ? 'Пароль скопирован' : 'Не скопировалось — выделите пароль и скопируйте вручную');
      if (ok) return;
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(modal.$('#acTmp'));
      selection.removeAllRanges();
      selection.addRange(range);
    };
    modal.$('[data-x]').onclick = () => modal.close();
    modal.d.addEventListener('close', () => resolve());
  }
}
