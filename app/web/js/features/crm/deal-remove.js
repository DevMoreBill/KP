import { Cabinet } from './cabinet.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/** «Удалить сделку»: после вопроса — в корзину «Настроек» (восстанавливает администратор вместе с делами, документами и КП). */
export class DealRemove {
  /**
   * Спросить и удалить.
   * @param {object} deal
   * @param {Function} after вызывается после удаления
   */
  static async ask(deal, after) {
    const name = [deal.title, deal.client].filter(Boolean).join(' — ');
    const answer = await Modal.ask(`<h3>Удалить сделку № ${esc(deal.number)}?</h3><p><b>${esc(name)}</b></p>
      <p class="muted">Сделка уйдёт в корзину вместе с делами и документами; КП останутся в журнале. Вернуть её может администратор: «Настройки → Корзина». В Битрикс24 сделка не удаляется.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn danger-bg" type="button" data-v="1">Удалить</button></div>`);
    if (!answer) return;
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/remove`, { method: 'POST' });
    } catch (error) {
      Toast.show(`Не удалено: ${error.message}`);
      return;
    }
    Toast.show(`Сделка № ${deal.number} удалена — в корзине «Настроек»`);
    after();
    if (document.getElementById('cabWin')?.open) Cabinet.reload();
  }
}
