import { DealCalculator } from './deal-calculator.js';
import { DealDefaults } from './deal-defaults.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { InputNum } from './input-num.js';

/**
 * Краткая экономика сделки в правой панели (под кнопками сохранения): прибыль до налога, маржа, чистая прибыль, цена под
 * цель; себестоимость, таможня и финансирование — под раскрытием. Только автору КП и администратору.
 */
export class DealSide {
  static more = false;
  static bound = false;
  static GOAL = { margin: 'маржи', markup: 'наценки', profit: 'прибыли', net: 'чистой прибыли' };
  static RUB_GOALS = ['profit', 'net'];

  /**
   * Блок правой панели.
   * @returns {string}
   */
  static html() {
    DealSide._listen();
    const items = (S.items || []).filter(item => String(item.name || '').trim());
    if (!items.length) return '';
    const button = '<button class="btn dl-open" type="button" data-a="deal">Экономика сделки →</button>';
    const label = '<div class="lab">Экономика сделки · в КП не выводится</div>';
    const withCost = items.filter(item => item.cost > 0).length;
    if (!withCost) {
      return `<div class="mrg">${label}<p class="mrg-n">Укажите закупку в «Экономике сделки» — здесь появятся прибыль, маржа, таможня и финансирование.</p>${button}</div>`;
    }
    let calc;
    try {
      calc = DealCalculator.calc(DealState.kpInputs(), S.deal || DealTerms.blank(DealDefaults.get()));
    } catch {
      return `<div class="mrg">${label}${button}</div>`;
    }
    return `<div class="mrg mrg-deal">${label}
      ${DealSide._profit(calc)}
      ${DealSide._kpi(calc)}
      ${DealSide._costs(calc)}
      ${DealSide._note(calc, withCost, items.length)}
      ${S.deal && S.deal.touched ? '' : '<p class="mrg-n muted">Предварительно: условия поставщика — по умолчанию.</p>'}
      ${button}</div>`;
  }

  // панель перерисовывается при каждом вводе — раскрытие «Себестоимость и расходы» помним
  static _listen() {
    if (DealSide.bound) return;
    DealSide.bound = true;
    document.addEventListener(
      'toggle',
      event => {
        if (event.target.classList && event.target.classList.contains('mrg-more')) DealSide.more = event.target.open;
      },
      true,
    );
  }

  static _pct(value) {
    return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1).replace('.', ',')} %`;
  }

  static _profit(calc) {
    const base = calc.base;
    const value = base ? Fmt.rub(base.P) : `${Fmt.rub(calc.lo.P)} … ${Fmt.rub(calc.hi.P)}`;
    return `<div class="mrg-p${base && base.P < 0 ? ' neg' : ''}"><small>Прибыль до налога</small><b>${value}</b></div>`;
  }

  static _kpi(calc) {
    const base = calc.base;
    const pct = DealSide._pct;
    const net = base ? `<dt>Чистая прибыль</dt><dd>${Fmt.rub(base.net)}</dd>` : '';
    return `<dl><dt>Маржинальность / наценка</dt><dd>${base ? `${pct(base.margin)} / ${pct(base.markup)}` : '—'}</dd>
        ${net}
        ${DealSide._goal()}</dl>`;
  }

  static _goal() {
    const goal = S.deal && S.deal.target;
    const value = goal ? InputNum.parse(goal.v) : null;
    if (value == null || Number.isNaN(value)) return '';
    const need = DealCalculator.solve(DealState.kpInputs(), S.deal, goal.type, value);
    if (need == null) return '';
    const unit = DealSide.RUB_GOALS.includes(goal.type) ? ' ₽' : ' %';
    return `<dt>Цена для ${DealSide.GOAL[goal.type] || 'цели'} ${esc(goal.v)}${unit}</dt><dd><b>${Fmt.rub(need)}</b></dd>`;
  }

  static _costs(calc) {
    const res = calc.base || calc.lo;
    return `<details class="mrg-more"${DealSide.more ? ' open' : ''}><summary>Себестоимость и расходы</summary><dl>
        <dt>Себестоимость</dt><dd>${Fmt.rub(res.Ctot)}</dd>
        ${calc.Tsum ? `<dt>Таможня (платим)</dt><dd>${Fmt.rub(calc.Tsum)}</dd>` : ''}
        <dt>Финансирование</dt><dd>${Fmt.rub(calc.F)}</dd>
        ${res.K > 0 ? `<dt>Прочие расходы (нал.)</dt><dd>${Fmt.rub(res.K)}</dd>` : ''}</dl></details>`;
  }

  static _note(calc, withCost, count) {
    if (withCost < count) return `<p class="mrg-n warn-t">Закупка указана у ${withCost} из ${count} позиций</p>`;
    const warns = calc.warn.filter(warn => warn.bad).concat(calc.warn.filter(warn => !warn.bad));
    if (warns.length) return `<p class="mrg-n ${warns[0].bad ? 'bad-t' : 'warn-t'}">${esc(warns[0].t)}</p>`;
    return calc.base ? '' : '<p class="mrg-n warn-t">Нужна сумма ввозного НДС</p>';
  }
}

/**
 * Сроки сделки для графика кабинета менеджера (описание КП, поле plan): день договора и смещения в днях — готовность,
 * поставка, конец расчётов, оплаты заказчика; платежи графика — для исполнения сделки. Только если расчёт заполнен.
 */
export class DealPlan {
  static PAYS = 8;
  static STEPS = 40;
  static KEY = 60;
  static PAY_LABEL = 80;
  static STEP_LABEL = 120;
  static TENTHS = 10;
  static PARTIES = { cust: 'cust', sup: 'sup', log: 'log', oth: 'oth' };

  /**
   * Сроки сделки или undefined.
   * @param {object} [state]
   * @returns {object|undefined}
   */
  static of(state = S) {
    if (!state.deal || !state.deal.touched) return undefined;
    let calc;
    try {
      calc = DealCalculator.calc(DealState.kpInputs(state), state.deal);
    } catch {
      return undefined;
    }
    if (!calc || !Number.isFinite(calc.D)) return undefined;
    const round = value => (Number.isFinite(value) ? Math.round(value) : null);
    return {
      start: DealState.ISO.test(state.deal.start || '') ? state.deal.start : '',
      ready: round(calc.Rdy),
      delivery: round(calc.D),
      end: round(calc.Tend),
      pnr: calc.pnrDays > 0 ? round(calc.pnrEnd) : null,
      pays: DealPlan._pays(calc),
      steps: this.steps(calc),
    };
  }

  static _tenths(value) {
    return Math.round((value || 0) * DealPlan.TENTHS) / DealPlan.TENTHS;
  }

  static _pays(calc) {
    return (calc.rows || [])
      .filter(row => row.inflow && row.amount > 0 && Number.isFinite(row.day))
      .slice(0, DealPlan.PAYS)
      .map(row => ({
        d: Math.round(row.day),
        p: DealPlan._tenths(row.pct),
        t: String(row.label || '').slice(0, DealPlan.PAY_LABEL),
      }));
  }

  /**
   * Платежи графика для исполнения сделки: день от договора и сумма в рублях (суммы закупки сервер показывает только тем,
   * кому открыта экономика сделки).
   * @param {object} calc
   * @returns {object[]}
   */
  static steps(calc) {
    return (calc.rows || [])
      .filter(row => Number.isFinite(row.day) && Math.abs(row.amount || 0) > 0)
      .slice(0, DealPlan.STEPS)
      .map(row => ({
        k: String(row.key || '').slice(0, DealPlan.KEY),
        d: Math.round(row.day),
        t: String(row.label || '').slice(0, DealPlan.STEP_LABEL),
        p: DealPlan.PARTIES[row.inflow ? 'cust' : row.party] || 'oth',
        a: Math.round(Math.abs(row.amount)),
        pc: row.inflow ? DealPlan._tenths(row.pct) : undefined,
      }));
  }
}

/**
 * Позиции КП для товаров сделки в Битрикс24 (описание КП, поле lines): цена за единицу со скидкой и НДС, копейки в валюте
 * КП, rate — курс к рублю; опции — отдельными строками.
 */
export class KpLines {
  static NAME = 250;
  static ROWS = 200;

  /**
   * Позиции или undefined (нет курса).
   * @param {object} [state]
   * @returns {object|undefined}
   */
  static of(state = S) {
    const pricing = state.pricing || {};
    const cur = pricing.cur || 'RUB';
    const rate = KpLines._rate(pricing, cur);
    if (!(rate > 0)) return undefined;
    const rows = (state.items || []).flatMap(item => [
      KpLines._line(item.name, item.qty, KPGen.netPrice(item), item.unit),
      ...(item.options || [])
        .filter(row => row.name)
        .map(option => KpLines._line(option.name, option.qty, option.price || 0, option.unit)),
    ]);
    return { cur, rate, vat: +state.vat || 0, rows: rows.slice(0, KpLines.ROWS) };
  }

  static _rate(pricing, cur) {
    if (cur === 'RUB') return 1;
    return parseFloat(
      String((pricing.rates || {})[cur] || '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
  }

  static _line(name, qty, price, unit) {
    return { n: String(name || '').slice(0, KpLines.NAME), q: +qty || 0, p: price, u: unit || 'шт' };
  }
}
