// КП, которое сейчас открыто (S), черновик в браузере, новое КП и итоги. S меняется только через KpState.replace — ES-модули
// видят новое значение сразу (живая привязка export let). Новое КП берёт «Значения программы» КП — они регистрируются раньше.
import './defaults-srv.js';
import './defaults-kp.js';
import { CoverSync } from '../ui/step-cover.js';
import { StationAuto, StationName } from '../features/kit/station-auto.js';
import { Kit } from '../features/kit/kit.js';
import { CatalogEditor } from '../features/catalog/catalog-edit.js';
import { DefRegistry } from './defaults.js';
import { $, Uid, today } from './util.js';
import { KpConditions } from './conditions.js';

/**
 * Черновик КП в браузере (на случай закрытия вкладки). Большие картинки (data:, 3D-виды и листы чертежа станции —
 * мегабайты) хранятся отдельными записями и пишутся один раз: иначе каждая правка КП ждала бы запись нескольких мегабайт.
 * В черновике вместо картинки — ссылка REF+номер.
 */
export class LocalDraft {
  static KEY = 'kp.draft';
  static TABS = 'kp.tabs';
  /** другие открытые КП для записи вместе с текущим (KpTabs) — функция или null */
  static tabs = null;
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
    localStorage.setItem(this.KEY, this._text(state, used));
    this._others(rest => this._text(rest, used));
    this.sweep(used);
  }

  /**
   * Черновик без картинок (не хватило места в браузере).
   * @param {object} state
   */
  static saveLite(state) {
    localStorage.setItem(this.KEY, JSON.stringify(state));
    this._others(rest => JSON.stringify(rest, (key, value) => (this._big(value) ? null : value)));
    this.sweep(new Set());
  }

  /**
   * Другие открытые КП (вкладки) — из черновика браузера.
   * @returns {object | null}
   */
  static loadTabs() {
    return this._parse(localStorage.getItem(this.TABS));
  }

  static _big(value) {
    return typeof value === 'string' && value.length >= this.MIN && value.startsWith('data:');
  }

  static _text(state, used) {
    return JSON.stringify(state, (key, value) => (this._big(value) ? this.REF + this.put(value, used) : value));
  }

  // КП других вкладок — отдельной записью; картинки у всех общие, поэтому sweep видит и их
  static _others(write) {
    const rest = this.tabs ? this.tabs() : null;
    if (rest) localStorage.setItem(this.TABS, write(rest));
    else localStorage.removeItem(this.TABS);
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
    return this._parse(localStorage.getItem(this.KEY));
  }

  static _parse(text) {
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
      if (event.key == null || event.key === this.KEY || event.key === this.TABS || event.key.startsWith(this.PRE))
        this.ids.clear();
    });
  }
}

/** Новое КП, позиция, черновик в браузере, итоги. */
export class KpState {
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
  // отложенная запись черновика (persist)
  static saveTimer = null;

  /**
   * Пустая позиция КП.
   * @returns {object}
   */
  static newItem() {
    return {
      id: Uid.next(),
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
      const value = DefRegistry.value(`mgr.${key}`);
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
      city: DefRegistry.value('kp.city') || '',
      vat: DefRegistry.num('kp.vat', this.VAT),
      showClients: DefRegistry.value('kp.showClients') !== false,
      cover: { title: '', model: '', desc: '', kpis: [{}, {}, {}, {}], touched: false },
      pricing: this._pricing(),
      items: [],
      conditions: KpConditions.LIST.map(cond => ({
        label: cond[0],
        value: DefRegistry.value(`cond.${cond[0]}`) || '',
      })),
      // текст условий из «Умолчаний» — как автоматический: «Экономика сделки» заменит его своим расчётом, пока его не правили
      condAuto: Object.fromEntries(
        KpConditions.LIST.map(cond => [cond[0], DefRegistry.value(`cond.${cond[0]}`)]).filter(pair => pair[1]),
      ),
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
      cur: DefRegistry.value('kp.cur') || 'RUB',
      rates: { USD: '', EUR: '', CNY: '' },
      rateDate: '',
      rateSrc: '',
      margin: this.MARGIN,
      mode: 'margin',
      costNoVat: false,
      round: DefRegistry.value('kp.round') || '1',
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
      if (draft) state = this.revive(draft);
    } catch {
      // черновик испорчен — что успели разобрать
    }
    return state;
  }

  /**
   * КП из сохранённого вида: вложенные части — поверх нового КП.
   * @param {object} raw
   * @returns {object}
   */
  static revive(raw) {
    const state = Object.assign(this.fresh(), raw);
    this._fill(state);
    return state;
  }

  /** Черновик в браузере — сразу, без задержки (перед переключением КП). */
  static flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this._saveDraft();
  }

  static _fill(state) {
    this._merge(state);
    state.items.forEach(item => {
      item._busy = false;
      item._srcImg = null;
      item.options = item.options || [];
      item.attrs = item.attrs || {};
    });
  }

  // вложенные части КП прежних версий и сокращённых записей — поверх нового КП
  static _merge(state) {
    state.items = state.items || [];
    state.pricing = Object.assign(this.fresh().pricing, state.pricing || {});
    state.contact = Object.assign(this.fresh().contact, state.contact || {});
    state.object = Object.assign(this.fresh().object, state.object || {});
    state.manager = Object.assign(this.defManager(), state.manager || {});
  }

  /** Состав и титул — по позициям; черновик в браузере — с задержкой (правка позиции каталога его не трогает). */
  static persist() {
    if (CatalogEditor.session) return;
    // закупка сборки — по текущим курсам; параметры станции — по составу
    S.items.forEach(item => {
      Kit.sync(item);
      StationAuto.fill(item);
      StationName.apply(item);
    });
    CoverSync.run();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._saveDraft();
    }, this.SAVE_MS);
  }

  static _saveDraft() {
    if (CatalogEditor.session) return;
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

  /**
   * Открыть другое КП (новое, из журнала, черновика).
   * @param {object} state
   * @returns {object}
   */
  static replace(state) {
    this._merge(state);
    S = state;
    return S;
  }
}

if (typeof window !== 'undefined') LocalDraft.watch();

// eslint-disable-next-line id-length -- КП, которое сейчас открыто: им пользуются все разделы
export let S = KpState.restore();
