import { Money } from '../../core/money.js';
import { esc } from '../../core/util.js';

/**
 * Поправки статей из Битрикс24 (раздел «Экономика сделки», app/deal_econ.py): статья, изменённая в Битриксе, — платёж
 * вне графика на разницу; действует, пока статья по расчёту программы та же, что была при правке (base), — пересчитали
 * статью в программе — поправка больше не применяется. НДС к вычету внутри поправки — в той же доле, что в статье по расчёту
 * (таможня — ввозной НДС и брокер, логистика — услуги в России без страхования, закупка — НДС российских поставщиков).
 */
export class DealBxFix {
  static EPS = 1;
  static NOTE = 'правка в Битрикс24';
  // vat — НДС к вычету внутри статьи по расчёту программы (нет — статья без НДС); empty — доля, если статьи в расчёте нет
  // (по умолчанию — ставка поставщика: таможня без расчёта — без вычета, как раньше)
  static KEYS = {
    equip: {
      label: 'Закупка оборудования',
      raw: (calc, ctx) => ctx.equipSum,
      vat: calc => calc.sumOf(sup => sup.vo),
    },
    logistics: {
      label: 'Логистика',
      raw: calc => calc.Lsum + calc.LruSum + calc.sumOf(sup => sup.ins),
      vat: calc => calc.inSupVat(calc.sumOf(sup => sup.Lru - (sup.LruIns || 0))),
    },
    customs: {
      label: 'Таможня',
      raw: calc => calc.Tsum + calc.brkSum,
      vat: calc => calc.sumOf(sup => sup.vi || 0) + calc.inSupVat(calc.brkSum),
      empty: 0,
    },
    assembly: {
      label: 'Сборка станции',
      raw: (calc, ctx) => ctx.asmCost,
      vat: (calc, ctx) => calc.inSupVat(ctx.asmCost),
    },
    mount: { label: 'Монтаж и ПНР', raw: calc => calc.M, vat: calc => calc.inSupVat(calc.M) },
    docs: { label: 'Документация', raw: calc => calc.Dc, vat: calc => calc.inSupVat(calc.Dc) },
    guarantee: { label: 'Банковская гарантия', raw: calc => calc.BG },
    warranty: { label: 'Резерв на гарантию', raw: calc => calc.W },
    bonus: { label: 'Бонусы и комиссии', raw: calc => calc.Bn },
    other: { label: 'Прочие расходы', raw: calc => calc.E },
  };

  /**
   * Действующие поправки расчёта: сумма, НДС к вычету в них, строки.
   * @param {object} calc расчёт сделки (статьи уже посчитаны)
   * @param {{equipSum: number, asmCost: number}} ctx
   * @returns {{sum: number, vat: number, lines: object[]}}
   */
  static of(calc, ctx) {
    const fixes = calc.d.bxFix && typeof calc.d.bxFix === 'object' ? calc.d.bxFix : {};
    const share = this.shares(calc, ctx);
    const lines = Object.entries(fixes)
      .filter(([key, fix]) => this.KEYS[key] && fix && Number.isFinite(+fix.to) && Number.isFinite(+fix.base))
      .map(([key, fix]) => this._line(calc, ctx, key, fix, share[key]));
    const active = lines.filter(line => line.active);
    return {
      sum: active.reduce((sum, line) => sum + line.delta, 0),
      vat: active.reduce((sum, line) => sum + line.vat, 0),
      lines,
      share,
    };
  }

  /**
   * Доля НДС к вычету в каждой статье по расчёту (для поправки на сервере — deal_econ.EconShift); статья 0 — доля
   * ставки поставщика у статей с НДС, иначе 0; продавец без вычета (УСН 5–7 %, «без НДС») — 0 у всех.
   * @param {object} calc
   * @param {{equipSum: number, asmCost: number}} ctx
   * @returns {Object<string, number>}
   */
  static shares(calc, ctx) {
    const rate = calc.inSupVat(1);
    return Object.fromEntries(
      Object.entries(this.KEYS).map(([key, spec]) => {
        if (!spec.vat || calc.deduct === false) return [key, 0];
        const raw = spec.raw(calc, ctx) || 0;
        if (raw > this.EPS) return [key, Math.min(1, Math.max(0, spec.vat(calc, ctx) / raw))];
        return [key, spec.empty ?? rate];
      }),
    );
  }

  static _line(calc, ctx, key, fix, share) {
    const spec = this.KEYS[key];
    const raw = spec.raw(calc, ctx) || 0;
    const delta = +fix.to - +fix.base;
    const active = Math.abs(raw - +fix.base) <= this.EPS && Math.abs(delta) >= this.EPS;
    return { key, label: spec.label, raw, to: +fix.to, delta, active, vat: delta * share, at: fix.at };
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
