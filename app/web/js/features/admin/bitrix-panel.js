import { AdminApi } from './admin-core.js';
import { BitrixFields, BitrixLog, BitrixManagers, BitrixOld, BitrixStages } from './bitrix-tabs.js';
import { BitrixFlow, BitrixLink, BitrixSchedule, BitrixSend } from './bitrix-link.js';
import { BitrixRegs } from './bitrix-regs.js';
import { BitrixEcon } from './bitrix-econ.js';
import { StDirty } from './settings-tools.js';
import { MirrorPanel } from '../crm/mirror-panel.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

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
  // после подключения: первым — «Состояние обмена», остальное — «Тонкая настройка»
  static MAIN = ['link', 'mirror'];
  static TABS = [
    ['link', 'Связь и включение'],
    ['mirror', 'Кабинет как в Битрикс24'],
    ['flow', 'Направление обмена'],
    ['mgr', 'Менеджеры'],
    ['cats', 'Воронки и этапы'],
    ['fields', 'Поля сделки'],
    ['regs', 'Регламент сделки'],
    ['econ', 'Экономика сделки'],
    ['send', 'Что передаётся'],
    ['sched', 'Расписание'],
    ['log', 'Журнал и проверка'],
    ['old', 'Старые сделки'],
  ];
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
  static NO_URL = 'Сначала задайте адрес вебхука в пункте «Связь и включение».';

  static _views() {
    return {
      link: BitrixLink,
      mirror: BitrixMirror,
      flow: BitrixFlow,
      mgr: BitrixManagers,
      cats: BitrixStages,
      fields: BitrixFields,
      regs: BitrixRegs,
      econ: BitrixEcon,
      send: BitrixSend,
      sched: BitrixSchedule,
      log: BitrixLog,
      old: BitrixOld,
    };
  }

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
    const bar = wizard ? this._steps(tab) : this._bar(tab);
    const view = this._views()[tab];
    const body = need
      ? `<div class="st-card"><p class="muted">${this.state.hasUrl ? 'Загружаю списки из Битрикс24 (воронки, стадии, пользователи, поля)…' : this.NO_URL}</p></div>`
      : view.html();
    this.main.innerHTML = `${bar}
      ${note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : ''}
      ${body}${wizard ? this._next(tab) : ''}`;
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
    this.render();
    if (this.NEED_C.includes(this.tab)) this.loadPortal();
  }

  // после подключения: «Состояние обмена» и «Кабинет как в Битрикс24», остальное — «Тонкая настройка»
  static _bar(tab) {
    const button = ([key, label]) =>
      `<button type="button" role="tab" data-bxtab="${key}" class="${key === tab ? 'on' : ''}" aria-selected="${key === tab}">${esc(key === 'link' ? 'Состояние обмена' : label)}</button>`;
    const main = this.TABS.filter(([key]) => this.MAIN.includes(key));
    const fine = this.TABS.filter(([key]) => !this.MAIN.includes(key));
    return `<div class="bx-tabs" role="tablist">${main.map(button).join('')}<span class="bx-fine-h">Тонкая настройка:</span>${fine.map(button).join('')}</div>`;
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

/** «Кабинет как в Битрикс24»: воронки, стадии и поля сделки (features/crm/). */
class BitrixMirror {
  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    return BitrixPanel.state.hasUrl
      ? '<div id="bxMirror"><p class="muted">Загружаю…</p></div>'
      : `<div class="st-card"><p class="muted">${BitrixPanel.NO_URL}</p></div>`;
  }

  /** Подключить панель кабинета. */
  static bind() {
    const box = BitrixPanel.one('#bxMirror');
    if (box) MirrorPanel.open(box);
  }
}
