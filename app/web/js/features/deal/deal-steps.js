import { DealCal } from './deal-cal.js';
import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { LgState } from './lg-state.js';

/**
 * Шаги окна «Экономика сделки» — вкладки: карточка шага с итогом и переходом к соседним; состояние и краткий итог каждого
 * шага («заполнено / нужно заполнить / необязательно») — для вкладок, обзора и выбора первого шага.
 */
export class DealSteps {
  /**
   * Шаг: показывается только открытый.
   * @param {{n: number, title: string, sub: string, body: string, cls?: string, tot?: Array, id: string}} step
   * @returns {string}
   */
  static html({ n, title, sub, body, cls = '', tot = null, id = '' }) {
    const nav = (DealUi.nav || {})[id];
    if (id && DealUi.open !== id) return '';
    const head = `<span class="dl-n">${nav ? nav.n : n}</span><div class="dl-sht"><h4>${title}</h4>${sub ? DealFmt.help(sub) : ''}</div>`;
    const panel = id ? ` data-stepid="${id}" role="tabpanel"` : '';
    return `<section class="dl-step ${cls}"${panel}><div class="dl-sh">${head}</div>${body}${tot ? DealFmt.tot(...tot) : ''}</section>${DealSteps._go(nav)}`;
  }

  static _go(nav) {
    if (!nav) return '';
    const prev = nav.prev
      ? `<button type="button" class="btn" data-dlx="step" data-id="${nav.prev}">← ${esc(nav.prevT)}</button>`
      : '<span></span>';
    const next = nav.next
      ? `<button type="button" class="btn primary" data-dlx="step" data-id="${nav.next}">Далее: ${esc(nav.nextT)} →</button>`
      : '';
    return `<div class="dl-next">${prev}${next}</div>`;
  }

  /**
   * Состояние и краткий итог каждого шага.
   * @param {object} calc расчёт сделки
   * @returns {object} { id: { st, sum } }
   */
  static info(calc) {
    const start = DealCal.contractDate();
    const when = day => (start ? DealCal.dayRu(day) : `день ${day}`);
    return {
      buy: DealSteps._buy(calc, when),
      log: DealSteps._log(calc),
      cus: DealSteps._customs(calc),
      cust: DealSteps._customer(calc, when),
      mnt: DealSteps._costs(calc),
      price: {
        st: calc.S > 0 ? 'ok' : 'need',
        sum: calc.S > 0 ? `${Fmt.rub(calc.S)} с НДС ${DealFmt.inp(calc.v)} %` : 'Нет цены для заказчика',
      },
      money: {
        st: 'opt',
        sum: `Деньги ${DealFmt.inp(calc.i)} % в месяц · НДС ${DealFmt.inp(calc.v)} % · налог на прибыль ${DealFmt.inp(calc.taxP)} %`,
      },
      sched: DealSteps._schedule(calc),
    };
  }

  static _buy(calc, when) {
    const deal = DealState.deal();
    const lines = KitDoc.lines(S).filter(line => String(line.name || '').trim());
    const noCost = lines.filter(line => !(line.cost > 0)).length;
    const need = noCost || deal.sup.some(sup => !String(sup.name || '').trim());
    const sum = noCost
      ? `Нет цены закупки у ${noCost} из ${lines.length} поз.`
      : calc.sup
          .filter(sup => sup.equip > 0 || calc.sup.length === 1)
          .map(
            sup =>
              `${sup.name}${sup.country ? ` (${sup.country})` : ''}: ${Fmt.rub(sup.equip)}, готово — ${when(sup.rdy)}, у заказчика — ${when(sup.arr)}`,
          )
          .join(' · ');
    return { st: need ? 'need' : 'ok', sum };
  }

  static _log(calc) {
    const deal = DealState.deal();
    const need = deal.sup
      .map(sup => LgState.res[sup.id])
      .filter(Boolean)
      .some(res => res.need && !/нет позиций/.test(res.need));
    const sum = calc.sup
      .map((sup, k) => {
        const own = deal.sup[k];
        const res = LgState.res[own.id];
        const fin = LgState.fin[own.id];
        const route = res && res.from && res.to ? `${res.from.name} → ${res.to.name}, ${res.km} км, ` : '';
        const chosen = fin && own.lg && own.lg.mode !== 'manual' ? ` (${fin.name})` : '';
        return `${sup.name}: ${route}${Fmt.rub(sup.L + sup.Lru + sup.ins)}${chosen}`;
      })
      .join(' · ');
    return { st: need ? 'need' : 'ok', sum };
  }

  static _customs(calc) {
    const noDuty = calc.sup.some(sup => sup.noDuty.length);
    const unknown = calc.unknown.length;
    return { st: noDuty || unknown ? 'need' : 'ok', sum: DealSteps._customsSum(calc, noDuty, unknown) };
  }

  static _customsSum(calc, noDuty, unknown) {
    if (noDuty) return 'Укажите ставку пошлины у позиций';
    if (unknown) return 'Укажите ввозной НДС к вычету';
    if (!calc.Tsum) return 'Таможни нет';
    const cost = calc.sup.reduce((sum, sup) => sum + sup.T - (sup.vi || 0), 0);
    return `Платим на таможне ${Fmt.rub(calc.Tsum)}, в себестоимость ${Fmt.rub(cost)}`;
  }

  static _customer(calc, when) {
    const sum = calc.rows
      .filter(row => row.inflow && row.amount > 0)
      .map(row => {
        const stage = calc.trs[row.stage];
        const pct = DealTerms.pctText(row.pct || 0);
        return `${(stage && stage.name) || pct}${stage && stage.name ? ` ${pct}` : ''} — ${when(row.day)}`;
      })
      .join(' · ');
    return { st: 'ok', sum: sum || 'Оплата заказчика' };
  }

  static _costs(calc) {
    const cash = (calc.base || calc.lo).K;
    const list = [
      calc.M ? `монтаж ${Fmt.rub(calc.M)}` : '',
      calc.Dc ? `документация ${Fmt.rub(calc.Dc)}` : '',
      calc.E ? `прочие ${Fmt.rub(calc.E)}` : '',
      calc.W + calc.Bn ? `резерв и бонусы ${Fmt.rub(calc.W + calc.Bn)}` : '',
      calc.BG ? `банковская гарантия ${Fmt.rub(calc.BG)}` : '',
      cash ? `наличные ${Fmt.rub(cash)}` : '',
    ].filter(Boolean);
    if (!list.length) return { st: 'opt', sum: 'Монтаж, ПНР, документация, банковская гарантия, наличные — если есть' };
    return { st: 'ok', sum: list.join(' · ') };
  }

  static _schedule(calc) {
    const peak = calc.rows.reduce((min, row) => Math.min(min, row.balance), 0);
    const days = `${calc.Tend} ${plural(calc.Tend, 'день', 'дня', 'дней')}`;
    return {
      st: 'info',
      sum: `${days} до последней оплаты · финансирование ${Fmt.rub(calc.F)}${peak < 0 ? ` · пик вложений ${Fmt.rub(-peak)}` : ''}`,
    };
  }
}
