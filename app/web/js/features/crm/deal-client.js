import { esc } from '../../core/util.js';
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
    return deal.clientCard ? this._card(deal.clientCard) : '';
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

  static _card(card) {
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
    const empty = people.length ? '' : '<span class="muted">Контактов нет — добавьте в карточке клиента.</span>';
    return `<div class="dk-wide dk-cl">${flag}${rows}${more}${empty}</div>`;
  }

  static _person(person) {
    const phone = person.phone
      ? `<a href="tel:${esc(person.phone.replace(/[^\d+]/g, ''))}">${esc(person.phone)}</a>`
      : '';
    const mail = person.email ? `<a href="mailto:${esc(person.email)}">${esc(person.email)}</a>` : '';
    const who = [person.name, person.post].filter(Boolean).map(esc).join(', ');
    return `<div class="dk-pp"><b>${who || 'Контакт'}</b>${phone}${mail}</div>`;
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
