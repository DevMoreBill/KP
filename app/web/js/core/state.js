// Состояние КП (S) и общие переменные, которые читают и переписывают и ES-модули, и обычные скрипты. Обычный скрипт:
// S создаётся при загрузке страницы (до ES-модулей), а глобальные let можно переприсвоить из модуля только так.
'use strict';

// что ещё подставляется в новое КП («Настройки → Значения программы → КП и документы → Новое КП»)
DefRegistry.add(
  [],
  [
    [
      'kp.showClients',
      'kp',
      'Страница «Наши клиенты» в новом КП',
      'bool',
      true,
      {
        hint: 'Включено — в новом КП сразу стоит переключатель «Страница „Наши клиенты“ в КП» (раздел «Оформление КП»): в документ попадает страница с логотипами клиентов компании. Выключено — страницы нет, менеджер включает её сам, когда нужно.',
      },
    ],
  ],
);

// условия КП и базовые варианты для быстрого выбора (раздел «Условия», кнопка ▾ у поля)
const COND = [
  [
    'Срок поставки',
    [
      'В наличии на складе',
      '5–10 рабочих дней',
      '10 рабочих дней',
      '20 рабочих дней',
      '30 рабочих дней',
      '45 рабочих дней',
      '60 рабочих дней',
      '90 календарных дней',
      'По согласованию',
    ],
  ],
  [
    'Условия оплаты',
    [
      '100 % предоплата',
      '50 % аванс, 50 % перед отгрузкой',
      '30 % аванс, 70 % перед отгрузкой',
      '70 % аванс, 30 % после поставки',
      'Отсрочка платежа 30 дней',
      'По согласованию',
    ],
  ],
  [
    'Гарантия',
    [
      '12 месяцев',
      '18 месяцев',
      '24 месяца',
      '36 месяцев',
      '12 месяцев или 1 000 моточасов',
      '24 месяца или 2 000 моточасов',
      '12 месяцев с даты ввода в эксплуатацию',
    ],
  ],
  [
    'Доставка',
    [
      'Самовывоз со склада в Москве',
      'Доставка до объекта включена',
      'Доставка по Москве включена',
      'Доставка рассчитывается отдельно',
      'Доставка транспортной компанией за счёт покупателя',
    ],
  ],
  [
    'Срок действия предложения',
    ['5 рабочих дней', '10 рабочих дней', '14 дней', '30 дней', 'До конца текущего месяца'],
  ],
  [
    'Монтаж, ШМР и ПНР',
    [
      'Шефмонтаж и пусконаладочные работы входят в стоимость',
      'Монтаж и пусконаладочные работы входят в стоимость',
      'Не входят в стоимость, выполняются по отдельному договору',
      'По согласованию',
    ],
  ],
];

// типовые оговорки для «Дополнительных условий» (добавляются строкой)
const COND_EXTRA = [
  'Цена действительна при заказе всего комплекта оборудования.',
  'Пусконаладочные работы выполняются по отдельному договору.',
  'Стоимость доставки рассчитывается отдельно.',
  'Срок поставки уточняется на момент оплаты.',
  'Цена может быть изменена при изменении курса валют более чем на 3 %.',
  'Монтаж оборудования в стоимость не входит.',
  'Гарантия действует при обслуживании в авторизованном сервисном центре.',
];

/**
 * Черновик КП в браузере (на случай закрытия вкладки). Большие картинки (data:, 3D-виды и листы чертежа станции —
 * мегабайты) хранятся отдельными записями и пишутся один раз: иначе каждая правка КП ждала бы запись нескольких мегабайт.
 * В черновике вместо картинки — ссылка REF+номер.
 */
class LocalDraft {
  static KEY = 'kp.draft';
  static PRE = 'kp.img.';
  static REF = '\u0000img:';
  // меньше — прямо в черновике
  static MIN = 20000;
  // картинка → номер записи (уже записана)
  static ids = new Map();
  static seq = 0;

  /**
   * Записать черновик (картинки — отдельно).
   * @param {object} state
   */
  static save(state) {
    const used = new Set();
    const text = JSON.stringify(state, (key, value) =>
      typeof value === 'string' && value.length >= this.MIN && value.startsWith('data:')
        ? this.REF + this.put(value, used)
        : value,
    );
    localStorage.setItem(this.KEY, text);
    this.sweep(used);
  }

  /**
   * Черновик без картинок (не хватило места в браузере).
   * @param {object} state
   */
  static saveLite(state) {
    localStorage.setItem(this.KEY, JSON.stringify(state));
    this.sweep(new Set());
  }

  /**
   * Картинка — отдельной записью (один раз); номер записи.
   * @param {string} src
   * @param {Set<string>} used
   * @returns {string}
   */
  static put(src, used) {
    let id = this.ids.get(src);
    if (!id) {
      id = `${Date.now().toString(36)}_${++this.seq}`;
      localStorage.setItem(this.PRE + id, src);
      this.ids.set(src, id);
    }
    used.add(id);
    return id;
  }

  /**
   * Убрать записи картинок, на которые черновик больше не ссылается.
   * @param {Set<string>} used
   */
  static sweep(used) {
    for (let k = localStorage.length - 1; k >= 0; k--) {
      const key = localStorage.key(k);
      if (key && key.startsWith(this.PRE) && !used.has(key.slice(this.PRE.length))) localStorage.removeItem(key);
    }
    for (const [src, id] of this.ids) if (!used.has(id)) this.ids.delete(src);
  }

  /**
   * Черновик с картинками или null.
   * @returns {object | null}
   */
  static load() {
    const text = localStorage.getItem(this.KEY);
    if (!text) return null;
    return JSON.parse(text, (key, value) => {
      if (typeof value !== 'string' || !value.startsWith(this.REF)) return value;
      const id = value.slice(this.REF.length);
      const src = localStorage.getItem(this.PRE + id);
      if (src == null) return null;
      this.ids.set(src, id);
      return src;
    });
  }

  /** Черновик переписан в другой вкладке (она могла убрать «чужие» картинки) — следующее сохранение пишет картинки заново. */
  static watch() {
    window.addEventListener('storage', event => {
      if (event.key == null || event.key === this.KEY || event.key.startsWith(this.PRE)) this.ids.clear();
    });
  }
}

/** Новое КП, позиция, черновик в браузере, итоги. */
class KpState {
  // контакты компании (телефон, сайт, адрес, режим работы) — из «Значений программы» (mgr.*)
  static MANAGER = {
    name: '',
    position: '',
    phone: '',
    ext: '',
    mobile: '',
    email: '',
    site: '',
    address: '',
    hours: '',
  };
  static COMPANY_KEYS = ['phone', 'site', 'address', 'hours'];
  static VAT = 22;
  static MARGIN = 35;
  static SAVE_MS = 400;

  /**
   * Пустая позиция КП.
   * @returns {object}
   */
  static newItem() {
    return {
      id: uid(),
      name: '',
      spec: '',
      qty: 1,
      price: 0,
      page: false,
      pageTitle: '',
      photoCaption: '',
      photo: null,
      logo: null,
      features: [],
      groups: [],
      hint: null,
      options: [],
      attrs: {},
    };
  }

  /**
   * Контакты нового менеджера — из умолчаний администратора.
   * @returns {object}
   */
  static defManager() {
    const manager = { ...this.MANAGER };
    for (const key of this.COMPANY_KEYS) {
      const value = DEF(`mgr.${key}`);
      manager[key] = value == null ? '' : value;
    }
    return manager;
  }

  static _savedManager() {
    try {
      const saved = localStorage.getItem('kp.manager');
      if (saved) return JSON.parse(saved);
    } catch {
      // без хранилища браузера
    }
    return this.defManager();
  }

  /**
   * Новое КП по умолчаниям администратора и личным настройкам.
   * @returns {object}
   */
  static fresh() {
    const manager = this._savedManager();
    return {
      ...this._client(),
      date: today(),
      city: DEF('kp.city') || '',
      vat: DEFN('kp.vat', this.VAT),
      showClients: DEF('kp.showClients') !== false,
      cover: { title: '', model: '', desc: '', kpis: [{}, {}, {}, {}], touched: false },
      pricing: this._pricing(),
      items: [],
      conditions: COND.map(cond => ({ label: cond[0], value: DEF(`cond.${cond[0]}`) || '' })),
      // текст условий из «Умолчаний» — как автоматический: «Экономика сделки» заменит его своим расчётом, пока его не правили
      condAuto: Object.fromEntries(COND.map(cond => [cond[0], DEF(`cond.${cond[0]}`)]).filter(pair => pair[1])),
      condExtra: '',
      manager: { ...manager },
      managerId: '',
    };
  }

  static _client() {
    return {
      client: '',
      clientId: '',
      clientInn: '',
      clientKpp: '',
      clientOgrn: '',
      clientFull: '',
      clientAddr: '',
      clientDir: '',
      clientDirPost: '',
      clientStatus: '',
      contact: { name: '', post: '', phone: '', email: '' },
      object: { purpose: '', address: '' },
      check: null,
      // вид КП: обычное или для тендера (номер и ссылка на закупку — в КП, журнале и имени файла)
      tender: { on: false, number: '', url: '' },
    };
  }

  static _pricing() {
    return {
      cur: DEF('kp.cur') || 'RUB',
      rates: { USD: '', EUR: '', CNY: '' },
      rateDate: '',
      rateSrc: '',
      margin: this.MARGIN,
      mode: 'margin',
      costNoVat: false,
      round: DEF('kp.round') || '1',
    };
  }

  /**
   * КП из черновика браузера (вложенные части — поверх нового КП); черновика нет — новое КП.
   * @returns {object}
   */
  static restore() {
    let state = this.fresh();
    try {
      const draft = LocalDraft.load();
      if (draft) {
        state = Object.assign(this.fresh(), draft);
        this._fill(state);
      }
    } catch {
      // черновик испорчен — что успели разобрать
    }
    return state;
  }

  static _fill(state) {
    state.pricing = Object.assign(this.fresh().pricing, state.pricing || {});
    state.contact = Object.assign(this.fresh().contact, state.contact || {});
    state.object = Object.assign(this.fresh().object, state.object || {});
    state.items.forEach(item => {
      item._busy = false;
      item._srcImg = null;
      item.options = item.options || [];
      item.attrs = item.attrs || {};
    });
  }

  /** Состав и титул — по позициям; черновик в браузере — с задержкой (правка позиции каталога его не трогает). */
  static persist() {
    if (CATED) return;
    // закупка сборки — по текущим курсам; параметры станции — по составу
    S.items.forEach(item => {
      Kit.sync(item);
      StationAuto.fill(item);
      StationName.apply(item);
    });
    coverSync();
    clearTimeout(saveT);
    saveT = setTimeout(() => this._saveDraft(), this.SAVE_MS);
  }

  static _saveDraft() {
    if (CATED) return;
    const el = $('#saved');
    try {
      LocalDraft.save(S);
      el.textContent = 'Черновик сохранён';
    } catch {
      el.textContent = this._saveLite() ? 'Черновик сохранён без фото' : '';
    }
    try {
      localStorage.setItem('kp.manager', JSON.stringify(S.manager));
    } catch {
      // без хранилища браузера
    }
  }

  static _saveLite() {
    try {
      const lite = JSON.parse(JSON.stringify(S));
      lite.items.forEach(item => {
        item.photo = null;
        item.logo = null;
        if (item.gallery) item.gallery = item.gallery.filter(img => !String(img.src).startsWith('data:'));
      });
      LocalDraft.saveLite(lite);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Сумма позиции с учётом скидки для заказчика (KPGen.netPrice) и опций, копейки.
   * @param {object} item
   * @returns {number}
   */
  static itemSum(item) {
    const options = (item.options || []).reduce((sum, option) => sum + (+option.qty || 0) * (option.price || 0), 0);
    return (+item.qty || 0) * KPGen.netPrice(item) + options;
  }

  /**
   * Итоги КП (KPGen.totals).
   * @returns {object}
   */
  static totals() {
    const items = S.items.map(item => ({
      qty: +item.qty || 0,
      price: item.price || 0,
      disc: item.disc,
      options: (item.options || [])
        .filter(option => option.name)
        .map(option => ({ qty: +option.qty || 0, price: option.price || 0 })),
    }));
    return KPGen.totals(items, +S.vat || 0);
  }
}

// прежние имена — их вызывают все разделы
const newItem = () => KpState.newItem();
const defManager = () => KpState.defManager();
const freshState = () => KpState.fresh();
const persist = () => KpState.persist();
const itemSum = item => KpState.itemSum(item);
const totalsS = () => KpState.totals();

LocalDraft.watch();

// eslint-disable-next-line id-length -- КП, которое сейчас открыто: им пользуются все разделы
let S = KpState.restore();

// отложенная запись черновика (persist; окно «Экономика сделки» сбрасывает её перед своей записью)
let saveT;

// CLIENTS — последние использованные и найденные клиенты (их тысячи, поиск — на сервере), CLIENTS_ALL — сколько всего;
// MGRS — менеджеры; mgrT — отложенное сохранение контактов менеджера (docx/build.js сбрасывает его перед записью КП)
let CLIENTS = [];
let CLIENTS_ALL = 0;
let MGRS = [];
let mgrT = null;

// правка позиции каталога в карточке (features/catalog/catalog-edit.js): пока она открыта, S.items подменены — черновик не сохраняется
var CATED = null;

// каталог в браузере (Catalog.refresh) и открытая карточка позиции (ItemEditor): присваивают и читают все разделы
let catCache = [];
let EDIT = null;

// типы оборудования (EquipTypes.load): встроенные + свои отдела и встроенный справочник для сравнения; загрузка заменяет массив
// целиком — окна, которые помнят разбор по TYPES, видят смену справочника
let TYPES = [];
let TYPES_BUILTIN = null;

// открытый раздел формы КП (ui/steps.js — Steps) и свои подсказки полей адреса (ui/geo-input.js — GeoInput,
// склады поставщиков добавляет features/deal): общие для нескольких модулей
let STEP = 'client';
const GEO_EXTRA = {};
