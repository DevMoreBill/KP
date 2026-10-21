import { AdminSystem } from './admin-system.js';
import { BitrixPanel } from './bitrix-panel.js';
import { ChinaFreightTab } from './china-freight.js';
import { DefaultsTab } from './defaults-tab.js';
import { FeedsTab } from './feeds-tab.js';
import { FeaturesPanel, ListsPanel, TextsPanel } from './lists-panel.js';
import { RecordsTab } from './records-tab.js';
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
import { Toast } from '../../core/toast.js';
import { LazyJs } from '../../core/lazy-js.js';
import { FreightSettings } from '../deal/freight-settings.js';
import { GoodsTab, TrashTab } from '../catalog/trash-tab.js';

/**
 * Разделы и вкладки «Настроек»: обзор отдельной кнопкой и четыре раздела по задачам администратора (+ Битрикс24). У вкладки:
 * ключ, название, пояснение и обработчик; parts — несколько панелей на одной вкладке.
 */
export class AdminNav {
  static HOME = {
    key: 'home',
    label: 'Обзор',
    hint: 'Что происходит в программе и где что настраивается: сводка, «требует внимания», карта разделов.',
    open: main => AdminNav.home(main),
  };

  static BITRIX_TABS = [
    [
      'link',
      'Связь и включение',
      'Адрес вебхука, проверка связи, включение обмена и «Обменяться сейчас». Пока связь выключена, программа в Битрикс ничего не пишет и оттуда не читает.',
    ],
    [
      'mirror',
      'Кабинет как в Битрикс24',
      'Повторить в кабинете менеджера воронки, стадии и поля сделок Битрикса и загрузить сделки; какие воронки показывать, куда попадают новые сделки, какие поля видны в карточке.',
    ],
    [
      'flow',
      'Направление обмена',
      'В какую сторону идут данные: в обе стороны, только из Битрикса или только в Битрикс — отдельно для сделок, дел и компаний.',
    ],
    [
      'mgr',
      'Менеджеры',
      'Какой пользователь Битрикса — какой менеджер программы, кто участвует в обмене, своя воронка у менеджера, что делать со сделкой без ответственного.',
    ],
    [
      'cats',
      'Воронки и этапы',
      'Основная воронка Битрикса для сделок программы и соответствие этапов программы её стадиям; ещё воронки, из которых загружать сделки.',
    ],
    [
      'fields',
      'Поля сделки',
      'Какое поле программы — в какое поле Битрикса, направление и кто главный, если поле изменили с двух сторон.',
    ],
    [
      'send',
      'Что передаётся',
      'Товары сделки, файлы КП (Word, PDF, справочные), Excel экономики, компании и контакты, виды дел.',
    ],
    [
      'sched',
      'Расписание',
      'Как часто забирать изменения из Битрикса, в какие часы обмениваться, сколько записей за раз, сколько повторять при ошибке.',
    ],
    [
      'log',
      'Журнал и проверка',
      'Что и когда передавалось («поле: было → стало»), ошибки и «Не отправлено»; пробный прогон — что изменилось бы, без записи.',
    ],
    [
      'old',
      'Старые сделки',
      'Загрузить сделки, созданные в Битриксе раньше, — с даты и по воронкам, с предпросмотром: новая, связать с открытой или пропустить.',
    ],
  ];

  static GROUPS = [
    {
      title: 'Каталог',
      desc: 'Товары, их категории, загрузка от поставщиков и правки сотрудников.',
      tabs: [
        {
          key: 'goods',
          label: 'Товары',
          hint: 'Как в каталоге: поиск, фильтры, сортировка, карточка, правка; отметить галочками — в корзину, выгрузить, перенести.',
          open: (main, click) => GoodsTab.render(main, click),
        },
        {
          key: 'moderation',
          label: 'Модерация правок',
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
    {
      title: 'Документы и справочники',
      desc: 'КП и всё, из чего они собираются: шаблоны, клиенты, поставщики, почта.',
      tabs: [
        {
          key: 'templates',
          label: 'Шаблоны КП',
          hint: 'Оформление документа КП: графический редактор, настройки шаблона, новый шаблон для другой компании.',
          open: main => TemplatesTab.render(main),
        },
        {
          key: 'db-kp',
          label: 'Сохранённые КП',
          hint: 'Все сохранённые КП: найти, открыть для правки, удалить в корзину. Файлы готовых КП в папке не удаляются.',
          open: main => RecordsTab.render(main, 'kp'),
        },
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
          key: 'mail',
          label: 'Почта для отправки КП',
          hint: 'Почтовый сервер (SMTP), текст письма по умолчанию, письма администратору о проблемах.',
          open: main => MailTab.render(main),
        },
      ],
    },
    {
      title: 'Настройки программы',
      desc: 'Все числа, умолчания, списки и тексты — с пояснениями; сохранение всего в файл.',
      tabs: [
        {
          key: 'defaults',
          label: 'Значения программы',
          hint: 'Все числа и умолчания по разделам: новое КП, экономика сделки, логистика, каталог, сервер — с пояснениями, границами и поиском.',
          open: main => DefaultsTab.render(main),
        },
        {
          key: 'features',
          label: 'Функции программы',
          hint: 'Какие возможности включены и кому доступны: всем, администратору или выбранным менеджерам.',
          open: main => new FeaturesPanel(main).open(),
        },
        {
          key: 'lists',
          label: 'Списки и тексты',
          hint: 'Варианты в выпадающих списках и свои надписи и подсказки вместо стандартных.',
          parts: [
            ['Списки выбора', main => new ListsPanel(main).open()],
            ['Тексты интерфейса', main => new TextsPanel(main).open()],
          ],
        },
        {
          key: 'logistics',
          label: 'Тарифы доставки',
          hint: 'Ставки перевозки по России: машины, расстояния, разгрузка, страхование, агент; загрузка файлом.',
          open: main => FreightSettings.open(main),
        },
        {
          key: 'china',
          label: 'Доставка из Китая',
          hint: 'Перевозка из Китая до места прибытия в ЕАЭС для таможенной стоимости (ТК ЕАЭС ст. 40) — ставки экспедиторов, условия поставки, сравнение с рынком.',
          open: main => ChinaFreightTab.render(main),
        },
        {
          key: 'rules',
          label: 'Нормы станций',
          hint: 'Отступы, проходы, ворота, вентиляция, отопление, ресиверы и все расчёты станций в контейнере: значение, источник, пределы.',
          open: main =>
            LazyJs.load('rules-doc/index.js')
              .then(({ RulesPanel }) => new RulesPanel(main).open())
              .catch(error => Toast.show(error.message)),
        },
        {
          key: 'changes',
          label: 'Файл, изменения, откат',
          hint: 'Сохранить все настройки в файл и загрузить из файла; что отличается от встроенного; история изменений с откатом.',
          parts: [
            ['', main => SettingsFileCard.render(main)],
            ['Что изменено', main => new ChangedPanel(main).open()],
            ['История изменений', main => new SettingsHistoryPanel(main).open()],
          ],
        },
      ],
    },
    {
      title: 'Сотрудники и система',
      desc: 'Кто работает и что ему можно, журнал действий, подключения, обновления, база и корзина.',
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
        {
          key: 'services',
          label: 'Подключения и ключи',
          hint: 'Проверка всех внешних сервисов одной кнопкой, ключи API (контрагенты, перевозчики, PDF), нейросеть. Битрикс24 — отдельный раздел ниже.',
          parts: [
            ['', main => new ConnectionsPanel(main).open()],
            ['Ключи API', main => ApiKeys.form(main)],
            ['Нейросеть', main => AiTab.render(main)],
          ],
        },
        {
          key: 'updates',
          label: 'Обновления',
          hint: 'Новая версия: проверить на GitHub и установить одной кнопкой или из файла; откат; история установок.',
          open: main => AdminSystem.updates(main),
        },
        {
          key: 'backup',
          label: 'База и копии',
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
          key: 'system',
          label: 'Система',
          hint: 'Версия, режим работы, адрес, папки, место на диске; перезапуск программы.',
          open: main => AdminSystem.system(main),
        },
      ],
    },
    {
      title: 'Битрикс24',
      desc: 'Связь с Битрикс24: сделки, стадии, поля, дела и КП обмениваются сами — менеджеры могут работать и в Битриксе, и в программе. Порядок настройки — сверху вниз.',
      tabs: AdminNav.BITRIX_TABS.map(([tab, label, hint]) => ({
        key: `bx-${tab}`,
        label,
        hint,
        open: main => BitrixPanel.open(main, null, tab),
      })),
    },
  ];

  // прежние ключи вкладок (ссылки из других окон и подсказок, сохранённый выбор, история настроек)
  static ALIAS = {
    delete: 'db-kp',
    'db-catalog': 'goods',
    stats: 'home',
    changed: 'changes',
    history: 'changes',
    access: 'managers',
    'db-manager': 'managers',
    security: 'users',
    connections: 'services',
    keys: 'services',
    ai: 'services',
    bitrix: 'bx-link',
    texts: 'lists',
  };

  static START = 'home';
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
    const actual = this.ALIAS[key] || key;
    return this.tabs().some(tab => tab.key === actual) ? actual : this.START;
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
    return group ? `${group.title} → ${tab.label}` : tab.label;
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
    const groups = this.GROUPS.map(
      group =>
        `<span class="st-ng" title="${esc(group.desc || '')}">${esc(group.title)}</span>${group.tabs.map(tab => this.btn(tab, current)).join('')}`,
    ).join('');
    return `<nav class="st-nav">${SettingsSearch.html()}${this.btn(this.HOME, current)}${groups}</nav>`;
  }

  /**
   * Обзор: сводка и карта разделов — щелчок по вкладке открывает её.
   * @param {HTMLElement} main
   */
  static async home(main) {
    const map = this.GROUPS.map(
      group => `<section class="st-card st-hg"><p class="sub">${esc(group.title)}</p><p class="muted">${esc(group.desc || '')}</p>
      <ul>${group.tabs.map(tab => `<li><button type="button" class="lnk" data-sttab="${tab.key}">${esc(tab.label)}</button><small class="muted">${esc(tab.hint)}</small></li>`).join('')}</ul></section>`,
    ).join('');
    main.innerHTML = `<div id="stHomeStats"><p class="empty">Загружаю…</p></div><p class="sub st-hm">Где что настраивается</p><div class="st-home">${map}</div>`;
    try {
      await StatsTab.render(main.querySelector('#stHomeStats'));
    } catch {
      main.querySelector('#stHomeStats').innerHTML = '';
    }
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
   * @param {{click?: boolean}} [opts] click — открыта щелчком (для «Товаров»)
   */
  static async open(main, key, { click = false } = {}) {
    const tab = this.tab(key);
    const group = this._group(tab);
    const hist = SettingsHistoryPanel.TABS[tab.key];
    StDirty.set(false);
    const history = hist
      ? `<button class="btn ghost sm" type="button" data-sthist="${tab.key}" title="Что и когда меняли на этой вкладке, вернуть как было">История</button>`
      : '';
    main.innerHTML = `<header class="st-th"><span class="muted" title="${esc((group && group.desc) || '')}">${esc(group ? group.title : 'Настройки')}</span><div class="st-th-r"><h4>${esc(tab.label)}</h4>${history}</div><p class="muted">${esc(tab.hint)}</p></header><div class="st-body"><p class="empty">Загружаю…</p></div>`;
    const body = main.querySelector('.st-body');
    await (tab.parts ? this.stack(body, tab.parts) : tab.open(body, click));
  }
}
