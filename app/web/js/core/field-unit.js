import { EquipTypes } from './equip-types.js';

/**
 * Единицы полей категорий каталога: у поршневых производительность в л/мин, у воздуходувок — м³/ч и мбар, у генераторов и
 * насосов — м³/ч. Расчёты станции и сборного изделия переводят значение поля в свою единицу здесь, в одном месте.
 */
export class FieldUnit {
  static FACTOR = { 'л/мин>м³/мин': 0.001, 'м³/ч>м³/мин': 1 / 60, 'мбар>бар': 0.001 };
  // как в app/equipment_types.json — пока справочник категорий не загружен (проверка tests/js/field_unit.js)
  static BUILTIN = {
    comp_piston: { flow: 'л/мин' },
    blower: { flow: 'м³/ч', pressure: 'мбар' },
    gen_n2: { flow: 'м³/ч' },
    gen_o2: { flow: 'м³/ч' },
    pump: { flow: 'м³/ч' },
    st_pump: { flow: 'м³/ч' },
  };

  /**
   * Единица поля категории: из справочника категорий, иначе встроенная; «» — неизвестна.
   * @param {string} cat
   * @param {string} key
   * @returns {string}
   */
  static unit(cat, key) {
    const type = EquipTypes.list.find(row => row.id === cat);
    const field = type && (type.fields || []).find(row => row.key === key);
    if (field) return field.unit || '';
    return (this.BUILTIN[cat] || {})[key] || '';
  }

  /**
   * Множитель между единицами: та же — 1, известная пара — множитель, иначе null (переводить нечем).
   * @param {string} from
   * @param {string} target
   * @returns {number|null}
   */
  static pair(from, target) {
    if (from === target) return 1;
    return this.FACTOR[`${from}>${target}`] ?? null;
  }

  /**
   * Множитель значения поля позиции категории в единицу расчёта; единица неизвестна или пары нет — 1 (значение как есть).
   * @param {string} cat
   * @param {string} key
   * @param {string} target
   * @returns {number}
   */
  static factor(cat, key, target) {
    return this.pair(this.unit(cat, key), target) ?? 1;
  }
}
