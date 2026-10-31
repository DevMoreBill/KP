import { FormView } from './form-view.js';
import { Toast } from '../core/toast.js';
import { KpFilesPanel } from '../features/kp/kp-files.js';
import { esc } from '../core/util.js';
import { DealState } from '../features/deal/deal-state.js';
import { DealCalculator } from '../features/deal/deal-calculator.js';
import { DealConds } from '../features/deal/deal-conds.js';
import { KpState, S } from '../core/state.js';
import { KpConditions } from '../core/conditions.js';
import { CondMemory } from '../core/cond-memory.js';
import { UiKit } from '../core/ui-kit.js';
import { AdminDialog } from '../core/admin-dialog.js';

/**
 * Раздел 5 «Условия»: поле и список вариантов ▾ у каждого условия, «Как в прошлом КП»; «Очистить все условия» —
 * только когда есть что очищать, справа и с подтверждением.
 */
export class CondsStep {
  static SYNC_TEXT = 70;

  /**
   * Что предлагает экономика сделки (если её заполняли).
   * @returns {object}
   */
  static fromDeal() {
    if (!S.deal || !S.deal.touched) return {};
    try {
      return DealConds.suggest(DealCalculator.calc(DealState.kpInputs(), S.deal));
    } catch {
      return {};
    }
  }

  static _picker(attr, index, options, recent) {
    const button = value => `<button type="button" ${attr}="${index}" data-v="${esc(value)}">${esc(value)}</button>`;
    return `<details class="pickm"><summary class="btn" title="Выбрать из списка" aria-label="Выбрать из списка">▾</summary><div class="menu-l">
    ${recent.length ? `<p class="pm-cap">Вы вписывали</p>${recent.map(button).join('')}<hr>` : ''}${options.map(button).join('')}</div></details>`;
  }

  static _row(cond, j, recent, suggested) {
    const value = String(cond.value || '').trim();
    const fromDeal = suggested[cond.label];
    const same = value && fromDeal && value === fromDeal;
    const options = KpConditions.options(cond.label);
    const own = (recent[cond.label] || []).filter(old => !options.includes(old));
    const sync =
      fromDeal && value !== fromDeal
        ? `<button type="button" class="lnk cond-sync" data-csync="${j}" title="${esc(fromDeal)}">↺ Из экономики сделки: ${esc(fromDeal.length > this.SYNC_TEXT ? `${fromDeal.slice(0, this.SYNC_TEXT)}…` : fromDeal)}</button>`
        : '';
    return `<div class="f"><span>${esc(cond.label)}${same ? ' <em class="cond-auto" title="Подставлено из «Экономики сделки» и обновляется при её изменении. Впишите своё — останется ваше.">из экономики сделки</em>' : ''}</span><div class="cpick">
        <input type="text" data-p="conditions.${j}.value" value="${esc(cond.value || '')}" placeholder="Не выводить" autocomplete="off">
        ${this._picker('data-cset', j, options, own)}</div>
        ${sync}${this._place(cond)}</div>`;
  }

  // доставка до объекта: что попадёт в КП, или подсказка указать адрес
  static _place(cond) {
    if (cond.label !== KpConditions.DELIVERY || !KpConditions.TO_PLACE.test(String(cond.value || ''))) return '';
    const address = String((S.object || {}).address || '').trim();
    if (!address) {
      return '<span class="muted cond-place">Адрес доставки не указан — впишите «Адрес объекта» в разделе «Клиент», и он добавится в КП</span>';
    }
    return `<span class="muted cond-place">В КП: «${esc(KpConditions.deliveryText(cond, address))}»</span>`;
  }

  static _bar(last, any) {
    if (!(last || any)) return '';
    return `<div class="row cond-bar">${last ? '<button class="btn" type="button" data-cond="last">Как в прошлом КП</button>' : ''}<span class="sp"></span>${any ? '<button class="btn ghost" type="button" data-cond="clear">Очистить все условия</button>' : ''}</div>`;
  }

  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    const recent = CondMemory.recent();
    const suggested = this.fromDeal();
    const any = S.conditions.some(cond => String(cond.value || '').trim()) || !!String(S.condExtra || '').trim();
    const rows = S.conditions.map((cond, j) => this._row(cond, j, recent, suggested)).join('');
    return `<section class="step" id="st-conds"><h2><span class="n">5</span>Условия${UiKit.tip('<p>Кнопка ▾ у поля — список базовых вариантов (и ваших значений из прошлых КП); можно и вписать своё. Пустое условие в КП не попадёт.</p><p>«Как в прошлом КП» — заполнить все условия так же, как в последнем сохранённом КП.</p><p>Дополнительные условия выводятся под таблицей условий: каждая строка — отдельный абзац.</p>')}</h2>
    ${this._bar(CondMemory.last(), any)}
    <div class="grid g2">${rows}</div>
    <div class="f" style="margin-top:14px"><span>Дополнительные условия и оговорки</span><div class="cpick ta">
      <textarea data-p="condExtra" rows="3" placeholder="Например: цена действительна при заказе комплекта целиком">${esc(S.condExtra || '')}</textarea>
      ${this._picker('data-cxadd', 0, KpConditions.EXTRA, [])}</div></div>
    ${KpFilesPanel.stepHtml()}</section>`;
  }

  static async _clear() {
    if (
      !(await AdminDialog.confirm(
        'Очистить все условия?',
        'Поля условий и оговорки станут пустыми — в КП условия не попадут.',
        'Очистить',
      ))
    ) {
      return false;
    }
    S.conditions.forEach(cond => {
      cond.value = '';
    });
    S.condExtra = '';
    return true;
  }

  static _sync(button) {
    const cond = S.conditions[+button.dataset.csync];
    const value = this.fromDeal()[cond.label];
    if (value) {
      cond.value = value;
      S.condAuto = { ...(S.condAuto || {}), [cond.label]: value };
    }
    return true;
  }

  static _set(button) {
    S.conditions[+button.dataset.cset].value = button.dataset.v;
    return true;
  }

  static _addExtra(button) {
    const current = String(S.condExtra || '').trim();
    const lines = current.split('\n').map(line => line.trim());
    if (!lines.includes(button.dataset.v)) S.condExtra = (current ? `${current}\n` : '') + button.dataset.v;
    return true;
  }

  static _last() {
    const last = CondMemory.last();
    if (!last) return false;
    S.conditions = S.conditions.map(cond => ({
      ...cond,
      value: (last.conditions.find(old => old.label === cond.label) || {}).value || '',
    }));
    S.condExtra = last.condExtra || '';
    Toast.show('Условия — как в прошлом КП');
    return true;
  }

  // действие по щелчку (кроме «Очистить»): true — условия изменены, false — ничего не делать
  static _act(target) {
    const act = target.closest('[data-cond]');
    const sync = target.closest('[data-csync]');
    if (sync) return this._sync(sync);
    const set = target.closest('[data-cset]');
    if (set) return this._set(set);
    const add = target.closest('[data-cxadd]');
    if (add) return this._addExtra(add);
    if (act && act.dataset.cond === 'last') return this._last();
    return false;
  }

  /**
   * Щелчок в разделе: варианты ▾, «Как в прошлом КП», «Очистить», «Из экономики сделки».
   * @param {MouseEvent} event
   */
  static async click(event) {
    const clear = event.target.closest('[data-cond]')?.dataset.cond === 'clear';
    // без «Очистить» — без ожидания: форма перерисовывается в том же щелчке
    const changed = clear ? await this._clear() : this._act(event.target);
    if (!changed) return;
    event.target.closest('details')?.removeAttribute('open');
    FormView.render();
    KpState.persist();
  }

  /** Обработчик щелчков раздела. */
  static listen() {
    document.addEventListener('click', event => this.click(event));
  }
}
