import { BitrixPanel } from './bitrix-panel.js';
import { BITRIX_GUIDE } from './bitrix-guide-text.js';
import { esc } from '../../core/util.js';

/** «Справка → Руководство»: как программа работает с Битрикс24 — главы с поиском и переходом к настройке. */
export class BitrixGuide {
  static query = '';
  static PDF = 'Руководство по Битрикс24.pdf';

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
   * Глава целиком (для окна и для файла PDF).
   * @param {{id: string, title: string, tab?: string, body: Array}} chapter
   * @param {{links: boolean}} [opts] links — кнопка «Открыть настройку»
   * @returns {string}
   */
  static chapter(chapter, { links = true } = {}) {
    const label = chapter.tab ? (BitrixPanel.TABS.find(([key]) => key === chapter.tab) || [])[1] : '';
    const open =
      links && label
        ? `<button class="btn ghost sm" type="button" data-bxtab="${chapter.tab}" title="${esc(label)}">Открыть настройку →</button>`
        : '';
    return `<section class="bx-gch" id="bxg-${chapter.id}"><h4>${esc(chapter.title)}</h4>${chapter.body.map(part => this._block(part)).join('')}${open}</section>`;
  }

  /**
   * Всё руководство без кнопок — для печати в PDF.
   * @returns {string}
   */
  static printable() {
    return BITRIX_GUIDE.map(chapter => this.chapter(chapter, { links: false })).join('');
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
      <p class="muted">Это же руководство — в файле «${esc(this.PDF)}» в папке программы (со снимками экранов).</p>
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
