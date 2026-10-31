import { DealCal } from './deal-cal.js';
import { DealState } from './deal-state.js';

/** Дни сделки: день 0 — дата договора, дата дня и день по дате, рабочие дни между днями. */
export class DealDays {
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
    const start = DealDays.contractDate();
    if (!start) return '';
    return DealCal.date(start, day).toISOString().slice(0, 10);
  }

  /**
   * Дата дня сделки по-русски.
   * @param {number} day
   * @returns {string}
   */
  static dayRu(day) {
    return DealCal.isoRu(DealDays.dayIso(day));
  }

  /**
   * День сделки по дате.
   * @param {string} iso
   * @returns {number|null}
   */
  static isoDay(iso) {
    const start = DealDays.contractDate();
    if (!start || !iso) return null;
    return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DealCal.DAY_MS);
  }

  /**
   * День недели дня сделки: «пн».
   * @param {number} day
   * @returns {string}
   */
  static weekday(day) {
    const iso = DealDays.dayIso(day);
    return iso ? DealCal.WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] : '';
  }

  /**
   * Рабочих дней между днями; без календаря — приблизительно.
   * @param {number} base
   * @param {number} target
   * @returns {number}
   */
  static countWork(base, target) {
    if (!(target > base)) return 0;
    const start = DealDays.contractDate();
    if (!(start && DealCal.ready(start))) return Math.round(((target - base) * DealCal.WORK_WEEK) / DealCal.WEEK);
    let count = 0;
    for (let day = base + 1; day <= target; day++) if (!DealCal.off(start, day)) count++;
    return count;
  }

  /**
   * Помощники календаря для DealTerms.addDays (без календаря — пусто).
   * @returns {object}
   */
  static fns() {
    const start = DealDays.contractDate();
    return start && DealCal.ready(start) ? { addWork: DealCal.addWorkFn(start) } : {};
  }
}
