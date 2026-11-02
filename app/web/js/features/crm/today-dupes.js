import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';
import { CrmData } from './crm-data.js';
import { DealMerge } from './deal-merge.js';
import { CabState } from './cab-state.js';

/**
 * «Сегодня» → «Что сделать» → «Дубли»: клиенты, у которых в открытом кабинете несколько незакрытых сделок (одна воронка,
 * одна закупка), — «Объединить в № …» (сервер — deal_merge.DealDupes, как «Отдел» → «Дубли сделок»).
 */
export class TodayDupes {
  static groups = [];
  static wide = false;

  /**
   * Группа есть (функция включена; работает вместе с «Объединить сделки»).
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('todayDupes');
  }

  /**
   * Загрузить дубли открытого кабинета (весь отдел — в «Отделе»); не загрузились — группы нет, кабинет работает.
   * @returns {Promise<void>}
   */
  static async load() {
    if (!this.enabled() || CrmData.all()) {
      this.groups = [];
      return;
    }
    try {
      const reply = await Api.request(`/api/crm/dupes/mine?manager=${encodeURIComponent(CrmData.who)}`);
      this.groups = reply.groups || [];
    } catch {
      this.groups = [];
    }
  }

  /**
   * Сколько клиентов с дублями — в счёт «Что сделать».
   * @returns {number}
   */
  static count() {
    return this.enabled() ? this.groups.length : 0;
  }

  /**
   * Группа «Что сделать»: заголовок и строка на клиента; больше limit — «и ещё N — показать все».
   * @param {number} limit
   * @returns {string}
   */
  static html(limit) {
    const groups = this.enabled() ? this.groups : [];
    if (!groups.length) return '';
    const shown = this.wide ? groups : groups.slice(0, limit);
    const rest = groups.length - shown.length;
    const more =
      rest > 0 ? `<button class="lnk cab-all" type="button" data-tdmall>и ещё ${rest} — показать все</button>` : '';
    const rows = shown.map((group, index) => this._row(group, index)).join('');
    return `<p class="tk-g">Дубли: у клиента несколько сделок — объедините в одну <b class="md-c">${groups.length}</b></p>${rows}${more}`;
  }

  static _row(group, index) {
    const head = group.deals.find(deal => deal.id === group.target) || group.deals[0];
    const count = group.deals.length;
    const numbers = group.deals.map(deal => `№ ${esc(deal.number)}`).join(', ');
    const tone = CrmData.toneOf(CrmData.deal(head.id) || head);
    const what = `${count} ${KPGen.plural(count, 'сделка', 'сделки', 'сделок')}: ${numbers}`;
    return `<div class="md-r"><span class="cab-dot t-${tone}" aria-hidden="true"></span><button type="button" class="cab-rl" data-deal="${esc(head.id)}"><b>${esc(group.client)}</b><span class="muted">${what}</span></button><button class="btn sm primary" type="button" data-tdm="${index}" title="В эту сделку перейдут КП, дела и документы остальных">Объединить в № ${esc(head.number)}</button></div>`;
  }

  /**
   * Щелчки группы. true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const merge = event.target.closest('[data-tdm]');
    if (merge) {
      const group = this.groups[+merge.dataset.tdm];
      if (group) DealMerge.group(group);
      return true;
    }
    if (!event.target.closest('[data-tdmall]')) return false;
    this.wide = true;
    CabState.renderBody();
    return true;
  }
}
