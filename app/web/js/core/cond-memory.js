import { S } from './state.js';
import { KpConditions } from './conditions.js';

/** Условия прошлых КП в этом браузере: для «Как в прошлом КП» и свои значения — для списка ▾. */
export class CondMemory {
  static RECENT_KEY = 'kp.condRecent';
  static LAST_KEY = 'kp.lastConds';
  static RECENT = 5;

  /**
   * Свои значения условий из прошлых КП: {название: [значения]}.
   * @returns {object}
   */
  static recent() {
    try {
      return JSON.parse(localStorage.getItem(this.RECENT_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  /**
   * Условия последнего сохранённого КП.
   * @returns {{conditions: object[], condExtra: string}|null}
   */
  static last() {
    try {
      return JSON.parse(localStorage.getItem(this.LAST_KEY) || 'null');
    } catch {
      return null;
    }
  }

  /** Запомнить условия сохранённого КП. */
  static remember() {
    try {
      const conditions = S.conditions.map(cond => ({ label: cond.label, value: cond.value }));
      localStorage.setItem(this.LAST_KEY, JSON.stringify({ conditions, condExtra: S.condExtra || '' }));
      const recent = this.recent();
      S.conditions.forEach(cond => {
        const value = String(cond.value || '').trim();
        if (!value || KpConditions.options(cond.label).includes(value)) return;
        recent[cond.label] = [value, ...(recent[cond.label] || []).filter(old => old !== value)].slice(0, this.RECENT);
      });
      localStorage.setItem(this.RECENT_KEY, JSON.stringify(recent));
    } catch {
      // хранилище недоступно — не запоминаем
    }
  }
}
