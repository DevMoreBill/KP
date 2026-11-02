import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { DealLockNote } from '../../core/deal-lock-note.js';

/**
 * «＋ Сделка»: у клиента у этого менеджера уже есть свежая незакрытая сделка (правило «Одна сделка на клиента», сервер —
 * deal_guard.DealGuard) — вопрос: открыть её, всё равно создать новую или отмена. Только предупреждение.
 */
export class DealNewWarn {
  static CREATE = { action: 'create' };
  static CANCEL = { action: 'cancel' };

  /**
   * Что делать с новой сделкой.
   * @param {{client: string, clientInn?: string, clientId?: string, managerId?: string}} body поля новой сделки
   * @param {string} task первое дело из формы (пусто — нет)
   * @returns {Promise<{action: string, deal?: string}>} create — создать, open — открыть deal, cancel — ничего
   */
  static async ask(body, task) {
    if (!FEAT.on('dealNewWarn')) return this.CREATE;
    const lock = await this._lock(body);
    if (!lock) return this.CREATE;
    const answer = await Modal.ask(this._html(lock, task));
    if (answer === 'new') return this.CREATE;
    if (answer === 'open') return { action: 'open', deal: lock.deal };
    return this.CANCEL;
  }

  // свежая незакрытая сделка клиента у менеджера новой сделки; проверка не удалась — создание не задерживается
  static async _lock(body) {
    const query = [
      `inn=${encodeURIComponent(body.clientInn || '')}`,
      `name=${encodeURIComponent(body.client || '')}`,
      `client=${encodeURIComponent(body.clientId || '')}`,
    ];
    if (body.managerId) query.push(`manager=${encodeURIComponent(body.managerId)}`);
    try {
      const pick = await Api.request(`/api/crm/pick?${query.join('&')}`);
      return (pick.guard && pick.guard.lock) || null;
    } catch (error) {
      Toast.show(`Сделки клиента не проверены: ${error.message || error}`);
      return null;
    }
  }

  static _html(lock, task) {
    const into = task ? ` Первое дело «${esc(task)}» добавим в неё.` : '';
    return `<h3>У клиента уже есть сделка</h3><p>Сделка ${DealLockNote.deal(lock)}: ${esc(DealLockNote.why(lock))}.</p>
      <p class="muted">Обычно новая сделка не нужна: КП и дела по клиенту удобнее вести в одной сделке.${into}</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn" type="button" data-v="new">Всё равно создать</button><button class="btn primary" type="button" data-v="open">Открыть сделку</button></div>`;
  }
}
