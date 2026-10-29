import { BitrixPanel } from './bitrix-panel.js';
import { BITRIX_GUIDE } from './bitrix-guide-text.js';
import { esc } from '../../core/util.js';

/** «Справка → Руководство»: как программа работает с Битрикс24 — главы с поиском и переходом к настройке. */
export class BitrixGuide {
  static query = '';

  static _block(part) {
    if (Array.isArray(part)) return `<ul>${part.map(item => `<li>${item}</li>`).join('')}</ul>`;
    return `<p>${part}</p>`;
  }

  static _plain(chapter) {
    return [chapter.title, ...chapter.body.flat()]
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .toLowerCase();
  }

  /**
   * Глава целиком.
   * @param {{id: string, title: string, tab?: string, body: Array}} chapter
   * @returns {string}
   */
  static chapter(chapter) {
    const label = chapter.tab ? (BitrixPanel.TABS.find(([key]) => key === chapter.tab) || [])[1] : '';
    const open = label
      ? `<button class="btn ghost sm" type="button" data-bxtab="${chapter.tab}" title="${esc(label)}">Открыть настройку →</button>`
      : '';
    return `<section class="bx-gch" id="bxg-${chapter.id}"><h4>${esc(chapter.title)}</h4>${chapter.body.map(part => this._block(part)).join('')}${open}</section>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const query = this.query.trim().toLowerCase();
    const shown = BITRIX_GUIDE.filter(chapter => !query || this._plain(chapter).includes(query));
    const toc = BITRIX_GUIDE.map(
      chapter => `<a href="#bxg-${chapter.id}" data-bxg="${chapter.id}">${esc(chapter.title)}</a>`,
    ).join('');
    const body = shown.length
      ? shown.map(chapter => this.chapter(chapter)).join('')
      : '<p class="empty">Ничего не найдено — попробуйте другое слово.</p>';
    return `<div class="st-card bx-guide"><div class="row"><input type="search" id="bxgFind" data-nodirty placeholder="Найти в руководстве: дубль, контакт, удалили…" value="${esc(this.query)}" aria-label="Поиск по руководству"></div>
      <nav class="bx-gtoc" aria-label="Содержание">${toc}</nav>
      ${body}</div>`;
  }

  /** События вкладки. */
  static bind() {
    const find = BitrixPanel.one('#bxgFind');
    find.oninput = () => {
      this.query = find.value;
      const caret = find.selectionStart;
      BitrixPanel.render();
      const again = BitrixPanel.one('#bxgFind');
      again.focus();
      again.setSelectionRange(caret, caret);
    };
    BitrixPanel.all('[data-bxg]').forEach(link => {
      link.onclick = event => {
        event.preventDefault();
        BitrixPanel.one(`#bxg-${link.dataset.bxg}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }
}
