import { S } from './state.js';

/** Условие КП подстановкой (срок поставки, оплата из экономики сделки, срок позиций каталога). */
export class CondAuto {
  /**
   * Условие — подстановкой: пока поле пустое или в нём прежняя подстановка; вписанное вручную не меняется.
   * @param {string} label
   * @param {string} value
   * @returns {boolean} изменилось
   */
  static apply(label, value) {
    S.condAuto = S.condAuto || {};
    let cond = S.conditions.find(row => row.label === label);
    if (!cond) {
      if (!value) return false;
      cond = { label, value: '' };
      S.conditions.push(cond);
    }
    const now = String(cond.value || '').trim();
    const prev = S.condAuto[label];
    if (now && !(prev != null && now === prev)) return false;
    const changed = cond.value !== value;
    if (changed) cond.value = value;
    if (value) S.condAuto[label] = value;
    else delete S.condAuto[label];
    return changed;
  }
}
