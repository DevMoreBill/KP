import { CrmData } from './crm-data.js';
import { CrmFunnel } from './crm-funnel.js';
import { esc, today } from '../../core/util.js';
import { PhoneLayout } from '../../core/phone-layout.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { KpDate } from '../../core/kp-date.js';
import { CabState } from './cab-state.js';

/** «График»: лента времени — сделка (создана → ожидаемая дата), срок КП, поставка и оплаты по расчёту сделки, дела. */
export class CabGantt {
  static KEY = 'kp.cab.gantt';
  static SCALES = { month: ['Месяц', 26], quarter: ['Квартал', 9], half: ['Полгода', 4.5] };
  static AHEAD = { month: 45, quarter: 100, half: 190 };
  static BEFORE = 14;
  static BACK_MAX = 120;
  static AHEAD_MAX = 500;
  static PAD = 7;
  static TASK_PAD = 3;
  static NEW_DAYS = 30;
  static WEEKDAYS_PX = 8;
  static WEEKEND_PX = 20;
  static SHORT_MONTH_PX = 6;
  static MIN_BAR = 6;
  static LABEL_GAP = 14;
  static SCROLL_SHARE = 0.2;
  static MONTH_DAYS = 7;
  static SATURDAY = 6;
  static opts = null;

  /**
   * Настройки ленты (масштаб, что показывать) — помнятся в этом браузере.
   * @returns {{scale: string, deal: boolean, sup: boolean, task: boolean}}
   */
  static opt() {
    if (this.opts) return this.opts;
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.KEY) || '{}');
    } catch {
      saved = {};
    }
    this.opts = {
      scale: this.SCALES[saved.scale] ? saved.scale : 'month',
      deal: saved.deal !== false,
      sup: saved.sup !== false,
      task: saved.task !== false,
    };
    return this.opts;
  }

  static _set(key, value) {
    this.opt()[key] = value;
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.opts));
    } catch {
      // настройка просто не запомнится
    }
  }

  /**
   * Сменить масштаб.
   * @param {string} scale
   */
  static scale(scale) {
    this._set('scale', scale);
    CabState.render();
  }

  /**
   * Галочки «что показывать». true — нужно перерисовать.
   * @param {HTMLElement} target
   * @returns {boolean}
   */
  static change(target) {
    if (!target.dataset.gsh) return false;
    this._set(target.dataset.gsh, target.checked);
    return true;
  }

  /**
   * Поставка по последнему КП сделки с расчётом сроков: от договора (дата в расчёте или ожидаемая дата сделки).
   * @param {object} deal
   * @returns {object|null}
   */
  static plan(deal) {
    const offer = (deal.kps || []).find(row => row.plan && row.status !== 'lost');
    if (!offer) return null;
    const plan = offer.plan;
    const startDay = plan.start || deal.expected;
    if (!startDay) return null;
    const base = CrmFmt.dayNo(startDay);
    const shift = days => (Number.isFinite(days) ? base + days : null);
    const pays = (plan.pays || []).map(pay => ({ day: base + pay.d, title: pay.t }));
    return {
      kp: offer,
      start: base,
      ready: shift(plan.ready),
      delivery: shift(plan.delivery),
      end: shift(plan.end),
      pays,
      guess: !plan.start,
    };
  }

  static _rows(opts) {
    const deals = CrmData.openDeals()
      .filter(deal => CabState.match(deal))
      .sort((one, two) => String(one.expected || '9').localeCompare(String(two.expected || '9')));
    const tasks = CrmData.openTasks();
    return deals.map(deal => {
      const created = String(deal.created || today()).slice(0, 10);
      return {
        deal,
        from: CrmFmt.dayNo(created),
        to: CrmFmt.dayNo(deal.expected || KpDate.addDays(created, this.NEW_DAYS)),
        plan: opts.sup ? this.plan(deal) : null,
        kp: (deal.kps || []).find(row => row.status !== 'lost' && row.validUntil),
        tasks: tasks.filter(task => task.deal === deal.id),
      };
    });
  }

  static _range(rows, opts, now) {
    let low = now - this.BEFORE;
    let high = now + this.AHEAD[opts.scale];
    for (const row of rows) {
      if (opts.deal) low = Math.min(low, Math.max(row.from, now - this.BACK_MAX));
      high = Math.max(high, row.to + this.PAD);
      if (row.plan) high = Math.max(high, (row.plan.end || row.plan.delivery || row.plan.start) + this.PAD);
      for (const task of row.tasks) high = Math.max(high, CrmFmt.dayNo(task.due) + this.TASK_PAD);
    }
    return { low, high: Math.min(high, now + this.AHEAD_MAX) };
  }

  /**
   * График сделок (вид «Сделок»).
   * @param {string} [lead] переключатель вида — в строку над графиком
   * @returns {string}
   */
  static html(lead = '') {
    const opts = this.opt();
    const now = CrmFmt.dayNo(today());
    const rows = this._rows(opts);
    const ids = new Set(rows.map(row => row.deal.id));
    const free = CrmData.openTasks().filter(task => !task.deal || !ids.has(task.deal));
    const { low, high } = this._range(rows, opts, now);
    const tape = new GanttTape(low, high, this.SCALES[opts.scale][1]);
    const freeRow =
      opts.task && free.length
        ? `<div class="gn-r"><div class="gn-l"><b>Дела без сделки</b><span class="muted">${free.length}</span></div><div class="gn-tr" style="width:${tape.width}px">${free.map(task => tape.task(task)).join('')}</div></div>`
        : '';
    if (!rows.length && !freeRow)
      return `${this._controls(opts, lead)}<p class="empty">${CabState.query ? 'Не найдено.' : 'Сделок в работе нет. <button class="btn sm primary" type="button" data-cq="mail">📩 Сделка из письма</button>'}</p>`;
    const lines = rows.map(row => this._line(row, tape, opts)).join('');
    return `${this._controls(opts, lead)}<div class="gn" id="gn"><div class="gn-in"><div class="gn-r gn-hd"><div class="gn-l"><b>Сделка</b></div><div class="gn-tr" style="width:${tape.width}px">${tape.head()}</div></div>
      <div class="gn-rows">${lines}${freeRow}<div class="gn-now" style="left:calc(var(--gl) + ${tape.mid(now)}px)" aria-hidden="true"></div></div></div></div>`;
  }

  static _controls(opts, lead) {
    const scales = Object.entries(this.SCALES)
      .map(
        ([key, [label]]) =>
          `<button type="button" role="radio" aria-checked="${opts.scale === key}" class="${opts.scale === key ? 'on' : ''}" data-gsc="${key}">${label}</button>`,
      )
      .join('');
    const check = (key, label) =>
      `<label class="cab-ck"><input type="checkbox" data-gsh="${key}"${opts[key] ? ' checked' : ''}> ${label}</label>`;
    return `<div class="cab-bar">${CabState.search('Сделка или клиент')}${lead}<div class="seg" role="radiogroup" aria-label="Масштаб">${scales}</div>${check('deal', 'Сроки сделок')}${check('sup', 'Поставка')}${check('task', 'Дела')}</div>
      <details class="gn-lg muted"${PhoneLayout.active() ? '' : ' open'}><summary>Обозначения</summary><div class="gn-lgi"><span><i class="gb-d t-s2"></i> сделка: создана → ожидаемая дата</span><span><i class="gb-s"></i> поставка по расчёту сделки</span><span>◇ КП действует до</span><span>◆ готовность</span><span>₽ оплата заказчика</span><span>☎ 👥 ✉ ✓ дела</span></div></details>`;
  }

  static _line(row, tape, opts) {
    const deal = row.deal;
    const name = deal.title || deal.client;
    let track = opts.deal ? this._dealBar(row, tape, name) : '';
    if (row.plan) track += this._supply(row.plan, tape, name);
    if (opts.task) track += row.tasks.map(task => tape.task(task)).join('');
    const sub = deal.client && deal.client !== name ? deal.client : CrmFunnel.label(deal);
    const who = CrmData.all() ? ` · ${esc(CrmData.mgrShort(deal))}` : '';
    return `<div class="gn-r${row.plan ? ' two' : ''}"><button type="button" class="gn-l" data-deal="${esc(deal.id)}" title="${esc(name)}"><b>${esc(name)}</b><span class="muted">${esc(sub)}${who}</span></button><div class="gn-tr" data-deal="${esc(deal.id)}" style="width:${tape.width}px">${track}</div></div>`;
  }

  static _dealBar(row, tape, name) {
    const deal = row.deal;
    const late = deal.expected && deal.expected < today();
    const stage = CrmFunnel.label(deal);
    const title = `${name}: ${stage}, ${CrmFmt.rub(deal.sum)} · с ${CrmFmt.day(String(deal.created).slice(0, 10))} до ${CrmFmt.day(deal.expected)}${late ? ' — ожидаемая дата прошла' : ''}`;
    const bar = tape.bar(row.from, row.to, {
      cls: `gb-d t-${CrmData.toneOf(deal)}${late ? ' late' : ''}`,
      label: `${stage} · ${CrmFmt.short(deal.sum)}`,
      title,
    });
    const valid = row.kp
      ? tape.mark(CrmFmt.dayNo(row.kp.validUntil), {
          cls: 'gn-v',
          sym: '◇',
          title: `КП № ${row.kp.number} действует до ${KpDate.ddmm(row.kp.validUntil)}`,
        })
      : '';
    return bar + valid;
  }

  static _supply(plan, tape, name) {
    const end = plan.delivery ?? plan.ready ?? plan.start;
    const day = number => CrmFmt.day(CrmFmt.iso(number));
    const ready = plan.ready != null ? day(plan.ready) : '—';
    const guess = plan.guess ? ' (ожидаемая дата — в расчёте сделки дата договора не задана)' : '';
    let out = tape.bar(plan.start, end, {
      cls: `gb-s${plan.guess ? ' guess' : ''}`,
      label: '',
      title: `${name}: договор ${day(plan.start)}${guess}, готовность ${ready}, поставка ${day(end)} · по КП № ${plan.kp.number}`,
    });
    if (tape.inside(end))
      out += `<span class="gn-x" style="left:${tape.left(end + 1) + this.LABEL_GAP}px">поставка ${esc(day(end))}</span>`;
    if (plan.ready != null && plan.ready !== end)
      out += tape.mark(plan.ready, { cls: 'gn-r', sym: '◆', title: `Готовность к отгрузке: ${day(plan.ready)}` });
    for (const pay of plan.pays)
      out += tape.mark(pay.day, { cls: 'gn-p', sym: '₽', title: `${pay.title} · ${day(pay.day)}` });
    return out;
  }

  /**
   * После вывода: лента прокручена к сегодняшнему дню.
   * @param {HTMLElement} body
   */
  static after(body) {
    const gantt = body && body.querySelector('#gn');
    const now = gantt && gantt.querySelector('.gn-now');
    if (!now) return;
    const label = gantt.querySelector('.gn-l')?.offsetWidth || 0;
    gantt.scrollLeft = Math.max(
      0,
      now.offsetLeft - label - Math.round((gantt.clientWidth - label) * this.SCROLL_SHARE),
    );
  }
}

/** Лента дней графика: положение дня в пикселях, полосы, отметки, шапка месяцев и недель. */
class GanttTape {
  constructor(low, high, dayPx) {
    this.low = low;
    this.high = high;
    this.px = dayPx;
    this.width = Math.round((high - low + 1) * dayPx);
  }

  /**
   * Левый край дня, px.
   * @param {number} day
   * @returns {number}
   */
  left(day) {
    return Math.round((day - this.low) * this.px);
  }

  /**
   * Середина дня, px.
   * @param {number} day
   * @returns {number}
   */
  mid(day) {
    return this.left(day) + Math.round(this.px / 2);
  }

  /**
   * День (с подписью после него) на ленте.
   * @param {number} day
   * @returns {boolean}
   */
  inside(day) {
    return day >= this.low && day + 1 <= this.high;
  }

  _clamp(day) {
    return Math.min(Math.max(day, this.low), this.high);
  }

  /**
   * Полоса от дня до дня.
   * @param {number} from
   * @param {number} until
   * @param {{cls: string, label: string, title: string}} look
   * @returns {string}
   */
  bar(from, until, { cls, label, title }) {
    if (until < this.low || from > this.high) return '';
    const start = this._clamp(from);
    const width = Math.max(CabGantt.MIN_BAR, this.left(this._clamp(until) + 1) - this.left(start));
    return `<span class="gn-b ${cls}" style="left:${this.left(start)}px;width:${width}px" title="${esc(title)}">${label ? `<span>${esc(label)}</span>` : ''}</span>`;
  }

  /**
   * Отметка дня.
   * @param {number} day
   * @param {{cls: string, sym: string, title: string}} look
   * @returns {string}
   */
  mark(day, { cls, sym, title }) {
    if (day < this.low || day > this.high) return '';
    return `<span class="gn-k ${cls}" style="left:${this.mid(day)}px" title="${esc(title)}">${sym}</span>`;
  }

  /**
   * Отметка дела.
   * @param {object} task
   * @returns {string}
   */
  task(task) {
    const title = `${CrmData.kind(task.kind)}: ${task.title} · ${CrmFmt.day(task.due)}${task.time ? ` ${task.time}` : ''}`;
    return this.mark(CrmFmt.dayNo(task.due), {
      cls: `gn-t${task.due < today() ? ' over' : ''}`,
      sym: CrmData.KINDS[task.kind] || '•',
      title,
    });
  }

  /**
   * Шапка: месяцы и недели.
   * @returns {string}
   */
  head() {
    let out = '';
    for (let day = this.low; day <= this.high; day++) out += this._month(day) + this._week(day);
    return out;
  }

  _month(day) {
    const date = new Date(day * CrmFmt.DAY_MS);
    if (date.getUTCDate() !== 1 && day !== this.low) return '';
    const next = Math.min(this.high + 1, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / CrmFmt.DAY_MS);
    const name = date.toLocaleDateString('ru-RU', {
      month: this.px < CabGantt.SHORT_MONTH_PX ? 'short' : 'long',
      timeZone: 'UTC',
    });
    const year = date.getUTCMonth() === 0 || day === this.low ? ` ${date.getUTCFullYear()}` : '';
    return `<span class="gn-m" style="left:${this.left(day)}px;width:${Math.round((next - day) * this.px)}px"><span>${name}${year}</span></span>`;
  }

  _week(day) {
    const date = new Date(day * CrmFmt.DAY_MS);
    const weekday = date.getUTCDay();
    const wide = this.px >= CabGantt.WEEKDAYS_PX;
    const monday = weekday === 1 && (wide || date.getUTCDate() <= CabGantt.MONTH_DAYS);
    let out = monday
      ? `<span class="gn-w" style="left:${this.left(day)}px">${wide ? date.getUTCDate() : ''}</span>`
      : '';
    if (this.px >= CabGantt.WEEKEND_PX && (weekday === 0 || weekday === CabGantt.SATURDAY)) {
      out += `<i class="gn-we" style="left:${this.left(day)}px;width:${Math.round(this.px)}px"></i>`;
    }
    return out;
  }
}
