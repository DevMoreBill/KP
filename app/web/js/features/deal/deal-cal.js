import { DealState } from './deal-state.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { esc } from '../../core/util.js';
import { SidePanel } from '../../ui/side-panel.js';
import { Api } from '../../core/net.js';

/**
 * Производственный календарь (/api/calendar: '1' — нерабочий день) и дни сделки: день 0 — дата договора, рабочие дни,
 * дата дня от начала сделки.
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
   * Загрузить недостающие годы календаря; после загрузки окно и правая панель перерисовываются.
   * @param {string} iso
   */
  static load(iso) {
    const need = DealCal.years(iso).filter(year => !DealUi.cal[year] && !DealUi.calLoading[year]);
    for (const year of need) {
      DealUi.calLoading[year] = true;
      Api.request(`/api/calendar?year=${year}`)
        .then(res => {
          if (res && res.days) DealUi.cal[year] = res;
        })
        .catch(() => {})
        .finally(() => {
          delete DealUi.calLoading[year];
          DealWin.render();
          SidePanel.render();
        });
    }
  }

  static _date(startIso, day) {
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
    const date = DealCal._date(startIso, day);
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
   * Помощники календаря для DealTerms.addDays (без календаря — пусто).
   * @returns {object}
   */
  static fns() {
    const start = DealCal.contractDate();
    return start && DealCal.ready(start) ? { addWork: DealCal.addWorkFn(start) } : {};
  }

  /**
   * Рабочих дней между днями; без календаря — приблизительно.
   * @param {number} base
   * @param {number} target
   * @returns {number}
   */
  static countWork(base, target) {
    if (!(target > base)) return 0;
    const start = DealCal.contractDate();
    if (!(start && DealCal.ready(start))) return Math.round(((target - base) * DealCal.WORK_WEEK) / DealCal.WEEK);
    let count = 0;
    for (let day = base + 1; day <= target; day++) if (!DealCal.off(start, day)) count++;
    return count;
  }

  /**
   * Дата договора (день 0) или пусто.
   * @returns {string}
   */
  static contractDate() {
    const value = String((DealState.deal() || {}).start || '');
    return DealCal.ISO.test(value) ? value : '';
  }

  /**
   * Дата дня сделки: «2026-10-20».
   * @param {number} day
   * @returns {string}
   */
  static dayIso(day) {
    const start = DealCal.contractDate();
    if (!start) return '';
    return DealCal._date(start, day).toISOString().slice(0, 10);
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
   * Дата дня сделки по-русски.
   * @param {number} day
   * @returns {string}
   */
  static dayRu(day) {
    return DealCal.isoRu(DealCal.dayIso(day));
  }

  /**
   * День сделки по дате.
   * @param {string} iso
   * @returns {number|null}
   */
  static isoDay(iso) {
    const start = DealCal.contractDate();
    if (!start || !iso) return null;
    return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DealCal.DAY_MS);
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

  /**
   * День недели дня сделки: «пн».
   * @param {number} day
   * @returns {string}
   */
  static weekday(day) {
    const iso = DealCal.dayIso(day);
    return iso ? DealCal.WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] : '';
  }
}
