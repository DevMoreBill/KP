import { DealCal } from './deal-cal.js';
import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealValues } from './deal-values.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/**
 * Вкладка «График платежей»: деньги по дням — кто, когда и сколько платит; день или дата платежа правится, строка
 * перетаскивается; ширина столбцов на компьютере тянется за край заголовка и запоминается в браузере.
 */
export class DealScheduleView {
  static PARTY = {
    sup: ['Поставщик', 'sup'],
    log: ['Логистика', 'log'],
    cust: ['Заказчик', 'cust'],
    oth: ['Прочее', 'oth'],
  };
  static COLW = [205, 120, 0, 140, 150, 150];
  static COL_MIN = 50;
  static COL_STORE = 'kp.dlcols';
  static MONTH = 30;
  static TITLE_MANUAL = 'Дата изменена вручную';
  static TITLE_AUTO = 'По срокам — можно изменить';

  /**
   * Ширина столбцов: сохранённая или по умолчанию.
   * @returns {number[]}
   */
  static colW() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(DealScheduleView.COL_STORE) || 'null');
    } catch {
      saved = null;
    }
    return DealScheduleView.COLW.map((width, k) =>
      Array.isArray(saved) && +saved[k] >= DealScheduleView.COL_MIN ? +saved[k] : width,
    );
  }

  /**
   * Запомнить ширину столбцов.
   * @param {number[]} widths
   */
  static saveColW(widths) {
    try {
      localStorage.setItem(DealScheduleView.COL_STORE, JSON.stringify(widths));
    } catch {
      // хранилище браузера недоступно — ширина не запоминается
    }
  }

  /**
   * Вкладка «График платежей».
   * @param {object} calc
   * @returns {string}
   */
  static html(calc) {
    const start = DealCal.contractDate();
    const days = `${calc.Tend} ${KPGen.plural(calc.Tend, 'день', 'дня', 'дней')}`;
    const until = start ? ` · до ${DealCal.dayRu(calc.Tend)}` : '';
    const reset = Object.keys(DealState.deal().days || {}).length
      ? '<div class="dl-d0"><span class="muted">Даты некоторых платежей изменены вручную.</span><button type="button" class="btn ghost" data-dlx="resetdays">↺ Вернуть даты по срокам</button></div>'
      : '';
    const body = `
      ${reset}
      <div class="dl-sxs">${DealScheduleView._tiles(calc)}</div>
      <div class="dl-tw"><table class="dl-t dl-tfix"><colgroup>${DealScheduleView._cols()}</colgroup>
      <thead><tr>${DealScheduleView._head(start)}</tr></thead><tbody>
      ${calc.rows.map(row => DealScheduleView._row(row, start)).join('')}
      </tbody><tfoot><tr><td class="c-day"></td><td class="c-who"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${DealFmt.rub(calc.F)}</b></td></tr></tfoot></table></div>
      ${DealScheduleView._help()}`;
    return DealSteps.html({
      n: 0,
      title: `График платежей · ${days}${until}`,
      sub: 'Деньги по дням: кто, когда и сколько платит. В один день сначала поступление от заказчика, потом платежи (кроме постоплаты).',
      body,
      cls: 'dl-sched',
      id: 'sched',
    });
  }

  static _tile(label, value, sub, cls = '') {
    return `<div class="dl-sx ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  }

  static _tiles(calc) {
    const start = DealCal.contractDate();
    const when = day => `день ${day}${start ? ` · ${DealCal.dayRu(day)}` : ''}`;
    const sum = pick => calc.rows.filter(pick).reduce((total, row) => total + Math.abs(row.amount), 0);
    const count = list => `${list.length} ${KPGen.plural(list.length, 'платёж', 'платежа', 'платежей')}`;
    const out = calc.rows.filter(row => !row.inflow);
    const pays = calc.rows.filter(row => row.inflow);
    const peak = calc.rows.reduce((min, row) => (row.balance < min.v ? { v: row.balance, row } : min), {
      v: 0,
      row: null,
    });
    const tile = DealScheduleView._tile;
    return `${tile('Платим поставщикам и за логистику', Fmt.rub(sum(row => !row.inflow && row.party !== 'oth')), count(out))}
        ${tile('Получаем от заказчика', Fmt.rub(sum(row => row.inflow)), `${count(pays)}, последний — ${when(calc.Tend)}`, 'in')}
        ${peak.row ? tile('Пик вложений своих денег', Fmt.rub(-peak.v), when(peak.row.day), 'neg') : tile('Пик вложений своих денег', '0 ₽', 'деньги заказчика покрывают платежи', '')}
        ${tile('Финансирование', Fmt.rub(calc.F), `${DealFmt.inp(calc.i)} % в месяц`)}`;
  }

  static _cols() {
    return DealScheduleView.colW()
      .map(width => `<col${width ? ` style="width:${width}px"` : ''}>`)
      .join('');
  }

  static _head(start) {
    return [start ? 'Дата · день' : 'День', 'Кто', 'Платёж', 'Сумма', 'Остаток денег', 'Финансирование']
      .map(
        (title, k) =>
          `<th${k > 2 ? ' class="num"' : ''}>${title}<i class="dl-cr" data-dlcol="${k}" title="Потяните, чтобы изменить ширину столбца; двойной щелчок — как было" aria-hidden="true"></i></th>`,
      )
      .join('');
  }

  static _title(row) {
    return row.manual ? DealScheduleView.TITLE_MANUAL : DealScheduleView.TITLE_AUTO;
  }

  static _day(row, start) {
    if (start) {
      if (row.fixed) return `<span class="dl-dt">${DealCal.dayRu(row.day)}</span>`;
      return `<input type="date" class="dl-date" data-dldate="${esc(row.key)}" value="${DealCal.dayIso(row.day)}" min="${start}" aria-label="Дата: ${esc(row.label)}" title="${DealScheduleView._title(row)}">`;
    }
    if (row.fixed) return `<span class="dl-day fx">${row.day}</span>`;
    return `<input type="text" inputmode="numeric" class="dl-day" data-dlday="${esc(row.key)}" value="${row.day}" aria-label="День: ${esc(row.label)}" title="${DealScheduleView._title(row)}">`;
  }

  static _move(row) {
    if (row.fixed) return '';
    const key = esc(row.key);
    return `<span class="dl-smv"><span class="dl-hdl" draggable="true" data-dnds="${key}" title="Перетащите строку выше или ниже — платёж получит дату нового места, срок пересчитается" aria-hidden="true">⠿</span><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${key}" data-d="-1" aria-label="Раньше — на дату платежа выше" title="Раньше — на дату платежа выше">↑</button><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${key}" data-d="1" aria-label="Позже — на дату платежа ниже" title="Позже — на дату платежа ниже">↓</button></span>`;
  }

  static _weekday(row) {
    const shifted =
      row.shiftedFrom != null
        ? ` · <span title="По сроку — ${DealCal.dayRu(row.shiftedFrom)} (${DealCal.weekday(row.shiftedFrom)}), нерабочий день">↷ с ${DealCal.dayRu(row.shiftedFrom).slice(0, 5)}</span>`
        : '';
    return `<small class="dl-wd${row.offDay ? ' bad-t' : ''}">день ${row.day} · ${DealCal.weekday(row.day)}${shifted}${row.offDay ? ' · нерабочий' : ''}</small>`;
  }

  static _row(row, start) {
    const party = DealScheduleView.PARTY[row.party] || DealScheduleView.PARTY.oth;
    const note = row.ev && (row.party === 'log' || row.party === 'oth') ? `<small>${esc(row.ev)}</small>` : '';
    const fin = row.fin ? `${Fmt.rub(row.fin)}<small>${row.days} дн.</small>` : '—';
    return `<tr class="${row.inflow ? 'in' : ''}${row.manual ? ' man' : ''}" data-skey="${esc(row.key)}" data-sday="${row.day}">${DealScheduleView._dayCell(row, start)}
        <td class="c-who"><span class="dl-pty ${party[1]}">${party[0]}</span></td>
        <td class="c-ev">${esc(row.label)}${note}</td><td class="num c-pay ${row.inflow ? 'ok-t' : ''}">${row.inflow ? '+' : '−'}${Fmt.rub(Math.abs(row.amount))}</td><td class="num c-bal ${row.balance < 0 ? 'neg' : ''}">${Fmt.rub(row.balance)}</td><td class="num c-fin">${fin}</td></tr>`;
  }

  static _dayCell(row, start) {
    return `<td class="c-day${start ? ' c-when' : ''}"><span class="dl-cdr">${DealScheduleView._move(row)}${DealScheduleView._day(row, start)}</span>${start ? DealScheduleView._weekday(row) : ''}</td>`;
  }

  static _help() {
    const month = DealValues.num('deal.monthDays', DealScheduleView.MONTH);
    const finance = DealFmt.help(
      `Простой процент на недостающие деньги до последней оплаты заказчика, месяц — ${month} дней; оплаты заказчика уменьшают финансирование, доход на свободный остаток не начисляется.`,
    );
    const move = DealFmt.help(
      'Перетащите платёж за «⠿» выше или ниже (или ↑ ↓, или выберите дату) — он получит новую дату, а срок, из которого он получился (этап оплаты, срок изготовления или доставки), пересчитается в днях и датах на предыдущих вкладках.',
    );
    return `<div class="dl-qrow"><span>Как считается финансирование</span>${finance}<span>Как переносить платежи</span>${move}</div>`;
  }
}
