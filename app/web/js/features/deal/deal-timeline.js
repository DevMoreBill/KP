import { DealCal } from './deal-cal.js';
import { DealFmt } from './deal-fmt.js';
import { DealTerms } from './deal-terms.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { DealDays } from './deal-days.js';

/**
 * Лента «Поставщики и сроки» на вкладке «Кратко»: у поставщика — производство и доставка (у сборщика — контейнер, ожидание
 * элементов, сборка, доставка станции), монтаж и ПНР, оплаты заказчика, ось дат без наложения подписей.
 */
export class DealTimeline {
  static PCT = 100;
  static MIN_W = 0.8;
  static LEFT = 0.18;
  static RIGHT = 0.9;
  static TICK_GAP = 0.07;
  static LOW_GAP = 0.12;
  static NAMES = 3;

  /**
   * @param {object} calc расчёт сделки
   * @param {Function} when день → дата или «день N»
   */
  constructor(calc, when) {
    this.calc = calc;
    this.when = when;
    this.active = calc.sup.filter(sup => sup.active || calc.sup.length === 1);
    this.end = Math.max(1, calc.Tend || 0, calc.pnrEnd || 0, calc.D || 0, ...this.active.map(sup => sup.arr));
  }

  /**
   * Строки ленты и ось.
   * @returns {string}
   */
  html() {
    const rows = this.active.map(sup => this._row(sup)).join('');
    return `${rows}${this._pnr()}${this._customer()}${this._axis()}`;
  }

  _left(day) {
    return `${Math.max(0, Math.min(DealTimeline.PCT, (day / this.end) * DealTimeline.PCT)).toFixed(2)}%`;
  }

  _width(from, target) {
    return `${Math.max(DealTimeline.MIN_W, ((target - from) / this.end) * DealTimeline.PCT).toFixed(2)}%`;
  }

  // отрезок: срок внутри (если помещается), подробности — во всплывающей подсказке
  _seg(cls, from, target, title) {
    if (!(target > from || cls === 'pr')) return '';
    const days = target - from;
    return `<i class="${cls}" style="left:${this._left(from)};width:${this._width(from, target)}" title="${esc(title)}: ${days} дн."><span>${days > 0 ? `${days} дн.` : ''}</span></i>`;
  }

  // подпись даты — под лентой у конца отрезка
  _endLabel(day, text, badge) {
    const left = day / this.end < DealTimeline.LEFT ? 'l' : '';
    const crit = badge && badge.text ? ` <b class="dlo-crit" title="${esc(badge.title || '')}">${badge.text}</b>` : '';
    return `<em class="${left}" style="left:${this._left(day)}">${text}${crit}</em>`;
  }

  _payText(sup) {
    return sup.stages
      .filter(stage => stage.p > 0)
      .map(stage => {
        const off = stage.off ? ` + ${stage.off} дн.` : '';
        return `${stage.name || DealTimeline._stageName(sup, stage)} ${DealTerms.pctText(stage.p)} — ${DealTerms.SUP_EVENTS[stage.ev]}${off}`;
      })
      .join('; ');
  }

  static _stageName(sup, stage) {
    if (stage.j === 0 && stage.ev === 'order') return 'аванс';
    return stage.last && sup.stages.length > 1 ? 'остаток' : 'оплата';
  }

  _names(sup) {
    if (!sup.lines.length) return 'позиции не выбраны';
    const names = sup.lines
      .map(line => line.name.replace(/^.*?: /, ''))
      .slice(0, DealTimeline.NAMES)
      .join(', ');
    const more = sup.lines.length > DealTimeline.NAMES ? ` и ещё ${sup.lines.length - DealTimeline.NAMES}` : '';
    return esc(names + more);
  }

  _row(sup) {
    const index = this.calc.sup.indexOf(sup);
    const extra = sup.L + sup.Lru + sup.T;
    return `<div class="dlo-r"><div class="dlo-rl"><b>${esc(sup.name)}</b><small>${this._names(sup)}</small>
          <small>закупка <b>${Fmt.rub(sup.equip)}</b>${extra > 0 ? ` · доставка и таможня ${Fmt.rub(extra)}` : ''}</small><small class="muted">${esc(this._payText(sup))}</small></div>
        ${sup.isAsm ? this._asmBar(sup) : this._bar(sup)}
        <button type="button" class="icon dlo-go" data-dlx="step" data-id="buy" data-sup="${index}" aria-label="Изменить условия поставщика" title="Изменить: закупка, сроки, оплата">›</button></div>`;
  }

  _asmBar(sup) {
    const when = this.when;
    const label = `${sup.name}: контейнер готов ${when(sup.cRdy)}, сборка ${when(sup.asmStart)} — ${when(sup.rdy)}, станция у заказчика ${when(sup.arr)}`;
    return `<div class="dlo-bar" role="img" aria-label="${esc(label)}">
          ${this._seg('pr', 0, sup.cRdy, 'Контейнер')}${this._seg('wt', sup.cRdy, sup.asmStart, 'Ждём элементы')}${this._seg('asm', sup.asmStart, sup.rdy, 'Сборка и испытания')}${this._seg('tr', sup.rdy, sup.arr, 'Доставка станции')}
          ${this._endLabel(sup.arr, `станция у заказчика ${when(sup.arr)}`)}</div>`;
  }

  _bar(sup) {
    const when = this.when;
    const where = sup.toAsm ? 'на сборке' : 'у заказчика';
    const label = `${sup.name}: готово к отгрузке ${when(sup.rdy)}, ${where} ${when(sup.arr)}`;
    const ship = this._seg(
      `tr${sup.toAsm ? ' toasm' : ''}`,
      sup.rdy,
      sup.arr,
      sup.toAsm ? 'Доставка на сборку' : 'Доставка',
    );
    return `<div class="dlo-bar" role="img" aria-label="${esc(label)}">
          ${this._seg('pr', 0, sup.rdy, 'Производство')}${ship}
          ${this._endLabel(sup.arr, `${where} ${when(sup.arr)}`, this._crit(sup))}</div>`;
  }

  _crit(sup) {
    const asm = this.calc.asm;
    if (asm) {
      const text = asm.late.includes(sup) ? 'последний на сборку' : '';
      return { text, title: 'Приезжает на сборку последним — от него зависит начало сборки' };
    }
    const text = this.calc.D === sup.arr && this.active.length > 1 ? 'срок изделия' : '';
    return { text, title: 'Самая долгая поставка — от неё зависит срок всего изделия' };
  }

  _pnr() {
    const calc = this.calc;
    if (!(calc.pnrDays > 0)) return '';
    return `<div class="dlo-r"><div class="dlo-rl"><b>Монтаж и ПНР</b><small>${calc.pnrDays} дн. после поставки</small></div><div class="dlo-bar">${this._seg('pnr', calc.D, calc.pnrEnd, 'Монтаж и ПНР')}${this._endLabel(calc.pnrEnd, `готово ${this.when(calc.pnrEnd)}`)}</div><span></span></div>`;
  }

  _customer() {
    const pays = this.calc.rows.filter(row => row.inflow && row.amount > 0);
    const total = pays.reduce((sum, row) => sum + row.amount, 0);
    const marks = pays
      .map(row => {
        const right = row.day / this.end > DealTimeline.RIGHT ? ' r' : '';
        const title = `${DealTerms.pctText(row.pct || 0)} — ${Fmt.rub(row.amount)}, ${this.when(row.day)}`;
        return `<span class="dlo-pay${right}" style="left:${this._left(row.day)}" title="${esc(title)}">${DealFmt.inp(row.pct || 0)} %</span>`;
      })
      .join('');
    return `<div class="dlo-r cust"><div class="dlo-rl"><b>Оплата заказчика</b><small>${pays.length} ${KPGen.plural(pays.length, 'платёж', 'платежа', 'платежей')}, всего ${Fmt.rub(total)}</small></div>
      <div class="dlo-bar">${marks}</div>
      <button type="button" class="icon dlo-go" data-dlx="step" data-id="cust" aria-label="Изменить оплату заказчика" title="Изменить оплату заказчика">›</button></div>`;
  }

  // деления оси — без наложения: ближе 7 % ширины к предыдущему не ставятся (кроме последней оплаты)
  _ticks() {
    const calc = this.calc;
    const days = [...new Set([...this.active.map(sup => sup.arr), calc.Tend].filter(day => day > 0))];
    return [0, ...days]
      .sort((left, right) => left - right)
      .filter(
        (day, k, all) =>
          k === 0 ||
          day - all.slice(0, k).reduce((max, prev) => Math.max(max, prev), 0) >= this.end * DealTimeline.TICK_GAP ||
          day === calc.Tend,
      );
  }

  _axis() {
    const ticks = this._ticks();
    const start = DealDays.contractDate();
    // подпись вплотную к предыдущей — второй строкой
    const low = ticks.map((day, k) => k > 0 && (day - ticks[k - 1]) / this.end < DealTimeline.LOW_GAP);
    const marks = ticks
      .map((day, k) => {
        const right = day / this.end > DealTimeline.RIGHT ? ' r' : '';
        const second = low[k] && !low[k - 1] ? ' lo' : '';
        const text = start ? DealCal.isoRu(DealDays.dayIso(day)).slice(0, 5) : `день ${day}`;
        return `<span class="dlo-tk${right}${second}" style="left:${this._left(day)}">${text}</span>`;
      })
      .join('');
    return `<div class="dlo-r ax"><span></span><div class="dlo-bar">${marks}</div><span></span></div>`;
  }
}
