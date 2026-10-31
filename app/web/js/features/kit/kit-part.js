import { Attrs } from '../../core/item-attrs.js';
import { Kit } from '../../core/kit.js';
import { CatFeatures } from '../catalog/cat-features.js';

/** Элемент сборки из позиции каталога: название, закупка, поставщик, суть описания, основные характеристики, фото. */
export class KitPart {
  static MAX = 700;
  static ROWS = 14;
  static HALF = 0.5;
  static METERS_UP_TO = 30;
  static MM_IN_M = 1000;
  static PLAIN_LABEL = /^(описание|о серии|назначение)$/i;
  static NOT_BODY = /упаков|присоедин|фланц|патрубк|бак|ресивер|сопл|радиатор|про[её]м|отверсти/i;

  /**
   * @param {object} doc позиция каталога
   * @returns {object} элемент сборки
   */
  static fromCat(doc) {
    const attrs = { ...Attrs.of(doc) };
    const all = (doc.groups || []).flatMap(group => (group.rows || []).filter(row => row.k && row.v));
    KitPart.dimsOf(attrs, all);
    return Kit.newPart({
      name: doc.name || '',
      catId: doc.id,
      cost: doc.cost || 0,
      costCur: doc.costCur || 'RUB',
      sup: attrs.maker || '',
      desc: this._desc(doc),
      rows: all.slice(0, this.ROWS).map(row => ({ k: row.k, v: row.v })),
      photo: doc.photo && doc.photo.src ? { src: doc.photo.src, w: doc.photo.w, h: doc.photo.h } : null,
      ...(doc.draw && typeof doc.draw === 'object' ? { draw: JSON.parse(JSON.stringify(doc.draw)) } : {}),
      attrs: Object.fromEntries(
        Object.entries(attrs).filter(
          ([key, value]) => key !== 'type' && value !== '' && value != null && typeof value !== 'object',
        ),
      ),
    });
  }

  /** блоки описания — с новой строки (списки «• …» остаются списками) */
  static _desc(doc) {
    const features = CatFeatures.forKp(doc.features).filter(feature => feature.text);
    return KitPart.cut(
      features
        .map(
          feature =>
            (feature.label && !this.PLAIN_LABEL.test(feature.label) ? `${feature.label}: ` : '') + feature.text.trim(),
        )
        .join('\n'),
    );
  }

  /**
   * Габариты и масса для компоновки станции — из всех строк характеристик: «Габариты» или «Длина / Ширина / Высота»,
   * «Масса / Вес»; заполненные в каталоге не меняются.
   * @param {object} attrs параметры (дополняются)
   * @param {object[]} all строки характеристик
   * @returns {object}
   */
  static dimsOf(attrs, all) {
    const row = pattern => all.find(line => pattern.test(String(line.k).trim()) && !this.NOT_BODY.test(String(line.k)));
    if (!attrs.size) this._size(attrs, row);
    if (!attrs.mass) {
      const mass = row(/^(масса|вес)(?!\s*(брутто|в упаковке))/i);
      const value = mass ? this._num(mass.v) : null;
      if (value > 0) attrs.mass = value;
    }
    return attrs;
  }

  static _size(attrs, row) {
    const dims = row(/^габарит|^размеры?\b/i);
    if (dims && /\d\s*[×xх*]\s*\d/i.test(String(dims.v))) {
      attrs.size = String(dims.v)
        .replace(/\s*мм\s*$/i, '')
        .trim();
      return;
    }
    const sides = [row(/^длина/i), row(/^ширина/i), row(/^высота/i)];
    if (!sides.every(Boolean)) return;
    const sizes = sides.map(side => this._mm(side));
    if (sizes.every(Boolean)) attrs.size = sizes.join(' × ');
  }

  static _num(value) {
    const found = String(value ?? '')
      .replace(/\s/g, '')
      .replace(',', '.')
      .match(/\d+(?:\.\d+)?/);
    return found ? +found[0] : null;
  }

  /** «м» отдельным словом (не «мм»): \b в JavaScript не видит границ кириллических слов */
  static _mm(row) {
    const value = this._num(row.v);
    if (value == null) return null;
    const meters = /(?:^|[^а-яё])м(?![а-яё])/i.test(`${String(row.k)} ${String(row.v)}`) && value < this.METERS_UP_TO;
    return meters ? Math.round(value * this.MM_IN_M) : value;
  }

  /**
   * Описание элемента — не длиннее MAX знаков: по концу предложения или пункта списка.
   * @param {string} text
   * @returns {string}
   */
  static cut(text) {
    const line = String(text || '').trim();
    if (line.length <= KitPart.MAX) return line;
    const head = line.slice(0, KitPart.MAX);
    const end = Math.max(
      head.lastIndexOf('. '),
      head.lastIndexOf('.\n'),
      head.lastIndexOf(';\n'),
      head.lastIndexOf('\n'),
    );
    return end > KitPart.MAX * this.HALF ? head.slice(0, end + 1).trim() : `${head.replace(/\s+\S*$/, '')}…`;
  }
}
