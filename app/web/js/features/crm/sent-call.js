import { CrmFmt, DateChips } from './crm-fmt.js';
import { CrmTask } from './crm-task.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * КП ушло клиенту — сразу спросить, когда позвонить: чипы дня и время. Звонок, который программа уже поставила сама
 * («Обратная связь по КП»), переносится на выбранный день, а не дублируется.
 */
export class SentCall {
  static AUTO_STEP = 'auto:sent:';
  static DEFAULT_DAYS = 3;
  static CHIPS = [
    ['Завтра', () => CrmFmt.after(1)],
    ['Через 3 дня', () => CrmFmt.after(SentCall.DEFAULT_DAYS)],
    ['Через неделю', () => CrmFmt.after(CrmFmt.WEEK)],
    ['Через 2 недели', () => CrmFmt.after(CrmFmt.WEEK * 2)],
  ];

  /**
   * Окно «Когда позвонить клиенту?».
   * @param {object} deal ответ /api/crm/deal (после отметки «отправлено»)
   * @param {{id: string, number: string}} offer отправленное КП
   * @param {Function} [after] после сохранения звонка
   */
  static ask(deal, offer, after) {
    const task = this._auto(deal, offer);
    const due = task ? task.due : CrmFmt.after(this.DEFAULT_DAYS);
    const modal = new Modal(this._html(offer, due, task), 'tk-dlg sc-dlg');
    modal.d.addEventListener('click', event => {
      if (DateChips.click(event)) return;
      if (event.target.closest('[data-x]')) modal.close();
    });
    modal.d.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const fields = event.target.elements;
      if (!fields.due.value) {
        Toast.show('Укажите день звонка');
        return;
      }
      modal.close();
      const saved = await this._save(deal, offer, task, { due: fields.due.value, time: fields.time.value });
      if (saved && after) after(saved);
    };
  }

  // звонок, который кабинет ставит сам после отправки этого КП
  static _auto(deal, offer) {
    const step = this.AUTO_STEP + offer.id;
    return (deal.tasks || []).find(task => task.step === step && task.state === 'open') || null;
  }

  static _html(offer, due, task) {
    const note = task
      ? 'звонок уже стоит — перенесём на выбранный день'
      : 'звонок появится в «Сегодня» в выбранный день';
    return `<div class="dlg-h"><h3>Когда позвонить клиенту?</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <form class="tk-ed"><p class="muted">КП № ${esc(offer.number)} отправлено — ${note}.</p>
        ${DateChips.html(this.CHIPS, 'due', due)}
        <div class="row tk-dt"><label class="f"><span>День</span><input type="date" name="due" value="${esc(due)}"></label><label class="f"><span>Время</span><input type="time" name="time" value="${esc((task && task.time) || '')}"></label></div>
        <div class="row"><button class="btn primary" type="submit">Поставить звонок</button><span class="sp"></span><button class="btn" type="button" data-x>Позже</button></div></form>`;
  }

  static async _save(deal, offer, task, when) {
    if (task) return CrmTask.put(task.id, when);
    try {
      const body = { kind: 'call', title: `Обратная связь по КП № ${offer.number}`, deal: deal.id, ...when };
      if (deal.managerId) body.managerId = deal.managerId;
      const added = await Api.request('/api/crm/task', {
        method: 'POST',
        headers: CrmTask.JSON_HEAD,
        body: JSON.stringify(body),
      });
      Toast.show(`Звонок: ${CrmFmt.rel(added.due)}`);
      return added;
    } catch (error) {
      Toast.show(`Звонок не поставлен: ${error.message}`);
      return null;
    }
  }
}
