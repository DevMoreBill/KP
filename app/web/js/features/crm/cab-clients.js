import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { Cabinet } from './cabinet.js';
import { esc } from '../../core/util.js';
import { ClientCard } from '../kp/client-card.js';
import { Str } from '../../core/str.js';

/** «Клиенты»: клиенты из сделок — в работе, сумма, выиграно, ближайшее дело. */
export class CabClients {
  /**
   * Клиенты сделок: сначала с работой и большей суммой.
   * @returns {object[]}
   */
  static list() {
    const byKey = new Map();
    for (const deal of CrmData.deals()) {
      const key = deal.clientInn || Str.norm(deal.client || deal.title);
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
      who: null,
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
    client.who = client.who || this._reachable(deal.who);
    byKey.set(key, client);
  }

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    const wanted = Str.norm(Cabinet.query);
    const list = this.list().filter(client => !wanted || Str.norm(`${client.name} ${client.inn}`).includes(wanted));
    const empty = Cabinet.query
      ? 'Не найдено.'
      : 'Клиенты появятся вместе со сделками: сохраните КП или нажмите «＋ Сделка».';
    const body = list.length
      ? `<div class="cab-cls">${list.map(client => this._card(client)).join('')}</div>`
      : `<p class="empty">${empty}</p>`;
    return `<div class="cab-bar">${Cabinet.search('Клиент или ИНН')}<span class="muted cab-tot">Клиентов: <b>${list.length}</b></span></div>${body}`;
  }

  static _card(client) {
    const name = ClientCard.enabled()
      ? `<button type="button" class="lnk cab-cln" data-cc="${esc(JSON.stringify({ id: client.id, inn: client.inn, name: client.name }))}" title="Карточка клиента">${esc(client.name)}</button>`
      : `<b class="cab-cln">${esc(client.name)}</b>`;
    return `<article class="cab-cl"><div class="cab-cl-h">${name}${client.inn ? `<span class="muted">ИНН ${esc(client.inn)}</span>` : ''}</div>${this._who(client.who)}
      <div class="cab-cl-n">${this._num('В работе', client.open, client.sum)}${this._num('Выиграно', client.won, client.wonSum)}<span><small>Последнее</small><b>${esc(CrmFmt.day(client.last))}</b><em>движение</em></span></div>
      <div class="cab-cl-f">${this._next(client)}<button class="btn sm" type="button" data-cldeals="${esc(client.name)}">Сделки (${client.deals.length})</button></div></article>`;
  }

  static _reachable(who) {
    return who && (who.phone || who.email) ? who : null;
  }

  // контакт клиента: позвонить или написать одним нажатием
  // итог ячейкой: подпись, сумма — крупно, число сделок — под ней (число и сумма не слипаются в «3 16,1 млн»)
  static _num(label, count, sum) {
    const deals = `${count} ${KPGen.plural(count, 'сделка', 'сделки', 'сделок')}`;
    return `<span class="${count ? '' : 'zero'}"><small>${label}</small><b>${CrmFmt.short(sum)}</b><em>${deals}</em></span>`;
  }

  static _who(who) {
    if (!who) return '<div class="cab-cl-w"><span class="muted">Контакта нет</span></div>';
    const phone = who.phone
      ? `<a class="cab-cl-a" href="tel:${esc(String(who.phone).replace(/[^\d+]/g, ''))}" title="Позвонить"><i aria-hidden="true">☎</i>${esc(who.phone)}</a>`
      : '';
    const mail = who.email
      ? `<a class="cab-cl-a" href="mailto:${esc(who.email)}" title="Написать"><i aria-hidden="true">✉</i>${esc(who.email)}</a>`
      : '';
    return `<div class="cab-cl-w"><b>${esc(who.name || 'Контакт')}</b><div>${phone}${mail}</div></div>`;
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
