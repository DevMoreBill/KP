import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { KpDate } from '../kp/kp-date.js';
import { UiKit } from '../../ui/ui-kit.js';
import { WorkCalendar } from '../../ui/date-picker.js';
import { esc, today } from '../../core/util.js';

/**
 * Правая колонка «Сегодня» — картина без поиска по разделам: неделя по дням (дела и ожидаемые договоры), план месяца,
 * воронка по стадиям с суммами. Всё нажимается и ведёт к своим сделкам.
 */
export class CabTodaySide {
  static WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  static PERCENT = 100;
  static BAR_MIN = 4;
  static FULL = 3;

  /**
   * Колонка.
   * @returns {string}
   */
  static html() {
    return `${this._week()}${this._month()}${this._funnel()}`;
  }

  // неделя вперёд: сколько дел и ожидаемых договоров на каждый день
  static _week() {
    const now = today();
    WorkCalendar.year(+now.slice(0, 4));
    const tasks = CrmData.openTasks();
    const deals = CrmData.openDeals();
    const over = tasks.filter(task => task.due < now).length;
    const cells = Array.from({ length: CrmFmt.WEEK }, (_unused, shift) => {
      const day = KpDate.addDays(now, shift);
      const count = tasks.filter(task => task.due === day).length;
      const expect = deals.filter(deal => deal.expected === day).length;
      const date = new Date(`${day}T12:00:00`);
      const name = shift === 0 ? 'сегодня' : this.WEEKDAYS[date.getDay()];
      const kind = WorkCalendar.day(date);
      const busy = count ? ` busy${count > this.FULL ? ' full' : ''}` : '';
      const rest = kind.off ? ` off ${kind.cls}` : '';
      const hint = `${CrmFmt.day(day)}${kind.t ? ` — ${kind.t}` : ''}: дел ${count}${expect ? `, ожидается договоров ${expect}` : ''}`;
      return `<div class="tw-d${shift === 0 ? ' now' : ''}${busy}${rest}" title="${esc(hint)}"><span>${name}</span><b>${count || '·'}</b><small>${CrmFmt.day(day).slice(0, 5)}</small>${expect ? `<i class="tw-e" aria-label="ожидается договоров: ${expect}">${expect}</i>` : ''}</div>`;
    }).join('');
    const late = over ? `<span class="bad-t">просрочено ${over}</span>` : '<span class="muted">без просрочек</span>';
    return `<section class="md-s ts"><div class="md-h"><p class="sub">Неделя${UiKit.tip('<p>Сколько дел на каждый день недели: чем больше дел, тем темнее день. Выходные и праздники — красным. Синяя метка в углу — в этот день ожидается договор по сделке.</p>')}</p>${late}</div><div class="tw">${cells}</div></section>`;
  }

  // месяц: что ждём и что уже выиграно
  static _month() {
    const month = today().slice(0, 7);
    const open = CrmData.openDeals();
    const expected = open.filter(deal => String(deal.expected || '').slice(0, 7) <= month);
    const won = CrmData.deals().filter(
      deal => deal.stage === 'won' && String(deal.stageAt || '').slice(0, 7) === month,
    );
    const lost = CrmData.deals().filter(
      deal => deal.stage === 'lost' && String(deal.stageAt || '').slice(0, 7) === month,
    );
    const sum = list => list.reduce((total, deal) => total + (deal.sum || 0), 0);
    const plan = sum(expected) + sum(won);
    const share = plan ? Math.round((sum(won) / plan) * this.PERCENT) : 0;
    const rows = [
      ['month', 'Ожидаем договоров', expected, ''],
      ['won', 'Выиграно', won, 'ok'],
      ['lost', 'Проиграно', lost, 'bad'],
    ]
      .map(
        ([key, label, list, tone]) =>
          `<button type="button" class="tm-r${tone ? ` ${tone}` : ''}" data-kpi="${key}"><span>${label}</span><b>${list.length}</b><span class="muted">${CrmFmt.short(sum(list))}</span></button>`,
      )
      .join('');
    return `<section class="md-s ts"><div class="md-h"><p class="sub">Этот месяц</p><span class="muted">выиграно ${share} % от ожидаемого</span></div>
      <div class="tm-bar" aria-hidden="true"><i style="width:${share}%"></i></div>${rows}</section>`;
  }

  // воронка открытой на доске воронки: сделки и суммы по стадиям
  static _funnel() {
    const stages = CrmData.stages({ open: true });
    const deals = CrmData.openDeals().filter(deal => CrmData.inFunnel(deal));
    if (!stages.length) return '';
    const rows = stages.map(stage => {
      const list = deals.filter(deal => deal.stage === stage.key);
      return { stage, count: list.length, sum: list.reduce((total, deal) => total + (deal.sum || 0), 0) };
    });
    const top = Math.max(1, ...rows.map(row => row.sum));
    const line = row => {
      const width = row.sum ? Math.max(this.BAR_MIN, Math.round((row.sum / top) * this.PERCENT)) : 0;
      return `<button type="button" class="tf-r" data-cstage="${esc(row.stage.key)}" title="Открыть сделки на стадии"><span class="tf-l">${esc(row.stage.label)}</span><span class="tf-b"><i class="t-${CrmFunnel.tone(CrmData.funnel(), row.stage.key)}" style="width:${width}%"></i></span><b>${row.count}</b><span class="muted">${CrmFmt.short(row.sum)}</span></button>`;
    };
    const busy = rows.filter(row => row.count);
    const empty = rows.filter(row => !row.count);
    const none = busy.length ? '' : '<p class="muted tf-none">Сделок в работе нет.</p>';
    const rest = empty.length
      ? `<details class="tf-more"><summary>Стадии без сделок: ${empty.length}</summary>${empty.map(line).join('')}</details>`
      : '';
    return `<section class="md-s ts"><div class="md-h"><p class="sub">Воронка: ${esc(CrmFunnel.get(CrmData.funnel()).name)}</p><span class="muted">${deals.length} в работе</span></div>${none}${busy.map(line).join('')}${rest}</section>`;
  }
}
