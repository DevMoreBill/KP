import { DealFmt } from './deal-fmt.js';
import { KpState } from '../../core/state.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * «Что изменилось с прошлого раза» в экономике сделки: при закрытии окна запоминаются цена КП, прибыль и маржа
 * (в самом КП); при следующем открытии — строка с разницей, если цифры сдвинулись.
 */
export class DealSeen {
  static last = null; // расчёт, показанный последним
  static RUB_STEP = 1; // меньше рубля — не изменение
  static PCT_STEP = 0.05; // меньше 0,05 п. п. — не изменение
  static DATE = 10;

  /**
   * Запомнить показанный расчёт (вызывается при каждой отрисовке окна).
   * @param {object} calc
   */
  static shown(calc) {
    this.last = calc;
  }

  /**
   * Окно закрыто — цифры «на сейчас» в сделку КП.
   * @param {object} deal
   */
  static close(deal) {
    const base = this.last && this.last.base;
    if (!base) return;
    deal.seen = { S: this.last.S, P: base.P, margin: base.margin, at: new Date().toISOString() };
    KpState.persist();
  }

  /**
   * Строка «С прошлого раза …» (пусто, если менять нечего).
   * @param {object} deal
   * @param {object} calc
   * @returns {string}
   */
  static html(deal, calc) {
    const seen = deal.seen;
    const base = calc.base;
    if (!seen || !base) return '';
    const parts = [
      this._rub('цена КП', calc.S - seen.S),
      this._rub('прибыль', base.P - seen.P),
      this._pct(base.margin - seen.margin),
    ].filter(Boolean);
    if (!parts.length) return '';
    const when = String(seen.at || '')
      .slice(0, this.DATE)
      .split('-')
      .reverse()
      .join('.');
    return `<div class="dl-ex dl-seen">С прошлого раза${when ? ` (${esc(when)})` : ''}: ${parts.join(', ')}</div>`;
  }

  static _sign(value) {
    return value > 0 ? '+' : '−';
  }

  static _rub(label, diff) {
    if (!Number.isFinite(diff) || Math.abs(diff) < this.RUB_STEP) return '';
    return `${label} <b class="${diff > 0 ? 'pos' : 'neg'}">${this._sign(diff)}${Fmt.rub(Math.abs(diff))}</b>`;
  }

  static _pct(diff) {
    if (!Number.isFinite(diff) || Math.abs(diff) < this.PCT_STEP) return '';
    return `маржа <b class="${diff > 0 ? 'pos' : 'neg'}">${this._sign(diff)}${DealFmt.pct(Math.abs(diff)).replace(' %', ' п. п.')}</b>`;
  }
}
