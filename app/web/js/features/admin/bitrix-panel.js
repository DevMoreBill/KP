import { BitrixMenu } from './bitrix-menu.js';
import { StDirty } from './settings-tools.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';

/** «Битрикс24»: связь кабинета менеджера с Битрикс24 (app/bitrix.py, правила обмена — app/bitrix_rules.py), вкладка — пункт меню. */
export class BitrixPanel {
  static state = null; // настройка и состояние (/api/admin/bitrix), state.rules — действующие правила обмена
  static portal = null; // ответ проверки связи: воронки, стадии, пользователи, поля портала, подсказка по e-mail
  static main = null;
  static errOnly = false; // журнал: только ошибки и предупреждения
  static logMid = ''; // журнал: отбор по менеджеру
  static dry = null; // результат пробного прогона
  static imp = null; // предпросмотр загрузки старых сделок
  static embed = null; // вкладка, открытая разделом «Настроек → Битрикс24» (своя строка меню вместо полосы вкладок)
  // мастер первого подключения (пока обмен не включён): адрес и связь → воронки → менеджеры → проверка и включение
  static WIZARD = [
    ['link', 'Адрес и проверка связи'],
    ['cats', 'Воронки и этапы'],
    ['mgr', 'Менеджеры'],
    ['log', 'Проверка без записи и включение'],
  ];
  static full = false; // «Все настройки» вместо мастера
  static GROUPS = BitrixMenu.GROUPS;
  static TABS = BitrixMenu.TABS;
  static INTRO = BitrixMenu.INTRO;
  static DIR = {
    both: 'В обе стороны',
    in: 'Только из Битрикса в программу',
    out: 'Только из программы в Битрикс',
    off: 'Не передавать',
  };
  static DIR_SHORT = { both: '⇄ в обе стороны', in: '← из Битрикса', out: '→ в Битрикс', off: 'не передавать' };
  static WIN = { last: 'последняя правка', ours: 'программа', theirs: 'Битрикс' };
  static TASK_AS = { todo: 'дело (универсальное)', call: 'звонок', meet: 'встреча', off: 'не передавать' };
  static FIND = { inn: 'только по ИНН', inn_name: 'по ИНН, затем по названию', name: 'только по названию' };
  static NEED_C = ['mgr', 'cats', 'fields']; // вкладкам нужны списки из Битрикса
  static STORE = 'kp.bxtab';
  static NO_URL = 'Сначала задайте адрес вебхука в пункте «Обмен → Подключение и состояние».';

  /**
   * Вкладки раздела по ключу: {ключ: класс с html() и bind()} — подключает admin/index.js (вкладки — BitrixViews).
   * @returns {object}
   */
  static views = () => ({});

  /**
   * Открытая вкладка.
   * @returns {string}
   */
  static get tab() {
    if (this.embed) return this.embed;
    try {
      return localStorage.getItem(this.STORE) || 'link';
    } catch {
      return 'link';
    }
  }

  /**
   * Запомнить вкладку.
   * @param {string} tab
   */
  static set tab(tab) {
    if (this.embed) {
      this.embed = tab;
      return;
    }
    try {
      localStorage.setItem(this.STORE, tab);
    } catch {
      // без памяти вкладки
    }
  }

  /**
   * Открыть.
   * @param {HTMLElement} main
   * @param {{t: string, err?: boolean}|null} note
   * @param {string|null} [tab] пункт меню раздела
   */
  static async open(main, note, tab = null) {
    this.main = main;
    this.embed = tab;
    try {
      this.state = await AdminApi.get('bitrix');
    } catch (error) {
      main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    this._again(this.tab);
    this.render(note);
    if (this.NEED_C.includes(this.tab)) this.loadPortal();
  }

  /**
   * Дата и время.
   * @param {string} iso
   * @returns {string}
   */
  static when(iso) {
    return iso ? Fmt.dateTime(iso) : '—';
  }

  /**
   * Действующие правила обмена.
   * @returns {object}
   */
  static rules() {
    return this.state.rules || {};
  }

  /**
   * Выпадающий список из пар [значение, подпись].
   * @param {string} attrs
   * @param {Array<Array<string>>} opts
   * @param {*} current
   * @param {string} [label]
   * @returns {string}
   */
  static sel(attrs, opts, current, label) {
    const options = opts
      .map(
        ([value, text]) =>
          `<option value="${esc(value)}"${String(value) === String(current ?? '') ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<select ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${options}</select>`;
  }

  /**
   * Галочка.
   * @param {string} attrs
   * @param {boolean} checked
   * @param {string} text
   * @returns {string}
   */
  static chk(attrs, checked, text) {
    return `<label class="cab-ck"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}> ${text}</label>`;
  }

  /**
   * Настройка с описанием: слева — название, что делает, пример и «если выключить», справа — поле.
   * @param {{control: string, label: string, what: string, example?: string, off?: string}} opt
   * @returns {string}
   */
  static opt({ control, label, what, example = '', off = '' }) {
    const sample = example ? `<p class="bx-ex"><b>Пример.</b> ${example}</p>` : '';
    const offText = off ? `<p class="bx-ex"><b>Если выключить.</b> ${off}</p>` : '';
    return `<div class="bx-opt"><div class="bx-opt-t"><b>${label}</b><p>${what}</p>${sample}${offText}</div><div class="bx-opt-c">${control}</div></div>`;
  }

  /**
   * Переключатель «включено» для opt().
   * @param {string} attrs
   * @param {boolean} checked
   * @param {string} label
   * @returns {string}
   */
  static toggle(attrs, checked, label) {
    return `<label class="sw"><input type="checkbox" ${attrs}${checked ? ' checked' : ''} aria-label="${esc(label)}"><span>${checked ? 'включено' : 'выключено'}</span></label>`;
  }

  /**
   * Направления по видам данных с одним изменённым (сервер принимает весь набор).
   * @param {string} kind
   * @param {string} value
   * @returns {object}
   */
  static flowWith(kind, value) {
    const flow = { ...(this.rules().flow || {}) };
    if (value) flow[kind] = value;
    else delete flow[kind];
    return Object.fromEntries(Object.entries(flow).filter(([, dir]) => dir));
  }

  /**
   * Варианты направления.
   * @param {string[]} list
   * @param {string} [first] подпись пустого варианта «как общее»
   * @returns {Array<Array<string>>}
   */
  static dirOpts(list, first) {
    return [...(first ? [['', first]] : []), ...list.map(dir => [dir, this.DIR[dir]])];
  }

  /**
   * Название воронки.
   * @param {string} id
   * @returns {string}
   */
  static catName(id) {
    const cat = ((this.portal && this.portal.categories) || []).find(entry => entry.id === String(id));
    return cat ? cat.name : `воронка ${id}`;
  }

  /**
   * Элемент вкладки.
   * @param {string} selector
   * @returns {HTMLElement|null}
   */
  static one(selector) {
    return this.main.querySelector(selector);
  }

  /**
   * Элементы вкладки.
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  static all(selector) {
    return [...this.main.querySelectorAll(selector)];
  }

  /**
   * Нарисовать вкладку.
   * @param {{t: string, err?: boolean}|null} [note]
   */
  static render(note) {
    const wizard = this.wizard();
    const tabs = wizard ? this.WIZARD : this.TABS;
    const tab = tabs.some(entry => entry[0] === this.tab) ? this.tab : tabs[0][0];
    const need = this.NEED_C.includes(tab) && !this.portal;
    StDirty.set(false); // вкладка нарисована заново из сохранённого — набранное прежде не ждёт сохранения
    const view = this.views()[tab];
    const body = need
      ? `<div class="st-card"><p class="muted">${this.state.hasUrl ? 'Загружаю списки из Битрикс24 (воронки, стадии, пользователи, поля)…' : this.NO_URL}</p></div>`
      : view.html();
    const msg = note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : '';
    this.main.innerHTML = wizard
      ? `${this._steps(tab)}${msg}${body}${this._next(tab)}`
      : `<div class="bx-lay">${this._nav(tab)}<div class="bx-body">${this._intro(tab)}${msg}${body}</div></div>`;
    this._bindBar();
    if (!need) view.bind();
  }

  static _bindBar() {
    this.all('[data-bxtab]').forEach(button => {
      button.onclick = () => this._go(button.dataset.bxtab);
    });
    this.one('[data-bxfull]')?.addEventListener('click', () => {
      this.full = true;
      this.render();
    });
    this.one('[data-bxenable]')?.addEventListener('click', () =>
      this.run(
        () => AdminApi.post('bitrix', { on: true }),
        'Обмен включён: открытые сделки поставлены в очередь отправки',
      ),
    );
  }

  /**
   * Показывать мастер первого подключения: обмен ещё не включён и «Все настройки» не выбраны.
   * @returns {boolean}
   */
  static wizard() {
    return !this.state.on && !this.full;
  }

  static _go(tab) {
    this.tab = tab;
    this._again(tab);
    this.render();
    if (this.NEED_C.includes(this.tab)) this.loadPortal();
  }

  // вкладку открыли — то, что у неё не загрузилось, запросить снова (перерисовка сама не повторяет)
  static _again(tab) {
    const view = this.views()[tab];
    if (view && view.again) view.again();
  }

  // меню по предметам: группа — заголовок, пункты — кнопки
  static _nav(tab) {
    const button = ([key, label]) =>
      `<button type="button" role="tab" data-bxtab="${key}" class="${key === tab ? 'on' : ''}" aria-selected="${key === tab}">${esc(label)}</button>`;
    const groups = this.GROUPS.map(
      ([title, tabs]) => `<div class="bx-ng"><p class="bx-nt">${esc(title)}</p>${tabs.map(button).join('')}</div>`,
    ).join('');
    return `<nav class="bx-nav" role="tablist" aria-label="Битрикс24">${groups}</nav>`;
  }

  static _intro(tab) {
    const label = (this.TABS.find(([key]) => key === tab) || [])[1] || '';
    const group = (this.GROUPS.find(([, tabs]) => tabs.some(([key]) => key === tab)) || [])[0] || '';
    const more =
      tab === 'guide'
        ? ''
        : ` <button class="btn ghost sm" type="button" data-bxtab="guide">Как это работает →</button>`;
    return `<div class="bx-intro"><p class="bx-crumb">Битрикс24 · ${esc(group)}</p><h3>${esc(label)}</h3><p class="muted">${esc(this.INTRO[tab] || '')}${more}</p></div>`;
  }

  static _steps(tab) {
    const step = this.WIZARD.findIndex(([key]) => key === tab);
    const steps = this.WIZARD.map(
      ([key, label], i) =>
        `<button type="button" data-bxtab="${key}" class="bx-st${i === step ? ' on' : ''}${i < step ? ' done' : ''}"><b>${i + 1}</b>${esc(label)}</button>`,
    ).join('');
    return `<div class="st-card bx-wiz"><div class="row"><p class="sub" style="margin:0">Подключение Битрикс24 · шаг ${step + 1} из ${this.WIZARD.length}</p><span class="sp"></span><button class="btn ghost sm" type="button" data-bxfull>Все настройки →</button></div>
      <div class="bx-wsteps">${steps}</div></div>`;
  }

  static _next(tab) {
    const step = this.WIZARD.findIndex(([key]) => key === tab);
    const back =
      step > 0 ? `<button class="btn" type="button" data-bxtab="${this.WIZARD[step - 1][0]}">← Назад</button>` : '';
    const last = step === this.WIZARD.length - 1;
    const forward = last
      ? `<button class="btn primary" type="button" data-bxenable${this.state.hasUrl ? '' : ' disabled'}>Включить обмен</button>`
      : `<button class="btn primary" type="button" data-bxtab="${this.WIZARD[step + 1][0]}"${this.state.hasUrl ? '' : ' disabled title="Сначала задайте адрес вебхука и проверьте связь"'}>Далее →</button>`;
    return `<div class="row bx-wnav">${back}<span class="sp"></span>${forward}</div>`;
  }

  /** Списки из Битрикса: воронки, стадии, пользователи, поля. */
  static async loadPortal() {
    if (this.portal || !this.state.hasUrl) return;
    try {
      this.portal = await AdminApi.post('bitrix/test', {});
      this.render();
    } catch (error) {
      this.render({ t: `Нет связи с Битрикс24: ${error.message || error}`, err: true });
    }
  }

  /**
   * Выполнить действие и перерисовать с итогом.
   * @param {Function} action
   * @param {string|Function} [done] текст итога или функция ответа → текст
   */
  static async run(action, done) {
    try {
      const reply = await action();
      if (reply && reply.on !== undefined) this.state = reply;
      this.render(done ? { t: typeof done === 'function' ? done(reply) : done } : null);
    } catch (error) {
      this.render({ t: String(error.message || error), err: true });
    }
  }

  /**
   * Сохранить настройку.
   * @param {object} body
   * @param {string} [msg]
   * @returns {Promise<void>}
   */
  static save(body, msg) {
    return this.run(() => AdminApi.post('bitrix', body), msg || 'Сохранено');
  }

  /**
   * Итог обмена.
   * @param {object} reply
   * @returns {string}
   */
  static result(reply) {
    const result = reply.result || {};
    if (result.error) return `Ошибка: ${result.error}`;
    return `Готово: отправлено ${result.sent || 0}, получено изменений ${result.pulled || 0}, новых сделок ${result.created || 0}${result.skipped ? ` (пропущено по правилам ${result.skipped})` : ''}, дел ${result.tasks || 0}`;
  }
}
