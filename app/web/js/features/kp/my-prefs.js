import { Managers } from './managers.js';
import { MyDay } from './my-day.js';
import { DEF_BY, DEF_SCHEMA, DefRegistry } from '../../core/defaults.js';
import { esc } from '../../core/util.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { Theme } from '../../core/theme.js';
import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { DocLink } from '../../core/doc-link.js';

/**
 * «Мои настройки» — личные настройки менеджера (сервер: app/user_prefs.py), действуют на любом компьютере: тема,
 * предпросмотр рядом, шаблон КП, свои значения для новых КП (поверх умолчаний отдела), подпись и копия себе в письмах.
 * Открываются вкладкой кабинета (CabPrefs), без кабинета — окном.
 */
export class MyPrefs {
  static prefs = {};
  static uid = '';
  static THEME = [
    ['auto', 'Как в системе'],
    ['light', 'Светлая'],
    ['dark', 'Тёмная'],
    ['time', 'По времени суток (тёмная с 19:00 до 7:00)'],
  ];
  static CURRENCIES = [
    ['RUB', 'Рубли'],
    ['USD', 'Доллары США'],
    ['EUR', 'Евро'],
    ['CNY', 'Юани'],
  ];
  /** Тему переключили из меню (kp:theme) — запомнить. */
  static listen() {
    document.addEventListener('kp:theme', event => this.remember({ theme: event.detail.theme }));
  }

  /**
   * Загрузить свои настройки.
   * @returns {Promise<object>}
   */
  static async load() {
    try {
      const answer = await Api.request('/api/me/prefs');
      this.uid = answer.id || '';
      this.prefs = answer.prefs || {};
    } catch {
      this.prefs = {};
    }
    this.apply();
    return this.prefs;
  }

  /**
   * Своё значение для новых КП (поверх умолчаний отдела).
   * @param {string} key
   * @returns {string|null}
   */
  static def(key) {
    const value = (this.prefs.defaults || {})[key];
    return value != null && String(value).trim() !== '' ? String(value) : null;
  }

  /**
   * Своё число строк списка (пусто — как у отдела).
   * @param {string} key rem | drafts | todo
   * @param {number} fallback
   * @returns {number}
   */
  static limit(key, fallback) {
    const own = (this.prefs.limits || {})[key];
    return own > 0 ? own : fallback;
  }

  /** Тема, предпросмотр рядом и шаблон — в этот браузер. */
  static apply() {
    if (Theme.NAMES.includes(this.prefs.theme)) Theme.set(this.prefs.theme);
    if (typeof this.prefs.livePreview === 'boolean') DocLink.wantPreview(this.prefs.livePreview);
    if (!this.prefs.template) return;
    try {
      localStorage.setItem('kp.template', this.prefs.template);
    } catch {
      // без хранилища — шаблон как в программе
    }
  }

  /**
   * Письмо клиенту: подпись в конце текста, копия себе — по настройке.
   * @param {object} form ответ /mailform
   * @returns {object}
   */
  static mail(form) {
    const sign = String(this.prefs.mailSign || '').trim();
    if (sign && !String(form.body || '').includes(sign)) {
      form.body = `${String(form.body || '').replace(/\s+$/, '')}\n\n${sign}`;
    }
    if (this.prefs.mailCopy === false) form.cc = '';
    return form;
  }

  /**
   * Запомнить в личных настройках без вопросов (тема из меню, предпросмотр, расположение кабинета).
   * @param {object} patch
   */
  static async remember(patch) {
    this.prefs = { ...this.prefs, ...patch };
    if (!this.uid) return;
    try {
      await this.save(this.prefs);
    } catch {
      // без сервера — до перезагрузки в этом браузере
    }
  }

  /**
   * Записать настройки.
   * @param {object} prefs
   * @returns {Promise<object>}
   */
  static async save(prefs) {
    const answer = await Api.request('/api/me/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ livePreview: DocLink.previewWanted(), ...prefs }),
    });
    this.prefs = answer.prefs || {};
    this.uid = answer.id || this.uid;
    return this.prefs;
  }

  /** «Мои настройки»: вкладка кабинета, без кабинета — окно. */
  static open() {
    if (!Managers.meId()) {
      Toast.show('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера');
      return;
    }
    if (FEAT.on('cabPrefs') && MyDay.enabled()) {
      MyDay.open('prefs');
      return;
    }
    const modal = new Modal(
      `<div class="dlg-h"><h3>Мои настройки<small>${esc(this.myName())}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${this.form()}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-mpsave>Сохранить</button></div>`,
      'mp-dlg',
    );
    modal.d.onclick = event => {
      if (event.target.closest('[data-x]')) modal.close();
      else if (event.target.closest('[data-mpsave]'))
        this.store(this.collect(modal.d)).then(done => done && modal.close());
    };
  }

  /**
   * Имя выбранного менеджера.
   * @returns {string}
   */
  static myName() {
    const mine = Managers.list.find(row => row.id === Managers.meId());
    return mine ? mine.name : '';
  }

  /**
   * Поля настроек (без кнопок): общее, условия новых КП, письма.
   * @returns {string}
   */
  static form() {
    const mine = Managers.list.find(row => row.id === Managers.meId());
    return `<p class="muted mp-lead">Только для вас и на любом компьютере, где вы работаете. Общие правила отдела задаёт администратор; пустое поле — как у отдела.</p>
      ${this._main()}${this._conds()}${this._mail(mine)}`;
  }

  static _options(list, value) {
    return list
      .map(
        ([key, label]) =>
          `<option value="${esc(key)}"${(value || 'auto') === key ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('');
  }

  // значение отдела — подсказка в пустом поле
  static _company(key) {
    const schema = DEF_BY[key];
    if (!schema) return '';
    const server = DefRegistry.srv[key];
    return server && server.v != null && String(server.v) !== '' ? String(server.v) : String(schema[4] ?? '');
  }

  static _main() {
    const prefs = this.prefs;
    const defs = prefs.defaults || {};
    const templates = DocLink.templates()
      .filter(tpl => !tpl.error)
      .map(
        tpl =>
          `<option value="${esc(tpl.id)}"${prefs.template === tpl.id ? ' selected' : ''}>${esc(tpl.name)}</option>`,
      )
      .join('');
    const currencies = this.CURRENCIES.map(
      ([key, label]) => `<option value="${key}"${defs['kp.cur'] === key ? ' selected' : ''}>${label}</option>`,
    ).join('');
    return `<p class="sub mp-h">Вид и новые КП</p><div class="grid g2"><label class="f"><span>Тема</span><select id="mpTheme">${this._options(this.THEME, prefs.theme)}</select></label>
        <label class="mp-ck mp-pv"><input type="checkbox" id="mpLive"${DocLink.previewWanted() ? ' checked' : ''}> Предпросмотр КП рядом с формой (экран от ${DocLink.previewMinWidth()} px)</label>
        <label class="f"><span>Шаблон новых КП</span><select id="mpTpl"><option value="">Как в программе</option>${templates}</select></label>
        <label class="f"><span>Валюта новых КП</span><select id="mpCur"><option value="">Как у отдела (${esc(this._company('kp.cur'))})</option>${currencies}</select></label>
        <label class="f"><span>Город в КП</span><input type="text" id="mpCity" value="${esc(defs['kp.city'] || '')}" placeholder="${esc(this._company('kp.city'))}" autocomplete="off"></label></div>`;
  }

  static _conds() {
    const defs = this.prefs.defaults || {};
    const conds = DEF_SCHEMA.filter(row => row[1] === 'cond');
    const fields = conds
      .map(
        ([key, , label]) =>
          `<label class="f"><span>${esc(label)}</span><input type="text" data-mpd="${esc(key)}" value="${esc(defs[key] || '')}" placeholder="${esc(this._company(key) || 'как у отдела')}" autocomplete="off"></label>`,
      )
      .join('');
    return `<details class="more"${conds.some(cond => defs[cond[0]]) ? ' open' : ''}><summary>Мои условия для новых КП</summary>
        <div class="grid g2" style="margin-top:8px">${fields}</div></details>`;
  }

  static _mail(mine) {
    const prefs = this.prefs;
    return `<p class="sub mp-h">Письма клиентам</p>
      <label class="f"><span>Подпись — добавляется в конец письма</span><textarea id="mpSign" rows="4" placeholder="С уважением,&#10;${esc(mine ? mine.name : 'Иван Петров')}&#10;${esc((mine && mine.phone) || '+7 (…)')}">${esc(prefs.mailSign || '')}</textarea></label>
      <label class="mp-ck"><input type="checkbox" id="mpCopy"${prefs.mailCopy === false ? '' : ' checked'}> Ставить меня в копию письма${mine && mine.email ? ` (${esc(mine.email)})` : ''}</label>`;
  }

  static _defaults(root) {
    const defs = {};
    const city = root.querySelector('#mpCity').value.trim();
    if (city) defs['kp.city'] = city;
    if (root.querySelector('#mpCur').value) defs['kp.cur'] = root.querySelector('#mpCur').value;
    root.querySelectorAll('[data-mpd]').forEach(input => {
      if (input.value.trim()) defs[input.dataset.mpd] = input.value.trim();
    });
    return defs;
  }

  /**
   * Значения полей формы.
   * @param {HTMLElement} root
   * @returns {object}
   */
  static collect(root) {
    return {
      theme: root.querySelector('#mpTheme').value,
      livePreview: root.querySelector('#mpLive').checked,
      template: root.querySelector('#mpTpl').value,
      defaults: this._defaults(root),
      mailSign: root.querySelector('#mpSign').value,
      mailCopy: root.querySelector('#mpCopy').checked,
    };
  }

  /**
   * Сохранить поверх прежних настроек и применить.
   * @param {object} patch
   * @returns {Promise<boolean>} сохранено
   */
  static async store(patch) {
    try {
      await this.save({ ...this.prefs, ...patch });
      if (!this.prefs.template) this._forgetTemplate();
      this.apply();
      Toast.show('Мои настройки сохранены');
      return true;
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
      return false;
    }
  }

  static _forgetTemplate() {
    try {
      localStorage.removeItem('kp.template');
    } catch {
      // без хранилища — нечего забывать
    }
  }
}
