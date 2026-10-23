import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { DealCard } from '../crm/deal-card.js';

/**
 * «Контакты» в карточке клиента: звонок и письмо нажатием, «✎» — правка на месте, «＋ Контакт» — новый (первым в списке).
 * Сервер — /api/clientcard/contact (ClientContacts); удаления у менеджера нет.
 */
export class ClientContactsView {
  static SHOWN = 8;
  static FIELDS = [
    { key: 'name', label: 'ФИО', type: 'text', mode: 'text', hint: 'Иванов Иван Иванович', max: 120 },
    { key: 'post', label: 'Должность', type: 'text', mode: 'text', hint: 'Главный механик', max: 120 },
    { key: 'phone', label: 'Телефон', type: 'tel', mode: 'tel', hint: '+7 (900) 123-45-67', max: 40 },
    { key: 'email', label: 'Почта', type: 'email', mode: 'email', hint: 'name@company.ru', max: 200 },
  ];

  /**
   * Раздел «Контакты».
   * @param {object} client клиент из справочника (пустой — клиента в справочнике нет)
   * @param {number|'new'|null} [editing] какой контакт открыт для правки
   * @returns {string}
   */
  static html(client, editing = null) {
    const rows = (client.contacts || [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row && row.name)
      .slice(0, this.SHOWN);
    const list = rows
      .map(({ row, index }) => (index === editing ? this._form(row, index) : this._row(row, index, client.id)))
      .join('');
    const empty = rows.length ? '' : '<p class="empty">Контактов пока нет.</p>';
    const add = this._add(client, editing);
    return `<section id="ccPeople"><div class="cc-sh"><p class="sub">Контакты</p>${add.button}</div>${add.form}${list}${editing === 'new' ? '' : empty}</section>`;
  }

  /**
   * Нажатие внутри раздела: правка, новый, сохранить, отмена. true — нажатие обработано.
   * @param {{modal: object, client: object}} ctx
   * @param {HTMLElement} target
   * @returns {boolean}
   */
  static click(ctx, target) {
    const edit = target.closest('[data-ccce]');
    if (edit) return this._redraw(ctx, Number(edit.dataset.ccce));
    if (target.closest('[data-ccca]')) return this._redraw(ctx, 'new');
    if (target.closest('[data-cccx]')) return this._redraw(ctx, null);
    const save = target.closest('[data-cccs]');
    if (save) {
      this._save(ctx, save.closest('.ccc-f'));
      return true;
    }
    return false;
  }

  static _add(client, editing) {
    if (!client.id) {
      return {
        button: '',
        form: '<p class="muted ccc-no">Клиента нет в справочнике — сохраните КП с этим клиентом.</p>',
      };
    }
    const button =
      editing === 'new'
        ? ''
        : '<button class="btn sm" type="button" data-ccca title="Новый контакт клиента">＋ Контакт</button>';
    return { button, form: editing === 'new' ? this._form({}, 'new') : '' };
  }

  static _row(row, index, clientId) {
    const phone = row.phone
      ? `<a class="ccc-a" href="tel:${esc(String(row.phone).replace(/[^\d+]/g, ''))}" title="Позвонить"><span aria-hidden="true">☎</span>${esc(row.phone)}</a>`
      : '';
    const mail = row.email
      ? `<a class="ccc-a" href="mailto:${esc(row.email)}" title="Написать"><span aria-hidden="true">✉</span>${esc(row.email)}</a>`
      : '';
    const pen = clientId
      ? `<button class="icon ccc-e" type="button" data-ccce="${index}" aria-label="Изменить контакт ${esc(row.name)}" title="Изменить">✎</button>`
      : '';
    return `<div class="ccc"><div class="ccc-h"><div><b>${esc(row.name)}</b>${row.post ? `<span class="muted">${esc(row.post)}</span>` : ''}</div>${pen}</div>${phone}${mail}</div>`;
  }

  static _form(row, index) {
    const inputs = this.FIELDS.map(
      field =>
        `<label class="f"><span>${field.label}${field.key === 'name' ? ' <em class="uf-req">*</em>' : ''}</span><input type="${field.type}" inputmode="${field.mode}" data-cccf="${field.key}" maxlength="${field.max}" value="${esc(row[field.key] || '')}" placeholder="${field.hint}"></label>`,
    ).join('');
    const title = index === 'new' ? 'Новый контакт' : 'Изменить контакт';
    return `<div class="ccc-f" data-ccci="${index}" data-cccw="${esc(row.name || '')}" role="group" aria-label="${title}"><b class="ccc-t">${title}</b>${inputs}
      <div class="row"><button class="btn" type="button" data-cccx>Отмена</button><span class="sp"></span><button class="btn primary" type="button" data-cccs>Сохранить</button></div></div>`;
  }

  static _redraw(ctx, editing) {
    ctx.modal.$('#ccPeople').outerHTML = this.html(ctx.client, editing);
    const first = ctx.modal.$('#ccPeople [data-cccf="name"]');
    if (first) first.focus();
    return true;
  }

  static async _save(ctx, form) {
    const contact = {};
    form.querySelectorAll('[data-cccf]').forEach(input => {
      contact[input.dataset.cccf] = input.value.trim();
    });
    if (!contact.name) {
      Toast.show('Укажите ФИО контакта');
      form.querySelector('[data-cccf="name"]').focus();
      return;
    }
    const spot = form.dataset.ccci;
    try {
      const answer = await Api.request('/api/clientcard/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ id: ctx.client.id, was: spot === 'new' ? '' : form.dataset.cccw, contact }),
      });
      ctx.client.contacts = answer.contacts || [];
      this._redraw(ctx, null);
      Toast.show(spot === 'new' ? 'Контакт добавлен' : 'Контакт сохранён');
      if (DealCard.modal && DealCard.deal && DealCard.deal.clientId === ctx.client.id) DealCard.reload();
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
    }
  }
}
