import { StNav, StDirty } from './settings-tools.js';
import { $, esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminNav } from './admin-nav.js';
import { AdminState } from './admin-state.js';
import { ApiKeys } from './api-keys.js';
import { BackupTab } from './backup-tab.js';
import { DEF_GROUPS, DEF_SCHEMA, DefRegistry } from '../../core/defaults.js';
import { Debounce } from '../../core/debounce.js';
import { DefaultsTab } from './defaults-tab.js';
import { EquipTypes } from '../../core/equip-types.js';
import { FEAT } from '../../core/features.js';
import { LISTS } from '../../core/lists.js';
import { ListsPanel } from './lists-panel.js';
import { RecordEdit } from './records-tab.js';
import { Toast } from '../../core/toast.js';

/** Поиск по всем настройкам (вкладки, умолчания, функции, списки, ключи, категории) с переходом к найденному. */
export class SettingsSearch {
  // слова, по которым вкладку находят, хотя их нет в названии
  static WORDS = {
    home: 'статистика сводка обзор внимание что где карта',
    audit: 'журнал кто изменил действия аудит',
    templates: 'шаблон оформление логотип docx документ word титул',
    'db-kp': 'кп журнал удалить номер',
    goods: 'товары каталог позиции карточки оборудование удалить корзина выгрузка excel json xml yml сортировка',
    types: 'категории характеристики параметры фильтры группы',
    feeds: 'фид прайс остатки ррц скидка поставщик yml excel наличие что загружать бренды фильтр план логотип',
    moderation: 'модерация правки подтверждение черновик было стало принять отклонить',
    'db-client': 'клиенты инн реквизиты контрагенты',
    'db-supplier': 'поставщики склады условия оплата отгрузка',
    managers:
      'менеджеры контакты телефон должность подпись вход логин пароль права блокировать удалять выгрузка модерация',
    logistics: 'тарифы доставка перевозка машина разгрузка трал фура логистика',
    features: 'функции включить выключить доступ кнопки',
    defaults: 'умолчания значения подставляет ндс валюта город срок гарантия условия числа',
    lists: 'списки выбор варианты выпадающие причины проигрыша единицы тексты надписи подписи подсказки переименовать',
    mail: 'почта smtp письмо отправка яндекс mail.ru пароль приложения письма администратору',
    china: 'китай таможенная стоимость экспедитор ставки',
    params:
      'параметры умолчания значения подставляет ндс валюта город срок гарантия условия числа функции включить выключить доступ кнопки списки выбор варианты выпадающие тексты надписи подписи нормы станций',
    carriers: 'перевозчики тарифы доставка перевозка машина разгрузка трал фура логистика китай экспедитор ставки',
    bitrix: 'битрикс битрикс24 bitrix crm црм вебхук webhook воронка стадии синхронизация обмен поля сделки регламент',
    services:
      'проверка подключений связь сервисы ключи api checko чекко ofdata офдата rusprofile dadata ati деловые линии кит сдэк возовоз convertapi pdf нейросеть ии deepseek openrouter модель токены битрикс битрикс24 bitrix crm црм вебхук webhook воронка стадии синхронизация',
    users: 'администраторы учётные записи мой пароль сменить',
    updates: 'обновление версия github установить откат токен',
    rules: 'нормы станций инженерные правила компоновка',
    system: 'система папки порт адрес перезапуск диск место сервер',
    backup:
      'копии резервная копия база экспорт импорт выгрузка каталог поставщика excel правка json zip sqlite вторая папка флешка сетевой диск облако восстановить',
    trash: 'корзина восстановить удалённое удалить навсегда очистить',
    changes:
      'изменённые отличается встроенное вернуть сбросить история откат кто изменил файл настроек сохранить загрузить перенести',
  };

  // переходы в «Базу и копии»: подпись, где, слова, куда (подвкладка и выбор), что подсветить
  static BACKUP = [
    [
      'Каталог поставщика: выгрузить (Excel, JSON, XML, YML, .zip)',
      '',
      'выгрузка поставщик фид без цен excel правка zip xml yml json',
      ['out', 'sup'],
      '#seBox',
      'Выгрузка',
    ],
    [
      'Каталог по фильтру: выгрузить',
      ' → Выгрузить',
      'выгрузка каталога отбор категория производитель поставщик с ценой в наличии excel yml xml json',
      ['out', 'filter'],
      '#bkSide',
      'База',
    ],
    [
      'Скачать всю базу одним файлом',
      ' → Выгрузить',
      'выгрузить экспорт база zip sqlite копия',
      ['out', 'db'],
      '#bkSide',
      'База',
    ],
    [
      'Загрузить файл базы целиком',
      ' → Загрузить',
      'заменить базу импорт sqlite восстановить из копии',
      ['in', 'db'],
      '#bkSide',
      'База',
    ],
    [
      'Загрузить копию или правки каталога',
      ' → Загрузить',
      'импорт json zip excel правки',
      ['in', 'file'],
      '#bkSide',
      'База',
    ],
    [
      'Автоматические копии базы',
      ' → Автокопии',
      'резервная копия создать копию сейчас',
      ['copies'],
      '#stMaint',
      'База',
    ],
    [
      'Вторая папка для копий базы',
      ' → Автокопии',
      'сетевой диск флешка облако зеркало',
      ['copies'],
      '#stMirror',
      'База',
    ],
    [
      'Сжать и проверить базу',
      ' → Обслуживание',
      'обслуживание vacuum журнал действий срок хранения изображения без ссылок миграции',
      ['maint'],
      '#stMaint',
      'База',
    ],
  ];
  static LIMIT = 40;
  static WAIT = 120;
  static RECORDS_MIN = 3;
  static RECORDS_EACH = 5;
  // записи, которые ищутся на сервере: [вид в списке «Справочников», подпись, вкладка]
  static RECORDS = [
    ['client', 'Клиент', 'db-client'],
    ['supplier', 'Поставщик', 'db-supplier'],
    ['catalog', 'Товар', 'goods'],
    ['kp', 'КП', 'db-kp'],
  ];
  static OTHER_KIND = 0.5;

  /**
   * Всё, что можно найти.
   * @returns {object[]} [{label, where, text, tab, focus?, before?, kind}]
   */
  static index() {
    const out = [];
    const add = entry =>
      out.push({
        ...entry,
        n: StNav.norm(entry.label),
        t: StNav.norm(`${entry.label} ${entry.text || ''} ${entry.where || ''}`),
      });
    for (const tab of AdminNav.tabs()) {
      const group = AdminNav.groups().find(row => row.tabs.some(entry => entry.key === tab.key));
      add({
        label: tab.label,
        where: group ? group.title : '',
        text: `${tab.hint} ${this.WORDS[tab.key] || ''}`,
        tab: tab.key,
        kind: 'Вкладка',
      });
    }
    add({
      label: 'Сохранить все настройки в файл',
      where: AdminNav.path('changes'),
      text: 'файл настроек перенести на другой компьютер загрузить ключи',
      tab: 'changes',
      kind: 'Файл',
    });
    for (const tab of AdminNav.tabs())
      for (const panel of tab.panels || [])
        add({
          label: panel.label,
          where: AdminNav.path(tab.key),
          text: `${panel.hint} ${this.WORDS[panel.key] || ''}`,
          tab: `${tab.key}:${panel.key}`,
          kind: 'Вкладка',
        });
    for (const [sub, label] of DefaultsTab.EXTRA)
      add({ label, where: AdminNav.path('params'), text: this.WORDS[sub] || '', tab: `params:${sub}`, kind: 'Раздел' });
    for (const [sub, label, hint] of AdminNav.BITRIX_TABS)
      add({
        label: `Битрикс24: ${label}`,
        where: AdminNav.path('bitrix'),
        text: hint,
        tab: `bitrix:${sub}`,
        kind: 'Раздел',
      });
    this._defaults(add);
    this._backup(add);
    this._more(add);
    return this._allowed(out);
  }

  // только то, что видно вошедшему администратору (вкладки без доступа в меню не показываются)
  static _allowed(entries) {
    const open = new Set(
      AdminNav.tabs().flatMap(tab => [tab.key, ...(tab.panels || []).map(panel => `${tab.key}:${panel.key}`)]),
    );
    return entries.filter(entry => {
      const [root, part] = String(AdminNav.ALIAS[entry.tab] || entry.tab || '').split(':');
      return open.has(root) && (!part || root !== 'catalog' || open.has(`${root}:${part}`));
    });
  }

  static _defaults(add) {
    const titles = Object.fromEntries(DEF_GROUPS);
    for (const [key, group, label, , builtin, opts = {}] of DEF_SCHEMA) {
      add({
        label,
        where: `${AdminNav.path('defaults')} → ${titles[group] || group}`,
        before: () => {
          DefaultsTab.sec = DefRegistry.section(group);
          DefaultsTab.query = '';
          DefaultsTab.only = false;
        },
        text: `${opts.hint || ''} ${builtin ?? ''}`,
        tab: 'defaults',
        focus: `[data-dk="${CSS.escape(key)}"]`,
        kind: 'Умолчание',
      });
    }
  }

  static _backup(add) {
    for (const [label, where, text, place, focus, kind] of this.BACKUP) {
      add({
        label,
        where: AdminNav.path('backup') + where,
        text,
        tab: 'backup',
        before: () => BackupTab.show(...place),
        focus,
        kind,
      });
    }
  }

  static _more(add) {
    for (const def of FEAT.defs)
      add({
        label: def.label,
        where: AdminNav.path('features'),
        text: def.hint,
        tab: 'features',
        focus: `[data-ft="${CSS.escape(def.key)}"]`,
        kind: 'Функция',
      });
    for (const def of LISTS.defs.values()) {
      add({
        label: def.label,
        where: AdminNav.path('lists'),
        text: def.hint || '',
        tab: 'lists',
        before: () => {
          ListsPanel.last = def.key;
        },
        kind: 'Список',
      });
    }
    for (const [group, , fields] of ApiKeys.GROUPS) {
      for (const field of fields) {
        if (field.t)
          add({
            label: field.t,
            where: `${AdminNav.path('services')} → ${group}`,
            text: `${field.h || ''} ${field.ph || ''}`,
            tab: 'services',
            focus: `[data-key="${CSS.escape(field.id)}"]`,
            kind: 'Ключ',
          });
      }
    }
    for (const type of EquipTypes.list) {
      add({
        label: type.name,
        where: AdminNav.path('types'),
        text: `${type.group || ''} ${type.fields.map(field => field.label).join(' ')}`,
        tab: 'types',
        kind: 'Категория',
        find: type.name,
      });
    }
  }

  static _score(entry, first) {
    let rank = 2;
    if (entry.n.startsWith(first)) rank = 0;
    else if (entry.n.includes(first)) rank = 1;
    return rank + (entry.kind === 'Вкладка' ? 0 : this.OTHER_KIND);
  }

  /**
   * Найденное по словам запроса: все слова есть в тексте; выше — совпадение с началом названия.
   * @param {string} query
   * @returns {object[]}
   */
  static find(query) {
    const words = StNav.norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const index = this._idx || (this._idx = this.index());
    return index
      .filter(entry => words.every(word => entry.t.includes(word)))
      .map(entry => ({ entry, score: this._score(entry, words[0]) }))
      .sort((first, second) => first.score - second.score || first.entry.label.localeCompare(second.entry.label, 'ru'))
      .slice(0, this.LIMIT)
      .map(row => row.entry);
  }

  /**
   * Поле поиска над меню.
   * @returns {string}
   */
  static html() {
    return `<div class="st-find"><input type="search" id="stFind" placeholder="Найти настройку…" autocomplete="off" aria-label="Поиск по настройкам" data-nodirty></div>`;
  }

  /**
   * Подключить поле поиска окна.
   * @param {HTMLElement} dialog
   */
  static bind(dialog) {
    const input = dialog.querySelector('#stFind');
    if (!input) return;
    this._idx = null;
    input.placeholder = 'Найти настройку или запись… (Ctrl+K)';
    if (!dialog._findKey) {
      dialog._findKey = true;
      dialog.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.code !== 'KeyK') return;
        event.preventDefault();
        const find = dialog.querySelector('#stFind');
        find?.focus();
        find?.select();
      });
    }
    const wait = new Debounce(this.WAIT);
    input.oninput = () => wait.run(() => this.show(input.value));
    input.onkeydown = event => {
      if (event.key === 'Escape' && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        this.show('');
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        dialog.querySelector('#stFindRes [data-sfi]')?.click();
      }
    };
  }

  /**
   * Показать найденное вместо вкладки (пустой запрос — вернуть вкладку).
   * @param {string} query
   */
  static show(query) {
    const main = $('#stMain');
    if (!main) return;
    if (!query.trim()) {
      if (main.dataset.find) {
        delete main.dataset.find;
        AdminState.show();
      }
      return;
    }
    main.dataset.find = '1';
    this.res = this.find(query);
    const count = this.res.length
      ? `Найдено: ${this.res.length}. Щёлкните, чтобы перейти.`
      : 'Ничего не найдено. Попробуйте другое слово: «НДС», «почта», «логотип», «копия».';
    const rows = this.res
      .map(
        (entry, i) =>
          `<button type="button" class="st-fr" data-sfi="${i}"><b>${esc(entry.label)}</b><span class="muted">${esc(entry.kind)} · ${esc(entry.where)}</span></button>`,
      )
      .join('');
    main.innerHTML = `<header class="st-th"><span class="muted">Поиск</span><h4>«${esc(query.trim())}»</h4><p class="muted">${count}</p></header>
      <div class="st-body" id="stFindRes">${rows}</div>`;
    main.querySelector('#stFindRes').onclick = event => {
      const button = event.target.closest('[data-sfi]');
      if (button) this.goTo(this.res[+button.dataset.sfi]);
    };
    this._records(query.trim(), main);
  }

  // записи справочников и каталога — запросом к серверу, ниже найденных настроек
  static async _records(query, main) {
    if (query.length < this.RECORDS_MIN) return;
    const found = await Promise.all(
      this.RECORDS.map(([type, kind, tab]) =>
        AdminApi.get(`list/${type}?q=${encodeURIComponent(query)}`)
          .then(reply => (reply.items || []).slice(0, this.RECORDS_EACH).map(row => ({ row, type, kind, tab, query })))
          .catch(() => []),
      ),
    );
    const rows = found.flat();
    const box = main.querySelector('#stFindRes');
    if (!rows.length || !box || main.dataset.find !== '1' || ($('#stFind') || {}).value?.trim() !== query) return;
    const start = this.res.length;
    this.res = [...this.res, ...rows.map(entry => this._record(entry))];
    box.insertAdjacentHTML(
      'beforeend',
      `<p class="sub st-fr-h">Записи</p>${rows
        .map(
          (entry, i) =>
            `<button type="button" class="st-fr" data-sfi="${start + i}"><b>${esc(entry.row.title)}</b><span class="muted">${esc(entry.kind)} · ${esc(entry.row.sub || '')}</span></button>`,
        )
        .join('')}`,
    );
  }

  static _record({ row, type, kind, tab, query }) {
    const label = row.title;
    if (type === 'catalog' || type === 'kp')
      return {
        label,
        kind,
        tab,
        open: () =>
          RecordEdit.open(type, row.id, () => {}).catch(error => Toast.show(`Не открылось: ${error.message || error}`)),
      };
    return {
      label,
      kind,
      tab,
      before: () => {
        AdminState.del = { type, q: query, sel: new Set() };
        AdminState.editing = null;
      },
      find: label,
    };
  }

  /**
   * Перейти к найденному.
   * @param {object} entry
   */
  static async goTo(entry) {
    if (!(await StDirty.leave())) return;
    if (entry.open) {
      entry.open();
      return;
    }
    const input = $('#stFind');
    if (input) input.value = '';
    const main = $('#stMain');
    if (main) delete main.dataset.find;
    if (entry.before) entry.before();
    StNav.select(entry.tab);
    await AdminState.show();
    StNav.highlight(entry.focus, entry.find || entry.label);
  }
}
