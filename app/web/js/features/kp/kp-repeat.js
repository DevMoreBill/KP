import { CatPrice } from './price-hints.js';
import { Drafts } from './drafts.js';
import { Modal } from '../../core/modal.js';
import { Managers } from './managers.js';
import { esc, today } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { KpTabs } from './kp-tabs.js';
import { KpForm } from '../../core/kp-form.js';

/** «Повторить КП» (журнал, карточка клиента): новое КП тому же клиенту, дата — сегодня, цены — как сейчас в каталоге. */
export class KpRepeat {
  static DROP = ['kpId', 'number', 'createdAt', '_rev', '_file', 'dealId'];

  /**
   * Новое КП по сохранённому; изменения цен — окном.
   * @param {string} id сохранённое КП
   */
  static async run(id) {
    let state;
    try {
      state = await Api.request(`/api/kp/${encodeURIComponent(id)}/state`);
    } catch (error) {
      Toast.show(`КП не открылось: ${error.message || error}`);
      return;
    }
    if (!(await KpTabs.prepare())) return;
    KpState.replace(Object.assign(KpState.fresh(), state));
    const was = S.number;
    for (const key of this.DROP) delete S[key];
    S.date = today();
    S.authorId = Managers.meId() || S.managerId || '';
    if (S.tender && S.tender.on) S.tender = { on: true, number: '', url: '' }; // другая закупка
    const changes = this.prices();
    KpTabs.show();
    KpForm.render();
    KpState.persist();
    window.scrollTo({ top: 0 });
    Drafts.loaded();
    if (!changes.length) {
      Toast.show(`Новое КП по № ${was}: цены как в каталоге, даты — сегодняшние`);
      return;
    }
    this.show(`Повтор КП № ${was}: цены по каталогу`, `Клиент и позиции — как в КП № ${was}, дата — сегодня.`, changes);
  }

  /**
   * Цены позиций открытого КП — как сейчас в каталоге.
   * @returns {object[]} изменённые: {name, now, cat, pct}
   */
  static prices() {
    const changes = [];
    for (const item of S.items) {
      const diff = CatPrice.diff(item);
      if (!diff) continue;
      changes.push({ name: item.name, ...diff });
      item.price = diff.cat;
      delete item._priceText;
    }
    return changes;
  }

  /**
   * Окно «какие цены изменились».
   * @param {string} title
   * @param {string} intro
   * @param {object[]} changes
   */
  static show(title, intro, changes) {
    const rows = changes
      .map(
        change =>
          `<tr><td>${esc(change.name)}</td><td class="num">${KPGen.money(change.now)}</td><td class="num"><b>${KPGen.money(change.cat)}</b></td><td class="num ${change.pct > 0 ? 'up' : 'down'}">${change.pct > 0 ? '+' : ''}${String(change.pct).replace('.', ',')}</td></tr>`,
      )
      .join('');
    const modal = new Modal(
      `<div class="dlg-h"><h3>${esc(title)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 8px">${esc(intro)} У этих позиций цена теперь как в каталоге:</p>
      <table class="pv-t kr-t"><thead><tr><th>Позиция</th><th class="num">Было</th><th class="num">Стало</th><th class="num">%</th></tr></thead><tbody>
      ${rows}
      </tbody></table><div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-x>Понятно</button></div>`,
      'kr-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
  }
}
