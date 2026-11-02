import { esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { Morph } from '../../core/morph.js';
import { FEAT } from '../../core/features.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { KpDate } from '../../core/kp-date.js';
import { CrmFunnel } from './crm-funnel.js';
import { DealMerge } from './deal-merge.js';

/**
 * «Отдел» → «Дубли сделок»: клиенты, у которых у одного менеджера несколько незакрытых сделок (одна воронка, одна
 * закупка); номер — открыть сделку, «Объединить в № …» — окно объединения с отмеченными дублями.
 */
export class TeamDupes {
  static data = null;
  static loadedAt = 0;
  static failedAt = 0;
  static FRESH_MS = 300000;
  static RETRY_MS = 30000;
  static loading = false;

  /**
   * Блок (данные — с сервера при первом показе).
   * @returns {string}
   */
  static html() {
    if (!FEAT.on('dealDupes')) return '';
    if (this._due()) this._load();
    return `<section class="md-s" id="cabDupes">${this._inner()}</section>`;
  }

  static _inner() {
    const data = this.data;
    const count = data && data.groups ? ` <b class="md-c">${data.groups.length}</b>` : '';
    const head = `<div class="md-h"><p class="sub">Дубли сделок${count}</p><span class="muted">несколько незакрытых сделок одного клиента у одного менеджера</span></div>`;
    if (!data) return `${head}<p class="muted">Ищу…</p>`;
    if (data.error)
      return `${head}<p class="muted">Не загрузилось: ${esc(data.error)} <button class="lnk" type="button" data-cabretry="dupes">Повторить</button></p>`;
    if (!data.groups.length)
      return `${head}<p class="ok-t">✓ Дублей нет: у каждого клиента у менеджера одна незакрытая сделка.</p>`;
    return `${head}<div class="dup-l">${data.groups.map((group, index) => this._group(group, index)).join('')}</div>`;
  }

  static _group(group, index) {
    const target = group.deals.find(deal => deal.id === group.target) || group.deals[0];
    const merge = DealMerge.enabled()
      ? `<button class="btn sm" type="button" data-tdmerge="${index}" title="В эту сделку перейдут КП, дела и документы остальных">Объединить в № ${esc(target.number)}</button>`
      : '';
    const count = group.deals.length;
    const about = [
      group.inn ? `ИНН ${esc(group.inn)}` : '',
      esc(group.manager),
      `${count} ${KPGen.plural(count, 'сделка', 'сделки', 'сделок')}`,
    ];
    const rows = group.deals.map(deal => this._deal(deal, group.target)).join('');
    return `<div class="dup-g"><div class="dup-h"><span><b>${esc(group.client)}</b><span class="muted">${about.filter(Boolean).join(' · ')}</span></span>${merge}</div><ul class="dup-ds">${rows}</ul></div>`;
  }

  static _deal(deal, target) {
    const stage = CrmFunnel.anyLabel(deal.stage);
    const kps = deal.kps
      ? `КП: ${deal.kps}, последнее ${KpDate.ddmm(deal.last)}`
      : `без КП, с ${KpDate.ddmm(deal.created)}`;
    const mark = deal.id === target ? ' <span class="dup-t">итоговая</span>' : '';
    return `<li><button class="pay-t" type="button" data-deal="${esc(deal.id)}">№ ${esc(deal.number)} · ${esc(deal.title)}</button>${mark} <span class="muted">${esc(stage)} · ${CrmFmt.rub(deal.sum)} · ${kps}</span></li>`;
  }

  /**
   * «Объединить в № …»: окно объединения в предложенную сделку, остальные отмечены.
   * @param {HTMLElement} el кнопка с data-tdmerge — номер группы
   */
  static merge(el) {
    const group = ((this.data && this.data.groups) || [])[+el.dataset.tdmerge];
    if (group) DealMerge.group(group, () => this.retry());
  }

  /**
   * Загрузить заново (кнопка «Повторить», после объединения).
   */
  static retry() {
    this.failedAt = 0;
    this.loadedAt = 0;
    this._load();
  }

  // пора загрузить: нет данных, устарели или ошибка — не чаще раза в RETRY_MS
  static _due() {
    const now = Date.now();
    if (this.loading || now - this.failedAt < this.RETRY_MS) return false;
    return !this.data || Boolean(this.data.error) || now - this.loadedAt > this.FRESH_MS;
  }

  static async _load() {
    if (this.loading) return;
    this.loading = true;
    try {
      this.data = await Api.request('/api/crm/dupes?manager=all');
      this.loadedAt = Date.now();
      this.failedAt = 0;
    } catch (error) {
      // ошибка — не «дублей нет»: прежние данные остаются, иначе текст и «Повторить»
      if (!this.data || this.data.error) this.data = { error: String(error.message || error) };
      this.failedAt = Date.now();
    } finally {
      this.loading = false;
    }
    const box = document.getElementById('cabDupes');
    if (box) Morph.apply(box, this._inner());
  }
}
