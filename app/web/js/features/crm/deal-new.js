import { CrmData } from './crm-data.js';
import { CrmTask } from './crm-task.js';
import { DealCard } from './deal-card.js';
import { ClientSuggest } from './client-suggest.js';
import { InnClient } from './inn-client.js';
import { DealIntakeView } from './deal-intake.js';
import { DealKp } from './deal-kp.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { Str } from '../../core/str.js';
import { ClientStore } from '../kp/client-store.js';
import { Modal } from '../../core/modal.js';
import { CrmFmt, DateChips } from '../../core/crm-fmt.js';
import { CabState } from './cab-state.js';

/**
 * «Новая сделка» без КП: клиент с подсказкой из справочника, задача, сумма, ожидаемая дата чипом, воронка и сразу первое
 * дело. После создания открывается карточка сделки.
 */
export class DealNew {
  static AHEAD = 30;
  static FOCUS_MS = 50;
  static HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static SOURCES = [
    { key: 'ad', label: 'Рекламная', hint: 'с сайта, по телефону или почте компании, из рекламы' },
    { key: 'repeat', label: 'Повторная', hint: 'клиент обратился к вам лично (почта, звонок вам)' },
    { key: 'own', label: 'Личная', hint: 'клиента нашли сами и выявили потребность' },
  ];

  /**
   * Открыть окно.
   * @param {{mail?: boolean}} [opts] mail — сразу раскрыть «Заполнить из письма или ТЗ»
   */
  static open(opts = {}) {
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
    if (opts.mail) modal.$('.dk-mail').open = true;
    setTimeout(() => (opts.mail ? form.elements.mail : form.elements.client).focus(), this.FOCUS_MS);
  }

  static _html(expected) {
    const tomorrow = CrmFmt.after(1);
    const funnel = DealCard.funnelSelect({ funnel: CrmData.funnel() }, 'name="funnel"');
    return `<div class="dlg-h"><h3>Новая сделка</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted dk-nnote">Сделки появляются и сами — при сохранении КП. Здесь — сделка без КП: запрос, встреча, тендер.</p>
      <form class="dk-new" autocomplete="off">${DealIntakeView.html()}<label class="f"><span class="req">Клиент</span><input type="text" name="client" maxlength="300" placeholder="Название, ИНН, телефон, e-mail или ФИО — подскажем; по ИНН найдём в ФНС"><small class="muted dk-found"></small></label>
        ${this._sources()}<label class="f"><span>Объект или задача</span><input type="text" name="title" maxlength="200" placeholder="Например: компрессорная для цеха № 3"></label>
        <div class="dk-nr"><label class="f"><span>Сумма, ₽ <em class="muted">если известна</em></span><input type="text" name="sum" inputmode="decimal" placeholder="по КП"></label>
        <label class="f"><span>Ожидаемая дата</span><input type="date" name="expected" value="${expected}"></label></div>
        ${DateChips.html(DateChips.DEAL, 'expected', expected)}${funnel}
        <fieldset class="dk-first"><legend>Первое дело <span class="muted">— чтобы сделка не потерялась</span></legend>${CrmTask.kinds('call')}
          <input type="text" name="task" maxlength="200" placeholder="Например: позвонить, уточнить потребность" aria-label="Что сделать">
          <div class="tq-r">${DateChips.html(DateChips.TASK, 'due', tomorrow)}<input type="date" name="due" value="${tomorrow}" aria-label="Дата дела"></div></fieldset>
        <div class="row"><button class="btn primary" type="submit">Создать сделку</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div></form>`;
  }

  // регламент Битрикс24: откуда заявка — обязательно
  static _sources() {
    if (!CrmData.regs()) return '';
    const chips = this.SOURCES.map(
      row =>
        `<button type="button" class="chip" data-dnsrc="${row.key}" aria-pressed="false" title="${row.hint}">${row.label}</button>`,
    ).join('');
    return `<div class="f dk-src" role="group" aria-label="Откуда заявка"><span class="req">Откуда заявка</span><div class="chips">${chips}</div></div>`;
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
    const text = modal.$('[name=client]').value.trim();
    const client = this._client(text);
    const byInn = !client && InnClient.looks(text) ? 'ИНН — название и реквизиты программа найдёт в ФНС сама' : '';
    modal.$('.dk-found').textContent = client ? `✓ из справочника${client.inn ? `, ИНН ${client.inn}` : ''}` : byInn;
  }

  static _click(event, modal) {
    if (DateChips.click(event) || DealIntakeView.click(event, modal)) return;
    if (event.target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const kind = event.target.closest('[data-tqk]');
    if (kind) CrmTask.pickKind(kind);
    const source = event.target.closest('[data-dnsrc]');
    if (source) {
      modal.d.querySelectorAll('[data-dnsrc]').forEach(chip => {
        chip.classList.toggle('on', chip === source);
        chip.setAttribute('aria-pressed', String(chip === source));
      });
    }
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
    const source = fields.client.form.querySelector('[data-dnsrc].on');
    if (source) body.source = source.dataset.dnsrc;
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
    if (CrmData.regs() && !form.querySelector('[data-dnsrc].on')) {
      Toast.show('Укажите, откуда заявка: рекламная, повторная или личная');
      return;
    }
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    try {
      const body = await this._byInn({ ...this._body(fields), ...DealIntakeView.extra() });
      if (!body) return;
      const deal = await Api.request('/api/crm/deal', {
        method: 'POST',
        headers: this.HEAD,
        body: JSON.stringify(body),
      });
      await this._firstTask(form, deal);
      const models = DealIntakeView.models(form);
      modal.close();
      if (document.getElementById('cabWin')?.open) await CabState.reload();
      if (models.length)
        DealKp.newKp(deal, models).catch(error => Toast.show(`КП из заявки не создано: ${error.message || error}`));
      else DealCard.open(deal.id);
    } catch (error) {
      Toast.show(`Сделка не создана: ${error.message}`);
    } finally {
      delete form.dataset.busy;
    }
  }

  // в поле «Клиент» — ИНН, которого нет в справочнике: клиент из ФНС
  static async _byInn(body) {
    if (body.clientId || !InnClient.looks(body.client)) return body;
    const client = await InnClient.find(body.client);
    if (!client) return null;
    const title = body.title === body.client ? client.name : body.title;
    return { ...body, client: client.name, clientInn: client.inn, clientId: client.id, title };
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
