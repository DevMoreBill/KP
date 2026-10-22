import { UiKit } from '../../ui/ui-kit.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { esc } from '../../core/util.js';
import { DimInput } from '../../core/dim-input.js';
import { Makers } from './makers.js';
/**
 * Варианты выбора параметра позиции: значение не из списка категории («2/1» в ступенях Remeza, «Прямой» в приводе) остаётся
 * в списке — иначе окно показало бы «—» и при сохранении карточки стёрло бы его.
 */
export class AttrChoices {
  /**
   * Варианты списка с текущим значением.
   * @param {{values: Array}} field
   * @param {*} value
   * @returns {string[]}
   */
  static list(field, value) {
    const text = String(value ?? '');
    const list = (field.values || []).map(String);
    return text && !list.includes(text) ? [...list, text] : list;
  }
}

/** Габариты в параметрах и строках характеристик — три окошка (DimInput): параметр size и строки «Габариты…», «Размеры…». */
export class DimRow {
  static PATTERN = /габарит|^размер(ы)?\b|д\s*[×xх]\s*ш\s*[×xх]\s*в/i;

  /**
   * Это габариты.
   * @param {string} key
   * @param {string} label
   * @returns {boolean}
   */
  static matches(key, label) {
    return key === 'size' || this.PATTERN.test(String(label || ''));
  }

  /**
   * Строка характеристик: единица — как вписана, иначе «мм» (если в названии строки её нет).
   * @param {string} attrs атрибуты скрытого поля
   * @param {{k: string, v: string}} row
   * @returns {string}
   */
  static html(attrs, row) {
    const unit = DimInput.parse(row.v).unit || (/мм|\bм\b|см/.test(String(row.k)) ? '' : 'мм');
    return DimInput.html(attrs, row.v, { label: row.k, unit });
  }
}

/** Категория и параметры позиции по группам категории (основные, двигатель, комплектация, применимость…). */
export class AttrsBlock {
  static _label(field) {
    return `${esc(field.label)}${field.unit ? `, ${esc(field.unit)}` : ''}`;
  }

  static _input({ path, attrs, auto }, field) {
    const value = attrs[field.key] ?? '';
    const guess = auto[field.key];
    const hint = guess != null && guess !== '' ? String(guess) : '';
    if (field.values && field.values.length) {
      const opts = AttrChoices.list(field, value)
        .map(choice => `<option${String(value) === String(choice) ? ' selected' : ''}>${esc(choice)}</option>`)
        .join('');
      return `<label class="f"><span>${this._label(field)}</span><select data-p="${path}.${field.key}"><option value="">${hint ? `${esc(hint)} (авто)` : '—'}</option>${opts}</select></label>`;
    }
    if (DimRow.matches(field.key, field.label)) {
      return `<label class="f"><span>${this._label(field)}</span>${DimInput.html(`data-p="${path}.${field.key}"`, value, { ph: hint, label: field.label })}</label>`;
    }
    return this._text({ path, value, hint }, field);
  }

  // текстовое поле; list — подсказки (вписать или выбрать), need — обязательно для новой позиции каталога
  static _text({ path, value, hint }, field) {
    const list = field.list ? ` list="${field.list}"` : '';
    const need = field.need ? ' <b class="req" title="Обязательно для новой позиции каталога">*</b>' : '';
    return `<label class="f"><span>${this._label(field)}${need}</span><input type="text" ${field.num ? 'inputmode="decimal"' : ''} data-p="${path}.${field.key}" value="${esc(value)}" placeholder="${esc(hint || field.ph || '')}" autocomplete="off"${list}></label>`;
  }

  static _groups(type) {
    const groups = new Map();
    for (const field of type.fields) {
      const group = field.group || 'Основные';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(field);
    }
    return groups;
  }

  /**
   * Блок «Категория и параметры».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static html(item, i) {
    const path = `items.${i}.attrs`;
    const auto = Attrs.of(item);
    const cat = auto.cat;
    const type = EquipTypes.byId(cat);
    const input = field => this._input({ path, attrs: item.attrs || {}, auto }, field);
    const groups = [...this._groups(type).entries()]
      .map(
        ([group, fields]) => `<p class="agrp">${esc(group)}</p><div class="attrs">${fields.map(input).join('')}</div>`,
      )
      .join('');
    return `<div><div class="sub">Категория и параметры${UiKit.tip(`Набор параметров зависит от категории «${esc(type.name)}». Они работают в фильтрах каталога, на титуле и в карточке. Пустые поля заполняются из характеристик — серым показано, что будет подставлено.`)} <button class="btn ghost" type="button" data-a="autoAttrs" data-i="${i}">Определить по характеристикам</button>
      <button class="btn ghost" type="button" data-a="attrsToGroups" data-i="${i}">Сформировать таблицу характеристик</button></div>
   <div class="attrs"><label class="f"><span>Категория</span><select data-p="${path}.cat" data-retype="${i}">${EquipTypes.optionsHtml(cat)}</select></label>
   ${input({ key: Makers.FIELD, label: 'Производитель', list: Makers.LIST_ID, need: true, ph: 'Выберите из списка или впишите' })}${input({ key: 'series', label: 'Серия' })}${input({ key: 'model', label: 'Модель' })}</div>
   ${groups}${Makers.datalist()}</div>`;
  }
}
