import { DealFmt } from './deal-fmt.js';
import { DealPresets } from './deal-presets.js';
import { DealRows } from './deal-rows.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { DealDays } from './deal-days.js';

/**
 * Этапы оплаты поставщику и заказчику — одинаковой строкой: ⠿ № название · доля · когда + дней (кал./раб.) · дата · сумма;
 * «Быстро заполнить» — готовые варианты по группам.
 */
export class DealPay {
  static PCT = 100;

  /**
   * Выпадающий список готовых вариантов по группам.
   * @param {string} kind sp | tr
   * @param {number} k номер поставщика
   * @param {object} presets
   * @returns {string}
   */
  static presetSel(kind, k, presets) {
    const groups = [...new Set(Object.values(presets).map(row => row[2] || ''))];
    const options = group =>
      Object.entries(presets)
        .filter(([, row]) => (row[2] || '') === group)
        .map(([value, [title]]) => `<option value="${value}">${esc(title)}</option>`)
        .join('');
    const list = groups
      .map(group => `<optgroup label="${esc(group || 'Варианты')}">${options(group)}</optgroup>`)
      .join('');
    return `<label class="dl-pre"><span>Быстро заполнить</span><select data-dlpreset="${kind}" data-k="${k}" aria-label="Готовый вариант оплаты"><option value="">— готовый вариант —</option>
      ${list}</select></label>`;
  }

  /**
   * Строка этапа оплаты.
   * @param {object} row { grp, j, n, P, t, ev, evs, amt, base, off, dateLab, sum, day, bad, del, ph }
   * @returns {string}
   */
  static row(row) {
    const { grp, j, n, P: path, t: stage, bad, del } = row;
    const last = j === n - 1;
    const remove =
      n > 1 ? `<button type="button" class="icon" ${del} aria-label="Убрать этап">✕</button>` : '<span></span>';
    return `<div class="dl-tr pay${bad ? ' bad' : ''}${last ? ' last' : ''}" data-dnd="${grp}" data-i="${j}">${DealRows.moveCtl(grp, j, n)}<span class="dl-trn">${j + 1}</span>
      <input type="text" class="tx dl-trname" data-dl="${path}.name" value="${esc(stage.name || '')}" placeholder="${esc(row.ph)}" aria-label="Название этапа">
      ${row.amt}
      ${DealPay._when(row)}
      ${DealPay._sum(row)}
      ${remove}</div>`;
  }

  static _when({ P: path, t: stage, ev, evs }) {
    const options = Object.entries(evs)
      .map(([value, label]) => `<option value="${value}"${ev === value ? ' selected' : ''}>${label}</option>`)
      .join('');
    return `<span class="dl-trw"><select data-dl="${path}.ev" aria-label="Когда">${options}</select><span class="dl-in dl-troff"><i>+</i><input type="text" inputmode="numeric" data-dl="${path}.off" value="${esc(stage.off ?? '')}" placeholder="0" aria-label="Дней после события">${DealFmt.dayKind(`${path}.off`)}</span></span>`;
  }

  static _sum({ P: path, t: stage, base, off, dateLab, sum, day }) {
    const date = DealDays.contractDate()
      ? DealFmt.dateIn(`${path}.off`, { base, val: off, label: dateLab, kind: stage.offK })
      : `<small>день ${day}</small>`;
    return `<span class="dl-trr"><b>${Fmt.rub(sum)}</b>${date}</span>`;
  }

  static _rest(count, pct) {
    return `${count > 1 ? 'остаток' : 'всё'}<b>${DealFmt.inp(pct)} %</b>`;
  }

  static _err(calc, path) {
    return calc.err[path] ? `<small class="dl-err">${esc(calc.err[path])}</small>` : '';
  }

  /**
   * Этапы оплаты поставщику.
   * @param {object} calc
   * @param {number} k номер поставщика
   * @returns {string}
   */
  static supplier(calc, k) {
    const sup = DealState.deal().sup[k];
    const path = `sup.${k}`;
    const rows = sup.pay.map((stage, j) => DealPay._supRow(calc, k, stage, j)).join('');
    return `<div class="dl-pays">${DealPresets.PAY_HEAD}${rows}</div>${DealPay._err(calc, `${path}.pay`)}
      <div class="dl-trf"><button type="button" class="btn" data-dlx="addsp" data-k="${k}">+ Этап</button>${DealPay.presetSel('sp', k, DealPresets.SUP)}</div>`;
  }

  static _supRow(calc, k, stage, j) {
    const sup = DealState.deal().sup[k];
    const customs = calc.sup[k];
    const path = `sup.${k}.pay.${j}`;
    const count = sup.pay.length;
    const last = j === count - 1;
    const parsed = customs.stages[j] || { p: 0 };
    const event = stage.ev || 'ready';
    const bases = { order: 0, ready: customs.rdy, delivery: customs.arr, pnr: calc.pnrEnd };
    const base = bases[event] || 0;
    const scheduled = calc.rows.find(row => row.key === `sp:${sup.id}:${j}`);
    const amt = last
      ? `<span class="dl-trp">${DealPay._rest(count, parsed.p)}</span>`
      : `<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="${path}.pct" value="${esc(stage.pct ?? '')}" placeholder="0" aria-label="Доля этапа, %"><i>%</i></span>`;
    return DealPay.row({
      grp: `sp:${k}`,
      j,
      n: count,
      P: path,
      t: stage,
      ev: event,
      evs: DealPresets.SUP_EV_SHORT,
      amt,
      base,
      off: parsed.off || 0,
      dateLab: 'Оплата поставщику',
      sum: ((customs.equip + customs.fxE) * parsed.p) / DealPay.PCT,
      day: scheduled ? scheduled.day : DealTerms.addDays(DealDays.fns(), base, parsed.off || 0, stage.offK),
      bad: calc.err[`${path}.pct`] || calc.err[`${path}.off`],
      ph: DealPay._supPh(j, last, count),
      del: `data-dlx="delsp" data-k="${k}" data-j="${j}"`,
    });
  }

  static _supPh(j, last, count) {
    if (j === 0 && !last) return 'Аванс';
    return last && count > 1 ? 'Остаток' : 'Оплата';
  }

  /**
   * Этапы оплаты заказчика: процентом или суммой в рублях, последний — остаток.
   * @param {object} calc
   * @returns {string}
   */
  static customer(calc) {
    const list = DealState.deal().cust.tr;
    const rows = list.map((stage, k) => DealPay._custRow(calc, stage, k, list.length)).join('');
    const pnr = calc.pnrDays ? `, ПНР — день ${calc.pnrEnd}` : '';
    const help = DealFmt.help(
      `Сумму этапа можно вписать в процентах или рублях; последний этап — остаток. День 0 — подписание договора, готовность — день ${calc.Rdy}, поставка — день ${calc.D}${pnr}.`,
    );
    return `<div class="dl-pays">${DealPresets.PAY_HEAD}${rows}</div>${DealPay._err(calc, 'cust.tr')}
      <div class="dl-trf"><button type="button" class="btn" data-dlx="addtr">+ Этап</button>${DealPay.presetSel('tr', 0, DealPresets.CUST)}${help}</div>`;
  }

  static _custRow(calc, stage, k, count) {
    const last = k === count - 1;
    const parsed = calc.trs[k];
    const bySum = !last && stage.mode === 'sum';
    const scheduled = calc.rows.find(row => row.stage === k);
    const base = calc.ev[parsed.ev] || 0;
    const path = `cust.tr.${k}`;
    return DealPay.row({
      grp: 'cust',
      j: k,
      n: count,
      P: path,
      t: stage,
      ev: stage.ev,
      evs: DealPresets.CUST_EV_SHORT,
      amt: last ? DealPay._custRest(count, parsed.p) : DealPay._custAmount(stage, k, bySum),
      base,
      off: parsed.off || 0,
      dateLab: 'Оплата заказчика',
      sum: bySum ? parsed.sum : (calc.S * (parsed.p || 0)) / DealPay.PCT,
      day: scheduled ? scheduled.day : base + parsed.off,
      bad: calc.err[`${path}.pct`] || calc.err[`${path}.sum`] || calc.err[`${path}.off`],
      ph: DealPay._custPh(k, last, count),
      del: `data-dlx="deltr" data-k="${k}"`,
    });
  }

  static _custRest(count, pct) {
    return `<span class="dl-trp" title="Последний этап — остаток до 100 %">${DealPay._rest(count, pct)}</span>`;
  }

  static _custAmount(stage, k, bySum) {
    const value = bySum ? (stage.sum ?? '') : (stage.pct ?? '');
    const field = bySum ? 'sum' : 'pct';
    const label = bySum ? 'Сумма этапа, ₽' : 'Доля этапа, %';
    return `<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="cust.tr.${k}.${field}" value="${esc(value)}" placeholder="0" aria-label="${label}"><span class="mtog" role="group" aria-label="Процент или сумма"><button type="button" class="${bySum ? '' : 'on'}" data-dlx="trmode" data-k="${k}" data-v="pct">%</button><button type="button" class="${bySum ? 'on' : ''}" data-dlx="trmode" data-k="${k}" data-v="sum">₽</button></span></span>`;
  }

  static _custPh(k, last, count) {
    if (last) return count > 1 ? 'Окончательный расчёт' : 'Оплата';
    return k === 0 ? 'Аванс' : `Платёж ${k + 1}`;
  }
}
