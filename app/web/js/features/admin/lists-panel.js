import { AdminApi, AdminDialog } from './admin-core.js';
import { Managers } from '../kp/managers.js';
import { FEAT } from '../../core/features.js';
import { Debounce } from '../../core/debounce.js';
import { Api } from '../../core/net.js';
import { Str } from '../../core/str.js';
import { UiTexts } from '../kp/ui-texts.js';
import { FormView } from '../../ui/form-view.js';
import { Toast } from '../../core/toast.js';
import { $, esc } from '../../core/util.js';
import { LISTS } from '../../core/lists.js';

/** «Списки выбора»: слева — списки по группам, справа — строки выбранного (добавить, порядок, удалить, вернуть встроенный). */
export class ListsPanel {
  static last = '';
  static only = false; // фильтр «Только свои»

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
    this.key = ListsPanel.last || [...LISTS.defs.keys()][0];
    this.rows = null;
    this.dirty = false;
  }

  /**
   * Описание выбранного списка.
   * @returns {object}
   */
  def() {
    return LISTS.get(this.key);
  }

  /** Строки выбранного списка — заново, без правок. */
  start() {
    this.rows = JSON.parse(JSON.stringify(LISTS.rows(this.key)));
    this.dirty = false;
  }

  /** Загрузить и показать. */
  async open() {
    const reply = await AdminApi.get('lists');
    LISTS.use(reply.values || {});
    LISTS.cache();
    this.start();
    this.render();
    this.bind();
  }

  /**
   * Список списков по группам.
   * @returns {string}
   */
  navHtml() {
    return LISTS.groups
      .map(group => {
        const defs = LISTS.inGroup(group.id);
        if (!defs.length) return '';
        const items = defs
          .map(
            def =>
              `<button type="button" class="ls-it${def.key === this.key ? ' on' : ''}${LISTS.isOwn(def.key) ? ' own' : ''}" data-lsk="${esc(def.key)}"><span>${esc(def.label)}</span>${LISTS.isOwn(def.key) ? '<i>свой</i>' : ''}</button>`,
          )
          .join('');
        return `<p class="ls-g">${esc(group.title)}</p>${items}`;
      })
      .join('');
  }

  /**
   * Ячейка строки.
   * @param {object} row
   * @param {number} index
   * @param {Array} col [поле, подпись, вид, параметры]
   * @returns {string}
   */
  cellHtml(row, index, [field, label, type, opts = {}]) {
    const value = row[field] == null ? '' : String(row[field]);
    if (type === 'area')
      return `<textarea rows="2" data-lsf="${field}" data-i="${index}" aria-label="${esc(label)}" placeholder="${esc(opts.ph || '')}">${esc(value)}</textarea>`;
    return `<input type="text" data-lsf="${field}" data-i="${index}" value="${esc(value)}" aria-label="${esc(label)}" placeholder="${esc(opts.ph || '')}"${type === 'num' ? ' inputmode="decimal"' : ''}>`;
  }

  _rowHtml(def, row, index) {
    const cells = def.cols.map(col => this.cellHtml(row, index, col)).join('');
    return `<div class="ls-r"><span class="ls-n">${index + 1}</span>${cells}
        <span class="ls-a"><button type="button" class="icon" data-lsm="-1" data-i="${index}" title="Выше" aria-label="Выше"${index ? '' : ' disabled'}>↑</button><button type="button" class="icon" data-lsm="1" data-i="${index}" title="Ниже" aria-label="Ниже"${index < this.rows.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="icon" data-lsdel data-i="${index}" title="Удалить строку" aria-label="Удалить строку">✕</button></span></div>`;
  }

  /**
   * Таблица строк.
   * @returns {string}
   */
  tableHtml() {
    const def = this.def();
    const wide = def.cols.length > 1;
    const widths = def.cols.map(col => (col[2] === 'area' ? 'minmax(220px,2fr)' : 'minmax(110px,1fr)')).join(' ');
    const heads = def.cols
      .map(([, label, , opts = {}]) => `<span>${esc(label)}${opts.req ? ' *' : ''}</span>`)
      .join('');
    return `<div class="ls-t${wide ? ' wide' : ''}" style="--ls-cols:${widths}">
      <div class="ls-h"><span>№</span>${heads}<span></span></div>
      ${this.rows.map((row, index) => this._rowHtml(def, row, index)).join('')}
    </div>`;
  }

  _status(own) {
    if (this.dirty) return 'Изменяется… сохранится, когда закончите ввод';
    return `${own ? 'Действует ваш список' : 'Действует встроенный список'} · изменения сохраняются сразу`;
  }

  /** Показать. */
  render() {
    const def = this.def();
    const own = LISTS.isOwn(this.key);
    const groupHint = (LISTS.groups.find(group => group.id === def.group) || {}).hint;
    const owned = [...LISTS.defs.keys()].filter(key => LISTS.isOwn(key)).length;
    this.main.innerHTML = `<div class="st-card"><p class="muted" style="margin:0">Варианты выпадающих меню и подсказок во всей программе.
        Изменения сохраняются сразу и видны всем пользователям; уже созданные КП не меняются. «Вернуть встроенный» — список, как в программе.</p></div>
      <div class="ls${ListsPanel.only ? ' st-only' : ''}"><nav class="ls-nav" aria-label="Списки"><label class="ck st-own"><input type="checkbox" data-lsonly data-nodirty${ListsPanel.only ? ' checked' : ''}> Только свои (${owned})</label>${this.navHtml()}</nav>
        <section class="ls-ed"><div class="ls-hd"><h4>${esc(def.label)}${own ? ' <i class="ls-own">свой</i>' : ''}</h4>${def.hint ? `<p class="muted">${esc(def.hint)}</p>` : ''}
          ${groupHint ? `<p class="muted ls-gh">${esc(groupHint)}</p>` : ''}</div>
          ${this.tableHtml()}
          <button type="button" class="btn ls-add" data-lsadd>+ Добавить строку</button>
          <div class="df-bar ls-bar"><span class="muted" id="lsSt">${this._status(own)}</span>
            <button type="button" class="btn ghost" data-lsreset${own ? '' : ' disabled'}>Вернуть встроенный</button></div></section></div>`;
  }

  /** Есть несохранённые правки. */
  touch() {
    this.dirty = true;
    const status = $('#lsSt');
    if (status) status.textContent = this._status(false);
  }

  /**
   * Сохранить.
   * @param {object} values
   * @param {string} msg
   */
  async save(values, msg) {
    try {
      const reply = await AdminApi.post('lists', { values });
      LISTS.use(reply.values || {});
      LISTS.cache();
      const active = document.activeElement;
      const spot =
        active && active.dataset && active.dataset.lsf != null ? [active.dataset.lsf, active.dataset.i] : null;
      this.start();
      this.render();
      if (spot)
        this.main.querySelector(`[data-lsf="${CSS.escape(spot[0])}"][data-i="${CSS.escape(spot[1])}"]`)?.focus();
      Toast.show(msg);
      FormView.render();
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
    }
  }

  /** События панели. */
  bind() {
    const main = this.main;
    main.onchange = event => {
      if (event.target.dataset.lsf != null) {
        this._save();
        return;
      }
      if (!event.target.matches('[data-lsonly]')) return;
      ListsPanel.only = event.target.checked;
      main.querySelector('.ls').classList.toggle('st-only', ListsPanel.only);
    };
    main.oninput = event => {
      const input = event.target;
      if (input.dataset.lsf == null) return;
      this.rows[+input.dataset.i][input.dataset.lsf] = input.value;
      this.touch();
    };
    main.onclick = event => this._click(event.target);
  }

  async _click(target) {
    const pick = target.closest('[data-lsk]');
    if (pick) return this._pick(pick.dataset.lsk);
    if (target.closest('[data-lsadd]')) return this._add();
    const move = target.closest('[data-lsm]');
    if (move) return this._move(+move.dataset.i, +move.dataset.lsm);
    const drop = target.closest('[data-lsdel]');
    if (drop) {
      this.rows.splice(+drop.dataset.i, 1);
      return this._save();
    }
    if (target.closest('[data-lsreset]')) return this._reset();
    return undefined;
  }

  async _pick(key) {
    if (this.dirty && !(await AdminDialog.confirm('Не сохранено', 'Изменения в этом списке пропадут.', 'Перейти')))
      return;
    this.key = key;
    ListsPanel.last = key;
    this.start();
    this.render();
  }

  _add() {
    this.rows.push({});
    this.touch();
    this.render();
    this.main.querySelector('.ls-r:last-child [data-lsf]')?.focus();
  }

  _move(index, step) {
    const other = index + step;
    [this.rows[index], this.rows[other]] = [this.rows[other], this.rows[index]];
    this._save();
  }

  async _reset() {
    if (
      !(await AdminDialog.confirm(
        'Вернуть встроенный список?',
        `Ваши варианты «${this.def().label}» удалятся, будет действовать список программы.`,
        'Вернуть',
      ))
    )
      return;
    await this.save({ [this.key]: null }, 'Возвращён встроенный список');
  }

  _save() {
    this.dirty = false;
    const def = this.def();
    const rows = this.rows.map(row => def.clean(row)).filter(row => Object.keys(row).length);
    const error = def.validate(rows);
    if (error) {
      Toast.show(error);
      return undefined;
    }
    const same = JSON.stringify(rows) === JSON.stringify(def.builtin.map(row => def.clean(row)));
    return this.save(
      { [this.key]: same ? null : rows },
      same ? 'Список совпадает со встроенным — действует встроенный' : 'Список сохранён — действует у всех',
    );
  }
}

/** «Тексты интерфейса»: все заменённые надписи одним списком с поиском, правка и «Вернуть исходный». */
export class TextsPanel {
  static WAIT_MS = 200;
  static LINE = 50; // знаков в строке поля
  static MAX_ROWS = 4;

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
    this.q = '';
  }

  /** Загрузить и показать. */
  async open() {
    await UiTexts.load();
    this.render();
    this.bind();
  }

  /**
   * Замены, подходящие под поиск, по алфавиту.
   * @returns {Array<string[]>}
   */
  entries() {
    const query = Str.norm(this.q);
    return Object.entries(UiTexts.state.map)
      .filter(([source, text]) => !query || Str.norm(source).includes(query) || Str.norm(text).includes(query))
      .sort((first, second) => first[0].localeCompare(second[0], 'ru'));
  }

  _row([source, text]) {
    const rows = Math.min(TextsPanel.MAX_ROWS, Math.ceil(text.length / TextsPanel.LINE) + 1);
    return `<div class="tx-r" data-txk="${esc(source)}"><div class="tx-o"><small class="muted">Исходный</small><span>${esc(source)}</span></div>
            <label class="tx-n"><small class="muted">Сейчас</small><textarea rows="${rows}" data-txv aria-label="Новый текст">${esc(text)}</textarea></label>
            <div class="tx-a"><button type="button" class="btn sm" data-txsave hidden>Сохранить</button><button type="button" class="btn ghost sm" data-txdel>Вернуть исходный</button></div></div>`;
  }

  /** Показать. */
  render() {
    const all = Object.keys(UiTexts.state.map).length;
    const list = this.entries();
    const body = list.length
      ? `<div class="tx-l" data-uit-skip>${list.map(entry => this._row(entry)).join('')}</div>`
      : `<p class="empty">${all ? 'Ничего не найдено.' : 'Тексты не менялись — везде исходные надписи программы.'}</p>`;
    this.main.innerHTML = `<div class="st-card"><p class="muted" style="margin:0 0 10px">Названия разделов и кнопок, подписи полей, подсказки — как их видят все пользователи. Новую замену удобнее сделать прямо на экране:
        «Править на экране» → карандаш у надписи. Здесь — все замены сразу: изменить или вернуть исходный текст.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-txon>✎ Править на экране</button>
          <input type="search" id="txQ" placeholder="Поиск по тексту" value="${esc(this.q)}" autocomplete="off" style="flex:1 1 220px" aria-label="Поиск по тексту"></div></div>
      <div class="st-card"><p class="sub">Заменено текстов: ${all}${this.q ? ` · найдено: ${list.length}` : ''}</p>
        ${body}</div>`;
  }

  /**
   * Сохранить замены на сервере и применить на экране.
   * @param {object} map все замены
   * @param {object} back что вернуть на экране
   * @param {string} msg
   */
  async put(map, back, msg) {
    const old = UiTexts.state.map;
    UiTexts.state.map = map;
    try {
      await Api.request('/api/uitexts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(map),
      });
    } catch (error) {
      UiTexts.state.map = old;
      Toast.show(`Не сохранено: ${error.message || error}`);
      return;
    }
    UiTexts.index();
    UiTexts.apply(document.body, back);
    UiTexts.apply(document.body);
    Toast.show(msg);
    this.render();
  }

  /** События панели. */
  bind() {
    const timer = new Debounce(TextsPanel.WAIT_MS);
    this.main.oninput = event => {
      if (event.target.id !== 'txQ') return;
      const value = event.target.value;
      timer.run(() => this._search(value));
    };
    this.main.onchange = event => {
      const row = event.target.closest('.tx-r');
      if (row && event.target.matches('[data-txv]')) this._click(row.querySelector('[data-txsave]'));
    };
    this.main.onclick = event => this._click(event.target);
  }

  _search(value) {
    this.q = value;
    this.render();
    const find = $('#txQ');
    find.focus();
    find.setSelectionRange(find.value.length, find.value.length);
  }

  _click(target) {
    if (target.closest('[data-txon]')) {
      $('#setdlg')?.close();
      return UiTexts.startEdit();
    }
    const row = target.closest('.tx-r');
    if (!row) return undefined;
    const source = row.dataset.txk;
    const map = { ...UiTexts.state.map };
    const back = { [UiTexts.norm(map[source])]: source };
    if (target.closest('[data-txdel]')) {
      delete map[source];
      return this.put(map, back, 'Возвращён исходный текст');
    }
    if (!target.closest('[data-txsave]')) return undefined;
    const text = UiTexts.norm(row.querySelector('[data-txv]').value);
    if (!text) return Toast.show('Текст не может быть пустым — «Вернуть исходный»');
    if (text === source) delete map[source];
    else map[source] = text;
    return this.put(map, back, 'Текст изменён');
  }
}

/** «Функции программы»: включить и выключить дополнительные функции и выбрать, кому они доступны. */
export class FeaturesPanel {
  static only = false; // фильтр «Только изменённые»
  static WHO = [
    ['all', 'Всем'],
    ['admin', 'Только администратору'],
    ['users', 'Выбранным менеджерам'],
  ];

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
    this.cfg = {};
  }

  /** Загрузить и показать. */
  async open() {
    const reply = await AdminApi.get('features');
    this.cfg = reply.config || {};
    await FEAT.load();
    this.render();
    this.bind();
  }

  /**
   * Настройка функции (по умолчанию — включена для всех).
   * @param {string} key
   * @returns {{on: boolean, who: string, users: string[]}}
   */
  conf(key) {
    return this.cfg[key] || { on: true, who: 'all', users: [] };
  }

  /**
   * Кому доступна — подпись для строки.
   * @param {object} conf
   * @returns {string}
   */
  whoText(conf) {
    if (conf.who === 'admin') return 'только администратору';
    if (conf.who !== 'users') return 'всем';
    const names = conf.users.map(id => (Managers.list.find(manager => manager.id === id) || {}).name).filter(Boolean);
    return names.length ? `администратору и: ${names.join(', ')}` : 'только администратору (менеджеры не выбраны)';
  }

  /**
   * Функция настроена не как в программе (выключена или открыта не всем).
   * @param {string} key
   * @returns {boolean}
   */
  changed(key) {
    const conf = this.cfg[key];
    return !!conf && (conf.on === false || (conf.who && conf.who !== 'all'));
  }

  _users(key, conf) {
    if (!Managers.list.length) return '<span class="muted">Менеджеров нет — добавьте их в разделе «Менеджеры».</span>';
    return Managers.list
      .map(
        manager =>
          `<label class="ft-u"><input type="checkbox" data-ftu="${key}" value="${esc(manager.id)}"${conf.users.includes(manager.id) ? ' checked' : ''}> ${esc(manager.name || manager.id)}</label>`,
      )
      .join('');
  }

  _who(key, conf) {
    const options = FeaturesPanel.WHO.map(
      ([value, title]) => `<option value="${value}"${conf.who === value ? ' selected' : ''}>${title}</option>`,
    ).join('');
    return `<div class="ft-who"><label>Кому <select class="f" data-ftwho="${key}">${options}</select></label>
      ${conf.who === 'users' ? `<div class="ft-users">${this._users(key, conf)}</div>` : ''}
      ${conf.who !== 'all' ? `<span class="ft-off">Доступно ${esc(this.whoText(conf))}; остальные её не видят.</span>` : ''}</div>`;
  }

  /**
   * Строка функции.
   * @param {object} def
   * @returns {string}
   */
  row(def) {
    const conf = this.conf(def.key);
    const enabled = conf.on;
    const changed = this.changed(def.key);
    const need = def.needs && !this.conf(def.needs).on ? FEAT.get(def.needs) : null;
    const key = esc(def.key);
    const reset = changed
      ? ` <i class="st-mod">изменено</i> <button type="button" class="icon ft-rs" data-ftrs="${key}" title="Вернуть как в программе: включено для всех" aria-label="Вернуть встроенное">↺</button>`
      : '';
    return `<div class="ft-r${enabled ? '' : ' off'}${changed ? ' own' : ''}"><label class="sw ft-sw"><input type="checkbox" data-ft="${key}"${enabled ? ' checked' : ''}><span>${enabled ? 'включено' : 'выключено'}</span></label>
      <div><b>${esc(def.label)}</b>${reset}<span class="muted">${esc(def.hint)}</span>${!enabled && def.off ? `<span class="ft-off">Выключено: ${esc(def.off)}</span>` : ''}${need ? `<span class="ft-off">Не работает: выключено «${esc(need.label)}»</span>` : ''}${enabled ? this._who(key, conf) : ''}</div></div>`;
  }

  /** Показать. */
  render() {
    this.main.classList.toggle('st-only', !!FeaturesPanel.only);
    const off = FEAT.defs.filter(def => !this.conf(def.key).on).length;
    const limited = FEAT.defs.filter(def => this.conf(def.key).on && this.conf(def.key).who !== 'all').length;
    const groups = FEAT.groups
      .map(group => {
        const defs = FEAT.defs.filter(def => def.group === group.id);
        return defs.length
          ? `<div class="st-card"><p class="sub">${esc(group.title)}</p><div class="ft-l">${defs.map(def => this.row(def)).join('')}</div></div>`
          : '';
      })
      .join('');
    this.main.innerHTML = `<div class="st-card"><p class="muted" style="margin:0">Включите только то, чем пользуется отдел, — лишние кнопки и окна пропадут. Функцию можно открыть всем, только
        администратору (видна после входа в «Настройки») или выбранным менеджерам. Недоступная функция закрыта и в обход интерфейса;
        её данные (статусы, расчёты, версии) не удаляются: включите снова — всё на месте.${off ? ` Выключено: <b>${off}</b>.` : ''}${limited ? ` С ограниченным доступом: <b>${limited}</b>.` : ''}</p>
        <label class="ck st-own"><input type="checkbox" data-ftonly data-nodirty${FeaturesPanel.only ? ' checked' : ''}> Только изменённые (${FEAT.defs.filter(def => this.changed(def.key)).length})</label></div>
      ${groups}
      <div class="row"><button class="btn ghost" type="button" data-ftall>Включить всё для всех</button></div>`;
  }

  /**
   * Сохранить.
   * @param {object} values
   * @param {string} msg
   */
  async save(values, msg) {
    try {
      const reply = await AdminApi.post('features', { values });
      this.cfg = reply.config || {};
      await FEAT.refresh();
      this.render();
      Toast.show(msg);
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
      this.render();
    }
  }

  /** События панели. */
  bind() {
    this.main.onchange = event => this._change(event.target);
    this.main.onclick = event => {
      const reset = event.target.closest('[data-ftrs]');
      if (reset) {
        const key = reset.dataset.ftrs;
        this.save({ [key]: null }, `«${FEAT.get(key).label}» — как в программе: включено для всех`);
        return;
      }
      if (event.target.closest('[data-ftall]'))
        this.save(Object.fromEntries(FEAT.defs.map(def => [def.key, null])), 'Все функции включены для всех');
    };
  }

  _change(target) {
    const data = target.dataset;
    if (target.matches('[data-ftonly]')) {
      FeaturesPanel.only = target.checked;
      this.main.classList.toggle('st-only', target.checked);
      return;
    }
    if (data.ft) {
      this.save(
        { [data.ft]: { ...this.conf(data.ft), on: target.checked } },
        `«${FEAT.get(data.ft).label}» — ${target.checked ? 'включено' : 'выключено'}`,
      );
      return;
    }
    if (data.ftwho) {
      const conf = { ...this.conf(data.ftwho), who: target.value };
      this.save({ [data.ftwho]: conf }, `«${FEAT.get(data.ftwho).label}» — доступно ${this.whoText(conf)}`);
      return;
    }
    if (!data.ftu) return;
    const conf = this.conf(data.ftu);
    const users = [...this.main.querySelectorAll(`[data-ftu="${CSS.escape(data.ftu)}"]:checked`)].map(box => box.value);
    this.save(
      { [data.ftu]: { ...conf, users } },
      `«${FEAT.get(data.ftu).label}» — доступно ${this.whoText({ ...conf, users })}`,
    );
  }
}
