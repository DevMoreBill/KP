import { KpEconomics } from './price-calc.js';
import { KpLoader } from './reminders.js';
import { KpReportView } from './kp-report-view.js';
import { KpTrack } from './kp-track.js';
import { Str } from '../../core/str.js';
import { EquipTypes } from '../../core/equip-types.js';
import { DefRegistry } from '../../core/defaults.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { Modal } from '../../core/modal.js';
import { esc, today } from '../../core/util.js';
import { KpDate } from '../../core/kp-date.js';
import { Currency } from '../../core/currency.js';

/**
 * Отчёт по КП за период (журнал → «Отчёт»): по менеджерам, категориям оборудования и клиентам — количество КП, сумма,
 * выиграно / проиграно, конверсия, прибыль и маржа; выгрузка в Excel. Права — как в журнале.
 */
export class KpReport {
  static QUICK = [
    ['month', 'Этот месяц'],
    ['prev', 'Прошлый месяц'],
    ['quarter', 'Квартал'],
    ['year', 'Год'],
  ];
  static QUARTER = 3;

  /**
   * Период по кнопке.
   * @param {string} key month, prev, quarter, year
   * @returns {string[]} [с, по] ГГГГ-ММ-ДД
   */
  static range(key) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const iso = date => date.toISOString().slice(0, 10);
    const day = (yearNo, monthNo, dayNo) => new Date(Date.UTC(yearNo, monthNo, dayNo));
    const ranges = {
      month: () => [iso(day(year, month, 1)), today()],
      prev: () => [iso(day(year, month - 1, 1)), iso(day(year, month, 0))],
      quarter: () => [iso(day(year, Math.floor(month / this.QUARTER) * this.QUARTER, 1)), today()],
    };
    return (ranges[key] || (() => [iso(day(year, 0, 1)), today()]))();
  }

  /**
   * Окно отчёта.
   * @param {{author?: string, kind?: string}} [filter] как в журнале
   */
  static open(filter = {}) {
    const [from, till] = this.range('month');
    const modal = new Modal(
      `<div class="dlg-h"><h3>Отчёт по КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="rp-bar"><label class="f"><span>С</span><input type="date" id="rpA" value="${from}"></label><label class="f"><span>По</span><input type="date" id="rpB" value="${till}"></label>
        <span class="rp-q">${this.QUICK.map(([key, label]) => `<button type="button" class="btn sm${key === 'month' ? ' on' : ''}" data-rq="${key}">${label}</button>`).join('')}</span>
        <button class="btn" type="button" data-rx disabled>Excel</button></div>
      <div id="rpOut"><p class="empty">Считаю…</p></div>`,
      'rp-dlg',
    );
    // seq — номер запроса: ответ за прежний период (пришёл позже) не показывается
    const ctx = { modal, filter, rows: [], data: null, seq: 0 };
    modal.d.onclick = event => this._click(ctx, event.target);
    modal.d.onchange = event => {
      if (event.target.type !== 'date') return;
      modal.d.querySelectorAll('[data-rq]').forEach(button => button.classList.remove('on'));
      this._run(ctx);
    };
    this._run(ctx);
  }

  static async _run(ctx) {
    const modal = ctx.modal;
    const out = modal.$('#rpOut');
    out.innerHTML = '<p class="empty">Считаю…</p>';
    modal.$('[data-rx]').disabled = true;
    const seq = ++ctx.seq;
    try {
      const answer = await Api.request(
        `/api/report?from=${modal.$('#rpA').value}&to=${modal.$('#rpB').value}&author=${encodeURIComponent(ctx.filter.author || '')}&kind=${encodeURIComponent(ctx.filter.kind || '')}`,
      );
      if (seq !== ctx.seq) return;
      ctx.rows = answer.items || [];
      ctx.data = this.calc(ctx.rows);
      out.innerHTML = KpReportView.html(ctx.data);
      modal.$('[data-rx]').disabled = !ctx.rows.length;
    } catch (error) {
      if (seq === ctx.seq) out.innerHTML = `<p class="empty">Отчёт недоступен: ${esc(error.message)}</p>`;
    }
  }

  static _click(ctx, target) {
    const modal = ctx.modal;
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const quick = target.closest('[data-rq]');
    if (quick) {
      const [from, till] = this.range(quick.dataset.rq);
      modal.$('#rpA').value = from;
      modal.$('#rpB').value = till;
      modal.d.querySelectorAll('[data-rq]').forEach(button => button.classList.toggle('on', button === quick));
      this._run(ctx);
      return;
    }
    const open = target.closest('[data-ro]');
    if (open) {
      modal.close();
      KpLoader.byId(open.dataset.ro).catch(error => Toast.show(`Не удалось открыть: ${error.message}`));
      return;
    }
    if (target.closest('[data-rx]')) KpReportView.excel(ctx.data, modal.$('#rpA').value, modal.$('#rpB').value);
  }

  static _add(map, key, values) {
    const row = map.get(key) || {
      name: key,
      n: 0,
      sum: 0,
      won: 0,
      wonSum: 0,
      lost: 0,
      sent: 0,
      profit: 0,
      pBase: 0,
    };
    map.set(key, row);
    for (const [field, value] of Object.entries(values)) row[field] += value;
    return row;
  }

  /**
   * Сводка: по менеджерам, категориям (по позициям с закупкой), клиентам; суммы — в копейках рублей.
   * @param {object[]} rows строки отчёта сервера
   * @returns {{tot: object, mgr: object[], cat: object[], cli: object[], list: object[]}}
   */
  static calc(rows) {
    const byManager = new Map();
    const byCategory = new Map();
    const byClient = new Map();
    const list = [];
    const tot = { n: 0, sum: 0, won: 0, wonSum: 0, lost: 0, profit: 0, pBase: 0 };
    for (const row of rows) {
      const status = KpTrack.status(row.track);
      const values = this._values(status, row);
      const { sum, won } = values;
      const profit = row.profitRub;
      for (const key of Object.keys(tot)) tot[key] += values[key];
      this._add(byManager, row.manager || 'Без автора', values);
      this._add(byClient, row.client || 'Без получателя', values);
      list.push({
        id: row.id,
        number: row.number,
        date: row.date,
        client: row.client,
        manager: row.manager,
        st: status,
        sum,
        profit,
      });
      if (row.calc) this._categories(byCategory, row.calc, won);
    }
    const bySum = map => [...map.values()].sort((left, right) => right.sum - left.sum);
    return {
      tot,
      mgr: bySum(byManager),
      cat: bySum(byCategory),
      cli: bySum(byClient).slice(0, Math.round(DefRegistry.num('ui.repClients', 20))),
      list,
    };
  }

  static _rate(calc) {
    const cur = (calc.pricing || {}).cur || 'RUB';
    return cur === 'RUB' ? 1 : Currency.parseRate((calc.pricing.rates || {})[cur]);
  }

  // одна строка отчёта — для итога, менеджеров и клиентов (итог считается тем же сложением)
  static _values(status, row) {
    const sum = row.sumRub || 0;
    const won = status === 'won' ? 1 : 0;
    const profit = row.profitRub;
    return {
      n: 1,
      sum,
      won,
      wonSum: won ? sum : 0,
      lost: status === 'lost' ? 1 : 0,
      sent: status !== 'new' ? 1 : 0,
      profit: profit ?? 0,
      pBase: profit != null ? sum : 0,
    };
  }

  static _categories(byCategory, calc, won) {
    const rate = this._rate(calc);
    const toRub = value => (rate > 0 ? Math.round(value * rate) : 0);
    const groups = new Map();
    for (const item of calc.items || []) {
      const key = EquipTypes.byId((item.attrs || {}).cat).name;
      (groups.get(key) || groups.set(key, []).get(key)).push(item);
    }
    for (const [key, items] of groups) {
      const econ = KpEconomics.of({ items, pricing: calc.pricing, vat: calc.vat });
      const group = byCategory.get(key) || { name: key, n: 0, pos: 0, sum: 0, sale: 0, cost: 0, won: 0 };
      byCategory.set(key, group);
      group.n++;
      group.pos += items.length;
      group.sum += toRub(econ.sum);
      group.sale += toRub(econ.sale);
      group.cost += toRub(econ.cost);
      group.won += won ? toRub(econ.sum) : 0;
    }
  }
}

/** Сравнение версий КП (журнал → «⋯» → «Прежние версии КП» → «Сравнить с текущей»): что изменилось. */
export class KpDiff {
  /**
   * Ключ позиции для сопоставления версий.
   * @param {object} item
   * @returns {string}
   */
  static itemKey(item) {
    return item.id || Str.norm(item.name || '');
  }

  /**
   * Отличия: [что, было, стало].
   * @param {object} was прежняя версия
   * @param {object} now текущее КП
   * @returns {string[][]}
   */
  static rows(was, now) {
    const out = [];
    const change = (what, before, after) => {
      if (String(before ?? '') !== String(after ?? '')) out.push([what, before ?? '', after ?? '']);
    };
    this._head(change, was, now);
    this._items(out, change, was, now);
    const conds = new Map((was.conditions || []).map(cond => [cond.label, cond.value]));
    for (const cond of now.conditions || []) change(`Условие «${cond.label}»`, conds.get(cond.label), cond.value);
    change('Дополнительные условия', was.condExtra, now.condExtra);
    return out;
  }

  static _head(change, was, now) {
    change('Получатель', was.client, now.client);
    change('Дата КП', KpDate.ddmm(was.date), KpDate.ddmm(now.date));
    change('Валюта', (was.pricing || {}).cur || 'RUB', (now.pricing || {}).cur || 'RUB');
    change('НДС, %', was.vat, now.vat);
    change('Шаблон', was.template, now.template);
    change('№ закупки', (was.tender || {}).number, (now.tender || {}).number);
    change('Менеджер', (was.manager || {}).name, (now.manager || {}).name);
    const before = KpEconomics.of(was);
    const after = KpEconomics.of(now);
    const short = code => Currency.short(code || 'RUB');
    change(
      'Итого с НДС',
      `${KPGen.money(before.sum)} ${short(before.cur)}`,
      `${KPGen.money(after.sum)} ${short(after.cur)}`,
    );
  }

  static _items(out, change, was, now) {
    const before = new Map((was.items || []).map(item => [this.itemKey(item), item]));
    const after = new Map((now.items || []).map(item => [this.itemKey(item), item]));
    for (const [key, item] of before)
      if (!after.has(key)) out.push(['Позиция удалена', `${item.name} × ${item.qty}`, '']);
    for (const [key, item] of after) {
      const old = before.get(key);
      if (!old) {
        out.push(['Позиция добавлена', '', `${item.name} × ${item.qty} — ${KPGen.money(item.price || 0)}`]);
        continue;
      }
      this._item(change, old, item);
    }
  }

  static _discount(disc) {
    if (!disc || !(+disc.v > 0)) return '';
    return disc.type === 'sum' ? `${KPGen.money(+disc.v)} руб.` : `${disc.v} %`;
  }

  static _options(options) {
    return (options || [])
      .filter(option => option.name)
      .map(option => `${option.name} × ${option.qty}`)
      .join('; ');
  }

  static _item(change, old, item) {
    const name = item.name || old.name;
    change(`«${name}»: название`, old.name, item.name);
    change(`«${name}»: количество`, old.qty, item.qty);
    change(`«${name}»: цена за ед.`, KPGen.money(old.price || 0), KPGen.money(item.price || 0));
    change(`«${name}»: скидка`, this._discount(old.disc), this._discount(item.disc));
    change(`«${name}»: опции`, this._options(old.options), this._options(item.options));
  }

  /**
   * Окно сравнения.
   * @param {string} id КП
   * @param {string|number} vid версия
   * @param {string} [number]
   * @param {string|number} [toVid] вторая версия (пусто — сравнить с текущим КП)
   */
  static async open(id, vid, number, toVid = '') {
    let was;
    let now;
    const base = `/api/kp/${encodeURIComponent(id)}`;
    try {
      [was, now] = await Promise.all([
        Api.request(`${base}/versions/${vid}`),
        Api.request(toVid ? `${base}/versions/${toVid}` : `${base}/state`),
      ]);
    } catch (error) {
      Toast.show(`Не удалось сравнить: ${error.message}`);
      return;
    }
    const rows = this.rows(was, now);
    const table = rows.length
      ? `<div class="rp-tw"><table class="rp-tb kd-tb"><thead><tr><th>Что</th><th>Было (${toVid ? 'предыдущая версия' : 'выбранная версия'})</th><th>Стало (${toVid ? 'следующая версия' : 'текущее КП'})</th></tr></thead><tbody>
        ${rows.map(([what, before, after]) => `<tr><td>${esc(what)}</td><td class="was">${esc(before)}</td><td class="now">${esc(after)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">Отличий в позициях, ценах и условиях нет (менялось только оформление).</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Что изменилось · КП № ${esc(number || id)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${table}`,
      'kd-dlg',
    );
    modal.d.onclick = event => {
      if (event.target.closest('[data-x]')) modal.close();
    };
  }
}
