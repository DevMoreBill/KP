import { FormView } from './form-view.js';
import { TenderBlock } from './tender.js';
import { UiKit } from './ui-kit.js';
import { Str } from '../core/str.js';
import { ClientCard } from '../features/kp/client-card.js';
import { DealPick } from '../features/crm/deal-pick.js';
import { PartyCheck } from '../features/kp/party-check.js';
import { ClientFields, ClientStore, Inn } from '../features/kp/client-store.js';
import { Steps } from './steps.js';
import { Api } from '../core/net.js';
import { DefRegistry } from '../core/defaults.js';
import { KpTrack } from '../features/kp/kp-track.js';
import { ShortName } from '../features/kp/journal-row.js';
import { KpDate } from '../features/kp/kp-date.js';
import { esc, today } from '../core/util.js';
import { S } from '../core/state.js';
import { FEAT } from '../core/features.js';

/**
 * У клиента уже есть недавние КП (по ИНН, за срок «kp.dupDays» из «Значений программы») — чтобы два менеджера не
 * готовили параллельные предложения.
 */
export class ClientPrev {
  static state = { key: '', items: [], busy: false };
  static INN_MIN = 10;
  static DUP_DAYS = 120;
  static SHOWN = 3;
  static LIMIT = 20;

  static _inn(value) {
    return String(value || '').replace(/\D/g, '');
  }

  /**
   * Предупреждение «У этого клиента уже есть КП» (пока список не загружен — пусто, загрузка в фоне).
   * @returns {string}
   */
  static html() {
    if (!FEAT.on('clientPrev')) return '';
    const key = this._inn(S.clientInn);
    if (key.length < this.INN_MIN) return '';
    if (this.state.key !== key) {
      if (!this.state.busy) this.load(key);
      return '';
    }
    const items = this.state.items.filter(saved => saved.id !== S.kpId);
    if (!items.length) return '';
    const shown = items
      .slice(0, this.SHOWN)
      .map(
        saved =>
          `<b>№ ${esc(saved.number)}</b> от ${esc(KpDate.ddmm(saved.date))} — ${esc(ShortName.of(saved.manager || ''))}, ${esc(KpTrack.STATUS[KpTrack.status(saved.track)].toLowerCase())}`,
      )
      .join('; ');
    const more = items.length > this.SHOWN ? ` и ещё ${items.length - this.SHOWN}` : '';
    return `<div class="msg warn cl-prev">У этого клиента уже есть КП: ${shown}${more}.
    <button type="button" class="lnk" data-a="clPrev">Показать в журнале</button></div>`;
  }

  /**
   * Загрузить недавние КП клиента по ИНН.
   * @param {string} key ИНН (цифры)
   */
  static async load(key) {
    const state = this.state;
    state.busy = true;
    const since = KpDate.addDays(today(), -Math.round(DefRegistry.num('kp.dupDays', this.DUP_DAYS)));
    try {
      const found = await Api.request(`/api/history?limit=${this.LIMIT}&q=${encodeURIComponent(key)}`);
      state.items = (found.items || []).filter(
        saved => this._inn(saved.clientInn) === key && (saved.date || '') >= since,
      );
    } catch {
      state.items = [];
    }
    state.key = key;
    state.busy = false;
    if (Steps.current === 'client' && state.items.some(saved => saved.id !== S.kpId)) FormView.render();
  }
}

/** Раздел 1 «Клиент»: кому (поиск или карточка клиента), вид КП, контактное лицо, объект, дата и город. */
export class ClientStep {
  static CHIPS = 4;
  static OBJECT_TEXT = 70;
  static RISK = {
    ok: ['ok', 'рисков не найдено'],
    warn: ['warn', 'есть замечания'],
  };

  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    const has = !!(S.client || S.clientInn);
    const edit = S._clEdit || (has && !S.client.trim());
    const client = ClientStore.current();
    return `<section class="step" id="st-client"><h2><span class="n">1</span>Клиент${UiKit.tip(`<p>Начните вводить название или ИНН: поиск идёт по вашему справочнику клиентов${ClientStore.total ? ` (${ClientStore.total})` : ''}, а по ИНН — в реестре ФНС; реквизиты заполнятся сами.</p><p>Контактное лицо и объект необязательны: контакт выводится на титуле («Вниманию: …»), объект — для каких нужд и куда поставка.</p><p>Ключи Checko и DaData, загрузка клиентов списком ИНН — в меню «⋯» вверху.</p>`)}</h2>
  ${TenderBlock.html()}
  <div class="csec"><p class="sub">Кому</p>${has ? this._summary(edit) : this._finder()}${(has && edit) || S._clManual ? this._form() : ''}${has ? PartyCheck.line() : ''}${has ? ClientPrev.html() : ''}</div>
  ${has ? DealPick.html() : ''}
  ${this._contact(client)}
  ${this._object(client)}
  <div class="csec"><div class="grid g2">${UiKit.field('Дата КП', 'date', { type: 'date', req: 1 })}${UiKit.field('Город', 'city', { ph: 'Например: Казань' })}</div></div>
  </section>`;
  }

  static _finder() {
    return `<div class="cl-find"><input type="text" id="clFind" placeholder="Название, ИНН, телефон, e-mail или ФИО контакта" autocomplete="off" aria-label="Поиск клиента"><div id="clList" class="cl-list" hidden></div></div>
    <p class="muted" style="margin:8px 0 0"><button type="button" class="lnk" data-a="clientManual">Ввести реквизиты вручную</button></p>`;
  }

  static _badge() {
    if (!S.clientStatus) return '';
    return `<span class="st-badge ${/действ/i.test(S.clientStatus) ? 'ok' : 'bad'}">${esc(S.clientStatus)}</span>`;
  }

  static _risk() {
    if (!S.check || S.check.error) return '';
    const [cls, text] = this.RISK[S.check.score] || ['bad', 'высокий риск'];
    return `<span class="st-badge ${cls}">${text}</span>`;
  }

  static _card() {
    if (!(ClientCard.enabled() && (S.clientId || S.clientInn))) return '';
    const ref = { id: S.clientId || '', inn: String(S.clientInn || '').replace(/\D/g, ''), name: S.client || '' };
    return `<button class="btn ghost" type="button" data-cc="${esc(JSON.stringify(ref))}" title="Все КП клиента, итоги, контакты и заметки">Карточка клиента</button>`;
  }

  static _summary(edit) {
    const ids = [
      S.clientInn ? `ИНН ${esc(S.clientInn)}` : '',
      S.clientKpp ? `КПП ${esc(S.clientKpp)}` : '',
      S.clientOgrn ? `ОГРН ${esc(S.clientOgrn)}` : '',
    ];
    return `<div class="cl-card">
      <div class="cl-head"><b>${esc(S.client || 'Без названия')}</b>${this._badge()}${this._risk()}</div>
      <div class="cl-meta">${ids.filter(Boolean).join(' · ') || '<span class="muted">реквизиты не указаны</span>'}</div>
      ${S.clientAddr ? `<div class="cl-meta">${esc(S.clientAddr)}</div>` : ''}
      ${S.clientDir ? `<div class="cl-meta">${esc([S.clientDirPost || 'Руководитель', S.clientDir].join(': '))}</div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="clientEdit">${edit ? 'Скрыть реквизиты' : 'Изменить реквизиты'}</button><button class="btn ghost" type="button" data-a="clientChange">Другой клиент</button>${S.clientInn ? '<button class="btn ghost" type="button" data-a="clientReq" title="Название, ИНН, КПП, ОГРН, адрес и руководитель — одним текстом">📋 Реквизиты</button>' : ''}${this._card()}</div></div>`;
  }

  static _form() {
    const field = (label, path, opts) => UiKit.field(label, path, opts);
    return `<div class="cl-form">
      <div class="grid inn-row"><label class="f"><span>ИНН</span><input type="text" inputmode="numeric" data-p="clientInn" value="${esc(S.clientInn)}" placeholder="10 или 12 цифр" class="${!S.clientInn || Inn.valid(S.clientInn) ? '' : 'bad'}" maxlength="12"></label>
        <div style="align-self:end" class="row"><button class="btn" type="button" data-a="partyFind">Заполнить по ИНН</button><span class="muted" id="partyMsg">${S.clientSrc ? `Данные: ${esc(S.clientSrc)}` : ''}</span></div></div>
      <div class="grid g2" style="margin-top:12px">${field('Название в КП', 'client', { req: 1, ph: 'ООО «Компания»' })}${field('Полное наименование', 'clientFull', { ph: 'Общество с ограниченной ответственностью «Компания»' })}</div>
      <div class="grid g3" style="margin-top:12px">${field('КПП', 'clientKpp', { ph: '9 цифр' })}${field('ОГРН', 'clientOgrn', { ph: '13 цифр' })}${field('Руководитель', 'clientDir', { ph: 'ФИО' })}</div>
      <div class="grid" style="margin-top:12px">${field('Юридический адрес', 'clientAddr', { ph: 'Индекс, город, улица, дом' })}</div></div>`;
  }

  static _contact(client) {
    const contacts = (client?.contacts || []).filter(
      contact => contact.name && Str.norm(contact.name) !== Str.norm(S.contact.name),
    );
    const chips = contacts
      .slice(0, this.CHIPS)
      .map(
        contact =>
          `<button class="chip sm" type="button" data-a="pickContact" data-k="${(client.contacts || []).indexOf(contact)}">${esc(contact.name)}${contact.post ? ` — ${esc(contact.post)}` : ''}</button>`,
      )
      .join('');
    return `<div class="csec"><p class="sub">Контактное лицо <span class="muted">необязательно</span></p>
   ${contacts.length ? `<div class="chips" style="margin-bottom:8px"><span class="muted" style="font-size:13px">Ранее:</span>${chips}</div>` : ''}
   <div class="grid g2">${UiKit.field('ФИО', 'contact.name', { ph: 'Иванов Иван Иванович' })}${UiKit.field('Должность', 'contact.post', { ph: 'Главный энергетик' })}</div>
   <details class="more-lite"${S.contact.phone || S.contact.email ? ' open' : ''}><summary>Телефон и e-mail</summary><div class="grid g2" style="margin-top:8px">${UiKit.field('Телефон', 'contact.phone', { type: 'tel', ph: '+7 (900) 123-45-67' })}${UiKit.field('E-mail', 'contact.email')}</div></details></div>`;
  }

  static _object(client) {
    const same = place =>
      Str.norm(place.purpose) === Str.norm(S.object.purpose) && Str.norm(place.address) === Str.norm(S.object.address);
    const objects = (client?.objects || []).filter(place => (place.purpose || place.address) && !same(place));
    const chips = objects
      .slice(0, this.CHIPS)
      .map(
        place =>
          `<button class="chip sm" type="button" data-a="pickObject" data-k="${(client.objects || []).indexOf(place)}">${esc(
            [place.purpose, place.address].filter(Boolean).join(' — ').slice(0, this.OBJECT_TEXT),
          )}</button>`,
      )
      .join('');
    return `<div class="csec"><p class="sub">Объект <span class="muted">необязательно</span></p>
   ${objects.length ? `<div class="chips" style="margin-bottom:8px"><span class="muted" style="font-size:13px">Ранее у клиента:</span>${chips}</div>` : ''}
   <div class="grid g2">${UiKit.field('Назначение', 'object.purpose', { ph: 'Например: резервное электроснабжение котельной', list: 'purposeList' })}${UiKit.field('Адрес объекта', 'object.address', { ph: 'Город, улица, дом' })}</div>
   <datalist id="purposeList">${ClientFields.PURPOSES.map(purpose => `<option value="${esc(purpose)}">`).join('')}</datalist></div>`;
  }
}
