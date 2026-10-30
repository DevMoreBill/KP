import { ShortName } from './journal-row.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { KpDate } from '../../core/kp-date.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { CabinetLink } from '../../core/cabinet-link.js';

/** «Лента клиента» в карточке клиента: КП, сделки и заметки одной лентой — от новых к старым. */
export class ClientFeed {
  static SHOWN = 12;
  static NOTE_CHARS = 140;
  static KIND = { kp: '📄', deal: '🤝', note: '📝' };

  /**
   * HTML ленты (пусто, если событий нет).
   * @param {{kps: object[], notes: object[], deals: object[]}} data
   * @returns {string}
   */
  static html({ kps, notes, deals }) {
    const events = [
      ...kps.map(row => this._kp(row)),
      ...deals.map(row => this._deal(row)),
      ...notes.map(row => this._note(row)),
    ]
      .filter(event => event.when)
      .sort((left, right) => right.when.localeCompare(left.when));
    if (!events.length) return '';
    const rows = events
      .slice(0, this.SHOWN)
      .map(
        event =>
          `<li><span class="cf-k" aria-hidden="true">${this.KIND[event.kind]}</span><div><b>${esc(event.title)}</b><span class="muted">${esc(event.date)}${event.sub ? ` · ${esc(event.sub)}` : ''}</span></div></li>`,
      )
      .join('');
    const more = events.length > this.SHOWN ? `<p class="muted">и ещё ${events.length - this.SHOWN}</p>` : '';
    return `<details class="cc-kps cc-feed"><summary class="sub">Лента клиента <b class="md-c">${events.length}</b></summary><ul class="cf-l">${rows}</ul>${more}</details>`;
  }

  static _kp(row) {
    return {
      kind: 'kp',
      when: String(row.savedAt || row.date || ''),
      date: KpDate.ddmm(row.date),
      title: `КП № ${row.number} — ${(row.items || [])[0] || 'без позиций'}`,
      sub: ShortName.of(row.manager || ''),
    };
  }

  static _deal(row) {
    const closed = CabinetLink.closed(row);
    return {
      kind: 'deal',
      when: String((closed && row.stageAt) || row.created || ''),
      date: Fmt.dateTime(closed ? row.stageAt : row.created),
      title: `Сделка «${row.title || row.client || ''}»: ${closed ? CabinetLink.stageLabel(row).toLowerCase() : 'создана'}`,
      sub: CrmFmt.short(row.sum),
    };
  }

  static _note(row) {
    const text = String(row.text || '');
    return {
      kind: 'note',
      when: String(row.at || ''),
      date: Fmt.dateTime(row.at),
      title: text.length > this.NOTE_CHARS ? `${text.slice(0, this.NOTE_CHARS)}…` : text,
      sub: row.by || '',
    };
  }
}
