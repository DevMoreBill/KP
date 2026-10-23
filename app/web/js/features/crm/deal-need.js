import { DealFieldsView } from './deal-fields.js';
import { Api } from '../../core/net.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * Регламент оформления сделки Битрикс24: перед стадией — окно «Заполните» только с тем, чего не хватает (что программа
 * нашла сама — уже заполнено), потом сделка переводится. Регламент выключен — стадия меняется как прежде.
 */
export class DealNeed {
  static HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static FOCUS_MS = 50;
  static CLIENT_INPUT = {
    companyPhone: 'type="tel" inputmode="tel" placeholder="+7 (900) 123-45-67"',
    companyEmail: 'type="email" inputmode="email" placeholder="info@…"',
    inn: 'type="text" inputmode="numeric" maxlength="12" placeholder="10 или 12 цифр"',
    person: 'type="text" maxlength="120" placeholder="Фамилия Имя Отчество"',
    personPhone: 'type="tel" inputmode="tel" placeholder="+7 (900) 123-45-67"',
    personEmail: 'type="email" inputmode="email" placeholder="name@…"',
  };

  /**
   * Перевести сделку на стадию по регламенту.
   * @param {object} deal сделка (id, rev)
   * @param {{stage: string, lostReason?: string, lostNote?: string}} body
   * @returns {Promise<object|null>} карточка сделки после перевода или null (отменено или ошибка — уже показана)
   */
  static async move(deal, body) {
    const view = await this._view(deal, body.stage, body.lostReason);
    if (!view) return null;
    const { lostNote, ...move } = body;
    if (!view.on) return this._put(deal, move);
    const given = this._given(view, lostNote);
    const rest = view.fields.filter(row => !(row.field && given[row.field.code]));
    if (!rest.length && !view.client.length) return this._post(deal, { ...move, uf: given });
    const filled = await this._ask(view, { ...view, fields: rest }, given, 'Сохранить и перевести');
    return filled ? this._post(deal, { ...move, ...filled, uf: { ...given, ...filled.uf } }) : null;
  }

  /**
   * Заполнить недостающее для следующей стадии, не переводя сделку («Заполнить» в карточке).
   * @param {object} deal
   * @param {string} stage
   * @returns {Promise<object|null>}
   */
  static async fill(deal, stage) {
    const view = await this._view(deal, stage, '');
    if (!view || !view.on || view.ok) return null;
    const filled = await this._ask(view, view, {}, 'Сохранить');
    return filled ? this._post(deal, filled) : null;
  }

  static async _view(deal, stage, reason) {
    const query = new URLSearchParams({ stage, reason: reason || '' });
    try {
      return await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/need?${query}`);
    } catch (error) {
      Toast.show(`Стадия не изменена: ${error.message}`);
      return null;
    }
  }

  // комментарий из окна проигрыша — в поле «Комментарий к проигранной сделке»
  static _given(view, lostNote) {
    const row = view.fields.find(one => one.key === 'lostNote' && one.field);
    return row && lostNote ? { [row.field.code]: lostNote } : {};
  }

  static async _put(deal, body) {
    try {
      return await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}`, {
        method: 'PUT',
        headers: { ...this.HEAD, 'X-KP-Rev': String(deal.rev) },
        body: JSON.stringify(body),
      });
    } catch (error) {
      Toast.show(`Стадия не изменена: ${error.message}`);
      return null;
    }
  }

  static async _post(deal, body) {
    try {
      return await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/need`, {
        method: 'POST',
        headers: this.HEAD,
        body: JSON.stringify(body),
      });
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message}`);
      return null;
    }
  }

  // окно: поля портала, заметка, клиент; → {uf, note?, client?} или null
  static _ask(view, shown, given, action) {
    const state = {
      fields: shown.fields.map(row => row.field).filter(Boolean),
      uf: { ...given },
      users: view.users || {},
    };
    const modal = new Modal(this._html(view, shown, state, action), 'dn-dlg');
    return new Promise(resolve => {
      let result = null;
      modal.d.addEventListener('click', event => {
        if (event.target.closest('[data-x]')) modal.close();
        else if (event.target.closest('[data-dnok]')) result = this._collect(modal, shown, state);
        else this._pick(event.target, modal, shown, state);
        if (result) modal.close();
      });
      modal.d.addEventListener('change', event => this._changed(event.target, state));
      modal.d.addEventListener('input', event => this._added(event.target, modal, shown, state));
      modal.d.addEventListener('close', () => resolve(result));
      setTimeout(() => modal.d.querySelector('input,select,textarea')?.focus(), this.FOCUS_MS);
    });
  }

  static _html(view, shown, state, action) {
    const head = view.close === 'lost' ? esc(view.stage) : `Для стадии «${esc(view.stage)}» заполните`;
    return `<div class="dlg-h"><h3>${head}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted dn-sub">По регламенту Битрикс24. Что программа нашла сама — уже заполнено.</p>
      <div class="dn-b">${this._fields(shown, state)}${this._client(view, shown)}</div>
      <div class="row"><button class="btn primary" type="button" data-dnok>${esc(action)}</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div>`;
  }

  static _fields(shown, state) {
    const rows = shown.fields.map(row => {
      if (row.field) return DealFieldsView.field(row.field, state);
      if (row.source === 'note')
        return `<label class="f dk-wide"><span>${esc(row.label)}</span><textarea rows="2" maxlength="3000" data-dnnote placeholder="Кратко: что нужно клиенту">${esc(shown.noteHint || '')}</textarea></label>`;
      return `<p class="msg warn dk-wide">${esc(row.label)}: сохраните КП по сделке — его файл уйдёт в Битрикс24 сам.</p>`;
    });
    return rows.length ? `<div class="dk-f dk-uf dn-f">${rows.join('')}</div>` : '';
  }

  static _client(view, shown) {
    if (!shown.client.length) return '';
    const values = view.values || {};
    const rows = shown.client
      .map(
        row =>
          `<label class="f"><span>${esc(row.label)}</span><input ${this.CLIENT_INPUT[row.key] || 'type="text"'} data-dnc="${esc(row.key)}" value="${esc(values[row.key] || '')}" autocomplete="off"></label>`,
      )
      .join('');
    return `<fieldset class="dn-c"><legend>Клиент и контакт</legend><div class="dk-f">${rows}</div></fieldset>`;
  }

  static _changed(target, state) {
    const input = target.closest('[data-uf]');
    if (!input) return;
    const { code, value } = DealFieldsView.read(input, state);
    state.uf[code] = value;
  }

  static _pick(target, modal, shown, state) {
    const chip = target.closest('[data-ufpick]');
    if (!chip) return;
    const change = DealFieldsView.toggle(chip, state);
    state.uf[change.code] = change.value;
    this._redraw(modal, shown, state);
  }

  static _added(target, modal, shown, state) {
    const input = target.closest('[data-ufadd]');
    const change = input && DealFieldsView.added(input, state);
    if (!change) return;
    state.uf[change.code] = change.value;
    this._redraw(modal, shown, state);
  }

  static _redraw(modal, shown, state) {
    const box = modal.d.querySelector('.dn-f');
    if (box) box.outerHTML = this._fields(shown, state);
  }

  static _filled(value) {
    return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== '' && value !== '0';
  }

  // всё обязательное заполнено → тело сохранения; нет — подсветка и подсказка
  static _collect(modal, shown, state) {
    const empty = [];
    for (const row of shown.fields) {
      if (row.field && !this._filled(state.uf[row.field.code])) empty.push(row.label);
      if (row.source === 'file') empty.push(row.label);
    }
    const note = modal.d.querySelector('[data-dnnote]');
    if (note && !note.value.trim()) empty.push('Комментарий');
    const client = {};
    modal.d.querySelectorAll('[data-dnc]').forEach(input => {
      client[input.dataset.dnc] = input.value.trim();
      input.closest('.f').classList.toggle('uf-empty', !input.value.trim());
      if (!input.value.trim()) empty.push(input.closest('.f').querySelector('span').textContent);
    });
    if (empty.length) {
      Toast.show(`Заполните: ${empty.join(', ')}`);
      return null;
    }
    const body = { uf: state.uf };
    if (note) body.note = note.value.trim();
    if (Object.keys(client).length) body.client = client;
    return body;
  }
}
