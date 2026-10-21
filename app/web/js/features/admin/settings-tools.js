import { AdminApi, AdminDialog, AdminState } from './admin-core.js';
import { AdminNav } from './admin-nav.js';
import { BackupTab } from './backup-tab.js';
import { DefaultsTab } from './defaults-tab.js';
import { ListsPanel } from './lists-panel.js';
import { SettingsWindow } from './settings-window.js';
import { $, esc } from '../../core/util.js';
import { Debounce } from '../../core/debounce.js';
import { EquipTypes } from '../../core/equip-types.js';
import { ApiKeys } from '../kp/api-keys.js';
import { LISTS } from '../../core/lists.js';
import { FEAT } from '../../core/features.js';
import { DEF_BY, DEF_GROUPS, DEF_SCHEMA, DefRegistry } from '../../core/defaults.js';
import { ServerDefaults } from '../../core/net.js';

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
  static OTHER_KIND = 0.5;

  /**
   * Сравнимый текст: строчные, ё → е.
   * @param {string} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
  }

  /**
   * Всё, что можно найти.
   * @returns {object[]} [{label, where, text, tab, focus?, before?, kind}]
   */
  static index() {
    const out = [];
    const add = entry =>
      out.push({
        ...entry,
        n: this.norm(entry.label),
        t: this.norm(`${entry.label} ${entry.text || ''} ${entry.where || ''}`),
      });
    for (const tab of AdminNav.tabs()) {
      const group = AdminNav.GROUPS.find(row => row.tabs.includes(tab));
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
    this._defaults(add);
    this._backup(add);
    this._more(add);
    return out;
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
    const words = this.norm(query).split(/\s+/).filter(Boolean);
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
        SettingsWindow.tab();
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
  }

  /**
   * Перейти к найденному.
   * @param {object} entry
   */
  static async goTo(entry) {
    if (!(await StDirty.leave())) return;
    const input = $('#stFind');
    if (input) input.value = '';
    const main = $('#stMain');
    if (main) delete main.dataset.find;
    if (entry.before) entry.before();
    StNav.select(entry.tab);
    await SettingsWindow.tab();
    StNav.highlight(entry.focus, entry.find || entry.label);
  }
}

/** Переход по вкладкам и подсветка найденного. */
export class StNav {
  static sup = ''; // поставщик для «Копии и база → Каталог поставщика» (переход из «Фидов поставщиков»)
  static HIT_MS = 2600;

  /**
   * Выбрать вкладку в меню.
   * @param {string} key
   */
  static select(key) {
    AdminState.tab = AdminNav.key(key);
    const dialog = $('#setdlg');
    if (dialog)
      dialog
        .querySelectorAll('.st-nav [data-sttab]')
        .forEach(button => button.classList.toggle('on', button.dataset.sttab === AdminState.tab));
    dialog?.querySelector('.st-nav .on')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Найти элемент на открытой вкладке (селектор или текст) и показать его.
   * @param {string} [selector]
   * @param {string} [text]
   */
  static highlight(selector, text) {
    const body = $('#stMain .st-body');
    if (!body) return;
    const found = this._find(body, selector, text);
    if (!found) return;
    found.scrollIntoView({ block: 'center' });
    found.classList.add('st-hit');
    setTimeout(() => found.classList.remove('st-hit'), this.HIT_MS);
    found.querySelector?.('input:not([type=checkbox]),select,textarea')?.focus({ preventScroll: true });
  }

  static _find(body, selector, text) {
    const bySelector = selector ? body.querySelector(selector) : null;
    if (bySelector) return bySelector.closest('.df-row,.ft-r,.key-f,.st-row,tr,label,.st-card') || bySelector;
    if (!text) return null;
    const norm = SettingsSearch.norm(text);
    const byText = [...body.querySelectorAll('td,b,h4,.sub,.ls-it,label span')].find(node =>
      SettingsSearch.norm(node.textContent).includes(norm),
    );
    return byText && (byText.closest('tr,.st-row,.ls-it,label') || byText);
  }
}

/** Несохранённые изменения: отметка в заголовке и вопрос при уходе с вкладки или закрытии окна. */
export class StDirty {
  static dirty = false;
  // поля, которые не настройки: поиск, фильтры журнала, выбор строк, параметры выгрузки, файлы
  static SKIP =
    '[type=search],[type=file],[data-nodirty],[data-nodirty] *,[data-af],[data-did],#dtExp *,#seBox *,.st-find *,[name=dtScope]';

  /**
   * Следить за окном.
   * @param {HTMLDialogElement} dialog
   */
  static watch(dialog) {
    if (dialog._dirtyWatch) return;
    dialog._dirtyWatch = true;
    const mark = event => {
      const target = event.target;
      if (!target.closest || !target.closest('#stMain .st-body') || target.matches(this.SKIP)) return;
      if (target.matches('input,select,textarea')) this.set(true);
    };
    dialog.addEventListener('input', mark);
    dialog.addEventListener('change', mark);
    dialog.addEventListener('cancel', async event => {
      if (!this.dirty) return;
      event.preventDefault();
      if (await this.leave()) dialog.close();
    });
    dialog.addEventListener('close', () => this.set(false));
    window.addEventListener('beforeunload', event => {
      if (!this.dirty || !dialog.open) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  /**
   * Отметить (или снять отметку) несохранённое.
   * @param {boolean} value
   */
  static set(value) {
    this.dirty = !!value;
    const dialog = $('#setdlg');
    if (!dialog) return;
    let badge = dialog.querySelector('.st-dirty');
    if (this.dirty && !badge) {
      const head = dialog.querySelector('.dlg-h h3');
      if (head) {
        badge = document.createElement('span');
        badge.className = 'st-dirty';
        badge.textContent = '● Не сохранено';
        badge.title = 'На этой вкладке есть несохранённые изменения';
        head.after(badge);
      }
    }
    if (!this.dirty && badge) badge.remove();
    dialog.querySelector('.st-nav .on')?.classList.toggle('dirty', this.dirty);
  }

  /** Сохранение прошло (любой запрос на изменение) — отметку снять. */
  static saved() {
    if (this.dirty) this.set(false);
  }

  /**
   * Можно уйти с вкладки?
   * @returns {Promise<boolean>} true — изменений нет или пользователь согласен их потерять
   */
  static async leave() {
    if (!this.dirty) return true;
    const ok = await AdminDialog.confirm(
      'Есть несохранённые изменения',
      'Если уйти, они пропадут. Чтобы сохранить — останьтесь и нажмите «Сохранить» на этой вкладке.',
      'Уйти без сохранения',
    );
    if (ok) this.set(false);
    return !!ok;
  }
}

/** После отката: настройки в этом браузере — заново с сервера. */
export class StRefresh {
  /** Умолчания, функции и списки — заново. */
  static async all() {
    const jobs = [
      ServerDefaults.load(),
      FEAT.refresh(),
      AdminApi.get('lists').then(reply => {
        LISTS.use(reply.values || {});
        LISTS.cache();
      }),
    ];
    await Promise.all(jobs.map(job => job.catch(() => {})));
  }
}

/** Значения настроек для показа в истории и списке изменённого. */
export class StVal {
  static SHORT = 140;
  static PAIR = 2;
  static WHO = { admin: 'администратору', users: 'выбранным' };
  // понятные имена полей истории: ['defaults', 'kp.vat'] → «Значения программы → НДС в ценах КП»
  static PART = {
    defaults: 'Значения программы',
    lists: 'Списки',
    features: 'Функции',
    ai: 'Нейросеть',
    userLogin: 'Вход менеджеров',
    productEditModeration: 'Модерация',
    auditYears: 'Срок журнала',
    backup2: 'Вторая папка копий',
    host: 'Сервер',
    port: 'Порт',
    security: 'Защита',
    login: 'Логин',
    fromEmail: 'Адрес отправителя',
    fromName: 'Имя отправителя',
    bccSelf: 'Копия себе',
    subject: 'Тема письма',
    body: 'Текст письма',
    types: 'Категории',
    items: 'Фиды',
    enabled: 'Включено',
    model: 'Модель',
    base: 'Адрес API',
    on: 'Включено',
    path: 'Папка',
    keep: 'Хранить копий',
    images: 'Изображения',
  };

  /**
   * Значение коротко.
   * @param {*} value
   * @returns {string}
   */
  static text(value) {
    if (value == null || value === '') return '— (встроенное)';
    if (typeof value === 'boolean') return value ? 'да' : 'нет';
    if (Array.isArray(value)) return `${value.length} ${KPGen.plural(value.length, 'строка', 'строки', 'строк')}`;
    if (typeof value === 'object') return this._object(value);
    return String(value);
  }

  static _object(value) {
    const state = value.on === false ? 'выключено' : 'включено';
    if ('on' in value && Object.keys(value).length <= this.PAIR)
      return state + (value.v != null && value.v !== '' ? `, ${value.v}` : '');
    if ('on' in value && 'who' in value)
      return state + (value.who && value.who !== 'all' ? `, доступ: ${this.WHO[value.who] || value.who}` : '');
    const json = JSON.stringify(value);
    return json.length > this.SHORT ? `${json.slice(0, this.SHORT)}…` : json;
  }

  /**
   * Значение целиком (для подсказки).
   * @param {*} value
   * @returns {string}
   */
  static full(value) {
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value);
  }

  /**
   * Имя поля истории.
   * @param {string[]} path
   * @returns {string}
   */
  static path(path) {
    const [first, second] = path;
    const name = key => this.PART[key] || key;
    if (!second) return name(first) || 'всё значение';
    return `${name(first)} → ${this._second(first, second)}`;
  }

  static _second(first, second) {
    if (first === 'defaults' && DEF_BY[second]) return DEF_BY[second][2];
    if (first === 'features' && FEAT.get(second)) return FEAT.get(second).label;
    if (first === 'lists' && LISTS.get(second)) return LISTS.get(second).label;
    return this.PART[second] || second;
  }
}
