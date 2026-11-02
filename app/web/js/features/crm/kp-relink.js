import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { Debounce } from '../../core/debounce.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { S } from '../../core/state.js';
import { CabState } from './cab-state.js';
import { DealPick } from './deal-pick.js';

/**
 * «Перенести в другую сделку» (журнал КП → «⋯», карточка сделки → «⇄» у КП): КП уходит в незакрытую сделку клиента или
 * найденную поиском (номер, название, клиент); прежняя сделка без КП — в корзину галочкой, если удаление сделок включено.
 */
export class KpRelink {
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static SEARCH_WAIT = 300;
  static SEARCH_MIN = 2;
  static FOUND_MAX = 8;

  /**
   * Перенос доступен: функция и кабинет включены.
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('kpRelink') && FEAT.on('myDay');
  }

  /**
   * Открыть окно переноса.
   * @param {string} kpId
   * @param {(result: {deal: string, from: string, dropped: boolean}) => void} [done] после переноса
   */
  static async open(kpId, done) {
    let view;
    try {
      view = await this._view(kpId);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    const modal = new Modal(this._html(view), 'kr-dlg');
    const search = new Debounce(this.SEARCH_WAIT);
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    modal
      .$('[name="q"]')
      .addEventListener('input', event => search.run(() => this._find(modal, view, event.target.value)));
    modal.$('form').onsubmit = event => {
      event.preventDefault();
      this._send(modal, view, done);
    };
  }

  // КП и незакрытые сделки его клиента (своему менеджеру — свои, руководителю — всех)
  static async _view(kpId) {
    const meta = await Api.request(`/api/kp/${encodeURIComponent(kpId)}/meta`);
    const query = [
      `inn=${encodeURIComponent(meta.clientInn || '')}`,
      `name=${encodeURIComponent(meta.client || '')}`,
      `kp=${encodeURIComponent(kpId)}`,
    ].join('&');
    const pick = await Api.request(`/api/crm/pick?${query}`);
    return {
      kpId,
      meta,
      current: pick.current || '',
      left: +pick.currentKps || 0,
      items: pick.items || [],
      found: [],
      stages: pick.stages || [],
    };
  }

  static _html(view) {
    const current = view.items.find(item => item.id === view.current);
    const now = current ? `сейчас в сделке № ${esc(current.number)}` : 'сейчас без сделки';
    const others = view.items.filter(item => item.id !== view.current);
    const rows =
      others.map(item => this._row(item, view)).join('') ||
      '<p class="muted kr-none">Других незакрытых сделок этого клиента нет — найдите сделку ниже.</p>';
    return `<div class="dlg-h"><h3>КП № ${esc(view.meta.number || view.kpId)} — в другую сделку</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted kr-now">${esc(view.meta.client || '')} · ${now}</p>
      <form><p class="sub">Сделки клиента</p><div class="kr-l" role="radiogroup" aria-label="Незакрытые сделки клиента">${rows}</div>
        <label class="f kr-q"><span>Другая сделка — номер, название или клиент</span><input type="search" name="q" placeholder="Например, 214 или Компрессор" autocomplete="off"></label>
        <div class="kr-l kr-found" role="radiogroup" aria-label="Найденные сделки"></div>
        ${this._drop(view, current)}
        <p class="muted">Суммы и стадии обеих сделок пересчитаются сами (и в Битрикс24).</p>
        <div class="row"><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Перенести</button></div></form>`;
  }

  static _row(item, view) {
    const stage = (view.stages.find(row => row.key === item.stage) || {}).label || item.stage || '';
    const client = item.client && item.client !== item.title ? ` · ${esc(item.client)}` : '';
    const sum = item.sum ? ` · ${CrmFmt.rub(item.sum)}` : '';
    return `<label class="kr-r"><input type="radio" name="deal" value="${esc(item.id)}"><span><b>№ ${esc(item.number)} · ${esc(item.title || item.client || '')}</b><span class="muted">${esc(stage)}${sum}${client}</span></span></label>`;
  }

  // прежняя сделка останется без КП — удалить её (как «Удалить сделку» в карточке: своя или руководителю)
  static _drop(view, current) {
    if (!current || view.left !== 1 || !FEAT.on('dealDelete')) return '';
    return `<label class="kr-drop"><input type="checkbox" name="drop"><span>Сделка № ${esc(current.number)} останется без КП — удалить её (в корзину)</span></label>`;
  }

  static async _find(modal, view, text) {
    const box = modal.$('.kr-found');
    const words = String(text || '').trim();
    if (words.length < this.SEARCH_MIN) {
      box.innerHTML = '';
      return;
    }
    let found = [];
    try {
      found = (await Api.request(`/api/crm/find?q=${encodeURIComponent(words)}`)).items || [];
    } catch (error) {
      box.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    const listed = new Set(view.items.map(item => item.id));
    const rows = found.filter(item => !listed.has(item.id)).slice(0, this.FOUND_MAX);
    view.found = rows;
    box.innerHTML =
      rows.map(item => this._row(item, view)).join('') || '<p class="muted kr-none">Сделок не найдено.</p>';
  }

  static async _send(modal, view, done) {
    const form = modal.$('form');
    const picked = form.querySelector('input[name="deal"]:checked');
    if (!picked) {
      Toast.show('Выберите сделку');
      return;
    }
    const reply = await this._move(view.kpId, picked.value);
    if (!reply) return;
    modal.close();
    const from = reply.from || '';
    const drop = form.elements.drop;
    const dropped = Boolean(from && drop && drop.checked && (await this._dropDeal(from)));
    this._settle(view.kpId);
    this._report(view, picked.value, dropped);
    if (done) done({ deal: picked.value, from, dropped });
  }

  // КП — в сделку (прежняя сделка — в ответе from); не вышло — сообщение и null
  static async _move(kpId, did) {
    try {
      return await Api.request(`/api/crm/deal/${encodeURIComponent(did)}/kp`, {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify({ kp: kpId }),
      });
    } catch (error) {
      Toast.show(`Не перенесено: ${error.message || error}`);
      return null;
    }
  }

  static _report(view, did, dropped) {
    const target = [...view.items, ...view.found].find(item => item.id === did) || {};
    const tail = dropped ? '; прежняя сделка — в корзине' : '';
    Toast.show(`КП № ${view.meta.number || view.kpId} — в сделке № ${target.number || did}${tail}`);
  }

  static async _dropDeal(did) {
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(did)}/remove`, { method: 'POST' });
      return true;
    } catch (error) {
      Toast.show(`Прежняя сделка не удалена: ${error.message || error}`);
      return false;
    }
  }

  // открытое КП: прежняя сделка в нём — не выбор менеджера (сервер не вернёт КП обратно), выбор сделки — заново
  static _settle(kpId) {
    if (S.kpId === kpId && S.dealId && !S._dealSeen) S._dealSeen = S.dealId;
    DealPick.forget();
    if (document.getElementById('cabWin')?.open) CabState.reload();
  }
}
