import { EquipTypes } from './equip-types.js';
import { SpecValues } from './spec-values.js';
import { Str } from './str.js';

/** Параметры позиции из названия, описания и таблицы характеристик (ДГУ: двигатель, генератор, мощность, исполнение). */
export class ItemParse {
  static EXECUTION = [
    [text => /контейнер/.test(text) && /шасси|прицеп/.test(text), 'Контейнер на шасси'],
    [text => /кожух/.test(text) && /шасси|прицеп/.test(text), 'Кожух на шасси'],
    [text => /контейнер/.test(text), 'Блок-контейнер'],
    [text => /шасси|прицеп/.test(text), 'На шасси'],
    [text => /кожух/.test(text), 'В кожухе'],
    [text => /открыт|на раме/.test(text), 'Открытое'],
  ];
  static MAKER = /\b([A-Z]{3,})\b/;
  static BRAND_CUT = /[/,;(]| - | — /;

  /**
   * КВт из текста («15 кВт» → 15); нет — null.
   * @param {*} text
   * @returns {number | null}
   */
  static kw(text) {
    return this._unit(text, /(\d+(?:[.,]\d+)?)\s*кВт/i);
  }

  /**
   * кВА из текста; нет — null.
   * @param {*} text
   * @returns {number | null}
   */
  static kva(text) {
    return this._unit(text, /(\d+(?:[.,]\d+)?)\s*кВА/i);
  }

  static _unit(text, pattern) {
    const match = String(text || '')
      .replace(/ /g, ' ')
      .match(pattern);
    return match ? +match[1].replace(',', '.') : null;
  }

  /**
   * Марка — первое слово до «/ , ; (» и тире.
   * @param {*} text
   * @returns {string}
   */
  static brand(text) {
    return (
      String(text || '')
        .split(this.BRAND_CUT)[0]
        .trim()
        .split(/\s+/)[0] || ''
    );
  }

  /**
   * Параметры позиции (без своих значений менеджера и без типа).
   * @param {object} item
   * @returns {object}
   */
  static extract(item) {
    const ctx = this._context(item);
    const attrs = {
      ...this._names(item),
      ...this._engine(ctx),
      alternator: this.brand(this._partValue(ctx, /альтернатор|генератор перем/, /альтернатор/)),
      controller: this._controller(ctx),
      ...this._power(item, ctx),
      execution: (this.EXECUTION.find(([test]) => test(ctx.text)) || [null, ''])[1],
    };
    const voltage = ctx.find(/напряжен/);
    attrs.voltage = voltage ? voltage.v : '';
    const amps = (item.name || '').match(/(\d+)\s*А\b/);
    if (amps) attrs.amps = +amps[1];
    return attrs;
  }

  static _context(item) {
    const rows = (item.groups || []).flatMap(group =>
      (group.rows || []).map(row => ({ g: Str.norm(group.name), k: Str.norm(row.k), v: String(row.v || '').trim() })),
    );
    const features = item.features || [];
    const words = [
      item.name,
      item.spec,
      item.pageTitle,
      item.photoCaption,
      ...features.map(feature => `${feature.label} ${feature.text}`),
    ];
    return {
      find: (pattern, groupRx) => rows.find(row => pattern.test(row.k) && (!groupRx || groupRx.test(row.g))),
      feat: pattern => features.find(feature => pattern.test(Str.norm(feature.label))),
      text: Str.norm(words.join(' ')),
    };
  }

  static _names(item) {
    const maker = ((item.hint && item.hint.model) || item.name || '').match(this.MAKER);
    const modelMatch = (item.name || '').match(/\b(HG\s*\d+\s*[A-ZА-Яа-я_]{0,4})/i);
    const model = modelMatch ? modelMatch[1].replace(/\s+/g, ' ').trim() : '';
    const series = model.match(/\d+\s*([A-ZА-Я_]+)/i);
    return {
      maker: maker ? maker[1] : '',
      model,
      series: series
        ? series[1].toUpperCase().replace(/В/g, 'B').replace(/С/g, 'C').replace(/А/g, 'A').replace(/_A$/, '')
        : '',
    };
  }

  // строка «марка / модель» узла в своей группе таблицы, иначе строка с названием узла, иначе особенность позиции
  static _partRow(ctx, groupRx, nameRx) {
    return ctx.find(/марка|модель|производител/, groupRx) || ctx.find(nameRx);
  }

  static _partValue(ctx, groupRx, nameRx) {
    const row = this._partRow(ctx, groupRx, nameRx);
    return row ? row.v : ctx.feat(nameRx)?.text || '';
  }

  static _engine(ctx) {
    const row = this._partRow(ctx, /двигател/, /двигател/);
    return {
      engine: this.brand(row ? row.v : ctx.feat(/двигател/)?.text || ''),
      engineModel: row && /\//.test(row.v) ? row.v.split('/')[1].trim() : '',
    };
  }

  static _controller(ctx) {
    const row = ctx.find(/панель|контроллер/);
    if (row) return row.v.split(/[,;(]/)[0].trim();
    return (ctx.feat(/панель|контроллер/)?.text || '').split(/[—,.]/)[0].trim();
  }

  static _power(item, ctx) {
    const prime = ctx.find(/номинальн|основн|prime|длительн/);
    const standby = ctx.find(/максимальн|резервн|standby|аварийн/);
    return {
      kw: this.kw(prime && prime.v) ?? this.kw(item.spec) ?? this.kw(item.name) ?? null,
      kwMax: this.kw(standby && standby.v) ?? null,
      kva: this.kva(prime && prime.v) ?? this.kva(item.spec) ?? null,
    };
  }
}

/**
 * Разбор характеристик карточек каталога — один раз на карточку: подбор и поиск перебирают весь каталог на каждое нажатие,
 * а разбор строк характеристик дорогой. Карточка каталога не меняется на месте — правка приходит новой карточкой
 * (CatalogCache), окно каталога сбрасывает разбор (CatalogIndex.forget). Позиции КП и элементы станций — не карточки.
 */
export class CatAttrs {
  static cards = new WeakSet();

  /**
   * Отметить карточки каталога.
   * @param {object[]} list
   */
  static mark(list) {
    for (const card of list || []) if (card && typeof card === 'object') this.cards.add(card);
  }

  /**
   * Запомненный разбор карточки или null.
   * @param {object} card
   * @returns {object | null}
   */
  static of(card) {
    return card && card._a && this.cards.has(card) ? card._a : null;
  }

  /**
   * Запомнить разбор у карточки каталога.
   * @param {object} card
   * @param {object} attrs
   * @returns {object}
   */
  static keep(card, attrs) {
    if (card && this.cards.has(card)) card._a = attrs;
    return attrs;
  }
}

/**
 * Память разбора позиций КП на один проход отрисовки (окно «Экономика сделки» читает характеристики позиций сотни раз за
 * перерисовку); вне ItemAttrs.during разбор — каждый раз (позиция могла измениться).
 */
export class ItemAttrs {
  static gen = 0;
  // eslint-disable-next-line id-length -- включена ли память (прежнее имя)
  static on = false;
  static memo = new WeakMap();

  /**
   * Выполнить task с памятью разбора.
   * @param {Function} task
   * @returns {*}
   */
  static during(task) {
    this.gen++;
    this.on = true;
    try {
      return task();
    } finally {
      this.on = false;
    }
  }

  /**
   * Разбор позиции (в проходе — из памяти).
   * @param {object} item
   * @returns {object}
   */
  static of(item) {
    if (!this.on || !item || typeof item !== 'object') return Attrs.parse(item);
    const memo = this.memo.get(item);
    if (memo && memo.g === this.gen) return memo.a;
    const attrs = Attrs.parse(item);
    this.memo.set(item, { g: this.gen, a: attrs });
    return attrs;
  }
}

/** Параметры позиции или карточки: разбор + свои значения менеджера + значения из таблицы характеристик, тип. */
export class Attrs {
  /**
   * @param {object} item
   * @returns {object}
   */
  static of(item) {
    return CatAttrs.of(item) || ItemAttrs.of(item);
  }

  /**
   * Разобрать заново.
   * @param {object} item
   * @returns {object}
   */
  static parse(item) {
    const attrs = ItemParse.extract(item);
    const own = item.attrs || {};
    const empty = key => own[key] === '' || own[key] == null;
    for (const key in own) if (!empty(key)) attrs[key] = own[key];
    attrs.cat = EquipTypes.detect(item);
    const type = EquipTypes.byId(attrs.cat);
    if ((item.groups || []).length) {
      const spec = SpecValues.fromSpec(item, type);
      for (const key in spec) if (empty(key)) attrs[key] = spec[key];
    }
    attrs.type = type.name;
    return CatAttrs.keep(item, attrs);
  }
}
