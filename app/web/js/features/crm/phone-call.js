import { CallResult } from './call-result.js';
import { CrmTask } from './crm-task.js';
import { DealCard } from './deal-card.js';
import { today } from '../../core/util.js';

/**
 * Звонок с телефона → «Итог звонка»: менеджер нажал номер в деле или карточке сделки, поговорил и вернулся в программу —
 * сразу окно итога (звонок из дела — это дело, иначе — новое дело «Звонок» по сделке, отмеченное после итога).
 */
export class PhoneCall {
  static pending = null; // {deal, task, at}
  static MIN_MS = 5000; // вернулись раньше — звонок не состоялся
  static MAX_MS = 3600000; // позже часа — уже не спрашиваем

  /** Следить за нажатием номеров и возвращением в программу. */
  static listen() {
    document.addEventListener('click', event => this._tap(event));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._back();
    });
  }

  static _tap(event) {
    const link = event.target.closest('a[href^="tel:"]');
    if (!link) return;
    const row = link.closest('[data-task]');
    const callTask = row && row.querySelector('[data-tcall]');
    const deal = callTask
      ? callTask.dataset.tcall
      : link.closest('dialog.deal-dlg') && DealCard.deal && DealCard.deal.id;
    if (!deal) return;
    this.pending = { deal, task: callTask ? +row.dataset.task : 0, at: Date.now() };
  }

  static async _back() {
    const call = this.pending;
    this.pending = null;
    if (!call) return;
    const spent = Date.now() - call.at;
    if (spent < this.MIN_MS || spent > this.MAX_MS) return;
    const taskId = call.task || (await this._newCall(call.deal));
    if (taskId)
      CallResult.ask(
        taskId,
        call.deal,
        () => DealCard.deal && DealCard.deal.id === call.deal && DealCard.open(call.deal),
      );
  }

  static async _newCall(deal) {
    const task = await CrmTask.create({ deal, kind: 'call', title: 'Звонок клиенту', due: today(), again: true });
    return task ? task.id : 0;
  }
}
