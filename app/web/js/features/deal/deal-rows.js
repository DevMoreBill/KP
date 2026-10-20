import { DealCal } from './deal-cal.js';
import { DealCalculator } from './deal-calculator.js';
import { DealFmt } from './deal-fmt.js';
import { DealScheduleView } from './deal-schedule-view.js';
import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';

/**
 * Перестановка этапов оплаты (перетаскивание за «⠿» или ↑↓: этап занимает срок своего нового места, доли сохраняются,
 * последний — остаток) и новая дата платежа графика: переписывает срок, из которого платёж получился (этап оплаты —
 * событие + дни, логистика — срок изготовления, доставка по России и монтаж — срок доставки); без своего срока — вручную.
 */
export class DealRows {
  static TIME_NAME = /отгруз|пнр|поставк|подписан|оконч|остат|аванс|предоплат|заказ|шефмонтаж/i;
  static CENTS = 100;
  static COL_MIN_FIRST = 168;
  static COL_MIN = 60;

  /**
   * Ручка и стрелки перестановки этапа.
   * @param {string} grp cust | sp:N
   * @param {number} i
   * @param {number} count
   * @returns {string}
   */
  static moveCtl(grp, i, count) {
    if (count < 2) return '<span class="dl-mv"></span>';
    return `<span class="dl-mv"><span class="dl-hdl" draggable="true" data-dndh="${grp}" data-i="${i}" title="Перетащите, чтобы переставить этап выше или ниже" aria-hidden="true">⠿</span>
      <button type="button" class="dl-mvb" data-dlx="mv" data-grp="${grp}" data-i="${i}" data-to="${i - 1}"${i ? '' : ' disabled'} aria-label="Этап выше">↑</button><button type="button" class="dl-mvb" data-dlx="mv" data-grp="${grp}" data-i="${i}" data-to="${i + 1}"${i < count - 1 ? '' : ' disabled'} aria-label="Этап ниже">↓</button></span>`;
  }

  static _list(grp, deal, calc) {
    if (grp === 'cust') return { list: deal.cust.tr, shares: calc.trs.map(stage => stage.p), k: -1 };
    const k = +grp.split(':')[1];
    const shares = (calc.sup[k] || { stages: [] }).stages.map(stage => stage.p);
    return { list: deal.sup[k] && deal.sup[k].pay, shares, k };
  }

  static _timeName(name) {
    return DealRows.TIME_NAME.test(name || '');
  }

  /**
   * Переставить этап; название, описывающее срок («Перед отгрузкой», «Окончательный расчёт»…), остаётся со сроком.
   * @param {string} grp
   * @param {number} from
   * @param {number} target
   * @returns {string|null} сообщение
   */
  static moveStage(grp, from, target) {
    const deal = DealState.deal();
    const calc = DealCalculator.calc(DealState.inputs(), deal);
    const { list, shares, k } = DealRows._list(grp, deal, calc);
    if (!DealRows._canMove(list, from, target)) return null;
    const slots = list.map(stage => ({
      ev: stage.ev,
      off: stage.off,
      offK: stage.offK,
      ...(DealRows._timeName(stage.name) ? { name: stage.name } : {}),
    }));
    const items = list.map((stage, i) => ({ ...stage, _p: shares[i] || 0 }));
    const [moved] = items.splice(from, 1);
    items.splice(target, 0, moved);
    items.forEach((stage, i) => DealRows._slot(stage, slots[i], i === items.length - 1));
    list.splice(0, list.length, ...items);
    if (k >= 0) DealSuppliers.save(deal.sup[k]);
    return DealRows._movedText(grp, items[target]);
  }

  static _canMove(list, from, target) {
    const size = list ? list.length : 0;
    return !(!list || from === target || target < 0 || target >= size || from < 0 || from >= size);
  }

  static _movedText(grp, stage) {
    const events = grp === 'cust' ? DealTerms.EVENTS : DealTerms.SUP_EVENTS;
    const off = +stage.off ? ` + ${stage.off} ${stage.offK === 'work' ? 'раб.' : ''} дн.` : '';
    return `Этап «${stage.name || 'Оплата'}» перенесён: ${events[stage.ev] || ''}${off}`;
  }

  static _slot(stage, slot, last) {
    const keep = DealRows._timeName(stage.name) ? null : stage.name;
    if (DealRows._timeName(stage.name)) stage.name = '';
    Object.assign(stage, slot);
    if (keep && !DealRows._timeName(slot.name)) stage.name = keep;
    if (!stage.offK) delete stage.offK;
    if (last) {
      stage.pct = '';
      if (stage.mode === 'sum') stage.mode = 'pct';
    } else if (stage.mode !== 'sum') stage.pct = DealFmt.inp(Math.round(stage._p * DealRows.CENTS) / DealRows.CENTS);
    delete stage._p;
  }

  static ROW_KINDS = [
    [/^c(\d+)$/, '_custDay'],
    [/^sp:(.+):(\d+)$/, '_supDay'],
    [/^log:(.+)$/, '_prodDay'],
    [/^ru:(.+)$/, '_shipDay'],
    [/^mnt$/, '_shipDay'],
  ];

  /**
   * Новая дата платежа графика.
   * @param {string} key ключ строки графика
   * @param {number} day новый день
   * @returns {string} сообщение
   */
  static setRowDay(key, day) {
    const deal = DealState.deal();
    const kpData = DealState.inputs();
    const calc = DealCalculator.calc(kpData, deal);
    if (!(day >= 0)) return 'Дата раньше дня 0 — платёж не может быть раньше подписания договора';
    // ручная дата этого платежа больше не нужна
    const days = { ...(deal.days || {}) };
    delete days[key];
    deal.days = days;
    const ctx = { key, day, deal, kpData, calc };
    for (const [pattern, method] of DealRows.ROW_KINDS) {
      const match = pattern.exec(key);
      if (match) return DealRows[method](ctx, match) || DealRows._manual(ctx);
    }
    return DealRows._manual(ctx);
  }

  static _manual({ key, day, deal }) {
    deal.days = { ...deal.days, [key]: String(day) };
    return `Дата платежа изменена вручную: ${DealCal.dayRu(day) || `день ${day}`}`;
  }

  static _count({ day, kpData }, base, kind) {
    if (kind !== 'work') return day - base;
    let count = DealCal.countWork(base, day);
    if (DealTerms.addDays(kpData, base, count, 'work') < day) count++;
    return count;
  }

  // событие этапа: прежнее, если день не раньше него, иначе — самое позднее из более ранних
  static _event(events, current, day) {
    if (events[current] != null && events[current] <= day) return current;
    let best = null;
    for (const [name, place] of Object.entries(events)) {
      if (place != null && place <= day && (best == null || place > events[best])) best = name;
    }
    return best || current;
  }

  static _plus(count, kind) {
    return count ? ` + ${DealTerms.daysText(count, kind)}` : '';
  }

  static _custDay(ctx, match) {
    const { deal, calc } = ctx;
    const stage = deal.cust && deal.cust.tr && deal.cust.tr[+match[1]];
    if (!stage) return '';
    const event = DealRows._event(calc.ev, stage.ev || 'delivery', ctx.day);
    const count = DealRows._count(ctx, calc.ev[event], stage.offK);
    if (count < 0) return '';
    stage.ev = event;
    stage.off = String(count);
    return `Оплата заказчика: ${DealTerms.EVENTS[event]}${DealRows._plus(count, stage.offK)}`;
  }

  static _supDay(ctx, match) {
    const { deal, calc } = ctx;
    const k = deal.sup.findIndex(sup => sup.id === match[1]);
    const customs = calc.sup[k];
    if (k < 0 || !customs) return '';
    const sup = deal.sup[k];
    if (!Array.isArray(sup.pay) || !sup.pay.length) sup.pay = DealTerms.supPay(sup).map(stage => ({ ...stage }));
    const stage = sup.pay[+match[2]];
    if (!stage) return '';
    const events = { order: 0, ready: customs.rdy, delivery: customs.arr, pnr: calc.pnrEnd };
    const event = DealRows._event(events, stage.ev || 'ready', ctx.day);
    const count = DealRows._count(ctx, events[event], stage.offK);
    if (count < 0) return '';
    stage.ev = event;
    stage.off = String(count);
    DealSuppliers.save(sup);
    return `Оплата поставщику: ${DealTerms.SUP_EVENTS[event]}${DealRows._plus(count, stage.offK)}`;
  }

  static _whose(deal, calc, k) {
    return deal.sup.length > 1 ? ` у «${calc.sup[k].name}»` : '';
  }

  static _prodDay(ctx, match) {
    const { deal, calc } = ctx;
    const k = deal.sup.findIndex(sup => sup.id === match[1]);
    if (k < 0) return '';
    const sup = deal.sup[k];
    const count = DealRows._count(ctx, 0, sup.prodK);
    sup.prod = String(count);
    DealSuppliers.save(sup);
    return `Срок изготовления${DealRows._whose(deal, calc, k)}: ${DealTerms.daysText(count, sup.prodK)} — сдвинуты и платежи, привязанные к готовности и поставке`;
  }

  // доставка по России — поставщик строки; монтаж — поставщик с самой поздней поставкой
  static _shipDay(ctx, match) {
    const { deal, calc } = ctx;
    const k = ctx.key === 'mnt' ? DealRows._latest(calc) : deal.sup.findIndex(sup => sup.id === match[1]);
    if (k < 0 || !calc.sup[k]) return '';
    const sup = deal.sup[k];
    const count = DealRows._count(ctx, calc.sup[k].rdy, sup.shipK);
    if (count < 0) return '';
    sup.ship = String(count);
    DealSuppliers.save(sup);
    return `Срок доставки${DealRows._whose(deal, calc, k)}: ${DealTerms.daysText(count, sup.shipK)} после готовности — сдвинуты платежи при поставке`;
  }

  static _latest(calc) {
    let best = -1;
    calc.sup.forEach((sup, i) => {
      if (sup.active && (best < 0 || sup.arr > calc.sup[best].arr)) best = i;
    });
    return best;
  }

  /**
   * ↑ / ↓ у строки графика: на дату соседнего (более раннего / позднего) платежа.
   * @param {string} key
   * @param {number} dir -1 | 1
   * @returns {string|null}
   */
  static rowStep(key, dir) {
    const calc = DealCalculator.calc(DealState.inputs(), DealState.deal());
    const row = calc.rows.find(item => item.key === key);
    if (!row) return null;
    const days = [...new Set(calc.rows.map(item => item.day))].sort((left, right) => left - right);
    const next = days.indexOf(row.day) + dir;
    if (next < 0) return row.day > 0 ? DealRows.setRowDay(key, 0) : null;
    if (next >= days.length) return null;
    return DealRows.setRowDay(key, days[next]);
  }

  /** Ширина столбцов графика: тянется за край заголовка, двойной щелчок — как было. */
  static listen() {
    document.addEventListener('pointerdown', event => DealRows._resize(event));
    document.addEventListener('dblclick', event => DealRows._resetCol(event));
  }

  static _handle(event) {
    return event.target.closest && event.target.closest('.dl-t .dl-cr');
  }

  static _resize(event) {
    const handle = DealRows._handle(event);
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const k = +handle.dataset.dlcol;
    const col = handle.closest('table').querySelectorAll('col')[k];
    const x0 = event.clientX;
    const width0 = handle.closest('th').getBoundingClientRect().width;
    const widths = DealScheduleView.colW();
    document.body.classList.add('dl-colresize');
    const move = moveEvent => {
      const width = Math.max(
        k === 0 ? DealRows.COL_MIN_FIRST : DealRows.COL_MIN,
        Math.round(width0 + moveEvent.clientX - x0),
      );
      col.style.width = `${width}px`;
      widths[k] = width;
    };
    const release = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', release);
      document.body.classList.remove('dl-colresize');
      DealScheduleView.saveColW(widths);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', release);
  }

  static _resetCol(event) {
    const handle = DealRows._handle(event);
    if (!handle) return;
    const k = +handle.dataset.dlcol;
    const widths = DealScheduleView.colW();
    const width = DealScheduleView.COLW[k];
    widths[k] = width;
    DealScheduleView.saveColW(widths);
    handle.closest('table').querySelectorAll('col')[k].style.width = width ? `${width}px` : '';
  }
}
