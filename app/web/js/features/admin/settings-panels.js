import { AdminNav } from './admin-nav.js';
import { DefaultsTab } from './defaults-tab.js';
import { ListsPanel } from './lists-panel.js';
import { SettingsWindow } from './settings-window.js';
import { StNav, StRefresh, StVal } from './settings-tools.js';
import { EquipTypes } from '../../core/equip-types.js';
import { LISTS } from '../../core/lists.js';
import { FEAT } from '../../core/features.js';
import { DEF_SCHEMA } from '../../core/defaults.js';
import { UiTexts } from '../kp/ui-texts.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { Fmt } from '../../core/str.js';
import { $, esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/** История изменений настроек с откатом (сервер: app/settings_history.py). */
export class SettingsHistoryPanel {
  static filter = ''; // вкладка, по которой отфильтрована история (кнопка «История» в заголовке вкладки)
  // вкладки, у которых есть история (прежние ключи записей истории сводятся через AdminNav.key)
  static TABS = {
    params: 'Параметры программы',
    types: 'Категории оборудования',
    carriers: 'Перевозчики и тарифы',
    mail: 'Почта',
    feeds: 'Фиды поставщиков',
    managers: 'Вход менеджеров',
    moderation: 'Модерация правок',
    services: 'Нейросеть',
    backup: 'База и копии',
  };
  static SHOWN_PATHS = 4;

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
  }

  /** Загрузить историю и показать. */
  async open() {
    let reply = null;
    try {
      reply = await AdminApi.get('history?limit=500');
    } catch (error) {
      this.main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    this.items = reply.items || [];
    this.render();
    this.bind();
  }

  static _key() {
    return SettingsHistoryPanel.filter && AdminNav.key(SettingsHistoryPanel.filter);
  }

  /**
   * Записи по выбранному разделу.
   * @returns {object[]}
   */
  list() {
    const key = SettingsHistoryPanel._key();
    return key ? this.items.filter(row => AdminNav.key(row.tab) === key) : this.items;
  }

  /** Показать список. */
  render() {
    const key = SettingsHistoryPanel._key();
    const rows = this.list();
    const options = Object.entries(SettingsHistoryPanel.TABS)
      .map(([tab, label]) => `<option value="${tab}"${key === tab ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
    this.main.innerHTML = `<div class="st-card"><div class="row" style="gap:8px;flex-wrap:wrap"><label class="f" style="margin:0"><span>Раздел</span><select id="shF" data-nodirty>
        <option value="">Все разделы</option>${options}</select></label>
        <span class="sp"></span><span class="muted">Записей: ${rows.length}</span></div>
      <p class="muted">Каждое сохранение настроек: что было и что стало, кто изменил. «Вернуть как было» отменяет только эту правку — более поздние изменения других полей остаются. Пароли и ключи API в историю не попадают.</p></div>
      <div class="st-card">${rows.length ? rows.map(row => this._row(row)).join('') : '<p class="empty">Изменений пока нет. История ведётся с версии 3.47.0.</p>'}</div>`;
  }

  _row(row) {
    const shown = SettingsHistoryPanel.SHOWN_PATHS;
    const paths = row.paths
      .slice(0, shown)
      .map(path => StVal.path(path))
      .join('; ');
    return `<div class="st-row sh-r" data-shid="${row.id}"><div><b>${esc(row.title)}</b>
          <span class="muted">${esc(Fmt.dateTime(row.ts))} · ${esc(row.by || '')} · ${row.count} ${KPGen.plural(row.count, 'поле', 'поля', 'полей')}${row.rolled ? ` · <b class="ok-t">возвращено ${esc(Fmt.dateTime(row.rolled))}</b>` : ''}</span>
          <span class="muted sh-p">${esc(paths)}${row.paths.length > shown ? '…' : ''}</span></div>
          <div class="acts"><button class="btn" type="button" data-shopen="${row.id}">Подробнее</button></div></div>`;
  }

  /**
   * Подробности правки: «было / стало / сейчас», открыть вкладку, вернуть как было.
   * @param {string} id
   */
  async details(id) {
    let entry = null;
    try {
      entry = await AdminApi.get(`history/${id}`);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    const choice = await Modal.ask(this._details(entry));
    if (choice === 'go') {
      StNav.select(entry.tab);
      SettingsWindow.tab();
      return;
    }
    if (choice !== 'back') return;
    try {
      await AdminApi.get(`history/${id}/rollback`, { method: 'POST' });
      Toast.show(`Возвращено как было: ${entry.title}`);
      await StRefresh.all();
    } catch (error) {
      Toast.show(`Не возвращено: ${error.message || error}`);
    }
    this.open();
  }

  _details(entry) {
    const later = entry.diff.some(row => row.later);
    const rows = entry.diff
      .map(
        row =>
          `<tr${row.later ? ' class="sh-later"' : ''}><td>${esc(StVal.path(row.path))}</td><td data-l="Было" title="${esc(StVal.full(row.before))}">${esc(StVal.text(row.before))}</td><td data-l="Стало" title="${esc(StVal.full(row.after))}">${esc(StVal.text(row.after))}</td><td data-l="Сейчас" title="${esc(StVal.full(row.now))}">${esc(StVal.text(row.now))}</td></tr>`,
      )
      .join('');
    return `<h3>${esc(entry.title)}</h3><p class="muted">${esc(Fmt.dateTime(entry.ts))} · ${esc(entry.by || '')}${entry.rolled ? ` · уже возвращалось ${esc(Fmt.dateTime(entry.rolled))}` : ''}</p>
      <div class="sh-tw"><table class="pv-t sh-t"><thead><tr><th>Поле</th><th>Было</th><th>Стало</th><th>Сейчас</th></tr></thead><tbody>
      ${rows}</tbody></table></div>
      ${later ? '<p class="msg warn" style="text-align:left">Отмеченные поля после этого меняли ещё раз — откат вернёт им значение «Было».</p>' : ''}
      <div class="row"><button class="btn" type="button" data-v="0">Закрыть</button><button class="btn ghost" type="button" data-v="go">Открыть вкладку</button><button class="btn primary" type="button" data-v="back">Вернуть как было</button></div>`;
  }

  /** События панели. */
  bind() {
    this.main.onchange = event => {
      if (event.target.id !== 'shF') return;
      SettingsHistoryPanel.filter = event.target.value;
      this.render();
    };
    this.main.onclick = event => {
      const button = event.target.closest('[data-shopen]');
      if (button) this.details(button.dataset.shopen);
    };
  }
}

/** Проверка всех подключений одной кнопкой (app/connections.py). */
export class ConnectionsPanel {
  static ICON = {
    ok: ['✓', 'работает', 'ok-t'],
    warn: ['!', 'есть замечания', 'warn-t'],
    fail: ['✕', 'не работает', 'bad-t'],
    off: ['—', 'не настроено', 'muted'],
  };
  static SLOW_MS = 1000;

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
  }

  /** Последняя проверка — показать. */
  async open() {
    this.reply = await AdminApi.get('connections');
    this.render();
    this.bind();
  }

  _row(row) {
    const [icon, label, cls] = ConnectionsPanel.ICON[row.status] || ConnectionsPanel.ICON.fail;
    const time =
      row.ms >= ConnectionsPanel.SLOW_MS
        ? ` · ${(row.ms / ConnectionsPanel.SLOW_MS).toFixed(1).replace('.', ',')} с`
        : '';
    return `<tr><td class="cn-s ${cls}" title="${label}"><b aria-hidden="true">${icon}</b> ${label}</td><td><b>${esc(row.name)}</b><small class="muted">${esc(row.group)}${time}</small></td>
        <td>${esc(row.msg || '')}</td><td>${row.status === 'ok' ? '' : `<button class="btn ghost sm" type="button" data-sttab="${esc(row.tab)}">Настроить</button>`}</td></tr>`;
  }

  /**
   * Показать.
   * @param {{busy?: boolean}} [opts] busy — идёт проверка
   */
  render({ busy = false } = {}) {
    const reply = this.reply || {};
    const items = reply.items || [];
    const count = status => items.filter(row => row.status === status).length;
    const totals = items.length
      ? `<span class="muted">работает: <b class="ok-t">${count('ok')}</b> · замечания: <b class="warn-t">${count('warn')}</b> · не работает: <b class="bad-t">${count('fail')}</b> · не настроено: ${count('off')}</span>`
      : '';
    this.main.innerHTML = `<div class="st-card"><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-cnrun${busy ? ' disabled' : ''}>${busy ? 'Проверяю… до 45 секунд' : 'Проверить всё'}</button>
        <span class="muted">${reply.at ? `Проверено ${esc(Fmt.dateTime(reply.at))}` : 'Ещё не проверялось'}</span><span class="sp"></span>
        ${totals}</div>
      <p class="muted">Почта — только вход на сервер, письмо не отправляется. Нейросеть — короткий запрос (несколько токенов). Checko — показывается остаток лимита, запросы не тратятся. Перевозчики — пробный расчёт 300 кг Москва → Санкт-Петербург. Фиды — доступность адреса прайса.</p></div>
      ${items.length ? `<div class="st-card"><div class="ac-tw"><table class="pv-t cn-t"><tbody>${items.map(row => this._row(row)).join('')}</tbody></table></div></div>` : ''}`;
  }

  /** «Проверить всё». */
  bind() {
    this.main.onclick = async event => {
      if (!event.target.closest('[data-cnrun]')) return;
      this.render({ busy: true });
      try {
        this.reply = await AdminApi.get('connections', { method: 'POST' });
      } catch (error) {
        Toast.show(`Проверка не выполнена: ${error.message || error}`);
      }
      this.render();
    };
  }
}

/** Всё, что отличается от встроенного, одним списком с «↺ вернуть». */
export class ChangedPanel {
  static WHO = { admin: 'только администратору', users: 'выбранным менеджерам' };

  /**
   * Панель.
   * @param {HTMLElement} main
   */
  constructor(main) {
    this.main = main;
  }

  /** Загрузить настройки и показать изменённое. */
  async open() {
    const [defaults, features, lists, mirror] = await Promise.all([
      AdminApi.get('defaults'),
      AdminApi.get('features'),
      AdminApi.get('lists'),
      AdminApi.get('maint/mirror').catch(() => null),
    ]);
    await UiTexts.load();
    this.vals = defaults.values || {};
    this.feat = features.config || {};
    this.lists = lists.values || {};
    this.mirror = mirror;
    this.render();
    this.bind();
  }

  // выбор из списка — подписью варианта, а не его кодом
  static _text(type, opts, value) {
    if (type !== 'select') return String(value ?? '');
    return String((DefaultsTab.optsOf(opts).find(([code]) => String(code) === String(value)) || [, value])[1] ?? '');
  }

  static _now(type, value, builtin, text) {
    if (type === 'bool') return (value.on ?? builtin) ? 'да' : 'нет';
    return value.on === false ? 'выключено' : text(value.v);
  }

  static _was(type, builtin, text) {
    if (type === 'bool') return builtin ? 'да' : 'нет';
    return builtin == null ? '—' : text(builtin);
  }

  /**
   * Изменённые значения программы.
   * @returns {object[]}
   */
  defRows() {
    return DEF_SCHEMA.filter(([key]) => this.vals[key] != null)
      .map(([key, , label, type, builtin, opts = {}]) => {
        const value = this.vals[key];
        const text = raw => ChangedPanel._text(type, opts, raw);
        const now = ChangedPanel._now(type, value, builtin, text);
        const was = ChangedPanel._was(type, builtin, text);
        return { label, now, was, reset: { defaults: key }, tab: 'defaults', focus: `[data-dk="${CSS.escape(key)}"]` };
      })
      .filter(row => row.now !== row.was);
  }

  /**
   * Выключенные и ограниченные функции.
   * @returns {object[]}
   */
  featRows() {
    return FEAT.defs
      .filter(def => {
        const conf = this.feat[def.key];
        return conf && (conf.on === false || (conf.who && conf.who !== 'all'));
      })
      .map(def => {
        const conf = this.feat[def.key];
        const now = conf.on === false ? 'выключено' : `доступ: ${ChangedPanel.WHO[conf.who] || conf.who}`;
        return {
          label: def.label,
          now,
          was: 'включено для всех',
          reset: { features: def.key },
          tab: 'features',
          focus: `[data-ft="${CSS.escape(def.key)}"]`,
        };
      });
  }

  /**
   * Изменённые списки.
   * @returns {object[]}
   */
  listRows() {
    return [...LISTS.defs.values()]
      .filter(def => this.lists[def.key] != null)
      .map(def => ({
        label: def.label,
        now: StVal.text(this.lists[def.key]),
        was: StVal.text(def.builtin),
        reset: { lists: def.key },
        tab: 'lists',
        before: () => {
          ListsPanel.last = def.key;
        },
      }));
  }

  /**
   * Тексты, категории, вторая папка.
   * @returns {object[]}
   */
  otherRows() {
    const out = [];
    const texts = Object.keys(UiTexts.state.map || {}).length;
    if (texts)
      out.push({ label: 'Тексты интерфейса', now: `заменено: ${texts}`, was: 'исходные надписи', tab: 'texts' });
    const types = EquipTypes.user();
    if (types.length)
      out.push({
        label: 'Категории оборудования',
        now: `своих и изменённых: ${types.length}`,
        was: 'встроенные',
        tab: 'types',
      });
    if (this.mirror && this.mirror.on)
      out.push({ label: 'Вторая папка для копий базы', now: this.mirror.path, was: 'не задана', tab: 'backup' });
    return out;
  }

  /** Показать. */
  render() {
    const sections = [
      ['Значения программы', this.defRows()],
      ['Функции программы', this.featRows()],
      ['Списки и выборы', this.listRows()],
      ['Другое', this.otherRows()],
    ];
    this.rows = sections.flatMap(([, rows]) => rows);
    let index = 0;
    const row = entry => {
      const k = index++;
      return `<tr><td><b>${esc(entry.label)}</b></td><td data-l="Сейчас">${esc(entry.now)}</td><td class="muted" data-l="Встроенное">${esc(entry.was)}</td><td class="acts"><button class="btn ghost sm" type="button" data-chgo="${k}">Открыть</button>${entry.reset ? `<button class="icon" type="button" data-chrs="${k}" title="Вернуть встроенное" aria-label="Вернуть встроенное">↺</button>` : ''}</td></tr>`;
    };
    const total = this.rows.length;
    const cards = sections
      .map(([title, rows]) =>
        rows.length
          ? `<div class="st-card"><p class="sub">${esc(title)} · ${rows.length}</p><div class="ac-tw"><table class="pv-t ch-t"><thead><tr><th>Настройка</th><th>Сейчас</th><th>Встроенное</th><th></th></tr></thead><tbody>
        ${rows.map(row).join('')}</tbody></table></div></div>`
          : '',
      )
      .join('');
    this.main.innerHTML = `<div class="st-card"><p class="muted" style="margin:0">Всё, что настроено «под себя», — отличается от встроенного в программу. «↺» — вернуть встроенное значение (правка попадёт в историю, её можно отменить). Изменено: <b>${total}</b>.</p></div>
      ${cards}
      ${total ? '' : '<p class="empty">Всё как в программе — изменённых настроек нет.</p>'}`;
  }

  /**
   * Вернуть встроенное.
   * @param {object} entry
   */
  async reset(entry) {
    if (
      !(await AdminDialog.confirm(
        'Вернуть встроенное?',
        `«${entry.label}» — станет как в программе: ${entry.was}.`,
        'Вернуть',
      ))
    )
      return;
    const [kind, key] = Object.entries(entry.reset)[0];
    try {
      await AdminApi.post(kind, { values: { [key]: null } });
      Toast.show(`Возвращено встроенное: ${entry.label}`);
      await StRefresh.all();
    } catch (error) {
      Toast.show(`Не возвращено: ${error.message || error}`);
    }
    this.open();
  }

  /** «Открыть» и «↺». */
  bind() {
    this.main.onclick = async event => {
      const open = event.target.closest('[data-chgo]');
      const reset = event.target.closest('[data-chrs]');
      if (reset) {
        this.reset(this.rows[+reset.dataset.chrs]);
        return;
      }
      if (!open) return;
      const entry = this.rows[+open.dataset.chgo];
      if (entry.before) entry.before();
      StNav.select(entry.tab);
      await SettingsWindow.tab();
      StNav.highlight(entry.focus, entry.label);
    };
  }
}

/** Письма администратору о проблемах сервера (app/admin_alerts.py) — карточка во вкладке «Почта». */
export class AlertsCard {
  /**
   * Карточка.
   * @param {HTMLElement} box
   */
  constructor(box) {
    this.box = box;
  }

  /**
   * Загрузить и показать.
   * @param {{t: string, err?: boolean}} [note]
   */
  async open(note) {
    if (!this.box) return;
    try {
      this.state = await AdminApi.get('alerts');
    } catch (error) {
      this.box.innerHTML = `<p class="sub">Письма о проблемах</p><p class="muted">${esc(error.message || error)}</p>`;
      return;
    }
    this.box.innerHTML = this._html(this.state, note);
    this.bind();
  }

  _html(state, note) {
    const last = state.last;
    const sent = last
      ? `Последнее письмо: ${esc(Fmt.dateTime(last.at))}${last.test ? ' (пробное)' : ''} — ${last.ok ? '<span class="ok-t">отправлено</span>' : `<span class="bad-t">не отправлено: ${esc(last.error || '')}</span>`}`
      : 'Писем ещё не было.';
    return `<div class="row"><p class="sub" style="margin:0">Письма администратору о проблемах</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="alOn"${state.on ? ' checked' : ''} data-nodirty><span>${state.on ? 'включены' : 'выключены'}</span></label></div>
      <p class="muted">Программа сама пришлёт письмо, если копия базы не сделалась или вторая папка не обновляется, на диске мало места, обновление не запустилось,
        задача Планировщика настроена не для сервера или в журнале сервера появились ошибки. Письмо — когда проблема появилась и раз в сутки, пока она не решена.</p>
      ${state.mailOn ? '' : '<p class="msg warn">Сначала настройте почтовый сервер выше — письма уходят через него.</p>'}
      ${note ? `<p class="msg ${note.err ? 'err' : 'ok'}" style="text-align:left">${esc(note.t)}</p>` : ''}
      <label class="f"><span>Кому (до 5 адресов через запятую)</span><input type="text" id="alTo" value="${esc(state.to)}" placeholder="admin@company.ru" autocomplete="off"></label>
      <p class="muted" style="margin:6px 0">${sent}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-al="save" data-autosave>Сохранить</button>
        <button class="btn" type="button" data-al="test"${state.mailOn && state.to ? '' : ' disabled'}>Отправить пробное письмо</button></div>`;
  }

  /**
   * Тело сохранения.
   * @param {boolean} enabled включены ли письма
   * @returns {object}
   */
  body(enabled) {
    return { on: enabled, to: this.box.querySelector('#alTo').value.trim() };
  }

  /** Переключатель и кнопки. */
  bind() {
    this.box.onchange = async event => {
      if (event.target.id !== 'alOn') return;
      try {
        await AdminApi.post('alerts', this.body(event.target.checked));
        this.open({ t: event.target.checked ? 'Письма о проблемах включены' : 'Письма о проблемах выключены' });
      } catch (error) {
        this.open({ t: error.message || String(error), err: true });
      }
    };
    this.box.onclick = event => this._click(event);
  }

  async _click(event) {
    const button = event.target.closest('[data-al]');
    if (!button) return;
    try {
      if (button.dataset.al === 'save') {
        await AdminApi.post('alerts', this.body(this.box.querySelector('#alOn').checked));
        this.open({ t: 'Сохранено' });
        return;
      }
      if (button.dataset.al !== 'test') return;
      button.disabled = true;
      button.textContent = 'Отправляю…';
      await AdminApi.post('alerts/test', {});
      this.open({ t: 'Пробное письмо отправлено' });
    } catch (error) {
      this.open({ t: error.message || String(error), err: true });
    }
  }
}

/** Вторая папка для копий базы (app/backup_mirror.py) — карточка во вкладке «База и копии». */
export class MirrorCard {
  static POLL_MS = 2500;
  static KEEP = 14;

  /**
   * Карточка.
   * @param {HTMLElement} box
   */
  constructor(box) {
    this.box = box;
    this.timer = 0;
  }

  /** Загрузить и показать. */
  async open() {
    try {
      this.state = await AdminApi.get('maint/mirror');
    } catch (error) {
      this.box.innerHTML = `<p class="muted">${esc(error.message || error)}</p>`;
      return;
    }
    this.render();
    this.bind();
    this.poll();
  }

  _last() {
    const last = this.state.last || {};
    if (!last.at) return '<span class="muted">копий ещё не было</span>';
    if (!last.ok) return `<b class="bad-t">✕ ${esc(Fmt.dateTime(last.at))}: ${esc(last.error || 'ошибка')}</b>`;
    return `<b class="ok-t">✓ ${esc(Fmt.dateTime(last.at))}</b>${last.bytes ? ` · ${Fmt.size(last.bytes)}` : ''}${last.images ? ` · изображений: ${Fmt.num(last.images.total)}, новых скопировано: ${Fmt.num(last.images.copied)}` : ''}`;
  }

  /**
   * Показать.
   * @param {{t: string, err?: boolean}} [note]
   */
  render(note) {
    const state = this.state;
    this.box.innerHTML = `<div class="row"><p class="sub" style="margin:0">Вторая папка для копий базы</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="mbOn"${state.on ? ' checked' : ''} data-nodirty><span>${state.on ? 'включена' : 'выключена'}</span></label></div>
      <p class="muted">Копии в data\\backup лежат на том же диске, что и база: откажет диск — пропадёт всё. Укажите вторую папку на другом устройстве: сетевой диск (\\\\сервер\\копии), флешку или папку Яндекс Диска / OneDrive. Каждый день после обычной копии архив базы (ZIP) копируется туда и проверяется.</p>
      ${note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : ''}
      ${FEAT.on('davBackup') ? `<div class="seg" role="radiogroup" aria-label="Куда копировать">${this._kindBtn('folder', 'Папка (сетевой диск, флешка)')}${this._kindBtn('dav', 'Яндекс Диск')}</div>` : ''}
      ${this._where()}
      <p>Последняя копия: ${state.running ? '<b>идёт копирование…</b>' : this._last()}${state.copies ? ` · в папке копий: ${state.copies} (${Fmt.size(state.copiesBytes)})` : ''}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-mb="save">Сохранить</button><button class="btn" type="button" data-mb="check">${state.kind === 'dav' ? 'Проверить диск' : 'Проверить папку'}</button>
        <button class="btn" type="button" data-mb="run"${state.on && !state.running ? '' : ' disabled'}>Копировать сейчас</button></div>`;
  }

  _kindBtn(kind, label) {
    const chosen = (this.state.kind || 'folder') === kind;
    return `<button type="button" role="radio" aria-checked="${chosen}" class="${chosen ? 'on' : ''}" data-mbkind="${kind}">${label}</button>`;
  }

  _where() {
    const state = this.state;
    const keep = `<label class="f"><span>Хранить копий (последних дней)</span><input type="number" id="mbKeep" min="1" max="365" value="${esc(state.keep || MirrorCard.KEEP)}"></label>`;
    if (state.kind === 'dav' && FEAT.on('davBackup')) {
      const dav = state.dav || {};
      return `<p class="muted">Логин Яндекса и <b>пароль приложения</b> (id.yandex.ru → Безопасность → Пароли приложений → «Файлы»). На диск копируется архив базы (ZIP), размер сверяется после загрузки; изображения и документы — только в папку.</p>
      <div class="grid g2"><label class="f"><span>Логин Яндекса</span><input type="text" id="mbLogin" value="${esc(dav.login || '')}" autocomplete="off"></label>
        <label class="f"><span>Пароль приложения</span><input type="password" id="mbPass" value="${esc(dav.password || '')}" autocomplete="new-password"></label>
        <label class="f"><span>Папка на диске</span><input type="text" id="mbFolder" value="${esc(dav.folder || 'Копии КП')}"></label>${keep}</div>`;
    }
    return `<div class="grid g2"><label class="f"><span>Папка</span><input type="text" id="mbPath" value="${esc(state.path || '')}" placeholder="D:\\Копии КП или \\\\сервер\\копии" autocomplete="off"></label>
        ${keep}</div>
      <label class="ck"><input type="checkbox" id="mbImg"${state.images ? ' checked' : ''}> Копировать туда и изображения каталога (только новые и изменённые)</label>`;
  }

  /**
   * Тело сохранения.
   * @returns {object}
   */
  body() {
    const value = id => ($(id) ? $(id).value.trim() : '');
    const dav = {
      login: value('#mbLogin'),
      password: $('#mbPass') ? $('#mbPass').value : '',
      folder: value('#mbFolder'),
    };
    return {
      on: $('#mbOn').checked,
      kind: FEAT.on('davBackup') ? this.state.kind || 'folder' : 'folder',
      path: value('#mbPath'),
      keep: +$('#mbKeep').value || MirrorCard.KEEP,
      images: !!($('#mbImg') && $('#mbImg').checked),
      dav,
    };
  }

  /** Идёт копирование — проверять, пока не закончится. */
  poll() {
    clearTimeout(this.timer);
    if (!this.state.running) return;
    this.timer = setTimeout(() => this._tick(), MirrorCard.POLL_MS);
  }

  async _tick() {
    if (!document.body.contains(this.box)) return;
    try {
      this.state = await AdminApi.get('maint/mirror');
    } catch {
      return;
    }
    const last = this.state.last;
    const ok = !!(last && last.ok);
    this.render(
      this.state.running
        ? null
        : { t: ok ? 'Копия во вторую папку готова' : `Копия не сделана: ${(last || {}).error || ''}`, err: !ok },
    );
    this.poll();
  }

  /** Переключатель и кнопки. */
  bind() {
    this.box.onchange = async event => {
      if (event.target.id !== 'mbOn') return;
      try {
        this.state = await AdminApi.post('maint/mirror', this.body());
        this.render({ t: this.state.on ? 'Вторая папка включена' : 'Вторая папка выключена' });
      } catch (error) {
        this.render({ t: error.message || String(error), err: true });
      }
    };
    this.box.onclick = event => this._click(event);
  }

  async _click(event) {
    const kind = event.target.closest('[data-mbkind]');
    if (kind) {
      this.state = { ...this.state, kind: kind.dataset.mbkind };
      this.render();
      return;
    }
    const button = event.target.closest('[data-mb]');
    if (!button) return;
    const action = button.dataset.mb;
    try {
      if (action === 'save') {
        this.state = await AdminApi.post('maint/mirror', { ...this.body(), on: true });
        this.render({ t: 'Сохранено. Копия будет делаться каждый день.' });
      }
      if (action === 'check') {
        const reply = await AdminApi.post('maint/mirror/check', this.body());
        this.render({
          t: `${this.state.kind === 'dav' ? 'Яндекс Диск доступен' : 'Папка доступна для записи'}${reply.free != null ? `, свободно ${Fmt.size(reply.free)}` : ''}.`,
        });
      }
      if (action === 'run') {
        this.state = await AdminApi.post('maint/mirror/run', {});
        this.render();
        this.poll();
      }
    } catch (error) {
      this.render({ t: error.message || String(error), err: true });
    }
  }
}
