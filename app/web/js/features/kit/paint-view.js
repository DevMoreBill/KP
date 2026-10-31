import { SafeLink } from '../../core/safe-link.js';
import { ContainerPart } from './container-part.js';
import { ImageFiles } from '../catalog/images.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Api, ImgUpload } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { $, esc } from '../../core/util.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationPaint } from '../layout/station-paint.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { StationPlan } from './station-plan.js';
import { InputNum } from '../../core/input-num.js';
import { Kit } from '../../core/kit.js';

/**
 * Окраска контейнера в «Крыша, пол, окраска» (StationPaint): на один цвет — одно окно (каркас, стены, крыша, пол, двери и
 * ворота), «Окраска по буклету заказчика» с файлом, рисунки заказчика на стенах (картинка, стена, место, ширина). Файлы —
 * сразу на сервер отдела (data/img), в КП — ссылка.
 */
export class PaintView {
  static RAL = [
    '1015',
    '1018',
    '2004',
    '3000',
    '3020',
    '5002',
    '5005',
    '5010',
    '5015',
    '6005',
    '6018',
    '6029',
    '7004',
    '7016',
    '7024',
    '7035',
    '7040',
    '8017',
    '9003',
    '9005',
    '9006',
    '9010',
    '9016',
  ];
  static NEAR = 0.01;
  static MIDDLE = 0.5;
  static ART_WIDTH = { min: 100, max: 12000, start: 1500 };
  static NAME_MAX = 120;
  static IMAGE_MAX = 2000;
  static JPEG_QUALITY = 0.9;
  static IMAGES = 'image/png,image/jpeg,image/webp';
  static BOOKLET = 'application/pdf,image/png,image/jpeg,image/webp';

  /**
   * Окна окраски, буклет и рисунки заказчика.
   * @param {object} part контейнер
   * @param {number} index позиция КП
   * @param {number} j номер контейнера в составе
   * @returns {string}
   */
  static html(part, index, j) {
    const listId = `ralL${index}_${j}`;
    const ctx = { part, index, j, listId, at: `data-i="${index}" data-j="${j}"` };
    const fields = StationPaint.PARTS.map(row => this._field(ctx, row)).join('');
    return `<div class="kc-g kc-paints">${fields}</div>
      <datalist id="${listId}">${this.RAL.map(code => `<option value="RAL ${code}">`).join('')}</datalist>
      ${this._book(ctx)}
      <div class="kc-arts">${this._arts(ctx)}</div>`;
  }

  static _field({ part, index, j, listId }, [key, name, hint]) {
    if (key === 'roof' && StationGeo.SEA[part.ctype]) return '';
    const value = StationPaint.of(part)[key];
    const color = StationPaint.hex(value);
    return `<label class="f"><span>${esc(name)}</span><span class="kc-ral"><i class="kc-sw${color ? '' : ' none'}"${color ? ` style="background:${esc(color)}"` : ''}></i><input type="text" data-kitpaint="${index}.${j}" data-k="${key}" value="${esc(value)}" placeholder="${esc(hint)}" list="${listId}" maxlength="60" aria-label="${esc(name)}"></span></label>`;
  }

  static _book({ part, index, j, at }) {
    const book = StationPaint.book(part);
    const file = part.paintFile;
    let control = '';
    if (book) {
      control =
        file && file.src
          ? `<a href="${SafeLink.file(file.src)}" target="_blank" rel="noopener">📎 ${esc(file.name || 'буклет')}</a> <button type="button" class="lnk" data-a="paintFileDel" ${at}>убрать</button>`
          : `<button type="button" class="btn sm" data-a="paintFile" ${at}>Файл буклета — PDF или картинка</button>`;
    }
    return `<div class="kc-book"><label class="stl-chk"><input type="checkbox" data-kitbook="${index}.${j}"${book ? ' checked' : ''}> Окраска по буклету заказчика</label>${UiKit.tip('В КП — строка «Окраска — по буклету цветовых решений заказчика». Файл буклета (PDF или картинка) уходит в ТЗ на сборку. Цвета выше — для 3D-вида и как ориентир сборщику.')}
        ${control}</div>`;
  }

  static _arts(ctx) {
    const arts = StationPaint.arts(ctx.part);
    const add =
      arts.length < StationPaint.ART_MAX
        ? `<span class="kc-book"><button type="button" class="btn sm ghost" data-a="paintArt" ${ctx.at}>+ Рисунок заказчика на стене</button>${UiKit.tip('Картинка (PNG с прозрачностью, JPEG) — на выбранной стене снаружи: видна на 3D-виде и видах снаружи, в ТЗ на сборку — с местом и размером.')}</span>`
        : '';
    return `${arts.map((art, k) => this._art(ctx, art, k)).join('')}
        ${add}`;
  }

  static _options(list, value) {
    return list
      .map(
        ([key, text]) =>
          `<option value="${key}"${Math.abs(key - value) < this.NEAR ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
  }

  static _nearest(list, value) {
    return list.reduce((best, row) => (Math.abs(row[0] - value) < Math.abs(best[0] - value) ? row : best))[0];
  }

  static _art({ index, j, at }, art, k) {
    const ref = `data-kitart="${index}.${j}.${k}"`;
    const walls = Object.entries(StationPaint.WALLS)
      .map(([wall, text]) => `<option value="${wall}"${wall === art.wall ? ' selected' : ''}>${esc(text)}</option>`)
      .join('');
    return `<div class="kc-art"><img src="${esc(art.src)}" alt="" loading="lazy">
          <select ${ref} data-k="wall" aria-label="Стена">${walls}</select>
          <select ${ref} data-k="x" aria-label="Место по длине">${this._options(StationPaint.ALONG, this._nearest(StationPaint.ALONG, art.x))}</select>
          <select ${ref} data-k="z" aria-label="Место по высоте">${this._options(StationPaint.HIGH, this._nearest(StationPaint.HIGH, art.z))}</select>
          <label class="kc-artw"><input type="text" inputmode="numeric" ${ref} data-k="w" value="${art.w}" aria-label="Ширина рисунка, мм"> мм</label>
          <button type="button" class="lnk" data-a="paintArtDel" ${at} data-k="${k}" title="Убрать рисунок" aria-label="Убрать рисунок">✕</button></div>`;
  }

  /**
   * Окно окраски, место или размер рисунка изменены.
   * @param {HTMLElement} target
   */
  static change(target) {
    const ref = target.dataset.kitpaint || target.dataset.kitbook || target.dataset.kitart;
    const [index, j, k] = String(ref).split('.').map(Number);
    const item = S.items[index];
    const part = Kit.parts(item)[j];
    if (!part) return;
    if (target.dataset.kitpaint != null) StationPaint.set(part, target.dataset.k, target.value);
    else if (target.dataset.kitbook != null) part.paintBook = target.checked;
    else if (!this._artChange(part, k, target)) return;
    ContainerPart.apply(part);
    StationPlan.cache.delete(item.id);
    KpForm.render();
    KpState.persist();
  }

  static _artChange(part, k, target) {
    const art = (part.art || [])[k];
    if (!art) return false;
    const field = target.dataset.k;
    if (field === 'wall') {
      if (StationPaint.WALLS[target.value]) art.wall = target.value;
    } else if (field === 'x' || field === 'z') art[field] = StationPaint.frac(+target.value, this.MIDDLE);
    else if (field === 'w') this._width(art, target.value);
    return true;
  }

  static _width(art, text) {
    const width = Math.round(InputNum.parse(text));
    const { min, max } = this.ART_WIDTH;
    if (width >= min && width <= max) art.w = width;
    else Toast.show('Ширина рисунка — от 100 до 12 000 мм');
  }

  /**
   * Кнопки: файл буклета, рисунок заказчика — загрузить или убрать.
   * @param {string} action
   * @param {number} index
   * @param {HTMLElement} button
   * @returns {boolean|string}
   */
  static act(action, index, button) {
    const item = S.items[index];
    const part = Kit.parts(item)[+button.dataset.j];
    if (!part) return false;
    if (action === 'paintFileDel') {
      delete part.paintFile;
      return true;
    }
    if (action === 'paintArtDel') {
      (part.art || []).splice(+button.dataset.k, 1);
      if (part.art && !part.art.length) delete part.art;
      StationPlan.cache.delete(item.id);
      return true;
    }
    this._choose(item, part, action === 'paintFile' ? this._booklet : this._picture);
    return 'async';
  }

  static _choose(item, part, load) {
    const input = $('#filePick');
    input.value = '';
    input.multiple = false;
    input.accept = load === this._booklet ? this.BOOKLET : this.IMAGES;
    input.onchange = async () => {
      const file = input.files[0];
      input.accept = '';
      if (!file) return;
      try {
        Toast.show(`Загружаю «${file.name}»…`);
        await load.call(this, item, part, file);
        ContainerPart.apply(part);
        StationPlan.cache.delete(item.id);
        KpForm.render();
        KpState.persist();
      } catch (error) {
        Toast.show(`Не удалось загрузить файл: ${(error && error.message) || error}`);
      }
    };
    input.click();
  }

  // PDF хранится на сервере отдела как «буклет»; картинка — как фото
  static async _booklet(item, part, file) {
    const pdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    const src = pdf
      ? `/img/${(await Api.request(`/api/img?${this._query(item, 'booklet', file.name)}`, { method: 'POST', body: file })).name}`
      : (await this._upload(file, item, 'буклет окраски')).src;
    part.paintFile = { src, name: String(file.name).slice(0, this.NAME_MAX), pdf };
  }

  static async _picture(item, part, file) {
    const image = await this._upload(file, item, 'рисунок заказчика');
    part.art = part.art || [];
    part.art.push({
      src: image.src,
      name: String(file.name).slice(0, this.NAME_MAX),
      wall: 'front',
      x: this.MIDDLE,
      z: this.MIDDLE,
      w: this.ART_WIDTH.start,
      ar: image.ar,
    });
  }

  static _query(item, kind, caption) {
    return Object.entries({ ...ItemSpec.imgPlace(item, kind, { caption }), ext: 'pdf' })
      .map(([key, value]) => `${key}=${encodeURIComponent(value || '')}`)
      .join('&');
  }

  // картинка: не больше IMAGE_MAX точек, прозрачность сохраняется (PNG) → на сервер; ar — ширина / высота
  static async _upload(file, item, caption) {
    const image = await ImageFiles.read(await ImageFiles.toUrl(file));
    const scale = Math.min(1, this.IMAGE_MAX / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const png = /png|webp/i.test(file.type);
    const data = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', this.JPEG_QUALITY);
    const saved = await ImgUpload.put({ src: data }, ItemSpec.imgPlace(item, 'gallery', { caption }));
    return { src: saved.src, ar: width / height };
  }
}
