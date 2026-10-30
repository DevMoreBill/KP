import { DealTerms } from './deal-terms.js';
import { DealValues } from './deal-values.js';
import { InputNum } from './input-num.js';
import { SupplierCalc } from './supplier-calc.js';
import { IncomeTax } from '../../core/income-tax.js';
import { SellerTax } from '../../core/seller-tax.js';
import { KpEconomics } from '../kp/price-calc.js';

/**
 * Основа расчёта сделки: поля с проверкой, курсы, цена и НДС, поставщики, сборка станции, прочие расходы. Все суммы — в
 * рублях, полные платежи с налогами, без промежуточного округления; ошибки и предупреждения — в порядке, который видит
 * менеджер (методика — «Калькулятор расчёта экономики сделки», docs и правила 50-deal.md).
 */
export class DealCalcBase {
  static PCT = 100;
  static EPS = 0.005;
  static TAX = 25;
  static MONEY_FB = 2;
  static CASH_MAX = 90;
  static X_MODES = ['net', 'sale', 'salevat', 'sum'];

  /**
   * @param {object} kpData данные конструктора: { sumRub, vat, rates, costNoVat, items, moneyAuto, addWork… }
   * @param {object} deal S.deal — строки из полей
   */
  constructor(kpData, deal) {
    this.kp = kpData;
    this.d = DealTerms.upgrade(deal);
    this.err = {};
    this.warn = [];
    this.used = new Set();
    this.rateSrc = {};
  }

  /**
   * День через n дней (рабочих — по календарю КП).
   * @param {number} base
   * @param {number} days
   * @param {string} kind
   * @returns {number}
   */
  addD(base, days, kind) {
    return DealTerms.addDays(this.kp, base, days, kind);
  }

  /**
   * « дн.» или « раб. дн.».
   * @param {string} kind
   * @returns {string}
   */
  static dayUnit(kind) {
    return kind === 'work' ? ' раб. дн.' : ' дн.';
  }

  /**
   * Число из поля с проверкой; ошибка — в err[path], возвращается запасное значение.
   * @param {string} path
   * @param {*} text
   * @param {{def?: number, max?: number|null, int?: boolean}} [opts]
   * @returns {number|null}
   */
  num(path, text, opts = {}) {
    const value = InputNum.parse(text);
    if (value == null) return opts.def !== undefined ? opts.def : null;
    const problem = this._problem(value, opts);
    if (!problem) return value;
    this.err[path] = problem[0];
    return problem[1];
  }

  _problem(value, opts) {
    if (Number.isNaN(value)) return ['Число, например 12 400,50', opts.def ?? 0];
    if (value < 0) return ['Не может быть отрицательным', opts.def ?? 0];
    if (opts.max != null && value > opts.max) return [`Не больше ${opts.max}`, opts.max];
    if (opts.int && !Number.isInteger(value)) return ['Целое число дней', Math.round(value)];
    return null;
  }

  /**
   * Курс валюты к рублю: свой в расчёте сделки или из КП.
   * @param {string} cur
   * @returns {number}
   */
  rate(cur) {
    if (!cur || cur === 'RUB') return 1;
    const own = this.d.rates && this.d.rates[cur];
    if (own != null && own !== '') return this._ownRate(cur, own);
    const rate = InputNum.parse(this.kp.rates && this.kp.rates[cur]);
    this.rateSrc[cur] = 'kp';
    return rate > 0 ? rate : NaN;
  }

  _ownRate(cur, own) {
    const rate = InputNum.parse(own);
    if (!(rate > 0)) {
      this.err[`rates.${cur}`] = 'Курс больше 0';
      return NaN;
    }
    this.rateSrc[cur] = 'deal';
    return rate;
  }

  /**
   * Сумма в валюте → рубли.
   * @param {string} path
   * @param {{v?: string, cur?: string}} field
   * @param {string} [cur]
   * @returns {number}
   */
  money(path, field, cur) {
    const amount = this.num(path, field && field.v, { def: 0 });
    const code = cur || (field && field.cur) || 'RUB';
    if (amount) this.used.add(code);
    const rate = this.rate(code);
    if (amount && !(rate > 0)) {
      this.err[path] = this.err[path] || `Нет курса ${code}`;
      return 0;
    }
    return amount * (rate || 0);
  }

  /**
   * НДС в счёте российского поставщика, перевозчика, сборщика — по его ставке, а не по ставке НДС КП.
   * @returns {number}
   */
  supVat() {
    return DealValues.num('deal.supVat', KpEconomics.SUP_VAT);
  }

  /**
   * НДС внутри суммы с НДС поставщика.
   * @param {number} sum
   * @returns {number}
   */
  inSupVat(sum) {
    const vat = this.supVat();
    return (sum * vat) / (DealCalcBase.PCT + vat);
  }

  /** Цена с НДС и ставка НДС: своя в расчёте или из КП; вычет входного НДС и налог с результата — по налогообложению продавца. */
  price() {
    const over = this.d.over;
    this.S =
      over.price !== '' && over.price != null ? this.num('over.price', over.price, { def: 0 }) : this.kp.sumRub || 0;
    this.vatFromKp = over.vat === '' || over.vat == null;
    this.v = this.vatFromKp ? +this.kp.vat || 0 : this.num('over.vat', over.vat, { def: 0, max: DealCalcBase.PCT });
    this.vatK = 1 + this.v / DealCalcBase.PCT;
    this.sellerVat = String(this.kp.sellerVat ?? '');
    this.deduct = SellerTax.deducts(this.sellerVat);
    this.usn = IncomeTax.mode(this.kp.sellerUsn);
    this.taxBase = IncomeTax.of(this.usn).base;
  }

  /** Поставщики сделки; позиция без своего поставщика — к первому. */
  suppliers() {
    const deal = this.d;
    const sups = deal.sup && deal.sup.length ? deal.sup : [DealTerms.newSupplier('s1')];
    const supOf = id => {
      const own = deal.map && deal.map[id];
      return sups.some(sup => sup.id === own) ? own : sups[0].id;
    };
    this.S_ = sups.map((sup, k) => new SupplierCalc(this, sup, k).run(supOf));
  }

  // элементы станции едут к сборщику (обычно производитель контейнера), там собирают и испытывают, потом — заказчику
  /** Сборка станции: сборщик, сроки, стоимость; предупреждения по поставщикам. */
  assembly() {
    const asm = this.d.asm || {};
    const kitIds = new Set((this.kp.items || []).filter(item => item.kit).map(item => item.id));
    const asmSup = asm.on !== false && kitIds.size ? this._assembler(asm) : null;
    this.asmC = null;
    if (asm.on !== false && kitIds.size && !asmSup) {
      this.warn.push({
        t: 'Сборка станции: выберите, кто собирает станцию (производитель контейнера) — на вкладке «Закупка»',
        go: 'buy',
      });
    }
    if (asmSup) this._assemble(asm, asmSup, kitIds);
    this._supplierWarnings();
  }

  _assembler(asm) {
    const sups = this.S_;
    return (
      sups.find(sup => sup.id === asm.sup) ||
      sups.find(sup => sup.items.some(item => item.role === 'container')) ||
      null
    );
  }

  _assemble(asm, asmSup, kitIds) {
    const toAsm = this.S_.filter(sup => sup !== asmSup && sup.items.some(item => kitIds.has(item.id)));
    const days = this.num('asm.days', asm.days, { def: 0, int: true });
    const daysK = asm.daysK === 'work' ? 'work' : '';
    const cost = this.num('asm.cost.v', asm.cost && asm.cost.v, { def: 0 });
    toAsm.forEach(sup => {
      sup.toAsm = true;
      if (sup.items.some(item => !kitIds.has(item.id))) {
        this.warn.push({
          t: `${sup.name}: позиции не из станции тоже поедут на сборку — выберите для них другого поставщика или отключите сборку`,
        });
      }
    });
    const cRdy = asmSup.rdy;
    const start = Math.max(cRdy, ...toAsm.filter(sup => sup.active).map(sup => sup.arr));
    const end = this.addD(start, days, daysK);
    const late = toAsm.filter(sup => sup.active && sup.arr === start && start > cRdy);
    Object.assign(asmSup, { isAsm: true, active: true, cRdy, asmStart: start, rdy: end });
    asmSup.arr = this.addD(end, asmSup.ship, asmSup.shipK);
    this.asmC = { on: true, A: asmSup, toAsm, days, daysK, cost, start, end, cRdy, arr: asmSup.arr, late };
  }

  _supplierWarnings() {
    for (const sup of this.S_) {
      if (!sup.noDuty.length) continue;
      const count = sup.noDuty.length;
      this.warn.push({
        t: `${sup.name}: нет ставки пошлины у ${count} ${count === 1 ? 'позиции' : 'позиций'} — считается 0 %`,
      });
    }
    for (const sup of this.S_) {
      for (const item of sup.noCost) {
        this.warn.push({
          t: `«${item.name || 'Без названия'}»: не указана цена закупки — позиция не учтена в расходах`,
        });
      }
    }
  }

  /** Прочие расходы сделки, налоги, наличные, стоимость денег. */
  expenses() {
    const deal = this.d;
    const pct = { def: 0, max: DealCalcBase.PCT };
    this.M = this.num('mnt', deal.mnt, { def: 0 });
    this.E = this.num('oth', deal.oth, { def: 0 });
    this.Dc = this.num('doc', deal.doc, { def: 0 });
    this.pnrDays = this.num('pnr', deal.pnr, { def: 0, int: true });
    this.Vo = this.num('vo', deal.vo, { def: 0 });
    this.warrP = this.num('warr', deal.warr, pct);
    this.bonusP = this.num('bonus', deal.bonus, pct);
    this.taxP = this.usn
      ? IncomeTax.rate(this.usn, this.kp.sellerUsnRate)
      : this.num('tax', deal.tax, { def: DealValues.num('deal.tax', DealCalcBase.TAX), max: DealCalcBase.PCT });
    this._cashOut(deal.xc || {});
    const moneyOwn = this.num('money', deal.money);
    this.moneyAuto = moneyOwn == null;
    this.i = this.moneyAuto ? (this.kp.moneyAuto ?? DealValues.num('deal.moneyFb', DealCalcBase.MONEY_FB)) : moneyOwn;
    this.R = this.S / this.vatK;
    this.VATs = this.S - this.R;
    this.W = (this.R * this.warrP) / DealCalcBase.PCT;
    this.Bn = (this.R * this.bonusP) / DealCalcBase.PCT;
    this._sums();
  }

  _cashOut(cash) {
    this.xc = cash;
    this.xMode = DealCalcBase.X_MODES.includes(cash.mode) ? cash.mode : 'net';
    this.xV = this.num('xc.v', cash.v, { def: 0, max: this.xMode === 'sum' ? null : DealCalcBase.PCT });
    this.xCost = this.num('xc.cost', cash.cost, { def: DealValues.num('deal.xcCost', 0), max: DealCalcBase.CASH_MAX });
    this.xG = 1 / (1 - this.xCost / DealCalcBase.PCT);
  }

  _sums() {
    const sumOf = pick => this.S_.reduce((sum, sup) => sum + pick(sup), 0);
    this.sumOf = sumOf;
    this.viSum = sumOf(sup => sup.vi || 0);
    this.Tsum = sumOf(sup => sup.T);
    this.Lsum = sumOf(sup => sup.L);
    this.LruSum = sumOf(sup => sup.Lru);
    this.brkSum = sumOf(sup => sup.brk);
    const limit = this.Lsum + this.Tsum + this.M + this.E + this.Dc - this.viSum;
    if (this.Vo > limit + DealCalcBase.EPS) {
      this.err.vo = 'Не больше расходов на логистику, таможню, монтаж и прочее за вычетом ввозного НДС';
    }
  }
}
