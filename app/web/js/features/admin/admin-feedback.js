import { AdminApi } from './admin-core.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/** «Сообщения о проблемах» от менеджеров (из «Требует внимания»): текст, где случилось, «Прочитано». */
export class AdminFeedback {
  static CTX = [
    ['where', 'Раздел'],
    ['dialog', 'Окно'],
    ['version', 'Версия'],
    ['screen', 'Экран'],
    ['theme', 'Тема'],
  ];

  /**
   * Окно со списком (50 последних, новые сверху).
   * @param {() => void} [changed] после «Прочитано» — обновить «Требует внимания»
   */
  static async open(changed = () => {}) {
    let reply;
    try {
      reply = await AdminApi.get('feedback');
    } catch (error) {
      Toast.show(error.message);
      return;
    }
    const items = reply.items || [];
    const list = items.length ? items.map(row => this._row(row)).join('') : '<p class="empty">Сообщений нет.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Сообщения о проблемах</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div><div class="fb-l">${list}</div>`,
      'fb-dlg',
    );
    modal.d.addEventListener('click', event => {
      const done = event.target.closest('[data-fbdone]');
      if (done) this._done(done, changed);
      else if (event.target.closest('[data-x]')) modal.close();
    });
  }

  static _row(row) {
    const ctx = row.ctx || {};
    const where = this.CTX.filter(([key]) => ctx[key])
      .map(([key, label]) => `${label}: ${esc(ctx[key])}`)
      .join(' · ');
    const errors = (ctx.errors || []).length
      ? `<details><summary class="muted">Ошибки страницы · ${ctx.errors.length}</summary><pre class="fb-e">${esc(ctx.errors.join('\n'))}</pre></details>`
      : '';
    const button = row.done
      ? '<span class="muted">✓ прочитано</span>'
      : `<button class="btn sm" type="button" data-fbdone="${esc(row.id)}">Прочитано</button>`;
    return `<div class="fb-r${row.done ? ' fb-done' : ''}"><div class="fb-h"><b>${esc(row.by || 'менеджер')}</b><span class="muted">${esc(
      String(row.at || '')
        .replace('T', ' ')
        .slice(0, 16),
    )}</span>${button}</div>
      <p>${esc(row.text)}</p><p class="muted">${where}</p>${errors}</div>`;
  }

  static async _done(button, changed) {
    try {
      await AdminApi.post(`feedback/${encodeURIComponent(button.dataset.fbdone)}/done`);
    } catch (error) {
      Toast.show(error.message);
      return;
    }
    button.closest('.fb-r').classList.add('fb-done');
    button.outerHTML = '<span class="muted">✓ прочитано</span>';
    changed();
  }
}
