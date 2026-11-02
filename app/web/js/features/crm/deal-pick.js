import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { Str } from '../../core/str.js';
import { S } from '../../core/state.js';
import { MyDay } from '../kp/my-day.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { DealLockNote } from '../../core/deal-lock-note.js';
import { Tender } from '../../core/tender.js';
/**
 * Раздел «Клиент» КП: в какую сделку попадёт КП (показывается, когда у клиента есть незакрытые сделки или КП уже в
 * сделке). Правило «одна сделка на клиента» (guard.lock с сервера) убирает «Новая сделка» и «Отдельная новая сделка».
 */
export class DealPick {
  static state = { key: '', items: [], current: '', stages: [], guard: null, busy: false };

  /**
   * Выбор сделки или пусто.
   * @returns {string}
   */
  static html() {
    if (!MyDay.enabled() || !(S.client || S.clientInn)) return '';
    const key = [String(S.clientInn || '').replace(/\D/g, ''), Str.norm(S.client), S.kpId || '', Tender.number()].join(
      '|',
    );
    const state = this.state;
    if (state.key !== key) {
      if (!state.busy) this._load(key);
      return '';
    }
    if (!state.items.length) return '';
    const lock = this._lock();
    const picked = this._picked(lock);
    return `<div class="csec deal-pick"><p class="sub">Сделка${UiKit.tip('<p>Все КП по одной задаче клиента (объект, закупка) собираются в одну сделку — в «Кабинете» видно сумму, стадию и дела по ней.</p><p>Выберите сделку, к которой относится это КП, или оставьте новую.</p>')}</p>
      <div class="row dp-r"><select data-p="dealId" aria-label="Сделка для этого КП">${this._options(picked, lock)}</select>${this._open(picked)}</div>${this._note(lock)}</div>`;
  }

  /**
   * Забыть загруженное: следующая отрисовка спросит сервер заново (КП перенесли в другую сделку).
   */
  static forget() {
    this.state.key = '';
  }

  // новую сделку завести нельзя — сделка клиента, в которую встанет КП
  static _lock() {
    const guard = this.state.guard;
    return guard && guard.lock ? guard.lock : null;
  }

  // КП перенесли в другую сделку, пока оно было открыто: виден сервер (сохранение прежнюю сделку не вернёт)
  static _picked(lock) {
    const current = this.state.current;
    const moved = current && S._dealSeen && S.dealId === S._dealSeen && current !== S._dealSeen;
    return (moved ? current : S.dealId) || current || (lock ? lock.deal : '');
  }

  static _options(picked, lock) {
    const current = this.state.current;
    const first = current || lock ? '' : `<option value=""${picked ? '' : ' selected'}>Новая сделка</option>`;
    const last =
      current && !lock
        ? `<option value="new"${picked === 'new' ? ' selected' : ''}>Отдельная новая сделка</option>`
        : '';
    return first + this.state.items.map(item => this._option(item, picked)).join('') + last;
  }

  static _note(lock) {
    if (lock) {
      const into = this.state.current === lock.deal ? 'КП в сделке' : 'КП встанет в сделку';
      return `<p class="muted dp-note">${into} ${DealLockNote.deal(lock)}: ${esc(DealLockNote.why(lock))}. Отдельную сделку разрешает администратор («Настройки» → карточка клиента).</p>`;
    }
    const guard = this.state.guard;
    return guard && guard.mode === 'once'
      ? '<p class="muted dp-note">Администратор разрешил одну новую сделку по этому клиенту.</p>'
      : '';
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
      const query = `inn=${encodeURIComponent(inn)}&name=${encodeURIComponent(S.client || '')}&kp=${encodeURIComponent(offer)}`;
      const own = `client=${encodeURIComponent(S.clientId || '')}&tender=${encodeURIComponent(Tender.number())}`;
      const found = await Api.request(`/api/crm/pick?${query}&${own}`);
      Object.assign(state, {
        items: found.items || [],
        current: found.current || '',
        stages: found.stages || [],
        guard: found.guard || null,
      });
    } catch {
      Object.assign(state, { items: [], current: '', guard: null });
    }
    state.key = key;
    state.busy = false;
    if (KpForm.step() === 'client' && state.items.length) KpForm.render();
  }
}
