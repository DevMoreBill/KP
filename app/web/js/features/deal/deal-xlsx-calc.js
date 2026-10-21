import { DealDefaults, DealMoneyRate } from './deal-defaults.js';
import { DealFmt } from './deal-fmt.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { DealValues } from './deal-values.js';
import { DealXlsxCustoms } from './deal-xlsx-customs.js';
import { InputNum } from './input-num.js';
import { Money } from '../../core/money.js';
import { XlsxBook } from '../../core/xlsx.js';
import { Fmt } from '../../core/str.js';
import { S } from '../../core/state.js';

/**
 * Лист Excel «Расчёт»: все исходные данные (жёлтые ячейки можно менять) и формулы — цена и курсы, поставщики (позиции,
 * логистика, таможня, этапы оплаты, сроки, НДС к вычету), монтаж и прочие расходы, оплата заказчика, итог.
 */
export class DealXlsxCalc {
  static GRP = [
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
    { v: '', s: 'grp' },
  ];
  static X_LABEL = { net: '% от чистой прибыли', sale: '% от выручки без НДС', salevat: '% от суммы продажи с НДС' };
  static PCT = 100;
  static EPS = 0.005;
  static YEAR = 365;

  /**
   * @param {object} ctx { calc, deal, kpData, res, unknown, kpTitle }
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.rows = [];
    this.at = {};
    this.custOut = [];
  }

  /**
   * Строка листа; key — имя строки для формул.
   * @param {Array} cells
   * @param {string} [key]
   * @returns {number} номер строки
   */
  row(cells, key) {
    this.rows.push(cells);
    if (key) this.at[key] = this.rows.length;
    return this.rows.length;
  }

  /**
   * Ячейка строки key.
   * @param {string} key
   * @param {string} [col]
   * @returns {string}
   */
  ref(key, col = 'B') {
    return col + this.at[key];
  }

  /**
   * Ячейка «В рублях» строки key.
   * @param {string} key
   * @returns {string}
   */
  rubRef(key) {
    return this.ref(key, 'D');
  }

  _self() {
    return `B${this.rows.length + 1}`;
  }

  /**
   * Ячейка пояснения.
   * @param {string} text
   * @returns {object}
   */
  static note(text) {
    return { v: text, s: 'note' };
  }

  /**
   * Число или 0.
   * @param {number} value
   * @returns {number}
   */
  static num(value) {
    return Number.isFinite(value) ? value : 0;
  }

  _group(title) {
    this.row(DealXlsxCalc.group(title));
  }

  /**
   * Строка-заголовок группы.
   * @param {string} title
   * @returns {object[]}
   */
  static group(title) {
    return [{ v: title, s: 'grp' }, ...DealXlsxCalc.GRP.map(cell => ({ ...cell }))];
  }

  /** Заголовок, цена, НДС, курсы, поставщики, расходы, оплата заказчика, деньги и налог. */
  build() {
    const calc = this.calc;
    this.row([{ v: 'Расчёт экономики сделки', s: 'title' }]);
    this.row([
      {
        v: `${this.kpTitle}${S.client ? ` · ${S.client}` : ''} · жёлтые ячейки — исходные данные, их можно менять; остальное считается формулами`,
        s: 'sub',
      },
    ]);
    this.row([]);
    this.row([
      { v: 'Показатель', s: 'head' },
      { v: 'Значение', s: 'head' },
      { v: 'Ед.', s: 'head' },
      { v: 'В рублях', s: 'headR' },
      { v: 'Пояснение', s: 'head' },
    ]);
    this._group('Цена и курсы');
    this.row(['Цена для заказчика с НДС', { v: calc.S, s: 'inpMoney' }, '₽', { f: this._self(), v: calc.S }], 'S');
    this.row(['НДС при продаже', { v: calc.v, s: 'inp' }, '%'], 'v');
    this.row(
      [
        'НДС российских поставщиков и услуг',
        { v: calc.sv, s: 'inp' },
        '%',
        '',
        DealXlsxCalc.note('Вычет и цены «без НДС» поставщиков — по этой ставке'),
      ],
      'sv',
    );
    this._rates();
    // НДС в счетах поставщиков — по их ставке, не по НДС КП
    this.vatK = `${this.ref('sv')}/(100+${this.ref('sv')})`;
    calc.sup.forEach((sup, k) => new DealXlsxSupplier(this, k).build());
    this._costs();
    this._customer();
    this._money();
  }

  // курсы — всех валют расчёта (в т. ч. с нулевой суммой: на них ссылаются формулы)
  _rates() {
    const { calc, deal, kpData } = this;
    const num = DealXlsxCalc.num;
    const fromDeal = deal.sup.flatMap(sup => [
      sup.log && sup.log.cur,
      sup.extra && sup.extra.cur,
      sup.logRu && sup.logRu.cur,
    ]);
    const curs = [
      ...new Set(
        [...calc.used, ...fromDeal, ...kpData.items.map(item => item.cur)].filter(
          cur => cur && cur !== 'RUB' && num(calc.rate(cur)) > 0,
        ),
      ),
    ];
    for (const cur of curs) {
      const src = calc.rateSrc[cur] === 'deal' ? 'Указан в расчёте' : 'Из КП (курс ЦБ)';
      this.row(
        [`Курс рубля за 1 ${cur}`, { v: num(calc.rate(cur)), s: 'inp' }, '₽', '', DealXlsxCalc.note(src)],
        `rate_${cur}`,
      );
    }
  }

  /**
   * Сумма строки в рублях формулой.
   * @param {string} key
   * @param {string} cur
   * @returns {string}
   */
  rub(key, cur) {
    if (cur === 'RUB') return this.ref(key);
    if (this.at[`rate_${cur}`]) return `${this.ref(key)}*${this.ref(`rate_${cur}`)}`;
    return `${this.ref(key)}*${DealXlsxCalc.num(this.calc.rate(cur)) || 0}`;
  }

  /**
   * Строка суммы в валюте и в рублях.
   * @param {string} label
   * @param {string} key
   * @param {{field: object, cur?: string, note?: string}} spec
   * @returns {string} валюта
   */
  amount(label, key, spec) {
    const field = spec.field;
    const cur = spec.cur || (field && field.cur) || 'RUB';
    const value = InputNum.parse(field && field.v) || 0;
    const line = this.row(
      [label, { v: value, s: 'inpMoney' }, cur, '', spec.note ? DealXlsxCalc.note(spec.note) : ''],
      key,
    );
    this.rows[line - 1][3] = { f: this.rub(key, cur), v: value * DealXlsxCalc.num(this.calc.rate(cur)), s: 'money' };
    return cur;
  }

  _plain(label, key, value, extra = '') {
    this.row(
      [label, { v: value, s: 'inpMoney' }, '₽', { f: this._self(), v: value, s: 'money' }, ...(extra ? [extra] : [])],
      key,
    );
  }

  _costs() {
    const calc = this.calc;
    const note = DealXlsxCalc.note;
    this._group('Монтаж, прочие расходы, оплата заказчика');
    this._plain('Монтаж и ПНР', 'M', calc.M);
    this._plain('Прочие расходы', 'E', calc.E);
    const docs = calc.Dc ? note(DealTerms.docKinds(this.deal) || 'проектная, рабочая, исполнительная') : '';
    this.row(
      [
        'Разработка документации',
        { v: calc.Dc, s: 'inpMoney' },
        '₽',
        { f: this._self(), v: calc.Dc, s: 'money' },
        docs,
      ],
      'DOC',
    );
    this.asmOn = !!(calc.asm && calc.asm.cost > 0);
    if (this.asmOn) {
      const asm = calc.asm;
      this._plain(
        `Сборка станции у «${asm.A.name}» (с НДС)`,
        'ASM',
        asm.cost,
        note(`Сборка ${asm.days} дн.; НДС ${calc.sv} % — к вычету`),
      );
    }
    this._plain('Прочий НДС к вычету', 'Vo', calc.Vo);
    this.row(['Резерв на гарантию', { v: calc.warrP, s: 'inp' }, '% выручки без НДС'], 'WARR');
    this.row(['Бонусы и комиссии с продажи', { v: calc.bonusP, s: 'inp' }, '% выручки без НДС'], 'BON');
    if (calc.BG > 0) this._plain('Банковская гарантия — комиссия банка', 'BG', calc.BG, note(this._bgNote()));
    this.xOn = this.res.K > 0;
    this.xMode = calc.xc.mode;
    if (this.xOn) this._cash();
  }

  _bgNote() {
    return this.calc.bgs
      .filter(guarantee => guarantee.fee > 0)
      .map(guarantee => {
        const plain = (((guarantee.amount * guarantee.rate) / DealXlsxCalc.PCT) * guarantee.days) / DealXlsxCalc.YEAR;
        const min = guarantee.fee > plain + DealXlsxCalc.EPS ? ` (минимальная ${Fmt.rub(guarantee.min)})` : '';
        return `${DealTerms.BG_TYPES[guarantee.type]}: ${Fmt.rub(guarantee.amount)} × ${DealFmt.inp(guarantee.rate)} % × ${guarantee.days} дн. / 365${min}`;
      })
      .join('; ');
  }

  // способ расчёта — как в программе, значение и стоимость наличных можно менять
  _cash() {
    const { calc, xMode } = this;
    const note = DealXlsxCalc.note;
    const sum = xMode === 'sum';
    this.row(
      [
        `Прочие расходы наличными, на руки — ${DealXlsxCalc.X_LABEL[xMode] || 'сумма'}`,
        { v: calc.xc.v, s: sum ? 'inpMoney' : 'inp' },
        sum ? '₽' : '%',
        '',
        note('Не уменьшают налог на прибыль; платятся после последней оплаты заказчика'),
      ],
      'XV',
    );
    this.row(
      [
        'Стоимость получения наличных',
        { v: calc.xc.cost, s: 'inp' },
        '%',
        '',
        note('Расход компании = на руки / (1 − %)'),
      ],
      'XCOST',
    );
    const fromPays = calc.xc.when === 'pay' && calc.xc.from.length;
    this.row([
      'Когда выдаются наличные',
      { v: fromPays ? 'с оплат заказчика' : 'после последней оплаты', s: 'td' },
      '',
      '',
      note(DealXlsxCalc._cashWhen(fromPays, xMode)),
    ]);
  }

  static _cashWhen(fromPays, mode) {
    if (!fromPays) return 'На финансирование не влияют';
    return mode === 'net'
      ? 'Пропорционально оплатам; суммы в графике — по расчёту программы (от чистой прибыли — с учётом финансирования)'
      : 'Пропорционально суммам отмеченных оплат заказчика, в день оплаты';
  }

  /**
   * Ячейка доли этапа заказчика (у этапа суммой — в колонке D).
   * @param {string} key
   * @returns {string}
   */
  trRef(key) {
    return this.ref(key, this.at[`${key}col`] || 'B');
  }

  _customer() {
    const note = DealXlsxCalc.note;
    this.trKeys = [];
    this.calc.trs.forEach((stage, j) => {
      const key = `TR${j}`;
      this.trKeys.push(key);
      const name = `${stage.name || 'Оплата заказчика'}: этап ${j + 1} — ${DealTerms.EVENTS[stage.ev]}${stage.off ? ` + ${stage.off} дн.` : ''}`;
      if (stage.bySum) {
        const line = this.row(
          [name, { v: stage.sum, s: 'inpMoney' }, '₽', '', note('Сумма этапа; доля от цены — в колонке D')],
          `${key}s`,
        );
        this.rows[line - 1][3] = {
          f: `IF(${this.rubRef('S')}=0,0,${this.ref(`${key}s`)}/${this.rubRef('S')}*100)`,
          v: stage.p,
          s: 'money',
        };
        this.at[key] = line;
        this.at[`${key}col`] = 'D';
        return;
      }
      const rest = `100-${
        this.trKeys
          .slice(0, -1)
          .map(item => this.trRef(item))
          .join('-') || '0'
      }`;
      const value = stage.last ? { f: rest, v: stage.p, s: 'money' } : { v: stage.p, s: 'inp' };
      this.row([name, value, '%', '', stage.last ? note('Остаток до 100 %') : ''], key);
    });
  }

  _money() {
    const { calc, deal } = this;
    const note = DealXlsxCalc.note;
    const key = DealUi.key;
    const auto =
      calc.moneyAuto && key
        ? note(
            `(ключевая ставка ЦБ ${DealFmt.inp(key.rate)} % + ${DealDefaults.spread()} п.п.) × ${DealMoneyRate.text()}`,
          )
        : '';
    this.row(['Стоимость денег', { v: calc.i, s: 'inp' }, '% в месяц', '', auto], 'i');
    this.row(['Налог на прибыль', { v: calc.taxP, s: 'inp' }, '%'], 'TAX');
    this.row(
      [
        'Дата отсчёта — подписание договора (день 0)',
        { v: XlsxBook.date(deal.start), s: 'inpDate' },
        'дата',
        '',
        note('Даты платежей на листе «График платежей» = эта дата + день'),
      ],
      'D0',
    );
  }

  /**
   * Месяц для финансирования в формулах графика.
   * @returns {number}
   */
  static monthDays() {
    return DealValues.num('deal.monthDays', DealXlsxCalc.MONTH);
  }

  static MONTH = 30;
}

/** Блок поставщика на листе «Расчёт»: позиции, прочая закупка, логистика, таможня, этапы оплаты, сроки, НДС к вычету. */
export class DealXlsxSupplier {
  static DUTY_NOTE = 'С таможенной стоимости позиции (доля логистики и страхования — по цене)';

  /**
   * @param {DealXlsxCalc} sheet
   * @param {number} k номер поставщика
   */
  constructor(sheet, k) {
    this.sheet = sheet;
    this.k = k;
    this.sup = sheet.calc.sup[k];
    this.own = sheet.deal.sup[k];
    this.vf = this.sup.noVat ? `*(1+${sheet.ref('sv')}/100)` : '';
    this.eqKeys = [];
    this.fxKeys = [];
    this.lineKey = {};
  }

  _rub(key) {
    return this.sheet.rubRef(key);
  }

  /** Строки поставщика. */
  build() {
    const { sheet, sup, own, k } = this;
    const note = DealXlsxCalc.note;
    sheet.row(DealXlsxCalc.group(`Поставщик: ${sup.name}${sup.country ? ` · ${sup.country}` : ''}`));
    sup.lines.forEach((line, j) => this._line(line, j));
    this._extra();
    sheet.row(
      [
        { v: 'Оборудование, итого', s: 'bold' },
        '',
        '',
        { f: this.eqKeys.map(key => this._rub(key)).join('+') || '0', v: sup.equip, s: 'moneyB' },
        sup.noVat ? note('Цены поставщика без НДС — добавлен НДС') : '',
      ],
      `EQ${k}`,
    );
    const logCur = sheet.amount('Логистика до границы', `L${k}`, {
      field: own.log,
      note: 'Входит в таможенную стоимость',
    });
    sheet.amount('Доставка по России', `LRU${k}`, {
      field: own.logRu,
      note: sup.LruFx ? 'Своя сумма в валюте — в рубли по курсу (строка курса выше)' : '',
    });
    sheet.amount('Брокер, СВХ, сертификация', `BRK${k}`, { field: own.brk, cur: 'RUB' });
    this._insurance(logCur);
    new DealXlsxCustoms(this).build();
    this._stages();
    this._vat();
    this._total();
  }

  _line(line, j) {
    if (line.id === 'extra') return;
    const { sheet, k } = this;
    const item = sheet.kpData.items.find(row => row.id === line.id) || {};
    const cur = item.cur || 'RUB';
    const key = `it${k}_${j}`;
    const index = sheet.row(
      [
        `${line.name} × ${line.qty}`,
        { v: item.cost || 0, s: 'inpMoney' },
        `${cur} за ед.`,
        '',
        line.code ? DealXlsxCalc.note(`ТН ВЭД ${line.code}`) : '',
      ],
      key,
    );
    sheet.rows[index - 1][3] = { f: `${sheet.rub(key, cur)}*${line.qty}${this.vf}`, v: line.rub, s: 'money' };
    this.eqKeys.push(key);
    this.lineKey[line.id] = key;
    if (cur !== 'RUB') this.fxKeys.push(key);
  }

  _extra() {
    const { sheet, own, sup, k } = this;
    const field = own.extra || {};
    const value = InputNum.parse(field.v) || 0;
    if (!value && this.eqKeys.length) return;
    const cur = field.cur || 'RUB';
    const key = `ex${k}`;
    const index = sheet.row(
      [
        'Прочая закупка у поставщика',
        { v: value, s: 'inpMoney' },
        cur,
        '',
        DealXlsxCalc.note('Опции, ЗИП — то, чего нет в позициях КП'),
      ],
      key,
    );
    const vatK = sup.noVat ? 1 + sheet.calc.sv / DealXlsxCalc.PCT : 1;
    sheet.rows[index - 1][3] = {
      f: sheet.rub(key, cur) + this.vf,
      v: value * DealXlsxCalc.num(sheet.calc.rate(cur)) * vatK,
      s: 'money',
    };
    this.eqKeys.push(key);
    this.lineKey.extra = key;
    if (cur !== 'RUB') this.fxKeys.push(key);
  }

  _self() {
    return `B${this.sheet.rows.length + 1}`;
  }

  _insurance(logCur) {
    const { sheet, own, sup, k } = this;
    sheet.row(
      [
        'Страхование груза',
        { v: InputNum.parse(own.ins) || 0, s: 'inp' },
        '% от оборудования',
        { f: `${this._rub(`EQ${k}`)}*${this._self()}/100`, v: sup.ins, s: 'money' },
      ],
      `INS${k}`,
    );
    const fxBase =
      [...this.fxKeys.map(key => this._rub(key)), logCur !== 'RUB' ? this._rub(`L${k}`) : null]
        .filter(Boolean)
        .join('+') || '0';
    sheet.row(
      [
        'Комиссия банка или агента за перевод',
        { v: InputNum.parse(own.fx) || 0, s: 'inp' },
        '% от платежа в валюте',
        { f: `(${fxBase})*${this._self()}/100`, v: sup.fxE + sup.fxL, s: 'money' },
      ],
      `FX${k}`,
    );
  }

  _stages() {
    const { sheet, sup, k } = this;
    const note = DealXlsxCalc.note;
    const keys = [];
    sup.stages.forEach(stage => {
      const key = `sp${k}_${stage.j}`;
      keys.push(key);
      const event = DealTerms.SUP_EVENTS[stage.ev] + (stage.off ? ` + ${stage.off} дн.` : '');
      const dup = stage.name && event.toLowerCase().includes(stage.name.toLowerCase());
      const rest = `100-${
        keys
          .slice(0, -1)
          .map(item => sheet.ref(item))
          .join('-') || '0'
      }`;
      sheet.row(
        [
          `Оплата поставщику: этап ${stage.j + 1} — ${stage.name && !dup ? `${stage.name}, ` : ''}${event}`,
          stage.last ? { f: rest, v: stage.p, s: 'money' } : { v: stage.p, s: 'inp' },
          '%',
          '',
          note(stage.last ? 'Остаток до 100 % от оборудования' : 'Доля от оборудования (с комиссией за перевод)'),
        ],
        key,
      );
    });
    sheet.row(['Изготовление', { v: sup.prod, s: 'inpInt' }, 'дней'], `prod${k}`);
    sheet.row(['Доставка', { v: sup.ship, s: 'inpInt' }, 'дней'], `ship${k}`);
  }

  _vat() {
    const { sheet, own, sup, k } = this;
    const note = DealXlsxCalc.note;
    const vatK = sheet.vatK;
    if (own.vatIn) {
      const value = sup.voAuto
        ? { f: `${this._rub(`EQ${k}`)}*${vatK}`, v: sup.vo, s: 'inpMoney' }
        : { v: sup.vo, s: 'inpMoney' };
      sheet.row(
        [
          'НДС поставщика к вычету',
          value,
          '₽',
          { f: this._self(), v: sup.vo, s: 'money' },
          sup.voAuto ? note('НДС в стоимости оборудования') : '',
        ],
        `vo${k}`,
      );
    }
    const ins = sup.LruIns > 0 ? `-${Math.round(sup.LruIns)}` : '';
    const value = sup.voRuAuto
      ? { f: `(${this._rub(`LRU${k}`)}${ins}+${this._rub(`BRK${k}`)})*${vatK}`, v: sup.voRu, s: 'inpMoney' }
      : { v: sup.voRu, s: 'inpMoney' };
    const tail =
      sup.LruIns > 0
        ? [note(`Без страховой премии ${Money.int(sup.LruIns)} ₽ в доставке: страхование НДС не облагается`)]
        : [];
    sheet.row(
      ['НДС к вычету по услугам в России', value, '₽', { f: this._self(), v: sup.voRu, s: 'money' }, ...tail],
      `voru${k}`,
    );
  }

  _total() {
    const { sheet, sup, k } = this;
    const fxE = this.fxKeys.length
      ? `(${this.fxKeys.map(key => this._rub(key)).join('+')})*${sheet.ref(`FX${k}`)}/100`
      : '0';
    const parts = ['EQ', 'FX', 'INS', 'L', 'T', 'BRK', 'LRU'].map(part => this._rub(part + k)).join('+');
    sheet.row(
      [{ v: 'Платежи поставщику, доставка и таможня', s: 'bold' }, '', '', { f: parts, v: sup.cash, s: 'moneyB' }],
      `CASH${k}`,
    );
    sheet.custOut.push({ k, fxE });
  }
}
