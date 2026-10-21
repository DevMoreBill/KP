import { esc } from '../../core/util.js';
import { Modal } from '../../core/modal.js';
import { StationDrawing } from '../draw/station-drawing.js';
import { StationUi } from './station-ui.js';
import { S } from '../../core/state.js';
/**
 * «На чертеже» у замечаний «Компоновки»: что показать на плане по тексту замечания — номера позиций («поз. 3», «поз. 2, 4
 * и 5», «поз. 2–4») и элементы по словам (ворота, двери, жалюзи, проход); окно — лист с планом, найденное — в красной рамке
 * (только на экране).
 */
export class IssueSpot {
  static KINDS = [
    ['gate', /ворот/i],
    ['door', /двер(?!ь-жалюзи)|калитк/i],
    ['vent', /жалюзи|приток|выброс|воздухозабор/i],
    ['aisle', /проход/i],
  ];
  static WORDS = { gate: 'ворота', door: 'двери', vent: 'жалюзи', aisle: 'проход' };
  static RANGE_MAX = 30;
  static SCROLL_DELAY = 30;
  static VIEW_PART = 3;

  /**
   * Что подсветить — только то, что есть на плане.
   * @param {string} text замечание
   * @param {object} plan
   * @returns {{pos: number[], kinds: string[]}}
   */
  static of(text, plan) {
    const line = String(text || '');
    const have = new Set([...(plan.items || []), ...(plan.outside || []), ...(plan.roof || [])].map(unit => unit.pos));
    const can = this._present(plan);
    return {
      pos: this._positions(line).filter(pos => have.has(pos)),
      kinds: this.KINDS.filter(([kind, pattern]) => can[kind] && pattern.test(line)).map(([kind]) => kind),
    };
  }

  /** номера позиций из «поз. 2, 4 и 5», «поз. 2–4» (без повторов, в порядке упоминания) */
  static _positions(line) {
    const out = new Set();
    for (const match of line.matchAll(/поз\.\s*([\d,\s–\-и]+)/gi))
      for (const part of match[1].split(/,|\sи\s/)) for (const pos of this._range(part)) out.add(pos);
    return [...out];
  }

  static _range(part) {
    const found = part.trim().match(/^(\d+)(?:\s*[–-]\s*(\d+))?$/);
    if (!found) return [];
    const first = +found[1];
    const last = found[2] ? Math.min(+found[2], first + this.RANGE_MAX) : first;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, step) => first + step);
  }

  /** какие элементы есть на плане */
  static _present(plan) {
    return {
      gate: [plan.gates, plan.gates2].some(gate => gate && !gate.sea),
      door:
        (plan.doors || []).length > 0 ||
        !!(plan.entry && plan.entry.wall === 'front') ||
        !!(plan.dguDoors || []).length ||
        !!plan.dguDoor,
      vent: !!(plan.vent && (plan.vent.louvers || []).length),
      aisle: (plan.items || []).length > 0,
    };
  }

  /**
   * Есть ли что показать.
   * @param {string} text
   * @param {object} plan
   * @returns {boolean}
   */
  static has(text, plan) {
    const spot = this.of(text, plan);
    return spot.pos.length > 0 || spot.kinds.length > 0;
  }

  /**
   * Окно: лист с планом и подсветкой.
   * @param {number} index позиция КП
   * @param {number} number номер замечания в plan.issues
   */
  static open(index, number) {
    const item = S.items[index];
    if (!item) return;
    const plan = StationUi.plan(item);
    const issue = (plan.issues || [])[number];
    if (!issue || !plan.geo || !plan.geo.ext) return;
    const marks = this.of(issue.text, plan);
    const sheets = StationDrawing.sheets(plan, { ...StationUi.meta(item, plan), hl: marks });
    const first = Math.max(
      0,
      sheets.findIndex(svg => svg.includes('class="hl"')),
    );
    const what = [marks.pos.length ? `поз. ${marks.pos.join(', ')}` : '', ...marks.kinds.map(kind => this.WORDS[kind])]
      .filter(Boolean)
      .join(', ');
    const modal = new Modal(
      `<div class="dlg-h"><h3>На чертеже: ${esc(what)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="is-txt ${esc(issue.level)}">${esc(issue.text)}</p>
      ${this._tabs(sheets, first)}
      <div class="is-sheet">${sheets[first]}</div>`,
      'is-dlg',
    );
    setTimeout(() => this._scroll(modal), this.SCROLL_DELAY);
    modal.d.onclick = event => this._click(modal, sheets, event);
  }

  static _tabs(sheets, first) {
    if (sheets.length <= 1) return '';
    const tabs = sheets
      .map(
        (_, page) =>
          `<button type="button" class="chip sm${page === first ? ' on' : ''}" data-sh="${page}">Лист ${page + 1}</button>`,
      )
      .join('');
    return `<div class="is-tabs" role="tablist">${tabs}</div>`;
  }

  /** к подсветке */
  static _scroll(modal) {
    const mark = modal.$('.is-sheet .hl');
    const box = modal.$('.is-sheet');
    if (mark && box)
      box.scrollTop +=
        mark.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / this.VIEW_PART;
  }

  static _click(modal, sheets, event) {
    const button = event.target.closest('[data-x],[data-sh]');
    if (!button) return;
    if (button.dataset.x != null) {
      modal.close();
      return;
    }
    modal.$('.is-sheet').innerHTML = sheets[+button.dataset.sh];
    modal.d.querySelectorAll('[data-sh]').forEach(tab => tab.classList.toggle('on', tab === button));
    setTimeout(() => this._scroll(modal), this.SCROLL_DELAY);
  }
}
