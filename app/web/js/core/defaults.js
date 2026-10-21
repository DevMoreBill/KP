import { ContainerKind } from '../features/kit/container-kind.js';
import { DealPresets } from '../features/deal/deal-presets.js';
import { KpConditions } from './conditions.js';

// Значения по умолчанию программы («Настройки → Значения программы»; сервер: app/defaults.py, kv settings.defaults =
// {ключ: {on, v}}). Разделы регистрируют свои значения при загрузке, новое КП (core/state.js) читает их сразу. Последние
// значения с сервера хранятся в браузере — новое КП получает их и до ответа сервера.

/**
 * Реестр значений программы. Раздел добавляет свои значения из своего файла — DefRegistry.add(группы, значения);
 * «Настройки → Значения программы» показывает их по разделам. Значение: [ключ, группа, подпись, тип (text, num, select,
 * bool), встроенное значение, доп.]; доп.: unit, hint (что это и на что влияет), opts (для select — [[значение, подпись]]
 * или функция), min / max (для num), req (всегда действует — переключателя нет), off (выключено, если не задано).
 */
export class DefRegistry {
  // разделы админки: [id, название, пояснение]
  static SECTIONS = [
    [
      'kp',
      'КП и документы',
      'Что подставляется в новое КП: город, НДС, валюта, условия, контакты компании, оформление документа.',
    ],
    ['deal', 'Экономика сделки', 'Ставки, налоги, сроки и проценты, с которыми считается экономика сделки.'],
    ['log', 'Логистика', 'Доставка: транспорт, ставки, страхование, агент, габариты и масса по умолчанию.'],
    [
      'st',
      'Станции в контейнере',
      'Контейнер, климат и прочие значения станций. Отступы, нормы и расчёты станций — «Инженерные правила станций».',
    ],
    [
      'cat',
      'Каталог, фото, фиды, ИИ',
      'Поиск и подбор по каталогу, загрузка фото со страниц, фиды поставщиков, автозаполнение нейросетью.',
    ],
    ['srv', 'Сервер и обслуживание', 'Копии базы, журналы, сроки хранения, проверки и письма администратору.'],
    ['ui', 'Интерфейс', 'Поведение экранов: сколько строк показывать, задержки поиска и т. п.'],
  ];
  // группа → раздел
  static GSEC = { kp: 'kp', cond: 'kp', mgr: 'kp', deal: 'deal', st: 'st', img: 'cat', ai: 'cat' };
  static STORE = 'kp.defaults';
  // личное значение менеджера («Мои настройки»): подключает раздел КП (MyPrefs.def)
  static personal = null;
  // значения администратора с сервера: {ключ: {on, v}} (переписывает и «Настройки → Значения программы»)
  static srv = this.stored();

  /**
   * Добавить группы и значения (повторный ключ не добавляется).
   * @param {Array[]} groups [[id, название, раздел, пояснение]]
   * @param {Array[]} rows значения
   */
  static add(groups, rows) {
    for (const [group, title, section, hint] of groups || []) {
      if (!DEF_GROUPS.some(known => known[0] === group)) DEF_GROUPS.push([group, title]);
      if (section) this.GSEC[group] = section;
      if (hint) DEF_GROUP_HINTS[group] = hint;
    }
    for (const row of rows || []) {
      if (DEF_BY[row[0]]) continue;
      DEF_SCHEMA.push(row);
      DEF_BY[row[0]] = row;
    }
  }

  /**
   * Раздел админки группы.
   * @param {string} group
   * @returns {string}
   */
  static section(group) {
    return this.GSEC[group] || 'ui';
  }

  /**
   * Проверка числа по min / max схемы: '' — верно, иначе текст ошибки.
   * @param {string} key
   * @param {*} value
   * @returns {string}
   */
  static check(key, value) {
    const schema = DEF_BY[key];
    if (!schema || schema[3] !== 'num' || value == null || String(value).trim() === '') return '';
    const num = parseFloat(String(value).replace(',', '.'));
    const opts = schema[5] || {};
    if (!Number.isFinite(num)) return 'нужно число';
    if (opts.min != null && num < opts.min) return `не меньше ${opts.min}`;
    if (opts.max != null && num > opts.max) return `не больше ${opts.max}`;
    return '';
  }

  /**
   * Действующее значение: личное менеджера («Мои настройки»), администратора или встроенное; выключено — null (поле
   * остаётся пустым, решает менеджер); у bool — true / false.
   * @param {string} key
   * @returns {string | boolean | null}
   */
  static value(key) {
    const schema = DEF_BY[key];
    if (!schema) return null;
    const mine = this.personal ? this.personal(key) : null;
    return mine != null ? mine : this._admin(schema, this.srv[key]);
  }

  static _admin([, , , type, builtin, opts = {}], srv) {
    const set = Boolean(srv) && typeof srv === 'object' && 'on' in srv;
    if (type === 'bool') return set ? !!srv.on : !!builtin;
    const enabled = set ? !!srv.on || !!opts.req : !opts.off;
    return enabled ? this._text(srv, builtin) : null;
  }

  static _text(srv, builtin) {
    const value = srv && srv.v != null && String(srv.v).trim() !== '' ? srv.v : builtin;
    return value == null ? null : String(value);
  }

  /**
   * Число по умолчанию (или запасное, если выключено, не число или вне границ).
   * @param {string} key
   * @param {*} fallback
   * @returns {*}
   */
  static num(key, fallback) {
    const value = this.value(key);
    const num = value == null ? NaN : parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(num) && !this.check(key, value) ? num : fallback;
  }

  /**
   * Последние значения с сервера, сохранённые в браузере.
   * @returns {object}
   */
  static stored() {
    try {
      return JSON.parse(localStorage.getItem(this.STORE) || '{}') || {};
    } catch {
      return {};
    }
  }

  /**
   * Значения администратора с сервера (/api/defaults) — запомнить и в браузере.
   * @param {object} reply
   */
  static use(reply) {
    this.srv = reply && typeof reply === 'object' ? reply : {};
    try {
      localStorage.setItem(this.STORE, JSON.stringify(this.srv));
    } catch {
      // без хранилища браузера
    }
  }
}

export const DEF_GROUPS = [
  ['kp', 'Новое КП'],
  ['cond', 'Условия КП'],
  ['mgr', 'Контакты компании (новый менеджер)'],
  ['deal', 'Экономика сделки'],
  ['st', 'Станции в контейнере'],
  ['img', 'Фото со страницы товара'],
  ['ai', 'Автозаполнение'],
];
export const DEF_SCHEMA = [
  ['kp.city', 'kp', 'Город в КП', 'text', 'Москва'],
  [
    'kp.vat',
    'kp',
    'НДС в ценах КП',
    'num',
    '22',
    { unit: '%', req: true, hint: 'С 2026 года основная ставка — 22 %.' },
  ],
  [
    'kp.cur',
    'kp',
    'Валюта КП',
    'select',
    'RUB',
    {
      req: true,
      opts: [
        ['RUB', 'Рубли'],
        ['USD', 'Доллары США'],
        ['EUR', 'Евро'],
        ['CNY', 'Юани'],
      ],
    },
  ],
  [
    'kp.round',
    'kp',
    'Округление цен из экономики сделки',
    'select',
    '1',
    {
      req: true,
      opts: [
        ['0.01', 'до копеек'],
        ['1', 'до рубля'],
        ['100', 'до 100'],
        ['1000', 'до 1 000'],
      ],
    },
  ],
  ...['Срок поставки', 'Условия оплаты', 'Гарантия', 'Доставка', 'Срок действия предложения', 'Монтаж, ШМР и ПНР'].map(
    label => [
      `cond.${label}`,
      'cond',
      label,
      'text',
      '',
      {
        off: true,
        list: () => (KpConditions.LIST.find(cond => cond[0] === label) || [])[1] || [],
      },
    ],
  ),
  ['mgr.phone', 'mgr', 'Телефон компании', 'text', '+7 (495) 690-91-96'],
  ['mgr.site', 'mgr', 'Сайт', 'text', 'www.kompr.ru'],
  ['mgr.address', 'mgr', 'Адрес офиса', 'text', 'Москва, ул. Малая Пироговская, д. 18с1'],
  ['mgr.hours', 'mgr', 'Режим работы', 'text', 'Пн–Пт, 9:00–18:00'],
  [
    'deal.country',
    'deal',
    'Где покупаем — страна поставщика',
    'text',
    'Россия',
    {
      hint: 'Россия — без таможни, НДС поставщика к вычету. Выключено — менеджер выбирает сам («В России» / «Ввозим сами»).',
    },
  ],
  ['deal.startToday', 'deal', 'Дата договора — сегодня (с напоминанием «уточните»)', 'bool', true],
  ['deal.prod', 'deal', 'Срок изготовления у поставщика', 'num', '40', { unit: 'дн.' }],
  ['deal.ship', 'deal', 'Срок доставки до заказчика', 'num', '40', { unit: 'дн.' }],
  ['deal.supPay', 'deal', 'Оплата поставщику', 'select', 'a20', { opts: () => DealPresets.options(DealPresets.SUP) }],
  ['deal.custPay', 'deal', 'Оплата заказчика', 'select', 'post', { opts: () => DealPresets.options(DealPresets.CUST) }],
  ['deal.spread', 'deal', 'Стоимость денег: ключевая ставка ЦБ плюс', 'num', '3', { unit: 'п.п. годовых', req: true }],
  ['deal.tax', 'deal', 'Налог на прибыль', 'num', '25', { unit: '%', req: true }],
  ['deal.bgRate', 'deal', 'Ставка банковской гарантии', 'num', '3', { unit: '% годовых', req: true }],
  [
    'deal.ivat',
    'deal',
    'НДС при ввозе',
    'select',
    '22',
    {
      req: true,
      opts: [
        ['22', '22 %'],
        ['10', '10 %'],
        ['0', '0 %'],
      ],
    },
  ],
  [
    'deal.target',
    'deal',
    'Нужная маржинальность для подбора цены',
    'num',
    '20',
    { unit: '%', off: true, hint: 'Включено — в «Цене продажи» сразу считается цена КП под эту маржинальность.' },
  ],
  [
    'st.ins',
    'st',
    'Утепление контейнера',
    'select',
    '100 мм',
    {
      opts: () => ContainerKind.INSULATION.map(value => [value, value]),
    },
  ],
  [
    'st.joinCost',
    'st',
    'Стыковка модулей станции на объекте: закупка за один стык',
    'num',
    '',
    {
      unit: '₽',
      hint: 'Станция из нескольких модулей (кнопка «Модули…» в «Компоновке»): строка «Стыковка модулей на объекте» × число стыков. Пусто — цену вписывает менеджер.',
    },
  ],
  [
    'st.climate',
    'st',
    'Климатическое исполнение',
    'select',
    'УХЛ1',
    {
      opts: () => ContainerKind.CLIMATES.map(climate => [climate[0], `${climate[0]} — ${climate[1]}`]),
    },
  ],
  ['img.mainOnly', 'img', 'Отмечать только главное фото (остальные — по выбору)', 'bool', true],
  [
    'img.minKB',
    'img',
    'Не показывать фото меньше',
    'num',
    '15',
    { unit: 'КБ', hint: 'Мелкие файлы — иконки, заглушки, пустые картинки.' },
  ],
  ['img.minPx', 'img', 'Не показывать фото с меньшей стороной меньше', 'num', '200', { unit: 'px' }],
  ['img.skipBlank', 'img', 'Пропускать пустые (белые, однотонные) картинки', 'bool', true],
  ['img.maxCount', 'img', 'Сколько фото показывать', 'num', '12', { req: true, unit: 'шт.' }],
  [
    'ai.keep',
    'ai',
    '«Не менять уже заполненное» — включено',
    'bool',
    false,
    { hint: 'Галочка в шаге «Проверьте и заполните»: ИИ дописывает только пустые поля.' },
  ],
];
export const DEF_GROUP_HINTS = {
  cond: 'Текст условия в новом КП. Срок поставки, условия оплаты и монтаж подставляются и из «Экономики сделки», пока поле не правили вручную.',
  mgr: 'Подставляются в контакты нового менеджера (раздел «Менеджер»).',
  img: 'Для «Загрузить со страницы» в автозаполнении и кнопки «Фото с сайта поставщика».',
};
export const DEF_BY = Object.fromEntries(DEF_SCHEMA.map(row => [row[0], row]));
