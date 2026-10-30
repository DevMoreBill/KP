import { StationEquip } from '../layout/station-equip.js';

/**
 * Насос в рабочей точке по паспорту. Подача и напор числом — номинальная точка; диапазоном — крайние точки кривой Q–H:
 * наибольшая подача — при наименьшем напоре, наибольший напор — при наименьшей подаче (подача растёт — напор падает).
 * Кривой в каталоге нет: точку между крайними не угадываем — «уточните рабочую точку».
 */
export class PumpPoint {
  static FITS = 'ok';
  static SHORT = 'short'; // напора не хватает при любой подаче
  static OVER = 'over'; // подача на насос больше наибольшей по паспорту
  static CHECK = 'check'; // между крайними точками — по кривой Q–H
  static EPS = 1e-9;

  /**
   * Подача и напор карточки: {flow, head} — границы {lo, hi, range} или null.
   * @param {object} attrs
   * @returns {{flow: object|null, head: object|null}}
   */
  static of(attrs) {
    return { flow: StationEquip.span((attrs || {}).flow), head: StationEquip.span((attrs || {}).head) };
  }

  /**
   * Заданы ли подача или напор диапазоном.
   * @param {object} attrs
   * @returns {boolean}
   */
  static ranged(attrs) {
    const { flow, head } = this.of(attrs);
    return Boolean((flow && flow.range) || (head && head.range));
  }

  /**
   * Обеспечит ли насос напор need при подаче на насос share (с погрешностью данных tol): FITS, SHORT, OVER или CHECK;
   * напор не указан — null. OVER — подача больше наибольшей по диапазону паспорта (за номинальной — CHECK).
   * @param {object} attrs
   * @param {number} share подача на насос, м³/ч
   * @param {number} need требуемый напор, м
   * @param {number} tol доля (calc.tolerance)
   * @returns {string|null}
   */
  static verdict(attrs, share, need, tol) {
    const { flow, head } = this.of(attrs);
    if (!head) return null;
    const fits = have => have != null && have >= need * (1 - tol) - this.EPS;
    if (!fits(head.hi)) return this.SHORT;
    if (flow && flow.range && share > flow.hi * (1 + tol) + this.EPS) return this.OVER;
    return fits(this.sure(attrs, share)) ? this.FITS : this.CHECK;
  }

  /**
   * Напор, который насос даёт наверняка при подаче share (null — не известен): при наименьшей подаче диапазона и меньше —
   * наибольший; до наибольшей (номинальной) — наименьший напор диапазона или напор числом, если подача — числом или не
   * указана; напор числом при подаче диапазоном — только при наименьшей подаче; за наибольшей подачей — не известен.
   * @param {object} attrs
   * @param {number} share подача на насос, м³/ч
   * @returns {number|null}
   */
  static sure(attrs, share) {
    const { flow, head } = this.of(attrs);
    if (!head || (flow && share > flow.hi + this.EPS)) return null;
    if (flow && flow.range && flow.lo != null && share <= flow.lo + this.EPS) return head.hi;
    if (head.range) return head.lo;
    return flow && flow.range ? null : head.hi;
  }

  /**
   * Подача на насос меньше наименьшей по диапазону паспорта — работа вне рабочей части кривой.
   * @param {object} attrs
   * @param {number} share подача на насос, м³/ч
   * @param {number} tol доля (calc.tolerance)
   * @returns {boolean}
   */
  static under(attrs, share, tol) {
    const { flow } = this.of(attrs);
    return Boolean(flow && flow.range && flow.lo != null && share < flow.lo * (1 - tol) - this.EPS);
  }

  /**
   * Подпись паспорта: «50–20 м при 8–40 м³/ч» (крайние точки) или «32 м при 40 м³/ч».
   * @param {object} attrs
   * @param {function(number): string} fmt число для текста
   * @returns {string}
   */
  static text(attrs, fmt) {
    const { flow, head } = this.of(attrs);
    const bounds = (span, order) => {
      if (!span) return '';
      if (span.lo == null) return `до ${fmt(span.hi)}`;
      if (span.lo === span.hi) return fmt(span.hi);
      return order.map(key => fmt(span[key])).join('–');
    };
    const headText = head ? `${bounds(head, ['hi', 'lo'])} м` : 'напор не указан';
    if (!flow) return headText;
    return `${headText} при ${flow.lo == null ? 'подаче ' : ''}${bounds(flow, ['lo', 'hi'])} м³/ч`;
  }
}
