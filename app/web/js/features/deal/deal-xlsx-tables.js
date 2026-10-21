import { DealFmt } from './deal-fmt.js';
import { DealTerms } from './deal-terms.js';
import { DealXlsxCalc } from './deal-xlsx-calc.js';
import { XlsxBook } from '../../core/xlsx.js';
import { Currency } from '../kp/currency.js';
import { S } from '../../core/state.js';

/** Таблицы листа «Сводка»: позиции, себестоимость, поставщики, оплата заказчика, деньги и налоги, замечания. */
export class DealXlsxSummaryTables {
  static CUS = { calc: 'расчёт по ТН ВЭД', eaeu: 'ЕАЭС', sum: 'по сумме', none: 'нет' };
  static KOPECKS = 100;
  static HEAD_H = 32;
  static SUP_HEAD_H = 30;
  static NOTE_H = 30;
  static EPS = 0.5;

  /**
   * @param {object} sheet лист «Сводка» (DealXlsxSummary)
   */
  constructor(sheet) {
    this.sheet = sheet;
    this.calc = sheet.calc;
    this.res = sheet.res;
  }

  static _head(titles) {
    return titles.map(([text, right]) => ({ v: text, s: right ? 'headR' : 'head' }));
  }

  _mergeB(row) {
    this.sheet.merge(row, 'B', 'E');
    this.sheet.merge(row, 'G', 'H');
  }

  /** Позиции: закупка и продажа, себестоимость пропорционально закупке. */
  items() {
    const { sheet, calc } = this;
    sheet.section('Позиции: закупка и продажа');
    sheet.put(
      DealXlsxSummaryTables._head([
        ['№'],
        ['Позиция'],
        ['Кол-во', 1],
        ['Закупка, ₽', 1],
        ['Продажа без НДС, ₽', 1],
        ['Себестоимость*, ₽', 1],
        ['Прибыль, ₽', 1],
        ['Маржа', 1],
      ]),
      DealXlsxSummaryTables.HEAD_H,
    );
    const lines = calc.sup.flatMap(sup => sup.lines.filter(line => line.id !== 'extra'));
    const items = S.items.filter(item => String(item.name || '').trim());
    const sales = this._sales(items);
    const total = { buy: 0, sale: 0, cost: 0 };
    const weight = lines.reduce((sum, line) => sum + line.rub, 0);
    items.forEach((item, k) =>
      this._item({ item, k, line: lines.find(row => row.id === item.id), sale: sales[k], weight }, total),
    );
    this._itemsTail(items.length, total);
    const tail = sheet.unknown ? ' Ввозной НДС не указан — показана минимальная прибыль.' : '';
    const row = sheet.put(
      [
        DealXlsxCalc.note(
          `* Себестоимость позиции — её закупка плюс доля логистики, таможни, монтажа, финансирования и прочих расходов (распределены пропорционально закупке), за вычетом НДС к вычету.${tail}`,
        ),
      ],
      DealXlsxSummaryTables.NOTE_H,
    );
    sheet.merge(row, 'A', 'H');
  }

  // продажа позиции без НДС в рублях; сумма по позициям приводится к выручке расчёта
  _sales(items) {
    const calc = this.calc;
    const rate = Currency.rate(Currency.current()) > 0 ? Currency.rate(Currency.current()) : 0;
    const saleOf = item => {
      const options = (item.options || [])
        .filter(option => option.name)
        .map(option => ({ qty: +option.qty || 0, price: option.price || 0 }));
      const sum = KPGen.totals([{ qty: +item.qty || 0, price: item.price || 0, disc: item.disc, options }], 0).sum;
      return ((sum / DealXlsxSummaryTables.KOPECKS) * rate) / (1 + calc.v / DealXlsxCalc.PCT);
    };
    const sales = items.map(saleOf);
    const sum = sales.reduce((total, sale) => total + sale, 0);
    const factor = sum > 0 ? calc.R / sum : 0;
    return sales.map(sale => sale * factor);
  }

  _item({ item, k, line, sale, weight }, total) {
    const buy = line ? line.rub : 0;
    const cost = line && weight > 0 ? (this.res.Ctot * line.rub) / weight : 0;
    total.buy += buy;
    total.sale += sale;
    total.cost += cost;
    const name = DealXlsxSummaryTables._itemName(item, line);
    this.sheet.put([
      { v: k + 1, s: 'tdInt' },
      { v: name, s: 'td' },
      { v: +item.qty || 0, s: 'tdInt' },
      { v: buy || '—', s: 'tdMoney' },
      { v: sale, s: 'tdMoney' },
      { v: line ? cost : '—', s: 'tdMoney' },
      { v: line ? sale - cost : '—', s: 'tdMoney' },
      { v: line && sale ? (sale - cost) / sale : '—', s: 'tdPct' },
    ]);
  }

  static _itemName(item, line) {
    if (!line) return `${item.name}\nзакупка не указана`;
    return item.name + (line.code ? `\nТН ВЭД ${line.code}` : '');
  }

  _itemsTail(count, total) {
    const { sheet, calc, res } = this;
    const other = res.Ctot - total.cost;
    if (!count) {
      sheet.put([
        { v: '', s: 'td' },
        { v: 'В КП нет позиций', s: 'td' },
        { v: '', s: 'td' },
        { v: calc.equipSum, s: 'tdMoney' },
        { v: calc.R, s: 'tdMoney' },
        { v: res.Ctot, s: 'tdMoney' },
        { v: calc.R - res.Ctot, s: 'tdMoney' },
        { v: calc.R ? (calc.R - res.Ctot) / calc.R : '—', s: 'tdPct' },
      ]);
      Object.assign(total, { buy: calc.equipSum, sale: calc.R, cost: res.Ctot });
    } else if (Math.abs(other) > DealXlsxSummaryTables.EPS && total.cost > 0) {
      sheet.put([
        { v: '', s: 'td' },
        { v: 'Расходы без привязки к позициям (прочая закупка; при отсутствии закупки у позиций)', s: 'tdNote' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
        { v: Math.max(0, calc.R - total.sale), s: 'tdMoney' },
        { v: other, s: 'tdMoney' },
        { v: -other, s: 'tdMoney' },
        { v: '', s: 'td' },
      ]);
      total.cost += other;
    }
    sheet.put([
      { v: '', s: 'totL' },
      { v: 'Итого', s: 'totL' },
      { v: '', s: 'totL' },
      { v: total.buy, s: 'totMoney' },
      { v: calc.R, s: 'totMoney' },
      { v: res.Ctot, s: 'totMoney' },
      { v: calc.R - res.Ctot, s: 'totMoney' },
      { v: calc.R ? (calc.R - res.Ctot) / calc.R : '', s: 'totPct' },
    ]);
  }

  /** Из чего складывается себестоимость. */
  parts() {
    const { sheet, calc, res } = this;
    sheet.section('Из чего складывается себестоимость');
    let row = sheet.put(
      DealXlsxSummaryTables._head([['№'], ['Статья'], [''], [''], [''], ['Сумма, ₽', 1], ['Доля', 1], ['']]),
    );
    this._mergeB(row);
    calc.parts.forEach(([name, value], k) => {
      row = sheet.put([
        { v: k + 1, s: 'tdInt' },
        { v: name, s: 'td' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
        { v: value, s: 'tdMoney' },
        { v: res.Ctot ? value / res.Ctot : '', s: 'tdPct' },
        { v: '', s: 'tdPct' },
      ]);
      this._mergeB(row);
    });
    row = sheet.put([
      { v: '', s: 'totL' },
      { v: 'Себестоимость с финансированием', s: 'totL' },
      { v: '', s: 'totL' },
      { v: '', s: 'totL' },
      { v: '', s: 'totL' },
      { v: res.Ctot, s: 'totMoney' },
      { v: 1, s: 'totPct' },
      { v: '', s: 'totPct' },
    ]);
    this._mergeB(row);
  }

  /** Поставщики и условия закупки. */
  suppliers() {
    const { sheet, calc } = this;
    sheet.section('Поставщики и условия закупки');
    sheet.put(
      DealXlsxSummaryTables._head([
        ['№'],
        ['Поставщик'],
        ['Страна'],
        ['Закупка, ₽', 1],
        ['Таможня, ₽', 1],
        ['Логистика, ₽', 1],
        ['Оплата, %', 1],
        ['Срок, дн.', 1],
      ]),
      DealXlsxSummaryTables.SUP_HEAD_H,
    );
    calc.sup.forEach((sup, k) => {
      const paid = sup.stages.filter(stage => stage.p > 0);
      const text = `${sup.name}\nтаможня: ${DealXlsxSummaryTables.CUS[sup.mode] || '—'}${sup.noVat ? '; цены без НДС' : ''}\nоплата: ${DealXlsxSummaryTables.payText(sup)}`;
      sheet.put([
        { v: k + 1, s: 'tdInt' },
        { v: text, s: 'td' },
        { v: sup.country || '—', s: 'td' },
        { v: sup.equip, s: 'tdMoney' },
        { v: sup.T, s: 'tdMoney' },
        { v: sup.L + sup.Lru + sup.brk, s: 'tdMoney' },
        { v: paid.map(stage => DealFmt.inp(stage.p)).join(' / '), s: 'tdC' },
        { v: `${sup.prod} + ${sup.ship}`, s: 'tdC' },
      ]);
    });
    const row = sheet.put([
      DealXlsxCalc.note('Срок: изготовление + доставка. Логистика: до границы, по России, брокер и СВХ.'),
    ]);
    sheet.merge(row, 'A', 'H');
  }

  /**
   * Оплата поставщику словами.
   * @param {object} sup
   * @returns {string}
   */
  static payText(sup) {
    return sup.stages
      .filter(stage => stage.p > 0)
      .map(
        stage => `${DealFmt.inp(stage.p)} % ${DealTerms.SUP_EVENTS[stage.ev]}${stage.off ? ` + ${stage.off} дн.` : ''}`,
      )
      .join('; ');
  }

  static _stageName(stage, calc) {
    if (stage.name) return stage.name;
    if (stage.last && calc.trs.length > 1) return 'Окончательный расчёт';
    return stage.k === 0 && !stage.last ? 'Аванс' : 'Оплата';
  }

  /** Оплата заказчика. */
  customer() {
    const { sheet, calc } = this;
    const start = sheet.deal.start;
    const date = XlsxBook.date(start);
    sheet.section('Оплата заказчика');
    let row = sheet.put(
      DealXlsxSummaryTables._head([['№'], ['Этап'], ['Доля', 1], ['День', 1], ['Сумма, ₽', 1], [''], ['Дата'], ['']]),
    );
    sheet.merge(row, 'E', 'F');
    sheet.merge(row, 'G', 'H');
    calc.rows
      .filter(item => item.inflow)
      .forEach((item, k) => {
        const stage = calc.trs[item.stage];
        const title = stage
          ? `${DealXlsxSummaryTables._stageName(stage, calc)} — ${DealTerms.EVENTS[stage.ev]}${stage.off ? ` + ${stage.off} дн.` : ''}`
          : item.label;
        row = sheet.put([
          { v: k + 1, s: 'tdInt' },
          { v: title, s: 'td' },
          { v: (item.pct || 0) / DealXlsxCalc.PCT, s: 'tdPct' },
          { v: item.day, s: 'tdInt' },
          { v: item.amount, s: 'tdMoney' },
          { v: '', s: 'tdMoney' },
          { v: date === '' ? '—' : date + item.day, s: 'tdDate' },
          { v: '', s: 'tdDate' },
        ]);
        sheet.merge(row, 'E', 'F');
        sheet.merge(row, 'G', 'H');
      });
    const when = start ? ` (${start.split('-').reverse().join('.')}, ориентировочно)` : '';
    row = sheet.put([
      DealXlsxCalc.note(
        `День 0 — подписание договора${when}. Готовность к отгрузке — день ${calc.Rdy}, поставка — день ${calc.D}.`,
      ),
    ]);
    sheet.merge(row, 'A', 'H');
  }

  _moneyRows() {
    const { sheet, calc, res } = this;
    const cash = sheet.xOn
      ? [
          ['Прочие расходы (наличные) — расход компании', res.K],
          ...(res.K !== res.X
            ? [[`  в т. ч. на руки (стоимость наличных ${DealFmt.inp(calc.xc.cost)} %)`, res.X]]
            : []),
          ['  налог на прибыль они не уменьшают', '', 'td'],
        ]
      : [];
    return [
      [sheet.moneyLabel(), calc.i / DealXlsxCalc.PCT, 'tdPct'],
      ['Финансирование (проценты на вложенные деньги)', calc.F],
      ['Максимальное вложение своих денег', sheet.peak().gap],
      ['НДС с продажи', calc.VATs],
      ['НДС к вычету', res.VATin],
      ['НДС к уплате', res.payable],
      [`Налог на прибыль ${DealFmt.inp(calc.taxP)} %${sheet.xOn ? ' (с прибыли до прочих расходов)' : ''}`, res.tax],
      ...(calc.BG > 0 ? [['Банковская гарантия — комиссия банка', calc.BG]] : []),
      ...cash,
      ['Деньги на счёте после сделки (после НДС, до налога на прибыль)', res.cashAfter],
    ];
  }

  /** Деньги и налоги. */
  money() {
    const sheet = this.sheet;
    sheet.section('Деньги и налоги');
    this._moneyRows().forEach(([name, value, style]) => {
      const row = sheet.put([
        { v: '', s: 'td' },
        { v: name, s: 'td' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
        { v: value, s: style || 'tdMoney' },
        { v: '', s: 'td' },
        { v: '', s: 'td' },
      ]);
      sheet.merge(row, 'B', 'E');
      sheet.merge(row, 'F', 'H');
    });
  }

  /** На что обратить внимание. */
  warnings() {
    const { sheet, calc } = this;
    sheet.section('На что обратить внимание');
    const list = [
      ...calc.warn.map(warn => [warn.t, warn.bad ? 'bad' : 'warn']),
      ...(sheet.unknown ? [['Не указан ввозной НДС к вычету — прибыль показана диапазоном', 'warn']] : []),
      ...(calc.ok ? [] : [['В исходных данных есть ошибки — проверьте поля, отмеченные в программе', 'bad']]),
    ];
    (list.length ? list : [['Замечаний нет', 'ok']]).forEach(([text, style]) => {
      const row = sheet.put([
        { v: '•', s: 'text' },
        { v: text, s: style },
      ]);
      sheet.merge(row, 'B', 'H');
    });
  }
}
