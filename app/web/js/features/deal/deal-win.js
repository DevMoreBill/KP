import { DealBind } from './deal-bind.js';
import { DealCal } from './deal-cal.js';
import { DealCalculator } from './deal-calculator.js';
import { DealConds } from './deal-conds.js';
import { DealCosts } from './deal-costs.js';
import { DealCustoms } from './deal-customs.js';
import { DealFmt } from './deal-fmt.js';
import { DealLogistics } from './deal-logistics.js';
import { DealMoney } from './deal-money.js';
import { DealOverview } from './deal-overview.js';
import { DealPay } from './deal-pay.js';
import { DealPrice } from './deal-price.js';
import { DealPurchase } from './deal-purchase.js';
import { DealResult } from './deal-result.js';
import { DealScheduleView } from './deal-schedule-view.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealUi } from './deal-ui.js';

/**
 * Окно «Экономика сделки»: шапка с датой договора и Excel, вкладки шагов по порядку заполнения (открыта одна), правая
 * колонка с подбором цены и итогом; размер окна запоминается в браузере.
 */
export class DealWin {
  static SIZE_STORE = 'kp.dealwin2';
  static TAB_SHORT = { sched: 'График' };
  static TAB_ICON = { ok: '✓', need: '!' };
  static DATE_Q =
    'Ориентировочная дата заключения договора (день 0). От неё считаются сроки поставки и даты всех платежей; рабочие (банковские) дни — по производственному календарю РФ.';

  /** Перерисовать открытое окно. */
  static render() {
    const dlg = $('#dealdlg');
    if (!dlg || !dlg.isConnected || !dlg.open) return;
    DealWin._draw(dlg);
  }

  /** Нарисовать окно, даже если оно ещё не открыто (первое открытие). */
  static show() {
    const dlg = $('#dealdlg');
    if (!dlg || !dlg.isConnected) return;
    DealWin._draw(dlg);
  }

  static _draw(dlg) {
    try {
      ItemAttrs.during(() => DealWin.renderIn(dlg));
    } catch (error) {
      console.error(error);
      morph(
        dlg,
        `<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>
      <p class="msg err" style="margin:20px">Не удалось показать расчёт: ${esc(error.message || error)}. Сообщите разработчику; данные КП не изменены.</p>`,
      );
    }
  }

  /**
   * Содержимое окна: доставка по России из «Логистики» — в расчёт, условия КП — из расчёта.
   * @param {HTMLDialogElement} dlg
   */
  static renderIn(dlg) {
    const deal = DealState.deal();
    DealLogistics.sync(deal);
    const kpData = DealState.inputs();
    const calc = DealCalculator.calc(kpData, deal);
    if (DealConds.sync(calc)) persist();
    // на телефоне шапка — одна строка, дата договора — в строке с прибылью
    const mob = isMob();
    const date = DealWin._date(deal);
    const tabs = DealWin._tabs(calc, deal);
    const customs = DealCustoms.html(calc);
    const customer = DealWin._customer(calc);
    dlg.dataset.tab = DealUi.open;
    morph(
      dlg,
      `${DealWin._head(mob ? '' : date)}${DealWin._banner(kpData)}<div class="dl-mini">${mob ? date : ''}${DealWin._mini(calc)}</div><div class="dl-b"><div class="dl-tabw">${tabs}</div><div class="dl-form">
      ${DealOverview.html(calc)}
      ${DealPurchase.html(calc)}
      ${DealLogistics.view(calc)}
      ${customs}
      ${customer}
      ${DealCosts.step(calc)}
      ${DealPrice.step(calc)}
      ${DealMoney.step(calc, kpData)}
      ${DealScheduleView.html(calc)}
      <div class="dl-foot"><span class="muted">Пересчёт — сразу при вводе. Закупка сохраняется в КП и каталоге.</span></div>
    </div><aside class="dl-side">${DealResult.html(calc)}</aside></div>`,
    );
    DealLogistics.autoQuote();
  }

  static _date(deal) {
    const start = DealCal.contractDate();
    const note = start ? DealCal.note(start).replace(/<[^>]+>/g, '') : '';
    const auto = deal.startAuto;
    const warn = auto
      ? '<em class="dl-hdw" title="Подставлена сегодняшняя дата — укажите ориентировочную дату подписания договора: от неё считаются сроки и даты платежей">сегодня — уточните</em>'
      : '';
    const help = DealFmt.help(DealWin.DATE_Q + (note ? ` ${note}.` : ''));
    return `<label class="dl-hd${start ? '' : ' empty'}${auto ? ' auto' : ''}"><span>Дата договора${warn}${help}</span><input type="date" data-dlstart value="${esc(start)}" aria-label="Дата договора"></label>`;
  }

  static _head(date) {
    return `<div class="dlg-h"><h3>Экономика сделки${S.number ? ` · КП № ${esc(S.number)}` : ''}<small>${esc(S.client || 'Получатель не указан')}</small></h3>
        ${date}<button class="btn" type="button" data-dlx="xlsx" title="Excel для согласования"><span class="dl-xl-l">Excel для согласования</span><span class="dl-xl-s">Excel</span></button><button class="icon dl-maxb" type="button" data-dlx="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  }

  static _banner(kpData) {
    if (!kpData.sumNoRate) return '';
    return `<div class="dl-ex warn">Нет курса валюты КП (${esc(kpData.cur)}) — цена не переведена в рубли. Укажите курс в шаге «Цена КП и валюта».</div>`;
  }

  static _mini(calc) {
    const base = calc.base;
    if (!base) {
      return `<span><small>Прибыль при цене КП</small><b>${Fmt.rub(calc.lo.P)} … ${Fmt.rub(calc.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
    }
    return `<span><small>Прибыль при цене КП</small><b class="${base.P < 0 ? 'neg' : ''}">${Fmt.rub(base.P)}</b></span><span class="r"><small>Маржинальность</small><b>${DealFmt.pct(base.margin)}</b></span>`;
  }

  // шаги по порядку заполнения; сначала — обзор: итог, чего не хватает, поставщики и сроки
  static _order(calc, deal) {
    const hasCustoms = deal.sup.some((sup, k) => !(calc.sup[k].mode === 'none' && /^росс/i.test(sup.country || '')));
    return [
      ['sum', 'Кратко'],
      ['buy', 'Закупка'],
      ['log', 'Логистика'],
      ...(hasCustoms ? [['cus', 'Таможня']] : []),
      ['cust', 'Оплата заказчика'],
      ['mnt', 'Расходы'],
      ['price', 'Цена КП'],
      ['money', 'Деньги и налог'],
      ['sched', 'График платежей'],
    ];
  }

  static _nav(order) {
    const nav = {};
    order.forEach(([id], k) => {
      const next = order[k + 1];
      const prev = order[k - 1];
      nav[id] = {
        n: k + 1,
        next: next && next[0],
        nextT: next && next[1],
        prev: prev && prev[0],
        prevT: prev && prev[1],
      };
    });
    return nav;
  }

  static _tabs(calc, deal) {
    const order = DealWin._order(calc, deal);
    DealUi.nav = DealWin._nav(order);
    DealUi.stepInfo = DealSteps.info(calc);
    if (DealUi.open === undefined || !DealUi.nav[DealUi.open]) DealUi.open = 'sum';
    const tabs = order
      .map(([id, title], k) => {
        const info = DealUi.stepInfo[id] || {};
        const state = info.st;
        const active = DealUi.open === id;
        return `<button type="button" role="tab" aria-selected="${active}" class="dl-tab${active ? ' on' : ''}${state ? ` st-${state}` : ''}" data-dlx="step" data-id="${id}" title="${esc(`${title}: ${info.sum || ''}`)}"><span class="dl-tn">${DealWin.TAB_ICON[state] || k + 1}</span><span class="dl-tt">${DealWin.TAB_SHORT[id] || title}</span></button>`;
      })
      .join('');
    return `<nav class="dl-tabs" role="tablist" aria-label="Шаги расчёта">${tabs}</nav>`;
  }

  static _customer(calc) {
    const pays = calc.trs.filter(stage => stage.p > 0).length;
    const start = DealCal.contractDate();
    return DealSteps.html({
      n: 0,
      title: 'Оплата заказчика',
      sub: 'Когда и сколько платит заказчик. Выберите готовый вариант или впишите свои этапы; сроки — днями или датой.',
      body: DealPay.customer(calc),
      tot: [
        'Итого заплатит заказчик',
        calc.rows.filter(row => row.inflow).reduce((sum, row) => sum + row.amount, 0),
        `${pays} ${plural(pays, 'платёж', 'платежа', 'платежей')}, последний — ${start ? DealCal.dayRu(calc.Tend) : `день ${calc.Tend}`}`,
      ],
      id: 'cust',
    });
  }

  /**
   * Восстановить размер окна.
   * @param {HTMLDialogElement} dlg
   */
  static winRestore(dlg) {
    try {
      const size = JSON.parse(localStorage.getItem(DealWin.SIZE_STORE) || '{}') || {};
      dlg.classList.toggle('max', !!size.max);
      if (size.w) dlg.style.width = size.w;
      if (size.h) dlg.style.height = size.h;
    } catch {
      // нет сохранённого размера — по умолчанию
    }
  }

  /**
   * Запомнить размер окна.
   * @param {HTMLDialogElement} dlg
   */
  static winSave(dlg) {
    try {
      const size = { max: dlg.classList.contains('max'), w: dlg.style.width || '', h: dlg.style.height || '' };
      localStorage.setItem(DealWin.SIZE_STORE, JSON.stringify(size));
    } catch {
      // хранилище браузера недоступно — размер не запоминается
    }
  }

  /**
   * Обработчики окна (один раз при создании).
   * @param {HTMLDialogElement} dlg
   */
  static bind(dlg) {
    DealBind.bind(dlg);
  }
}
