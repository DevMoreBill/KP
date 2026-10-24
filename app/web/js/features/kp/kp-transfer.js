import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * «Передать другому менеджеру» (журнал КП → «⋯»): КП закрепляется за выбранным менеджером (автор и контакты в КП),
 * сделка КП с открытыми делами переходит вместе с ним; если в сделке есть КП других менеджеров — галочкой.
 */
export class KpTransferView {
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static managers = [];

  /**
   * Пункт меню «⋯» (функция выключена — пусто).
   * @param {string} id КП
   * @returns {string}
   */
  static item(id) {
    return FEAT.on('kpTransfer')
      ? `<button type="button" data-jt="${esc(id)}" title="Закрепить КП (и его сделку) за другим менеджером">Передать другому менеджеру…</button>`
      : '';
  }

  /**
   * Открыть окно передачи.
   * @param {string} id КП
   * @param {() => void} [done] после передачи
   */
  static async open(id, done) {
    let plan;
    try {
      [plan, this.managers] = await Promise.all([
        Api.request(`/api/kp/${encodeURIComponent(id)}/transfer`),
        Api.request('/api/managers'),
      ]);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    const modal = new Modal(this._html(plan), 'tk-dlg kt-dlg');
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    modal.$('form').onsubmit = event => {
      event.preventDefault();
      this._send(modal, id, done);
    };
  }

  static _html(plan) {
    const options = (this.managers || [])
      .filter(row => row.id && row.id !== plan.managerId)
      .map(row => `<option value="${esc(row.id)}">${esc(row.name || row.id)}</option>`)
      .join('');
    return `<div class="dlg-h"><h3>Передать КП № ${esc(plan.number)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted">Сейчас: ${esc(plan.manager || '— не назначен —')}</p>
      <form><label class="f"><span>Новый менеджер</span><select name="manager" required><option value="">— выберите —</option>${options}</select></label>
        ${this._deal(plan.deal)}
        <p class="muted">В КП станут его имя и контакты. Файл Word КП остаётся прежним — откройте КП и сохраните, чтобы контакты в файле обновились. Если КП открыто во вкладке — закройте её и откройте КП заново.</p>
        <div class="row"><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Передать</button></div></form>`;
  }

  static _deal(deal) {
    if (!deal) return '';
    if (!deal.others) return `<p>Сделка «${esc(deal.title)}» и её открытые дела перейдут вместе с КП.</p>`;
    return `<label class="ck"><input type="checkbox" name="deal"> Передать и сделку «${esc(deal.title)}» — в ней ещё КП других менеджеров: ${deal.others}</label>`;
  }

  static async _send(modal, id, done) {
    const form = modal.$('form');
    const box = form.elements.deal;
    const body = { manager: form.elements.manager.value, deal: box && !box.checked ? 'keep' : 'with' };
    try {
      const reply = await Api.request(`/api/kp/${encodeURIComponent(id)}/transfer`, {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify(body),
      });
      modal.close();
      Toast.show(`КП передано: ${reply.manager}${reply.deal ? ' — вместе со сделкой' : ''}`);
      if (done) done();
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }
}
