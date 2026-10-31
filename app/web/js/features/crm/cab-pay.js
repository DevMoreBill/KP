import { CrmData } from './crm-data.js';
import { FEAT } from '../../core/features.js';
import { Money } from '../../core/money.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { CabState } from './cab-state.js';

/**
 * «Сделки → ₽ Оплаты»: платёжный календарь по плану исполнения сделок — когда ждём оплаты клиентов и когда платим
 * поставщикам (суммы поставщикам — тем, кому открыта экономика); сверху — просроченные оплаты клиентов с «Напомнить».
 */
export class CabPay {
  static MONTHS = [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ];
  static data = null;
  static who = null;
  static loading = false;
  static error = '';

  /**
   * Вид в «Сделках».
   * @returns {string}
   */
  static html() {
    if (this.who !== CrmData.who) this._load();
    if (!this.data) return `<p class="muted">${esc(this.error || 'Загружаю оплаты…')}</p>`;
    const rows = this.data.rows.filter(row => CabState.match({ title: row.title, client: row.client }));
    if (!rows.length)
      return '<p class="msg">Оплат по плану нет: они появляются из «Экономики сделки» КП (график платежей), когда сделка в работе.</p>';
    return `${this._overdue()}${this._months(rows)}`;
  }

  static async _load() {
    if (this.loading) return;
    this.loading = true;
    this.who = CrmData.who;
    try {
      this.data = await Api.request(`/api/crm/pay?manager=${encodeURIComponent(CrmData.who)}`);
      this.error = '';
    } catch (error) {
      this.data = null;
      this.error = `Оплаты не загрузились: ${error.message || error}`;
    }
    this.loading = false;
    if (CabState.tab === 'deals') CabState.renderBody();
  }

  /** Перечитать (после отметки оплаты, напоминания). */
  static reset() {
    this.who = null;
    this.data = null;
  }

  static _overdue() {
    const late = (this.data.overdue || []).filter(() => FEAT.on('receivables'));
    if (!late.length) return '';
    const total = late.reduce((sum, row) => sum + (row.amount || 0), 0);
    const rows = late
      .map(
        row => `<div class="pay-r late"><span class="pay-d">${esc(CrmFmt.day(row.plan))}</span><span class="pay-k in">↓</span><button class="pay-t" type="button" data-deal="${esc(row.deal)}">${esc(row.title)}</button>
        <span class="muted">${esc(row.label)}</span><b class="pay-s">${row.amount ? Money.rub(row.amount) : ''}</b>
        <button class="btn sm" type="button" data-premind="${esc(row.deal)}" data-pkey="${esc(row.key)}" title="Звонок сегодня: напомнить клиенту об оплате">☎ Напомнить</button></div>`,
      )
      .join('');
    return `<section class="pay-late"><p class="sub">Просрочены оплаты клиентов · ${late.length}${total ? ` · ${Money.rub(total)}` : ''}</p>${rows}</section>`;
  }

  static _months(rows) {
    const groups = new Map();
    for (const row of rows) {
      const month = row.plan.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(row);
    }
    return [...groups].map(([month, list]) => this._month(month, list)).join('');
  }

  static _month(month, list) {
    const sum = dir => list.filter(row => row.dir === dir && row.amount).reduce((total, row) => total + row.amount, 0);
    const income = sum('in');
    const spend = sum('out');
    const [year, number] = month.split('-');
    const head = `${this.MONTHS[+number - 1]} ${year}`;
    const totals = `<span class="pay-in">↓ ${Money.rub(income)}</span>${spend ? ` <span class="pay-out">↑ ${Money.rub(spend)}</span>` : ''}`;
    return `<section class="pay-m"><p class="sub">${esc(head)} · ${totals}</p>${list.map(row => this._row(row)).join('')}</section>`;
  }

  static _row(row) {
    const sign = row.dir === 'in' ? '↓' : '↑';
    const state = { done: ' done', overdue: ' late' }[row.state] || '';
    const when = row.state === 'done' ? `✓ ${CrmFmt.day(row.fact)}` : CrmFmt.day(row.plan) + (row.approx ? ' ≈' : '');
    return `<div class="pay-r${state}"><span class="pay-d" title="${row.approx ? 'Примерно: договор ещё не подписан' : ''}">${esc(when)}</span>
      <span class="pay-k ${row.dir}" aria-label="${row.dir === 'in' ? 'оплата клиента' : 'платёж поставщику'}">${sign}</span>
      <button class="pay-t" type="button" data-deal="${esc(row.deal)}">${esc(row.title)}</button><span class="muted">${esc(row.label)}</span>
      <b class="pay-s">${row.amount ? Money.rub(row.amount) : '—'}</b></div>`;
  }

  /**
   * Щелчок «Напомнить» (сделка открывается общим обработчиком кабинета по data-deal). true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const remind = event.target.closest('[data-premind]');
    if (!remind) return false;
    this._remind(remind);
    return true;
  }

  static async _remind(button) {
    button.disabled = true;
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(button.dataset.premind)}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ key: button.dataset.pkey }),
      });
      Toast.show('Звонок «Напомнить об оплате» — на сегодня');
      button.textContent = '✓ В делах';
    } catch (error) {
      button.disabled = false;
      Toast.show(error.message || String(error));
    }
  }
}
