import { AdminApi, AdminDialog } from './admin-core.js';
import { Toast } from '../../core/toast.js';
import { Debounce } from '../../core/debounce.js';
import { DealLogistics } from '../deal/deal-logistics.js';
import { DEF_BY, DEF_GROUPS, DEF_GROUP_HINTS, DEF_SCHEMA, DefRegistry } from '../../core/defaults.js';
import { $, esc } from '../../core/util.js';

/** «Значения программы»: всё, что программа подставляет и с чем считает, — по разделам, с поиском и пояснениями. */
export class DefaultsTab {
  static sec = 'kp'; // открытый раздел (запоминается, пока открыта программа)
  static query = ''; // строка поиска
  static only = false; // «Только изменённые»
  static NUMBER = /^-?\d+(\.\d+)?$/;
  static DIGITS = { maximumFractionDigits: 6 };
  static WAIT_MS = 200;
  static STORE = 'kp.defaults';

  /**
   * Варианты выбора значения.
   * @param {object} opts
   * @returns {Array<Array<string>>}
   */
  static optsOf(opts) {
    return typeof opts.opts === 'function' ? opts.opts() : opts.opts || [];
  }

  /**
   * Значение для показа: число по-русски и единица.
   * @param {*} value
   * @param {object} [opts]
   * @returns {string}
   */
  static fmt(value, opts = {}) {
    let text = String(value ?? '').trim();
    if (this.NUMBER.test(text)) text = Number(text).toLocaleString('ru-RU', this.DIGITS);
    if (!text) return 'пусто';
    return text + (opts.unit ? ` ${opts.unit}` : '');
  }

  static _on(own, entry, type, builtin, opts) {
    const has = own && 'on' in entry;
    if (type === 'bool') return has ? !!entry.on : !!builtin;
    if (opts.req) return true;
    return has ? !!entry.on : !opts.off;
  }

  static _limits(type, opts) {
    if (type !== 'num' || (opts.min == null && opts.max == null)) return '';
    const num = value => Number(value).toLocaleString('ru-RU', this.DIGITS);
    return `${opts.min != null ? `от ${num(opts.min)}` : ''}${opts.min != null && opts.max != null ? ' ' : ''}${opts.max != null ? `до ${num(opts.max)}` : ''}`;
  }

  static _input({ key, label, type, builtin, opts }, enabled, value) {
    if (type === 'bool') return '';
    if (type === 'select')
      return `<select data-dv aria-label="${esc(label)}"${enabled ? '' : ' disabled'}>${this.optsOf(opts)
        .map(
          ([code, text]) =>
            `<option value="${esc(code)}"${String(code) === value ? ' selected' : ''}>${esc(text)}</option>`,
        )
        .join('')}</select>`;
    const list = opts.list
      ? `<datalist id="dfl-${esc(key)}">${this.optsOf({ opts: opts.list })
          .map(([code]) => `<option value="${esc(code)}">`)
          .join('')}</datalist>`
      : '';
    return `<span class="df-in"><input type="text" data-dv value="${esc(value)}" aria-label="${esc(label)}"${type === 'num' ? ' inputmode="decimal"' : ''}${enabled ? '' : ' disabled'} placeholder="${esc(String(builtin || (opts.list ? 'выберите или впишите' : '')))}"${opts.list ? ` list="dfl-${esc(key)}"` : ''} autocomplete="off">${opts.unit ? `<i>${esc(opts.unit)}</i>` : ''}</span>${list}`;
  }

  static _program(type, builtin, opts) {
    if (type === 'bool') return builtin ? 'включено' : 'выключено';
    if (type === 'select')
      return (this.optsOf(opts).find(([code]) => String(code) === String(builtin)) || [, builtin])[1] || 'пусто';
    return this.fmt(builtin, opts);
  }

  static _switch(enabled, opts) {
    return `<label class="sw df-sw" title="${opts.req ? 'Обязательное значение — всегда действует' : 'Включить / выключить'}"><input type="checkbox" data-don${enabled ? ' checked' : ''}${opts.req ? ' disabled' : ''}><span></span></label>`;
  }

  static _caption(label, type, opts, program) {
    const limits = this._limits(type, opts);
    return `<div class="df-l"><b>${esc(label)}</b>${opts.hint ? `<small class="muted">${esc(opts.hint)}</small>` : ''}<small class="df-pv">В программе: ${esc(program)}${limits ? ` · допустимо ${esc(limits)}` : ''}</small><small class="df-err" hidden></small></div>`;
  }

  /**
   * Строка значения.
   * @param {object} values свои значения
   * @param {Array} schema строка DEF_SCHEMA
   * @returns {string}
   */
  static row(values, [key, , label, type, builtin, opts = {}]) {
    const entry = values[key];
    const own = entry && typeof entry === 'object';
    const enabled = this._on(own, entry, type, builtin, opts);
    const value = own && entry.v != null && String(entry.v) !== '' ? String(entry.v) : String(builtin ?? '');
    const program = this._program(type, builtin, opts);
    return `<div class="df-row${enabled ? '' : ' off'}${own ? ' own' : ''}" data-dk="${esc(key)}" data-type="${type}">
      ${this._switch(enabled, opts)}
      ${this._caption(label, type, opts, program)}
      <div class="df-v">${this._input({ key, label, type, builtin, opts }, enabled, value)}</div>
      <button type="button" class="icon df-rs" data-dreset title="Вернуть значение программы: ${esc(program)}" aria-label="Вернуть значение программы"${own ? '' : ' disabled'}>↺</button></div>`;
  }

  /**
   * Подходит ли строка под поиск.
   * @param {Array} schema
   * @param {string} query
   * @returns {boolean}
   */
  static match(schema, query) {
    if (!query) return true;
    const opts = schema[5] || {};
    return [schema[0], schema[2], opts.hint, opts.unit].join(' ').toLowerCase().includes(query);
  }

  /**
   * Группы раздела (или всех разделов при поиске): [[группа, название, строки]].
   * @param {object} values
   * @returns {Array}
   */
  static groups(values) {
    const query = this.query.trim().toLowerCase();
    const fits = (schema, group) =>
      schema[1] === group &&
      (query || DefRegistry.section(group) === this.sec) &&
      this.match(schema, query) &&
      (!this.only || values[schema[0]]);
    return DEF_GROUPS.map(([group, title]) => [group, title, DEF_SCHEMA.filter(schema => fits(schema, group))]).filter(
      entry => entry[2].length,
    );
  }

  static _nav(values, sections) {
    const count = section => DEF_SCHEMA.filter(schema => DefRegistry.section(schema[1]) === section).length;
    const own = section =>
      DEF_SCHEMA.filter(schema => DefRegistry.section(schema[1]) === section && values[schema[0]]).length;
    return sections
      .map(
        ([section, title]) =>
          `<button type="button" class="df-nb${section === this.sec && !this.query ? ' on' : ''}" data-dsec="${section}">${esc(title)}<small>${count(section)}${own(section) ? ` · изменено ${own(section)}` : ''}</small></button>`,
      )
      .join('');
  }

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    await DealLogistics.load().catch(() => null); // техника разгрузки из «Тарифов доставки» — в выборе «Логистики»
    const reply = await AdminApi.get('defaults');
    const values = reply.values || {};
    const sections = DefRegistry.SECTIONS.filter(([section]) =>
      DEF_SCHEMA.some(schema => DefRegistry.section(schema[1]) === section),
    );
    if (!sections.some(([section]) => section === this.sec) && sections.length) this.sec = sections[0][0];
    const current = sections.find(([section]) => section === this.sec) || [];
    main.innerHTML = `<div class="df-wrap">
      <nav class="df-nav" aria-label="Разделы">${this._nav(values, sections)}</nav>
      <div class="df-main">
        <div class="st-card df-top"><div class="df-tl"><input type="search" id="dfQ" data-nodirty placeholder="Найти значение: например, «НДС», «страхование», «копии»" value="${esc(this.query)}" autocomplete="off">
          <label class="ck st-own"><input type="checkbox" id="dfOwn" data-nodirty${this.only ? ' checked' : ''}> Только изменённые (${Object.keys(values).filter(key => DEF_BY[key]).length})</label></div>
          <p class="muted">${this.query ? 'Найдено во всех разделах.' : esc(current[2] || '')} Значения действуют для новых КП и расчётов — уже созданные КП не меняются.
          Переключатель выключен — поле остаётся пустым, решает менеджер. «↺» — вернуть значение программы.</p></div>
        <div id="dfList">${this.list(values)}</div></div></div>
      <div class="df-bar"><span class="muted" id="dfSt">Изменений нет</span><button class="btn ghost" type="button" data-dall>Вернуть все значения программы</button><button class="btn primary" type="button" data-dsave disabled>Сохранить</button></div>`;
    this.bind(main, values);
  }

  /**
   * Список групп.
   * @param {object} values
   * @returns {string}
   */
  static list(values) {
    const groups = this.groups(values);
    if (!groups.length)
      return '<p class="muted st-card">Ничего не найдено. Попробуйте другое слово или снимите «Только изменённые».</p>';
    const where = group =>
      (DefRegistry.SECTIONS.find(([section]) => section === DefRegistry.section(group)) || [, ''])[1];
    return groups
      .map(
        ([group, title, rows]) =>
          `<div class="st-card df-g"><p class="sub">${esc(title)}${this.query ? ` <small class="muted">· ${esc(where(group))}</small>` : ''}</p>${DEF_GROUP_HINTS[group] ? `<p class="muted df-gh">${esc(DEF_GROUP_HINTS[group])}</p>` : ''}${rows.map(schema => this.row(values, schema)).join('')}</div>`,
      )
      .join('');
  }

  /**
   * События вкладки.
   * @param {HTMLElement} main
   * @param {object} values
   */
  static bind(main, values) {
    const view = { main, values, find: main.querySelector('#dfQ') };
    const timer = new Debounce(this.WAIT_MS);
    view.find.oninput = () => timer.run(() => this._search(view));
    main.querySelector('#dfOwn').onchange = event => {
      this.only = event.target.checked;
      this._relist(view);
    };
    main.onchange = event => {
      const row = event.target.closest('.df-row');
      if (!row) return;
      if (event.target.matches('[data-don]')) {
        row.classList.toggle('off', !event.target.checked);
        const input = row.querySelector('[data-dv]');
        if (input) input.disabled = !event.target.checked;
      }
      this._touch(main, row);
    };
    main.oninput = event => {
      const row = event.target.closest('.df-row');
      if (row) this._touch(main, row);
    };
    main.onclick = event => this._click(view, event);
  }

  static _touch(main, row) {
    row.dataset.ch = '1';
    this.validate(row);
    main.querySelector('[data-dsave]').disabled = false;
    $('#dfSt').textContent = 'Есть несохранённые изменения';
  }

  static _relist(view) {
    view.main.querySelector('#dfList').innerHTML = this.list(view.values);
    view.main
      .querySelectorAll('.df-nb')
      .forEach(button => button.classList.toggle('on', !this.query && button.dataset.dsec === this.sec));
  }

  static _search(view) {
    if (this.changed(view.main) && !confirm('Несохранённые изменения пропадут. Продолжить?')) {
      view.find.value = this.query;
      return;
    }
    this.query = view.find.value;
    this._relist(view);
  }

  static async _click(view, event) {
    const main = view.main;
    const section = event.target.closest('[data-dsec]');
    if (section) {
      if (this.changed(main) && !confirm('Несохранённые изменения пропадут. Перейти в другой раздел?')) return;
      this.sec = section.dataset.dsec;
      this.query = '';
      view.find.value = '';
      this.render(main);
      return;
    }
    const reset = event.target.closest('[data-dreset]');
    if (reset) {
      await this.save(main, { [reset.closest('.df-row').dataset.dk]: null }, 'Возвращено значение программы');
      return;
    }
    if (event.target.closest('[data-dall]')) {
      this._resetAll(view);
      return;
    }
    if (event.target.closest('[data-dsave]')) this._saveRows(main);
  }

  static async _resetAll(view) {
    if (
      !(await AdminDialog.confirm(
        'Вернуть все значения программы?',
        'Все ваши значения во всех разделах удалятся, будут действовать значения программы.',
        'Вернуть',
      ))
    )
      return;
    this.save(
      view.main,
      Object.fromEntries(Object.keys(view.values).map(key => [key, null])),
      'Все значения — как в программе',
    );
  }

  static _rowValue(row) {
    const [, , , type, builtin, opts = {}] = DEF_BY[row.dataset.dk];
    const enabled = row.querySelector('[data-don]').checked;
    const input = row.querySelector('[data-dv]');
    const value = input ? input.value.trim() : '';
    const same =
      type === 'bool'
        ? enabled === !!builtin
        : enabled === (opts.req ? true : !opts.off) && (value === String(builtin ?? '') || (!value && !enabled));
    return same ? null : { on: enabled, v: value };
  }

  static _saveRows(main) {
    const out = {};
    main.querySelectorAll('.df-row[data-ch]').forEach(row => {
      if (!DEF_BY[row.dataset.dk] || !this.validate(row)) return;
      out[row.dataset.dk] = this._rowValue(row);
    });
    if (main.querySelector('.df-row.bad')) {
      Toast.show('Проверьте значения — отмечены красным');
      return;
    }
    this.save(main, out, 'Значения сохранены — действуют для новых КП и расчётов');
  }

  /**
   * Есть ли несохранённые строки.
   * @param {HTMLElement} main
   * @returns {boolean}
   */
  static changed(main) {
    return !!main.querySelector('.df-row[data-ch]');
  }

  /**
   * Проверка числа строки: подсветка и текст ошибки.
   * @param {HTMLElement} row
   * @returns {boolean} верно
   */
  static validate(row) {
    const input = row.querySelector('[data-dv]');
    const enabled = row.querySelector('[data-don]').checked;
    const error = enabled && input ? DefRegistry.check(row.dataset.dk, input.value) : '';
    row.classList.toggle('bad', !!error);
    const label = row.querySelector('.df-err');
    label.hidden = !error;
    label.textContent = error ? `Ошибка: ${error}` : '';
    return !error;
  }

  /**
   * Сохранить значения и перерисовать.
   * @param {HTMLElement} main
   * @param {object} values
   * @param {string} msg
   */
  static async save(main, values, msg) {
    try {
      const reply = await AdminApi.post('defaults', { values });
      DefRegistry.srv = reply.values || {};
      try {
        localStorage.setItem(this.STORE, JSON.stringify(DefRegistry.srv));
      } catch {
        // без хранилища браузера
      }
      Toast.show(msg);
      this.render(main);
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
    }
  }
}
