import { FormView } from '../../ui/form-view.js';
import { Steps } from '../../ui/steps.js';
import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../ui/ui-kit.js';
import { Str } from '../../core/str.js';
import { S } from '../../core/state.js';
import { MyDay } from '../kp/my-day.js';
/** Раздел «Клиент» КП: в какую сделку попадёт КП (показывается, когда у клиента есть незакрытые сделки или КП уже в сделке). */
export class DealPick {
  static state = { key: '', items: [], current: '', stages: [], busy: false };

  /**
   * Выбор сделки или пусто.
   * @returns {string}
   */
  static html() {
    if (!MyDay.enabled() || !(S.client || S.clientInn)) return '';
    const key = [String(S.clientInn || '').replace(/\D/g, ''), Str.norm(S.client), S.kpId || ''].join('|');
    const state = this.state;
    if (state.key !== key) {
      if (!state.busy) this._load(key);
      return '';
    }
    if (!state.items.length) return '';
    const picked = S.dealId || state.current || '';
    return `<div class="csec deal-pick"><p class="sub">Сделка${UiKit.tip('<p>Все КП по одной задаче клиента (объект, закупка) собираются в одну сделку — в «Кабинете» видно сумму, стадию и дела по ней.</p><p>Выберите сделку, к которой относится это КП, или оставьте новую.</p>')}</p>
      <div class="row dp-r"><select data-p="dealId" aria-label="Сделка для этого КП">${this._options(picked)}</select>${this._open(picked)}</div></div>`;
  }

  static _options(picked) {
    const current = this.state.current;
    const first = current ? '' : `<option value=""${picked ? '' : ' selected'}>Новая сделка</option>`;
    const last = current
      ? `<option value="new"${picked === 'new' ? ' selected' : ''}>Отдельная новая сделка</option>`
      : '';
    return first + this.state.items.map(item => this._option(item, picked)).join('') + last;
  }

  static _open(picked) {
    if (!picked || picked === 'new') return '';
    return `<button class="btn ghost" type="button" data-a="dealOpen" data-id="${esc(picked)}">Открыть сделку</button>`;
  }

  static _option(item, picked) {
    const stage = (this.state.stages || []).find(row => row.key === item.stage)?.label || item.stage;
    const now = item.id === this.state.current ? ' (сейчас)' : '';
    return `<option value="${esc(item.id)}"${item.id === picked ? ' selected' : ''}>№ ${esc(item.number)} · ${esc(item.title || item.client)} — ${esc(stage)}${now}</option>`;
  }

  static async _load(key) {
    const state = this.state;
    state.busy = true;
    const [inn, , offer] = key.split('|');
    try {
      const found = await Api.request(
        `/api/crm/pick?inn=${encodeURIComponent(inn)}&name=${encodeURIComponent(S.client || '')}&kp=${encodeURIComponent(offer)}`,
      );
      Object.assign(state, { items: found.items || [], current: found.current || '', stages: found.stages || [] });
    } catch {
      Object.assign(state, { items: [], current: '' });
    }
    state.key = key;
    state.busy = false;
    if (Steps.current === 'client' && state.items.length) FormView.render();
  }
}
