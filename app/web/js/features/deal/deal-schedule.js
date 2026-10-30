import { DealCalcBase } from './deal-calc-base.js';
import { DealTerms } from './deal-terms.js';
import { DealValues } from './deal-values.js';
import { InputNum } from './input-num.js';

/**
 * График сделки: платежи поставщикам и заказчику, банковские гарантии, дни платежей по календарю, финансирование и
 * прочие расходы наличными в графике.
 */
export class DealSchedule extends DealCalcBase {
  static BG_ADV = 100;
  static BG_PCT = 10;
  static BG_WARR_DAYS = 365;
  static BG_PERF_EXTRA = 30;
  static YEAR = 365;
  static MONTH = 30;
  static PCT_EPS = 0.0001;
  static DEFER = '30';

  /** Платежи поставщикам (этапы, перевозка, таможня, доставка по России), сборка, документация, монтаж. */
  supplierRows() {
    const active = this.S_.filter(sup => sup.active);
    this.rows = [];
    let delivery = 0;
    let ready = 0;
    for (const sup of active) {
      if (sup.toAsm) continue;
      delivery = Math.max(delivery, sup.arr);
      ready = Math.max(ready, sup.rdy);
    }
    this.D = delivery;
    this.Rdy = ready;
    this.pnrK = this.d.pnrK === 'work' ? 'work' : '';
    this.pnrEnd = this.addD(delivery, this.pnrDays, this.pnrK);
    for (const sup of active) this._supRows(sup, active.length > 1 ? ` «${sup.name}»` : '');
    this._otherRows();
  }

  _supRows(sup, name) {
    const base = sup.equip + sup.fxE;
    const events = { order: 0, ready: sup.rdy, delivery: sup.arr, pnr: this.pnrEnd };
    for (const stage of sup.stages) this._stageRow(sup, stage, { base, events, name });
    const before = sup.fxL + sup.ins + sup.L + sup.T + sup.brk;
    if (before > 0) {
      const label = (sup.T ? 'Перевозка, таможня и сборы' : 'Перевозка и сборы') + name;
      this.rows.push({
        key: `log:${sup.id}`,
        auto: sup.rdy,
        label,
        amount: -before,
        party: 'log',
        ev: 'перед отгрузкой',
      });
    }
    if (sup.Lru > 0) {
      this.rows.push({
        key: `ru:${sup.id}`,
        auto: sup.arr,
        label: `Доставка по России${name}`,
        amount: -sup.Lru,
        party: 'log',
        ev: 'при поставке',
      });
    }
  }

  _stageRow(sup, stage, { base, events, name }) {
    const amount = (base * stage.p) / DealCalcBase.PCT;
    if (!(amount > 0)) return;
    const title = stage.name || this._stageName(sup, stage);
    const lower = title.charAt(0).toLowerCase() + title.slice(1);
    this.rows.push({
      key: `sp:${sup.id}:${stage.j}`,
      auto: this.addD(events[stage.ev], stage.off, stage.offK),
      label: `Поставщику: ${lower} ${DealTerms.pctText(stage.p)}${name}`,
      amount: -amount,
      party: 'sup',
      ev: DealTerms.SUP_EVENTS[stage.ev] + this._offText(stage),
    });
  }

  _stageName(sup, stage) {
    if (stage.j === 0 && stage.ev === 'order') return 'Аванс';
    return stage.last && sup.stages.length > 1 ? 'Остаток' : 'Оплата';
  }

  _offText(stage) {
    return stage.off ? ` + ${stage.off}${DealCalcBase.dayUnit(stage.offK)}` : '';
  }

  _otherRows() {
    const asm = this.asmC;
    const rows = this.rows;
    if (asm && asm.cost > 0) {
      rows.push({
        key: 'asm',
        auto: asm.end,
        label: `Сборка станции у «${asm.A.name}»`,
        amount: -asm.cost,
        party: 'sup',
        ev: 'после сборки',
      });
    }
    if (this.Dc > 0)
      rows.push({
        key: 'doc',
        auto: this.Rdy,
        label: 'Разработка документации',
        amount: -this.Dc,
        party: 'oth',
        ev: 'до отгрузки',
      });
    if (this.M + this.E > 0) {
      rows.push({
        key: 'mnt',
        auto: this.D,
        label: 'Монтаж, ПНР и прочие расходы',
        amount: -(this.M + this.E),
        party: 'oth',
        ev: 'при поставке',
      });
    }
  }

  /** Этапы оплаты заказчика: последний — остаток до 100 %; этап — процентом или суммой в рублях. */
  customerRows() {
    const deal = this.d;
    this.ev = { sign: 0, ready: this.Rdy, delivery: this.D, pnr: this.pnrEnd };
    const list =
      deal.cust && deal.cust.tr && deal.cust.tr.length
        ? deal.cust.tr
        : [{ pct: '', ev: 'delivery', off: DealSchedule.DEFER }];
    let pctSum = 0;
    this.trs = list.map((stage, k) => {
      const parsed = this._custStage(stage, k, k === list.length - 1);
      if (!parsed.last) pctSum += parsed.p;
      return parsed;
    });
    const rest = DealCalcBase.PCT - pctSum;
    if (rest < -DealSchedule.PCT_EPS) this.err['cust.tr'] = 'Сумма этапов больше 100 %';
    this.trs[this.trs.length - 1].p = Math.max(0, rest);
    for (const stage of this.trs) if (stage.p > 0) this.rows.push(this._custRow(stage));
    if (!this.rows.some(row => row.inflow)) {
      this.rows.push({
        key: 'c0',
        auto: this.D,
        label: 'Оплата заказчика',
        amount: 0,
        inflow: true,
        post: true,
        pct: DealCalcBase.PCT,
      });
    }
  }

  _custStage(stage, k, last) {
    const bySum = !last && stage.mode === 'sum';
    let pct = null;
    let sum = null;
    if (bySum) {
      sum = this.num(`cust.tr.${k}.sum`, stage.sum, { def: 0 });
      pct = this.S > 0 ? (sum / this.S) * DealCalcBase.PCT : 0;
    } else if (!last) pct = this.num(`cust.tr.${k}.pct`, stage.pct, { def: 0, max: DealCalcBase.PCT });
    const off = this.num(`cust.tr.${k}.off`, stage.off, { def: 0, int: true });
    const event = DealTerms.EVENTS[stage.ev] ? stage.ev : 'delivery';
    const offK = stage.offK === 'work' ? 'work' : '';
    return { k, p: pct, sum, bySum, name: String(stage.name || '').trim(), ev: event, off, offK, last };
  }

  _custRow(stage) {
    const event = DealTerms.EVENTS[stage.ev];
    return {
      key: `c${stage.k}`,
      auto: this.addD(this.ev[stage.ev], stage.off, stage.offK),
      label: `${stage.name || 'Оплата заказчика'} ${DealTerms.pctText(stage.p)} — ${event}${this._offText(stage)}`,
      amount: stage.bySum ? stage.sum : (this.S * stage.p) / DealCalcBase.PCT,
      inflow: true,
      post: stage.ev === 'delivery' || stage.ev === 'pnr',
      pct: stage.p,
      stage: stage.k,
      party: 'cust',
      ev: event + this._offText(stage),
    };
  }

  /** Банковские гарантии: сумма, срок, комиссия банка — строкой графика при подписании договора. */
  guarantees() {
    this.advSum = this.trs
      .filter(stage => stage.p > 0 && (stage.ev === 'sign' || stage.ev === 'ready'))
      .reduce((sum, stage) => sum + (stage.bySum ? stage.sum : (this.S * stage.p) / DealCalcBase.PCT), 0);
    this.bgs = (Array.isArray(this.d.bg) ? this.d.bg : []).map((guarantee, k) => this._guarantee(guarantee, k));
    this.BG = this.bgs.reduce((sum, guarantee) => sum + guarantee.fee, 0);
    for (const guarantee of this.bgs) {
      if (!(guarantee.fee > 0)) continue;
      this.rows.push({
        key: `bg:${guarantee.k}`,
        auto: 0,
        label: `Банковская гарантия ${DealTerms.BG_TYPES[guarantee.type].toLowerCase()} — комиссия банка`,
        amount: -guarantee.fee,
        party: 'oth',
        ev: 'при подписании договора',
      });
    }
    if (this.bgs.some(guarantee => guarantee.base === 'adv') && !(this.advSum > 0)) {
      this.warn.push({
        t: 'Банковская гарантия на возврат аванса: у заказчика нет аванса — укажите аванс в «Оплате заказчика» или сумму гарантии',
      });
    }
  }

  static BG_DEFAULT = {
    adv: () => DealValues.num('deal.bgAdvPct', DealSchedule.BG_ADV),
    pct: () => DealValues.num('deal.bgPct', DealSchedule.BG_PCT),
    sum: () => 0,
  };

  _guarantee(guarantee, k) {
    const path = `guarantee.${k}`;
    const type = DealTerms.BG_TYPES[guarantee.type] ? guarantee.type : 'adv';
    const base = this._bgBase(guarantee, type);
    const value = this.num(`${path}.v`, guarantee.v, {
      def: DealSchedule.BG_DEFAULT[base](),
      max: base === 'sum' ? null : DealCalcBase.PCT,
    });
    const amount = this._bgAmount(base, value);
    const daysAuto = this._bgDays(type);
    const daysOwn = this.num(`${path}.days`, guarantee.days, { int: true });
    const days = daysOwn == null ? daysAuto : daysOwn;
    const rate = this.num(`${path}.rate`, guarantee.rate, { def: DealTerms.bgRate(), max: DealCalcBase.PCT });
    const min = this.num(`${path}.min`, guarantee.min, { def: DealValues.num('deal.bgMin', 0) });
    const fee =
      amount > 0 && (rate > 0 || min > 0)
        ? Math.max(min, (((amount * rate) / DealCalcBase.PCT) * days) / DealSchedule.YEAR)
        : 0;
    return { k, type, base, v: value, amount, days, daysAuto, daysOwn: daysOwn != null, rate, min, fee };
  }

  _bgBase(guarantee, type) {
    if (['adv', 'pct', 'sum'].includes(guarantee.base)) return guarantee.base;
    return type === 'adv' ? 'adv' : 'pct';
  }

  _bgAmount(base, value) {
    if (base === 'adv') return (this.advSum * value) / DealCalcBase.PCT;
    return base === 'pct' ? (this.S * value) / DealCalcBase.PCT : value;
  }

  _bgDays(type) {
    if (type === 'adv') return this.D;
    if (type === 'perf')
      return this.pnrEnd + Math.round(DealValues.num('deal.bgPerfExtra', DealSchedule.BG_PERF_EXTRA));
    return Math.round(DealValues.num('deal.bgWarrDays', DealSchedule.BG_WARR_DAYS));
  }

  // по сроку или вручную; с календарём расчётный день переносится на рабочий, ручной нерабочий — помечается
  /** Дни платежей, резерв на гарантию и бонусы после последней оплаты заказчика. */
  days() {
    this.rows.forEach((row, k) => this._rowDay(row, k));
    const rows = this.rows;
    const end = Math.max(...rows.filter(row => row.inflow).map(row => row.day));
    this.Tend = end;
    if (this.Bn > 0) {
      rows.push({
        key: 'bonus',
        auto: end,
        day: end,
        fixed: true,
        label: 'Бонусы и комиссии с продажи',
        amount: -this.Bn,
        ord: rows.length,
      });
    }
    if (this.W > 0)
      rows.push({
        key: 'warr',
        auto: end,
        day: end,
        fixed: true,
        label: 'Резерв на гарантию',
        amount: -this.W,
        ord: rows.length,
      });
  }

  _dayOf(key, auto) {
    const own = this.d.days && this.d.days[key];
    const day = InputNum.parse(own);
    const valid = day != null && day >= 0 && Number.isInteger(day);
    if (own != null && own !== '' && (Number.isNaN(day) || day < 0 || !Number.isInteger(day))) {
      this.err[`days.${key}`] = 'Целое число дней';
    }
    return valid ? day : auto;
  }

  _rowDay(row, k) {
    const kpData = this.kp;
    row.day = this._dayOf(row.key, row.auto);
    row.manual = row.day !== row.auto;
    row.ord = k;
    if (!kpData.workShift) return;
    if (row.manual) {
      if (kpData.isOff && kpData.isOff(row.day)) row.offDay = true;
      return;
    }
    const work = kpData.workShift(row.day);
    if (work !== row.day) {
      row.shiftedFrom = row.day;
      row.day = work;
    }
  }

  /**
   * Строка прочих расходов наличными.
   * @param {object} row
   * @returns {boolean}
   */
  static isX(row) {
    return String(row.key).startsWith('xc');
  }

  static _tail(row) {
    if (DealSchedule.isX(row)) return 2;
    return row.key === 'bonus' || row.key === 'warr' ? 1 : 0;
  }

  // в один день: сначала деньги заказчика, потом платежи; постоплата — после платежей этого дня
  static _inRank(row) {
    if (!row.inflow) return 0;
    return row.post ? 1 : -1;
  }

  /**
   * Финансирование: простой процент на недостающие деньги по графику до последней оплаты заказчика.
   * @returns {number}
   */
  finance() {
    const rows = this.rows;
    const end = this.Tend;
    const month = DealValues.num('deal.monthDays', DealSchedule.MONTH);
    const tail = DealSchedule._tail;
    const rank = DealSchedule._inRank;
    rows.sort(
      (left, right) =>
        left.day - right.day || tail(left) - tail(right) || rank(left) - rank(right) || left.ord - right.ord,
    );
    let balance = 0;
    let total = 0;
    rows.forEach((row, k) => {
      balance += row.amount;
      row.balance = balance;
      const next = rows[k + 1];
      row.days = Math.max(0, Math.min(next ? next.day : end, end) - row.day);
      if (row.day >= end) row.days = 0;
      row.fin = (Math.max(0, -balance) * row.days * this.i) / DealCalcBase.PCT / month;
      total += row.fin;
    });
    return total;
  }

  /**
   * Прочие расходы наличными в графике: с оплат заказчика (пропорционально) или после последней оплаты.
   * @param {number} cost
   */
  setCash(cost) {
    const rows = this.rows;
    for (let k = rows.length - 1; k >= 0; k--) if (DealSchedule.isX(rows[k])) rows.splice(k, 1);
    if (!(cost > 0)) return;
    if (this.xBase > 0) {
      this.xFrom.forEach(row => rows.push(this._cashRow(row, cost)));
      return;
    }
    rows.push({
      key: 'xc',
      auto: this.Tend,
      day: this.Tend,
      fixed: true,
      label: 'Прочие расходы (наличные)',
      amount: -cost,
      party: 'oth',
      ord: rows.length,
    });
  }

  _cashRow(row, cost) {
    const stage = this.trs[row.stage];
    const name = stage && stage.name ? ` «${stage.name}»` : '';
    return {
      key: `xc:${row.key}`,
      auto: row.day,
      day: row.day,
      fixed: true,
      label: `Прочие расходы (наличные) — с оплаты ${DealTerms.pctText(row.pct || 0)}${name}`,
      amount: (-cost * row.amount) / this.xBase,
      party: 'oth',
      ord: this.rows.length,
      from: row.key,
    };
  }
}
