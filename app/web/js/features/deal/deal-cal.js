import { DealUi } from './deal-ui.js';
import { esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { KpForm } from '../../core/kp-form.js';
import { DealLink } from '../../core/deal-link.js';

/**
 * Производственный календарь (/api/calendar: '1' — нерабочий день): годы от даты договора, нерабочие и рабочие дни.
 */
export class DealCal {
  static WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  static ISO = /^\d{4}-\d{2}-\d{2}$/;
  static DAY_MS = 864e5;
  static MAX_STEPS = 5000;
  static WEEK = 7;
  static WORK_WEEK = 5;
  static YEARS = 2;

  /**
   * Годы календаря от даты договора: этот и два следующих.
   * @param {string} iso
   * @returns {number[]}
   */
  static years(iso) {
    const year = +String(iso || '').slice(0, 4);
    return year ? Array.from({ length: DealCal.YEARS + 1 }, (_, i) => year + i) : [];
  }

  /**
   * Загрузить недостающие годы календаря; после загрузки окно и правая панель перерисовываются. Год запрашивается один раз:
   * не отдал сервер — расчёт без календаря (как до загрузки), иначе перерисовка запрашивала бы его снова без конца.
   * @param {string} iso
   */
  static load(iso) {
    const need = DealCal.years(iso).filter(year => !DealUi.cal[year] && !DealUi.calAsked[year]);
    for (const year of need) {
      DealUi.calAsked[year] = true;
      Api.request(`/api/calendar?year=${year}`)
        .then(res => {
          if (!(res && res.days)) return;
          DealUi.cal[year] = res;
          DealLink.render();
          KpForm.renderSide();
        })
        .catch(error => console.warn(`Производственный календарь ${year} не загружен:`, error));
    }
  }

  /**
   * Дата дня сделки от даты договора.
   * @param {string} startIso
   * @param {number} day
   * @returns {Date}
   */
  static date(startIso, day) {
    const [year, month, date] = startIso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date + (+day || 0)));
  }

  /**
   * День сделки — нерабочий.
   * @param {string} startIso
   * @param {number} day
   * @returns {boolean}
   */
  static off(startIso, day) {
    if (!startIso) return false;
    const date = DealCal.date(startIso, day);
    const year = date.getUTCFullYear();
    const cal = DealUi.cal[year];
    if (!cal) return false;
    const doy = Math.round((date - Date.UTC(year, 0, 1)) / DealCal.DAY_MS);
    return cal.days[doy] === '1';
  }

  /**
   * Календарь загружен.
   * @param {string} iso
   * @returns {boolean}
   */
  static ready(iso) {
    return DealCal.years(iso).every(year => DealUi.cal[year]);
  }

  /**
   * Рабочие дни по календарю от даты договора.
   * @param {string} startIso
   * @returns {Function} (день, число рабочих дней) → день
   */
  static addWorkFn(startIso) {
    return (base, days) => {
      let day = base;
      let count = 0;
      let guard = 0;
      while (count < days && guard++ < DealCal.MAX_STEPS) {
        day++;
        if (!DealCal.off(startIso, day)) count++;
      }
      return day;
    };
  }

  /**
   * «2026-10-20» → «20.10.2026».
   * @param {string} iso
   * @returns {string}
   */
  static isoRu(iso) {
    return iso ? iso.split('-').reverse().join('.') : '';
  }

  /**
   * Пояснение о календаре в шапке.
   * @param {string} start
   * @returns {string}
   */
  static note(start) {
    const years = DealCal.years(start);
    const cals = years.map(year => DealUi.cal[year]).filter(Boolean);
    if (cals.length < years.length) return '<span class="muted">Загружаю производственный календарь…</span>';
    const approx = cals.some(cal => cal.approx);
    const tail = approx ? '. Праздники с переносами учтены не полностью.' : '';
    return `<span class="muted${approx ? ' warn-t' : ''}">Даты платежей — только рабочие (банковские) дни: ${esc(cals[0].src)}${tail}</span>`;
  }
}
