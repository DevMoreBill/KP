import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { CabState } from './cab-state.js';

/** «Удалить сделку»: после вопроса — в корзину «Настроек» (восстанавливает администратор вместе с делами, документами и КП). */
export class DealRemove {
  static UNDO_MS = 10000;

  /**
   * Спросить и удалить.
   * @param {object} deal
   * @param {Function} after вызывается после удаления
   */
  static async ask(deal, after) {
    const name = [deal.title, deal.client].filter(Boolean).join(' — ');
    const answer = await Modal.ask(`<h3>Удалить сделку № ${esc(deal.number)}?</h3><p><b>${esc(name)}</b></p>
      <p class="muted">Сделка уйдёт в корзину вместе с делами и документами; КП останутся в журнале. Передумали — «Отменить» в сообщении внизу; позже вернуть сделку может администратор: «Настройки → Корзина». В Битрикс24 сделка не удаляется.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn danger-bg" type="button" data-v="1">Удалить</button></div>`);
    if (!answer) return;
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/remove`, { method: 'POST' });
    } catch (error) {
      Toast.show(`Не удалено: ${error.message}`);
      return;
    }
    Toast.undo(`Сделка № ${deal.number} удалена`, () => this._restore(deal), this.UNDO_MS);
    after();
    this._refresh();
  }

  static async _restore(deal) {
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/restore`, { method: 'POST' });
      Toast.show(`Сделка № ${deal.number} восстановлена`);
    } catch (error) {
      Toast.show(`Не восстановлено: ${error.message}`);
    }
    this._refresh();
  }

  static _refresh() {
    if (document.getElementById('cabWin')?.open) CabState.reload();
  }
}
