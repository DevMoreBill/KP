import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { LostPick } from './lost-pick.js';
import { DealNeed } from './deal-need.js';
import { Cabinet } from './cabinet.js';
import { DealBulk } from './deal-bulk.js';
import { CabList } from './cab-list.js';
import { CabGantt } from './cab-gantt.js';
import { CabPay } from './cab-pay.js';
import { Toast } from '../../core/toast.js';
import { FEAT } from '../../core/features.js';
import { Api } from '../../core/net.js';
import { Mobile } from '../../ui/mobile.js';
import { esc, today } from '../../core/util.js';

/**
 * «Сделки»: доска по стадиям (перетаскивание мышью) или список (на телефоне — по умолчанию, с отбором стадии чипами).
 * Над ними — воронка, поиск, быстрые отборы, порядок и итог.
 */
export class CabDeals {
  static VIEW_KEY = 'kp.cab.view';
  static SORT_KEY = 'kp.cab.sort';
  static SORTS = { exp: 'по ожидаемой дате', free: 'сначала без дела', sum: 'по сумме', fresh: 'сначала новые' };
  // счётчики дел, как в Битрикс24: просрочено, на сегодня, запланировано, без дела
  static COUNTERS = {
    overdue: ['Просрочены', deal => !!deal.next && deal.next.due < today(), 'bad'],
    today: ['На сегодня', deal => !!deal.next && deal.next.due === today(), 'ok'],
    planned: ['Запланированы', deal => !!deal.next && deal.next.due > today(), ''],
    free: ['Без дела', deal => !deal.next, 'warn'],
  };
  static FILTERS = {
    ...Object.fromEntries(Object.entries(CabDeals.COUNTERS).map(([key, [label, test]]) => [key, [label, test]])),
    late: ['Срок сделки прошёл', deal => deal.expected && deal.expected < today()],
    month: ['Ожидаются в этом месяце', deal => String(deal.expected || '').slice(0, 7) <= today().slice(0, 7)],
    new: ['Новые из Битрикс24', deal => deal.bxNew],
    exec: ['Исполнение просрочено', deal => deal.execSum && deal.execSum.overdue],
  };
  static LIMIT = 60;
  static PERCENT = 100;
  static LIST_LIMIT = 100;
  static LIGHT = 150;
  static PERCENT_LABEL = /^(\d{1,3})\s*%\s*[-–—:]?\s*(.*)$/;
  static PAUSED = 'paused';
  static closed = false;
  static filter = '';
  static stage = '';
  static sort = null;
  static view = null;
  static more = new Set();
  static adding = '';
  static drag = matchMedia('(pointer:fine)').matches;

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    this._restore();
    if (this.view === 'gantt') return CabGantt.html(this._views());
    if (this.view === 'pay') return this._pay();
    const deals = this.deals();
    const open = deals.filter(deal => !CrmData.closed(deal));
    const empty =
      deals.length || Cabinet.query || this.filter
        ? ''
        : '<p class="msg">Сделки появляются сами, когда вы сохраняете КП, — или нажмите «＋ Сделка» вверху.</p>';
    const body = this.view === 'list' ? this._list(deals) : this._board(deals);
    const sum = CrmFmt.short(open.reduce((total, deal) => total + (deal.sum || 0), 0));
    return `<div class="cab-bar">${CrmFunnel.switcher(CrmData.deals(), CrmData.funnel())}${Cabinet.search('Сделка, клиент, ИНН или № КП')}${this._views()}${this._sortSelect()}${DealBulk.toggle()}<span class="muted cab-tot">В работе <b>${open.length}</b> · ${sum}</span></div>
      <div class="cab-flt" role="group" aria-label="Быстрый отбор">${this._chips()}</div>${empty}${body}${DealBulk.bar()}`;
  }

  static _restore() {
    if (this.sort === null) this.sort = this._stored(this.SORT_KEY, Object.keys(this.SORTS), 'exp');
    if (this.view === null)
      this.view = this._stored(this.VIEW_KEY, ['board', 'list', 'gantt', 'pay'], Mobile.isPhone() ? 'list' : 'board');
    if (this.view === 'pay' && !FEAT.on('payCalendar')) this.view = 'board';
  }

  static _stored(key, allowed, fallback) {
    try {
      const value = localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  static _keep(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // выбор просто не запомнится
    }
  }

  /**
   * Сделки открытой воронки по поиску и отборам (закрытые — если включены).
   * @returns {object[]}
   */
  static deals() {
    const test = this.FILTERS[this.filter] ? this.FILTERS[this.filter][1] : () => true;
    const paused = this.filter === this.PAUSED;
    return CrmData.deals().filter(
      deal =>
        CrmData.inFunnel(deal) &&
        Cabinet.match(deal) &&
        (this.closed || !CrmData.closed(deal)) &&
        (CrmData.closed(deal) || (CrmData.paused(deal) === paused && (paused || test(deal)))),
    );
  }

  static _views() {
    const views = [
      ['board', '▦ Доска'],
      ['list', '☰ Список'],
      ['gantt', '▤ График'],
      ...(FEAT.on('payCalendar') ? [['pay', '₽ Оплаты']] : []),
    ];
    const buttons = views
      .map(
        ([key, label]) =>
          `<button type="button" role="radio" aria-checked="${this.view === key}" class="${this.view === key ? 'on' : ''}" data-cview="${key}">${label}</button>`,
      )
      .join('');
    return `<div class="seg cab-view" role="radiogroup" aria-label="Вид">${buttons}</div>`;
  }

  static _pay() {
    return `<div class="cab-bar">${this._views()}${Cabinet.search('Сделка или клиент')}</div>${CabPay.html()}`;
  }

  static _sortSelect() {
    const options = Object.entries(this.SORTS)
      .map(([key, label]) => `<option value="${key}"${this.sort === key ? ' selected' : ''}>${label}</option>`)
      .join('');
    return `<select id="cabSort" class="cab-sort" aria-label="Порядок сделок" title="Порядок сделок">${options}</select>`;
  }

  static _chips() {
    const open = CrmData.openDeals().filter(deal => CrmData.inFunnel(deal));
    const counters = Object.entries(this.COUNTERS)
      .map(([key, [label, test, tone]]) => {
        const count = open.filter(test).length;
        const picked = this.filter === key;
        return `<button type="button" class="cnt${picked ? ' on' : ''}${count && tone ? ` cnt-${tone}` : ''}" data-cflt="${key}" aria-pressed="${picked}"><b>${count}</b> ${label}</button>`;
      })
      .join('');
    const chips = Object.entries(this.FILTERS)
      .filter(([key]) => !this.COUNTERS[key])
      .map(([key, [label, test]]) => [key, label, open.filter(test).length])
      .filter(([key, , count]) => count || this.filter === key)
      .map(([key, label, count]) =>
        this._chip({ attr: `data-cflt="${key}"`, label: `${label} <b>${count}</b>`, on: this.filter === key }),
      )
      .join('');
    const pausedCount = CrmData.deals().filter(deal => CrmData.inFunnel(deal) && CrmData.paused(deal)).length;
    const paused =
      pausedCount || this.filter === this.PAUSED
        ? this._chip({
            attr: `data-cflt="${this.PAUSED}"`,
            label: `⏸ Отложенные <b>${pausedCount}</b>`,
            on: this.filter === this.PAUSED,
          })
        : '';
    const closed = this._chip({ attr: 'data-cclosed', label: 'Показать закрытые', on: this.closed });
    const all = this._chip({ attr: 'data-cflt=""', label: 'Все в работе', on: !this.filter });
    return `<span class="cab-cnts" role="group" aria-label="Дела по сделкам"><span class="muted">Дела:</span>${counters}</span>${all}${chips}${paused}${closed}`;
  }

  static _chip({ attr, label, on }) {
    return `<button type="button" class="chip${on ? ' on' : ''}" ${attr} aria-pressed="${on}">${label}</button>`;
  }

  static _order(one, two) {
    const byDate = String(one.expected || '9').localeCompare(String(two.expected || '9'));
    const orders = {
      free: () => !!one.next - !!two.next || byDate,
      sum: () => (two.sum || 0) - (one.sum || 0) || byDate,
      fresh: () => !!two.bxNew - !!one.bxNew || String(two.created || '').localeCompare(String(one.created || '')),
    };
    return orders[this.sort] ? orders[this.sort]() : byDate;
  }

  static _sorted(deals) {
    return deals.slice().sort((one, two) => this._order(one, two));
  }

  static _board(deals) {
    const funnel = CrmData.funnel();
    const columns = CrmData.stages()
      .filter(stage => this.closed || !stage.closed)
      .map(stage => this._column(stage, deals, funnel))
      .join('');
    return `<div class="kb">${columns}</div>`;
  }

  static _column(stage, deals, funnel) {
    const list = this._sorted(deals.filter(deal => deal.stage === stage.key));
    const sum = list.reduce((total, deal) => total + (deal.sum || 0), 0);
    const shown = this.more.has(stage.key) ? list : list.slice(0, this.LIMIT);
    const rest = list.length - shown.length;
    const more = rest
      ? `<button type="button" class="btn sm ghost kb-more" data-kbmore="${esc(stage.key)}">Показать ещё ${rest}</button>`
      : '';
    const empty = `<p class="kb-e">${this.drag ? 'Перетащите сюда сделку' : 'Пусто'}</p>`;
    const paint = stage.color ? ` style="--sc:${esc(stage.color)};--st:${this._ink(stage.color)}"` : '';
    const add = !this._quickAt(stage)
      ? ''
      : `<button type="button" class="kb-add" data-kbadd="${esc(stage.key)}" title="Быстрая сделка на этой стадии" aria-label="Быстрая сделка: ${esc(stage.label)}">＋</button>`;
    return `<section class="kb-c" data-kbs="${esc(stage.key)}" aria-label="${esc(stage.label)}"><header class="kb-h t-${CrmFunnel.tone(funnel, stage.key)}"${paint}>
      <div class="kb-rb" title="${esc(stage.label)}">${this._stageName(stage.label)}<span class="kb-n">${list.length}</span></div>
      <div class="kb-sum">${CrmFmt.short(sum)}</div>${add}</header>
      <div class="kb-l">${this.adding === stage.key ? this._quick(stage) : ''}${shown.map(deal => this.card(deal)).join('') || (this.adding === stage.key ? '' : empty)}${more}</div></section>`;
  }

  // «40% - ТКП» → метка «40%» и название в одну строку (полное — в подсказке шапки)
  static _stageName(label) {
    const found = String(label).match(this.PERCENT_LABEL);
    if (!found) return `<b>${esc(label)}</b>`;
    return `<i class="kb-pc">${esc(found[1])}%</i><b>${esc(found[2] || label)}</b>`;
  }

  // цвет надписи на шапке стадии: тёмный на светлой заливке, белый — на тёмной
  static _ink(hex) {
    const value = parseInt(String(hex).slice(1), 16);
    const [red, green, blue] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    return red * 0.299 + green * 0.587 + blue * 0.114 > this.LIGHT ? '#1F2B4D' : '#fff';
  }

  // быстрая сделка: на открытых стадиях; по регламенту Битрикс24 новая сделка — только с первой стадии
  static _quickAt(stage) {
    if (stage.closed) return false;
    return !CrmData.regs() || stage.key === CrmData.stages({ open: true })[0]?.key;
  }

  static _quick(stage) {
    return `<form class="kb-q" data-kbform="${esc(stage.key)}"><input type="text" name="title" maxlength="200" placeholder="Клиент или задача" aria-label="Клиент или задача" required autocomplete="off">
      <input type="text" name="sum" inputmode="decimal" placeholder="Сумма, ₽ (необязательно)" aria-label="Сумма"><div class="row"><button class="btn primary sm" type="submit">Создать</button><button class="btn sm ghost" type="button" data-kbcancel>Отмена</button></div></form>`;
  }

  /**
   * Быстрая сделка из колонки доски: название или клиент, сумма — на этой стадии открытой воронки.
   * @param {HTMLFormElement} form
   */
  static async quick(form) {
    const title = form.elements.title.value.trim();
    if (!title) return;
    const body = { title, stage: form.dataset.kbform, funnel: CrmData.funnel() };
    const sum = form.elements.sum.value.replace(/\s/g, '').replace(',', '.');
    if (sum) body.sum = sum;
    try {
      await Api.request('/api/crm/deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      this.adding = '';
      Toast.show(`Сделка «${title}» создана`);
      Cabinet.reload();
    } catch (error) {
      Toast.show(`Сделка не создана: ${error.message}`);
    }
  }

  /**
   * Карточка сделки на доске.
   * @param {object} deal
   * @returns {string}
   */
  static card(deal) {
    const closed = CrmData.closed(deal);
    const drag = this.drag && !closed ? ' draggable="true"' : '';
    const title = deal.title || deal.client || `Сделка № ${deal.number}`;
    const client = deal.client && deal.client !== deal.title ? esc(deal.client) : '';
    const count = (deal.kps || []).length;
    const link = deal.bxUrl
      ? `<a class="dc-bx" href="${esc(deal.bxUrl)}" target="_blank" rel="noopener" title="Открыть в Битрикс24" aria-label="Открыть в Битрикс24">Б24</a>`
      : '';
    const kps = this._kps(count);
    const picked = DealBulk.picked.has(deal.id) ? ' picked' : '';
    return `<article class="dc${picked} t-${CrmData.toneOf(deal)}" data-deal="${esc(deal.id)}"${drag} tabindex="0">
      <div class="dc-h">${DealBulk.box(deal)}<b class="dc-t" title="${esc(title)}">${esc(title)}</b>${link}</div>${client ? `<span class="dc-c">${client}</span>` : ''}
      <div class="dc-m">${kps}${this._expected(deal)}<b class="dc-s">${CrmFmt.short(deal.sum)}</b></div>
      <div class="dc-nx">${this._next(deal)}</div>${this.exec(deal)}${this._foot(deal)}</article>`;
  }

  static _kps(count) {
    if (!count) return '<i class="dc-k none" title="КП ещё нет">без КП</i>';
    return `<i class="dc-k" title="КП по сделке: ${count}">КП ${count}</i>`;
  }

  static _expected(deal) {
    if (!deal.expected) return '';
    const late = deal.expected < today() && !CrmData.closed(deal);
    return `<span class="dc-d ${late ? 'bad-t' : 'muted'}" title="${late ? 'Ожидаемая дата прошла' : 'Ожидаемая дата'}">${late ? '⚠ ' : 'до '}${esc(CrmFmt.day(deal.expected))}</span>`;
  }

  static _next(deal) {
    if (CrmData.closed(deal)) {
      const why = deal.stage === 'lost' ? deal.lostReason || deal.fstage : '';
      return why ? `<span class="dc-n muted">${esc(deal.lostReason || CrmFunnel.label(deal))}</span>` : '';
    }
    const step = deal.next;
    if (!step)
      return `<button type="button" class="dc-add" data-dstep="${esc(deal.id)}" title="Запланировать следующий шаг">＋ Следующий шаг</button>`;
    const over = step.due < today() ? ' bad-t' : '';
    return `<span class="dc-n${over}">${CrmData.icon(step.kind)} ${esc(step.title)} · ${esc(CrmFmt.rel(step.due))}</span>`;
  }

  /**
   * Исполнение после договора: полоска «сделано из всех» и ближайшая точка.
   * @param {object} deal
   * @returns {string}
   */
  static exec(deal) {
    const sum = deal.execSum;
    if (!sum || !sum.total) return '';
    const width = Math.round((sum.done / sum.total) * this.PERCENT);
    const step = sum.next ? ` · ${esc(sum.next.label)} ${esc(CrmFmt.day(sum.next.plan))}` : '';
    const late = sum.overdue ? ' bad-t' : '';
    return `<span class="dc-x${late}" title="Исполнение: сделано ${sum.done} из ${sum.total}"><i class="dc-xb"><i style="width:${width}%"></i></i>${sum.done}/${sum.total}${step}</span>`;
  }

  // низ карточки — только когда есть что сказать: новая заявка Битрикс24, ответственный (в «Весь отдел»)
  static _foot(deal) {
    const parts = [
      CrmData.paused(deal)
        ? `<span>⏸ до ${esc(CrmFmt.day(deal.pausedUntil))}</span> <button type="button" class="lnk" data-dunpause="${esc(deal.id)}">вернуть в работу</button>`
        : '',
      deal.bxNew ? '<b class="dc-new">Новая из Битрикс24</b>' : '',
      CrmData.all() ? esc(CrmData.mgrShort(deal)) : '',
    ].filter(Boolean);
    return parts.length ? `<span class="dc-f muted">${parts.join(' · ')}</span>` : '';
  }

  static _list(deals) {
    const stages = CrmData.stages().filter(stage => this.closed || !stage.closed);
    const picked = stages.some(stage => stage.key === this.stage) ? this.stage : '';
    const rows = this._sorted(deals.filter(deal => !picked || deal.stage === picked));
    const shown = this.more.has('list') ? rows : rows.slice(0, this.LIST_LIMIT);
    const rest = rows.length - shown.length;
    const more = rest
      ? `<button type="button" class="btn ghost kb-more" data-kbmore="list">Показать ещё ${rest}</button>`
      : '';
    if (!shown.length)
      return `${this._stageChips(stages, deals, picked)}<p class="empty">${Cabinet.query || this.filter ? 'Не найдено.' : 'Сделок нет. <button class="btn sm primary" type="button" data-cq="mail">📩 Сделка из письма</button> <button class="btn sm" type="button" data-cq="deal">🤝 Сделка</button>'}</p>`;
    const row = { expected: deal => this._expected(deal), next: deal => `${this._next(deal)}${this.exec(deal)}` };
    return `${this._stageChips(stages, deals, picked)}${CabList.html(shown, { more, row })}`;
  }

  static _stageChips(stages, deals, picked) {
    const chips = stages
      .map(stage => [stage, deals.filter(deal => deal.stage === stage.key).length])
      .filter(([stage, count]) => count || stage.key === picked)
      .map(([stage, count]) =>
        this._chip({
          attr: `data-cstage="${esc(stage.key)}"`,
          label: `${esc(stage.label)} <b>${count}</b>`,
          on: stage.key === picked,
        }),
      )
      .join('');
    return `<div class="cab-flt cab-stg" role="group" aria-label="Стадия">${this._chip({ attr: 'data-cstage=""', label: 'Все стадии', on: !picked })}${chips}</div>`;
  }

  /**
   * После вывода раздела: график — к сегодняшнему дню.
   * @param {HTMLElement} body
   */
  static after(body) {
    if (this.view === 'gantt') CabGantt.after(body);
  }

  /**
   * Щелчки раздела: вид, отборы, «Показать ещё». true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const target = event.target;
    if (
      DealBulk.click(
        event,
        () => Cabinet.renderBody(),
        () => Cabinet.reload(),
      )
    )
      return true;
    if (this.view === 'pay' && CabPay.click(event)) return true;
    if (CabList.click(event)) {
      Cabinet.renderBody();
      return true;
    }
    const actions = [
      ['[data-kbadd]', el => (this.adding = this.adding === el.dataset.kbadd ? '' : el.dataset.kbadd)],
      ['[data-kbcancel]', () => (this.adding = '')],
      ['[data-cview]', el => this._setView(el.dataset.cview)],
      ['[data-cflt]', el => this._setFilter(el.dataset.cflt)],
      ['[data-cclosed]', () => (this.closed = !this.closed)],
      ['[data-cstage]', el => (this.stage = el.dataset.cstage)],
      ['[data-kbmore]', el => this.more.add(el.dataset.kbmore)],
    ];
    for (const [selector, run] of actions) {
      const el = target.closest(selector);
      if (el) {
        run(el);
        if (Cabinet.tab === 'deals') Cabinet.renderBody();
        else Cabinet.show('deals');
        if (this.adding) document.querySelector(`[data-kbform="${CSS.escape(this.adding)}"] input`)?.focus();
        return true;
      }
    }
    return false;
  }

  static _setView(view) {
    this.view = view;
    this._keep(this.VIEW_KEY, view);
  }

  static _setFilter(filter) {
    this.filter = filter;
    this.more.clear();
  }

  /**
   * Изменения полей раздела (воронка, порядок). true — нужно перерисовать.
   * @param {HTMLElement} target
   * @returns {boolean}
   */
  static change(target) {
    if (DealBulk.change(target, () => Cabinet.reload())) return false;
    if (target.id === 'cabFunnel') {
      CrmFunnel.set(target.value);
      this.more.clear();
      this.stage = '';
      return true;
    }
    if (target.id !== 'cabSort') return false;
    this.sort = target.value;
    this._keep(this.SORT_KEY, target.value);
    return true;
  }

  /**
   * Перетаскивание карточек между стадиями (мышь).
   * @param {HTMLElement} box окно кабинета
   */
  static bindDrag(box) {
    if (!this.drag) return;
    box.addEventListener('dragstart', event => {
      const card = event.target.closest && event.target.closest('.dc');
      if (!card) return;
      event.dataTransfer.setData('text/plain', card.dataset.deal);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('drag');
    });
    box.addEventListener('dragend', event => {
      event.target.closest?.('.dc')?.classList.remove('drag');
      this._unmark(box);
    });
    box.addEventListener('dragover', event => {
      const column = event.target.closest('.kb-c');
      if (!column) return;
      event.preventDefault();
      this._unmark(box, column);
      column.classList.add('over');
    });
    box.addEventListener('drop', event => this._drop(event));
  }

  static _unmark(box, keep) {
    box.querySelectorAll('.kb-c.over').forEach(column => column !== keep && column.classList.remove('over'));
  }

  static _drop(event) {
    const column = event.target.closest('.kb-c');
    if (!column) return;
    event.preventDefault();
    column.classList.remove('over');
    const deal = CrmData.deal(event.dataTransfer.getData('text/plain'));
    if (deal && deal.stage !== column.dataset.kbs) this.move(deal, column.dataset.kbs);
  }

  /**
   * Сменить стадию сделки; «Проиграно» — с причиной.
   * @param {object} deal
   * @param {string} stage
   */
  static async move(deal, stage) {
    const body = stage === 'lost' ? await LostPick.ask(deal) : { stage };
    if (!body) return;
    if (await DealNeed.move(deal, body))
      Toast.show(`«${deal.title || deal.client}» → ${CrmFunnel.anyLabel(body.stage)}`);
    Cabinet.reload();
  }
}
