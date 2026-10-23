import { Modal } from '../../core/modal.js';
import { FEAT } from '../../core/features.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc, today } from '../../core/util.js';
import { KpDate } from '../kp/kp-date.js';
import { CrmFmt } from './crm-fmt.js';
import { Cabinet } from './cabinet.js';

/** «Отложить сделку до даты»: сделка уходит с доски и «Сегодня», в нужный день программа ставит дело «вернуться к сделке». */
export class DealPause {
  static CHIPS = [
    [7, 'Через неделю'],
    [14, '2 недели'],
    [30, 'Месяц'],
    [90, '3 месяца'],
  ];
  static WEEK = 7;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Окно выбора даты и пауза.
   * @param {object} deal
   * @param {Function} after
   */
  static async ask(deal, after) {
    const chips = this.CHIPS.map(
      ([days, label]) =>
        `<button type="button" class="chip" data-v="${KpDate.addDays(today(), days)}">${label}</button>`,
    ).join('');
    const min = KpDate.addDays(today(), 1);
    const html = `<h3>Отложить сделку</h3><p><b>${esc(deal.title || deal.client || '')}</b></p>
      <p class="muted">До выбранного дня сделки нет на доске и в «Сегодня», дела «сами» не ставятся. В этот день появится дело «Вернуться к сделке».</p>
      <div class="chips">${chips}</div><label class="f"><span>Или дата</span><input type="date" min="${min}" data-pday></label>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn primary" type="button" data-pgo data-v="day">Отложить</button></div>`;
    // выбранная дата — в значение кнопки «Отложить» (окно закрывается раньше, чем его можно прочитать)
    const pick = event => {
      if (event.target.matches('[data-pday]'))
        event.target.closest('dialog').querySelector('[data-pgo]').dataset.v = event.target.value || 'day';
    };
    document.addEventListener('change', pick, true);
    const answer = await Modal.ask(html);
    document.removeEventListener('change', pick, true);
    if (!answer) return;
    if (answer === 'day') {
      Toast.show('Выберите день');
      return;
    }
    await this.set(deal, answer, after);
  }

  /**
   * Кнопка «Отложить» в шапке карточки сделки.
   * @returns {string}
   */
  static button() {
    if (!FEAT.on('dealPause')) return '';
    return '<button class="dk-ib dk-pause" type="button" data-dkpause aria-label="Отложить сделку" title="Отложить сделку до даты">⏸</button>';
  }

  /**
   * Плашка отложенной сделки в карточке.
   * @param {object} deal
   * @returns {string}
   */
  static banner(deal) {
    if (!deal.pausedUntil || deal.pausedUntil <= today()) return '';
    return `<p class="dk-paused">⏸ Отложена до <b>${esc(CrmFmt.day(deal.pausedUntil))}</b> — её нет на доске и в «Сегодня». <button type="button" class="lnk" data-dkunpause>Вернуть в работу</button></p>`;
  }

  /**
   * Кнопки карточки сделки: «⏸» — выбрать дату, «Вернуть в работу» — снять паузу.
   * @param {HTMLElement} button
   * @param {object} deal
   * @param {Function} after
   */
  static act(button, deal, after) {
    if (button.matches('[data-dkunpause]')) this.set(deal, '', after);
    else this.ask(deal, after);
  }

  /**
   * Отложить на неделю (кнопка в «Сегодня»).
   * @param {object} deal
   * @param {Function} after
   */
  static week(deal, after) {
    return this.set(deal, KpDate.addDays(today(), this.WEEK), after);
  }

  /**
   * Записать паузу ('' — снять).
   * @param {object} deal
   * @param {string} day ГГГГ-ММ-ДД
   * @param {Function} after
   */
  static async set(deal, day, after) {
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}`, {
        method: 'PUT',
        headers: this.JSON_HEAD,
        body: JSON.stringify({ pausedUntil: day }),
      });
    } catch (error) {
      Toast.show(`Не отложено: ${error.message}`);
      return;
    }
    Toast.show(day ? `Сделка отложена до ${CrmFmt.day(day)}` : 'Сделка снова в работе');
    if (after) after();
    if (document.getElementById('cabWin')?.open) Cabinet.reload();
  }
}
