import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { esc, today } from '../../core/util.js';

/** «Отдел»: воронка по стадиям и итоги месяца по менеджерам (администратору и менеджерам с правом «КП других менеджеров»). */
export class CabTeam {
  static MIN_BAR = 2;
  static PERCENT = 100;

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    if (!CrmData.all()) {
      return '<p class="empty">Сводка отдела — по всем менеджерам. <button class="btn sm" type="button" data-tmgr="all">Показать весь отдел</button></p>';
    }
    const deals = CrmData.deals();
    const open = deals.filter(deal => !CrmData.closed(deal) && CrmData.inFunnel(deal));
    return `<div class="cab-team"><section class="md-s"><div class="md-h"><p class="sub">Воронка отдела</p>${CrmFunnel.switcher(deals, CrmData.funnel())}<span class="muted">${open.length} в работе · ${CrmFmt.short(this._sum(open))}</span></div><div class="fn">${this._funnel(open)}</div></section>
      <section class="md-s"><div class="md-h"><p class="sub">Менеджеры</p><span class="muted">итоги месяца — с 1-го числа; имя — открыть кабинет менеджера</span></div>
      <div class="tbl-wrap"><table class="cab-tt"><thead><tr><th>Менеджер</th><th>В работе</th><th>Сумма</th><th>Выиграно</th><th>Проиграно</th><th>Дела просрочены</th><th>Без дела</th></tr></thead><tbody>${this._rows(deals)}</tbody></table></div></section></div>`;
  }

  static _sum(deals) {
    return deals.reduce((total, deal) => total + (deal.sum || 0), 0);
  }

  static _funnel(open) {
    const stages = CrmData.stages({ open: true });
    const sums = stages.map(stage => this._sum(open.filter(deal => deal.stage === stage.key)));
    const max = Math.max(1, ...sums);
    const funnel = CrmData.funnel();
    return stages
      .map((stage, index) => {
        const count = open.filter(deal => deal.stage === stage.key).length;
        const sum = sums[index];
        const width = Math.max(sum ? this.MIN_BAR : 0, (sum / max) * this.PERCENT).toFixed(1);
        return `<div class="fn-r"><span class="fn-l" title="${esc(stage.label)}">${esc(stage.label)}</span><span class="fn-b"><i class="t-${CrmFunnel.tone(funnel, stage.key)}" style="width:${width}%"></i></span><span class="fn-v"><b>${count}</b> · ${CrmFmt.short(sum)}</span></div>`;
      })
      .join('');
  }

  static _blank(id, name) {
    return { id, name, open: 0, sum: 0, won: 0, wonSum: 0, lost: 0, over: 0, free: 0 };
  }

  static _tally(deals) {
    const byId = new Map();
    for (const mgr of CrmData.managers()) byId.set(mgr.id, this._blank(mgr.id, mgr.name));
    const month = today().slice(0, 7);
    for (const deal of deals) {
      if (!byId.has(deal.managerId))
        byId.set(deal.managerId, this._blank(deal.managerId, deal.manager || 'Без менеджера'));
      this._count(byId.get(deal.managerId), deal, String(deal.stageAt || '').slice(0, 7) === month);
    }
    for (const task of CrmData.openTasks()) {
      const row = byId.get(task.managerId);
      if (row && task.due < today()) row.over++;
    }
    return [...byId.values()]
      .filter(row => row.open || row.won || row.lost || row.over)
      .sort((one, two) => two.sum - one.sum);
  }

  static _count(row, deal, thisMonth) {
    if (deal.stage === 'won') {
      if (thisMonth) {
        row.won++;
        row.wonSum += deal.sum || 0;
      }
      return;
    }
    if (deal.stage === 'lost') {
      if (thisMonth) row.lost++;
      return;
    }
    row.open++;
    row.sum += deal.sum || 0;
    if (!deal.next) row.free++;
  }

  static _rows(deals) {
    const rows = this._tally(deals);
    if (!rows.length) return '<tr><td colspan="7" class="muted">Сделок пока нет.</td></tr>';
    return rows
      .map(
        row =>
          `<tr><td><button type="button" class="lnk" data-tmgr="${esc(row.id)}" title="Открыть кабинет менеджера">${esc(row.name)}</button></td><td>${row.open}</td><td>${CrmFmt.short(row.sum)}</td><td>${row.won}${row.won ? ` · ${CrmFmt.short(row.wonSum)}` : ''}</td><td>${row.lost}</td><td class="${row.over ? 'bad-t' : ''}">${row.over}</td><td class="${row.free ? 'warn-t' : ''}">${row.free}</td></tr>`,
      )
      .join('');
  }
}
