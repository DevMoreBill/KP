import { Str } from '../../core/str.js';
import { Kit } from '../kit/kit.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { S } from '../../core/state.js';
import { ItemSpec } from '../../core/item-spec.js';
import { CoverHint } from '../kit/cover-hint.js';
/**
 * Модели КП для титула: позиции одной модели — одной строкой (количество суммируется), комплектующие не считаются;
 * станция в контейнере — по основному оборудованию и с типом контейнера; kind — вид оборудования (для сводки на титуле).
 */
export class KpModels {
  static SHORT = {
    dgu: 'ДГУ',
    light: 'Мачта',
    welder: 'Сварочный',
    comp_screw: 'Компрессор',
    comp_piston: 'Компрессор',
    comp_centrifugal: 'Компрессор',
    pump: 'Насос',
    ats: 'АВР',
    other: '',
  };
  static POWER_ROW = /основная мощность|номинальная мощность/i;
  static GENSET_MAKERS = /^(Tide Power|HERTZ|Energo|ТСС)\s+/i;
  static SHOWN = 2;
  static MAIN_LINE = 2;

  static _model(item, attrs, station) {
    if (Kit.simple(item)) return item.name; // сборное изделие — своим названием, а не моделью основного оборудования
    if (!station && item.hint && item.hint.model) return item.hint.model;
    if (station) return CoverHint.model(item) || item.name;
    return (attrs.model && attrs.maker ? `${attrs.maker} ${attrs.model}` : '') || item.name;
  }

  static _power(item, attrs) {
    if (attrs.cat !== 'dgu') return ItemSpec.mainLine(item, this.MAIN_LINE);
    const row = (item.groups || []).flatMap(group => group.rows || []).find(entry => this.POWER_ROW.test(entry.k));
    if (row) return row.v;
    if (attrs.kva && attrs.kw) return `${attrs.kva} кВА / ${attrs.kw} кВт`;
    return attrs.kw ? `${attrs.kw} кВт` : '';
  }

  /**
   * Модели КП.
   * @returns {object[]} [{key, model, power, exec, qty, photo, type, group, kind}]
   */
  static list() {
    const map = new Map();
    for (const item of S.items) {
      const attrs = Attrs.of(item);
      const type = EquipTypes.byId(attrs.cat);
      if (type.role !== 'accessory') this._add(map, item, attrs, type);
    }
    return [...map.values()];
  }

  static _add(map, item, attrs, type) {
    const station = !!Kit.station(item);
    const model = this._model(item, attrs, station);
    const key = (station ? 'станция ' : '') + Str.norm(model);
    const power = this._power(item, attrs);
    const row = map.get(key) || {
      key: `st${map.size}`,
      model,
      power,
      exec: attrs.execution || (station ? attrs.container : '') || '',
      qty: 0,
      photo: item.photo || null,
      type: attrs.cat,
      group: type.group || '',
      kind: type.name || '',
    };
    row.qty += +item.qty || 0;
    if (!row.photo && item.photo) row.photo = item.photo;
    map.set(key, row);
  }

  static _shortModel(item, attrs, main) {
    return (
      (main ? main.model : attrs.model) ||
      ((item.hint && item.hint.model) || '').replace(this.GENSET_MAKERS, '') ||
      item.name.split(' ').slice(-1)[0]
    );
  }

  static _short(item) {
    const attrs = Attrs.of(item);
    const type = EquipTypes.byId(attrs.cat);
    if (type.role === 'accessory') return null;
    const main = Kit.station(item) ? (Kit.main(item) || {}).attrs || {} : null;
    const model = this._shortModel(item, attrs, main);
    const word = type.short ?? this.SHORT[type.id] ?? (main ? type.item : '');
    return [word, model].filter(Boolean).join(' ');
  }

  /**
   * Оборудование коротко — для имени файла: «Компрессор EAGLE-N 110 и ДГУ 30 MP-FW-S и ещё 2».
   * @returns {string}
   */
  static short() {
    const parts = [...new Set(S.items.map(item => this._short(item)).filter(part => part !== null))];
    if (!parts.length) return '';
    const head = parts.slice(0, this.SHOWN).join(' и ');
    return parts.length > this.SHOWN ? `${head} и ещё ${parts.length - this.SHOWN}` : head;
  }
}
