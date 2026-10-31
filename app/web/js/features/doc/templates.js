import { TemplateBase } from './template-base.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { Api } from '../../core/net.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { Translit } from '../../core/translit.js';
import { DocxPage } from './docx-parts.js';

/**
 * Шаблоны КП (папка templates): выбор шаблона и загрузка всего, что в папке шаблона — настроек (template.json), скелета
 * документа (skeleton.js) и основы Word (base.docx).
 */
export class Templates {
  static list = [];
  static cache = {};
  static MAIN = 'pnevmotekh';
  static STORE = 'kp.template';
  static CENTS = 100;
  static A4_TWIPS = [11906, 16838];
  static A4_TOLERANCE = 30;

  /** Список шаблонов с сервера; у КП — выбранный шаблон. */
  static async load() {
    try {
      this.list = await Api.request('/api/templates');
    } catch {
      this.list = [];
    }
    this.pick();
  }

  static _stored() {
    try {
      return localStorage.getItem(this.STORE) || '';
    } catch {
      return '';
    }
  }

  /** У КП всегда выбран шаблон: «Новое КП» и КП из журнала без шаблона получают сохранённый в браузере или основной. */
  static pick() {
    const list = this.list;
    if (!list.length || (S.template && list.some(row => row.id === S.template))) return;
    const stored = this._stored();
    if (list.some(row => row.id === stored)) S.template = stored;
    else S.template = (list.find(row => row.id === this.MAIN) || list[0] || {}).id || '';
  }

  /**
   * Выбранный шаблон КП или null.
   * @returns {object|null}
   */
  static current() {
    return this.list.find(row => row.id === S.template) || null;
  }

  /**
   * Содержимое папки выбранного шаблона КП, если уже загружено (настройки: организация, цвета, логотип), иначе null.
   * @returns {object|null}
   */
  static loadedPack() {
    return this.cache[S.template] || null;
  }

  /**
   * Выбор шаблона в разделе «Оформление КП» и ошибки шаблонов.
   * @returns {string}
   */
  static picker() {
    const good = this.list.filter(row => !row.error);
    const bad = this.list.filter(row => row.error);
    const about = (this.current() || {}).description ? UiKit.tip(esc(this.current().description)) : '';
    const options = good
      .map(row => `<option value="${esc(row.id)}"${row.id === S.template ? ' selected' : ''}>${esc(row.name)}</option>`)
      .join('');
    return `<div class="tplpick"><label class="f"><span>Шаблон КП${about}</span><select data-tpl="1">${options}</select></label>
</div>
    ${bad.map(row => `<p class="msg err">Шаблон «${esc(row.id)}»: ${esc(row.error)} <button class="btn ghost" type="button" data-a="settings">Исправить в «Настройках»</button></p>`).join('')}`;
  }

  /**
   * Сбросить загруженный шаблон (после правки его файлов); без id — все.
   * @param {string} [id]
   */
  static dropCache(id) {
    if (id) delete this.cache[id];
    else for (const key of Object.keys(this.cache)) delete this.cache[key];
  }

  /**
   * Файл шаблона с сервера; нет — ошибка «нет файла …».
   * @param {string} url
   * @param {string} what
   * @returns {Promise<Response>}
   */
  static async fetchOk(url, what) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`нет файла ${what}`);
    return response;
  }

  static async _json(base) {
    try {
      return await (await this.fetchOk(`${base}/template.json`, 'template.json')).json();
    } catch (error) {
      if (/нет файла/.test(error.message)) throw error;
      throw new Error('ошибка в template.json — исправьте в «Настроить шаблон» или верните версию из истории');
    }
  }

  /**
   * Всё содержимое папки шаблона, готовое к сборке документа (загружается один раз).
   * @param {string} id
   * @returns {Promise<object>} {id, base, json, settings, skel, rels, sect, footerPath, addFooter, images}
   */
  static async pack(id) {
    if (this.cache[id]) return this.cache[id];
    const base = `/tpl/${encodeURIComponent(id)}`;
    const json = await this._json(base);
    const skel = KPGen.loadSkeleton(await (await this.fetchOk(`${base}/skeleton.js`, 'skeleton.js')).text());
    const docx = await (await this.fetchOk(`${base}/base.docx`, 'base.docx')).arrayBuffer();
    const word = await TemplateBase.read(docx);
    const settings = KPGen.deepMerge(skel.defaults, json);
    this.cache[id] = { id, base: docx, json, settings, skel, ...word, images: {} };
    return this.cache[id];
  }

  /**
   * Картинка шаблона (страница «Наши клиенты», подпись, шапка): загружается один раз.
   * @param {object} pack
   * @param {string} file
   * @returns {Promise<object|null>} {buf, w, h, ext}
   */
  static async image(pack, file) {
    if (!file) return null;
    if (!(file in pack.images)) {
      try {
        const url = `/tpl/${encodeURIComponent(pack.id)}/${encodeURIComponent(file)}`;
        const buf = await (await this.fetchOk(url, file)).arrayBuffer();
        const bitmap = await createImageBitmap(new Blob([buf]));
        pack.images[file] = { buf, w: bitmap.width, h: bitmap.height, ext: /\.png$/i.test(file) ? 'png' : 'jpg' };
      } catch {
        pack.images[file] = null;
      }
    }
    return pack.images[file];
  }

  static _cm(value) {
    return String(Math.round((value / DocxPage.TWIPS_PER_CM) * this.CENTS) / this.CENTS).replace('.', ',');
  }

  static _format(width, height) {
    const [shortSide, longSide] = this.A4_TWIPS;
    const near = (value, target) => Math.abs(value - target) < this.A4_TOLERANCE;
    if (near(width, shortSide) && near(height, longSide)) return 'А4 книжный';
    if (near(width, longSide) && near(height, shortSide)) return 'А4 альбомный';
    return `${this._cm(width)} × ${this._cm(height)} см`;
  }

  /**
   * Параметры страницы из base.docx — для подсказки в редакторе.
   * @param {string} sect
   * @returns {string}
   */
  static pageInfo(sect) {
    const read = pattern => {
      const found = pattern.exec(sect || '');
      return found ? +found[1] : 0;
    };
    const width = read(/<w:pgSz[^>]*w:w="(\d+)"/);
    const height = read(/<w:pgSz[^>]*w:h="(\d+)"/);
    if (!width || !height) return '';
    const margin = side => this._cm(read(new RegExp(`<w:pgMar[^>]*w:${side}="(\\d+)"`)));
    return `${this._format(width, height)}; поля: левое ${margin('left')}, правое ${margin('right')}, верхнее ${margin('top')}, нижнее ${margin('bottom')} см`;
  }

  /** Выбор шаблона в разделе «Оформление КП». */
  static listen() {
    document.addEventListener('change', event => {
      if (!event.target.dataset.tpl) return;
      S.template = event.target.value;
      try {
        localStorage.setItem(this.STORE, S.template);
      } catch {
        // браузер без хранилища — выбор только в этом КП
      }
      KpForm.render();
      KpState.persist();
      Toast.show(`Шаблон КП: ${(this.current() || {}).name || ''}`);
    });
  }

  /**
   * Свободное имя шаблона: base, base-2, base-3 …
   * @param {string} name название шаблона
   * @returns {string}
   */
  static freeId(name) {
    const base = Translit.slug(name) || 'tpl';
    let id = base;
    let count = 1;
    while (this.list.some(row => row.id === id)) id = `${base}-${++count}`;
    return id;
  }
}
