import { DealCalcBase } from './deal-calc-base.js';
import { DealSchedule } from './deal-schedule.js';

/**
 * Расчёт сделки: график платежей, финансирование, итоги, структура затрат. Финансирование — простой процент (месяц —
 * «Дней в месяце») на недостающие деньги по графику до последней оплаты заказчика; прочие расходы наличными меняют
 * финансирование, а финансирование — прибыль и сумму наличных: считается последовательными приближениями.
 */
export class DealCalculator extends DealSchedule {
  static X_ITER = 60;
  static X_EPS = 0.0005;
  static CHECK_EPS = 0.01;
  static PART_EPS = 0.004;
  static SOLVE_MIN = 1e5;
  static SOLVE_K = 4;
  static GROW_ITER = 40;
  static HALF_ITER = 80;
  static TO_CENTS = 100;

  /**
   * Итоги при заданном НДС к вычету.
   * @param {number} vatIn
   * @returns {object}
   */
  result(vatIn) {
    const revenue = this.R;
    const cnet = this.Ccash - vatIn;
    const ctot = cnet + this.F;
    const before = revenue - ctot;
    const vatBal = this.VATs - vatIn;
    const tax = before > 0 ? (before * this.taxP) / DealCalcBase.PCT : 0;
    const cashOut = this._cashSum(before, tax);
    const cost = cashOut * this.xG;
    const profit = before - cost;
    return {
      VATin: vatIn,
      Cnet: cnet,
      Ctot: ctot,
      Pa: before,
      X: cashOut,
      K: cost,
      P: profit,
      tax,
      net: before - tax - cost,
      markup: ctot + cost ? (profit / (ctot + cost)) * DealCalcBase.PCT : null,
      margin: revenue ? (profit / revenue) * DealCalcBase.PCT : null,
      vatBal,
      payable: Math.max(vatBal, 0),
      excess: Math.max(-vatBal, 0),
      cashAfter: this.S - this.Ccash - this.F - cost - Math.max(vatBal, 0),
    };
  }

  static X_BASE = {
    sum: (calc, value) => value,
    sale: (calc, value) => (calc.R * value) / DealCalcBase.PCT,
    salevat: (calc, value) => (calc.S * value) / DealCalcBase.PCT,
  };

  _cashSum(before, tax) {
    if (!this.xV) return 0;
    const base = DealCalculator.X_BASE[this.xMode];
    if (base) return base(this, this.xV);
    return (Math.max(0, before - tax) * this.xV) / DealCalcBase.PCT;
  }

  /**
   * Весь расчёт.
   * @returns {object}
   */
  run() {
    this.price();
    this.suppliers();
    this.assembly();
    this.expenses();
    this.supplierRows();
    this.customerRows();
    this.guarantees();
    this.days();
    this._cashFrom();
    this.F = this.finance();
    const equipSum = this.sumOf(sup => sup.equip);
    const asmCost = this.asmC ? this.asmC.cost : 0;
    this.Ccash = this.sumOf(sup => sup.cash) + this.M + this.E + this.Dc + this.W + this.Bn + this.BG + asmCost;
    const vat = this._vatIn(asmCost);
    this._iterate(vat);
    const base = vat.unknown.length ? null : this.lo;
    this._finalWarnings(base, equipSum);
    return this._out({ ...vat, base, equipSum, asmCost });
  }

  _cashFrom() {
    const cash = this.xc;
    this.xWhen = cash.when === 'pay' ? 'pay' : 'end';
    this.xOff = cash.off || {};
    this.xFrom =
      this.xWhen === 'pay'
        ? this.rows.filter(row => row.inflow && row.amount > 0 && this.xOff[row.stage] !== false)
        : [];
    this.xBase = this.xFrom.reduce((sum, row) => sum + row.amount, 0);
  }

  _vatIn(asmCost) {
    const voSup = this.sumOf(sup => sup.vo);
    const voRuSum = this.sumOf(sup => sup.voRu);
    const unknown = this.S_.filter(sup => sup.vi == null);
    // сборка — услуга в России с НДС
    const known = this.viSum + voSup + voRuSum + this.Vo + this.inSupVat(asmCost);
    const high = known + unknown.reduce((sum, sup) => sum + sup.T, 0);
    return { voSup, voRuSum, unknown, known, high };
  }

  // наличные в графике меняют финансирование, финансирование — прибыль и (от чистой прибыли) сумму наличных: до совпадения
  _iterate(vat) {
    const bounds = () => {
      this.lo = this.result(vat.known);
      this.hi = vat.unknown.length ? this.result(vat.high) : this.lo;
    };
    bounds();
    let given = 0;
    for (let step = 0; step < DealCalculator.X_ITER; step++) {
      const cost = this.lo.K;
      if (step > 0 && Math.abs(cost - given) < DealCalculator.X_EPS) break;
      given = cost;
      this.setCash(given);
      this.F = this.finance();
      bounds();
    }
  }

  _finalWarnings(base, equipSum) {
    const warn = this.warn;
    const low = this.lo;
    if (base && Math.abs(base.P - (base.cashAfter + base.excess)) > DealCalculator.CHECK_EPS) {
      warn.push({ t: 'Контрольное равенство не сошлось — сообщите разработчику', bad: true });
    }
    if (low.K > 0 && low.net < 0) {
      warn.push({
        t: `Прочие расходы наличными (${Money.rub(low.K)}) больше чистой прибыли сделки — компания в убытке`,
        bad: true,
      });
    }
    if (!(this.S > 0))
      warn.push({ t: 'Нет цены для заказчика: заполните цены в КП или укажите цену здесь', bad: true });
    if (!equipSum && !this.Lsum && !this.Tsum && !this.M && !this.E && !this.Dc) {
      warn.push({ t: 'Расходы не указаны: укажите цены закупки в шаге «Закупка»', go: 'price' });
    }
  }

  // структура затрат — для итога и Excel
  _parts(base, equipSum, asmCost) {
    const sumOf = this.sumOf;
    return [
      ['Оборудование', equipSum],
      ['Комиссии за перевод и конвертацию', sumOf(sup => sup.fxE + sup.fxL)],
      ['Страхование груза', sumOf(sup => sup.ins)],
      ['Логистика до границы', this.Lsum],
      ['Таможенные платежи', this.Tsum],
      ['Брокер, СВХ, сертификация', this.brkSum],
      ['Доставка по России', this.LruSum],
      ['Сборка станции', asmCost],
      ['Монтаж и ПНР', this.M],
      ['Разработка документации', this.Dc],
      ['Банковская гарантия', this.BG],
      ['Прочие расходы', this.E],
      ['Бонусы и комиссии с продажи', this.Bn],
      ['Резерв на гарантию', this.W],
      ['Финансирование', this.F],
      ['НДС к вычету (уменьшает затраты)', -(base || this.lo).VATin],
    ].filter(part => Math.abs(part[1]) > DealCalculator.PART_EPS);
  }

  static SAME = [
    'v',
    'vatFromKp',
    'rateSrc',
    'M',
    'E',
    'Dc',
    'Vo',
    'W',
    'Bn',
    'warrP',
    'bonusP',
    'taxP',
    'pnrDays',
    'pnrK',
    'pnrEnd',
    'trs',
    'ev',
    'i',
    'moneyAuto',
    'rows',
    'F',
    'D',
    'Rdy',
    'Tend',
    'R',
    'VATs',
    'Ccash',
    'Lsum',
    'LruSum',
    'brkSum',
    'Tsum',
  ];

  _out({ voSup, voRuSum, unknown, base, equipSum, asmCost }) {
    const same = Object.fromEntries(DealCalculator.SAME.map(key => [key, this[key]]));
    return {
      asm: this.asmC,
      bgs: this.bgs,
      BG: this.BG,
      advSum: this.advSum,
      xc: this._xcOut(),
      S: this.S,
      sv: this.supVat(),
      rate: cur => this.rate(cur),
      used: [...this.used].filter(cur => cur !== 'RUB'),
      sup: this.S_,
      ...same,
      equipSum,
      voSup,
      voRuSum,
      unknown,
      base,
      lo: this.lo,
      hi: this.hi,
      cashBefore: this.S - this.Ccash - this.F,
      parts: this._parts(base, equipSum, asmCost),
      err: this.err,
      warn: this.warn,
      ok: !Object.keys(this.err).length,
    };
  }

  _xcOut() {
    return {
      mode: this.xMode,
      when: this.xWhen,
      off: this.xOff,
      from: this.xFrom.map(row => row.key),
      v: this.xV,
      cost: this.xCost,
      g: this.xG,
      on: this.xV > 0,
    };
  }

  /**
   * Расчёт сделки.
   * @param {object} kpData
   * @param {object} deal
   * @returns {object}
   */
  static calc(kpData, deal) {
    return new DealCalculator(kpData, deal).run();
  }

  static GOALS = { margin: res => res.margin, markup: res => res.markup, net: res => res.net };

  /**
   * Цена с НДС, при которой показатель равен цели; null — недостижимо. Неизвестный ввозной НДС — по нижней границе.
   * @param {object} kpData
   * @param {object} deal
   * @param {string} type margin | markup | profit | net
   * @param {number} value
   * @returns {number|null}
   */
  static solve(kpData, deal, type, value) {
    const goal = DealCalculator.GOALS[type] || (res => res.P);
    const valueAt = price => {
      const calc = DealCalculator.calc(kpData, { ...deal, over: { ...deal.over, price: String(price) } });
      return goal(calc.base || calc.lo);
    };
    if (!Number.isFinite(value)) return null;
    let low = 0;
    let high = Math.max(DealCalculator.SOLVE_MIN, DealCalculator.calc(kpData, deal).Ccash * DealCalculator.SOLVE_K);
    for (let k = 0; k < DealCalculator.GROW_ITER && !(valueAt(high) >= value); k++) high *= 2;
    if (!(valueAt(high) >= value)) return null;
    for (let k = 0; k < DealCalculator.HALF_ITER; k++) {
      const mid = (low + high) / 2;
      const atMid = valueAt(mid);
      if (atMid == null || atMid < value) low = mid;
      else high = mid;
    }
    return Math.ceil(high * DealCalculator.TO_CENTS) / DealCalculator.TO_CENTS;
  }
}
