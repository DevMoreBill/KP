import { DealXlsxCalc } from './deal-xlsx-calc.js';

/** Лист Excel «График платежей»: деньги по дням — день, дата, событие, платёж (формулой от листа «Расчёт»), остаток, финансирование. */
export class DealXlsxGraph {
  static HEAD = 4;
  static NOTE_H = 32;
  static SUM_KEYS = { bonus: 'BON', warr: 'WARR' };
  static DIRECT = { asm: 'ASM', doc: 'DOC' };

  /**
   * @param {DealXlsxCalc} sheet лист «Расчёт»
   * @param {{calc: string, graph: string}} names имена листов
   */
  constructor(sheet, names) {
    this.sheet = sheet;
    this.calc = sheet.calc;
    this.names = names;
    this.rows = [];
    this.merges = ['A2:C2', 'A3:G3'];
    this.heights = { 3: DealXlsxGraph.NOTE_H };
    this.first = DealXlsxGraph.HEAD + 1;
    this.last = DealXlsxGraph.HEAD + this.calc.rows.length;
    this.total = this.last + 1;
    this.rowOf = Object.fromEntries(this.calc.rows.map((row, k) => [row.key, this.first + k]));
  }

  /**
   * Ссылка на лист: «'Имя'!».
   * @param {string} name
   * @returns {string}
   */
  static quote(name) {
    return `'${name}'!`;
  }

  _calcCell(cell) {
    return DealXlsxGraph.quote(this.names.calc) + cell;
  }

  _rub(key) {
    return this._calcCell(this.sheet.rubRef(key));
  }

  _calcRef(key) {
    return this._calcCell(this.sheet.ref(key));
  }

  /** Заголовок листа и шапка таблицы. */
  head() {
    const calc = this.calc;
    const start = this.sheet.deal.start;
    const date = xlsxDate(start);
    const pays = calc.rows.map((row, k) => (row.inflow ? `A${this.first + k}` : null)).filter(Boolean);
    const startCell = this._calcRef('D0');
    this.rows.push([{ v: 'График платежей', s: 'title' }]);
    this.rows.push([
      { v: 'Последняя оплата заказчика — день и дата', s: 'bold' },
      '',
      '',
      { f: `MAX(${pays.join(',')})`, v: calc.Tend, s: 'int' },
      { f: `IF(${startCell}="","",${startCell}+D2)`, v: date === '' ? undefined : date + calc.Tend, s: 'tdDate' },
    ]);
    const work = start ? ' Даты платежей — рабочие (банковские) дни по производственному календарю РФ.' : '';
    this.rows.push([
      {
        v: `Минус — расход, плюс — поступление. Дни (жёлтые) можно менять, сохраняя порядок строк по возрастанию дня. Финансирование — простой процент на недостающие деньги, месяц = 30 дней.${work}`,
        s: 'note',
      },
    ]);
    this.rows.push(
      ['День', 'Дата', 'Событие', 'Платёж, ₽', 'Остаток денег, ₽', 'Дней финанси­рования', 'Финансирование, ₽'].map(
        (text, k) => ({
          v: text,
          s: k > 2 ? 'headR' : 'head',
        }),
      ),
    );
  }

  /** Строки платежей и итог финансирования. */
  body() {
    const calc = this.calc;
    const cashIndex = calc.rows.findIndex(row => row.key === 'xc');
    calc.rows.forEach((row, k) => this.rows.push(this._row(row, k, cashIndex)));
    const empty = { v: '', s: 'totL' };
    this.rows.push([
      { ...empty },
      { ...empty },
      { v: 'Стоимость финансирования', s: 'totL' },
      { ...empty },
      { ...empty },
      { ...empty },
      { f: `SUM(G${this.first}:G${this.last})`, v: calc.F, s: 'totMoney' },
    ]);
  }

  _row(row, k, cashIndex) {
    const calc = this.calc;
    const line = this.first + k;
    const start = this._calcRef('D0');
    const date = xlsxDate(this.sheet.deal.start);
    const formula = this.amount(row);
    const amount = formula == null ? { v: row.amount, s: 'tdMoney2' } : { f: formula, v: row.amount, s: 'tdMoney2' };
    const fin =
      cashIndex >= 0 && k >= cashIndex
        ? { v: 0, s: 'tdMoney2' }
        : {
            f: `MAX(0,-E${line})*F${line}*${this._calcRef('i')}/100/${DealXlsxCalc.monthDays()}`,
            v: row.fin,
            s: 'tdMoney2',
          };
    return [
      { v: row.day, s: row.fixed ? 'tdInt' : 'inpInt' },
      { f: `IF(${start}="","",${start}+A${line})`, v: date === '' ? undefined : date + row.day, s: 'tdDate' },
      { v: row.label, s: 'td' },
      amount,
      { f: k ? `E${line - 1}+D${line}` : `D${line}`, v: row.balance, s: 'tdMoney2' },
      { f: k < calc.rows.length - 1 ? `MAX(0,MIN(A${line + 1},$D$2)-A${line})` : '0', v: row.days, s: 'tdInt' },
      fin,
    ];
  }

  _fx(out) {
    return out.fxE.replace(/([A-Z]+\d+)/g, cell => this._calcCell(cell));
  }

  static SUPPLIER = { sp: '_spAmount', log: '_logAmount', ru: '_ruAmount' };

  /**
   * Платёж строки формулой от листа «Расчёт»; прочие строки — значением (null).
   * @param {object} row строка графика
   * @returns {string|null}
   */
  amount(row) {
    const parts = String(row.key).split(':');
    const method = DealXlsxGraph.SUPPLIER[parts[0]];
    if (method) {
      const k = this.calc.sup.findIndex(sup => sup.id === parts[1]);
      return this[method](k, this.sheet.custOut[k], parts[2]);
    }
    return this._other(row);
  }

  _spAmount(k, out, stage) {
    return `-(${this._rub(`EQ${k}`)}+${this._fx(out)})*${this._calcRef(`sp${k}_${stage}`)}/100`;
  }

  _logAmount(k, out) {
    return `-(${this._rub(`FX${k}`)}-${this._fx(out)}+${this._rub(`INS${k}`)}+${this._rub(`L${k}`)}+${this._rub(`T${k}`)}+${this._rub(`BRK${k}`)})`;
  }

  _ruAmount(k) {
    return `-${this._rub(`LRU${k}`)}`;
  }

  _other(row) {
    const key = String(row.key);
    if (key === 'mnt') return `-(${this._rub('M')}+${this._rub('E')})`;
    if (DealXlsxGraph.SUM_KEYS[key]) return `-${this._calcRef('Rv')}*${this._calcRef(DealXlsxGraph.SUM_KEYS[key])}/100`;
    if (key.startsWith('bg:'))
      return this.calc.bgs.filter(guarantee => guarantee.fee > 0).length === 1 ? `-${this._rub('BG')}` : null;
    if (key === 'xc') return `-${this._calcRef('XK')}`;
    if (key.startsWith('xc:')) return this._cashAmount(row);
    if (DealXlsxGraph.DIRECT[key]) return `-${this._rub(DealXlsxGraph.DIRECT[key])}`;
    if (!/^c\d+$/.test(key)) return null;
    return `${this._rub('S')}*${this._calcCell(this.sheet.trRef(`TR${+key.slice(1)}`))}/100`;
  }

  _cashAmount(row) {
    if (this.calc.xc.mode === 'net') return null;
    const from = this.calc.xc.from.map(key => `D${this.rowOf[key]}`).join('+');
    return `-${this._calcRef('XK')}*D${this.rowOf[row.from]}/(${from})`;
  }
}

/** Итог на листе «Расчёт»: выручка, прямые платежи, финансирование (с листа «График платежей»), НДС, прибыль, наличные. */
export class DealXlsxResult {
  static _head() {
    return [
      { v: 'Результат', s: 'head' },
      { v: 'Значение', s: 'headR' },
      { v: '', s: 'head' },
      { v: '', s: 'head' },
      { v: 'Как считается', s: 'head' },
    ];
  }

  static X_FORMULA = { sale: '_saleX', salevat: '_saleVatX', sum: '_sumX' };
  static X_NOTE = {
    net: '% от чистой прибыли до этих расходов',
    sale: '% от выручки без НДС',
    salevat: '% от суммы продажи с НДС',
  };

  /**
   * @param {DealXlsxCalc} sheet
   * @param {DealXlsxGraph} graph
   */
  constructor(sheet, graph) {
    this.sheet = sheet;
    this.graph = graph;
    this.calc = sheet.calc;
    this.res = sheet.res;
  }

  _ref(key) {
    return this.sheet.ref(key);
  }

  _rub(key) {
    return this.sheet.rubRef(key);
  }

  /**
   * Ячейка пояснения.
   * @param {string} text
   * @returns {object}
   */
  static note(text) {
    return DealXlsxCalc.note(text);
  }

  /** Строки итога. */
  build() {
    const { sheet, calc, res } = this;
    const note = DealXlsxResult.note;
    const ref = key => this._ref(key);
    sheet.row([]);
    sheet.row(DealXlsxResult._head());
    this._line(
      'Выручка без НДС',
      { f: `${this._rub('S')}/(1+${ref('v')}/100)`, v: calc.R, s: 'money' },
      note('R = цена с НДС / (1 + НДС / 100)'),
      'Rv',
    );
    this._line(
      'НДС с продажи',
      { f: `${this._rub('S')}-${ref('Rv')}`, v: calc.VATs, s: 'money' },
      note('Цена с НДС − выручка'),
      'VATs',
    );
    this._line(
      'Прямые платежи',
      { f: this._direct(), v: calc.Ccash, s: 'money' },
      note('Поставщики, доставка, таможня, монтаж, прочее, резерв, бонусы'),
      'C',
    );
    this._line(
      'Финансирование',
      { f: `${DealXlsxGraph.quote(this.graph.names.graph)}G${this.graph.total}`, v: calc.F, s: 'money' },
      note('Лист «График платежей»'),
      'F',
    );
    this._line(
      'НДС к вычету',
      { f: this._vatIn(), v: res.VATin, s: 'money' },
      note('Ввозной + НДС поставщиков + услуги в России + прочий'),
      'VI',
    );
    this._line(
      'Себестоимость с финансированием',
      { f: `${ref('C')}-${ref('VI')}+${ref('F')}`, v: res.Ctot, s: 'money' },
      note('Прямые платежи − НДС к вычету + финансирование'),
      'CT',
    );
    if (sheet.xOn) this._withCash();
    else this._plain();
    this._tail();
  }

  _line(label, cell, noteCell, key) {
    this.sheet.row([label, cell, '', '', noteCell], key);
  }

  _direct() {
    const { calc, sheet } = this;
    const ref = key => this._ref(key);
    const cash = calc.sup.map((sup, k) => this._rub(`CASH${k}`)).join('+') || '0';
    return `${cash}+${this._rub('M')}+${this._rub('E')}+${this._rub('DOC')}+${ref('Rv')}*(${ref('WARR')}+${ref('BON')})/100${calc.BG > 0 ? `+${this._rub('BG')}` : ''}${sheet.asmOn ? `+${this._rub('ASM')}` : ''}`;
  }

  _vatIn() {
    const { calc, sheet } = this;
    return [
      ...calc.sup.map((sup, k) => this._rub(`vi${k}`)),
      ...calc.sup.map((sup, k) => (sheet.deal.sup[k].vatIn ? this._rub(`vo${k}`) : null)).filter(Boolean),
      ...calc.sup.map((sup, k) => this._rub(`voru${k}`)),
      this._rub('Vo'),
      ...(sheet.asmOn ? [`${this._rub('ASM')}*${sheet.vatK}`] : []),
    ].join('+');
  }

  _profitNote() {
    return DealXlsxResult.note(
      this.sheet.unknown ? 'Ввозной НДС не указан — прибыль минимальная' : 'Выручка − себестоимость',
    );
  }

  static _pct(value) {
    return value == null ? undefined : value / DealXlsxCalc.PCT;
  }

  _plain() {
    const { sheet, res } = this;
    const note = DealXlsxResult.note;
    const ref = key => this._ref(key);
    sheet.row(
      [
        { v: 'Прибыль до налога на прибыль', s: 'bold' },
        { f: `${ref('Rv')}-${ref('CT')}`, v: res.P, s: 'moneyB' },
        '',
        '',
        this._profitNote(),
      ],
      'P',
    );
    sheet.row(
      ['Налог на прибыль', { f: `IF(${ref('P')}>0,${ref('P')}*${ref('TAX')}/100,0)`, v: res.tax, s: 'money' }],
      'PT',
    );
    sheet.row([
      { v: 'Чистая прибыль', s: 'bold' },
      { f: `${ref('P')}-${ref('PT')}`, v: res.net, s: 'moneyB' },
    ]);
    sheet.row([
      'Наценка',
      { f: `IF(${ref('CT')}=0,"",${ref('P')}/${ref('CT')})`, v: DealXlsxResult._pct(res.markup), s: 'pctB' },
      '',
      '',
      note('Прибыль / себестоимость'),
    ]);
  }

  _xFormula() {
    const method = DealXlsxResult.X_FORMULA[this.sheet.xMode];
    if (method) return this[method]();
    return `MAX(0,${this._ref('PA')}-${this._ref('PT')})*${this._ref('XV')}/100`;
  }

  _saleX() {
    return `${this._ref('Rv')}*${this._ref('XV')}/100`;
  }

  _saleVatX() {
    return `${this._rub('S')}*${this._ref('XV')}/100`;
  }

  _sumX() {
    return this._ref('XV');
  }

  _withCash() {
    const { sheet, res } = this;
    const note = DealXlsxResult.note;
    const ref = key => this._ref(key);
    this._line(
      'Прибыль до прочих расходов (база налога)',
      { f: `${ref('Rv')}-${ref('CT')}`, v: res.Pa, s: 'money' },
      this._profitNote(),
      'PA',
    );
    this._line(
      'Налог на прибыль',
      { f: `IF(${ref('PA')}>0,${ref('PA')}*${ref('TAX')}/100,0)`, v: res.tax, s: 'money' },
      note('Прочие расходы наличными налог не уменьшают'),
      'PT',
    );
    this._line(
      'Прочие расходы наличными — на руки',
      { f: this._xFormula(), v: res.X, s: 'money' },
      note(DealXlsxResult.X_NOTE[sheet.xMode] || 'Сумма на руки'),
      'XX',
    );
    this._line(
      'Прочие расходы наличными — расход компании',
      { f: `${ref('XX')}/(1-${ref('XCOST')}/100)`, v: res.K, s: 'money' },
      note('С учётом стоимости получения наличных'),
      'XK',
    );
    this._cashProfit();
  }

  _cashProfit() {
    const { sheet, res } = this;
    const note = DealXlsxResult.note;
    const ref = key => this._ref(key);
    sheet.row(
      [
        { v: 'Прибыль сделки до налога (за вычетом наличных)', s: 'bold' },
        { f: `${ref('PA')}-${ref('XK')}`, v: res.P, s: 'moneyB' },
      ],
      'P',
    );
    sheet.row([
      { v: 'Чистая прибыль', s: 'bold' },
      { f: `${ref('PA')}-${ref('PT')}-${ref('XK')}`, v: res.net, s: 'moneyB' },
      '',
      '',
      note('После налога на прибыль и прочих расходов'),
    ]);
    sheet.row([
      'Наценка',
      {
        f: `IF(${ref('CT')}+${ref('XK')}=0,"",${ref('P')}/(${ref('CT')}+${ref('XK')}))`,
        v: DealXlsxResult._pct(res.markup),
        s: 'pctB',
      },
      '',
      '',
      note('Прибыль / (себестоимость + наличные)'),
    ]);
  }

  _tail() {
    const { sheet, calc, res } = this;
    const note = DealXlsxResult.note;
    const ref = key => this._ref(key);
    sheet.row([
      'Маржинальность',
      { f: `IF(${ref('Rv')}=0,"",${ref('P')}/${ref('Rv')})`, v: DealXlsxResult._pct(res.margin), s: 'pctB' },
      '',
      '',
      note('Прибыль / выручка без НДС'),
    ]);
    this._line(
      'НДС к уплате',
      { f: `MAX(${ref('VATs')}-${ref('VI')},0)`, v: res.payable, s: 'money' },
      note('НДС с продажи − НДС к вычету'),
      'PAY',
    );
    sheet.row([
      'Превышение вычетов',
      { f: `MAX(${ref('VI')}-${ref('VATs')},0)`, v: res.excess, s: 'money' },
      '',
      '',
      note('Не добавляется в остаток как возврат'),
    ]);
    sheet.row(
      ['Деньги до расчётов по НДС', { f: `${this._rub('S')}-${ref('C')}-${ref('F')}`, v: calc.cashBefore, s: 'money' }],
      'CB',
    );
    sheet.row([
      'Деньги на счёте после сделки',
      { f: `${ref('CB')}-${ref('PAY')}${sheet.xOn ? `-${ref('XK')}` : ''}`, v: res.cashAfter, s: 'money' },
      '',
      '',
      note(
        sheet.xOn ? 'После доплаты НДС и наличных, до налога на прибыль' : 'После доплаты НДС, до налога на прибыль',
      ),
    ]);
  }
}
