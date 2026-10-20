import { DealTerms } from './deal-terms.js';
import { DealValues } from './deal-values.js';
import { TnVed } from './tn-ved.js';

/**
 * Расчёт одного поставщика сделки: закупка по позициям, прочая закупка, перевозка, этапы оплаты, таможня по режиму, НДС к
 * вычету, сроки. Поля с ошибками и курсы — через общий расчёт сделки (DealCalculator): порядок чтения полей важен.
 */
export class SupplierCalc {
  static MODES = ['calc', 'eaeu', 'none', 'sum'];
  static PCT = 100;
  static EPS = 0.005;
  static PAY_EPS = 0.0001;
  static IVAT = 22;

  /**
   * @param {object} calc расчёт сделки (DealCalculator)
   * @param {object} supplier поставщик из S.deal.sup
   * @param {number} index номер поставщика
   */
  constructor(calc, supplier, index) {
    this.calc = calc;
    this.sup = supplier;
    this.index = index;
    this.path = `sup.${index}`;
  }

  _num(path, value, opts) {
    return this.calc.num(path, value, opts);
  }

  _money(path, value, cur) {
    return this.calc.money(path, value, cur);
  }

  /**
   * Все величины поставщика.
   * @param {Function} supOf позиция → id поставщика
   * @returns {object}
   */
  run(supOf) {
    const sup = this.sup;
    this.mode = SupplierCalc.MODES.includes(sup.cusMode) ? sup.cusMode : 'sum';
    this.vatK = 1 + this.calc.supVat() / SupplierCalc.PCT;
    this._items(supOf);
    this._extra();
    this._transport();
    this._terms();
    this._stages();
    this._customs();
    this._vat();
    return this._result();
  }

  _items(supOf) {
    const kpData = this.calc.kp;
    const sup = this.sup;
    this.items = (kpData.items || []).filter(item => supOf(item.id) === sup.id);
    // цены поставщика без НДС — только у поставщика в России: у ввозимого НДС считается при ввозе
    this.noVat = this.mode === 'none' && (sup.noVat != null ? !!sup.noVat : !!kpData.costNoVat);
    Object.assign(this, { byCur: {}, equip: 0, equipFx: 0, noCost: [], lines: [] });
    for (const item of this.items) this._item(item);
  }

  _item(item) {
    const qty = +item.qty || 0;
    if (!(item.cost > 0)) {
      this.noCost.push(item);
      return;
    }
    const cur = item.cur || 'RUB';
    this.calc.used.add(cur);
    this.byCur[cur] = (this.byCur[cur] || 0) + item.cost * qty;
    const rate = this.calc.rate(cur);
    if (!(rate > 0)) {
      this.calc.err[`${this.path}.rate`] = `Нет курса ${cur}`;
      return;
    }
    const rub = item.cost * qty * rate * (this.noVat ? this.vatK : 1);
    this.equip += rub;
    if (cur !== 'RUB') this.equipFx += rub;
    this.lines.push(this._line(item, qty, rub));
  }

  _line(item, qty, rub) {
    const special = this._special(item);
    const duty = special && !(item.duty >= special.duty) ? special.duty : item.duty;
    return { id: item.id, name: item.name, qty, rub, duty, code: item.code || '', special };
  }

  _special(item) {
    if (this.mode !== 'calc') return null;
    return TnVed.special(item.code, this.sup.country, this.calc.kp.date || '');
  }

  _extra() {
    const sup = this.sup;
    const path = this.path;
    const extra = this._num(`${path}.extra`, sup.extra && sup.extra.v, { def: 0 });
    if (extra) {
      const cur = sup.extra.cur || 'RUB';
      this.byCur[cur] = (this.byCur[cur] || 0) + extra;
    }
    const rub = this._money(`${path}.extra`, sup.extra) * (this.noVat ? this.vatK : 1);
    this.equip += rub;
    if (((sup.extra && sup.extra.cur) || 'RUB') !== 'RUB') this.equipFx += rub;
    if (rub) this.lines.push(this._extraLine(rub));
  }

  // прочая закупка (опции, ЗИП): своя ставка пошлины или средняя по стоимости позиций с известной ставкой
  _extraLine(rub) {
    const own = this.mode === 'calc' ? this._num(`${this.path}.duty`, this.sup.duty, { max: SupplierCalc.PCT }) : null;
    const withDuty = this.lines.filter(line => line.duty != null && !Number.isNaN(line.duty));
    const base = withDuty.reduce((sum, line) => sum + line.rub, 0);
    const average = base > 0 ? withDuty.reduce((sum, line) => sum + line.rub * line.duty, 0) / base : null;
    return {
      id: 'extra',
      name: 'Прочая закупка у поставщика',
      qty: 1,
      rub,
      duty: own != null ? own : average,
      dutyAuto: own == null && base > 0,
      code: String(this.sup.hsx || '').trim(),
    };
  }

  // доставка по России: «по расчёту» — рубли; «своя сумма» — в рублях или валюте, в рубли по курсу
  _transport() {
    const sup = this.sup;
    const path = this.path;
    this.L = this._money(`${path}.log`, sup.log);
    this.Lfx = ((sup.log && sup.log.cur) || 'RUB') !== 'RUB' ? this.L : 0;
    this.Lru = this._money(`${path}.logRu`, sup.logRu);
    this.LruFx = ((sup.logRu && sup.logRu.cur) || 'RUB') !== 'RUB';
    this.brk = this._money(`${path}.brk`, sup.brk, 'RUB');
  }

  _terms() {
    const sup = this.sup;
    const path = this.path;
    const pct = { def: 0, max: SupplierCalc.PCT };
    const days = { def: 0, int: true };
    this.adv = this._num(`${path}.adv`, sup.adv, pct);
    this.prod = this._num(`${path}.prod`, sup.prod, days);
    this.ship = this._num(`${path}.ship`, sup.ship, days);
    const insPct = this._num(`${path}.ins`, sup.ins, pct);
    const fxPct = this._num(`${path}.fx`, sup.fx, pct);
    this.ins = (this.equip * insPct) / SupplierCalc.PCT;
    this.fxE = (this.equipFx * fxPct) / SupplierCalc.PCT;
    this.fxL = (this.Lfx * fxPct) / SupplierCalc.PCT;
  }

  _stages() {
    const raw = DealTerms.supPay(this.sup);
    let paySum = 0;
    this.stages = raw.map((stage, j) => {
      const last = j === raw.length - 1;
      const pct = last ? null : this._num(`${this.path}.pay.${j}.pct`, stage.pct, { def: 0, max: SupplierCalc.PCT });
      if (!last) paySum += pct;
      return {
        j,
        p: pct,
        last,
        name: String(stage.name || '').trim(),
        ev: DealTerms.SUP_EVENTS[stage.ev] ? stage.ev : 'ready',
        off: this._num(`${this.path}.pay.${j}.off`, stage.off, { def: 0, int: true }),
        offK: stage.offK === 'work' ? 'work' : '',
      };
    });
    if (paySum > SupplierCalc.PCT + SupplierCalc.PAY_EPS) {
      this.calc.err[`${this.path}.pay`] = 'Сумма этапов оплаты поставщику больше 100 %';
    }
    this.stages[this.stages.length - 1].p = Math.max(0, SupplierCalc.PCT - paySum);
  }

  static CUSTOMS = { calc: '_byLines', eaeu: '_eaeu', none: '_inRussia', sum: '_bySum' };

  // таможня: по позициям (пошлина у каждой своя), ЕАЭС (только НДС), сумма целиком или нет (Россия)
  _customs() {
    Object.assign(this, { T: 0, vi: null, cv: 0, dutyA: 0, fee: 0, feeAuto: true, ivatA: 0, noDuty: [] });
    this.ivP = this._num(`${this.path}.ivat`, this.sup.ivat, { def: SupplierCalc.IVAT, max: SupplierCalc.PCT });
    this[SupplierCalc.CUSTOMS[this.mode]]();
  }

  // логистика до границы и страхование — в таможенную стоимость пропорционально цене
  _byLines() {
    const add = this.L + this.ins;
    for (const line of this.lines) this._lineDuty(line, add);
    if (!this.lines.length) this.cv = add;
    const feeOwn = this._num(`${this.path}.fee`, this.sup.fee);
    this.feeAuto = feeOwn == null;
    this.fee = this.feeAuto ? DealValues.fee(this.cv) : feeOwn;
    this.ivatA = ((this.cv + this.dutyA) * this.ivP) / SupplierCalc.PCT;
    this.T = this.dutyA + this.fee + this.ivatA;
    this.vi = this.ivatA;
  }

  _lineDuty(line, add) {
    line.cv = line.rub + (this.equip > 0 ? (add * line.rub) / this.equip : 0);
    const duty = line.duty;
    if (duty == null || Number.isNaN(duty)) {
      this.noDuty.push(line);
      line.dutyA = 0;
    } else line.dutyA = (line.cv * duty) / SupplierCalc.PCT;
    this.cv += line.cv;
    this.dutyA += line.dutyA;
  }

  // ЕАЭС: пошлины и сбора нет, НДС при ввозе — в налоговую, к вычету
  _eaeu() {
    this.cv = this.equip;
    this.ivatA = (this.equip * this.ivP) / SupplierCalc.PCT;
    this.T = this.ivatA;
    this.vi = this.ivatA;
  }

  _inRussia() {
    this.vi = 0;
  }

  _bySum() {
    this.T = this._money(`${this.path}.cus`, this.sup.cus);
    this.vi = this._num(`${this.path}.vi`, this.sup.vi);
    if (this.vi == null && !this.T) this.vi = 0;
    if (this.vi != null && this.vi > this.T + SupplierCalc.EPS)
      this.calc.err[`${this.path}.vi`] = 'Не больше суммы растаможки';
  }

  _vat() {
    const sup = this.sup;
    const path = this.path;
    this.suggest = sup.vatIn ? this.calc.inSupVat(this.equip) : 0;
    this.vo = sup.vatIn ? this._num(`${path}.vo`, sup.vo) : 0;
    this.voAuto = sup.vatIn && this.vo == null;
    if (this.voAuto) this.vo = this.suggest;
    if (this.vo > this.equip + SupplierCalc.EPS) this.calc.err[`${path}.vo`] = 'Не больше стоимости оборудования';
    // страховая премия — без НДС (НК РФ, ст. 149); в своей сумме менеджера её не выделить
    this.LruIns =
      sup.logRu && sup.logRu.src === 'module'
        ? Math.min(this.Lru, this._num(`${path}.logRu.ins`, sup.logRu.ins, { def: 0 }))
        : 0;
    this.ruSuggest = this.calc.inSupVat(this.Lru - this.LruIns + this.brk);
    this.voRu = this._num(`${path}.voRu`, sup.voRu);
    this.voRuAuto = this.voRu == null;
    if (this.voRuAuto) this.voRu = this.ruSuggest;
    if (this.voRu > this.Lru + this.brk + SupplierCalc.EPS)
      this.calc.err[`${path}.voRu`] = 'Не больше суммы услуг в России';
  }

  _dates() {
    const sup = this.sup;
    this.prodK = sup.prodK === 'work' ? 'work' : '';
    this.shipK = sup.shipK === 'work' ? 'work' : '';
    this.rdy = this.calc.addD(0, this.prod, this.prodK);
    this.arr = this.calc.addD(this.rdy, this.ship, this.shipK);
  }

  static FIELDS = [
    'items',
    'noCost',
    'lines',
    'byCur',
    'noVat',
    'equip',
    'equipFx',
    'L',
    'Lru',
    'LruFx',
    'brk',
    'T',
    'adv',
    'prod',
    'ship',
    'prodK',
    'shipK',
    'rdy',
    'arr',
    'ins',
    'fxE',
    'fxL',
    'stages',
    'mode',
  ];
  static TAIL = [
    'cv',
    'dutyA',
    'fee',
    'feeAuto',
    'ivatA',
    'ivP',
    'noDuty',
    'vi',
    'vo',
    'voAuto',
    'suggest',
    'voRu',
    'voRuAuto',
    'ruSuggest',
    'LruIns',
  ];

  _result() {
    this._dates();
    const sup = this.sup;
    const cash = this.equip + this.fxE + this.fxL + this.ins + this.L + this.T + this.brk + this.Lru;
    const pick = keys => Object.fromEntries(keys.map(key => [key, this[key]]));
    return {
      id: sup.id,
      name: (sup.name || '').trim() || `Поставщик ${this.index + 1}`,
      country: sup.country || '',
      ...pick(SupplierCalc.FIELDS),
      calc: this.mode === 'calc',
      ...pick(SupplierCalc.TAIL),
      cash,
      active: cash > 0,
    };
  }
}
