import { DocImages } from './doc-images.js';
import { KpModels } from './kp-models.js';
import { EquipTypes } from '../../core/equip-types.js';
import { S } from '../../core/state.js';
import { FileSave } from '../../core/files.js';

/**
 * Титул КП с несколькими моделями: список моделей со своими фото и, если менеджер не правил титул, — модель, заголовок и
 * описание титула по составу («3 модели · 30–100 кВА», вид или группа оборудования).
 */
export class KpCover {
  static MANY = 2;
  static LISTED = 3;
  static TIDE = 'Tide Power ';
  static WORDS = ['модель', 'модели', 'моделей'];

  /**
   * Модели КП на титул (их не меньше двух): state.stations, фото в пакет, титул по составу.
   * @param {JSZip} zip
   * @param {object} state данные КП
   * @param {object} media картинки для скелета
   * @param {object} texts надписи шаблона
   */
  static async stations(zip, state, media, texts) {
    const models = KpModels.list();
    if (models.length < this.MANY) return;
    state.stations = models.map(({ key, model, power, exec, qty, kind }) => ({ key, model, power, exec, qty, kind }));
    media.thumbs = {};
    for (const row of models) {
      if (!row.photo) continue;
      const url = await DocImages.url(row.photo, row.model);
      if (!url) continue;
      zip.file(`word/media/${row.key}.jpg`, FileSave.base64(url), { base64: true });
      media.thumbs[row.key] = { file: `${row.key}.jpg`, w: row.photo.w, h: row.photo.h };
    }
    if (S.cover.touched) return;
    state.cover.model = this._model(models);
    state.cover.title = this._title(models, texts);
    state.cover.desc = KPGen.fill(texts.coverMultiDesc || '', { count: this._count(models) });
  }

  static _count(models) {
    return `${models.length} ${KPGen.plural(models.length, ...this.WORDS)}`;
  }

  static _model(models) {
    if (models.length > this.LISTED) {
      const kva = models
        .filter(row => /кВА/.test(row.power || ''))
        .map(row => parseFloat(String(row.power).replace(',', '.')))
        .filter(value => value > 0);
      const gensets = kva.length && models.every(row => row.type === 'dgu');
      return (
        this._count(models) + (gensets ? ` · ${Math.min(...kva)}–${Math.max(...kva)} кВА`.replace(/\./g, ',') : '')
      );
    }
    const makers = new Set(models.map(row => row.model.split(' ')[0]));
    if (makers.size === 1 && models.every(row => row.model.startsWith(this.TIDE))) {
      return this.TIDE + models.map(row => row.model.replace(this.TIDE, '')).join(' · ');
    }
    return models.map(row => row.model).join(' · ');
  }

  static _title(models, texts) {
    const cats = new Set(models.map(row => row.type));
    const groups = new Set(models.map(row => row.group));
    if (cats.size === 1) {
      const type = EquipTypes.byId([...cats][0]);
      return type.coverTitle || type.name;
    }
    if (groups.size === 1) return [...groups][0];
    return texts.coverMultiTitle || 'Оборудование';
  }
}
