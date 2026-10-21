import { ImageFiles } from './images.js';
import { FormView } from '../../ui/form-view.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { Str } from '../../core/str.js';
import { Uid } from '../../core/util.js';

/**
 * Изображения позиции и их место в КП: к блоку описания, к группе характеристик или в разделе «Фото и схемы»; порядок
 * блоков и изображений, главное фото.
 */
export class ItemLinks {
  static FEAT = 'feat:';
  static GROUP = 'group:';

  /**
   * Код блока описания (создаётся при первом обращении).
   * @param {object} feat
   * @returns {string}
   */
  static featId(feat) {
    if (!feat.id) feat.id = Uid.next();
    return feat.id;
  }

  static _byAt(item, pic) {
    if (pic.at && pic.at.startsWith(this.FEAT)) {
      const feat = (item.features || []).find(one => one.id === pic.at.slice(this.FEAT.length));
      if (feat) return { kind: 'feat', f: feat };
    }
    if (pic.at && pic.at.startsWith(this.GROUP)) {
      const name = pic.at.slice(this.GROUP.length);
      if ((item.groups || []).some(group => group.name === name)) return { kind: 'group', name };
    }
    return null;
  }

  // без привязки — по подписи: блок описания с тем же заголовком (если к нему ещё нет фото) или группа характеристик
  static _byCaption(item, pic) {
    const caption = Str.norm(pic.caption || pic.slot || '');
    if (!caption) return null;
    const feat = (item.features || []).find(
      one => one.label && (Str.norm(one.label) === caption || caption.startsWith(Str.norm(one.label))),
    );
    const taken =
      feat && (item.gallery || []).some(other => other !== pic && other.at === this.FEAT + this.featId(feat));
    if (feat && !taken) return { kind: 'feat', f: feat, auto: true };
    const group = (item.groups || []).find(one => one.name && Str.norm(one.name) === caption);
    return group ? { kind: 'group', name: group.name, auto: true } : null;
  }

  /**
   * Где изображение в КП: {kind: feat | group | free}.
   * @param {object} item
   * @param {object} pic
   * @returns {object}
   */
  static linkOf(item, pic) {
    const linked = this._byAt(item, pic);
    if (linked) return linked;
    if (pic.at === undefined || pic.at === '') return this._byCaption(item, pic) || { kind: 'free' };
    return { kind: 'free' };
  }

  /**
   * Фото блока описания.
   * @param {object} item
   * @param {object} feat
   * @returns {object|undefined}
   */
  static featImage(item, feat) {
    return (item.gallery || []).find(pic => {
      const link = this.linkOf(item, pic);
      return link.kind === 'feat' && link.f === feat;
    });
  }

  /**
   * Переставить блок описания.
   * @param {object} item
   * @param {number} from
   * @param {number} place
   * @returns {boolean} переставлен
   */
  static moveFeat(item, from, place) {
    const list = item.features || [];
    if (from === place || place < 0 || place >= list.length) return false;
    const [moved] = list.splice(from, 1);
    list.splice(place, 0, moved);
    return true;
  }

  /**
   * Переставить изображение (среди не привязанных к блокам описания — порядок в КП тот же).
   * @param {object} item
   * @param {number} from
   * @param {number} place
   * @returns {boolean}
   */
  static moveGal(item, from, place) {
    const gallery = item.gallery || [];
    if (from === place || !gallery[from] || !gallery[place]) return false;
    const [moved] = gallery.splice(from, 1);
    gallery.splice(place, 0, moved);
    return true;
  }

  /**
   * Номера изображений, не привязанных к блокам описания.
   * @param {object} item
   * @returns {number[]}
   */
  static freeGal(item) {
    return (item.gallery || [])
      .map((pic, j) => ({ pic, j }))
      .filter(row => this.linkOf(item, row.pic).kind !== 'feat')
      .map(row => row.j);
  }

  /**
   * Главное фото ↔ изображение галереи: выбранное становится главным, прежнее главное — на его место в галерее.
   * @param {object} item
   * @param {number} j
   * @returns {boolean}
   */
  static setMain(item, j) {
    const pic = (item.gallery || [])[j];
    if (!pic || !pic.src) return false;
    const old = item.photo;
    const oldSrc = item.photoSource;
    item.photo = { src: pic.src, w: pic.w, h: pic.h };
    item.photoSource = pic.source || null;
    delete item.photoFrom;
    if (old && old.src) {
      item.gallery[j] = {
        id: Uid.next(),
        src: old.src,
        w: old.w,
        h: old.h,
        caption: '',
        slot: '',
        wide: pic.wide || '',
        on: pic.on !== false,
        at: pic.at,
        ...(oldSrc ? { source: oldSrc } : {}),
      };
    } else item.gallery.splice(j, 1);
    return true;
  }

  /**
   * Фото к блоку описания (файлом).
   * @param {number} i позиция КП
   * @param {string} fid блок описания
   * @param {File[]} files
   */
  static async addFeatImage(i, fid, files) {
    const item = S.items[i];
    const file = (files || []).find(one => one.type && one.type.startsWith('image/'));
    if (!file) {
      Toast.show('Нужен файл изображения');
      return;
    }
    try {
      const pic = await ImageFiles.gallery(file);
      item.gallery = (item.gallery || []).filter(one => one.at !== this.FEAT + fid);
      const feat = (item.features || []).find(one => one.id === fid);
      item.gallery.push({
        id: Uid.next(),
        ...pic,
        caption: feat ? feat.label : '',
        slot: '',
        at: this.FEAT + fid,
        on: true,
      });
      item.page = true;
      FormView.render();
      KpState.persist();
      Toast.show('Фото добавлено к блоку описания');
    } catch {
      Toast.show('Не удалось открыть изображение');
    }
  }
}
