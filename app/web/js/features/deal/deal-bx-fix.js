import { Money } from '../../core/money.js';
import { esc } from '../../core/util.js';

/**
 * Поправки статей из Битрикс24 (раздел «Экономика сделки», app/deal_econ.py): статья, изменённая в Битриксе, — платёж
 * вне графика на разницу; действует, пока статья по расчёту программы та же, что была при правке (base), — пересчитали
 * статью в программе — поправка больше не применяется. НДС поставщика внутри поправки — к вычету (кроме статей без НДС).
 */
export class DealBxFix {
  static EPS = 1;
  static NOTE = 'правка в Битрикс24';
  static KEYS = {
    equip: { label: 'Закупка оборудования', vat: true, raw: (calc, ctx) => ctx.equipSum },
    logistics: {
      label: 'Логистика',
      vat: true,
      raw: calc => calc.Lsum + calc.LruSum + calc.sumOf(sup => sup.ins),
    },
    customs: { label: 'Таможня', vat: false, raw: calc => calc.Tsum + calc.brkSum },
    assembly: { label: 'Сборка станции', vat: true, raw: (calc, ctx) => ctx.asmCost },
    mount: { label: 'Монтаж и ПНР', vat: true, raw: calc => calc.M },
    docs: { label: 'Документация', vat: true, raw: calc => calc.Dc },
    guarantee: { label: 'Банковская гарантия', vat: false, raw: calc => calc.BG },
    warranty: { label: 'Резерв на гарантию', vat: false, raw: calc => calc.W },
    bonus: { label: 'Бонусы и комиссии', vat: false, raw: calc => calc.Bn },
    other: { label: 'Прочие расходы', vat: false, raw: calc => calc.E },
  };

  /**
   * Действующие поправки расчёта: сумма, НДС к вычету в них, строки.
   * @param {object} calc расчёт сделки (статьи уже посчитаны)
   * @param {{equipSum: number, asmCost: number}} ctx
   * @returns {{sum: number, vat: number, lines: object[]}}
   */
  static of(calc, ctx) {
    const fixes = calc.d.bxFix && typeof calc.d.bxFix === 'object' ? calc.d.bxFix : {};
    const lines = Object.entries(fixes)
      .filter(([key, fix]) => this.KEYS[key] && fix && Number.isFinite(+fix.to) && Number.isFinite(+fix.base))
      .map(([key, fix]) => this._line(calc, ctx, key, fix));
    const active = lines.filter(line => line.active);
    return {
      sum: active.reduce((sum, line) => sum + line.delta, 0),
      vat: active.reduce((sum, line) => sum + line.vat, 0),
      lines,
    };
  }

  static _line(calc, ctx, key, fix) {
    const spec = this.KEYS[key];
    const raw = spec.raw(calc, ctx) || 0;
    const delta = +fix.to - +fix.base;
    const active = Math.abs(raw - +fix.base) <= this.EPS && Math.abs(delta) >= this.EPS;
    return {
      key,
      label: spec.label,
      raw,
      to: +fix.to,
      delta,
      active,
      vat: spec.vat ? calc.inSupVat(delta) : 0,
      at: fix.at,
    };
  }

  /**
   * Строки структуры затрат для действующих поправок.
   * @param {object[]} lines
   * @returns {Array<[string, number]>}
   */
  static parts(lines) {
    return lines.filter(line => line.active).map(line => [`${line.label} — ${this.NOTE}`, line.delta]);
  }

  /**
   * Блок в итоге экономики: поправки из Битрикс24 с кнопкой «Убрать».
   * @param {object[]} lines
   * @returns {string}
   */
  static html(lines) {
    const active = (lines || []).filter(line => line.active);
    if (!active.length) return '';
    const rows = active
      .map(
        line =>
          `<li>${esc(line.label)}: <b>${Money.rub(line.to)}</b> — изменено в Битрикс24 (по расчёту программы ${Money.rub(line.raw)}) <button class="btn sm" type="button" data-dlx="bxfix" data-key="${esc(line.key)}">Убрать</button></li>`,
      )
      .join('');
    return `<ul class="dl-warn dl-bx">${rows}</ul>`;
  }
}
