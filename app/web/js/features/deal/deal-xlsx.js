import { DealCalculator } from './deal-calculator.js';
import { DealState } from './deal-state.js';
import { DealXlsxCalc } from './deal-xlsx-calc.js';
import { DealXlsxGraph, DealXlsxResult } from './deal-xlsx-graph.js';
import { DealXlsxSummary } from './deal-xlsx-summary.js';

/**
 * Выгрузка «Экономики сделки» в Excel для согласования: «Сводка» — одна страница для коммерческого директора, «Расчёт» —
 * исходные данные и формулы, «График платежей» — деньги по дням. Тендерное КП — номер закупки в заголовках и имени файла.
 */
export class DealXlsx {
  static NAMES = { summary: 'Сводка', calc: 'Расчёт', graph: 'График платежей' };
  static BAD_FORMULA = /undefined|NaN|null|Infinity/;
  static SAFE_LEN = 60;

  /** Скачать файл. */
  static async save() {
    const { blob, tender } = await DealXlsx._build();
    const safe = text =>
      String(text || '')
        .replace(/[\\/:*?"<>|«»]+/g, '')
        .replace(/\s+/g, '_')
        .slice(0, DealXlsx.SAFE_LEN);
    const name = `${tender ? `${safe(tender)}_` : ''}Экономика_КП_${safe(S.number || 'черновик')}${S.client ? `_${safe(S.client)}` : ''}.xlsx`;
    saveFileA(name, blob);
    toast('Расчёт выгружен в Excel');
  }

  /**
   * Файл без скачивания — для сделки в Битрикс24.
   * @returns {Promise<Blob>}
   */
  static async blob() {
    return (await DealXlsx._build()).blob;
  }

  static async _build() {
    const deal = DealState.deal();
    const kpData = DealState.inputs();
    const calc = DealCalculator.calc(kpData, deal);
    const res = calc.base || calc.lo;
    const today = new Date().toLocaleDateString('ru-RU');
    const tender = typeof tenderNo === 'function' ? tenderNo() : '';
    const kpTitle = `${S.number ? `КП № ${S.number}` : 'КП без номера'}${S.date ? ` от ${KPGen.ruDate(S.date)}` : ''}${tender ? ` · закупка (тендер) № ${tender}` : ''}`;
    const ctx = { calc, deal, kpData, res, unknown: calc.unknown.length > 0, kpTitle };
    const sheet = new DealXlsxCalc(ctx);
    sheet.build();
    const graph = new DealXlsxGraph(sheet, DealXlsx.NAMES);
    graph.head();
    new DealXlsxResult(sheet, graph).build();
    graph.body();
    const summary = new DealXlsxSummary({ ...ctx, today, who: (S.manager && S.manager.name) || '', xOn: sheet.xOn });
    summary.build();
    DealXlsx._clean([sheet.rows, graph.rows, summary.rows]);
    const footer = `${kpTitle} · расчёт от ${today}`;
    const blob = await makeXlsx(DealXlsx._sheets({ summary, sheet, graph, footer }), 'Экономика сделки');
    return { blob, tender };
  }

  // страховка от #ИМЯ?: формула со ссылкой на несуществующую строку заменяется посчитанным значением
  static _clean(sheets) {
    let bad = 0;
    for (const cell of sheets.flat().flatMap(row => row || [])) {
      if (!(cell && typeof cell === 'object' && cell.f && DealXlsx.BAD_FORMULA.test(cell.f))) continue;
      delete cell.f;
      bad++;
    }
    if (bad) console.warn('Excel: формул заменено значениями —', bad);
  }

  static _sheets({ summary, sheet, graph, footer }) {
    const names = DealXlsx.NAMES;
    return [
      {
        name: names.summary,
        cols: [4, 33, 8, 13, 14, 14, 12, 9],
        rows: summary.rows,
        merges: summary.merges,
        heights: summary.heights,
        grid: false,
        footer,
        onePage: true,
      },
      { name: names.calc, cols: [46, 18, 14, 18, 52], rows: sheet.rows, freeze: 4, titles: '4:4', footer },
      {
        name: names.graph,
        cols: [8, 12, 48, 17, 17, 13, 17],
        rows: graph.rows,
        merges: graph.merges,
        heights: graph.heights,
        freeze: 4,
        titles: '4:4',
        footer,
        landscape: true,
      },
    ];
  }
}
