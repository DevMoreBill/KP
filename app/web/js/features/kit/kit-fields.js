import { Kit } from './kit.js';
import { esc } from '../../core/util.js';
import { PipeMaterial } from '../layout/pipe-material.js';
import { StationEquip } from '../layout/station-equip.js';
import { KpState, S } from '../../core/state.js';
import { KpForm } from '../../core/kp-form.js';

/** Поле состава станции `data-…="i.j"` → позиция КП и элемент. */
class PartField {
  /**
   * @param {string} address «позиция.элемент»
   * @returns {{item: object, part: object}|null}
   */
  static of(address) {
    const [i, j] = address.split('.').map(Number);
    const item = S.items[i];
    const part = Kit.parts(item)[j];
    return part ? { item, part } : null;
  }

  /**
   * Строка характеристик элемента: значение — записать, пусто — убрать.
   * @param {object[]} rows
   * @param {string} k
   * @param {string} v
   */
  static row(rows, k, v) {
    const row = rows.find(line => line.k === k);
    if (!row) {
      if (v) rows.push({ k, v });
    } else if (v) row.v = v;
    else rows.splice(rows.indexOf(row), 1);
  }
}

/**
 * Трубопроводная обвязка станции: материал и условный проход — поля в составе и строки характеристик элемента (в КП); на
 * компоновке — цвет трассы (PipeMaterial).
 */
export class KitPipe {
  static DN_MAX = 20;

  /**
   * Элемент — трубопровод.
   * @param {object} part
   * @returns {boolean}
   */
  static matches(part) {
    return (
      !!part && part.role !== 'container' && part.role !== 'main' && StationEquip.PIPING.test(String(part.name || ''))
    );
  }

  /**
   * Поля в составе.
   * @param {object} part
   * @param {number} i позиция КП
   * @param {number} j элемент
   * @returns {string}
   */
  static fields(part, i, j) {
    if (!this.matches(part)) return '';
    const current = (PipeMaterial.of(part) || {}).id || '';
    const options = PipeMaterial.LIST.map(
      material =>
        `<option value="${material.id}"${material.id === current ? ' selected' : ''}>${esc(material.name)}</option>`,
    ).join('');
    return `<div class="kit-pp"><label class="f"><span>Материал трубопровода</span><select data-kitpp="${i}.${j}" data-fld="pipeMat"><option value=""${current ? '' : ' selected'}>— выберите —</option>${options}</select></label>
      <label class="f"><span>Условный проход</span><input type="text" data-kitpp="${i}.${j}" data-fld="dn" value="${esc(part.dn || '')}" placeholder="например, DN 50" maxlength="20"></label></div>`;
  }

  /**
   * Поле в составе → элемент и строки «Материал трубопровода», «Условный проход».
   * @param {HTMLElement} field
   */
  static change(field) {
    const found = PartField.of(field.dataset.kitpp);
    if (!found) return;
    const part = found.part;
    if (field.dataset.fld === 'pipeMat') part.pipeMat = PipeMaterial.get(field.value) ? field.value : '';
    else
      part.dn = String(field.value || '')
        .trim()
        .slice(0, this.DN_MAX);
    this.rows(part);
    KpForm.render();
    KpState.persist();
  }

  /**
   * Строки характеристик по материалу и проходу.
   * @param {object} part
   */
  static rows(part) {
    part.rows = part.rows || [];
    const material = PipeMaterial.get(part.pipeMat);
    PartField.row(part.rows, PipeMaterial.ROW, material ? material.row : '');
    PartField.row(part.rows, PipeMaterial.DN_ROW, PipeMaterial.bore({ dn: part.dn }));
  }
}

/**
 * Шкафы станции: на стене (по умолчанию) или на полу — поле в составе и строка «Установка» характеристик элемента; на
 * компоновке настенный висит на стене прохода, напольный стоит в ряду (StationEquip.mount).
 */
export class KitCabinet {
  static ROW = 'Установка';
  static OPTS = [
    ['wall', 'на стене', 'настенный'],
    ['floor', 'на полу', 'напольный'],
  ];

  /**
   * Элемент — шкаф.
   * @param {object} part
   * @returns {boolean}
   */
  static matches(part) {
    return !!part && part.role !== 'container' && part.role !== 'main' && StationEquip.kindOf(part) === 'cabinet';
  }

  /**
   * Поле «Установка шкафа» в составе.
   * @param {object} part
   * @param {number} i
   * @param {number} j
   * @returns {string}
   */
  static fields(part, i, j) {
    if (!this.matches(part)) return '';
    const current = StationEquip.mount(part, StationEquip.dims(part, 'cabinet'));
    const options = this.OPTS.map(
      ([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${esc(label)}</option>`,
    ).join('');
    return `<div class="kit-pp"><label class="f"><span>Установка шкафа</span><select data-kitcab="${i}.${j}">${options}</select></label></div>`;
  }

  /**
   * Поле в составе → элемент и строка «Установка».
   * @param {HTMLElement} field
   */
  static change(field) {
    const found = PartField.of(field.dataset.kitcab);
    if (!found) return;
    found.part.mount = field.value === 'floor' ? 'floor' : 'wall';
    this.rows(found.part);
    KpForm.render();
    KpState.persist();
  }

  /**
   * Строка «Установка».
   * @param {object} part
   */
  static rows(part) {
    part.rows = part.rows || [];
    const option = this.OPTS.find(row => row[0] === part.mount);
    PartField.row(part.rows, this.ROW, option ? option[2] : '');
  }
}

export { PartField };
