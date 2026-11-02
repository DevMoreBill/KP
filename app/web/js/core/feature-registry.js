import { Api } from './net.js';
import { FEATURE_HOW } from './feature-help.js';

/**
 * Функции программы, которые администратор включает и выключает («Настройки → Функции программы»; сервер: app/features.py):
 * включена ли и кому доступна — всем, только администратору, выбранным менеджерам. Сервер присылает готовый ответ для этого
 * пользователя: FEAT.on(ключ) — доступна ли; недоступная прячется из интерфейса, её адреса на сервере закрыты. Данные
 * выключенной функции не удаляются. Последние значения хранятся в браузере.
 */
export class FeatureRegistry {
  static STORE = 'kp.features';

  constructor() {
    this.defs = [];
    this.groups = [];
    this.vals = FeatureRegistry._stored();
  }

  static _stored() {
    try {
      return JSON.parse(localStorage.getItem(FeatureRegistry.STORE) || '{}') || {};
    } catch {
      return {};
    }
  }

  /**
   * @param {string} id
   * @param {string} title
   * @returns {FeatureRegistry}
   */
  group(id, title) {
    this.groups.push({ id, title });
    return this;
  }

  /**
   * @param {{key: string, group: string, label: string, hint: string, off?: string, needs?: string}} def hint — что делает,
   *   off — что пропадёт, если выключить, needs — без какой функции не работает
   * @returns {FeatureRegistry}
   */
  add(def) {
    this.defs.push(def);
    return this;
  }

  /**
   * Подробная инструкция к выключателю.
   * @param {string} key
   * @returns {string}
   */
  how(key) {
    return FEATURE_HOW[key] || '';
  }

  /**
   * @param {string} key
   * @returns {object | undefined}
   */
  get(key) {
    return this.defs.find(def => def.key === key);
  }

  // eslint-disable-next-line kp/jsdoc, id-length -- прежнее имя (им пользуются все разделы): доступна ли функция пользователю
  on(key) {
    const def = this.get(key);
    if (def && def.needs && !this.on(def.needs)) return false;
    return this.vals[key] !== false;
  }

  /**
   * Ответ сервера — в программу и в браузер.
   * @param {*} values
   */
  use(values) {
    this.vals = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    try {
      localStorage.setItem(FeatureRegistry.STORE, JSON.stringify(this.vals));
    } catch {
      // без хранилища браузера
    }
  }

  /** Загрузить с сервера (недоступен — остаются последние значения). */
  async load() {
    try {
      this.use(await Api.request('/api/features'));
    } catch {
      // сервер недоступен
    }
  }

  /** Права изменились (вход администратора, другой менеджер на устройстве) — перечитать; разделы перерисуются (kp:features). */
  async refresh() {
    await this.load();
    document.dispatchEvent(new Event('kp:features'));
  }
}
