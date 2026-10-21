import { ClientStore, Inn, PartyFind } from './client-store.js';
import { S } from '../../core/state.js';
import { $, esc } from '../../core/util.js';
import { Str } from '../../core/str.js';
import { Debounce } from '../../core/debounce.js';

/** «Найден по контакту»: кто и чем совпал (телефон, e-mail, ФИО) — сервер отмечает в ответе поиска клиентов. */
export class ClientMatchText {
  /**
   * Пояснение совпадения.
   * @param {object} client
   * @returns {string}
   */
  static of(client) {
    const match = client.match || {};
    const contact = match.contact || {};
    return `по ${match.by || 'контакту'}: ${[contact.name, contact.phone, contact.email].filter(Boolean).join(', ')}`;
  }
}

/** Поиск клиента в разделе «Клиент»: подсказки из справочника, ИНН — в реестре. */
export class ClientFind {
  static seq = 0;
  static TYPE_DELAY = 160;
  static timer = new Debounce(ClientFind.TYPE_DELAY);
  static ADDRESS = 70;
  static INN_DELAY = 50;

  static _innOk(inn) {
    return (inn.length === Inn.ORG || inn.length === Inn.PERSON) && Inn.valid(inn);
  }

  /**
   * Подсказки под строкой поиска.
   * @param {HTMLInputElement} input
   */
  static async run(input) {
    const raw = input.value.trim();
    const query = Str.norm(raw);
    const list = $('#clList');
    const seq = ++this.seq;
    const found = query ? await ClientStore.find(raw) : [];
    if (seq !== this.seq || !list) return; // пока ждали ответ, ввели ещё буквы
    const field = $('#clFind');
    if (!field || field.value.trim() !== raw) return;
    const html = this._html(raw, query, found);
    list.hidden = !html;
    list.innerHTML = html;
  }

  static _html(raw, query, found) {
    const inn = raw.replace(/\D/g, '');
    const innOk = this._innOk(inn) && /^\d[\d\s]*$/.test(raw);
    const known = found.some(client => Inn.digits(client.inn) === inn);
    let html = found.map(client => this._row(client)).join('');
    if (found.length > 1 && found.every(client => client.match)) {
      html = `<p class="muted cl-many">Этот контакт есть у нескольких компаний — выберите нужную:</p>${html}`;
    }
    if (innOk && !known) {
      return `${html}<button type="button" data-inn="${inn}"><b>Найти ИНН ${inn} в реестре</b><span>реквизиты подставятся автоматически</span></button>`;
    }
    if (/^\d+$/.test(inn) && inn.length >= Inn.ORG && !innOk) {
      return `${html}<p class="muted" style="margin:10px 14px">ИНН с ошибкой: нужно 10 цифр (организация) или 12 (ИП)</p>`;
    }
    if (query && !found.length) {
      return `${html}<p class="muted" style="margin:10px 14px">Среди сохранённых не найдено. Введите ИНН — найдём в реестре.</p>`;
    }
    return html;
  }

  static _row(client) {
    const match = client.match ? `<i class="cl-m">${esc(ClientMatchText.of(client))}</i> · ` : '';
    return `<button type="button" data-clid="${esc(client.id)}"><b>${esc(client.name)}</b><span>${match}${client.inn ? `ИНН ${esc(client.inn)} · ` : ''}${esc((client.address || '').slice(0, this.ADDRESS))}${client.kpCount ? ` · КП: ${client.kpCount}` : ''}</span></button>`;
  }

  // ИНН вписан вручную: подсветка ошибки, верный — сразу в реестр
  static _inn(target) {
    const inn = target.value.replace(/\D/g, '');
    target.classList.toggle('bad', !!inn && !Inn.valid(inn) && inn.length >= Inn.ORG);
    if (this._innOk(inn) && inn !== S._lastInn) {
      S._lastInn = inn;
      setTimeout(() => PartyFind.run(), this.INN_DELAY);
    }
  }

  /** Ввод ИНН, строка поиска, выбор подсказки. */
  static listen() {
    document.addEventListener('input', event => {
      if (event.target.dataset && event.target.dataset.p === 'clientInn') this._inn(event.target);
    });
    document.addEventListener('input', event => {
      if (event.target.id !== 'clFind') return;
      const input = event.target;
      this.timer.run(() => this.run(input));
    });
    document.addEventListener('keydown', event => {
      if (event.target.id !== 'clFind' || event.key !== 'Enter') return;
      const first = $('#clList [data-clid], #clList [data-inn]');
      if (first) {
        event.preventDefault();
        first.click();
      }
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-inn]');
      if (!button) return;
      S.clientInn = button.dataset.inn;
      S._lastInn = button.dataset.inn;
      PartyFind.run();
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-clid]');
      if (!button) return;
      const client = ClientStore.list.find(row => row.id === button.dataset.clid);
      if (client) ClientStore.apply(client);
    });
  }
}
