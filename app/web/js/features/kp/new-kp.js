import { Drafts } from './drafts.js';
import { Managers } from './managers.js';
import { Presets } from './presets.js';
import { AppTabs } from '../../core/app-tabs.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpState, S } from '../../core/state.js';
import { Modal } from '../../core/modal.js';
import { KpTabs } from './kp-tabs.js';
import { KpForm } from '../../core/kp-form.js';

/** «Новое КП»: пустое, из заготовки или продолжить черновик; текущее — в черновики. */
export class NewKp {
  static SEARCH_FROM = 6;

  /** Окно «Новое КП». */
  static open() {
    return Modal.once('newkp', () => this._open());
  }

  static async _open() {
    const useDrafts = Drafts.enabled();
    const usePresets = Presets.enabled();
    if (!useDrafts && !usePresets) {
      await this.tab();
      return;
    }
    const note = this._note();
    const [presets, drafts] = await Promise.all([usePresets ? Presets.list() : [], useDrafts ? Drafts.list() : []]);
    const modal = new Modal(
      `<div class="dlg-h"><h3>Новое КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${note ? `<p class="muted" style="margin:0 0 10px">${note}</p>` : ''}
      <div class="row nk-top"><button class="btn primary" type="button" data-nk>Пустое КП</button>${usePresets && S.items.length ? '<button class="btn" type="button" data-nps title="Позиции, цены и условия текущего КП — для следующих КП">Сохранить текущее как заготовку</button>' : ''}</div>
      ${usePresets ? this._presets(presets) : ''}
      ${useDrafts ? this._drafts(drafts) : ''}`,
      'newkp-dlg',
    );
    const search = modal.$('#nkQ');
    if (search) search.oninput = () => this._find(modal, presets, search.value);
    modal.d.onclick = event => this._click(modal, event.target);
  }

  static _note() {
    if (!Drafts.meaningful(S)) return '';
    return KpTabs.roomy()
      ? 'Новое КП откроется в новой вкладке — текущее останется открытым в своей.'
      : `Открыто ${KpTabs.MAX} КП — закройте одно (✕ на вкладке), чтобы начать новое.`;
  }

  static _presets(presets) {
    const search =
      presets.length > this.SEARCH_FROM
        ? '<input type="search" class="f" id="nkQ" placeholder="Найти заготовку" style="margin-bottom:6px">'
        : '';
    const rows = presets.length
      ? presets.map(row => Presets.rowHtml(row)).join('')
      : '<p class="empty">Заготовок пока нет. Соберите КП и нажмите «Сохранить текущее как заготовку».</p>';
    return `<p class="sub" style="margin:4px 0 6px">По заготовке</p>${search}<div class="nk-l" id="nkP">${rows}</div>`;
  }

  static _drafts(drafts) {
    const shown = Math.round(DefRegistry.num('kp.newKpDrafts', 5));
    if (!drafts.length || !shown) return '';
    const all =
      drafts.length > shown
        ? `<button class="btn ghost" type="button" data-nall>Все черновики (${drafts.length})</button>`
        : '';
    return `<p class="sub" style="margin:14px 0 6px">Продолжить черновик</p><div class="nk-l">${drafts
      .slice(0, shown)
      .map(row => Drafts.rowHtml(row))
      .join('')}</div>${all}`;
  }

  static _find(modal, presets, query) {
    const text = query.trim().toLowerCase();
    modal.$('#nkP').innerHTML =
      presets
        .filter(row => !text || row.title.toLowerCase().includes(text))
        .map(row => Presets.rowHtml(row))
        .join('') || '<p class="empty">Не найдено.</p>';
  }

  static _ACTIONS = [
    ['[data-x]', modal => modal.close()],
    ['[data-nk]', modal => NewKp._blankAfterStash(modal)],
    ['[data-nps]', modal => NewKp._then(modal, () => Presets.ask())],
    ['[data-nall]', modal => NewKp._then(modal, () => Drafts.dialog())],
    ['[data-pru]', (modal, button) => NewKp._then(modal, () => Presets.use(button.dataset.pru))],
    ['[data-prd]', (modal, button) => NewKp._dropPreset(button)],
    ['[data-dro]', (modal, button) => NewKp._then(modal, () => Drafts.open(button.dataset.dro))],
    ['[data-drd]', (modal, button) => NewKp._dropDraft(button)],
  ];

  static _click(modal, target) {
    for (const [selector, act] of this._ACTIONS) {
      const button = target.closest(selector);
      if (button) {
        act(modal, button);
        return;
      }
    }
  }

  static _then(modal, next) {
    modal.close();
    next();
  }

  static async _blankAfterStash(modal) {
    modal.close();
    await this.tab();
  }

  /** Новое пустое КП — в новой вкладке (открытое пустое — в нём же). */
  static async tab() {
    if (!(await KpTabs.prepare())) return;
    this.blank();
  }

  static async _dropPreset(button) {
    if (!confirm(`Удалить заготовку «${button.dataset.prt}»?`)) return;
    if (await Presets.remove(button.dataset.prd)) button.closest('.st-row').remove();
  }

  static async _dropDraft(button) {
    if (await Drafts.remove(button.dataset.drd)) button.closest('.st-row').remove();
  }

  /** Чистое КП с моими контактами (без вывода) — для КП по сделке, клиенту. */
  static fresh() {
    KpState.replace(KpState.fresh());
    this.myContacts();
  }

  /** Пустое КП — на вкладке КП, раздел «Клиент» (с него начинается КП; каталог — со следующего шага). */
  static blank() {
    this.fresh();
    KpState.persist();
    AppTabs.open(AppTabs.HOME);
    KpForm.open('client');
  }

  /** Контакты менеджера в новом КП: запомненные этим браузером, иначе — из карточки «кто я» (новый компьютер). */
  static myContacts() {
    if (String(S.manager.name || '').trim()) return;
    const manager = Managers.list.find(row => row.id === Managers.meId());
    if (!manager) return;
    S.managerId = manager.id;
    S.manager = { ...S.manager, ...Managers.fields(manager) };
  }
}
