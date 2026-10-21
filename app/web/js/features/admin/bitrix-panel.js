import { AdminApi } from './admin-core.js';
import { BitrixFields, BitrixLog, BitrixManagers, BitrixOld, BitrixStages } from './bitrix-tabs.js';
import { BitrixFlow, BitrixLink, BitrixSchedule, BitrixSend } from './bitrix-link.js';
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
  static TABS = [
    ['link', 'Связь и включение'],
    ['mirror', 'Кабинет как в Битрикс24'],
    ['flow', 'Направление обмена'],
    ['mgr', 'Менеджеры'],
    ['cats', 'Воронки и этапы'],
    ['fields', 'Поля сделки'],
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
    const tab = this.TABS.some(entry => entry[0] === this.tab) ? this.tab : 'link';
    const need = this.NEED_C.includes(tab) && !this.portal;
    StDirty.set(false); // вкладка нарисована заново из сохранённого — набранное прежде не ждёт сохранения
    const bar = this.embed
      ? ''
      : `<div class="bx-tabs" role="tablist">${this.TABS.map(([key, label]) => `<button type="button" role="tab" data-bxtab="${key}" class="${key === tab ? 'on' : ''}" aria-selected="${key === tab}">${esc(label)}</button>`).join('')}</div>`;
    const view = this._views()[tab];
    const body = need
      ? `<div class="st-card"><p class="muted">${this.state.hasUrl ? 'Загружаю списки из Битрикс24 (воронки, стадии, пользователи, поля)…' : this.NO_URL}</p></div>`
      : view.html();
    this.main.innerHTML = `${bar}
      ${note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : ''}
      ${body}`;
    this.all('[data-bxtab]').forEach(button => {
      button.onclick = () => {
        this.tab = button.dataset.bxtab;
        this.render();
        if (this.NEED_C.includes(this.tab)) this.loadPortal();
      };
    });
    if (!need) view.bind();
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
