import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { StationReq } from '../req/station-req.js';
/**
 * Свои параметры станции (ручной режим): строки «параметр — значение» в требованиях станции, которых нет в полях подбора
 * (точка росы, исполнение, шум, гарантия…); в КП — в таблице характеристик станции после автоматических.
 */
export class StationParams {
  static HINTS = [
    'Производительность станции, м³/мин',
    'Рабочее давление, бар',
    'Точка росы под давлением, °C',
    'Класс чистоты воздуха (ISO 8573-1)',
    'Температура эксплуатации, °C',
    'Климатическое исполнение',
    'Уровень шума, дБА',
    'Электропитание',
    'Степень защиты',
    'Режим работы',
    'Гарантия',
    'Срок изготовления',
  ];
  static MAX = 30;
  static FOCUS_DELAY = 30;

  /**
   * Строки параметров станции.
   * @param {object} item станция
   * @returns {Array<{k: string, v: string}>}
   */
  static list(item) {
    const req = StationReq.of(item);
    return Array.isArray(req.params) ? req.params : [];
  }

  /**
   * Заполненные строки — в таблицу характеристик.
   * @param {object} item
   * @returns {Array<{k: string, v: string}>}
   */
  static rows(item) {
    return this.list(item)
      .map(param => ({ k: String(param.k || '').trim(), v: String(param.v || '').trim() }))
      .filter(param => param.k && param.v);
  }

  /**
   * Блок «Параметры станции».
   * @param {object} item
   * @param {number} index номер позиции КП
   * @returns {string}
   */
  static html(item, index) {
    const list = this.list(item);
    const rows = list.length
      ? `<datalist id="stParK">${this.HINTS.map(hint => `<option value="${esc(hint)}">`).join('')}</datalist>
      ${list.map((param, row) => this._row(param, row, index)).join('')}`
      : '';
    return `<div class="sq-par"><div class="sq-par-h"><b>Параметры станции</b><span class="muted">свои строки — в таблицу характеристик КП</span>
        <button class="btn ghost sm" type="button" data-a="stParAdd" data-i="${index}"${list.length >= this.MAX ? ' disabled' : ''}>+ параметр</button></div>
      ${rows}</div>`;
  }

  static _row(param, row, index) {
    const path = `items.${index}.req.params`;
    return `<div class="sq-par-r"><input type="text" list="stParK" data-p="${path}.${row}.k" data-req="${index}" data-stpar value="${esc(param.k || '')}" placeholder="Параметр" maxlength="120" aria-label="Параметр">
        <input type="text" data-p="${path}.${row}.v" data-req="${index}" data-stpar value="${esc(param.v || '')}" placeholder="Значение" maxlength="300" aria-label="Значение">
        <button class="icon" type="button" data-a="stParDel" data-i="${index}" data-k="${row}" aria-label="Убрать параметр">✕</button></div>`;
  }

  /**
   * «+ параметр» / «✕».
   * @param {string} action stParAdd | stParDel
   * @param {number} index
   * @param {HTMLElement} button
   * @returns {boolean} перерисовать окно
   */
  static act(action, index, button) {
    const item = S.items[index];
    if (!item) return false;
    const req = StationReq.ensure(item);
    req.params = this.list(item).slice();
    if (action === 'stParAdd') {
      if (req.params.length >= this.MAX) return false;
      req.params.push({ k: '', v: '' });
      setTimeout(() => this._focusLast(), this.FOCUS_DELAY);
    }
    if (action === 'stParDel') {
      req.params.splice(+button.dataset.k, 1);
      this.changed(item);
    }
    return true;
  }

  static _focusLast() {
    const input = [...document.querySelectorAll('#edlg [data-stpar]')]
      .filter(field => /\.k$/.test(field.dataset.p))
      .pop();
    if (input) input.focus();
  }
}
