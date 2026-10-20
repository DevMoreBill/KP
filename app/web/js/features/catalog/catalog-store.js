import { CatalogCache, CatalogSearch } from './catalog-cache.js';

/** Каталог на сервере: список, позиция целиком, сохранение (картинки — файлами на сервер отдела). */
export class CatalogStore {
  static JSON_TYPE = 'application/json; charset=utf-8';

  /**
   * Облегчённые карточки.
   * @returns {Promise<object[]>}
   */
  static async list() {
    return await api('/api/catalog');
  }

  /**
   * Позиция целиком.
   * @param {string} id
   * @returns {Promise<object>}
   */
  static async get(id) {
    return await api(`/api/catalog/${encodeURIComponent(id)}`);
  }

  /**
   * Весь каталог целиком.
   * @returns {Promise<object[]>}
   */
  static async full() {
    return await api('/api/catalog?full=1');
  }

  static async _images(doc) {
    const photo = await ImgUpload.put(doc.photo, imgPlace(doc, 'photo'));
    const logo = await ImgUpload.put(doc.logo, imgPlace(doc, 'logo'));
    const gallery = doc.gallery
      ? await Promise.all(
          doc.gallery.map(async pic => ({ ...pic, ...(await ImgUpload.put(pic, imgPlace(doc, 'gallery', pic))) })),
        )
      : doc.gallery;
    const draw = doc.draw ? await DrawPic.upload(doc.draw, doc) : doc.draw;
    return { ...doc, photo, logo, gallery, draw };
  }

  /**
   * Сохранить позицию; при модерации ответ {pending}. _rev — с какой правки начинали: если её успели изменить, сервер
   * ответит «конфликт».
   * @param {object} doc
   * @returns {Promise<object>}
   */
  static async put(doc) {
    return await this._put(doc, {});
  }

  /**
   * Сохранение КП обновляет цены и историю (без модерации).
   * @param {object} doc
   * @returns {Promise<object>}
   */
  static async putAuto(doc) {
    return await this._put(doc, { 'X-KP-Edit': 'auto' });
  }

  static async _put(doc, edit) {
    const saved = await this._images(doc);
    const headers = {
      'Content-Type': this.JSON_TYPE,
      ...edit,
      ...(saved._rev != null ? { 'X-KP-Rev': String(saved._rev) } : {}),
    };
    const answer = await api(`/api/catalog/${saved.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...saved, _rev: undefined }),
    });
    if (answer && answer.pending) saved._pending = true;
    if (answer && answer.rev != null) saved._rev = answer.rev;
    return saved;
  }
}

/**
 * Поиск карточки каталога по id и по названию: словари строятся один раз на список catCache (подсказки цены спрашивают при
 * каждом нажатии клавиши). Карточки на месте не меняются (обновлённый каталог — новый массив), словари сверяются со списком.
 */
export class CatFind {
  static list = null;
  static size = 0;
  static byId = new Map();
  static byName = new Map();

  static _sync() {
    if (this.list === catCache && this.size === catCache.length) return;
    this.list = catCache;
    this.size = catCache.length;
    this.byId = new Map();
    this.byName = new Map();
    for (const card of catCache) {
      if (!this.byId.has(card.id)) this.byId.set(card.id, card);
      const key = norm(card.name);
      if (!this.byName.has(key)) this.byName.set(key, card);
    }
  }

  /**
   * Карточка по id.
   * @param {string} id
   * @returns {object|null}
   */
  static id(id) {
    if (id == null || id === '') return null;
    this._sync();
    return this.byId.get(id) || null;
  }

  /**
   * Первая карточка с тем же названием без учёта регистра, «ё» и кавычек.
   * @param {string} name
   * @returns {object|null}
   */
  static name(name) {
    this._sync();
    return this.byName.get(norm(name)) || null;
  }
}

/** Каталог в программе: загрузка с кэшем, полная позиция, подсказки названий опций. */
export class Catalog {
  static WARM_SLICE = 12;
  // поиск и список каталога — «Настройки → Значения программы → Каталог, фото, фиды, ИИ»
  static DEFAULTS = [
    [
      [
        'catsearch',
        'Поиск и список каталога',
        'cat',
        'Окно каталога и строка «Быстро добавить из каталога» в разделе «Оборудование».',
      ],
    ],
    [
      [
        'cat.page',
        'catsearch',
        'Строк каталога за раз',
        'num',
        '60',
        {
          unit: 'шт.',
          req: true,
          min: 20,
          max: 500,
          hint: 'Сколько позиций окно каталога показывает сразу; следующие подгружаются при прокрутке вниз. Больше — меньше подгрузок, но на слабом компьютере и телефоне список открывается медленнее (150 строк уже заметно тормозили). Пример: 60.',
        },
      ],
      [
        'cat.qDelay',
        'catsearch',
        'Задержка поиска в каталоге',
        'num',
        '180',
        {
          unit: 'мс',
          req: true,
          min: 0,
          max: 2000,
          hint: 'Сколько программа ждёт после последней нажатой клавиши, прежде чем искать в большом каталоге (больше 2000 позиций). 1000 мс = 1 секунда. Меньше — список обновляется быстрее, но на слабом компьютере набор может «подтормаживать». В маленьком каталоге поиск идёт почти сразу (не дольше 60 мс).',
        },
      ],
      [
        'cat.quickN',
        'catsearch',
        'Подсказок в «Быстро добавить из каталога»',
        'num',
        '8',
        {
          unit: 'шт.',
          req: true,
          min: 3,
          max: 30,
          hint: 'Сколько найденных моделей показывать под строкой быстрого добавления в разделе «Оборудование». Enter добавляет первую.',
        },
      ],
      [
        'cat.priceKeep',
        'catsearch',
        'Хранить цен из прошлых КП',
        'num',
        '50',
        {
          unit: 'шт.',
          req: true,
          min: 5,
          max: 500,
          hint: 'Сколько последних цен модели (из сохранённых КП) каталог помнит у каждой позиции — для подсказки «В прошлых КП» в разделе «Цены и валюта». Более старые цены забываются при следующем сохранении КП с этой моделью.',
        },
      ],
    ],
  ];

  /**
   * Позиция целиком (у облегчённой карточки — запрос на сервер; не вышло — как есть).
   * @param {object} card
   * @returns {Promise<object>}
   */
  static async fullDoc(card) {
    if (!card || !card._light) return card;
    try {
      const doc = await CatalogStore.get(card.id);
      return doc || card;
    } catch {
      return card;
    }
  }

  /** Каталог: из IndexedDB + изменения с сервера; не вышло — целиком с сервера. */
  static async refresh() {
    try {
      catCache = await CatalogCache.load();
    } catch {
      try {
        catCache = await CatalogStore.list();
      } catch {
        catCache = [];
      }
    }
    CatAttrs.mark(catCache);
    CatalogSearch.drop();
    this.renderDatalist();
    this.warm();
  }

  /** Разбор характеристик карточек — заранее, в простое браузера. */
  static warm() {
    let index = 0;
    const list = catCache;
    const idle = window.requestIdleCallback || setTimeout;
    const step = () => {
      const end = performance.now() + this.WARM_SLICE;
      while (index < list.length && performance.now() < end) {
        const card = list[index++];
        if (!card._a) card._a = attrsOf(card);
      }
      if (index < list.length) idle(step);
    };
    idle(step);
  }

  /** Подсказки названий опций и услуг: опции категорий и аксессуары из каталога. */
  static renderDatalist() {
    let box = $('#optNames');
    if (!box) {
      box = document.createElement('datalist');
      box.id = 'optNames';
      document.body.appendChild(box);
    }
    const names = new Set(
      TYPES.flatMap(type => (type.options || []).map(option => (Array.isArray(option) ? option[0] : option.name))),
    );
    catCache.forEach(card => {
      if (typeById(detectCat(card)).role === 'accessory') names.add(card.name); // detectCat ≡ attrsOf(x).cat, без разбора
    });
    box.innerHTML = [...names].map(name => `<option value="${esc(name)}">`).join('');
  }
}
