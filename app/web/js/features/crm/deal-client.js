import { esc } from '../../core/util.js';
import { FEAT } from '../../core/features.js';
/**
 * Клиент в карточке сделки: контакты из справочника (позвонить, написать одним нажатием), пометка «без ИНН» и выбор
 * компании, если клиент из Битрикс24 совпал по контакту с несколькими клиентами программы.
 */
export class DealClient {
  static SHOWN = 4;

  /**
   * Блок под полем «Клиент».
   * @param {object} deal ответ /api/crm/deal (clientPick, clientCard)
   * @returns {string}
   */
  static html(deal) {
    if ((deal.clientPick || []).length) return this._pick(deal.clientPick);
    return deal.clientCard ? this._card(deal.clientCard, deal) : '';
  }

  static _pick(rows) {
    const tiles = rows
      .map(
        row =>
          `<button type="button" class="dk-pk" data-dkpick="${esc(row.id)}"><b>${esc(row.name)}</b><span>${row.inn ? `ИНН ${esc(row.inn)}` : 'без ИНН'}${row.contact && row.contact.name ? ` · ${esc(row.contact.name)}` : ''}</span><small>совпало: ${esc(row.by || 'контакт')}</small></button>`,
      )
      .join('');
    return `<div class="dk-wide dk-pks"><p class="msg warn">Клиент из Битрикс24 совпал по контакту с несколькими компаниями — выберите, чья это сделка:</p><div class="dk-pkl">${tiles}</div></div>`;
  }

  static _card(card, deal) {
    const people = card.contacts || [];
    const rows = people
      .slice(0, this.SHOWN)
      .map(person => this._person(person))
      .join('');
    const rest = people.length - this.SHOWN;
    const more = rest > 0 ? `<span class="muted">и ещё ${rest} — в карточке клиента</span>` : '';
    const flag = card.noInn
      ? '<span class="dk-noinn" title="Реквизитов нет — укажите ИНН в карточке клиента">без ИНН</span>'
      : '';
    const empty = people.length ? '' : '<span class="muted">Контактов нет.</span>';
    const data = esc(JSON.stringify({ id: deal.clientId || '', inn: deal.clientInn || '', name: deal.client || '' }));
    const edit = FEAT.on('clientCard')
      ? `<button class="dk-ce" type="button" data-cc="${data}" title="Открыть карточку клиента: изменить контакт или добавить новый">✎ Изменить или добавить контакт</button>`
      : '';
    return `<div class="dk-wide dk-cl">${flag}${rows}${more}${empty}${edit}</div>`;
  }

  static _person(person) {
    const phone = person.phone
      ? `<a class="dk-pa" href="tel:${esc(person.phone.replace(/[^\d+]/g, ''))}" title="Позвонить"><span aria-hidden="true">☎</span>${esc(person.phone)}</a>`
      : '';
    const mail = person.email
      ? `<a class="dk-pa" href="mailto:${esc(person.email)}" title="Написать"><span aria-hidden="true">✉</span>${esc(person.email)}</a>`
      : '';
    const post = person.post ? `<span class="muted">${esc(person.post)}</span>` : '';
    return `<div class="dk-pp"><div class="dk-ppn"><b>${esc(person.name || 'Контакт')}</b>${post}</div>${phone}${mail}</div>`;
  }

  /**
   * Выбранная компания из списка совпадений → тело сохранения сделки.
   * @param {object} deal
   * @param {string} id
   * @returns {object|null}
   */
  static picked(deal, id) {
    const row = (deal.clientPick || []).find(item => item.id === id);
    return row ? { client: row.name, clientId: row.id, clientInn: row.inn || '' } : null;
  }
}
