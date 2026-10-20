import { DealValues } from './deal-values.js';
import { DealXlsxCalc, DealXlsxSupplier } from './deal-xlsx-calc.js';

/** Таможня поставщика на листе «Расчёт» — по режиму: расчёт по ТН ВЭД, ЕАЭС, нет, суммой целиком. */
export class DealXlsxCustoms {
  static MODES = { calc: '_calc', eaeu: '_eaeu', none: '_none' };

  /**
   * @param {DealXlsxSupplier} block
   */
  constructor(block) {
    this.block = block;
    this.sheet = block.sheet;
    this.sup = block.sup;
    this.k = block.k;
  }

  _rub(key) {
    return this.sheet.rubRef(key);
  }

  _self() {
    return `B${this.sheet.rows.length + 1}`;
  }

  /** Строки таможни. */
  build() {
    const method = DealXlsxCustoms.MODES[this.sup.mode] || '_sum';
    this[method]();
  }

  _calc() {
    const { sheet, sup, k } = this;
    const note = DealXlsxCalc.note;
    sheet.row(
      [
        'Таможенная стоимость',
        '',
        '',
        { f: `${this._rub(`EQ${k}`)}+${this._rub(`L${k}`)}+${this._rub(`INS${k}`)}`, v: sup.cv, s: 'money' },
        note('Оборудование + логистика до границы + страхование'),
      ],
      `CV${k}`,
    );
    const keys = [];
    sup.lines.forEach((line, j) => this._duty(line, j, keys));
    sheet.row(
      [
        'Пошлина, итого',
        '',
        '',
        { f: keys.map(key => this._rub(key)).join('+') || '0', v: sup.dutyA, s: 'money' },
        note(DealXlsxSupplier.DUTY_NOTE),
      ],
      `DU${k}`,
    );
    this._fee();
    sheet.row(
      [
        'НДС на ввоз',
        { v: sup.ivP, s: 'inp' },
        '%',
        { f: `(${this._rub(`CV${k}`)}+${this._rub(`DU${k}`)})*${this._self()}/100`, v: sup.ivatA, s: 'money' },
        note('(Таможенная стоимость + пошлина) × ставка. Возвращается вычетом'),
      ],
      `IV${k}`,
    );
    sheet.row(
      [
        { v: 'Таможенные платежи', s: 'bold' },
        '',
        '',
        { f: `${this._rub(`DU${k}`)}+${this._rub(`FE${k}`)}+${this._rub(`IV${k}`)}`, v: sup.T, s: 'moneyB' },
      ],
      `T${k}`,
    );
    sheet.row(['Ввозной НДС к вычету', '', '', { f: this._rub(`IV${k}`), v: sup.vi, s: 'money' }], `vi${k}`);
  }

  _duty(line, j, keys) {
    const { sheet, k } = this;
    const lineKey = this.block.lineKey[line.id];
    if (!lineKey) return;
    const key = `du${k}_${j}`;
    keys.push(key);
    const known = Number.isFinite(line.duty);
    const text =
      (line.code ? `ТН ВЭД ${line.code}. ` : '') +
      (line.dutyAuto ? 'Средняя ставка позиций поставщика. ' : '') +
      (known ? '' : 'Ставка не указана — 0 %');
    const equip = this._rub(`EQ${k}`);
    sheet.row(
      [
        `Пошлина: ${line.name}`,
        { v: known ? line.duty : 0, s: 'inp' },
        '%',
        {
          f: `IF(${equip}=0,0,${this._rub(lineKey)}*${this._rub(`CV${k}`)}/${equip})*${this._self()}/100`,
          v: line.dutyA,
          s: 'money',
        },
        DealXlsxCalc.note(text),
      ],
      key,
    );
  }

  _fee() {
    const { sheet, sup, k } = this;
    const scale = DealValues.feeScale();
    const lims = [0, ...scale.slice(0, -1).map(row => row[0] + 0.01)];
    const fees = scale.map(row => row[1]);
    const costCell = this._rub(`CV${k}`);
    const value = sup.feeAuto
      ? {
          f: `IF(${costCell}<=0,0,LOOKUP(${costCell},{${lims.join(',')}},{${fees.join(',')}}))`,
          v: sup.fee,
          s: 'inpMoney',
        }
      : { v: sup.fee, s: 'inpMoney' };
    const own = DealValues.feeOwn() ? ' (шкала изменена в «Настройках»)' : '';
    const text = sup.feeAuto ? `По шкале ${DealValues.FEE_TITLE}${own}` : 'Вписан вручную';
    sheet.row(
      ['Таможенный сбор', value, '₽', { f: this._self(), v: sup.fee, s: 'money' }, DealXlsxCalc.note(text)],
      `FE${k}`,
    );
  }

  _eaeu() {
    const { sheet, sup, k } = this;
    sheet.row(
      [
        'НДС при ввозе из ЕАЭС',
        { v: sup.ivP, s: 'inp' },
        '%',
        { f: `${this._rub(`EQ${k}`)}*${this._self()}/100`, v: sup.ivatA, s: 'money' },
        DealXlsxCalc.note('Пошлины и сбора нет; НДС платится в налоговую и возвращается вычетом'),
      ],
      `IV${k}`,
    );
    sheet.row(
      [{ v: 'Таможенные платежи', s: 'bold' }, '', '', { f: this._rub(`IV${k}`), v: sup.T, s: 'moneyB' }],
      `T${k}`,
    );
    sheet.row(['Ввозной НДС к вычету', '', '', { f: this._rub(`IV${k}`), v: sup.vi, s: 'money' }], `vi${k}`);
  }

  _none() {
    const { sheet, k } = this;
    sheet.row(
      ['Таможенные платежи', '', '', { v: 0, s: 'money' }, DealXlsxCalc.note('Поставка по России — таможни нет')],
      `T${k}`,
    );
    sheet.row(['Ввозной НДС к вычету', '', '', { v: 0, s: 'money' }], `vi${k}`);
  }

  _sum() {
    const { sheet, sup, k } = this;
    sheet.amount('Таможенные платежи целиком', `T${k}`, {
      field: this.block.own.cus,
      note: 'Пошлина, сбор и ввозной НДС одной суммой',
    });
    const unknown = sup.vi == null;
    sheet.row(
      [
        'Ввозной НДС к вычету',
        unknown ? { v: '', s: 'inpMoney' } : { v: sup.vi, s: 'inpMoney' },
        '₽',
        { f: this._self(), v: sup.vi || 0, s: 'money' },
        unknown ? DealXlsxCalc.note('Не указан: в файле считается 0 — прибыль минимальная') : '',
      ],
      `vi${k}`,
    );
  }
}
