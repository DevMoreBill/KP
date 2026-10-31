import { StationRules } from '../rules/station-rules.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { ImageFiles } from '../catalog/images.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { StationDrawing } from '../draw/station-drawing.js';
import { Uid } from '../../core/util.js';
import { StationView3D } from '../draw/station-view3d.js';
import { StationRender } from '../view/station-render.js';
import { PhotoTint } from '../view/photo-tint.js';
import { DrawPic } from '../kit/draw-pic.js';
import { EskdFont } from '../eskd/eskd-font.js';
import { KpState, S } from '../../core/state.js';
import { KpForm } from '../../core/kp-form.js';
import { StationSize } from '../kit/station-size.js';
import { Kit } from '../../core/kit.js';
import { StationPlan } from '../req/station-plan.js';
import { StationMeta } from './station-meta.js';
/**
 * Картинки станции для КП по расстановке: 3D-вид — главное фото, виды снаружи с четырёх сторон, габаритный чертёж (все
 * листы) и схема — в изображениях после характеристик. Своё фото менеджера не заменяется; убранное менеджером — выключает
 * «в КП». Пересборка — после паузы, по очереди.
 */
export class StationImages {
  static busy = new Set();
  /** своя пауза у каждой станции: быстрая правка двух станций подряд пересобирает обе */
  static timers = new Map();
  /** пересборка — по очереди (3D-вид и листы считаются долго) */
  static queue = Promise.resolve();
  /** позиция → почему изображения станции не попадут в КП */
  static issues = new Map();
  /** ракурсы вида снаружи: ключ, азимут камеры (°: 0 — спереди, 90 — слева, −90 — справа, 180 — сзади), подпись */
  /** пересборка — после полутора секунд тишины (не на каждое нажатие при наборе) */
  static WAIT = 1500;
  /** проверка, закончилась ли пересборка станции, начатая не очередью (вкладка «Компоновка») */
  static IDLE_MS = 100;
  static ERROR_MAX = 120;
  static QUALITY = 0.9;
  static OPTION = { stdraw: 'draw', stschema: 'scheme', stout: 'out' };

  /**
   * Что не так с изображениями станций текущего КП.
   * @returns {string[]} «Станция …: …»
   */
  static problems() {
    return S.items
      .filter(item => this.issues.has(item.id))
      .map(item => `${String(item.name || '').trim() || 'Станция'}: ${this.issues.get(item.id)}`);
  }

  /**
   * Перед сохранением КП: изображения не готовы — спросить.
   * @returns {boolean} сохранять
   */
  static confirmSave() {
    const list = this.problems();
    return !list.length || confirm(`Изображения станции не готовы:\n\n${list.join('\n')}\n\nСохранить КП без них?`);
  }

  /**
   * Картинки станции заново по расстановке.
   * @param {object} item
   * @returns {Promise<boolean>} что-то изменилось
   */
  static async sync(item) {
    if (!StationPlan.enabled(item) || !Kit.has(item) || this.busy.has(item.id)) return false;
    StationSize.apply(item);
    const plan = StationPlan.plan(item);
    const opts = StationPlan.opts(item);
    item.gallery = Array.isArray(item.gallery) ? item.gallery : [];
    const none = this._none(plan);
    this._noteIssue(item, plan, opts, none);
    const scheme = StationMeta.scheme(plan);
    let changed = this._dropOff(item, opts, { none, scheme });
    if (none) return changed;
    this.busy.add(item.id);
    try {
      changed = (await this._render(item, plan, opts, scheme)) || changed;
    } catch (error) {
      // КП собирается без них
      this.issues.set(
        item.id,
        `изображения не собрались (${String((error && error.message) || error).slice(0, this.ERROR_MAX)})`,
      );
    } finally {
      this.busy.delete(item.id);
    }
    return changed;
  }

  /** нечего рисовать — прежние картинки не годятся */
  static _none(plan) {
    return plan.level === 'none' || plan.level === 'error' || !plan.geo || !plan.geo.ext;
  }

  static _noteIssue(item, plan, opts, none) {
    this.issues.delete(item.id);
    if (!none || !(opts.photo || opts.draw || opts.out) || plan.level === 'none') return;
    const error = (plan.issues || []).find(issue => issue.level === 'error');
    this.issues.set(
      item.id,
      `компоновка не собрана${error ? ` (${String(error.text).replace(/\.$/, '')})` : ''} — 3D-вида и чертежа в КП не будет; исправьте на вкладке «Компоновка»`,
    );
  }

  /** выключенное и то, что нельзя нарисовать, — убрать из главного фото и изображений */
  static _dropOff(item, opts, { none, scheme }) {
    let changed = false;
    if ((!opts.photo || none) && item.photo && item.photo.gen === 'st3d') {
      item.photo = null;
      changed = true;
    }
    const off = { stout: !opts.out || none, stdraw: !opts.draw || none, stschema: !opts.scheme || none || !scheme };
    for (const gen of Object.keys(off)) {
      if (off[gen] && item.gallery.some(pic => pic && pic.gen === gen)) {
        item.gallery = item.gallery.filter(pic => !(pic && pic.gen === gen));
        changed = true;
      }
    }
    return changed;
  }

  /** шрифт и свои рисунки — внутрь листов; цвета по фото изменили расстановку — заново; затем 3D-вид, виды, листы, схема */
  static async _render(item, plan, opts, scheme) {
    await EskdFont.load();
    await DrawPic.load(item);
    if (await PhotoTint.load(item)) {
      this.busy.delete(item.id);
      return this.sync(item);
    }
    const meta = StationMeta.meta(item, plan);
    const ctx = { opts, scheme, hash: plan.hash + StationRender.brandKey(), sheetsKey: this.key(plan, meta) };
    const dropped = this._dropPartPhoto(item, opts);
    const photo = await this._photo(item, plan, meta, ctx);
    return (await this._extras(item, plan, meta, ctx)) || photo || dropped;
  }

  /** главным было фото элемента состава, подставленное мастером, — его место займёт 3D-вид */
  static _dropPartPhoto(item, opts) {
    if (!opts.photo || !item.photo || item.photo.gen === 'st3d' || !this.partPhoto(item)) return false;
    item.photo = null;
    return true;
  }

  /** виды снаружи (только WebGL), листы чертежа, схема */
  static async _extras(item, plan, meta, { opts, scheme, hash, sheetsKey }) {
    let changed = false;
    if (opts.out && StationRender.ok() && (await this.outside(item, plan, meta, hash, opts))) changed = true;
    if (opts.draw && (await this.drawing(item, plan, meta, sheetsKey))) changed = true;
    if (opts.scheme && scheme && (await this._scheme(item, plan, meta, { scheme, sheetsKey }))) changed = true;
    return changed;
  }

  /** 3D-вид главным фото; WebGL-вид (отпечаток с «.g») не заменяется SVG-видом на компьютере без WebGL2 */
  static async _photo(item, plan, meta, { opts, hash }) {
    const photo = item.photo;
    if (!opts.photo || (photo && photo.gen !== 'st3d') || this._fresh(photo, hash)) return false;
    const webgl = await StationRender.image(plan, meta);
    const image = webgl || (await this.raster(StationView3D.svg(plan, meta), 'image/jpeg'));
    item.photo = { ...image, gen: 'st3d', hash: webgl ? `${hash}.g` : hash };
    if (!webgl && StationRender.fails)
      this.issues.set(
        item.id,
        '3D-вид не построен (сбой WebGL) — в КП упрощённый вид и чертёж; повтор — при следующем построении',
      );
    return true;
  }

  static _fresh(photo, hash) {
    return (
      photo && photo.gen === 'st3d' && (photo.hash === `${hash}.g` || (photo.hash === hash && !StationRender.ok()))
    );
  }

  /** схема (пневматическая — компрессорная, гидравлическая — насосная) — после чертежа */
  static async _scheme(item, plan, meta, { scheme, sheetsKey }) {
    const place = item.gallery.findIndex(pic => pic && pic.gen === 'stschema');
    if (place >= 0 && item.gallery[place].hash === sheetsKey) return false;
    const image = await this.raster(scheme.cls.svg(plan, meta), 'image/png');
    const old = place >= 0 ? item.gallery[place] : null;
    const pic = {
      id: old ? old.id : Uid.next(),
      ...image,
      caption: scheme.name,
      slot: '',
      at: '',
      on: old ? old.on !== false : true,
      wide: 'full',
      gen: 'stschema',
      hash: sheetsKey,
    };
    if (old) item.gallery[place] = pic;
    else item.gallery.splice(this.after(item.gallery, 'stdraw'), 0, pic);
    item.page = true;
    return true;
  }

  /**
   * Виды снаружи (gen 'stout', view — ракурс): каждый — своей картинкой на прежнем месте, по два в ряд; убранный
   * менеджером ракурс больше не вставляется.
   * @param {object} item
   * @param {object} plan
   * @param {object} meta
   * @param {string} hash отпечаток расстановки
   * @param {object} opts
   * @returns {Promise<boolean>} что-то изменилось
   */
  static async outside(item, plan, meta, hash, opts) {
    let changed = false;
    // прежний один вид снаружи — заменяется четырьмя
    item.gallery = item.gallery.filter(pic => !(pic && pic.gen === 'stout' && !pic.view));
    for (const [view, angle, caption] of StationPlan.VIEWS) {
      if (!opts.outSkip.includes(view) && (await this._view(item, plan, meta, { view, angle, caption, hash })))
        changed = true;
    }
    return changed;
  }

  static async _view(item, plan, meta, { view, angle, caption, hash }) {
    const place = item.gallery.findIndex(pic => pic && pic.gen === 'stout' && pic.view === view);
    if (place >= 0 && item.gallery[place].hash === `${hash}.o${angle}`) return false;
    const image = await StationRender.image(plan, meta, 'out', angle);
    if (!image) return false;
    const old = place >= 0 ? item.gallery[place] : null;
    const pic = {
      id: old ? old.id : Uid.next(),
      ...image,
      caption,
      slot: '',
      at: '',
      on: old ? old.on !== false : true,
      wide: 'half',
      gen: 'stout',
      view,
      hash: `${hash}.o${angle}`,
    };
    if (old) item.gallery[place] = pic;
    else item.gallery.splice(this._outsidePlace(item.gallery), 0, pic);
    item.page = true;
    return true;
  }

  /** новый вид снаружи — после прежних видов, иначе перед чертежом и схемой, иначе в конец */
  static _outsidePlace(gallery) {
    if (gallery.some(pic => pic && pic.gen === 'stout')) return this.after(gallery, 'stout');
    const sheet = gallery.findIndex(pic => pic && (pic.gen === 'stdraw' || pic.gen === 'stschema'));
    return sheet >= 0 ? sheet : gallery.length;
  }

  /**
   * Листы габаритного чертежа в изображениях позиции: каждый — отдельной картинкой («лист N»), на прежнем месте; лишние —
   * убираются, скрытый менеджером лист остаётся скрытым.
   * @param {object} item
   * @param {object} plan
   * @param {object} meta
   * @param {string} sheetsKey отпечаток листов
   * @returns {Promise<boolean>} что-то изменилось
   */
  static async drawing(item, plan, meta, sheetsKey) {
    const drawn = item.gallery.filter(pic => pic && pic.gen === 'stdraw');
    const skip = StationPlan.opts(item).skip;
    if (this._sheetsFresh(drawn, skip, sheetsKey)) return false;
    const sheets = StationDrawing.sheets(plan, meta);
    const keep = new Map(drawn.map(pic => [pic.sheet || 1, pic]));
    const add = [];
    for (let page = 0; page < sheets.length; page++) {
      if (!skip.includes(page + 1)) add.push(await this._sheet(sheets, page, keep.get(page + 1), sheetsKey));
    }
    const place = item.gallery.findIndex(pic => pic && pic.gen === 'stdraw');
    item.gallery = item.gallery.filter(pic => !(pic && pic.gen === 'stdraw'));
    item.gallery.splice(
      place >= 0 ? Math.min(place, item.gallery.length) : this.before(item.gallery, 'stschema'),
      0,
      ...add,
    );
    item.page = true;
    return true;
  }

  static _sheetsFresh(drawn, skip, sheetsKey) {
    const total = drawn.length ? drawn[0].sheets || 1 : 0;
    return (
      drawn.length > 0 &&
      drawn.every(pic => pic.hash === sheetsKey && pic.sheets === total) &&
      drawn.length === total - skip.filter(page => page <= total).length
    );
  }

  static async _sheet(sheets, page, old, sheetsKey) {
    const image = await this.raster(sheets[page], 'image/png');
    return {
      id: old ? old.id : Uid.next(),
      ...image,
      caption: sheets.length > 1 ? `Габаритный чертёж, лист ${page + 1}` : 'Габаритный чертёж',
      slot: '',
      at: '',
      on: old ? old.on !== false : true,
      wide: 'full',
      gen: 'stdraw',
      sheet: page + 1,
      sheets: sheets.length,
      hash: sheetsKey,
    };
  }

  /**
   * Место сразу после последней картинки gen (нет таких — в конец).
   * @param {object[]} gallery
   * @param {string} gen
   * @returns {number}
   */
  static after(gallery, gen) {
    let last = -1;
    gallery.forEach((pic, place) => {
      if (pic && pic.gen === gen) last = place;
    });
    return last >= 0 ? last + 1 : gallery.length;
  }

  /**
   * Место перед первой картинкой gen (нет таких — в конец).
   * @param {object[]} gallery
   * @param {string} gen
   * @returns {number}
   */
  static before(gallery, gen) {
    const first = gallery.findIndex(pic => pic && pic.gen === gen);
    return first >= 0 ? first : gallery.length;
  }

  /**
   * Картинки всех станций КП — по текущему составу (предпросмотр, сохранение, пробный файл). Пересборка, идущая в фоне,
   * сначала заканчивается: занятая станция пропускалась — в КП уходили прежние картинки, а новые приходили уже после.
   * @returns {Promise<boolean>} что-то изменилось
   */
  static async syncAll() {
    this.cancel();
    await this.queue;
    while (this.busy.size) await new Promise(resolve => setTimeout(resolve, this.IDLE_MS));
    let changed = false;
    for (const item of S.items) if (await this.sync(item)) changed = true;
    if (changed) KpState.persist();
    return changed;
  }

  /** Переключили КП (вкладки КП) — отложенные пересборки отменяются. */
  static listen() {
    document.addEventListener('kp:leave', () => this.cancel());
  }

  /** Отложенные пересборки — отменить (открыли другое КП: его станции пересоберутся, когда их тронут). */
  static cancel() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Пересобрать после паузы, без лишних перерисовок.
   * @param {object} item
   */
  static soon(item) {
    if (!item) return;
    const key = item.id != null ? item.id : item;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.queue = this.queue.then(() => this.later(item)).catch(() => {});
      }, this.WAIT),
    );
  }

  /**
   * Очередь: станция — нынешний объект позиции КП с тем же id (позиция удалена — пропустить); занята другой пересборкой —
   * ещё раз после паузы. Окно позиции — только на вкладке «Компоновка» (на других перерисовка сбила бы набираемое).
   * @param {object} was станция, как была при постановке в очередь
   */
  static async later(was) {
    const item =
      S.items.find(row => row && was.id != null && row.id === was.id) || (S.items.includes(was) ? was : null);
    if (!item) return;
    if (this.busy.has(item.id)) {
      this.soon(item);
      return;
    }
    if (!(await this.sync(item))) return;
    KpState.persist();
    KpForm.render();
    if (ItemEditor.current && ItemEditor.current.tab === 'layout' && S.items[ItemEditor.current.i] === item)
      ItemEditor.render();
  }

  /**
   * SVG → картинка (3D-вид — JPEG, чертёж — PNG: чёткие линии).
   * @param {string} svg
   * @param {string} type
   * @returns {Promise<{src: string, w: number, h: number}>}
   */
  static async raster(svg, type) {
    const image = await ImageFiles.read(StationMeta.url(svg));
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { src: canvas.toDataURL(type, this.QUALITY), w: width, h: height };
  }

  /**
   * Отпечаток листов: расстановка и надписи на них (название станции, контейнер, цвет, основная надпись).
   * @param {object} plan
   * @param {object} meta
   * @returns {string}
   */
  static key(plan, meta) {
    const text = JSON.stringify([
      meta.title,
      meta.cont,
      meta.colorText,
      meta.org,
      meta.dev,
      meta.date,
      plan.air ? plan.air.cls : '',
      EskdSheet.FONT_DATA ? 'osi' : '',
    ]);
    return `${plan.hash}.${StationRules.fnv(text)}`;
  }

  /**
   * Менеджер убрал сгенерированную картинку сам — больше её не вставлять.
   * @param {object} item
   * @param {string} what photo | draw | scheme | out
   */
  static forget(item, what) {
    if (!item) return;
    item.stLayout = { ...StationPlan.opts(item), [what]: false };
  }

  /**
   * Менеджер убрал картинку из изображений позиции: лист чертежа или ракурс — только его (пока остаются другие), остальное —
   * выключает «в КП».
   * @param {object} item
   * @param {number} number номер картинки
   */
  static drop(item, number) {
    const pic = (item.gallery || [])[number];
    const option = pic && this.OPTION[pic.gen];
    const others = gen => item.gallery.some((row, place) => place !== number && row && row.gen === gen);
    if (option === 'draw' && others('stdraw')) this._skip(item, 'skip', pic.sheet || 1);
    else if (option === 'out' && pic.view && others('stout')) this._skip(item, 'outSkip', pic.view);
    else if (option) this.forget(item, option);
    item.gallery.splice(number, 1);
  }

  static _skip(item, key, value) {
    const opts = StationPlan.opts(item);
    item.stLayout = { ...opts, [key]: [...new Set([...opts[key], value])] };
  }

  /**
   * Главное фото станции — копия фото элемента состава.
   * @param {object} item
   * @returns {boolean}
   */
  static partPhoto(item) {
    const src = item && item.photo && item.photo.src;
    return !!src && Kit.parts(item).some(part => part.photo && part.photo.src === src);
  }

  /**
   * Менеджер сам выбрал главное фото: 3D-вид больше не подставлять (вернуть — галочкой на вкладке «Компоновка»).
   * @param {object} item
   * @returns {boolean} главным был 3D-вид
   */
  static chosen(item) {
    if (!item || !Kit.station(item)) return false;
    const was = !!(item.photo && item.photo.gen === 'st3d');
    if (was) item.photo = null;
    this.forget(item, 'photo');
    return was;
  }
}
