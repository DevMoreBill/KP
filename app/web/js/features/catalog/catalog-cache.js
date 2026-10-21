import { Str } from '../../core/str.js';
import { Api } from '../../core/net.js';
/**
 * Каталог в браузере для 20 000+ позиций: облегчённые карточки хранятся в IndexedDB вместе с номером последнего изменения
 * (seq) и меткой поколения базы (epoch). При запуске и после правок программа спрашивает у сервера только изменённое
 * (/api/catalog/sync?since=…). Без IndexedDB (приватный режим) — каталог целиком с сервера.
 */
export class CatalogCache {
  static NAME = 'kp-catalog';
  static VER = 2; // 2 — карточка отдельной записью: после правки пишутся только изменённые, а не весь каталог
  static META = 'meta';
  static ITEMS = 'items';
  static KEY = 'cat';
  static SAVE_DELAY = 1500;
  static TEMP = ['_a', '_hay', '_nv', '_sup', '_pq'];
  static COLL = new Intl.Collator('ru');
  static snap = null; // {epoch, seq, items}
  static timer = 0;
  static dirty = null; // что записать: {full} или {put: Map id → карточка, del: Set id}
  static dbPromise = null;

  static _db() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('нет IndexedDB'));
        return;
      }
      const request = indexedDB.open(this.NAME, this.VER);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name); // прежний снимок — загрузится заново
        db.createObjectStore(this.META);
        db.createObjectStore(this.ITEMS, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB занята'));
    }).catch(error => {
      this.dbPromise = null;
      throw error;
    });
    return this.dbPromise;
  }

  static _byName(items) {
    return items.sort((first, second) => this.COLL.compare(String(first.name || ''), String(second.name || '')));
  }

  static async _read() {
    try {
      const db = await this._db();
      return await new Promise(resolve => {
        const trans = db.transaction([this.META, this.ITEMS]);
        let meta = null;
        let items = null;
        const done = () => {
          if (meta === null || items === null) return;
          resolve(meta && meta.seq ? { ...meta, items: this._byName(items) } : null);
        };
        const metaReq = trans.objectStore(this.META).get(this.KEY);
        metaReq.onsuccess = () => {
          meta = metaReq.result || false;
          done();
        };
        metaReq.onerror = () => resolve(null);
        const itemsReq = trans.objectStore(this.ITEMS).getAll();
        itemsReq.onsuccess = () => {
          items = itemsReq.result || [];
          done();
        };
        itemsReq.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  static _markFull() {
    this.dirty = { full: true };
  }

  // отметить, что записать: изменённые и удалённые карточки
  static _markItems(items, gone) {
    const dirty = this.dirty;
    if (dirty && dirty.full) return;
    const next = dirty || { put: new Map(), del: new Set() };
    for (const item of items) {
      next.put.set(item.id, item);
      next.del.delete(item.id);
    }
    for (const id of gone) {
      next.del.add(id);
      next.put.delete(id);
    }
    this.dirty = next;
  }

  // сохранить в IndexedDB — с задержкой и в свободное время
  static _save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (window.requestIdleCallback || setTimeout)(() => this._write()), this.SAVE_DELAY);
  }

  static async _write() {
    const snap = this.snap;
    const dirty = this.dirty;
    if (!snap || !dirty) return;
    this.dirty = null;
    try {
      const db = await this._db();
      const trans = db.transaction([this.META, this.ITEMS], 'readwrite');
      const store = trans.objectStore(this.ITEMS);
      if (dirty.full) {
        store.clear();
        for (const item of snap.items) store.put(this.clean(item));
      } else {
        for (const item of dirty.put.values()) store.put(this.clean(item));
        for (const id of dirty.del) store.delete(id);
      }
      trans.objectStore(this.META).put({ epoch: snap.epoch, seq: snap.seq }, this.KEY);
      trans.onerror = () => this._markFull(); // не записалось — в следующий раз весь каталог
    } catch {
      // нет места или приватный режим — каталог просто загрузится с сервера в следующий раз
    }
  }

  /**
   * Карточка без служебных полей окна каталога (они пересчитываются).
   * @param {object} card
   * @returns {object}
   */
  static clean(card) {
    if (!this.TEMP.some(key => card[key])) return card;
    const copy = { ...card };
    delete copy._a;
    delete copy._hay;
    delete copy._nv;
    delete copy._sup;
    delete copy._pq;
    return copy;
  }

  /**
   * Копия без одного служебного поля (порядок остальных полей — как был).
   * @param {object} value
   * @param {string} key
   * @returns {object}
   */
  static omit(value, key) {
    const copy = { ...value };
    delete copy[key];
    return copy;
  }

  /**
   * Применить изменения: заменить и добавить карточки, убрать удалённые.
   * @param {object} snap {epoch, seq, items}
   * @param {object} changes ответ /api/catalog/sync
   * @returns {object} новый снимок
   */
  static apply(snap, changes) {
    if (!changes.items.length && !changes.gone.length) return { ...snap, seq: changes.seq };
    const gone = new Set(changes.gone);
    const byId = new Map(changes.items.map(card => [card.id, card]));
    const items = [];
    for (const card of snap.items) {
      if (gone.has(card.id)) continue;
      const fresh = byId.get(card.id);
      if (fresh) {
        items.push(fresh);
        byId.delete(card.id);
      } else items.push(card);
    }
    for (const card of byId.values()) items.push(card);
    if (byId.size) this._byName(items);
    return { epoch: changes.epoch, seq: changes.seq, items };
  }

  /**
   * Облегчённые карточки каталога: из памяти или IndexedDB + изменения с сервера.
   * @returns {Promise<object[]>}
   */
  static async load() {
    const old = this.snap || (await this._read());
    const query = old && old.seq ? `?since=${old.seq}&epoch=${encodeURIComponent(old.epoch || '')}` : '?since=0';
    const changes = await Api.request(`/api/catalog/sync${query}`);
    const changed = changes.full || changes.items.length || changes.gone.length || !old || old.seq !== changes.seq;
    if (changed) this._mark(old, changes);
    this.snap = changes.full
      ? { epoch: changes.epoch, seq: changes.seq, items: changes.items }
      : this.apply(old, changes);
    if (changed) this._save();
    return this.snap.items;
  }

  static _mark(old, changes) {
    if (changes.full || !old || (this.dirty && this.dirty.full)) this._markFull();
    else this._markItems(changes.items, changes.gone);
  }

  /** Забыть сохранённое (например, после замены базы). */
  static async forget() {
    this.snap = null;
    this.dirty = null;
    try {
      const db = await this._db();
      const trans = db.transaction([this.META, this.ITEMS], 'readwrite');
      trans.objectStore(this.META).delete(this.KEY);
      trans.objectStore(this.ITEMS).clear();
    } catch {
      // нет IndexedDB
    }
  }
}

/** Поиск по характеристикам — на сервере: id позиций, где есть все слова запроса (браузер ищет сам по названию и модели). */
export class CatalogSearch {
  static cache = new Map(); // запрос → Set(id); последние KEEP
  static KEEP = 30;
  static MIN_CHARS = 2;

  /**
   * Нормализованный запрос.
   * @param {string} query
   * @returns {string}
   */
  static key(query) {
    return Str.norm(query || '').trim();
  }

  /**
   * Ответ на запрос уже есть.
   * @param {string} query
   * @returns {boolean}
   */
  static has(query) {
    return this.cache.has(this.key(query));
  }

  /**
   * Найденное сервером для запроса (или null).
   * @param {string} query
   * @returns {Set<string>|null}
   */
  static ids(query) {
    return this.cache.get(this.key(query)) || null;
  }

  /**
   * Спросить сервер.
   * @param {string} query
   * @returns {Promise<Set<string>|null>}
   */
  static async ask(query) {
    const key = this.key(query);
    if (key.replace(/\s/g, '').length < this.MIN_CHARS) return null;
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const answer = await Api.request(`/api/catalog/search?q=${encodeURIComponent(key)}`);
      const ids = new Set(answer.ids || []);
      this.cache.set(key, ids);
      if (this.cache.size > this.KEEP) this.cache.delete(this.cache.keys().next().value);
      return ids;
    } catch {
      return null;
    }
  }

  /** Забыть ответы (каталог изменился). */
  static drop() {
    this.cache.clear();
  }
}
