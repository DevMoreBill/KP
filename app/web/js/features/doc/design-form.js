import { Design } from './design.js';
import { DesignModel } from './design-model.js';
import { esc } from '../../core/util.js';

/** Графический редактор шаблона: общие кусочки форм панелей — цвета, числа, переключатели, образец стиля. */
export class DesignForm {
  static HEX = /^[0-9A-Fa-f]{6}$/;
  static BOLD = 700;
  static NORMAL = 400;

  /**
   * Варианты списка фирменных цветов (свой цвет — отдельным вариантом).
   * @param {string} selected
   * @returns {string}
   */
  static colorOptions(selected) {
    const keys = Object.keys(Design.state.work.colors || {});
    const names = DesignModel.colorNames();
    const own = selected && !keys.includes(selected);
    const options = keys
      .map(
        color =>
          `<option value="${esc(color)}"${color === selected ? ' selected' : ''}>${esc(names[color] || color)}</option>`,
      )
      .join('');
    return options + (own ? `<option value="${esc(selected)}" selected>#${esc(selected)}</option>` : '');
  }

  /**
   * Палитра.
   * @param {string} path куда записать цвет
   * @param {string} current
   * @param {string} [none] подпись варианта «нет» (для фона и рамки)
   * @returns {string}
   */
  static chips(path, current, none) {
    const keys = Object.keys(Design.state.work.colors || {});
    const empty = none
      ? `<button type="button" class="td-chip none${!current ? ' on' : ''}" data-tdsetc="${esc(path)}" data-v="" title="${esc(none)}"></button>`
      : '';
    const colors = keys
      .map(
        color =>
          `<button type="button" class="td-chip${current === color ? ' on' : ''}" data-tdsetc="${esc(path)}" data-v="${esc(color)}" title="${esc(DesignModel.colorNames()[color] || color)}" style="background:#${DesignModel.colorHex(color)}"></button>`,
      )
      .join('');
    const ownOn = current && this.HEX.test(current) ? ' on' : '';
    return `<div class="td-chips">${empty}${colors}
    <label class="td-chip own${ownOn}" title="Свой цвет"><input type="color" data-tdcolorown="${esc(path)}" value="#${DesignModel.colorHex(current || '000000')}"></label></div>`;
  }

  /**
   * Числовое поле.
   * @param {string} path
   * @param {*} value
   * @param {{step?: number, min?: number, max?: number, ph?: string}} [options]
   * @returns {string}
   */
  static number(path, value, options = {}) {
    const min = options.min != null ? ` min="${options.min}"` : '';
    const max = options.max != null ? ` max="${options.max}"` : '';
    const placeholder = options.ph ? ` placeholder="${esc(options.ph)}"` : '';
    return `<input type="number" data-tdnum="${esc(path)}" value="${esc(value ?? '')}" step="${options.step || 0.1}"${min}${max}${placeholder}>`;
  }

  /**
   * Переключатель из кнопок.
   * @param {string} path
   * @param {*} current
   * @param {string[][]} options [[значение, текст, подсказка?]]
   * @returns {string}
   */
  static segment(path, current, options) {
    const buttons = options
      .map(
        ([value, text, title]) =>
          `<button type="button" data-tdset="${esc(path)}" data-v="${esc(value)}" class="${String(current ?? '') === value ? 'on' : ''}" title="${esc(title || text)}">${text}</button>`,
      )
      .join('');
    return `<span class="td-seg">${buttons}</span>`;
  }

  /**
   * CSS образца стиля.
   * @param {object} style
   * @param {object} [field] поле формы (dark — на тёмном фоне)
   * @returns {string}
   */
  static sample(style, field) {
    const font = esc(String(Design.state.work.font || 'Arial').replace(/'/g, ''));
    const dark = field && field.dark ? `background:#${DesignModel.colorHex('NAVYD')};` : '';
    return `font-family:'${font}',Arial,sans-serif;color:#${DesignModel.colorHex(style.color)};${dark}font-weight:${style.bold ? this.BOLD : this.NORMAL};font-style:${style.italic ? 'italic' : 'normal'}`;
  }
}
