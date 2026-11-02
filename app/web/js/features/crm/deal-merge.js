import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { Debounce } from '../../core/debounce.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { CabState } from './cab-state.js';

/**
 * «Объединить сделки» (карточка сделки, «Отдел» → «Дубли сделок»): в открытую сделку переходят КП, дела, документы,
 * звонки и комментарии отмеченных сделок; отмеченные уходят в корзину пустыми.
 */
export class DealMerge {
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static SEARCH_WAIT = 300;
  static SEARCH_MIN = 2;
  static FOUND_MAX = 8;
  static ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v4a5 5 0 0 0 5 5h7"/><path d="M6 20v-4a5 5 0 0 1 5-5"/><path d="M15 10l3 3-3 3"/></svg>';

  /**
   * Объединение доступно: функция и кабинет включены.
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('dealMerge') && FEAT.on('myDay');
  }

  /**
   * Кнопка в шапке карточки сделки (в проигранную объединять нельзя — её нет).
   * @param {{stage?: string}} deal
   * @returns {string}
   */
  static button(deal) {
    if (!this.enabled() || deal.stage === 'lost') return '';
    return `<button class="dk-ib dk-mrg" type="button" data-dkmerge aria-label="Объединить сделки" title="Объединить с другими сделками клиента">${this.ICON}</button>`;
  }

  /**
   * Окно объединения в сделку deal.
   * @param {{id: string, number: *, title?: string, client?: string, clientInn?: string, managerId?: string}} deal итоговая
   * @param {(result: object) => void} [done] после объединения
   * @param {string[]} [marked] сразу отмеченные сделки («Дубли сделок»)
   */
  static async open(deal, done, marked = []) {
    let pick;
    try {
      pick = await this._pick(deal);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    const view = { deal, ...pick, found: [], marked: new Set(marked) };
    const modal = new Modal(this._html(view), 'dm-dlg');
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

  /**
   * Окно объединения группы дублей («Отдел», «Сегодня»): в предложенную сделку, остальные сделки группы отмечены.
   * @param {{target: string, client: string, inn: string, managerId: string, deals: object[]}} group
   * @param {(result: object) => void} [done] после объединения
   */
  static group(group, done) {
    const head = group.deals.find(deal => deal.id === group.target) || group.deals[0];
    const deal = { ...head, client: group.client, clientInn: group.inn, managerId: group.managerId };
    const others = group.deals.filter(row => row.id !== head.id).map(row => row.id);
    this.open(deal, done, others);
  }

  // незакрытые сделки клиента: менеджеру — свои, руководителю и администратору — всех
  static async _pick(deal) {
    const query = [`inn=${encodeURIComponent(deal.clientInn || '')}`, `name=${encodeURIComponent(deal.client || '')}`];
    const pick = await Api.request(`/api/crm/pick?${query.join('&')}`);
    return {
      items: (pick.items || []).filter(item => item.id !== deal.id),
      stages: pick.stages || [],
      bitrix: !!pick.bitrix,
    };
  }

  static _html(view) {
    const deal = view.deal;
    const rows =
      view.items.map(item => this._row(item, view)).join('') ||
      '<p class="muted dm-none">Других незакрытых сделок этого клиента нет — найдите сделку ниже.</p>';
    return `<div class="dlg-h"><h3>Объединить сделки</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="dm-now">В сделку <b>№ ${esc(deal.number)}${deal.title ? ` «${esc(deal.title)}»` : ''}</b> перейдут КП, дела, документы, звонки и комментарии отмеченных сделок.</p>
      <form><p class="sub">Другие незакрытые сделки клиента</p><div class="dm-l" role="group" aria-label="Сделки клиента">${rows}</div>
        <label class="f dm-q"><span>Другая сделка — номер, название или клиент</span><input type="search" name="q" placeholder="Например, 214 или Компрессор" autocomplete="off"></label>
        <div class="dm-l dm-found" role="group" aria-label="Найденные сделки"></div>
        <p class="muted">Отмеченные сделки уйдут в корзину пустыми — отменить объединение нельзя. Сумма и стадия этой сделки пересчитаются по всем КП.${this._bitrix(view)}</p>
        <div class="row"><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Объединить</button></div></form>`;
  }

  // связь с Битрикс24: сделки отмеченных там закроются проигранными (или остаются — функция выключена)
  static _bitrix(view) {
    if (!view.bitrix) return '';
    return FEAT.on('dealMergeBx')
      ? ` В Битрикс24 лишние сделки закроются проигранными: «Объединена со сделкой № ${esc(view.deal.number)}».`
      : ' В Битрикс24 сделки не удаляются.';
  }

  static _row(item, view) {
    const checked = view.marked.has(item.id) ? ' checked' : '';
    return `<label class="dm-r"><input type="checkbox" name="deal" value="${esc(item.id)}"${checked}><span><b>№ ${esc(item.number)} · ${esc(item.title || item.client || '')}</b><span class="muted">${this._tail(item, view)}</span></span></label>`;
  }

  // стадия, сумма, клиент (если не в названии) и менеджер (если не тот, что у итоговой)
  static _tail(item, view) {
    const stage = (view.stages.find(row => row.key === item.stage) || {}).label || item.stage || '';
    const parts = [esc(stage)];
    if (item.sum) parts.push(CrmFmt.rub(item.sum));
    if (item.client && item.client !== item.title) parts.push(esc(item.client));
    const other = item.managerId && view.deal.managerId && item.managerId !== view.deal.managerId;
    if (other) parts.push(esc(item.manager || ''));
    return parts.filter(Boolean).join(' · ');
  }

  static async _find(modal, view, text) {
    const box = modal.$('.dm-found');
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
    const listed = new Set([view.deal.id, ...view.items.map(item => item.id)]);
    view.found = found.filter(item => !listed.has(item.id)).slice(0, this.FOUND_MAX);
    box.innerHTML =
      view.found.map(item => this._row(item, view)).join('') || '<p class="muted dm-none">Сделок не найдено.</p>';
  }

  static async _send(modal, view, done) {
    const form = modal.$('form');
    const ids = [...form.querySelectorAll('input[name="deal"]:checked')].map(box => box.value);
    if (!ids.length) {
      Toast.show('Отметьте сделки, которые объединить с этой');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    let result;
    try {
      result = await Api.request(`/api/crm/deal/${encodeURIComponent(view.deal.id)}/merge`, {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify({ deals: ids }),
      });
    } catch (error) {
      button.disabled = false;
      Toast.show(`Не объединено: ${error.message || error}`);
      return;
    }
    modal.close();
    Toast.show(this.said(result));
    if (document.getElementById('cabWin')?.open) CabState.reload();
    if (done) done(result);
  }

  /**
   * Итог объединения одной строкой: «Сделка № 12 объединена со сделкой № 15 (КП: 2, дела: 3)».
   * @param {{number: *, merged: Array<*>, kps: number, tasks: number, files: number}} result ответ сервера
   * @returns {string}
   */
  static said(result) {
    const numbers = result.merged.map(number => `№ ${number}`).join(', ');
    const head = result.merged.length === 1 ? `Сделка ${numbers} объединена` : `Сделки ${numbers} объединены`;
    return `${head} со сделкой № ${result.number}${this.counts(result)}`;
  }

  /**
   * Что перешло, без нулей: « (КП: 2, дела: 3)»; ничего — пусто.
   * @param {{kps?: number, tasks?: number, files?: number}} moved
   * @returns {string}
   */
  static counts(moved) {
    const parts = [
      ['kps', 'КП'],
      ['tasks', 'дела'],
      ['files', 'документы'],
    ]
      .filter(([key]) => moved[key])
      .map(([key, label]) => `${label}: ${moved[key]}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }
}
