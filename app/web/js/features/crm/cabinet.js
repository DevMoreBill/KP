import { CrmData } from './crm-data.js';
import { CrmTask } from './crm-task.js';
import { CabToday } from './cab-today.js';
import { CabDeals } from './cab-deals.js';
import { CabGantt } from './cab-gantt.js';
import { CabClients } from './cab-clients.js';
import { CabTeam } from './cab-team.js';
import { CabGuide } from './cab-guide.js';
import { DealCard } from './deal-card.js';
import { DealNew } from './deal-new.js';

/**
 * Окно кабинета менеджера: почти весь экран, шапка в одну строку (приветствие, разделы, чей кабинет, «＋ Дело / Сделка / КП»),
 * содержимое раздела. Открывается на «Сегодня»; выбранный раздел помнится, пока открыта страница.
 */
export class Cabinet {
  static TABS = [
    ['today', 'Сегодня'],
    ['deals', 'Сделки'],
    ['gantt', 'График'],
    ['clients', 'Клиенты'],
    ['team', 'Отдел'],
  ];
  static HOURS = [
    [5, 'Доброй ночи'],
    [12, 'Доброе утро'],
    [18, 'Добрый день'],
    [24, 'Добрый вечер'],
  ];
  static TYPING_MS = 250;
  static tab = 'today';
  static query = '';
  static drafts = [];
  static _seenNew = 0;
  static _shownTab = '';
  static _typing = null;

  /**
   * Окно кабинета (создаётся один раз).
   * @returns {HTMLDialogElement}
   */
  static dlg() {
    return Modal.host('cabWin', 'cabwin', 'Кабинет менеджера', dialog => this._init(dialog));
  }

  /**
   * Открыть кабинет (tab — сразу на разделе).
   * @param {string} [tab]
   */
  static async open(tab) {
    if (!MyDay.enabled()) return;
    if (tab) this.tab = tab;
    const dialog = this.dlg();
    if (!dialog.open) dialog.showModal();
    if (!dialog.innerHTML) dialog.innerHTML = '<p class="empty cab-wait">Загружаю кабинет…</p>';
    await this.reload();
  }

  /** Загрузить данные и перерисовать. */
  static async reload() {
    try {
      await CrmData.load();
    } catch (error) {
      this._fail(error);
      return;
    }
    if (this.tab === 'team' && !CrmData.board.canAll) this.tab = 'today';
    await this._extras();
    this.render();
    this._announce();
  }

  static _fail(error) {
    this.dlg().innerHTML = `<div class="dlg-h"><h3>Кабинет</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div><p class="msg err">Кабинет не открылся: ${esc(error.message || error)}</p>`;
    if (error.status === 403 && CrmData.who) CrmData.who = '';
  }

  static async _extras() {
    const mine = CrmData.mine();
    if (FEAT.on('reminders') && mine) await Reminders.load();
    this.drafts = Drafts.enabled() && mine ? await Drafts.list() : [];
  }

  static _announce() {
    const count = CabToday.bxNew().length;
    if (!count || !CrmData.mine() || this._seenNew === count) return;
    this._seenNew = count;
    toast(`Из Битрикс24 пришли новые сделки: ${count} — «Сегодня» → «Требуют внимания»`);
  }

  /** Перерисовать шапку и раздел (прокрутка раздела сохраняется). */
  static render() {
    if (!CrmData.board) return;
    const dialog = this.dlg();
    const old = dialog.querySelector('.cab-b');
    const scroll = old && this._shownTab === this.tab ? old.scrollTop : 0;
    const view = this._view();
    dialog.innerHTML = `${this._head()}<div class="cab-b cab-${this.tab}">${view.html()}</div>${this._fab()}`;
    const body = dialog.querySelector('.cab-b');
    body.scrollTop = scroll;
    this._shownTab = this.tab;
    if (view.after) view.after(body);
  }

  /** Перерисовать только раздел (поиск: поле ввода не теряет набранное и курсор). */
  static renderBody() {
    const body = this.dlg().querySelector('.cab-b');
    if (!body) return;
    const view = this._view();
    const field = document.activeElement && document.activeElement.id === 'cabQ' ? document.activeElement : null;
    const caret = field ? field.selectionStart : 0;
    body.innerHTML = view.html();
    if (view.after) view.after(body);
    const again = field && body.querySelector('#cabQ');
    if (!again) return;
    again.focus();
    again.setSelectionRange(caret, caret);
  }

  static _view() {
    const views = { today: CabToday, deals: CabDeals, gantt: CabGantt, clients: CabClients, team: CabTeam };
    return views[this.tab] || CabToday;
  }

  /**
   * Перейти в раздел.
   * @param {string} tab
   */
  static show(tab) {
    this.tab = tab;
    this.render();
  }

  static _hello() {
    const hour = new Date().getHours();
    return this.HOURS.find(([until]) => hour < until)[1];
  }

  static _title() {
    const board = CrmData.board;
    if (CrmData.all()) return 'Весь отдел';
    if (!CrmData.mine()) return esc((board.managers || []).find(mgr => mgr.id === CrmData.who)?.name || 'Кабинет');
    const words = MyDay.myName().split(/\s+/);
    const first = words[1] || words[0] || '';
    return `${this._hello()}${first ? `, ${esc(first)}` : ''}!`;
  }

  static _head() {
    const date = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<header class="cab-h"><div class="cab-t"><h3>${this._title()}</h3><span class="muted md-date">${esc(date)}</span></div>
      <nav class="cab-tabs" role="tablist" aria-label="Разделы кабинета">${this._tabs()}</nav>
      <div class="cab-tools">${this._who()}<span class="cab-q"><button class="btn" type="button" data-cq="task" title="Звонок, встреча, письмо или задача">＋ Дело</button><button class="btn" type="button" data-cq="deal" title="Сделка без КП: запрос, встреча, тендер">＋ Сделка</button><button class="btn primary" type="button" data-cq="newkp">＋ КП</button></span>
      <button class="icon cab-help" type="button" data-cguide aria-label="Как пользоваться кабинетом" title="Как пользоваться кабинетом">?</button><button class="icon" type="button" data-x aria-label="Закрыть кабинет" title="Закрыть (Esc)">✕</button></div></header>`;
  }

  static _tabs() {
    return this.TABS.filter(([key]) => key !== 'team' || CrmData.board.canAll)
      .map(([key, label]) => {
        const count = this._count(key);
        const active = this.tab === key;
        return `<button type="button" role="tab" aria-selected="${active}" class="cab-tab${active ? ' on' : ''}" data-ctab="${key}">${label}${count ? ` <b class="md-c">${count}</b>` : ''}</button>`;
      })
      .join('');
  }

  static _count(key) {
    if (key === 'today')
      return CrmData.openTasks().filter(task => task.due <= today()).length + CabToday.bxNew().length;
    if (key === 'deals') return CrmData.openDeals().length;
    return 0;
  }

  static _who() {
    const board = CrmData.board;
    if (!board.canAll) return '';
    const others = (board.managers || [])
      .filter(mgr => mgr.id !== board.me)
      .map(
        mgr => `<option value="${esc(mgr.id)}"${CrmData.who === mgr.id ? ' selected' : ''}>${esc(mgr.name)}</option>`,
      )
      .join('');
    return `<select id="cabWho" class="cab-who" aria-label="Чей кабинет" title="Чей кабинет показать"><option value="">Мой кабинет</option><option value="all"${CrmData.all() ? ' selected' : ''}>Весь отдел</option>${others}</select>`;
  }

  static _fab() {
    return `<div class="cab-fab"><div class="cab-fabm" hidden><button class="btn" type="button" data-cq="task">☎ Дело</button><button class="btn" type="button" data-cq="deal">🤝 Сделка</button><button class="btn primary" type="button" data-cq="newkp">📄 КП</button></div>
      <button class="cab-fabb" type="button" data-cfab aria-label="Создать: дело, сделку или КП" aria-expanded="false">＋</button></div>`;
  }

  static _toggleFab() {
    const menu = this.dlg().querySelector('.cab-fabm');
    const button = this.dlg().querySelector('[data-cfab]');
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', !menu.hidden);
  }

  static _quick(kind) {
    const after = () => this.reload();
    const actions = {
      task: () => CrmTask.quick('', after, { pick: true }),
      deal: () => DealNew.open(),
      newkp: () => this._leave(() => NewKp.open()),
      journal: () => this._leave(() => Journal.open()),
      catalog: () => this._leave(() => openCatalog({})),
      back: () => this._leave(() => null),
    };
    if (actions[kind]) actions[kind]();
  }

  static _leave(next) {
    this.dlg().close();
    next();
  }

  /**
   * Поиск: сделка подходит под строку (название, клиент, ИНН, номер, КП).
   * @param {object} deal
   * @param {string} [text]
   * @returns {boolean}
   */
  static match(deal, text = this.query) {
    const wanted = norm(text);
    if (!wanted) return true;
    const words = [deal.title, deal.client, deal.clientInn, `№${deal.number}`, deal.manager];
    return norm([...words, ...(deal.kps || []).map(offer => offer.number)].join(' ')).includes(wanted);
  }

  /**
   * Поле поиска раздела.
   * @param {string} placeholder
   * @returns {string}
   */
  static search(placeholder) {
    return `<input type="search" id="cabQ" class="cab-s" value="${esc(this.query)}" placeholder="${esc(placeholder)}" aria-label="Поиск" autocomplete="off" enterkeyhint="search">`;
  }

  static _dealIds(from) {
    const box = from.closest('.cab-b') || this.dlg();
    return [...new Set([...box.querySelectorAll('[data-deal]')].map(el => el.dataset.deal))];
  }

  static _clicks() {
    return [
      ['[data-x]', () => this.dlg().close()],
      ['a.dc-bx', () => null],
      ['[data-ctab]', el => this.show(el.dataset.ctab)],
      ['[data-cq]', el => this._quick(el.dataset.cq)],
      ['[data-cfab]', () => this._toggleFab()],
      ['[data-cguide]', () => CabGuide.open()],
      ['[data-ctip]', () => CabGuide.hideTip()],
      ['[data-kpi]', el => CabToday.kpi(el.dataset.kpi)],
      ['[data-dstep]', el => CrmTask.quick(el.dataset.dstep, () => this.reload())],
      ['[data-deal]', el => DealCard.open(el.dataset.deal, { list: this._dealIds(el) })],
      ['[data-cc]', el => ClientCard.open(JSON.parse(el.dataset.cc))],
      ['[data-cldeals]', el => this._clientDeals(el.dataset.cldeals)],
      ['[data-tmgr]', el => this._manager(el.dataset.tmgr)],
      ['[data-gsc]', el => CabGantt.scale(el.dataset.gsc)],
    ];
  }

  static _click(event) {
    if (CabDeals.click(event) || CabToday.click(event)) return;
    for (const [selector, run] of this._clicks()) {
      const el = event.target.closest(selector);
      if (el) {
        run(el);
        return;
      }
    }
  }

  static _clientDeals(name) {
    this.query = name;
    CabDeals.filter = '';
    this.show('deals');
  }

  static _manager(id) {
    CrmData.who = id;
    this.tab = 'deals';
    this.reload();
  }

  static _change(event) {
    const target = event.target;
    const changes = {
      cabWho: () => {
        CrmData.who = target.value;
        this.reload();
      },
      mdStart: () => {
        MyDay.setAtStart(target.checked);
        toast(target.checked ? 'Кабинет будет открываться при запуске' : 'Кабинет — в меню «⋯»');
      },
    };
    if (changes[target.id]) changes[target.id]();
    else if (CabDeals.change(target) || CabGantt.change(target)) this.render();
  }

  static _input(event) {
    if (event.target.id !== 'cabQ') return;
    this.query = event.target.value;
    this._typing = this._typing || new Debounce(this.TYPING_MS);
    this._typing.run(() => this.renderBody());
  }

  static _init(dialog) {
    dialog.addEventListener('click', event => this._click(event));
    dialog.addEventListener('change', event => this._change(event));
    dialog.addEventListener('input', event => this._input(event));
    CrmTask.bind(dialog, () => this.reload());
    CabDeals.bindDrag(dialog);
  }
}
