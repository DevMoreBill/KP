import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { Cabinet } from './cabinet.js';

/** «Клиенты»: клиенты из сделок — в работе, сумма, выиграно, ближайшее дело. */
export class CabClients {
  /**
   * Клиенты сделок: сначала с работой и большей суммой.
   * @returns {object[]}
   */
  static list() {
    const byKey = new Map();
    for (const deal of CrmData.deals()) {
      const key = deal.clientInn || norm(deal.client || deal.title);
      if (key) this._add(byKey, key, deal);
    }
    return [...byKey.values()].sort(
      (one, two) => two.open - one.open || two.sum - one.sum || String(two.last).localeCompare(String(one.last)),
    );
  }

  static _blank(key, deal) {
    return {
      key,
      name: deal.client || deal.title,
      inn: deal.clientInn || '',
      id: deal.clientId || '',
      open: 0,
      sum: 0,
      won: 0,
      wonSum: 0,
      last: '',
      next: null,
      deals: [],
    };
  }

  static _add(byKey, key, deal) {
    const client = byKey.get(key) || this._blank(key, deal);
    client.deals.push(deal);
    if (deal.updated > client.last) client.last = deal.updated;
    if (deal.stage === 'won') {
      client.won++;
      client.wonSum += deal.sum || 0;
    } else if (deal.stage !== 'lost') {
      client.open++;
      client.sum += deal.sum || 0;
    }
    if (deal.next && (!client.next || deal.next.due < client.next.due)) client.next = deal.next;
    byKey.set(key, client);
  }

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    const wanted = norm(Cabinet.query);
    const list = this.list().filter(client => !wanted || norm(`${client.name} ${client.inn}`).includes(wanted));
    const empty = Cabinet.query
      ? 'Не найдено.'
      : 'Клиенты появятся вместе со сделками: сохраните КП или нажмите «＋ Сделка».';
    const body = list.length
      ? `<div class="cab-cls">${list.map(client => this._card(client)).join('')}</div>`
      : `<p class="empty">${empty}</p>`;
    return `<div class="cab-bar">${Cabinet.search('Клиент или ИНН')}<span class="muted cab-tot">Клиентов: <b>${list.length}</b></span></div>${body}`;
  }

  static _card(client) {
    const name = ClientCard.on()
      ? `<button type="button" class="lnk cab-cln" data-cc="${esc(JSON.stringify({ id: client.id, inn: client.inn, name: client.name }))}" title="Карточка клиента">${esc(client.name)}</button>`
      : `<b>${esc(client.name)}</b>`;
    const num = (label, count, sum) =>
      `<span><small>${label}</small><b>${count}</b>${count ? `<em>${CrmFmt.short(sum)}</em>` : ''}</span>`;
    return `<article class="cab-cl"><div class="cab-cl-h">${name}${client.inn ? `<span class="muted">ИНН ${esc(client.inn)}</span>` : ''}</div>
      <div class="cab-cl-n">${num('В работе', client.open, client.sum)}${num('Выиграно', client.won, client.wonSum)}<span><small>Последнее</small><b>${esc(CrmFmt.day(client.last))}</b></span></div>
      <div class="cab-cl-f">${this._next(client)}<button class="btn sm" type="button" data-cldeals="${esc(client.name)}">Сделки (${client.deals.length})</button></div></article>`;
  }

  static _next(client) {
    if (client.next) {
      return `<span class="muted">${CrmData.icon(client.next.kind)} ${esc(client.next.title)} · ${esc(CrmFmt.rel(client.next.due))}</span>`;
    }
    return client.open
      ? '<span class="warn-t">Нет следующего дела</span>'
      : '<span class="muted">Сделок в работе нет</span>';
  }
}
