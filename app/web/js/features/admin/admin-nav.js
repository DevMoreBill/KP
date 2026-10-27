import { BitrixMenu } from './bitrix-menu.js';
import { AdminSystem } from './admin-system.js';
import { BitrixPanel } from './bitrix-panel.js';
import { ChinaFreightTab } from './china-freight.js';
import { DangerZone } from './danger-zone.js';
import { DefaultsTab } from './defaults-tab.js';
import { FeedsTab } from './feeds-tab.js';
import { RecordsTab } from './records-tab.js';
import { OurDocsTab } from './our-docs-tab.js';
import { OneCPanel } from './onec-panel.js';
import { SettingsFileCard } from './settings-file.js';
import { AccessPanel, AdminsTab, SecurityTab } from './staff-tabs.js';
import { BackupTab } from './backup-tab.js';
import { AiTab, MailTab, TemplatesTab, TypesTab } from './service-tabs.js';
import { AuditTab, ModerationTab, StatsTab } from './review-tabs.js';
import { ChangedPanel, ConnectionsPanel, SettingsHistoryPanel } from './settings-panels.js';
import { SettingsSearch, StDirty } from './settings-tools.js';
import { esc } from '../../core/util.js';
import { DefRegistry } from '../../core/defaults.js';
import { ApiKeys } from '../kp/api-keys.js';
import { FreightSettings } from '../deal/freight-settings.js';
import { GoodsTab, TrashTab } from '../catalog/trash-tab.js';

/**
 * Разделы и вкладки «Настроек»: «Главная» отдельной кнопкой и семь разделов по предмету (каталог, люди, документы, справочники,
 * параметры, связи, обслуживание). У вкладки: ключ, название, пояснение и обработчик; parts — несколько панелей на одной вкладке.
 */
export class AdminNav {
  static HOME = {
    key: 'home',
    label: '🏠 Главная',
    hint: 'Что ждёт решения — с кнопками прямо в строке; короткая сводка по программе.',
    open: main => AdminNav.home(main),
  };

  static BITRIX_TABS = BitrixMenu.search();

  static GROUPS = [
    {
      title: 'Каталог',
      icon: '📦',
      desc: 'Товары, их категории, загрузка от поставщиков и правки сотрудников.',
      tabs: [
        {
          key: 'catalog',
          label: 'Каталог',
          hint: 'Всё о товарах в одном окне: сами товары, правки сотрудников на проверке, категории с характеристиками и фиды поставщиков.',
          panels: [
            {
              key: 'goods',
              label: 'Товары',
              hint: 'Как в каталоге: поиск, фильтры, сортировка, карточка, правка; отметить галочками — в корзину, выгрузить, перенести.',
              open: (main, click) => GoodsTab.render(main, click),
            },
            {
              key: 'moderation',
              label: 'Правки сотрудников',
              hint: 'Правки товаров сотрудниками: «было → стало» с выделением изменённого, принять целиком или по полям, отклонить.',
              open: main => ModerationTab.render(main),
            },
            {
              key: 'types',
              label: 'Категории и характеристики',
              hint: 'Параметры, фильтры и группы характеристик каждой категории оборудования.',
              open: main => TypesTab.render(main),
            },
            {
              key: 'feeds',
              label: 'Фиды поставщиков',
              hint: 'Загрузка прайсов, остатков и описаний поставщиков: что и куда загружать, план перед загрузкой, скидки, логотипы.',
              open: main => FeedsTab.render(main),
            },
          ],
        },
      ],
    },
    {
      title: 'Люди и доступ',
      icon: '👥',
      desc: 'Кто работает в программе, что ему можно и что он делал.',
      tabs: [
        {
          key: 'managers',
          label: 'Менеджеры',
          hint: 'Вход по паролю, права (в том числе особые: удалять товары, правки без модерации, выгрузка) и контакты для КП.',
          parts: [
            ['', main => AccessPanel.open(main)],
            ['Контакты менеджеров — в КП', main => RecordsTab.render(main, 'manager')],
          ],
        },
        {
          key: 'users',
          rare: true,
          label: 'Администраторы',
          hint: 'Кто входит в «Настройки»: добавить, изменить; смена своего пароля.',
          parts: [
            ['', main => AdminsTab.render(main)],
            ['Мой пароль', main => SecurityTab.render(main)],
          ],
        },
        {
          key: 'audit',
          label: 'Журнал действий',
          hint: 'Кто, что и когда сделал: КП, каталог, справочники, настройки. Фильтры по сотруднику, действию и дате.',
          open: main => AuditTab.render(main),
        },
      ],
    },
    {
      title: 'Документы',
      icon: '📄',
      desc: 'Как выглядит КП и как оно уходит клиенту.',
      tabs: [
        {
          key: 'templates',
          label: 'Шаблоны КП',
          hint: 'Оформление документа КП: графический редактор, настройки шаблона, новый шаблон для другой компании.',
          open: main => TemplatesTab.render(main),
        },
        {
          key: 'ourdocs',
          label: 'Наши реквизиты',
          hint: 'Юрлица продавца для счёта, спецификации и договора из КП; свои шаблоны Word договора и спецификации с метками.',
          open: main => OurDocsTab.render(main),
        },
        {
          key: 'mail',
          label: 'Почта и письма',
          hint: 'Почтовый сервер (SMTP), текст письма по умолчанию, письма администратору о проблемах.',
          open: main => MailTab.render(main),
        },
      ],
    },
    {
      title: 'Справочники',
      icon: '📇',
      desc: 'Клиенты, поставщики и все сохранённые КП.',
      tabs: [
        {
          key: 'db-client',
          label: 'Клиенты',
          hint: 'Реквизиты, контакты и объекты клиентов; загрузка списком ИНН.',
          open: main => RecordsTab.render(main, 'client'),
        },
        {
          key: 'db-supplier',
          label: 'Поставщики и склады',
          hint: 'Условия, реквизиты, склады (адрес отгрузки), режим работы, контакты и оборудование поставщиков.',
          open: main => RecordsTab.render(main, 'supplier'),
        },
        {
          key: 'db-kp',
          label: 'Сохранённые КП',
          hint: 'Все сохранённые КП: найти, открыть для правки, удалить в корзину. Файлы готовых КП в папке не удаляются.',
          open: main => RecordsTab.render(main, 'kp'),
        },
      ],
    },
    {
      title: 'Параметры',
      icon: '⚙',
      desc: 'Все числа, умолчания, функции, списки, тексты и нормы — по частям программы, с поиском.',
      tabs: [
        {
          key: 'params',
          label: 'Параметры программы',
          hint: 'Что программа подставляет и с чем считает — по частям программы: КП, экономика, логистика, станции, каталог. Здесь же функции, списки выбора, тексты и нормы станций. Сохраняется сразу.',
          open: main => DefaultsTab.render(main),
        },
      ],
    },
    {
      title: 'Связи',
      icon: '🔌',
      desc: 'Битрикс24, внешние сервисы и ключи, перевозчики и их тарифы.',
      tabs: [
        {
          key: 'bitrix',
          label: 'Битрикс24',
          hint: 'Связь с Битрикс24: сделки, компании, контакты, дела и КП обмениваются сами. Меню слева — по предметам: обмен, сделки, клиенты, дела; у каждой настройки — что делает и пример. «Справка → Руководство» — как всё устроено.',
          open: main => BitrixPanel.open(main, null),
        },
        {
          key: 'services',
          label: 'Сервисы и ключи',
          hint: 'Проверка всех внешних сервисов одной кнопкой, ключи API (контрагенты, перевозчики, PDF), нейросеть, 1С (оплаты клиентов).',
          parts: [
            ['', main => new ConnectionsPanel(main).open()],
            ['Ключи API', main => ApiKeys.form(main)],
            ['Нейросеть', main => AiTab.render(main)],
            ['1С: оплаты клиентов', main => OneCPanel.render(main)],
          ],
        },
        {
          key: 'carriers',
          rare: true,
          label: 'Перевозчики и тарифы',
          hint: 'Ставки перевозки по России (машины, расстояния, разгрузка, страхование) и доставка из Китая для таможенной стоимости.',
          parts: [
            ['Доставка по России', main => FreightSettings.open(main)],
            ['Доставка из Китая', main => ChinaFreightTab.render(main)],
          ],
        },
      ],
    },
    {
      title: 'Обслуживание',
      icon: '🛠',
      desc: 'Обновления, копии базы, корзина, файл настроек и сведения о системе.',
      tabs: [
        {
          key: 'updates',
          label: 'Обновления',
          hint: 'Новая версия: проверить на GitHub и установить одной кнопкой или из файла; откат; история установок.',
          open: main => AdminSystem.updates(main),
        },
        {
          key: 'backup',
          label: 'Копии и база',
          hint: 'Выгрузка и загрузка данных, автоматические копии, вторая папка, обслуживание базы.',
          open: main => BackupTab.render(main),
        },
        {
          key: 'trash',
          label: 'Корзина',
          get hint() {
            return `Удалённое хранится ${DefRegistry.num('srv.trashDays', AdminNav.TRASH_DAYS)} дн.: восстановить, удалить навсегда, очистить.`;
          },
          open: main => TrashTab.render(main),
        },
        {
          key: 'changes',
          rare: true,
          label: 'Файл и история настроек',
          hint: 'Сохранить все настройки в файл и загрузить из файла; что отличается от встроенного; история изменений с откатом.',
          parts: [
            ['', main => SettingsFileCard.render(main)],
            ['Что изменено', main => new ChangedPanel(main).open()],
            ['История изменений', main => new SettingsHistoryPanel(main).open()],
          ],
        },
        {
          key: 'system',
          rare: true,
          label: 'Система',
          hint: 'Версия, режим работы, адрес, папки, место на диске; перезапуск программы.',
          open: main => AdminSystem.system(main),
        },
        {
          key: 'danger',
          rare: true,
          label: 'Опасная зона',
          hint: 'Необратимое в одном месте: заменить базу, очистить корзину, вернуть все параметры, удалить позиции фида — только после ввода слова «УДАЛИТЬ».',
          open: main => DangerZone.render(main),
        },
      ],
    },
  ];

  // прежние ключи вкладок (ссылки из других окон и подсказок, сохранённый выбор, история настроек); «вкладка:часть» —
  // открыть часть вкладки (раздел «Параметров», вкладку Битрикс24)
  static ALIAS = {
    delete: 'db-kp',
    'db-catalog': 'catalog:goods',
    goods: 'catalog:goods',
    moderation: 'catalog:moderation',
    types: 'catalog:types',
    feeds: 'catalog:feeds',
    stats: 'home',
    feedback: 'home',
    changed: 'changes',
    history: 'changes',
    access: 'managers',
    'db-manager': 'managers',
    security: 'users',
    connections: 'services',
    keys: 'services',
    ai: 'services',
    defaults: 'params',
    features: 'params:features',
    lists: 'params:lists',
    texts: 'params:texts',
    rules: 'params:rules',
    logistics: 'carriers',
    china: 'carriers',
    ...Object.fromEntries(AdminNav.BITRIX_TABS.map(([tab]) => [`bx-${tab}`, `bitrix:${tab}`])),
  };

  // открытая панель вкладок с панелями (запоминается, пока открыта программа)
  static panel = {};

  // открыть часть вкладки
  static SUB = {
    catalog: sub => {
      AdminNav.panel.catalog = sub;
    },
    params: sub => {
      DefaultsTab.sec = sub;
      DefaultsTab.query = '';
    },
    bitrix: sub => {
      BitrixPanel.embed = null;
      BitrixPanel.tab = sub;
    },
  };

  static START = 'home';
  static NARROW = '(max-width: 900px)';
  static TRASH_DAYS = 30;

  /**
   * Все вкладки.
   * @returns {object[]}
   */
  static tabs() {
    return [this.HOME, ...this.GROUPS.flatMap(group => group.tabs)];
  }

  /**
   * Ключ вкладки (прежние ключи — в нынешние, неизвестный — обзор).
   * @param {string} key
   * @returns {string}
   */
  static key(key) {
    const actual = String(this.ALIAS[key] || key || '').split(':')[0];
    return this.tabs().some(tab => tab.key === actual) ? actual : this.START;
  }

  /**
   * Перейти по ключу: прежний ключ или «вкладка:часть» — открыть нужную часть; вернуть ключ вкладки.
   * @param {string} key
   * @returns {string}
   */
  static route(key) {
    const [tab, sub] = String(this.ALIAS[key] || key || '').split(':');
    const actual = this.key(tab);
    if (sub && this.SUB[actual]) this.SUB[actual](sub);
    return actual;
  }

  /**
   * Вкладка по ключу.
   * @param {string} key
   * @returns {object}
   */
  static tab(key) {
    return this.tabs().find(tab => tab.key === this.key(key));
  }

  static _group(tab) {
    return this.GROUPS.find(group => group.tabs.includes(tab));
  }

  /**
   * «Раздел → Вкладка» — где вкладка в «Настройках».
   * @param {string} key
   * @returns {string}
   */
  static path(key) {
    const tab = this.tab(key);
    const group = this._group(tab);
    if (!group) return tab.label;
    return group.tabs.length === 1 ? group.title : `${group.title} → ${tab.label}`;
  }

  /**
   * Кнопка вкладки в меню.
   * @param {object} tab
   * @param {string} current
   * @returns {string}
   */
  static btn(tab, current) {
    return `<button type="button" class="${tab.key === current ? 'on' : ''}" data-sttab="${tab.key}" title="${esc(tab.hint)}">${esc(tab.label)}</button>`;
  }

  /**
   * Меню «Настроек».
   * @param {string} current ключ открытой вкладки
   * @returns {string}
   */
  static html(current) {
    const groups = this.GROUPS.map(group => this._groupHtml(group, current)).join('');
    return `<nav class="st-nav">${SettingsSearch.html()}${this.btn(this.HOME, current)}${groups}${this._rare(current)}</nav>`;
  }

  static _groupHtml(group, current) {
    const tabs = group.tabs.filter(tab => !tab.rare);
    if (group.tabs.length === 1) {
      return this.btn({ ...tabs[0], label: `${group.icon} ${group.title}` }, current).replace(
        'type="button" class="',
        'type="button" class="st-n1 ',
      );
    }
    return `<span class="st-ng" title="${esc(group.desc || '')}">${esc(`${group.icon} ${group.title}`)}</span>${tabs.map(tab => this.btn(tab, current)).join('')}`;
  }

  // редкое (администраторы, тарифы, файл настроек, система, опасная зона) — под «Дополнительно», раскрыто, если открыто оттуда
  static _rare(current) {
    const rare = this.GROUPS.flatMap(group =>
      group.tabs.filter(tab => tab.rare).map(tab => ({ ...tab, label: `${group.icon} ${tab.label}` })),
    );
    const buttons = rare.map(tab => this.btn(tab, current)).join('');
    if (window.matchMedia(this.NARROW).matches || document.documentElement.classList.contains('mob')) return buttons; // узкое меню — строкой, раскрывашки там нет
    const open = rare.some(tab => tab.key === current) ? ' open' : '';
    return `<details class="st-more"${open}><summary class="st-ng" title="Нужно редко: администраторы, тарифы перевозки, файл и история настроек, система, опасная зона">Дополнительно (${rare.length})</summary>${buttons}</details>`;
  }

  /**
   * Главная: что ждёт решения (с кнопками в строке) и короткая сводка.
   * @param {HTMLElement} main
   */
  static async home(main) {
    main.innerHTML = `<div id="stHomeStats"><p class="empty">Загружаю…</p></div>${this._tiles()}`;
    try {
      await StatsTab.render(main.querySelector('#stHomeStats'));
    } catch {
      main.querySelector('#stHomeStats').innerHTML = '';
    }
  }

  // на телефоне — разделы плитками под входящими (меню-полоса сверху там узкая)
  static _tiles() {
    if (!document.documentElement.classList.contains('mob')) return '';
    const tiles = this.GROUPS.map(
      group =>
        `<button type="button" class="st-gt" data-sttab="${group.tabs[0].key}"><b>${esc(`${group.icon} ${group.title}`)}</b><span class="muted">${esc(group.desc)}</span></button>`,
    ).join('');
    return `<p class="sub st-hm">Разделы</p><div class="st-gtiles">${tiles}</div>`;
  }

  /**
   * Несколько панелей одной вкладки — друг под другом (ошибка одной не мешает остальным).
   * @param {HTMLElement} main
   * @param {Array<[string, Function]>} parts
   */
  static async stack(main, parts) {
    main.innerHTML = parts
      .map(
        ([title], i) =>
          `<section class="st-part">${title ? `<p class="st-pt">${esc(title)}</p>` : ''}<div data-stp="${i}"><p class="empty">Загружаю…</p></div></section>`,
      )
      .join('');
    for (const [i, [, open]] of parts.entries()) {
      const box = main.querySelector(`[data-stp="${i}"]`);
      try {
        await open(box);
      } catch (error) {
        box.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      }
    }
  }

  /**
   * Вкладка: заголовок и пояснение, под ними — содержимое.
   * @param {HTMLElement} main
   * @param {string} key
   * @param {{click?: boolean, pick?: boolean}} [opts] click — открыта щелчком по меню; pick — щелчком по панели (для «Товаров»)
   */
  static async open(main, key, { click = false, pick = false } = {}) {
    const tab = this.tab(key);
    const group = this._group(tab);
    const panel = this._panel(tab);
    const shown = panel || tab;
    const hist = SettingsHistoryPanel.TABS[shown.key];
    StDirty.set(false);
    const bar = panel
      ? `<div class="bx-tabs st-ptabs" role="tablist">${tab.panels.map(row => `<button type="button" role="tab" data-stpanel="${row.key}" class="${row.key === panel.key ? 'on' : ''}" aria-selected="${row.key === panel.key}" title="${esc(row.hint)}">${esc(row.label)}</button>`).join('')}</div>`
      : '';
    main.innerHTML = `<header class="st-th"><span class="muted" title="${esc((group && group.desc) || '')}">${esc(group ? group.title : 'Настройки')}</span><div class="st-th-r"><h4>${esc(tab.label)}</h4></div><p class="muted">${esc(shown.hint)}</p></header>${bar}<div class="st-body"><p class="empty">Загружаю…</p></div>`;
    const body = main.querySelector('.st-body');
    main.querySelectorAll('[data-stpanel]').forEach(button => {
      button.onclick = async () => {
        if (!(await StDirty.leave())) return;
        this.panel[tab.key] = button.dataset.stpanel;
        this.open(main, tab.key, { click: true, pick: true });
      };
    });
    await (shown.parts ? this.stack(body, shown.parts) : shown.open(body, panel ? pick : click));
    if (hist) this._history(main, shown.key);
  }

  // открытая панель вкладки с панелями (иначе null)
  static _panel(tab) {
    if (!tab.panels) return null;
    return tab.panels.find(row => row.key === this.panel[tab.key]) || tab.panels[0];
  }

  // внизу экрана — что и когда здесь меняли, с «Вернуть» (раскрывается по щелчку)
  static _history(main, key) {
    const box = document.createElement('details');
    box.className = 'st-card st-hist';
    box.innerHTML =
      '<summary class="sub">История изменений этого раздела — кто, когда, было → стало, «Вернуть»</summary><div class="st-hist-b"></div>';
    main.append(box);
    box.addEventListener(
      'toggle',
      () => {
        SettingsHistoryPanel.filter = key;
        new SettingsHistoryPanel(box.querySelector('.st-hist-b')).open().catch(() => {});
      },
      { once: true },
    );
  }
}
