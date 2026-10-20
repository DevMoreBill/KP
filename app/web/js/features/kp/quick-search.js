import { ClientCard } from './client-card.js';
import { ClientMatchText } from './client-find.js';
import { ClientStore } from './client-store.js';
import { Currency } from './currency.js';
import { KpRepeat } from './kp-repeat.js';
import { MyDay } from './my-day.js';
import { KpLoader } from './reminders.js';

/** Модели, недавно добавленные в КП (этот браузер) — для «Недавнего» в едином поиске. */
export class RecentModels {
  static KEY = 'kp.recentModels';
  static MAX = 6;

  /**
   * Недавние модели.
   * @returns {{id: string, name: string}[]}
   */
  static list() {
    try {
      const value = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  /**
   * Модель добавлена в КП — первой в списке (без повторов).
   * @param {object} item позиция каталога
   */
  static add(item) {
    if (!item || !item.id) return;
    const list = [{ id: item.id, name: item.name || '' }, ...this.list().filter(model => model.id !== item.id)].slice(
      0,
      this.MAX,
    );
    try {
      localStorage.setItem(this.KEY, JSON.stringify(list));
    } catch {
      // приватный режим — без «недавних моделей»
    }
  }
}

/**
 * Единый поиск (Ctrl+K, «Найти» в шапке, меню телефона): КП, клиенты, сделки и каталог одной строкой, стрелки и Enter.
 * Пустая строка — «Недавнее»: последние КП и их клиенты, модели, недавно добавленные в КП.
 */
export class QuickSearch {
  /** ответ на устаревший запрос (набирают дальше) не показывается */
  static seq = 0;
  static timer = null;
  static modal = null;
  static TYPE_DELAY = 180;
  static FOCUS_DELAY = 30;
  static RECENT_KP = 12;
  static SHOWN = 5;
  static FOUND = 6;
  static KEYS = ['k', 'K', 'л', 'Л'];
  static STEP = { ArrowDown: 1, ArrowUp: -1 };

  /** Окно поиска. */
  static open() {
    return Modal.once('quick-search', () => this._open());
  }

  static _open() {
    const modal = (this.modal = new Modal(
      `<div class="dlg-h"><h3>Найти</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <input type="search" id="qsQ" class="qs-q" placeholder="КП, клиент, ИНН, телефон, e-mail, сделка, модель" autocomplete="off" aria-label="Что найти">
      <div class="qs-r" id="qsR" aria-live="polite"></div><p class="muted qs-k">↑ ↓ — выбрать, Enter — открыть, Esc — закрыть · Ctrl+K — этот поиск откуда угодно</p>`,
      'qs-dlg',
    ));
    const input = modal.$('#qsQ');
    input.addEventListener('input', () => {
      this.timer = this.timer || new Debounce(this.TYPE_DELAY);
      this.timer.run(() => this.run(input.value));
    });
    input.addEventListener('keydown', event => this._keys(event));
    modal.d.addEventListener('keydown', event => {
      if (event.target !== input) this._keys(event);
    });
    modal.d.addEventListener('click', event => this._click(event.target));
    setTimeout(() => input.focus(), this.FOCUS_DELAY);
    this.run('');
  }

  static _sect(title, rows) {
    return rows.length ? `<p class="qs-h">${esc(title)}</p>${rows.join('')}` : '';
  }

  static _row(attrs, main, sub, extra = '') {
    return `<div class="qs-i"><button type="button" class="qs-b" ${attrs}><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}</button>${extra}</div>`;
  }

  static _kpRow(row) {
    return this._row(
      `data-qkp="${esc(row.id)}"`,
      `КП № ${esc(row.number)} · ${esc(row.client || 'без получателя')}`,
      `${esc(KPGen.ruDate(row.date))}${row.items && row.items[0] ? ` · ${esc(row.items[0])}` : ''}`,
      `<button type="button" class="btn sm ghost" data-qrep="${esc(row.id)}" title="Новое КП тому же клиенту: дата — сегодня, цены — как сейчас в каталоге">Повторить</button>`,
    );
  }

  static _catRow(item) {
    return this._row(
      `data-qcat="${esc(item.id)}"`,
      esc(item.name),
      item.price ? `${money(item.price)} ${esc(Currency.short(item.priceCur || 'RUB'))}` : 'без цены',
      `<button type="button" class="btn sm ghost" data-qadd="${esc(item.id)}">В КП</button>`,
    );
  }

  static _clientRow(client, sub) {
    const data = JSON.stringify({ id: client.id || '', inn: client.inn || '', name: client.name || '' });
    return this._row(`data-qcl="${esc(data)}"`, esc(client.name), sub);
  }

  /**
   * Найти и показать.
   * @param {string} text
   */
  static async run(text) {
    const seq = ++this.seq;
    const query = String(text || '').trim();
    const box = this.modal && this.modal.$('#qsR');
    if (!box) return;
    const html = query ? await this._found(query) : await this._recent();
    if (seq === this.seq) box.innerHTML = html;
  }

  // «Недавнее»
  static async _recent() {
    let journal = [];
    try {
      journal = (await api(`/api/history?limit=${this.RECENT_KP}&offset=0&q=`)).items || [];
    } catch {
      // нет связи — только модели
    }
    const seen = new Set();
    const clients = journal
      .filter(row => row.client && !seen.has(row.client) && seen.add(row.client))
      .slice(0, this.SHOWN);
    const models = RecentModels.list()
      .map(model => CatFind.id(model.id))
      .filter(Boolean);
    const people = ClientCard.enabled()
      ? this._sect(
          'Недавние клиенты',
          clients.map(row =>
            this._clientRow({ inn: row.clientInn, name: row.client }, row.clientInn ? `ИНН ${esc(row.clientInn)}` : ''),
          ),
        )
      : '';
    return (
      this._sect(
        'Последние КП',
        journal.slice(0, this.SHOWN).map(row => this._kpRow(row)),
      ) +
        people +
        this._sect(
          'Недавно добавленные модели',
          models.map(item => this._catRow(item)),
        ) || '<p class="empty">Начните вводить — найдутся КП, клиенты, сделки и оборудование.</p>'
    );
  }

  static async _found(query) {
    const [kps, clients, deals] = await Promise.all([
      api(`/api/history?limit=${this.FOUND}&offset=0&q=${encodeURIComponent(query)}`)
        .then(answer => answer.items || [])
        .catch(() => []),
      ClientCard.enabled() ? ClientStore.find(query, this.FOUND) : Promise.resolve([]),
      MyDay.enabled()
        ? api(`/api/crm/find?q=${encodeURIComponent(query)}`)
            .then(answer => answer.items || [])
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const catalog = quickMatches(query).slice(0, this.FOUND);
    const all = catalog.length
      ? `<div class="qs-i"><button type="button" class="qs-b qs-all" data-qall><b>Все модели по «${esc(query)}» — в каталоге</b></button></div>`
      : '';
    return (
      this._sect(
        'КП',
        kps.map(row => this._kpRow(row)),
      ) +
        this._sect(
          'Клиенты',
          clients.map(client =>
            this._clientRow(
              client,
              [client.match ? esc(ClientMatchText.of(client)) : '', client.inn ? `ИНН ${esc(client.inn)}` : '']
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        ) +
        this._sect(
          'Сделки',
          deals.map(deal =>
            this._row(
              `data-qdl="${esc(deal.id)}"`,
              `${esc(deal.title || deal.client)}`,
              `№ ${esc(deal.number)} · ${esc(deal.client || '')}${deal.sum ? ` · ${CrmFmt.rub(deal.sum)}` : ''}`,
            ),
          ),
        ) +
        this._sect(
          'Каталог',
          catalog.map(item => this._catRow(item)),
        ) +
        all || '<p class="empty">Ничего не найдено.</p>'
    );
  }

  static _keys(event) {
    if (event.key !== 'Enter' && !this.STEP[event.key]) return;
    const list = [...this.modal.d.querySelectorAll('.qs-b')];
    if (!list.length) return;
    const index = list.indexOf(document.activeElement);
    if (event.key === 'Enter') {
      if (index < 0) {
        event.preventDefault();
        list[0].click();
      }
      return;
    }
    event.preventDefault();
    const step = this.STEP[event.key];
    const first = step > 0 ? 0 : list.length - 1;
    list[index < 0 ? first : Math.max(0, Math.min(list.length - 1, index + step))].focus();
  }

  static _ACTIONS = {
    qrep: id => KpRepeat.run(id),
    qkp: id => KpLoader.byId(id).catch(error => toast(`КП не открылось: ${error.message}`)),
    qcl: data => {
      try {
        ClientCard.open(JSON.parse(data));
      } catch {
        // повреждённая строка — ничего не открываем
      }
    },
    qdl: id => DealCard.open(id),
    qadd: id => {
      const item = CatFind.id(id);
      if (!item) return;
      goStep('equip');
      addFromCatalog(item);
    },
    qcat: (id, query) => {
      const item = CatFind.id(id);
      openCatalog({ q: item ? item.name : query });
    },
  };

  static _click(target) {
    const modal = this.modal;
    const query = modal.$('#qsQ').value.trim();
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = target.closest('[data-qkp],[data-qrep],[data-qcl],[data-qdl],[data-qcat],[data-qadd],[data-qall]');
    if (!button) return;
    modal.close();
    const key = Object.keys(this._ACTIONS).find(name => button.dataset[name]);
    if (key) this._ACTIONS[key](button.dataset[key], query);
    else if (button.hasAttribute('data-qall')) openCatalog({ q: query });
  }

  /** Ctrl+K (Cmd+K на Mac) — единый поиск откуда угодно. */
  static listen() {
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && this.KEYS.includes(event.key)) {
        event.preventDefault();
        this.open();
      }
    });
  }
}
