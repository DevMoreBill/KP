import { StationEquip } from '../layout/station-equip.js';
import { Kit } from '../../core/kit.js';
/**
 * Сторона поставки элемента станции: «Наше оборудование» (привозим на сборку сами: компрессоры, ДГУ, насосы, осушители,
 * фильтры, ресиверы) и «Сборщик контейнера» (шкафы, трубопровод, обвязка, системы безопасности — по ТЗ на сборку).
 */
export class KitScope {
  static OUR = /^(compressor|dgu|pump|dryer|filter|receiver)$/;
  static LABEL = { our: 'Наше оборудование', asm: 'Сборщик контейнера' };

  /**
   * Сторона по умолчанию: основное оборудование и подготовка воздуха — наши, остальное — сборщика.
   * @param {object} part
   * @returns {string} our | asm
   */
  static def(part) {
    return part && part.role !== 'container' && this.OUR.test(StationEquip.kindOf(part)) ? 'our' : 'asm';
  }

  /**
   * Сторона элемента: своя или по умолчанию.
   * @param {object} part
   * @returns {string} our | asm
   */
  static of(part) {
    return part && (part.by === 'our' || part.by === 'asm') ? part.by : this.def(part);
  }

  /**
   * Поставщик элемента; у элемента сборщика без своего поставщика — сборщик (поставщик контейнера).
   * @param {object} item позиция КП
   * @param {object} part
   * @returns {string}
   */
  static sup(item, part) {
    const own = String((part && part.sup) || '').trim();
    if (own || this.of(part) !== 'asm') return own;
    return String((Kit.container(item) || {}).sup || '').trim();
  }
}
