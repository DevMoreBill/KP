import { DealCalculator } from './deal-calculator.js';
import { DealDefaults } from './deal-defaults.js';
import { DealFmt } from './deal-fmt.js';
import { DealUi } from './deal-ui.js';
import { DealXlsxCalc } from './deal-xlsx-calc.js';
import { DealXlsxSummaryTables } from './deal-xlsx-tables.js';
import { InputNum } from './input-num.js';

/**
 * Лист Excel «Сводка» — одна страница для коммерческого директора: ключевые показатели и вывод, позиции, структура
 * себестоимости, поставщики, оплата заказчика, деньги и налоги, замечания, подписи. Значения — на момент выгрузки.
 */
export class DealXlsxSummary {
  static COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  static PAIRS = ['A:B', 'C:D', 'E:F', 'G:H'];
  static GOAL = { margin: 'маржинальность', markup: 'наценка', profit: 'прибыль до налога', net: 'чистая прибыль' };
  static RUB_GOALS = ['profit', 'net'];
  static LINE = 92;
  static LINE_H = 15;
  static PAD_H = 4;
  static HEIGHT = { blank: 6, sec: 22, title: 24, tileHead: 16, tile: 22, tileRange: 30, gap: 14, sign: 28 };

  /**
   * @param {object} ctx { calc, deal, kpData, res, unknown, kpTitle, today, who, xOn }
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.rows = [];
    this.merges = [];
    this.heights = {};
  }

  /**
   * Строка листа; h — высота строки.
   * @param {Array} cells
   * @param {number} [height]
   * @returns {number}
   */
  put(cells, height) {
    this.rows.push(cells);
    if (height) this.heights[this.rows.length] = height;
    return this.rows.length;
  }

  /**
   * Объединить ячейки строки.
   * @param {number} row
   * @param {string} from
   * @param {string} to
   */
  merge(row, from, target) {
    this.merges.push(`${from}${row}:${target}${row}`);
  }

  /** Пустая строка-отступ. */
  blank() {
    this.put([], DealXlsxSummary.HEIGHT.blank);
  }

  /**
   * Заголовок раздела.
   * @param {string} title
   */
  section(title) {
    const row = this.put(
      DealXlsxSummary.COLS.map((col, k) => ({ v: k ? '' : title, s: 'sec' })),
      DealXlsxSummary.HEIGHT.sec,
    );
    this.merge(row, 'A', 'H');
  }

  /** Весь лист. */
  build() {
    let row = this.put([{ v: 'Экономика сделки — на согласование', s: 'title' }], DealXlsxSummary.HEIGHT.title);
    this.merge(row, 'A', 'H');
    const sub = [
      this.kpTitle,
      S.client ? `заказчик: ${S.client}` : '',
      this.who ? `менеджер: ${this.who}` : '',
      `расчёт от ${this.today}`,
    ];
    row = this.put([{ v: sub.filter(Boolean).join(' · '), s: 'sub' }]);
    this.merge(row, 'A', 'H');
    this.blank();
    this._kpi();
    this.blank();
    const tables = new DealXlsxSummaryTables(this);
    tables.items();
    this.blank();
    tables.parts();
    this.blank();
    tables.suppliers();
    this.blank();
    tables.customer();
    this.blank();
    tables.money();
    this.blank();
    tables.warnings();
    this.blank();
    this.put([], DealXlsxSummary.HEIGHT.gap);
    this._signs();
  }

  /**
   * Пик вложений своих денег и его строка.
   * @returns {{gap: number, row: object|undefined}}
   */
  peak() {
    const rows = this.calc.rows;
    const gap = Math.max(0, ...rows.map(row => -row.balance));
    return { gap, row: rows.find(row => -row.balance === gap) };
  }

  _tiles(labels, values) {
    const label = text => ({ v: text, s: 'kpiL' });
    let row = this.put(
      labels.flatMap(text => [label(text), label('')]),
      DealXlsxSummary.HEIGHT.tileHead,
    );
    DealXlsxSummary.PAIRS.forEach(pair => this.merge(row, ...pair.split(':')));
    const height = this.unknown ? DealXlsxSummary.HEIGHT.tileRange : DealXlsxSummary.HEIGHT.tile;
    row = this.put(
      values.flatMap(value => [value, { v: '', s: value.s }]),
      height,
    );
    DealXlsxSummary.PAIRS.forEach(pair => this.merge(row, ...pair.split(':')));
  }

  _kpi() {
    const { calc, res, unknown } = this;
    const tile = (value, style) => ({ v: value, s: style });
    const profit = unknown ? null : res.P;
    const { gap, row } = this.peak();
    this.section('Ключевые показатели');
    this._tiles(
      ['Цена КП с НДС', 'Выручка без НДС', 'Себестоимость с финансированием', this._profitLabel()],
      [
        tile(calc.S, 'kpiV'),
        tile(calc.R, 'kpiV'),
        tile(res.Ctot, 'kpiV'),
        unknown
          ? tile(`${Fmt.rub(calc.lo.P)} … ${Fmt.rub(calc.hi.P)}`, 'kpiT')
          : tile(profit, profit < 0 ? 'kpiVr' : 'kpiVg'),
      ],
    );
    this._tiles(
      [
        'Маржинальность — прибыль / выручка',
        'Наценка к себестоимости',
        'Чистая прибыль после налога',
        row && gap > 0 ? `Пик вложений, день ${row.day}` : 'Пик вложений своих денег',
      ],
      [
        this._pctTile('margin'),
        this._pctTile('markup'),
        unknown ? tile('—', 'kpiT') : tile(res.net, res.net < 0 ? 'kpiVr' : 'kpiV'),
        tile(gap, 'kpiV'),
      ],
    );
    this._verdict(profit);
  }

  _profitLabel() {
    if (this.unknown) return 'Прибыль (диапазон)';
    return this.xOn ? 'Прибыль до налога, за вычетом наличных' : 'Прибыль до налога';
  }

  _pctTile(key) {
    const { calc, res } = this;
    if (this.unknown) return { v: `${DealFmt.pct(calc.lo[key])} … ${DealFmt.pct(calc.hi[key])}`, s: 'kpiT' };
    return { v: res[key] == null ? '—' : res[key] / DealXlsxCalc.PCT, s: 'kpiP' };
  }

  _verdictText(profit) {
    const { calc, res } = this;
    if (!calc.ok || calc.warn.some(warn => warn.bad))
      return ['bad', 'Расчёт содержит ошибки — см. «На что обратить внимание».'];
    if (this.unknown)
      return ['warn', `Не указан ввозной НДС к вычету — прибыль от ${Fmt.rub(calc.lo.P)} до ${Fmt.rub(calc.hi.P)}.`];
    if (profit < 0) return ['bad', `Сделка убыточна: убыток ${Fmt.rub(-profit)} при цене ${Fmt.rub(calc.S)}.`];
    return ['ok', `Сделка прибыльна: прибыль ${Fmt.rub(profit)}, маржинальность ${DealFmt.pct(res.margin)}.`];
  }

  _verdict(profit) {
    const { calc, deal, kpData } = this;
    const [style, text] = this._verdictText(profit);
    const even = DealCalculator.solve(kpData, deal, 'profit', 0);
    const value = `${text}${even != null ? ` Безубыточная цена с НДС — ${Fmt.rub(even)}.` : ''}${this._goal(calc)}`;
    const height = DealXlsxSummary.LINE_H * Math.ceil(value.length / DealXlsxSummary.LINE) + DealXlsxSummary.PAD_H;
    const row = this.put([{ v: value, s: style }], height);
    this.merge(row, 'A', 'H');
  }

  _goal(calc) {
    const goal = this.deal.target || {};
    const target = InputNum.parse(goal.v);
    if (target == null || Number.isNaN(target)) return '';
    const need = DealCalculator.solve(this.kpData, this.deal, goal.type, target);
    const unit = DealXlsxSummary.RUB_GOALS.includes(goal.type) ? ' ₽' : ' %';
    const head = ` Цель — ${DealXlsxSummary.GOAL[goal.type]} ${DealFmt.inp(target)}${unit}:`;
    if (need == null) return `${head} недостижима при этих расходах.`;
    return `${head} цена с НДС ${Fmt.rub(need)}${DealXlsxSummary._goalTail(need, calc.S)}.`;
  }

  static _goalTail(need, price) {
    if (Math.abs(need - price) < 1) return ' (совпадает с КП)';
    return need <= price ? ' — цена КП выше, цель достигнута' : ` — на ${Fmt.rub(need - price)} выше цены КП`;
  }

  _signs() {
    let row = this.put(
      [
        { v: 'Подготовил', s: 'bold' },
        '',
        { v: this.who, s: 'text' },
        '',
        { v: '', s: 'sign' },
        { v: '', s: 'sign' },
        { v: this.today, s: 'text' },
      ],
      DealXlsxSummary.HEIGHT.sign,
    );
    ['A:B', 'C:D', 'E:F'].forEach(pair => this.merge(row, ...pair.split(':')));
    row = this.put([{ v: '', s: 'note' }, '', '', '', { v: 'подпись', s: 'note' }]);
    this.merge(row, 'E', 'F');
    row = this.put(
      [
        { v: 'Согласовано: Коммерческий директор', s: 'bold' },
        '',
        { v: '', s: 'sign' },
        { v: '', s: 'sign' },
        { v: '', s: 'sign' },
        { v: '', s: 'sign' },
        { v: '«___» __________ 20__', s: 'text' },
      ],
      DealXlsxSummary.HEIGHT.sign,
    );
    DealXlsxSummary.PAIRS.forEach(pair => this.merge(row, ...pair.split(':')));
    row = this.put([{ v: '', s: 'note' }, '', { v: 'ФИО', s: 'note' }, '', { v: 'подпись', s: 'note' }]);
    this.merge(row, 'C', 'D');
    this.merge(row, 'E', 'F');
    row = this.put([
      DealXlsxCalc.note(
        'Подробный расчёт с формулами — лист «Расчёт»; движение денег по дням — лист «График платежей».',
      ),
    ]);
    this.merge(row, 'A', 'H');
  }

  /**
   * Подпись стоимости денег (ключевая ставка ЦБ, если по ней).
   * @returns {string}
   */
  moneyLabel() {
    const key = DealUi.key;
    const auto =
      this.calc.moneyAuto && key
        ? ` (ключевая ставка ЦБ ${DealFmt.inp(key.rate)} % + ${DealDefaults.spread()} п.п.)`
        : '';
    return `Стоимость денег, % в месяц${auto}`;
  }
}
