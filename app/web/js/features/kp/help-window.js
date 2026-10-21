import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { $, esc } from '../../core/util.js';
import { APP_VERSIONS, AppVersion, HELP_SECTIONS } from '../help.js';
import { Api } from '../../core/net.js';
/**
 * Окно «Руководство» (кнопка «?» в шапке, меню «⋯» и меню телефона): разделы — HELP_SECTIONS, история версий —
 * APP_VERSIONS (help.js). Поиск по тексту, печать раздела или всего руководства.
 */
export class HelpWindow {
  static KEY = 'kp.helpSec';
  static PRINT_DELAY = 300;

  /**
   * Фактическая версия — от сервера (после установки патча она новее встроенной в EXE).
   * @returns {Promise<void>}
   */
  static loadVersion() {
    return Api.request('/api/version')
      .then(answer => {
        if (!answer || !answer.version) return;
        AppVersion.current = String(answer.version).replace(/^(\d+\.\d+)\.0$/, '$1');
        AppVersion.patched = !!answer.patched;
      })
      .catch(() => {});
  }

  static _saved() {
    try {
      return localStorage.getItem(this.KEY) || 'start';
    } catch {
      return 'start';
    }
  }

  static _all() {
    const versions = APP_VERSIONS.map(
      ([version, date, items]) =>
        `<h4>Версия ${version} <span class="muted">· ${date}</span></h4><ul>${items.map(text => `<li>${esc(text)}</li>`).join('')}</ul>`,
    ).join('');
    return [
      ...HELP_SECTIONS,
      [
        'versions',
        'История версий',
        `<p class="muted">Текущая версия — <b>${AppVersion.current}</b>${AppVersion.patched ? ' (установлено обновление)' : ''}.</p>${versions}`,
      ],
    ];
  }

  static _strip(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  /**
   * Открыть руководство.
   * @param {string} [section] раздел ('versions' — история версий)
   */
  static open(section) {
    const dialog = Modal.host('helpdlg', 'helpwin', 'Руководство');
    const ctx = { dialog, sec: section || this._saved(), q: '', all: this._all() };
    dialog.onclick = event => this._click(ctx, event.target);
    dialog.onchange = event => {
      if (!event.target.classList.contains('hl-sel')) return;
      ctx.sec = event.target.value;
      this._draw(ctx);
    };
    this._draw(ctx);
    if (!dialog.open) dialog.showModal();
  }

  static _mark(body, query) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return body.replace(/>([^<]+)</g, (whole, text) => `>${text.replace(pattern, found => `<mark>${found}</mark>`)}<`);
  }

  static _draw(ctx) {
    const query = ctx.q.trim().toLowerCase();
    const hits = query
      ? ctx.all.filter(([, title, html]) => `${title} ${this._strip(html)}`.toLowerCase().includes(query))
      : ctx.all;
    if (!hits.some(row => row[0] === ctx.sec) && hits.length) ctx.sec = hits[0][0];
    const cur = ctx.all.find(row => row[0] === ctx.sec) || ctx.all[0];
    const body = query ? this._mark(cur[2], ctx.q.trim()) : cur[2];
    const options = hits
      .map(([id, title]) => `<option value="${id}"${id === cur[0] ? ' selected' : ''}>${esc(title)}</option>`)
      .join('');
    const buttons =
      hits
        .map(
          ([id, title]) =>
            `<button type="button" class="${id === cur[0] ? 'on' : ''}" data-hs="${id}">${esc(title)}</button>`,
        )
        .join('') || '<p class="muted">Ничего не найдено</p>';
    ctx.dialog.innerHTML = `<div class="dlg-h"><h3>Руководство пользователя<small>Конструктор КП · версия ${AppVersion.current}</small></h3>
        <button class="btn" type="button" data-hp="print">Печать</button><button class="icon" type="button" data-hp="close" aria-label="Закрыть">✕</button></div>
      <div class="hl-b"><nav class="hl-nav"><input type="search" id="hlQ" placeholder="Поиск по руководству" value="${esc(ctx.q)}" autocomplete="off">
        <select class="hl-sel" aria-label="Раздел">${options}</select>
        ${buttons}</nav>
        <article class="hl-a"><h2>${esc(cur[1])}</h2>${body}</article></div>`;
    $('#hlQ').oninput = event => {
      ctx.q = event.target.value;
      this._draw(ctx);
      const input = $('#hlQ');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
  }

  static _click(ctx, target) {
    const button = target.closest('[data-hs],[data-hp]');
    if (!button) return;
    if (button.dataset.hs) {
      ctx.sec = button.dataset.hs;
      try {
        localStorage.setItem(this.KEY, ctx.sec);
      } catch {
        // без хранилища — раздел не запоминается
      }
      this._draw(ctx);
      ctx.dialog.querySelector('.hl-a').scrollTop = 0;
      return;
    }
    if (button.dataset.hp === 'close') ctx.dialog.close();
    else if (button.dataset.hp === 'print') this._print(ctx.all);
  }

  static _print(all) {
    const win = window.open('', '_blank');
    if (!win) {
      Toast.show('Разрешите всплывающие окна для печати');
      return;
    }
    win.document
      .write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Руководство пользователя — Конструктор КП</title>
        <style>body{font:14px/1.5 Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ccc}h4{margin:14px 0 4px}code{background:#f2f2f2;padding:0 4px}</style></head>
        <body><h1>Руководство пользователя — Конструктор КП (версия ${AppVersion.current})</h1>${all.map(([, title, html]) => `<h2>${esc(title)}</h2>${html}`).join('')}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), this.PRINT_DELAY);
  }
}
