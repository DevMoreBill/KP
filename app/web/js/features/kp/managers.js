import { Auth } from './auth.js';
import { MyPrefs } from './my-prefs.js';
import { Steps } from '../../ui/steps.js';
import { $, Uid, esc } from '../../core/util.js';
import { FormView } from '../../ui/form-view.js';
import { Str } from '../../core/str.js';
import { KpState, S } from '../../core/state.js';
import { AdminSession, Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { Toast } from '../../core/toast.js';

/**
 * Менеджеры: справочник в базе программы (общий для отдела), выбор менеджера в разделе «Менеджер». Выбранный менеджер
 * запоминается на этом устройстве; правки контактов выбранного менеджера сохраняются в базу сами.
 */
export class Managers {
  // менеджеры из справочника
  static list = [];
  static KEYS = ['name', 'position', 'phone', 'ext', 'mobile', 'email', 'site', 'address', 'hours', 'folder'];
  static DUP = { name: 'фамилия и имя', email: 'e-mail', mobile: 'мобильный телефон', ext: 'добавочный номер' };
  static MOBILE_DIGITS = 10;
  static FOCUS_DELAY = 30;
  static LOUD = { say: text => Toast.show(text), ask: text => confirm(text) };
  static QUIET = { say: () => {}, ask: () => false };

  /**
   * Контакты менеджера строками.
   * @param {object} manager
   * @returns {object}
   */
  static fields(manager) {
    return Object.fromEntries(this.KEYS.map(key => [key, manager && manager[key] != null ? String(manager[key]) : '']));
  }

  static _remember(id) {
    try {
      if (id) localStorage.setItem('kp.managerId', id);
      else localStorage.removeItem('kp.managerId');
    } catch {
      // без хранилища — не запоминается
    }
  }

  /**
   * Кто работает на этом устройстве: менеджер, которого человек сам выбрал или добавил в разделе «Менеджер» (открытие
   * чужого КП его не меняет). По нему — автор новых КП и доступ к «Экономике сделки».
   * @returns {string}
   */
  static meId() {
    if (Auth.state.enabled && Auth.state.user) return Auth.state.user.id;
    try {
      return localStorage.getItem('kp.me') || localStorage.getItem('kp.managerId') || '';
    } catch {
      return '';
    }
  }

  /**
   * Запомнить «кто я».
   * @param {string} id
   */
  static setMe(id) {
    const was = this.meId();
    try {
      if (id) localStorage.setItem('kp.me', id);
    } catch {
      // без хранилища — не запоминается
    }
    if (!id || id === was) return;
    FEAT.refresh();
    MyPrefs.load();
  }

  /**
   * ФИО «кто я».
   * @returns {string}
   */
  static meName() {
    const manager = Managers.list.find(row => row.id === this.meId());
    return manager ? manager.name : '';
  }

  /** Справочник менеджеров и менеджер текущего КП. */
  static async load() {
    try {
      Managers.list = await Api.request('/api/managers');
    } catch {
      Managers.list = [];
      return;
    }
    // переход с прежних версий: контакты, которые помнил этот браузер, становятся записью справочника
    if (!Managers.list.length && this._typed()) {
      await this.saveQuiet();
      return;
    }
    const manager = this._current();
    if (manager) this.use(manager);
    MgrLock.apply();
    try {
      if (!localStorage.getItem('kp.me') && manager && !S.kpId) this.setMe(manager.id);
    } catch {
      // без хранилища — не запоминается
    }
  }

  static _typed() {
    return String(S.manager?.name || '').trim() !== '';
  }

  static _current() {
    const typed = this._typed();
    const byId = S.managerId ? Managers.list.find(row => row.id === S.managerId) : null;
    const byName =
      !byId && !S.managerId && typed
        ? Managers.list.find(row => Str.norm(row.name) === Str.norm(S.manager.name))
        : null;
    return byId || byName || (typed ? null : this._device()) || this._ownNewKp();
  }

  // нет запомненных контактов — «кто я» на этом компьютере
  static _device() {
    let id = '';
    try {
      id = localStorage.getItem('kp.managerId') || '';
    } catch {
      // без хранилища — не запоминается
    }
    return (
      Managers.list.find(row => row.id === id) ||
      Managers.list.find(row => row.id === this.meId()) ||
      (Managers.list.length === 1 ? Managers.list[0] : null)
    );
  }

  // вошёл по паролю — менеджер нового КП он сам
  static _ownNewKp() {
    if (!Auth.state.enabled || !Auth.state.user || S.kpId) return null;
    return Managers.list.find(row => row.id === Auth.state.user.id) || null;
  }

  /**
   * Менеджер КП — из справочника (контакты подставляются, запоминается на устройстве).
   * @param {object} manager
   */
  static use(manager) {
    S.managerId = manager.id;
    S.manager = { ...S.manager, ...this.fields(manager) };
    this._remember(manager.id);
  }

  /**
   * Выбрать менеджера из справочника.
   * @param {string} id
   */
  static select(id) {
    if (MgrLock.locked()) return;
    const manager = Managers.list.find(row => row.id === id);
    if (!manager) return;
    this.use(manager);
    this.setMe(manager.id);
    FormView.render();
    KpState.persist();
    Toast.show(`Менеджер: ${manager.name}`);
  }

  /** Новый менеджер — пустые контакты. */
  static startNew() {
    if (MgrLock.locked()) return;
    S.managerId = '';
    S.manager = { ...KpState.defManager(), name: '', position: '', ext: '', mobile: '', email: '', folder: '' };
    this._remember('');
    FormView.render();
    KpState.persist();
    setTimeout(() => $('[data-p="manager.name"]')?.focus(), this.FOCUS_DELAY);
  }

  static _keys(manager) {
    const words = String(manager.name || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');
    const mobile = String(manager.mobile || '')
      .replace(/\D/g, '')
      .slice(-this.MOBILE_DIGITS);
    return {
      name: words.length >= 2 ? words.slice(0, 2).join(' ') : '',
      email: String(manager.email || '')
        .trim()
        .toLowerCase(),
      mobile: mobile.length === this.MOBILE_DIGITS ? mobile : '',
      ext: String(manager.ext || '').replace(/\D/g, ''),
    };
  }

  // дубль: другой менеджер с теми же фамилией и именем, e-mail, мобильным (последние 10 цифр) или добавочным
  static _dup(id, manager) {
    const mine = this._keys(manager);
    for (const other of Managers.list) {
      if (other.id === id) continue;
      const theirs = this._keys(other);
      const field = Object.keys(this.DUP).find(key => mine[key] && mine[key] === theirs[key]);
      if (field) return { manager: other, what: this.DUP[field] };
    }
    return null;
  }

  /**
   * Сохранить контакты менеджера КП в справочник (с сообщениями).
   * @returns {Promise<boolean>}
   */
  static save() {
    return this._save(this.LOUD);
  }

  /**
   * То же без сообщений (автосохранение и перенос из браузера).
   * @returns {Promise<boolean>}
   */
  static saveQuiet() {
    return this._save(this.QUIET);
  }

  static async _save(notify) {
    if (!String(S.manager.name || '').trim()) {
      notify.say('Укажите ФИО менеджера');
      return false;
    }
    const id = S.managerId || Uid.next() + Uid.next();
    const dup = this._dup(S.managerId, S.manager);
    const status = $('#mgrStat');
    if (dup) {
      this._dupSay(dup, status, notify);
      return false;
    }
    if (status) status.classList.remove('warn-t');
    try {
      await this._store(id, notify);
      return true;
    } catch (error) {
      notify.say(`Не удалось сохранить менеджера: ${error.message || error}`);
      return false;
    }
  }

  static _dupSay(dup, status, notify) {
    const msg = `Такой менеджер уже есть в справочнике: ${dup.manager.name} (совпадает ${dup.what}).`;
    if (status) {
      status.textContent = `${msg}${S.managerId ? ' Изменения не сохранены — исправьте или выберите его в списке.' : ''}`;
      status.classList.add('warn-t');
    }
    if (!S.managerId && notify.ask(`${msg}\n\nВыбрать его вместо создания нового?`)) this.select(dup.manager.id);
    else notify.say(msg);
  }

  static async _store(id, notify) {
    const opened = S;
    const doc = await Api.request(`/api/managers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(this.fields(S.manager)),
    });
    const index = Managers.list.findIndex(row => row.id === id);
    if (index >= 0) Managers.list[index] = doc;
    else Managers.list.push(doc);
    Managers.list.sort((left, right) => String(left.name).localeCompare(String(right.name), 'ru'));
    const wasNew = !opened.managerId;
    opened.managerId = id;
    this._remember(id);
    if (wasNew) {
      this.setMe(id);
      KpState.persist();
      if (Steps.current === 'mgr') FormView.render();
    }
    const status = $('#mgrStat');
    if (status) status.textContent = 'Сохранено в справочнике менеджеров';
    notify.say(wasNew ? 'Менеджер добавлен в справочник' : 'Сохранено');
  }
}

/**
 * Вход по паролю: менеджер в КП — только тот, кто вошёл (другого не выбрать и не завести); свои контакты он правит.
 * Администратор и вход без пароля — выбор из справочника. То же проверяет сервер.
 */
export class MgrLock {
  /**
   * Менеджер закреплён входом.
   * @returns {boolean}
   */
  static locked() {
    const state = Auth.state;
    return !!(state.enabled && state.user && !state.admin && !AdminSession.on);
  }

  /** КП открыто, создано, взято из черновика или заготовки — менеджером в нём становится вошедший. */
  static apply() {
    if (!this.locked() || S.managerId === Auth.state.user.id) return;
    const manager = Managers.list.find(row => row.id === Auth.state.user.id);
    if (manager) Managers.use(manager);
  }

  /**
   * Строка «Менеджер в КП — …» вместо выбора.
   * @returns {string}
   */
  static html() {
    const manager = Managers.list.find(row => row.id === Auth.state.user.id);
    return `<p id="mgrStat" style="grid-column:1/-1;margin:0">Менеджер в КП — <b>${esc(manager ? manager.name : Auth.state.user.name || '')}</b> (вы вошли по паролю).
      <span class="muted">Правки полей ниже сохраняются в вашей карточке сами.</span></p>`;
  }
}
