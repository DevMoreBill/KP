import { DealCard } from './deal-card.js';
import { ShortName } from '../kp/journal-row.js';
import { KpDate } from '../kp/kp-date.js';
import { esc } from '../../core/util.js';
import { Modal } from '../../core/modal.js';
import { AppTabs } from '../../core/app-tabs.js';
import { Api } from '../../core/net.js';
import { CatalogWindow } from '../catalog/catalog-window.js';
import { Catalog } from '../catalog/catalog-store.js';
import { CatalogFill } from '../catalog/catalog-fill.js';
import { ClientStore } from '../kp/client-store.js';
import { NewKp } from '../kp/new-kp.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { KpLoader } from '../kp/reminders.js';
import { KpTabs } from '../kp/kp-tabs.js';
import { KpForm } from '../../core/kp-form.js';

/** КП сделки: открыть, новое КП для сделки (клиент из сделки, КП сохранится в неё), КП клиента из журнала — в сделку. */
export class DealKp {
  static HISTORY_LIMIT = 40;

  // к КП — карточка сделки закрывается, кабинет остаётся своей вкладкой
  static _closeAll() {
    DealCard.close();
    AppTabs.open(AppTabs.HOME);
  }

  /**
   * Открыть КП (кабинет остаётся вкладкой).
   * @param {string} id
   */
  static openKp(id) {
    this._closeAll();
    KpLoader.byId(id).catch(error => Toast.show(`Не открылось: ${error.message}`));
  }

  static _clearCurrent() {
    return KpTabs.prepare();
  }

  /**
   * Новое КП для сделки.
   * @param {object} deal
   * @param {string[]} [ids] модели каталога — сразу позициями (заявка из письма)
   */
  static async newKp(deal, ids = []) {
    if (!(await this._clearCurrent())) return;
    this._closeAll();
    NewKp.fresh();
    S.dealId = deal.id;
    const opened = S;
    if (!(await this._client(deal, opened))) return;
    const added = await this._items(ids, opened);
    KpForm.render();
    KpState.persist();
    Toast.show(`Новое КП для сделки «${deal.title || deal.client}»${added ? ` — позиций из заявки: ${added}` : ''}`);
    if (!added && Catalog.cache.length) CatalogWindow.open({});
  }

  // клиент сделки — в КП (из справочника целиком); false — пока ждали, открыли другое КП
  static async _client(deal, opened) {
    const key = deal.clientId || (deal.clientInn ? `inn${deal.clientInn}` : '');
    const client = key ? await ClientStore.byId(key).catch(() => null) : null;
    if (S !== opened) return false;
    if (client) ClientStore.apply(client);
    else {
      S.client = deal.client || '';
      S.clientInn = deal.clientInn || '';
    }
    return true;
  }

  // модели каталога из заявки — позициями КП
  static async _items(ids, opened) {
    let added = 0;
    for (const id of ids) {
      const light = Catalog.cache.find(row => row.id === id) || { id, _light: true };
      const card = await Catalog.fullDoc(light);
      if (S !== opened || !card || !card.name) continue;
      const item = KpState.newItem();
      CatalogFill.fill(item, card);
      const blank = S.items.length === 1 && !S.items[0].name && !S.items[0].price;
      S.items = blank ? [item] : [...S.items, item];
      added++;
    }
    return added;
  }

  /**
   * КП клиента — в эту сделку (из другой сделки оно уходит).
   * @param {object} deal
   * @param {Function} after
   */
  static async link(deal, after) {
    const query = deal.clientInn || deal.client;
    if (!query) {
      Toast.show('У сделки не указан клиент');
      return;
    }
    let list = [];
    try {
      const found = await Api.request(
        `/api/history?limit=${this.HISTORY_LIMIT}&offset=0&q=${encodeURIComponent(query)}`,
      );
      list = (found.items || []).filter(item => !(deal.kps || []).some(offer => offer.id === item.id));
    } catch (error) {
      Toast.show(`Журнал недоступен: ${error.message}`);
      return;
    }
    const rows = list.map(item => this._row(item)).join('') || '<p class="empty">Других КП этого клиента нет.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>КП клиента в сделку</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted dk-lnote">КП из другой сделки перейдёт в эту.</p><div class="nk-l">${rows}</div>`,
      'dk-link-dlg',
    );
    modal.d.addEventListener('click', event => this._linkClick(event, { modal, deal, after }));
  }

  static _row(item) {
    return `<div class="md-r"><span class="md-n">№ ${esc(item.number)}</span><div><b>${esc(KpDate.ddmm(item.date))} · ${esc(item.client || '')}</b><span class="muted">${esc((item.items || [])[0] || '')} · ${esc(ShortName.of(item.manager || ''))}</span></div><button class="btn sm" type="button" data-kl="${esc(item.id)}">В сделку</button></div>`;
  }

  static async _linkClick(event, { modal, deal, after }) {
    if (event.target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = event.target.closest('[data-kl]');
    if (!button) return;
    try {
      await Api.request(`/api/crm/deal/${deal.id}/kp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ kp: button.dataset.kl }),
      });
    } catch (error) {
      Toast.show(`Не добавлено: ${error.message}`);
      return;
    }
    button.closest('.md-r').remove();
    Toast.show('КП в сделке');
    after();
  }
}
