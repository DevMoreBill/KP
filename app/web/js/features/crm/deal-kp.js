import { DealCard } from './deal-card.js';

/** КП сделки: открыть, новое КП для сделки (клиент из сделки, КП сохранится в неё), КП клиента из журнала — в сделку. */
export class DealKp {
  static HISTORY_LIMIT = 40;

  static _closeAll() {
    DealCard.close();
    document.getElementById('cabWin')?.close();
  }

  /**
   * Открыть КП (окна кабинета закрываются).
   * @param {string} id
   */
  static openKp(id) {
    this._closeAll();
    KpLoader.byId(id).catch(error => toast(`Не открылось: ${error.message}`));
  }

  static async _clearCurrent() {
    if (!Drafts.meaningful(S)) return true;
    if (Drafts.on()) return Drafts.stash();
    const text = S.kpId
      ? `Начать новое КП? Сохранённое КП № ${S.number} останется в журнале.`
      : 'Начать новое КП? Текущий черновик будет очищен.';
    return confirm(text);
  }

  /**
   * Новое КП для сделки.
   * @param {object} deal
   */
  static async newKp(deal) {
    if (!(await this._clearCurrent())) return;
    this._closeAll();
    NewKp.fresh();
    S.dealId = deal.id;
    const key = deal.clientId || (deal.clientInn ? `inn${deal.clientInn}` : '');
    const client = key ? await clientById(key).catch(() => null) : null;
    if (client) applyClient(client);
    else {
      S.client = deal.client || '';
      S.clientInn = deal.clientInn || '';
      renderForm();
      persist();
    }
    toast(`Новое КП для сделки «${deal.title || deal.client}»`);
    if (catCache.length) openCatalog({});
  }

  /**
   * КП клиента — в эту сделку (из другой сделки оно уходит).
   * @param {object} deal
   * @param {Function} after
   */
  static async link(deal, after) {
    const query = deal.clientInn || deal.client;
    if (!query) {
      toast('У сделки не указан клиент');
      return;
    }
    let list = [];
    try {
      const found = await api(`/api/history?limit=${this.HISTORY_LIMIT}&offset=0&q=${encodeURIComponent(query)}`);
      list = (found.items || []).filter(item => !(deal.kps || []).some(offer => offer.id === item.id));
    } catch (error) {
      toast(`Журнал недоступен: ${error.message}`);
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
    return `<div class="md-r"><span class="md-n">№ ${esc(item.number)}</span><div><b>${esc(KpDate.ddmm(item.date))} · ${esc(item.client || '')}</b><span class="muted">${esc((item.items || [])[0] || '')} · ${esc(jShort(item.manager || ''))}</span></div><button class="btn sm" type="button" data-kl="${esc(item.id)}">В сделку</button></div>`;
  }

  static async _linkClick(event, { modal, deal, after }) {
    if (event.target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = event.target.closest('[data-kl]');
    if (!button) return;
    try {
      await api(`/api/crm/deal/${deal.id}/kp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ kp: button.dataset.kl }),
      });
    } catch (error) {
      toast(`Не добавлено: ${error.message}`);
      return;
    }
    button.closest('.md-r').remove();
    toast('КП в сделке');
    after();
  }
}
