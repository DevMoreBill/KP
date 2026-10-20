import { DealCal } from './deal-cal.js';
import { DealFmt } from './deal-fmt.js';
import { DealTimeline } from './deal-timeline.js';
import { DealUi } from './deal-ui.js';

/** Вкладка «Кратко»: итог простыми словами, чего не хватает, поставщики и сроки на одной ленте, деньги в обороте. */
export class DealOverview {
  static STEP_T = {
    buy: 'Закупка',
    log: 'Логистика',
    cus: 'Таможня',
    cust: 'Оплата заказчика',
    mnt: 'Расходы',
    price: 'Цена КП',
    money: 'Деньги и налог',
    sched: 'График платежей',
  };
  static NEED_T = {
    log: 'укажите склад поставщика и адрес объекта (или свою сумму доставки)',
    cus: 'проверьте коды ТН ВЭД, пошлину и ввозной НДС',
  };
  static VERDICT = {
    need: ['!', 'Расчёт неполный — заполните отмеченное'],
    ok: ['✓', 'Сделка прибыльна'],
    bad: ['✕', 'Сделка убыточна при этой цене'],
  };
  static HUNDRED = 100;
  static PEAK_EPS = 0.5;

  /**
   * Вкладка «Кратко».
   * @param {object} calc расчёт сделки
   * @returns {string}
   */
  static html(calc) {
    if (DealUi.open !== 'sum') return '';
    const start = DealCal.contractDate();
    const when = day => (start ? DealCal.dayRu(day) : `день ${day}`);
    const timeline = new DealTimeline(calc, when).html();
    const note = start
      ? 'от даты договора'
      : 'дни от подписания договора — укажите дату договора вверху, чтобы видеть даты';
    const asm = calc.asm ? ' <i class="asm"></i>сборка станции' : '';
    const pnr = calc.pnrDays > 0 ? ' <i class="pnr"></i>ПНР' : '';
    return `<section class="dl-step dlo" data-stepid="sum" role="tabpanel">${DealOverview._head(calc)}
      <div class="dl-card dlo-tl"><div class="dlo-th"><h5>Поставщики и сроки</h5><span class="muted">${note}</span>
        <span class="dlo-lg"><i class="pr"></i>производство <i class="tr"></i>доставка${asm}${pnr}</span></div>
        ${timeline}
        ${DealOverview._note(calc, when)}</div>
      ${DealOverview._money(calc, when)}
      <div class="dl-next"><span></span><button type="button" class="btn primary" data-dlx="step" data-id="buy">Подробно: Закупка →</button></div></section>`;
  }

  static _state(calc, need) {
    const res = calc.base || calc.lo;
    if (need.length) return 'need';
    return res.P > 0 ? 'ok' : 'bad';
  }

  static _tile(title, value, cls = '', sub = '') {
    return `<div class="dlo-t ${cls}"><small>${title}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  }

  static _head(calc) {
    const res = calc.base || calc.lo;
    const info = DealUi.stepInfo || {};
    const need = Object.entries(info).filter(
      ([id, step]) => step.st === 'need' && DealOverview.STEP_T[id] && (DealUi.nav || {})[id],
    );
    const state = DealOverview._state(calc, need);
    const [icon, verdict] = DealOverview.VERDICT[state];
    return `<div class="dlo-v st-${state}"><div class="dlo-vh"><span class="dlo-ic">${icon}</span><h4>${verdict}</h4></div>
      <div class="dlo-tiles">${DealOverview._tiles(calc, res)}</div>
      ${DealOverview._per100(calc, res)}
      ${DealOverview._need(need)}</div>`;
  }

  static _tiles(calc, res) {
    const tile = DealOverview._tile;
    const profit = calc.base ? Fmt.rub(res.P) : `${Fmt.rub(calc.lo.P)} … ${Fmt.rub(calc.hi.P)}`;
    return `${tile('Цена КП с НДС', Fmt.rub(calc.S))}${tile('Прибыль до налога', profit, res.P < 0 ? 'neg' : 'pos')}
        ${tile('Маржинальность', DealFmt.pct(res.margin), res.margin < 0 ? 'neg' : '')}${tile('Чистая прибыль', Fmt.rub(res.net), res.net < 0 ? 'neg' : '', `после налога ${DealFmt.inp(calc.taxP)} %`)}`;
  }

  static _per100(calc, res) {
    if (!(calc.R > 0)) return '';
    const cost = DealFmt.inp(Math.max(0, DealOverview.HUNDRED - res.margin));
    return `<p class="dlo-p">Из каждых 100 ₽ выручки без НДС: <b>${cost} ₽</b> — затраты, <b>${DealFmt.inp(res.margin)} ₽</b> — прибыль до налога.</p>`;
  }

  static _need(need) {
    if (!need.length) return '';
    const rows = need
      .map(
        ([id, step]) =>
          `<li><button type="button" class="lnk" data-dlx="step" data-id="${id}">${esc(DealOverview.STEP_T[id])}</button> — ${esc(DealOverview.NEED_T[id] || step.sum || 'нужно заполнить')}</li>`,
      )
      .join('');
    return `<ul class="dlo-need">${rows}</ul>`;
  }

  static _note(calc, when) {
    const asm = calc.asm;
    if (asm) {
      return `<p class="muted dlo-note">Элементы едут на сборку к «${esc(asm.A.name)}»: сборка ${when(asm.start)} — ${when(asm.end)}, станция у заказчика ${when(asm.arr)}. Условия — на вкладке «Закупка», маршруты — на вкладке «Логистика».</p>`;
    }
    const active = calc.sup.filter(sup => sup.active || calc.sup.length === 1);
    if (active.length <= 1) return '';
    return `<p class="muted dlo-note">Изделие у заказчика целиком — ${when(calc.D)}: по самой долгой поставке. Условия каждого поставщика (оплата, сроки, доставка) — на вкладке «Закупка».</p>`;
  }

  static _money(calc, when) {
    const peak = calc.rows.reduce((min, row) => Math.min(min, row.balance), 0);
    const peakRow = calc.rows.find(row => row.balance === peak);
    const busy = peak < -DealOverview.PEAK_EPS;
    const peakWhen = busy && peakRow ? when(peakRow.day) : 'платежи покрывают оплаты заказчика';
    return `<div class="dlo-m"><div><small>Своих денег в сделке на пике</small><b>${busy ? Fmt.rub(-peak) : '0 ₽'}</b><span>${peakWhen}</span></div>
      <div><small>Деньги вернутся</small><b>${when(calc.Tend)}</b><span>последняя оплата заказчика</span></div>
      <div><small>Стоимость этих денег</small><b>${Fmt.rub(calc.F)}</b><span>${DealFmt.inp(calc.i)} % в месяц — уже в себестоимости</span></div></div>`;
  }
}
