import { Journal } from './journal.js';
import { Managers } from './managers.js';
import { MyDay } from './my-day.js';

/**
 * «⋯ → Мои настройки» — личные настройки менеджера (сервер: app/user_prefs.py), действуют на любом компьютере: тема,
 * стартовый экран, шаблон КП, свои значения для новых КП (поверх умолчаний отдела), подпись и копия себе в письмах.
 */
export class MyPrefs {
  static prefs = {};
  static uid = '';
  static START = [
    ['auto', 'Как в программе (кабинет или каталог)'],
    ['myday', 'Кабинет менеджера'],
    ['catalog', 'Каталог'],
    ['journal', 'Журнал КП'],
    ['none', 'Ничего — сразу текущее КП'],
  ];
  static THEME = [
    ['auto', 'Как в системе'],
    ['light', 'Светлая'],
    ['dark', 'Тёмная'],
  ];
  static CURRENCIES = [
    ['RUB', 'Рубли'],
    ['USD', 'Доллары США'],
    ['EUR', 'Евро'],
    ['CNY', 'Юани'],
  ];
  static STARTS = {
    none: () => true,
    myday: () => {
      if (!MyDay.enabled()) return false;
      MyDay.open();
      return true;
    },
    journal: () => {
      Journal.open();
      return true;
    },
    catalog: () => {
      if (catCache.length) openCatalog({});
      return true;
    },
  };

  /**
   * Загрузить свои настройки.
   * @returns {Promise<object>}
   */
  static async load() {
    try {
      const answer = await api('/api/me/prefs');
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

  /** Тема и шаблон — в этот браузер. */
  static apply() {
    if (Theme.NAMES.includes(this.prefs.theme)) Theme.set(this.prefs.theme);
    if (!this.prefs.template) return;
    try {
      localStorage.setItem('kp.template', this.prefs.template);
    } catch {
      // без хранилища — шаблон как в программе
    }
  }

  /**
   * Стартовый экран после загрузки программы.
   * @returns {boolean} открыт свой экран (иначе — как в программе)
   */
  static start() {
    const start = this.STARTS[this.prefs.start || 'auto'];
    return start ? start() : false;
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
   * Тема из меню «⋯» — запомнить и в личных настройках.
   * @param {string} theme
   */
  static async rememberTheme(theme) {
    if (!this.uid) return;
    this.prefs = { ...this.prefs, theme };
    try {
      await this.save(this.prefs);
    } catch {
      // без сервера тема всё равно в браузере
    }
  }

  /**
   * Записать настройки.
   * @param {object} prefs
   * @returns {Promise<object>}
   */
  static async save(prefs) {
    const answer = await api('/api/me/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(prefs),
    });
    this.prefs = answer.prefs || {};
    this.uid = answer.id || this.uid;
    return this.prefs;
  }

  /** Окно «Мои настройки». */
  static open() {
    if (!Managers.meId()) {
      toast('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера');
      return;
    }
    const mine = MGRS.find(row => row.id === Managers.meId());
    const modal = new Modal(
      `<div class="dlg-h"><h3>Мои настройки<small>${esc(mine ? mine.name : '')}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin-top:0">Только для вас и на любом компьютере, где вы работаете. Общие правила отдела задаёт администратор («Настройки → Умолчания»); пустое поле — как у отдела.</p>
      ${this._main()}
      ${this._conds()}
      ${this._mail(mine)}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-mpsave>Сохранить</button></div>`,
      'mp-dlg',
    );
    modal.d.onclick = event => {
      if (event.target.closest('[data-x]')) modal.close();
      else if (event.target.closest('[data-mpsave]')) this._save(modal);
    };
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
    const server = DEFS_SRV[key];
    return server && server.v != null && String(server.v) !== '' ? String(server.v) : String(schema[4] ?? '');
  }

  static _main() {
    const prefs = this.prefs;
    const defs = prefs.defaults || {};
    const templates = TEMPLATES.filter(tpl => !tpl.error)
      .map(
        tpl =>
          `<option value="${esc(tpl.id)}"${prefs.template === tpl.id ? ' selected' : ''}>${esc(tpl.name)}</option>`,
      )
      .join('');
    const currencies = this.CURRENCIES.map(
      ([key, label]) => `<option value="${key}"${defs['kp.cur'] === key ? ' selected' : ''}>${label}</option>`,
    ).join('');
    return `<div class="grid g2"><label class="f"><span>Тема</span><select id="mpTheme">${this._options(this.THEME, prefs.theme)}</select></label>
        <label class="f"><span>При запуске открывать</span><select id="mpStart">${this._options(this.START, prefs.start)}</select></label>
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
    return `<p class="sub" style="margin:14px 0 6px">Письма клиентам</p>
      <label class="f"><span>Подпись — добавляется в конец письма</span><textarea id="mpSign" rows="4" placeholder="С уважением,&#10;${esc(mine ? mine.name : 'Иван Петров')}&#10;${esc((mine && mine.phone) || '+7 (…)')}">${esc(prefs.mailSign || '')}</textarea></label>
      <label class="mp-ck"><input type="checkbox" id="mpCopy"${prefs.mailCopy === false ? '' : ' checked'}> Ставить меня в копию письма${mine && mine.email ? ` (${esc(mine.email)})` : ''}</label>`;
  }

  static _defaults(modal) {
    const defs = {};
    const city = modal.$('#mpCity').value.trim();
    if (city) defs['kp.city'] = city;
    if (modal.$('#mpCur').value) defs['kp.cur'] = modal.$('#mpCur').value;
    modal.d.querySelectorAll('[data-mpd]').forEach(input => {
      if (input.value.trim()) defs[input.dataset.mpd] = input.value.trim();
    });
    return defs;
  }

  static async _save(modal) {
    try {
      await this.save({
        theme: modal.$('#mpTheme').value,
        start: modal.$('#mpStart').value,
        template: modal.$('#mpTpl').value,
        defaults: this._defaults(modal),
        mailSign: modal.$('#mpSign').value,
        mailCopy: modal.$('#mpCopy').checked,
      });
      if (!modal.$('#mpTpl').value) this._forgetTemplate();
      this.apply();
      modal.close();
      toast('Мои настройки сохранены — для новых КП и писем');
    } catch (error) {
      toast(`Не сохранено: ${error.message || error}`);
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
