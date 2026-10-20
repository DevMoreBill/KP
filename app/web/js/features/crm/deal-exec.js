import { CrmFmt } from './crm-fmt.js';

/**
 * Полоса «Исполнение» в карточке сделки: точки из «Экономики сделки» КП (оплаты заказчика, поставщикам, перевозка,
 * уведомление о готовности, готовность, поставка, ПНР) — план от даты договора, факт — отметкой «✓». Дела на ближайшие
 * точки программа ставит сама.
 */
export class DealExec {
  static ICONS = { mile: '◆', cust: '₽', sup: '↗', log: '🚚', oth: '•' };
  static KINDS = { cust: 'оплата заказчика', sup: 'оплата поставщику', log: 'перевозка', oth: 'расход', mile: '' };
  static STATES = { done: 'сделано', overdue: 'просрочено', next: 'ближайшее', wait: '' };

  /**
   * Раздел или пусто (у сделки нет ни расчёта сроков, ни КП).
   * @param {object} deal ответ /api/crm/deal (exec, kps)
   * @returns {string}
   */
  static html(deal) {
    const exec = deal.exec;
    if (!exec || (!exec.has && !(deal.kps || []).length)) return '';
    return `<section class="md-s dk-exec"><div class="md-h"><p class="sub">Исполнение${exec.kp ? ` по КП № ${esc(exec.kp)}` : ''}${tip('<p>Точки после договора — из «Экономики сделки» КП: оплаты заказчика, поставщикам, перевозка, готовность, поставка. План считается от даты подписания договора.</p><p>Сделали — «✓». На ближайшие точки программа сама ставит дела ответственному; сделанное дело отмечает точку.</p>')}</p>${this._progress(exec)}</div>
      ${this._bar(exec)}${this._missing(deal)}${this._rows(exec)}</section>`;
  }

  static _progress(exec) {
    const late = exec.overdue ? ` · <span class="bad-t">просрочено ${exec.overdue}</span>` : '';
    return `<span class="muted">сделано ${exec.done} из ${exec.total}${late}</span>`;
  }

  static _bar(exec) {
    const parts = exec.steps
      .map(
        step =>
          `<i class="ex-${step.state}" title="${esc(`${step.label}: ${this.STATES[step.state] || 'впереди'}`)}"></i>`,
      )
      .join('');
    return `<div class="ex-bar" aria-hidden="true">${parts}</div>`;
  }

  static _missing(deal) {
    const exec = deal.exec;
    const tips = [];
    if (!exec.signed) {
      tips.push(`<div class="ex-ask"><span>Договор или спецификация подписаны? Отметьте дату — от неё считаются сроки оплат, готовности и поставки.</span>
        <input type="date" data-exsignday value="${today()}" aria-label="Дата договора"><button class="btn primary sm" type="button" data-exsign>Договор подписан</button></div>`);
    }
    if (!exec.has) {
      const offer = (deal.kps || [])[0];
      tips.push(
        `<div class="ex-ask"><span>В КП сделки нет расчёта сроков: откройте КП → «Экономика сделки», заполните график оплат и поставки и сохраните КП.</span>${offer ? `<button class="btn sm" type="button" data-dko="${esc(offer.id)}">Открыть КП</button>` : ''}</div>`,
      );
    }
    if (exec.has && exec.how === 'guess') {
      tips.push(
        '<p class="muted ex-note">Сроки — примерно, от ожидаемой даты сделки: точными станут после отметки «Договор подписан».</p>',
      );
    }
    return tips.join('');
  }

  static _rows(exec) {
    const rows = exec.steps.map(step => this._row(step, exec)).join('');
    return `<div class="ex-l">${rows}</div>`;
  }

  static _row(step, exec) {
    const kind = this.KINDS[step.kind] ? `<span class="muted">${this.KINDS[step.kind]}</span>` : '';
    const money = this._money(step, exec);
    return `<div class="ex-r ex-${step.state}"><span class="ex-i ex-k-${step.kind}" aria-hidden="true">${this.ICONS[step.kind] || '•'}</span>
      <div class="ex-t"><b>${esc(step.label)}</b><span>${kind}${kind && money ? ' · ' : ''}${money}</span></div>
      <span class="ex-d">${this._when(step)}</span>${this._action(step)}</div>`;
  }

  static _money(step, exec) {
    if (step.amount) return `<b class="ex-a">${esc(Money.rub(step.amount))}</b>`;
    return step.kind === 'sup' && !exec.money ? '<span class="muted">сумма — в экономике сделки</span>' : '';
  }

  static _when(step) {
    if (step.state === 'done') return '<span class="ex-ok">сделано</span>';
    if (!step.plan) return 'срок не известен';
    const day = CrmFmt.day(step.plan);
    const rel = step.state === 'overdue' ? `просрочено ${-CrmFmt.diff(step.plan)} дн.` : CrmFmt.rel(step.plan);
    const tail = rel === day ? '' : ` · ${esc(rel)}`;
    return `<span class="${step.state === 'overdue' ? 'bad-t' : ''}">план ${esc(day)}${tail}</span>`;
  }

  static _action(step) {
    if (step.state === 'done') {
      return `<span class="ex-act"><input type="date" class="ex-fact" data-exday="${esc(step.key)}" value="${esc(step.fact)}" aria-label="Когда сделано" title="Когда сделано — можно исправить"><button class="icon sm" type="button" data-exundo="${esc(step.key)}" aria-label="Снять отметку" title="Снять отметку">↺</button></span>`;
    }
    return `<button class="btn sm${step.state === 'next' || step.state === 'overdue' ? ' primary' : ''}" type="button" data-exmark="${esc(step.key)}" title="Отметить сделанным сегодня">✓ Сделано</button>`;
  }

  /**
   * Щелчок в разделе: отметка, снятие отметки, «Договор подписан». → тело запроса или null.
   * @param {Event} event
   * @returns {{key: string, at: string}|null}
   */
  static click(event) {
    const target = event.target;
    const mark = target.closest('[data-exmark]');
    if (mark) return { key: mark.dataset.exmark, at: today() };
    const undo = target.closest('[data-exundo]');
    if (undo) return { key: undo.dataset.exundo, at: '' };
    if (!target.closest('[data-exsign]')) return null;
    const day = target.closest('.dk-exec').querySelector('[data-exsignday]');
    return { key: 'sign', at: (day && day.value) || today() };
  }

  /**
   * Изменена дата «когда сделано». → тело запроса или null.
   * @param {Event} event
   * @returns {{key: string, at: string}|null}
   */
  static change(event) {
    const input = event.target.closest('[data-exday]');
    if (!input || !input.value) return null;
    return { key: input.dataset.exday, at: input.value };
  }
}
