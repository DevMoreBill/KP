import { Kit } from './kit.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { ImageFiles } from '../catalog/images.js';
import { ItemSpec } from '../../core/item-spec.js';
import { ImgUpload } from '../../core/net.js';
import { StationEquip } from '../layout/station-equip.js';
import { $, esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { StationPlan } from './station-plan.js';

/**
 * Свой рисунок модели для габаритного чертежа: вид спереди и сверху (PNG или JPEG) вписывается в габарит элемента вместо
 * рисунка программы. Хранится у элемента станции (p.draw) и у позиции каталога (doc.draw) — переходит в состав.
 */
export class DrawPic {
  static VIEWS = [
    ['front', 'спереди'],
    ['top', 'сверху'],
  ];
  static DRAWN = /^(compressor|dryer|receiver|filter|dgu|pump|cabinet|tank)$/;
  static ACCEPT = 'image/png,image/jpeg,image/webp';
  static cache = new Map(); // src → data:URL (картинка внутрь SVG чертежа — только data:)

  /**
   * Поля рисунков элемента (j ≥ 0) или позиции в карточке (j < 0).
   * @param {object} part
   * @param {number} index позиция КП
   * @param {number} j
   * @returns {string}
   */
  static fields(part, index, j) {
    const draw = part.draw || {};
    const views = this.VIEWS.map(([view, label]) => {
      const inner =
        draw[view] && draw[view].src
          ? `<img src="${esc(draw[view].src)}" alt="Рисунок для чертежа — ${label}"><button class="icon x" type="button" data-a="drawDel" data-i="${index}" data-j="${j}" data-v="${view}" aria-label="Убрать рисунок ${label}">✕</button>`
          : `<button type="button" class="kit-phb" data-a="drawPick" data-i="${index}" data-j="${j}" data-v="${view}">+ ${label}</button>`;
      return `<div class="kd-pic">${inner}<small>${label}</small></div>`;
    }).join('');
    return `<div class="kd-draw"><span class="muted">Рисунок модели для габаритного чертежа${UiKit.tip('Свой рисунок изделия (вид спереди и сверху, PNG или JPEG). На чертеже он вписывается в габарит элемента вместо автоматического. Удобно завести один раз в карточке позиции каталога — тогда он придёт в состав сам.')}</span>
      <div class="kd-dv">${views}</div></div>`;
  }

  /**
   * Карточка позиции (КП или каталог): оборудование, которое рисуется на чертеже станции, — свой рисунок модели.
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static forItem(item, index) {
    if (Kit.station(item) || !this.DRAWN.test(StationEquip.kindOf(item) || '')) return '';
    return `<div class="ed-sec">${this.fields(item, index, -1)}<p class="muted kd-hint">Попадёт в состав станции вместе с позицией: на габаритном чертеже — вместо рисунка программы.</p></div>`;
  }

  /**
   * Сохранение: рисунки data:… — файлами на сервер (как фото), в данных — адреса /img/….
   * @param {object} draw
   * @param {object} owner позиция КП или каталога
   * @param {string} name
   * @returns {Promise<object>}
   */
  static async upload(draw, owner, name) {
    const out = { ...draw };
    for (const [view, label] of this.VIEWS) {
      if (!out[view] || !out[view].src) continue;
      const was = out[view].src;
      const caption = `${name ? `${name} — ` : ''}рисунок для чертежа, ${label}`;
      out[view] = await ImgUpload.put(out[view], ItemSpec.imgPlace(owner, 'gallery', { caption }));
      if (out[view].src !== was && was.startsWith('data:')) this.cache.set(out[view].src, was); // без повторной загрузки
    }
    return out;
  }

  static _sources(item) {
    return Kit.parts(item).flatMap(part =>
      this.VIEWS.map(([view]) => part.draw && part.draw[view] && part.draw[view].src).filter(Boolean),
    );
  }

  /**
   * Есть рисунки, ещё не загруженные для чертежа.
   * @param {object} item
   * @returns {boolean}
   */
  static pending(item) {
    return this._sources(item).some(src => !this.cache.has(src) && !src.startsWith('data:'));
  }

  /**
   * Выбрать файл рисунка: элемент станции (j ≥ 0) или позиция в карточке (j < 0).
   * @param {number} index
   * @param {number} j
   * @param {string} view front | top
   */
  static pick(index, j, view) {
    const input = $('#filePick');
    input.value = '';
    input.multiple = false;
    input.accept = this.ACCEPT;
    const item = S.items[index];
    input.onchange = async () => {
      const file = input.files[0];
      input.accept = '';
      if (!file) return;
      try {
        const image = await ImageFiles.gallery(file);
        const target = j >= 0 ? Kit.parts(item)[j] : item;
        if (!target) return;
        target.draw = { ...(target.draw || {}), [view]: image };
        if (j >= 0) StationPlan.cache.delete(item.id);
        KpForm.render();
        KpState.persist();
      } catch {
        Toast.show('Не удалось открыть изображение');
      }
    };
    input.click();
  }

  /**
   * Убрать рисунок.
   * @param {number} index
   * @param {number} j
   * @param {string} view
   */
  static del(index, j, view) {
    const item = S.items[index];
    const target = j >= 0 ? Kit.parts(item)[j] : item;
    if (!target || !target.draw) return;
    delete target.draw[view];
    if (!Object.keys(target.draw).length) delete target.draw;
    if (j >= 0) StationPlan.cache.delete(item.id);
  }

  /**
   * Все рисунки станции — в data:URL (для SVG чертежа).
   * @param {object} item
   * @returns {Promise<boolean>} true — что-то загрузилось
   */
  static async load(item) {
    let loaded = false;
    for (const src of this._sources(item)) {
      if (this.cache.has(src)) continue;
      if (src.startsWith('data:')) this.cache.set(src, src);
      else if (await this._fetch(src)) loaded = true;
    }
    return loaded;
  }

  static async _fetch(src) {
    try {
      const blob = await (await fetch(src)).blob();
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      this.cache.set(src, url);
      return true;
    } catch {
      this.cache.set(src, '');
      return false;
    }
  }

  /**
   * Рисунок для SVG: data:URL или '' (не загружен).
   * @param {string} src
   * @returns {string}
   */
  static data(src) {
    if (!src) return '';
    return src.startsWith('data:') ? src : this.cache.get(src) || '';
  }
}
