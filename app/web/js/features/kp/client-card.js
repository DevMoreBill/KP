import { ClientStore } from './client-store.js';
import { Currency } from './currency.js';
import { Drafts } from './drafts.js';
import { KpDate } from './kp-date.js';
import { KpRepeat } from './kp-repeat.js';
import { KpTrack } from './kp-track.js';
import { Managers } from './managers.js';
import { KpLoader } from './reminders.js';
import { ShortName } from './journal-row.js';
import { Steps } from '../../ui/steps.js';
import { FormView } from '../../ui/form-view.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { AdminSession, Api } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { FEAT } from '../../core/features.js';
import { KpTabs } from './kp-tabs.js';
import { CrmData } from '../crm/crm-data.js';
import { CrmFmt } from '../crm/crm-fmt.js';
import { CrmFunnel } from '../crm/crm-funnel.js';
import { DealCard } from '../crm/deal-card.js';
import { Fmt, Str } from '../../core/str.js';
import { CopyText } from '../../core/files.js';
import { ClientFeed } from './client-feed.js';

/**
 * Карточка клиента: реквизиты, сделки и все КП клиента с итогами, контакты (звонок и письмо нажатием), объекты, заметки отдела.
 * Сервер — ClientCardController. Открывается из раздела «Клиент», журнала, кабинета.
 */
export class ClientCard {
  static CONTACTS = 8;
  static OBJECTS = 6;
  static MANAGERS = 3;
  static PERCENT = 100;

  /**
   * Функция включена.
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('clientCard');
  }

  /**
   * Название клиента — ссылкой на карточку.
   * @param {{id?: string, inn?: string, name?: string}} client
   * @param {string} [text]
   * @returns {string}
   */
  static link(client, text) {
    if (!this.enabled() || !(client.id || client.inn || client.name)) return esc(text || '');
    const data = JSON.stringify({ id: client.id || '', inn: client.inn || '', name: client.name || '' });
    return `<button type="button" class="lnk cc-l" data-cc="${esc(data)}" title="Карточка клиента">${esc(text || client.name || '')}</button>`;
  }

  /**
   * Сумма КП в его валюте (для строки карточки).
   * @param {object} row
   * @returns {number}
   */
  static sum(row) {
    return (row.econ && row.econ.sum != null ? row.econ.sum : row.sum) || 0;
  }

  /**
   * Плитка итогов.
   * @param {string} label
   * @param {string|number} value
   * @param {string} [sub]
   * @returns {string}
   */
  static tile(label, value, sub = '') {
    return `<div class="cc-t"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  }

  /**
   * Заметки о клиенте.
   * @param {object[]} notes
   * @param {string} myId
   * @returns {string}
   */
  static notesHtml(notes, myId) {
    if (!notes.length) {
      return '<p class="empty">Заметок нет. Запишите то, что важно знать коллегам: кто принимает решение, бюджет, особенности объекта.</p>';
    }
    return notes
      .map(
        note =>
          `<div class="cc-n"><div><span class="muted">${esc(Fmt.dateTime(note.at))} · ${esc(note.by || '')}</span><p>${esc(note.text)}</p></div>${note.uid === myId || AdminSession.on ? `<button class="icon" type="button" data-ccnd="${esc(note.at)}" aria-label="Удалить заметку" title="Удалить заметку">✕</button>` : ''}</div>`,
      )
      .join('');
  }

  /**
   * Открыть карточку.
   * @param {{id?: string, inn?: string, name?: string}} client
   */
  static open(client) {
    return Modal.once('clientcard', () => this._open(client));
  }

  static async _open(query) {
    if (!this.enabled()) return;
    let answer;
    try {
      answer = await Api.request(
        `/api/clientcard?id=${encodeURIComponent(query.id || '')}&inn=${encodeURIComponent(query.inn || '')}&name=${encodeURIComponent(query.name || '')}`,
      );
    } catch (error) {
      Toast.show(`Карточка клиента недоступна: ${error.message || error}`);
      return;
    }
    const ctx = { answer, client: answer.client || {}, kps: answer.kps || [], myId: Managers.meId() || '' };
    ctx.modal = new Modal(
      `${this._head(ctx)}
      ${this._tiles(ctx)}
      <div class="cc-g">
        <div class="cc-main">${this._deals(ctx)}${this._kps(ctx)}${ClientFeed.html({ kps: ctx.kps, notes: answer.notes || [], deals: this._clientDeals(ctx) })}</div>
        ${this._side(ctx)}
      </div>
      <div class="dlg-acts"><button class="btn primary" type="button" data-ccnew>＋ Новое КП этому клиенту</button></div>`,
      'cc-dlg',
    );
    ctx.modal.d.onclick = event => this._click(ctx, event.target);
  }

  static _req({ answer, client }) {
    const inn = client.inn || answer.inn;
    return [
      inn ? `ИНН ${esc(inn)}` : '',
      client.kpp ? `КПП ${esc(client.kpp)}` : '',
      client.ogrn ? `ОГРН ${esc(client.ogrn)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  static _head({ answer, client }) {
    const req = this._req({ answer, client });
    const director = client.director
      ? `${client.address ? '<br>' : ''}${esc(`${client.directorPost || 'Руководитель'}: ${client.director}`)}`
      : '';
    const address =
      client.address || client.director ? `<p class="muted cc-addr">${esc(client.address || '')}${director}</p>` : '';
    return `<div class="dlg-h"><div><h3>${esc(client.name || answer.name || 'Клиент')}</h3><span class="muted cc-req">${req || 'реквизиты не указаны'}${client.status ? ` · ${esc(client.status)}` : ''}</span></div>${req ? '<button class="btn sm" type="button" data-ccreq title="Название, ИНН, КПП, ОГРН, адрес и руководитель — одним текстом, чтобы вставить в письмо или счёт">📋 Реквизиты</button>' : ''}<button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${address}`;
  }

  static _tiles({ answer, kps }) {
    const byStatus = answer.by || {};
    const count = key => (byStatus[key] || {}).n || 0;
    const total = key => (byStatus[key] || {}).sum || 0;
    const won = count('won');
    const closed = won + count('lost');
    const open = kps.length - closed;
    const track = FEAT.on('track')
      ? this.tile(
          'В работе',
          open,
          `${KPGen.money(kps.length ? (answer.total || 0) - total('won') - total('lost') : 0)} руб.`,
        ) +
        this.tile('Выиграно', won, `${KPGen.money(total('won'))} руб.`) +
        this.tile(
          'Конверсия',
          closed ? `${Math.round((won / closed) * this.PERCENT)} %` : '—',
          closed ? `из ${closed} закрытых` : 'нет закрытых',
        )
      : '';
    const last = kps[0];
    return `<div class="cc-tiles">${this.tile('Всего КП', kps.length, `${KPGen.money(answer.total || 0)} руб.`)}
        ${track}
        ${this.tile('Последнее КП', last ? esc(KpDate.ddmm(last.date)) : '—', last ? esc(ShortName.of(last.manager || '')) : '')}</div>`;
  }

  // сделки клиента из кабинета (если он загружен): стадия, сумма, следующий шаг — открыть одним нажатием
  static _clientDeals({ answer, client }) {
    const inn = client.inn || answer.inn || '';
    const name = Str.norm(client.name || answer.name || '');
    return CrmData.deals().filter(deal =>
      inn ? deal.clientInn === inn : name && Str.norm(deal.client || '') === name,
    );
  }

  static _deals(ctx) {
    const deals = this._clientDeals(ctx);
    if (!deals.length) return '';
    const rows = deals
      .map(deal => {
        const next = deal.next ? ` · ${esc(deal.next.title)}, ${esc(CrmFmt.rel(deal.next.due))}` : '';
        return `<button type="button" class="md-r cc-deal" data-ccdeal="${esc(deal.id)}"><b>${esc(deal.title || deal.client)}</b><span class="muted">${esc(CrmFunnel.label(deal))} · ${CrmFmt.short(deal.sum)}${next}</span></button>`;
      })
      .join('');
    return `<section class="cc-kps"><p class="sub">Сделки клиента <b class="md-c">${deals.length}</b></p><div class="cc-kl">${rows}</div></section>`;
  }

  // телефон и почта — нажатием: звонок, письмо
  static _reach(row) {
    const phone = row.phone
      ? `<a href="tel:${esc(String(row.phone).replace(/[^\d+]/g, ''))}">${esc(row.phone)}</a>`
      : '';
    const mail = row.email ? `<a href="mailto:${esc(row.email)}">${esc(row.email)}</a>` : '';
    return [esc(row.post || ''), phone, mail].filter(Boolean).join(' · ');
  }

  static _kps({ answer, kps }) {
    const managers =
      answer.managers && answer.managers.length
        ? ` <span class="muted">· ведут: ${answer.managers
            .slice(0, this.MANAGERS)
            .map(name => esc(ShortName.of(name)))
            .join(', ')}</span>`
        : '';
    const rows = kps.length
      ? kps.map(row => this._kpRow(row)).join('')
      : '<p class="empty">КП этому клиенту ещё не было. <button class="btn sm primary" type="button" data-ccnew>＋ Новое КП</button></p>';
    return `<section class="cc-kps"><p class="sub">КП клиента${managers}</p>
          <div class="cc-kl">${rows}</div></section>`;
  }

  static _kpRow(row) {
    const more = row.positions > 1 ? ` и ещё ${row.positions - 1}` : '';
    const status = FEAT.on('track') ? `<span class="md-st">${KpTrack.chip(row)}</span>` : '';
    return `<div class="md-r"><span class="md-n">№ ${esc(row.number)}</span><div><b>${esc(KpDate.ddmm(row.date))} · ${KPGen.money(this.sum(row))} ${esc(Currency.short((row.econ && row.econ.cur) || 'RUB'))}</b><span class="muted">${esc((row.items || [])[0] || '')}${more} · ${esc(ShortName.of(row.manager || ''))}</span>${status}</div><button class="btn sm ghost" type="button" data-ccr="${esc(row.id)}" title="Новое КП этому клиенту: позиции те же, дата — сегодня, цены — как сейчас в каталоге">Повторить</button><button class="btn sm" type="button" data-cco="${esc(row.id)}">Открыть</button></div>`;
  }

  static _side({ answer, client, myId }) {
    const contacts = (client.contacts || []).filter(row => row && row.name);
    const objects = (client.objects || []).filter(row => row && (row.purpose || row.address));
    const people = contacts.length
      ? contacts
          .slice(0, this.CONTACTS)
          .map(row => `<div class="cc-c"><b>${esc(row.name)}</b><span class="muted">${this._reach(row)}</span></div>`)
          .join('')
      : '<p class="empty">Контакты появятся после сохранения КП с контактным лицом.</p>';
    const places = objects.length
      ? `<section><p class="sub">Объекты</p>${objects
          .slice(0, this.OBJECTS)
          .map(
            row =>
              `<div class="cc-c"><b>${esc(row.purpose || 'Объект')}</b><span class="muted">${esc(row.address || '')}</span></div>`,
          )
          .join('')}</section>`
      : '';
    const add = client.id
      ? '<div class="cc-add"><textarea id="ccN" rows="2" maxlength="2000" placeholder="Заметка о клиенте — видна всем менеджерам"></textarea><button class="btn" type="button" data-ccna>Добавить</button></div>'
      : '<p class="muted" style="margin:0 0 6px;font-size:13px">Клиента нет в справочнике — заметки появятся после сохранения КП.</p>';
    return `<div class="cc-side">
          <section><p class="sub">Контакты</p>${people}</section>
          ${places}
          <section><p class="sub">Заметки</p>${add}
            <div id="ccNotes">${this.notesHtml(answer.notes || [], myId)}</div></section>
        </div>`;
  }

  static async _note({ modal, client, myId }, body) {
    try {
      const answer = await Api.request('/api/clientcard/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ id: client.id, ...body }),
      });
      modal.$('#ccNotes').innerHTML = this.notesHtml(answer.notes || [], myId);
      return true;
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
      return false;
    }
  }

  static _ACTIONS = [
    ['[data-x]', ctx => ctx.modal.close()],
    [
      '[data-ccr]',
      (ctx, button) => {
        ctx.modal.close();
        KpRepeat.run(button.dataset.ccr);
      },
    ],
    [
      '[data-cco]',
      (ctx, button) => {
        ctx.modal.close();
        KpLoader.byId(button.dataset.cco).catch(error => Toast.show(`Не открылось: ${error.message}`));
      },
    ],
    ['[data-jst]', (ctx, button) => ClientCard._status(ctx, button)],
    ['[data-ccna]', ctx => ClientCard._addNote(ctx)],
    [
      '[data-ccnd]',
      (ctx, button) => {
        if (confirm('Удалить заметку?')) ClientCard._note(ctx, { del: button.dataset.ccnd });
      },
    ],
    ['[data-ccnew]', ctx => ClientCard._newKp(ctx)],
    ['[data-ccreq]', ctx => Requisites.copy({ ...ctx.client, inn: ctx.client.inn || ctx.answer.inn })],
    [
      '[data-ccdeal]',
      (ctx, button) => {
        ctx.modal.close();
        DealCard.open(button.dataset.ccdeal);
      },
    ],
  ];

  static _click(ctx, target) {
    for (const [selector, act] of this._ACTIONS) {
      const button = target.closest(selector);
      if (button) {
        act(ctx, button);
        return;
      }
    }
  }

  static _status(ctx, button) {
    const row = ctx.kps.find(offer => offer.id === button.dataset.jst);
    if (!row) return;
    ctx.modal.close();
    KpTrack.open(row);
  }

  static async _addNote(ctx) {
    const field = ctx.modal.$('#ccN');
    const text = field.value.trim();
    if (!text) {
      field.focus();
      return;
    }
    if (await this._note(ctx, { text })) field.value = '';
  }

  static async _newKp({ modal, client, answer }) {
    modal.close();
    if (!(await KpTabs.prepare())) return;
    KpState.replace(KpState.fresh());
    if (client.id) ClientStore.apply(client);
    else {
      S.client = answer.name || '';
      S.clientInn = answer.inn || '';
      FormView.render();
      KpState.persist();
    }
    Drafts.loaded();
    Steps.open('equip');
    Toast.show(`Новое КП для ${client.name || answer.name || 'клиента'}`);
  }

  /** Название клиента со ссылкой открывает карточку. */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-cc]');
      if (!button) return;
      event.preventDefault();
      let query;
      try {
        query = JSON.parse(button.dataset.cc);
      } catch {
        return;
      }
      this.open(query);
    });
  }
}

/** Реквизиты клиента одним текстом в буфер обмена — вставить в письмо, счёт или договор. */
export class Requisites {
  /**
   * Текст реквизитов (пустые строки не попадают).
   * @param {object} client
   * @returns {string}
   */
  static text(client) {
    const director = client.director ? `${client.directorPost || 'Руководитель'}: ${client.director}` : '';
    return [
      client.full || client.name,
      client.inn && `ИНН ${client.inn}`,
      client.kpp && `КПП ${client.kpp}`,
      client.ogrn && `ОГРН ${client.ogrn}`,
      client.address && `Адрес: ${client.address}`,
      director,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Скопировать.
   * @param {object} client
   */
  static async copy(client) {
    const ok = await CopyText.copy(this.text(client));
    Toast.show(
      ok
        ? 'Реквизиты скопированы — вставьте их в письмо или документ'
        : 'Не скопировалось — браузер не дал доступ к буферу обмена',
    );
  }
}
