import { Drafts } from './drafts.js';
import { Api } from '../../core/net.js';
import { AppTabs } from '../../core/app-tabs.js';
import { KpState, LocalDraft, S } from '../../core/state.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc, Uid } from '../../core/util.js';
import { KpEconomics } from './price-calc.js';
import { KpForm } from '../../core/kp-form.js';
import { DocLink } from '../../core/doc-link.js';

/**
 * Несколько КП в работе — каждое своей вкладкой. Открыто всегда одно (`S`), остальные лежат целиком в своих вкладках и
 * ни с чем не связаны: переключение дожидается ответов сервера для открытого КП, закрывает его окна (экономика, позиция,
 * каталог опций), откладывает изменения в черновик и только потом подставляет другое КП.
 */
export class KpTabs {
  static MAX = 5;
  static IDLE_MS = 50;
  static IDLE_MAX = 4000;
  static LABEL = 22;
  /** вкладки по порядку: {uid, state, drafts, step}; у открытой state = null (она в S) */
  static slots = [];
  static current = '';
  static busy = false;

  /** Вкладки из черновика браузера; открытое КП — уже в S. */
  static init() {
    let saved = null;
    try {
      saved = LocalDraft.loadTabs();
    } catch {
      saved = null;
    }
    const list = saved && Array.isArray(saved.list) ? saved.list : [];
    this.slots = list
      .filter(slot => slot && slot.uid)
      .slice(0, this.MAX)
      .map(slot => ({ ...slot, state: slot.state ? KpState.revive(slot.state) : null }));
    const active = this.slots.find(slot => !slot.state);
    if (active) this.current = active.uid;
    else {
      this.current = Uid.next();
      this.slots.push({ uid: this.current, state: null, drafts: null, step: '' });
    }
    this.slots = this.slots.filter(slot => slot.state || slot.uid === this.current);
    LocalDraft.tabs = () => this._saved();
  }

  /**
   * Вкладки для полосы: подпись, подсказка, открыта ли.
   * @returns {{uid: string, label: string, title: string, on: boolean, full: boolean}[]}
   */
  static items() {
    return this.slots.map(slot => {
      const state = this._state(slot);
      return {
        uid: slot.uid,
        label: this.label(state),
        title: this._title(state),
        on: slot.uid === this.current,
        full: Drafts.meaningful(state),
      };
    });
  }

  /**
   * Подпись вкладки КП.
   * @param {object} state
   * @returns {string}
   */
  static label(state) {
    if (state.number) return `КП № ${state.number}`;
    const client = String(state.client || '').trim();
    if (!client) return 'Новое КП';
    return client.length > this.LABEL ? `${client.slice(0, this.LABEL - 1)}…` : client;
  }

  /**
   * Можно открыть ещё КП.
   * @returns {boolean}
   */
  static roomy() {
    return this.slots.length < this.MAX;
  }

  /**
   * Перед открытием другого КП: это КП уже открыто — перейти на его вкладку (false); открытое пустое — открыть в нём
   * (true); иначе — новая вкладка (true), если не исчерпан предел.
   * @param {{kpId?: string, draft?: string, here?: boolean}} [want] here — заменить КП той же вкладки (прежняя версия)
   * @returns {Promise<boolean>}
   */
  static async prepare({ kpId = '', draft = '', here = false } = {}) {
    if (!this._free()) return false;
    const open = this.slots.find(slot => this._same(this._state(slot), { kpId, draft }));
    if (open && !here) {
      await this.pick(open.uid);
      AppTabs.open(AppTabs.HOME);
      Toast.show(`${this.label(this._state(open))} уже открыто — перешли на его вкладку`);
      return false;
    }
    if (open) {
      await this.pick(open.uid);
      return Drafts.stash();
    }
    if (!Drafts.meaningful(S)) return true;
    if (!this.roomy()) {
      Toast.show(`Открыто ${this.MAX} КП — закройте одно (✕ на вкладке), чтобы открыть ещё`);
      return false;
    }
    this.busy = true;
    try {
      await this._park();
      const slot = { uid: Uid.next(), state: null, drafts: null, step: 'client' };
      this.slots.splice(this._index(this.current) + 1, 0, slot);
      this._activate(slot, KpState.fresh());
    } finally {
      this.busy = false;
    }
    return true;
  }

  /**
   * Перейти на вкладку КП.
   * @param {string} uid
   * @returns {Promise<boolean>}
   */
  static async pick(uid) {
    const slot = this._slot(uid);
    if (!slot || uid === this.current) return !!slot;
    if (!this._free()) return false;
    this.busy = true;
    try {
      await this._park();
      this._activate(slot, slot.state);
    } finally {
      this.busy = false;
    }
    AppTabs.open(AppTabs.HOME);
    return true;
  }

  /**
   * Закрыть вкладку КП: несохранённое — в черновик (без черновиков — с вопросом); последняя — пустое КП.
   * @param {string} uid
   * @returns {Promise<boolean>}
   */
  static async close(uid) {
    if (!this._slot(uid) || !(await this.pick(uid))) return false;
    if (!(await this._leave())) return false;
    this.busy = true;
    try {
      this._closeWindows();
      const index = this._index(uid);
      this.slots.splice(index, 1);
      const next = this.slots[Math.min(index, this.slots.length - 1)];
      if (next) this._activate(next, next.state);
      else {
        const slot = { uid: Uid.next(), state: null, drafts: null, step: 'client' };
        this.slots.push(slot);
        this._activate(slot, KpState.fresh());
      }
    } finally {
      this.busy = false;
    }
    AppTabs.open(AppTabs.HOME);
    return true;
  }

  /** Открыли КП: окна поверх закрыть, перейти на вкладку КП (кабинет, журнал, каталог остаются своими вкладками). */
  static show() {
    document.querySelectorAll('dialog[open]:modal').forEach(dialog => dialog.close());
    AppTabs.open(AppTabs.HOME);
  }

  /** Телефон: список открытых КП (повторное нажатие «КП» внизу). */
  static menu() {
    const modal = new Modal(
      `<div class="dlg-h"><h3>Открытые КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="kpt-l">${this.items()
        .map(
          item =>
            `<div class="kpt-r${item.on ? ' on' : ''}"><button type="button" class="kpt-o" data-kto="${esc(item.uid)}"><b>${esc(item.label)}</b><span class="muted">${esc(item.title)}</span></button><button class="icon" type="button" data-ktx="${esc(item.uid)}" aria-label="Закрыть ${esc(item.label)}">✕</button></div>`,
        )
        .join('')}</div>
      ${this.roomy() ? '<button class="btn primary kpt-add" type="button" data-ktn>＋ Новое КП</button>' : `<p class="muted">Открыто ${this.MAX} КП — закройте одно, чтобы открыть ещё.</p>`}`,
      'sheet kt-dlg',
    );
    modal.d.onclick = event => this._menuClick(modal, event.target);
  }

  static async _menuClick(modal, target) {
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const pick = target.closest('[data-kto]');
    const drop = target.closest('[data-ktx]');
    if (!pick && !drop && !target.closest('[data-ktn]')) return;
    modal.close();
    if (pick) await this.pick(pick.dataset.kto);
    else if (drop) await this.close(drop.dataset.ktx);
    else document.dispatchEvent(new CustomEvent('kp:new-tab'));
  }

  static _state(slot) {
    return slot.uid === this.current ? S : slot.state;
  }

  static _slot(uid) {
    return this.slots.find(slot => slot.uid === uid);
  }

  static _index(uid) {
    return this.slots.findIndex(slot => slot.uid === uid);
  }

  static _same(state, { kpId, draft }) {
    return !!((kpId && state.kpId === kpId) || (draft && state._draft === draft));
  }

  static _title(state) {
    // у несохранённого КП клиент — уже в подписи вкладки
    const parts = [state.number ? state.client : 'не сохранено', `${(state.items || []).length} поз.`];
    const sum = (state.items || []).length ? KPGen.money(this._sum(state)) : '';
    return [...parts, sum ? `${sum} ${(state.pricing && state.pricing.cur) || 'RUB'}` : ''].filter(Boolean).join(' · ');
  }

  // один подсчёт для открытого и отложенных КП — с опциями, как в журнале (раньше у отложенных — без платных опций)
  static _sum(state) {
    return KpEconomics.of(state).sum;
  }

  // переключение не начинается, пока идёт другое или сохраняется КП в журнал
  static _free() {
    if (KpState.paused()) {
      Toast.show('Сначала сохраните или закройте позицию каталога');
      return false;
    }
    if (!this.busy && !Drafts.paused && !DocLink.saving()) return true; // сборка файла идёт до паузы черновика
    Toast.show('Подождите — КП ещё сохраняется');
    return false;
  }

  // ответы сервера, начатые для открытого КП, дописываются в него до переключения
  static async _idle() {
    const until = Date.now() + this.IDLE_MAX;
    let calm = 0;
    while (calm < 2 && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, this.IDLE_MS));
      calm = Api.flying ? 0 : calm + 1;
    }
  }

  // окна, относящиеся к открытому КП: экономика, позиция, каталог опций позиции, окна поверх
  static _closeWindows() {
    document.querySelectorAll('dialog[open]:modal').forEach(dialog => dialog.close());
    AppTabs.close('item');
    AppTabs.close('deal');
    document.dispatchEvent(new Event('kp:leave'));
  }

  static async _park() {
    await this._idle();
    this._closeWindows();
    if (Drafts.enabled()) await Drafts.quiet();
    const slot = this._slot(this.current);
    slot.state = S;
    slot.drafts = { kpId: Drafts.kpId, base: Drafts.base };
    slot.step = KpForm.step();
    KpState.flush();
  }

  static _activate(slot, state) {
    slot.state = null;
    this.current = slot.uid;
    KpState.replace(state);
    Drafts.kpId = slot.drafts ? slot.drafts.kpId : null;
    Drafts.base = slot.drafts ? slot.drafts.base : null;
    KpForm.select(slot.step || 'client');
    KpForm.render();
    KpState.persist();
    KpState.flush();
    document.dispatchEvent(new Event('kp:enter'));
    window.scrollTo({ top: 0 });
  }

  // закрыть открытую вкладку: несохранённые изменения — в черновик или с вопросом
  static async _leave() {
    if (!Drafts.pending()) return true;
    if (Drafts.enabled() && (await Drafts.quiet())) {
      Toast.show('Несохранённые изменения закрытого КП — в черновиках (журнал → «Черновики»)');
      return true;
    }
    return confirm(`${this.label(S)}: несохранённые изменения пропадут. Закрыть?`);
  }

  // запись других вкладок вместе с черновиком открытого КП
  static _saved() {
    if (this.slots.length < 2) return null;
    return { list: this.slots.map(slot => ({ ...slot, state: slot.uid === this.current ? null : slot.state })) };
  }
}
