import { KpRate } from './kp-rate.js';
import { CabPay } from './cab-pay.js';
import { CrmData } from './crm-data.js';
import { AppTabs } from '../../core/app-tabs.js';
import { CrmTask } from './crm-task.js';
import { CabToday } from './cab-today.js';
import { CabDeals } from './cab-deals.js';
import { CabGantt } from './cab-gantt.js';
import { CabClients } from './cab-clients.js';
import { CompanyCardView } from './company-card.js';
import { CabTeam, MonthXlsx } from './cab-team.js';
import { CabGuide } from './cab-guide.js';
import { CabLayout } from './cab-layout.js';
import { CabPrefs } from './cab-prefs.js';
import { DealCard } from './deal-card.js';
import { DealNew } from './deal-new.js';
import { Debounce } from '../../core/debounce.js';
import { ClientCard } from '../kp/client-card.js';
import { Str } from '../../core/str.js';
import { CatalogWindow } from '../catalog/catalog-window.js';
import { Journal } from '../kp/journal.js';
import { NewKp } from '../kp/new-kp.js';
import { Toast } from '../../core/toast.js';
import { Drafts } from '../kp/drafts.js';
import { Reminders } from '../kp/reminders.js';
import { FEAT } from '../../core/features.js';
import { esc, today } from '../../core/util.js';
import { MyDay } from '../kp/my-day.js';
import { BrowserNotify } from './browser-notify.js';
import { Modal } from '../../core/modal.js';

/**
 * Окно кабинета менеджера: почти весь экран, шапка в одну строку (приветствие, разделы, чей кабинет, «＋ Дело / Сделка / КП»),
 * содержимое раздела. Открывается на «Сегодня»; выбранный раздел помнится, пока открыта страница.
 */
export class Cabinet {
  static NEW = [
    ['mail', '📩 Из письма или ТЗ', 'Вставьте письмо или ТЗ — клиент, суть и модели заполнятся сами'],
    ['deal', '🤝 Сделка', 'Сделка без КП: запрос, встреча, тендер'],
    ['newkp', '📄 КП', 'Новое коммерческое предложение'],
    ['task', '☎ Дело', 'Звонок, встреча, письмо или задача'],
  ];
  static TABS = [
    ['today', 'Сегодня'],
    ['deals', 'Сделки'],
    ['clients', 'Клиенты'],
    ['team', 'Отдел'],
    ['prefs', '⚙ Мои настройки'],
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
    this._legacy();
    const dialog = this.dlg();
    AppTabs.show(dialog, 'cab');
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
    if (!this._shownTabs().some(([key]) => key === this.tab)) this.tab = 'today';
    CabPay.reset();
    KpRate.load();
    await this._extras();
    this.render();
    this._announce();
    BrowserNotify.start(id => DealCard.open(id));
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
    Toast.show(`Из Битрикс24 пришли новые сделки: ${count} — «Сегодня» → «Что сделать»`);
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
    this._tabCount();
  }

  // на вкладке «Кабинет» — дела на сегодня и просроченные (красным, если просрочено)
  static _tabCount() {
    const now = today();
    const tasks = CrmData.openTasks();
    const over = tasks.filter(task => task.due < now).length;
    const due = over + tasks.filter(task => task.due === now).length;
    AppTabs.count('cab', due, over ? 'bad' : '');
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

  // «График» — вид внутри «Сделок» (прежняя ссылка на раздел ведёт туда)
  static _legacy() {
    if (this.tab !== 'gantt') return;
    this.tab = 'deals';
    CabDeals.view = 'gantt';
  }

  static _view() {
    const views = { today: CabToday, deals: CabDeals, clients: CabClients, team: CabTeam, prefs: CabPrefs };
    return views[this.tab] || CabToday;
  }

  /**
   * Перейти в раздел.
   * @param {string} tab
   */
  static show(tab) {
    this.tab = tab;
    this._legacy();
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
      <div class="cab-tools">${this._who()}<span class="cab-q"><button class="btn primary" type="button" data-cnew aria-expanded="false" aria-haspopup="menu">＋ Новое ▾</button><span class="cab-newm" role="menu" hidden>${this._newItems()}</span></span>
      <button class="icon cab-help" type="button" data-cguide aria-label="Как пользоваться кабинетом" title="Как пользоваться кабинетом">?</button><button class="icon" type="button" data-x aria-label="Закрыть кабинет" title="Закрыть (Esc)">✕</button></div></header>`;
  }

  static _shownTabs() {
    const shown = { team: () => CrmData.board.canAll, prefs: () => CabPrefs.enabled() };
    return this.TABS.filter(([key]) => !shown[key] || shown[key]());
  }

  static _tabs() {
    return this._shownTabs()
      .map(([key, label]) => {
        const active = this.tab === key;
        return `<button type="button" role="tab" aria-selected="${active}" class="cab-tab${active ? ' on' : ''}" data-ctab="${key}">${label}${this._badge(key)}</button>`;
      })
      .join('');
  }

  // что горит — видно без перехода: просроченные дела красным, новые заявки — отдельно от всех сделок
  static _badge(key) {
    const badges = {
      today: () => this._todayBadge(),
      deals: () => this._dealsBadge(),
    };
    return badges[key] ? badges[key]() : '';
  }

  static _todayBadge() {
    const tasks = CrmData.openTasks();
    const late = tasks.filter(task => task.due < today()).length;
    if (late) return ` <b class="md-c bad" title="Просрочено дел: ${late}">${late}</b>`;
    const due = tasks.filter(task => task.due === today()).length + CabToday.bxNew().length;
    return due ? ` <b class="md-c" title="На сегодня: ${due}">${due}</b>` : '';
  }

  static _dealsBadge() {
    const fresh = CabToday.bxNew().length;
    const open = CrmData.openDeals().length;
    const freshBadge = fresh ? ` <b class="md-c warn" title="Новые заявки: ${fresh}">${fresh} нов.</b>` : '';
    return `${open ? ` <b class="md-c" title="В работе: ${open}">${open}</b>` : ''}${freshBadge}`;
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
    return `<div class="cab-fab"><div class="cab-fabm" hidden>${this._newItems()}</div>
      <button class="cab-fabb" type="button" data-cfab aria-label="Создать: дело, сделку или КП" aria-expanded="false">＋</button></div>`;
  }

  // одно «Новое» на ПК и телефоне: заявка из письма — первой, ею заводится большинство сделок
  static _newItems() {
    return this.NEW.filter(([kind]) => kind !== 'mail' || FEAT.on('intake'))
      .map(
        ([kind, label, hint]) =>
          `<button class="btn${kind === 'mail' ? ' primary' : ''}" type="button" role="menuitem" data-cq="${kind}" title="${hint}">${label}</button>`,
      )
      .join('');
  }

  static _toggleNew() {
    const menu = this.dlg().querySelector('.cab-newm');
    menu.hidden = !menu.hidden;
    this.dlg().querySelector('[data-cnew]').setAttribute('aria-expanded', String(!menu.hidden));
  }

  static _hideMenus() {
    this.dlg()
      .querySelectorAll('.cab-newm, .cab-fabm')
      .forEach(menu => {
        menu.hidden = true;
      });
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
      mail: () => DealNew.open({ mail: true }),
      deal: () => DealNew.open(),
      newkp: () => this._leave(() => NewKp.open()),
      journal: () => this._leave(() => Journal.open()),
      catalog: () => this._leave(() => CatalogWindow.open({})),
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
    const wanted = Str.norm(text);
    if (!wanted) return true;
    const words = [deal.title, deal.client, deal.clientInn, `№${deal.number}`, deal.manager];
    return Str.norm([...words, ...(deal.kps || []).map(offer => offer.number)].join(' ')).includes(wanted);
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
      [
        '[data-cq]',
        el => {
          this._hideMenus();
          this._quick(el.dataset.cq);
        },
      ],
      ['[data-cnew]', () => this._toggleNew()],
      ['[data-cfab]', () => this._toggleFab()],
      ['[data-cguide]', () => CabGuide.open()],
      ['[data-ctip]', () => CabGuide.hideTip()],
      ['[data-kpi]', el => CabToday.kpi(el.dataset.kpi)],
      ['[data-dstep]', el => CrmTask.quick(el.dataset.dstep, () => this.reload())],
      ['[data-deal]', el => DealCard.open(el.dataset.deal, { list: this._dealIds(el) })],
      ['[data-cc]', el => ClientCard.open(JSON.parse(el.dataset.cc))],
      ['[data-ccard]', () => CompanyCardView.open(() => this.reload())],
      ['[data-cldeals]', el => this._clientDeals(el.dataset.cldeals)],
      ['[data-tmgr]', el => this._manager(el.dataset.tmgr)],
      ['[data-cabmonth]', el => MonthXlsx.save(el)],
      ['[data-gsc]', el => CabGantt.scale(el.dataset.gsc)],
    ];
  }

  static _click(event) {
    if (!event.target.closest('.cab-q, .cab-fab')) this._hideMenus();
    if (CabDeals.click(event) || CabToday.click(event) || CabPrefs.click(event)) return;
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

  // имя менеджера в «Отделе» — его сделки; «Показать весь отдел» — остаться в «Отделе»
  static _manager(id) {
    CrmData.who = id;
    if (id !== 'all') this.tab = 'deals';
    this.reload();
  }

  static _change(event) {
    const target = event.target;
    const changes = {
      cabWho: () => {
        CrmData.who = target.value;
        this.reload();
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
    CabLayout.bind(dialog, () => this.render());
    dialog.addEventListener('submit', event => {
      const form = event.target.closest('[data-kbform]');
      if (!form) return;
      event.preventDefault();
      CabDeals.quick(form);
    });
  }
}
