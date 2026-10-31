import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';
import { Currency } from '../../core/currency.js';
/** Состояние вкладки «Фиды поставщиков» (пока открыта программа). */
export class FeedState {
  static sel = null; // открытый фид
  static feeds = []; // фиды вкладки (последний ответ сервера)
  static prev = null; // «Проверить фид»: что в нём есть
  static cats = {}; // категории фида → категории программы
  static types = [];
  static sups = null;
  static poll = 0;
  static edit = null; // форма нового фида
  static disc = null; // сетка скидок открытого фида (правится до сохранения)
  static plan = null; // распределение скидок
  static rplan = null; // «Что загрузится…»
  static rpf = ''; // фильтр плана по виду строки
  static roff = new Set(); // строки плана со снятой галочкой (отбор по виду их не возвращает)
  /**
   * Перерисовать вкладку фидов — подключает admin/index.js (панели фида вкладку не подключают).
   * @param {HTMLElement} main
   * @returns {*}
   */
  static redraw = () => {};

  static DRIVES = [
    ['any', 'любой'],
    ['belt', 'ременной'],
    ['direct', 'прямой и/или частотник'],
  ];
  static REMEZA = {
    name: 'Remeza',
    url: 'https://www.remeza.org/bitrix/catalog_export/yandex_202475.php',
    maker: 'Remeza',
    auto: true,
    pageDesc: true,
    kind: 'yml',
  };
  static FILES = {
    kind: 'files',
    name: '',
    maker: '',
    priceKind: 'cost',
    cur: 'EUR',
    priceOnly: false,
    pageDesc: false,
    auto: false,
  };
  static NEW_YML = { name: '', url: '', maker: '', auto: true, pageDesc: true, kind: 'yml' };
  static CURS = [
    ['', 'как в прайсе'],
    ['RUB', 'Рубли'],
    ['EUR', 'Евро'],
    ['USD', 'Доллары США'],
    ['CNY', 'Юани'],
  ];
  static XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /** Открыт другой фид — забыть всё, что относилось к прежнему. */
  static forget() {
    this.prev = null;
    this.cats = {};
    this.disc = null;
    this.plan = null;
    this.rplan = null;
    this.roff = new Set();
  }

  /**
   * Предпросмотр относится к открытому фиду.
   * @returns {boolean}
   */
  static previewed() {
    return !!(this.prev && this.prev.id === this.sel);
  }
}

/** Подписи и значения фида для показа. */
export class FeedFmt {
  static OTHER = 'other';

  /**
   * Сумма в рублях из копеек.
   * @param {number|null} kop
   * @returns {string}
   */
  static rub(kop) {
    return kop == null ? '—' : `${KPGen.money(kop)} ₽`;
  }

  /**
   * Сумма в валюте из копеек.
   * @param {number|null} kop
   * @param {string} [cur]
   * @returns {string}
   */
  static money(kop, cur) {
    return kop == null ? '—' : `${KPGen.money(kop)} ${Currency.short(cur || 'RUB')}`;
  }

  /**
   * Дата и время.
   * @param {string} iso
   * @returns {string}
   */
  static date(iso) {
    return iso ? Fmt.dateTime(iso) : '—';
  }

  /**
   * Фид из файлов (парс сайта + прайс).
   * @param {object} feed
   * @returns {boolean}
   */
  static isFiles(feed) {
    return !!feed && feed.kind === 'files';
  }

  /**
   * Цена прайса — наша закупка.
   * @param {object} feed
   * @returns {boolean}
   */
  static costKind(feed) {
    return this.isFiles(feed) && feed.priceKind !== 'rrc';
  }

  /**
   * Кнопка обновления фида из файлов: с остатками на складе — «цены и остатки».
   * @param {object} feed
   * @returns {string}
   */
  static updLabel(feed) {
    return (
      (this.costKind(feed) ? 'Обновить цены' : 'Обновить РРЦ') +
      (feed.files && feed.files.stock ? ' и остатки' : ' из прайса')
    );
  }

  /**
   * Название категории программы.
   * @param {string} id
   * @returns {string}
   */
  static typeName(id) {
    const type = FeedState.types.find(entry => entry.id === id);
    if (type) return type.name;
    return id === this.OTHER || !id ? 'Прочее' : id;
  }

  /**
   * Категории раздела фида по названиям позиций.
   * @param {Array} kinds [[категория, число]]
   * @returns {string}
   */
  static kinds(kinds) {
    return (kinds || []).map(([id, count]) => `${esc(this.typeName(id))} ${count}`).join(' · ');
  }

  /**
   * Название валюты.
   * @param {string} cur
   * @returns {string}
   */
  static curName(cur) {
    return (FeedState.CURS.find(entry => entry[0] === cur) || [cur, cur])[1];
  }

  /**
   * Прайсы фида: несколько файлов; прежний единственный — слот «price».
   * @param {object} feed
   * @returns {object[]}
   */
  static prices(feed) {
    const files = feed.files || {};
    const out = (files.prices || []).slice();
    if (files.price && !out.some(entry => entry.slot === 'price')) out.unshift({ ...files.price, slot: 'price' });
    return out;
  }

  /**
   * Файлы фида одной строкой.
   * @param {object} feed
   * @returns {string}
   */
  static filesShort(feed) {
    const files = feed.files || {};
    const day = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU') : 'нет');
    const prices = this.prices(feed);
    const last = prices
      .map(price => price.at)
      .sort()
      .pop();
    const priceText =
      prices.length > 1 ? `прайсы (${prices.length}) — ${day(last)}` : `прайс — ${prices.length ? day(last) : 'нет'}`;
    return `файлы: парс сайта — ${files.pages ? day(files.pages.at) : 'нет'}, ${priceText}${files.stock ? `, остатки — ${day(files.stock.at)}` : ''}`;
  }

  /**
   * Что в файле остатков.
   * @param {object} stock
   * @returns {string}
   */
  static stockInfo(stock) {
    const units = stock.units != null && stock.units !== stock.inStock ? `, всего ${Fmt.num(stock.units)} шт.` : '';
    return `${Fmt.num(stock.rows)} ${KPGen.plural(stock.rows, 'модель', 'модели', 'моделей')}, в наличии: ${Fmt.num(stock.inStock)}${units}${(stock.whs || []).length ? ` · склады: ${stock.whs.map(esc).join(', ')}` : ''}`;
  }

  /**
   * Число с запятой.
   * @param {*} value
   * @returns {string}
   */
  static dec(value) {
    return String(value).replace('.', ',');
  }
}
