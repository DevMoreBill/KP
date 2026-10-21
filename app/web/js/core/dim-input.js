import { esc } from './util.js';
/**
 * Габариты «Д × Ш × В» — три окошка вместо одного. Видимые поля длина, ширина, высота собирают строку «1200 × 800 × 600» в
 * скрытое поле с прежними атрибутами (data-p, data-kitct…): данные и обработчики — прежние. Ввод — событие input скрытого
 * поля, когда заполнены все три (или только длина, если можно); уход из группы — change.
 */
export class DimInput {
  static NAMES = ['длина', 'ширина', 'высота'];
  static SHORT = ['Д', 'Ш', 'В'];
  static PARTS = 3;
  static NUMBER = /^\d+(?:[.,]\d+)?$/;
  static UNITS = [
    [/\bмм\s*$/i, 'мм'],
    [/\d\s*м\s*$/i, 'м'],
    [/\bсм\s*$/i, 'см'],
  ];
  static EXAMPLE = /(\d[\d\s]*(?:[.,]\d+)?)\s*[×xх*]\s*(\d[\d\s]*(?:[.,]\d+)?)\s*[×xх*]\s*(\d[\d\s]*(?:[.,]\d+)?)/i;

  /**
   * Строка → {v: [Д, Ш, В], unit, raw}: «1200×800×600 мм», «1,2 x 0,8 x 1,5 м», «10000» (только длина).
   * @param {*} text
   * @returns {{v: string[], unit: string, raw: string}}
   */
  static parse(text) {
    const trimmed = String(text ?? '').trim();
    const unit = (this.UNITS.find(([pattern]) => pattern.test(trimmed)) || [null, ''])[1];
    const body = trimmed.replace(/\s*(мм|см|м)\.?\s*$/i, '').replace(/(\d)\s+(?=\d{3}\b)/g, '$1');
    const parts = body
      .split(/\s*[×xхX*Х]\s*/)
      .map(part => part.trim())
      .filter(part => part !== '');
    if (parts.length && parts.length <= this.PARTS && parts.every(part => this.NUMBER.test(part))) {
      return { v: [parts[0] || '', parts[1] || '', parts[2] || ''], unit, raw: '' };
    }
    return { v: ['', '', ''], unit, raw: trimmed };
  }

  /**
   * Три поля + скрытое с attrs (строка атрибутов: data-p="…" и др.).
   * @param {string} attrs
   * @param {*} value
   * @param {{ph?: string, label?: string, lenOnly?: boolean, unit?: string}} [opts] ph — подсказка-строка; lenOnly —
   *   можно только длину; unit — единица, которую дописать к строке (по умолчанию — как в исходном значении)
   * @returns {string}
   */
  static html(attrs, value, opts = {}) {
    const parsed = this.parse(value);
    const unit = opts.unit != null ? opts.unit : parsed.unit;
    const hints = this._hints(opts.ph);
    const label = opts.label || 'Габариты';
    const box = k =>
      `<input type="text" inputmode="decimal" data-dimk="${k}" value="${esc(parsed.v[k])}" placeholder="${esc(hints[k] || this.SHORT[k])}" aria-label="${esc(`${label}: ${this.NAMES[k]}`)}" autocomplete="off">`;
    const title = parsed.raw ? ` title="Было: ${esc(parsed.raw)} — впишите три числа"` : '';
    const unitTag = unit ? `<i class="dim-u">${esc(unit)}</i>` : '';
    return `<span class="dim3${parsed.raw ? ' raw' : ''}" data-dim data-unit="${esc(unit)}"${opts.lenOnly ? ' data-len' : ''}${title}>${box(0)}<i aria-hidden="true">×</i>${box(1)}<i aria-hidden="true">×</i>${box(2)}${unitTag}<input type="hidden" ${attrs} value="${esc(value ?? '')}"></span>`;
  }

  // подсказка в окошках — из примера в тексте
  static _hints(example) {
    const match = String(example || '').match(this.EXAMPLE);
    if (match) return [match[1], match[2], match[3]].map(part => part.replace(/\s+/g, ''));
    return this.parse(example || '').v;
  }

  /**
   * Значение группы: три числа — «Д × Ш × В[ ед.]», только длина (если можно) — «Д», пусто — '', иначе null (не дописано).
   * @param {Element} group
   * @returns {string | null}
   */
  static join(group) {
    const values = [...group.querySelectorAll('[data-dimk]')].map(input => input.value.trim().replace(/\s+/g, ''));
    const filled = values.filter(Boolean).length;
    const unit = group.dataset.unit;
    if (!filled) return '';
    if (values.some(part => part && !this.NUMBER.test(part))) return null;
    if (filled === this.PARTS) return values.join(' × ') + (unit ? ` ${unit}` : '');
    if (filled === 1 && values[0] && group.hasAttribute('data-len')) return values[0];
    return null;
  }

  /**
   * Записать строку в скрытое поле и сообщить о вводе (type — 'input' или 'change').
   * @param {Element} group
   * @param {string} type
   */
  static fire(group, type) {
    const hidden = group.querySelector('input[type=hidden]');
    const joined = this.join(group);
    group.classList.toggle('bad', joined === null);
    if (joined === null || hidden.value === joined) return;
    hidden.value = joined;
    hidden.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /** Обработчики страницы: ввод в окошках и уход из группы. */
  static listen() {
    document.addEventListener('input', event => {
      const group = this._group(event);
      if (group) this.fire(group, 'input');
    });
    document.addEventListener('focusout', event => {
      const group = this._group(event);
      if (!group || group.contains(event.relatedTarget)) return;
      const hidden = group.querySelector('input[type=hidden]');
      const joined = this.join(group);
      if (joined === null) return;
      hidden.value = joined;
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  static _group(event) {
    const group = event.target.closest && event.target.closest('[data-dim]');
    return group && event.target.dataset.dimk != null ? group : null;
  }
}
