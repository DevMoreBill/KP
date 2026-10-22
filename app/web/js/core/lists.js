import { TemplateFields } from '../features/doc/template-fields.js';
import { AiChat } from '../features/catalog/ai-chat.js';
import { DealTerms } from '../features/deal/deal-terms.js';
import { Kit } from '../features/kit/kit.js';
import { ContainerKind } from '../features/kit/container-kind.js';
import { CrmStages } from '../features/crm/crm-data.js';
import { KpTrack } from '../features/kp/kp-track.js';
import { ClientFields } from '../features/kp/client-store.js';
import { MailTemplates } from '../features/kp/mail-templates.js';

import { Api } from './net.js';
import { KpConditions } from './conditions.js';
// Списки и выборы: варианты выпадающих меню и подсказок, которые администратор правит в «Настройках → Списки и выборы»
// (сервер: app/lists.py, kv settings.lists = {ключ: [строки]}). Списки разделов с пометкой late подхватываются, когда
// раздел загрузился (LISTS.ready в его index.js). Встроенный вариант запоминается при запуске; свой вариант администратора подменяет
// содержимое массива на месте — формы, мастер и расчёты сразу видят новые пункты. Последний вариант хранится в браузере.
/**
 * Список: где он живёт в программе (target — массив, которым пользуются формы), как строка массива превращается в строку
 * таблицы и обратно, какие у неё поля.
 */
export class ListDef {
  static ID_RX = /^[a-z0-9_-]{1,30}$/;

  /**
   * @param {object} def {key, group, label, hint, cols: [[поле, подпись, тип ('text' | 'area' | 'num'), {req, id, unique,
   *   ph}]], target: () => массив, toRow, fromRow (строка → элемент | null), min — меньше строк нельзя, late — массив
   *   объявлен в ES-модуле (встроенный вариант запоминается в LISTS.ready)}
   */
  constructor(def) {
    Object.assign(this, { hint: '', min: 1, late: false }, def);
    this.builtin = this.late ? null : this.read();
  }

  /**
   * Строки таблицы из массива программы.
   * @returns {object[]}
   */
  read() {
    return this.target().map(item => this.toRow(item));
  }

  /**
   * Строки (null — встроенный вариант) → в массив программы на месте.
   * @param {object[] | null} rows
   */
  apply(rows) {
    const arr = this.target();
    const items = (rows || this.builtin).map(row => this.fromRow(row)).filter(item => item != null);
    if (items.length >= this.min) arr.splice(0, arr.length, ...items);
  }

  /**
   * Проверка перед сохранением: пустая строка — ошибка; поле-идентификатор — латиница, без повторов.
   * @param {object[]} rows
   * @returns {string} '' — верно, иначе текст ошибки
   */
  validate(rows) {
    if (rows.length < this.min)
      return `Нужно хотя бы ${this.min} ${KPGen.plural(this.min, 'значение', 'значения', 'значений')}`;
    for (const col of this.cols) {
      const error = this._cells(rows, col) || this._unique(rows, col);
      if (error) return error;
    }
    return '';
  }

  _cells(rows, [field, label, type, opts = {}]) {
    for (const [i, row] of rows.entries()) {
      const value = String(row[field] ?? '').trim();
      if (opts.req && !value) return `Строка ${i + 1}: заполните «${label}»`;
      if (type === 'num' && value && !Number.isFinite(parseFloat(value.replace(',', '.')))) {
        return `Строка ${i + 1}: «${label}» — число`;
      }
      if (opts.id && value && !ListDef.ID_RX.test(value))
        return `Строка ${i + 1}: «${label}» — латиница, цифры, «-» и «_»`;
    }
    return '';
  }

  _unique(rows, [field, label, , opts = {}]) {
    if (!opts.id && !opts.unique) return '';
    const seen = new Set();
    for (const row of rows) {
      const value = String(row[field] ?? '')
        .trim()
        .toLowerCase();
      if (!value) continue;
      if (seen.has(value)) return `«${label}»: «${row[field]}» повторяется`;
      seen.add(value);
    }
    return '';
  }

  /**
   * Строка таблицы без пустых полей; числа — числом.
   * @param {object} row
   * @returns {object}
   */
  clean(row) {
    const out = {};
    for (const [field, , type] of this.cols) {
      if (row[field] == null) continue;
      const value = String(row[field]).trim();
      if (value === '') continue;
      out[field] = type === 'num' ? parseFloat(value.replace(',', '.')) : value;
    }
    return out;
  }
}

/** Реестр списков: группы, встроенные и свои варианты администратора. */
export class ListRegistry {
  static STORE = 'kp.lists';

  constructor() {
    this.defs = new Map();
    this.srv = {};
    this.groups = [];
  }

  /**
   * @param {string} id
   * @param {string} title
   * @param {string} [hint]
   * @returns {ListRegistry}
   */
  group(id, title, hint = '') {
    this.groups.push({ id, title, hint });
    return this;
  }

  /**
   * @param {object} def
   * @returns {ListDef}
   */
  add(def) {
    const list = new ListDef(def);
    this.defs.set(list.key, list);
    return list;
  }

  /**
   * Список строк-«значений» (одно поле v).
   * @param {object} spec {key, group, label, target, hint, ...прочие поля ListDef (late, …)}
   * @returns {ListDef}
   */
  addStrings(spec) {
    const { key, group, label, target, hint, ...extra } = spec;
    return this.add({
      key,
      group,
      label,
      hint,
      target,
      cols: [['v', 'Значение', 'text', { req: true, unique: true }]],
      toRow: value => ({ v: String(value) }),
      fromRow: row => String(row.v || '').trim() || null,
      ...extra,
    });
  }

  /**
   * @param {string} key
   * @returns {ListDef | undefined}
   */
  get(key) {
    return this.defs.get(key);
  }

  /**
   * Списки группы.
   * @param {string} group
   * @returns {ListDef[]}
   */
  inGroup(group) {
    return [...this.defs.values()].filter(def => def.group === group);
  }

  /**
   * Действующие строки списка.
   * @param {string} key
   * @returns {object[]}
   */
  rows(key) {
    return this.srv[key] || this.defs.get(key).builtin;
  }

  /**
   * Свой ли вариант у списка.
   * @param {string} key
   * @returns {boolean}
   */
  isOwn(key) {
    return Array.isArray(this.srv[key]);
  }

  /**
   * Варианты администратора → в массивы программы (неизвестные ключи пропускаются).
   * @param {object} map
   */
  use(map) {
    this.srv = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    for (const def of this.defs.values()) this.applyDef(def);
  }

  /**
   * Подставить вариант списка (испорченный свой — встроенный).
   * @param {ListDef} def
   */
  applyDef(def) {
    if (def.builtin == null) return;
    try {
      def.apply(this.isOwn(def.key) ? this.srv[def.key] : null);
    } catch {
      def.apply(null);
    }
  }

  /**
   * Списки из ES-модуля: запомнить встроенный вариант и подставить свой (из браузера или сервера).
   * @param {string[]} keys
   */
  ready(keys) {
    for (const key of keys) {
      const def = this.defs.get(key);
      if (!def || def.builtin != null) continue;
      def.builtin = def.read();
      this.applyDef(def);
    }
  }

  /** Запомнить варианты в браузере. */
  cache() {
    try {
      localStorage.setItem(ListRegistry.STORE, JSON.stringify(this.srv));
    } catch {
      // без хранилища браузера
    }
  }

  /** Последний вариант из браузера (до ответа сервера). */
  fromCache() {
    try {
      this.use(JSON.parse(localStorage.getItem(ListRegistry.STORE) || '{}'));
    } catch {
      this.use({});
    }
  }

  /** Свежий вариант с сервера. */
  async load() {
    try {
      this.use(await Api.request('/api/lists'));
      this.cache();
    } catch {
      // сервер недоступен — вариант из браузера
    }
  }
}

export const LISTS = new ListRegistry()
  .group(
    'kp',
    'КП: условия и объект',
    'Варианты в выпадающих меню раздела «Условия» и подсказки в разделе «Клиент». Менеджер всегда может вписать своё.',
  )
  .group(
    'st',
    'Станции в контейнере',
    'Выбор контейнера, утепления, климата и систем в карточке станции и мастере. Уже созданные станции не меняются.',
  )
  .group('deal', 'Экономика сделки', '')
  .group('crm', 'Кабинет менеджера', 'Этапы сделок на доске «Сделки», в карточке сделки и в воронке отдела.')
  .group('misc', 'Прочее', '');

KpConditions.LIST.forEach(([label, opts]) =>
  LISTS.addStrings({
    key: `cond.${label}`,
    group: 'kp',
    label: `Условие «${label}»`,
    target: () => opts,
    hint: `Варианты в меню «${label}».`,
  }),
);
LISTS.addStrings({
  key: 'cond.extra',
  group: 'kp',
  label: 'Дополнительные условия (типовые оговорки)',
  target: () => KpConditions.EXTRA,
  hint: 'Добавляются в «Дополнительные условия» одной кнопкой.',
});
LISTS.addStrings({
  key: 'obj.purposes',
  group: 'kp',
  label: 'Назначение объекта',
  target: () => ClientFields.PURPOSES,
  hint: 'Подсказки в поле «Назначение» раздела «Клиент».',
  late: true,
});
LISTS.addStrings({
  key: 'kp.lost',
  group: 'kp',
  label: 'Причины проигрыша КП',
  target: () => KpTrack.LOST,
  hint: 'Варианты в окне «Ход сделки» при статусе «Проиграно» (журнал КП) и при закрытии сделки как проигранной (кабинет менеджера).',
  late: true,
});
LISTS.add({
  key: 'mail.templates',
  group: 'kp',
  label: 'Шаблоны писем',
  target: () => MailTemplates.LIST,
  hint: 'Выбор «Шаблон» в окне «Отправить КП письмом»: тема и текст подставляются, менеджер правит перед отправкой. В тексте можно писать {номер}, {клиент}, {менеджер} — подставится своё. Подпись менеджера («Мои настройки») добавляется сама.',
  cols: [
    ['name', 'Название', 'text', { req: true, unique: true }],
    ['subject', 'Тема', 'text', { req: true }],
    ['body', 'Текст письма', 'area', { req: true }],
  ],
  toRow: tpl => ({ name: tpl.name, subject: tpl.subject, body: tpl.body }),
  fromRow: row =>
    row.name && row.subject && row.body
      ? { name: String(row.name).trim(), subject: String(row.subject).trim(), body: String(row.body) }
      : null,
});

LISTS.add({
  key: 'crm.stages',
  group: 'crm',
  label: 'Этапы сделки',
  target: () => CrmStages.LIST,
  min: 3,
  late: true,
  hint: 'Порядок строк — порядок этапов на доске. Код — внутренний (латиница): у этапов, по которым уже есть сделки, его не меняйте. «Выиграно» (won) и «Проиграно» (lost) есть всегда и стоят в конце — их можно только переименовать. По ходу КП сделка сама идёт вперёд до этапов lead (КП подготовлено), sent (отправлено), talks (в работе), contract (выиграно), если они есть в списке.',
  cols: [
    ['id', 'Код', 'text', { req: true, id: true, ph: 'tender' }],
    ['name', 'Название', 'text', { req: true }],
  ],
  toRow: stage => ({ id: stage.id, name: stage.name }),
  fromRow: row => (row.id && row.name ? { id: String(row.id).trim(), name: String(row.name).trim() } : null),
});

LISTS.add({
  key: 'st.types',
  group: 'st',
  label: 'Типы контейнеров',
  target: () => ContainerKind.TYPES,
  late: true,
  hint: 'Код — внутренний, не меняйте его у типов, которые уже есть в КП. Утепление и климат — свои для этого типа (иначе — из «Умолчаний»).',
  cols: [
    ['id', 'Код', 'text', { req: true, id: true, ph: 'block' }],
    ['name', 'Название', 'text', { req: true }],
    ['short', 'В тексте КП («в …»)', 'text', { req: true, ph: 'блок-контейнере' }],
    ['size', 'Размеры', 'text'],
    ['ins', 'Утепление', 'text', { ph: 'по умолчанию' }],
    ['climate', 'Климат', 'text', { ph: 'по умолчанию' }],
    ['desc', 'Описание в КП', 'area', { req: true }],
  ],
  toRow: kind => ({ ...kind }),
  fromRow: row =>
    row.id && row.name
      ? Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value != null))
      : null,
});
LISTS.addStrings({
  key: 'st.ins',
  group: 'st',
  label: 'Утепление контейнера',
  target: () => ContainerKind.INSULATION,
  hint: 'Например: 80 мм.',
  late: true,
});
LISTS.add({
  key: 'st.climates',
  group: 'st',
  label: 'Климатические исполнения',
  target: () => ContainerKind.CLIMATES,
  late: true,
  cols: [
    ['code', 'Код', 'text', { req: true, unique: true, ph: 'УХЛ1' }],
    ['desc', 'Описание', 'text', { req: true }],
    ['t', 'Мин. температура, °C', 'num', { ph: '−60' }],
  ],
  toRow: ([code, desc, temp]) => ({ code, desc, t: temp == null ? '' : String(temp) }),
  fromRow: row =>
    row.code ? [String(row.code), String(row.desc || ''), row.t === '' || row.t == null ? null : +row.t] : null,
});
LISTS.add({
  key: 'st.systems',
  group: 'st',
  label: 'Системы контейнера',
  target: () => ContainerKind.SYSTEMS,
  late: true,
  hint: 'Кнопки «Системы контейнера» в карточке станции; описание — строкой в характеристиках КП.',
  cols: [
    ['id', 'Код', 'text', { req: true, id: true, ph: 'heat' }],
    ['name', 'Название', 'text', { req: true }],
    ['desc', 'Что входит', 'area', { req: true }],
  ],
  toRow: ([id, name, desc]) => ({ id, name, desc }),
  fromRow: row => (row.id && row.name ? [row.id, row.name, String(row.desc || '')] : null),
});
LISTS.addStrings({
  key: 'kit.presets',
  group: 'st',
  label: 'Быстрые элементы состава',
  target: () => Kit.PRESETS,
  hint: 'Кнопки «+ …» во вкладке «Состав станции».',
  late: true,
});

LISTS.add({
  key: 'deal.countries',
  group: 'deal',
  label: 'Страны поставщиков',
  target: () => DealTerms.COUNTRIES,
  late: true,
  hint: 'Подсказки в поле «Где покупаем» и валюта закупки по умолчанию для страны.',
  cols: [
    ['name', 'Страна', 'text', { req: true, unique: true }],
    ['cur', 'Валюта', 'text', { req: true, ph: 'USD' }],
  ],
  toRow: ([name, cur]) => ({ name, cur }),
  fromRow: row => (row.name ? [String(row.name), String(row.cur || 'USD').toUpperCase()] : null),
});

LISTS.add({
  key: 'ai.sites',
  group: 'misc',
  label: 'Нейросети для автозаполнения',
  target: () => AiChat.SITES,
  late: true,
  hint: 'Кнопки быстрого перехода в «Заполнить с ИИ»: запрос копируется, сайт открывается в новой вкладке.',
  cols: [
    ['name', 'Название', 'text', { req: true }],
    ['url', 'Адрес', 'text', { req: true, ph: 'https://…' }],
  ],
  toRow: ([name, url]) => ({ name, url }),
  fromRow: row => (row.name && /^https?:\/\//i.test(row.url || '') ? [row.name, row.url] : null),
});
LISTS.addStrings({
  key: 'tpl.fonts',
  group: 'misc',
  label: 'Шрифты в редакторе шаблона',
  target: () => TemplateFields.FONTS,
  hint: 'Подсказки в поле «Шрифт» (шрифт должен быть на компьютерах, где открывают КП).',
  late: true,
});

// при запуске — последний вариант из браузера (до ответа сервера), затем свежий с сервера (main.js)
LISTS.fromCache();
