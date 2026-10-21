import { CrmData } from './crm-data.js';
import { CrmFmt, DateChips } from './crm-fmt.js';
import { CrmTask } from './crm-task.js';
import { DealCard } from './deal-card.js';
import { Cabinet } from './cabinet.js';
import { ClientSuggest } from './client-suggest.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { Str } from '../../core/str.js';
import { ClientStore } from '../kp/client-store.js';
import { Modal } from '../../core/modal.js';

/**
 * «Новая сделка» без КП: клиент с подсказкой из справочника, задача, сумма, ожидаемая дата чипом, воронка и сразу первое
 * дело. После создания открывается карточка сделки.
 */
export class DealNew {
  static AHEAD = 30;
  static FOCUS_MS = 50;
  static HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /** Открыть окно. */
  static open() {
    const expected = CrmFmt.after(this.AHEAD);
    const modal = new Modal(this._html(expected), 'dk-new-dlg');
    const form = modal.$('form');
    const field = form.elements.client;
    field.addEventListener('input', () => {
      this._found(modal);
      ClientSuggest.run(field, client => this._picked(modal, client));
    });
    modal.d.addEventListener('click', event => this._click(event, modal));
    form.onsubmit = event => {
      event.preventDefault();
      this._create(form, modal);
    };
    setTimeout(() => form.elements.client.focus(), this.FOCUS_MS);
  }

  static _html(expected) {
    const tomorrow = CrmFmt.after(1);
    const funnel = DealCard.funnelSelect({ funnel: CrmData.funnel() }, 'name="funnel"');
    return `<div class="dlg-h"><h3>Новая сделка</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted dk-nnote">Сделки появляются и сами — при сохранении КП. Здесь — сделка без КП: запрос, встреча, тендер.</p>
      <form class="dk-new" autocomplete="off"><label class="f"><span class="req">Клиент</span><input type="text" name="client" maxlength="300" placeholder="Название, ИНН, телефон, e-mail или ФИО — подскажем"><small class="muted dk-found"></small></label>
        <label class="f"><span>Объект или задача</span><input type="text" name="title" maxlength="200" placeholder="Например: компрессорная для цеха № 3"></label>
        <div class="dk-nr"><label class="f"><span>Сумма, ₽ <em class="muted">если известна</em></span><input type="text" name="sum" inputmode="decimal" placeholder="по КП"></label>
        <label class="f"><span>Ожидаемая дата</span><input type="date" name="expected" value="${expected}"></label></div>
        ${DateChips.html(DateChips.DEAL, 'expected', expected)}${funnel}
        <fieldset class="dk-first"><legend>Первое дело <span class="muted">— чтобы сделка не потерялась</span></legend>${CrmTask.kinds('call')}
          <input type="text" name="task" maxlength="200" placeholder="Например: позвонить, уточнить потребность" aria-label="Что сделать">
          <div class="tq-r">${DateChips.html(DateChips.TASK, 'due', tomorrow)}<input type="date" name="due" value="${tomorrow}" aria-label="Дата дела"></div></fieldset>
        <div class="row"><button class="btn primary" type="submit">Создать сделку</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div></form>`;
  }

  static _picked(modal, client) {
    ClientStore.keep([client]);
    modal.$('[name=client]').value = client.name || '';
    this._found(modal);
  }

  static _client(text) {
    const digits = text.replace(/\D/g, '');
    return (ClientStore.list || []).find(
      row => Str.norm(row.name) === Str.norm(text) || (row.inn && row.inn === digits),
    );
  }

  static _found(modal) {
    const client = this._client(modal.$('[name=client]').value.trim());
    modal.$('.dk-found').textContent = client ? `✓ из справочника${client.inn ? `, ИНН ${client.inn}` : ''}` : '';
  }

  static _click(event, modal) {
    if (DateChips.click(event)) return;
    if (event.target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const kind = event.target.closest('[data-tqk]');
    if (kind) CrmTask.pickKind(kind);
  }

  static _body(fields) {
    const text = fields.client.value.trim();
    const client = this._client(text);
    const body = {
      client: client ? client.name : text,
      clientInn: client ? client.inn || '' : '',
      clientId: client ? client.id : '',
      title: fields.title.value.trim() || (client ? client.name : text),
      expected: fields.expected.value,
    };
    if (fields.sum.value.trim()) body.sum = fields.sum.value.replace(/\s/g, '');
    if (fields.funnel) body.funnel = fields.funnel.value;
    if (CrmData.who && CrmData.who !== 'all') body.managerId = CrmData.who;
    return body;
  }

  static async _create(form, modal) {
    const fields = form.elements;
    if (!fields.client.value.trim() && !fields.title.value.trim()) {
      Toast.show('Укажите клиента');
      fields.client.focus();
      return;
    }
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    try {
      const deal = await Api.request('/api/crm/deal', {
        method: 'POST',
        headers: this.HEAD,
        body: JSON.stringify(this._body(fields)),
      });
      await this._firstTask(form, deal);
      modal.close();
      if (document.getElementById('cabWin')?.open) await Cabinet.reload();
      DealCard.open(deal.id);
    } catch (error) {
      Toast.show(`Сделка не создана: ${error.message}`);
    } finally {
      delete form.dataset.busy;
    }
  }

  static async _firstTask(form, deal) {
    const fields = form.elements;
    const title = fields.task.value.trim();
    if (!title || !fields.due.value) return;
    const body = {
      kind: form.querySelector('[data-tqk].on')?.dataset.tqk || 'call',
      title,
      due: fields.due.value,
      deal: deal.id,
    };
    if (deal.managerId) body.managerId = deal.managerId;
    try {
      await Api.request('/api/crm/task', { method: 'POST', headers: this.HEAD, body: JSON.stringify(body) });
    } catch (error) {
      Toast.show(`Сделка создана, дело — нет: ${error.message}`);
    }
  }
}
