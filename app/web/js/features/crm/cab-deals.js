import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { LostPick } from './lost-pick.js';
import { Cabinet } from './cabinet.js';

/**
 * «Сделки»: доска по стадиям (перетаскивание мышью) или список (на телефоне — по умолчанию, с отбором стадии чипами).
 * Над ними — воронка, поиск, быстрые отборы, порядок и итог.
 */
export class CabDeals {
  static VIEW_KEY = 'kp.cab.view';
  static SORT_KEY = 'kp.cab.sort';
  static SORTS = { exp: 'по ожидаемой дате', free: 'сначала без дела', sum: 'по сумме', fresh: 'сначала новые' };
  static FILTERS = {
    free: ['Без дела', deal => !deal.next],
    late: ['Срок прошёл', deal => deal.expected && deal.expected < today()],
    month: ['Ожидаются в этом месяце', deal => String(deal.expected || '').slice(0, 7) <= today().slice(0, 7)],
    new: ['Новые из Битрикс24', deal => deal.bxNew],
  };
  static LIMIT = 60;
  static LIST_LIMIT = 100;
  static closed = false;
  static filter = '';
  static stage = '';
  static sort = null;
  static view = null;
  static more = new Set();
  static drag = matchMedia('(pointer:fine)').matches;

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    this._restore();
    const deals = this.deals();
    const open = deals.filter(deal => !CrmData.closed(deal));
    const empty =
      deals.length || Cabinet.query || this.filter
        ? ''
        : '<p class="msg">Сделки появляются сами, когда вы сохраняете КП, — или нажмите «＋ Сделка» вверху.</p>';
    const body = this.view === 'list' ? this._list(deals) : this._board(deals);
    const sum = CrmFmt.short(open.reduce((total, deal) => total + (deal.sum || 0), 0));
    return `<div class="cab-bar">${CrmFunnel.switcher(CrmData.deals(), CrmData.funnel())}${Cabinet.search('Сделка, клиент, ИНН или № КП')}${this._views()}${this._sortSelect()}<span class="muted cab-tot">В работе <b>${open.length}</b> · ${sum}</span></div>
      <div class="cab-flt" role="group" aria-label="Быстрый отбор">${this._chips()}</div>${empty}${body}`;
  }

  static _restore() {
    if (this.sort === null) this.sort = this._stored(this.SORT_KEY, Object.keys(this.SORTS), 'exp');
    if (this.view === null) this.view = this._stored(this.VIEW_KEY, ['board', 'list'], isMob() ? 'list' : 'board');
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
    return CrmData.deals().filter(
      deal =>
        CrmData.inFunnel(deal) &&
        Cabinet.match(deal) &&
        (this.closed || !CrmData.closed(deal)) &&
        (CrmData.closed(deal) || test(deal)),
    );
  }

  static _views() {
    const views = [
      ['board', '▦ Доска'],
      ['list', '☰ Список'],
    ];
    const buttons = views
      .map(
        ([key, label]) =>
          `<button type="button" role="radio" aria-checked="${this.view === key}" class="${this.view === key ? 'on' : ''}" data-cview="${key}">${label}</button>`,
      )
      .join('');
    return `<div class="seg cab-view" role="radiogroup" aria-label="Вид">${buttons}</div>`;
  }

  static _sortSelect() {
    const options = Object.entries(this.SORTS)
      .map(([key, label]) => `<option value="${key}"${this.sort === key ? ' selected' : ''}>${label}</option>`)
      .join('');
    return `<select id="cabSort" class="cab-sort" aria-label="Порядок сделок" title="Порядок сделок">${options}</select>`;
  }

  static _chips() {
    const open = CrmData.openDeals().filter(deal => CrmData.inFunnel(deal));
    const chips = Object.entries(this.FILTERS)
      .map(([key, [label, test]]) => [key, label, open.filter(test).length])
      .filter(([key, , count]) => count || this.filter === key)
      .map(([key, label, count]) =>
        this._chip({ attr: `data-cflt="${key}"`, label: `${label} <b>${count}</b>`, on: this.filter === key }),
      )
      .join('');
    const closed = this._chip({ attr: 'data-cclosed', label: 'Показать закрытые', on: this.closed });
    return `${this._chip({ attr: 'data-cflt=""', label: 'Все в работе', on: !this.filter })}${chips}${closed}`;
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
    const dot = stage.color ? ` style="background:${esc(stage.color)}"` : '';
    const more = rest
      ? `<button type="button" class="btn sm ghost kb-more" data-kbmore="${esc(stage.key)}">Показать ещё ${rest}</button>`
      : '';
    const empty = `<p class="kb-e">${this.drag ? 'Перетащите сюда сделку' : 'Пусто'}</p>`;
    return `<section class="kb-c" data-kbs="${esc(stage.key)}" aria-label="${esc(stage.label)}"><header class="kb-h"><span class="cab-dot t-${CrmFunnel.tone(funnel, stage.key)}"${dot} aria-hidden="true"></span><b title="${esc(stage.label)}">${esc(stage.label)}</b><span class="muted">${list.length}${sum ? ` · ${CrmFmt.short(sum)}` : ''}</span></header>
      <div class="kb-l">${shown.map(deal => this.card(deal)).join('') || empty}${more}</div></section>`;
  }

  /**
   * Карточка сделки на доске.
   * @param {object} deal
   * @returns {string}
   */
  static card(deal) {
    const closed = CrmData.closed(deal);
    const drag = this.drag && !closed ? ' draggable="true"' : '';
    const client = deal.client && deal.client !== deal.title ? `<span class="dc-c">${esc(deal.client)}</span>` : '';
    return `<article class="dc t-${CrmData.toneOf(deal)}" data-deal="${esc(deal.id)}"${drag} tabindex="0">
      <b class="dc-t">${esc(deal.title || deal.client || `Сделка № ${deal.number}`)}</b>${client}
      <div class="dc-r"><b>${CrmFmt.short(deal.sum)}</b>${this._expected(deal)}</div>${this._next(deal)}${this._foot(deal)}</article>`;
  }

  static _expected(deal) {
    if (!deal.expected) return '';
    const late = deal.expected < today() && !CrmData.closed(deal);
    return `<span class="${late ? 'bad-t' : 'muted'}" title="Ожидаемая дата">${late ? 'срок прошёл · ' : 'до '}${esc(CrmFmt.day(deal.expected))}</span>`;
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

  static _foot(deal) {
    const count = (deal.kps || []).length;
    const parts = [
      deal.bxNew ? '<b class="dc-new">Новая из Битрикс24</b>' : '',
      count ? `КП ${count}` : 'без КП',
      CrmData.all() ? esc(CrmData.mgrShort(deal)) : '',
    ].filter(Boolean);
    const link = deal.bxUrl
      ? `<a class="dc-bx" href="${esc(deal.bxUrl)}" target="_blank" rel="noopener" title="Открыть в Битрикс24">Б24 ↗</a>`
      : '';
    return `<span class="dc-f muted">${parts.join(' · ')}${link}</span>`;
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
    const body =
      shown.map(deal => this._row(deal)).join('') ||
      `<p class="empty">${Cabinet.query || this.filter ? 'Не найдено.' : 'Сделок нет.'}</p>`;
    return `${this._stageChips(stages, deals, picked)}<div class="cab-ls" role="list">${this._listHead()}${body}${more}</div>`;
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

  static _listHead() {
    const who = CrmData.all() ? '<span>Ответственный</span>' : '';
    return `<div class="cab-lh${CrmData.all() ? ' lr-all' : ''}" aria-hidden="true"><span>Сделка</span><span>Стадия</span><span>Сумма</span><span>Ожидается</span><span>Следующий шаг</span>${who}</div>`;
  }

  static _row(deal) {
    const name = deal.title || deal.client || `Сделка № ${deal.number}`;
    const client = deal.client && deal.client !== name ? deal.client : `№ ${deal.number}`;
    const who = CrmData.all() ? `<span class="lr-m muted">${esc(CrmData.mgrShort(deal))}</span>` : '';
    return `<div class="cab-lr t-${CrmData.toneOf(deal)}${CrmData.all() ? ' lr-all' : ''}" role="listitem" data-deal="${esc(deal.id)}" tabindex="0">
      <span class="lr-n"><b>${esc(name)}</b><span class="muted">${esc(client)}</span></span>
      <span class="lr-s"><span class="cab-dot t-${CrmData.toneOf(deal)}" aria-hidden="true"></span>${esc(CrmFunnel.label(deal))}</span>
      <b class="lr-sum">${CrmFmt.short(deal.sum)}</b><span class="lr-e">${this._expected(deal) || '<span class="muted">—</span>'}</span>
      <span class="lr-x">${this._next(deal)}</span>${who}</div>`;
  }

  /**
   * Щелчки раздела: вид, отборы, «Показать ещё». true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const target = event.target;
    const actions = [
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
    try {
      await api(`/api/crm/deal/${deal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-KP-Rev': String(deal.rev) },
        body: JSON.stringify(body),
      });
      toast(`«${deal.title || deal.client}» → ${CrmFunnel.anyLabel(body.stage)}`);
    } catch (error) {
      toast(`Стадия не изменена: ${error.message}`);
    }
    Cabinet.reload();
  }
}
