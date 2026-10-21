import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { Money } from '../../core/money.js';
import { esc, today } from '../../core/util.js';

/** Сводка сделки плитками: сумма, оплата заказчика, что дальше, поставка — с первого взгляда, без прокрутки. */
export class DealSummary {
  static PERCENT = 100;

  /**
   * Плитки.
   * @param {object} deal ответ /api/crm/deal
   * @returns {string}
   */
  static html(deal) {
    return `<div class="dk-sum">${[this._sum(deal), this._paid(deal), this._next(deal), this._supply(deal)].join('')}</div>`;
  }

  static _tile({ label, value, note = '', tone = '', bar = null }) {
    const line = bar === null ? '' : `<i class="dk-tb"><i style="width:${Math.round(bar)}%"></i></i>`;
    return `<div class="dk-t${tone ? ` ${tone}` : ''}"><span>${label}</span><b>${value}</b>${line}${note ? `<small>${note}</small>` : ''}</div>`;
  }

  static _sum(deal) {
    const offer = (deal.kps || []).find(row => row.status !== 'lost');
    const byKp = offer ? `по КП № ${esc(offer.number)}` : 'КП ещё нет';
    const note = deal.sumOwn ? 'своя сумма' : byKp;
    return this._tile({ label: 'Сумма сделки', value: CrmFmt.rub(deal.sum), note });
  }

  static _paid(deal) {
    const exec = deal.exec || {};
    if (!exec.toPay)
      return this._tile({ label: 'Оплата заказчика', value: '—', note: 'график — в экономике сделки КП' });
    const share = Math.min(this.PERCENT, (exec.paid / exec.toPay) * this.PERCENT);
    const tone = exec.paid >= exec.toPay ? 'ok' : '';
    return this._tile({
      label: 'Оплачено заказчиком',
      value: esc(Money.rub(exec.paid)),
      note: `из ${esc(Money.rub(exec.toPay))}`,
      tone,
      bar: share,
    });
  }

  static _next(deal) {
    const step = (deal.exec || {}).signed ? deal.exec.next : null;
    const task = (deal.tasks || [])
      .filter(row => row.state === 'open')
      .sort((one, two) => String(one.due).localeCompare(String(two.due)))[0];
    if (step) {
      const late = step.state === 'overdue';
      return this._tile({
        label: 'Что дальше',
        value: esc(step.label),
        note: `план ${esc(CrmFmt.day(step.plan))}${late ? ' — просрочено' : ''}`,
        tone: late ? 'bad' : '',
      });
    }
    if (task) {
      const late = task.due < today();
      return this._tile({
        label: 'Следующий шаг',
        value: esc(task.title),
        note: esc(CrmFmt.rel(task.due)),
        tone: late ? 'bad' : '',
      });
    }
    if (CrmFunnel.closed(deal)) return this._tile({ label: 'Следующий шаг', value: 'Сделка закрыта' });
    return this._tile({ label: 'Следующий шаг', value: 'не запланирован', note: 'добавьте дело справа', tone: 'warn' });
  }

  static _supply(deal) {
    const ship = ((deal.exec || {}).steps || []).find(step => step.key === 'delivery');
    if (ship && ship.state === 'done')
      return this._tile({ label: 'Поставка', value: `✓ ${esc(CrmFmt.day(ship.fact))}`, tone: 'ok' });
    if (ship && ship.plan) {
      const how = deal.exec.how === 'fact' ? 'по договору' : 'примерно';
      return this._tile({
        label: 'Поставка',
        value: esc(CrmFmt.day(ship.plan)),
        note: how,
        tone: ship.state === 'overdue' ? 'bad' : '',
      });
    }
    return this._expected(deal);
  }

  static _expected(deal) {
    const late = deal.expected && deal.expected < today() && !CrmFunnel.closed(deal);
    return this._tile({
      label: 'Ожидаемая дата',
      value: deal.expected ? esc(CrmFmt.day(deal.expected)) : '—',
      note: late ? 'прошла — обновите' : 'когда ждём договор',
      tone: late ? 'bad' : '',
    });
  }
}
