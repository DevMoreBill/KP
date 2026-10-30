import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Kit } from './kit.js';

/**
 * Заголовок титула по позиции: вид оборудования, модель, ключевые параметры. Станция в контейнере — по основному
 * оборудованию («Dalgakiran EAGLE 315W»), а не по разбору своего названия («EAGLE»).
 */
export class CoverHint {
  static KPIS = 4;

  /**
   * @param {object} item
   * @returns {{title: string, model: string, desc: string, kpis: object[]}}
   */
  static of(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const simple = Kit.simple(item);
    return {
      title: simple ? type.item || type.name : type.coverTitle || type.name,
      model: simple ? CoverHint.asmModel(item, type) : CoverHint.model(item),
      desc: '',
      kpis: ItemSpec.kpis(item, this.KPIS),
    };
  }

  /**
   * Сборное изделие — по своему названию: вид — строкой заголовка, крупно — остальное название («Grundfos CR 32-4 с ДГУ
   * в контейнере»); название не начинается с вида — целиком.
   * @param {object} item
   * @param {object} type категория изделия
   * @returns {string}
   */
  static asmModel(item, type) {
    const name = String(item.name || '').trim();
    const kind = String(type.item || '').trim();
    const rest = kind && name.toLowerCase().startsWith(kind.toLowerCase()) ? name.slice(kind.length).trim() : '';
    return rest || name;
  }

  /**
   * Производитель и модель (у станции — основного оборудования).
   * @param {object} item
   * @returns {string}
   */
  static model(item) {
    const main = Kit.station(item) ? Kit.main(item) : null;
    const mainAttrs = (main && main.attrs) || {};
    if (mainAttrs.model) return [mainAttrs.maker, mainAttrs.model].filter(Boolean).join(' ');
    const attrs = Attrs.of(item);
    return [attrs.maker, attrs.model].filter(Boolean).join(' ') || item.name;
  }
}
