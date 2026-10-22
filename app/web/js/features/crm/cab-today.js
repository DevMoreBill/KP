import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { CrmTask } from './crm-task.js';
import { Cabinet } from './cabinet.js';
import { CabDeals } from './cab-deals.js';
import { CabGuide } from './cab-guide.js';
import { CabTodaySide } from './cab-today-side.js';
import { Toast } from '../../core/toast.js';
import { S } from '../../core/state.js';
import { Fmt } from '../../core/str.js';
import { Drafts } from '../kp/drafts.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpLoader, Reminders } from '../kp/reminders.js';
import { FEAT } from '../../core/features.js';
import { UiKit } from '../../ui/ui-kit.js';
import { KpDate } from '../kp/kp-date.js';
import { esc, today } from '../../core/util.js';
import { MyDay } from '../kp/my-day.js';

/** «Сегодня»: плитки дня, «Что сделать» (дела и сделки, которым нужно действие), напоминания по КП; справа — неделя, месяц, воронка. */
export class CabToday {
  static SHOW = 6;
  static DAY_MS = 864e5;

  /**
   * Новые сделки из Битрикс24, которые ответственный ещё не открывал.
   * @returns {object[]}
   */
  static bxNew() {
    const own = CrmData.board && CrmData.board.me;
    return CrmData.openDeals().filter(deal => deal.bxNew && (!own || deal.managerId === own || CrmData.all()));
  }

  static _late(deal) {
    const created = Date.parse(deal.created || '');
    return Number.isFinite(created) && Date.now() - created > this.DAY_MS;
  }

  /**
   * Раздел: плитки дня, слева — «Что сделать» и напоминания по КП, справа — неделя, месяц, воронка, черновики.
   * @returns {string}
   */
  static html() {
    const who =
      !CrmData.board.me && !CrmData.all()
        ? '<p class="msg warn">Выберите себя в разделе «Менеджер» — тогда здесь будут ваши сделки и дела.</p>'
        : '';
    return `${who}${CabGuide.tip()}${this._tiles()}<div class="td-g"><div class="td-l">${this._todo()}${this._reminders()}</div>
      <aside class="td-r">${CabTodaySide.html()}${this._drafts()}${this._more()}</aside></div>
      <label class="md-start"><input type="checkbox" id="mdStart"${MyDay.atStart() ? ' checked' : ''}> Открывать кабинет при запуске программы</label>`;
  }

  static _sum(deals) {
    return deals.reduce((total, deal) => total + (deal.sum || 0), 0);
  }

  // плитки дня: дела, сделки в работе, без шага, новые заявки — нажатием к своему списку
  static _tiles() {
    const now = today();
    const tasks = CrmData.openTasks();
    const over = tasks.filter(task => task.due < now).length;
    const due = over + tasks.filter(task => task.due === now).length;
    const done = CrmData.tasks().filter(
      task => task.state === 'done' && String(task.doneAt || '').slice(0, 10) === now,
    ).length;
    const open = CrmData.openDeals();
    const free = open.filter(deal => !deal.next).length;
    const fresh = this.bxNew();
    const waiting = fresh.filter(deal => this._late(deal)).length;
    const tiles = [
      {
        key: 'tasks',
        label: 'Дела на сегодня',
        value: due,
        note: over ? `<span class="bad-t">просрочено ${over}</span> · сделано ${done}` : `сделано ${done}`,
        tone: over ? 'bad' : '',
      },
      { key: 'deals', label: 'Сделки в работе', value: open.length, note: CrmFmt.short(this._sum(open)) },
      {
        key: 'free',
        label: 'Без следующего шага',
        value: free,
        note: free ? 'запланируйте звонок' : 'у всех есть шаг',
        tone: free ? 'warn' : 'ok',
      },
      {
        key: 'new',
        label: 'Новые заявки',
        value: fresh.length,
        note: waiting ? `<span class="bad-t">ждут больше суток ${waiting}</span>` : 'из Битрикс24',
        tone: fresh.length ? 'warn' : '',
      },
    ];
    return `<div class="cab-kpi">${tiles.map(tile => this._tile(tile)).join('')}</div>`;
  }

  static _tile({ key, label, value, note, tone = '' }) {
    return `<button type="button" class="cab-k${tone ? ` ${tone}` : ''}" data-kpi="${key}"><span>${label}</span><b>${value}</b><small>${note}</small></button>`;
  }

  /**
   * Нажатие на плитку или цифру: дела — строка нового дела, сделки — «Сделки» с нужным отбором.
   * @param {string} key
   */
  static kpi(key) {
    if (key === 'tasks') {
      const add = Cabinet.dlg().querySelector('.td-add');
      if (add) add.open = true;
      add?.querySelector('input[name=title]')?.focus();
      return;
    }
    CabDeals.filter = { month: 'month', free: 'free', new: 'new' }[key] || '';
    CabDeals.closed = key === 'won' || key === 'lost';
    Cabinet.query = '';
    Cabinet.show('deals');
  }

  static _tasks() {
    return CrmData.openTasks().sort((one, two) =>
      `${one.due}${one.time || '99'}`.localeCompare(`${two.due}${two.time || '99'}`),
    );
  }

  // что требует действия сейчас — по порядку срочности
  static _now() {
    const now = today();
    const tasks = this._tasks();
    const open = CrmData.openDeals();
    return [
      ['Просрочено', tasks.filter(task => task.due < now), 'task', { cls: 'bad-t', date: true }],
      ['На сегодня', tasks.filter(task => task.due === now), 'task', {}],
      ['Новые из Битрикс24 — откройте и возьмите в работу', this.bxNew(), 'new', {}],
      [
        'Исполнение: срок точки прошёл',
        open.filter(deal => deal.execSum && deal.execSum.overdue),
        'exec',
        { cls: 'bad-t' },
      ],
      ['Сделки без следующего шага — запланируйте звонок или встречу', open.filter(deal => !deal.next), 'free', {}],
      [
        'Ожидаемая дата сделки прошла — обновите дату или закройте',
        open.filter(deal => deal.expected && deal.expected < now),
        'late',
        {},
      ],
    ];
  }

  static _todo() {
    const groups = this._now();
    const count = groups.reduce((total, [, list]) => total + list.length, 0);
    const rows = groups.map(group => this._group(...group)).join('');
    const empty = count
      ? ''
      : '<p class="empty td-ok">✓ Всё сделано: дел на сегодня нет, у каждой сделки есть следующий шаг.</p>';
    return `<section class="md-s td"><div class="md-h"><p class="sub">Что сделать${count ? ` <b class="md-c">${count}</b>` : ''}${UiKit.tip('<p>Сверху — самое срочное: просроченные дела, дела на сегодня, затем сделки, которым нужно действие. У каждой строки — одна кнопка.</p><p>Дело сделано — отметьте галочкой. «+1 день» — перенести на завтра, ✎ — изменить.</p>')}</p></div>
      ${this._add()}<div class="tk-l">${rows}${empty}</div>${this._later()}${this._done()}</section>`;
  }

  static _add() {
    return `<details class="td-add"><summary><span aria-hidden="true">＋</span> Новое дело — звонок, встреча, письмо или задача</summary>${CrmTask.form('', { pick: true })}</details>`;
  }

  static _group(title, list, kind, opts) {
    if (!list.length) return '';
    const rows =
      kind === 'task'
        ? list.map(task => CrmTask.row(task, opts)).join('')
        : list
            .slice(0, this.SHOW)
            .map(deal => this._dealRow(deal, kind))
            .join('');
    const rest = kind === 'task' ? 0 : list.length - this.SHOW;
    const more =
      rest > 0
        ? `<button class="lnk cab-all" type="button" data-cflt="${kind}">и ещё ${rest} — показать все</button>`
        : '';
    return `<p class="tk-g${opts.cls ? ` ${opts.cls}` : ''}">${title} <b class="md-c">${list.length}</b></p>${rows}${more}`;
  }

  static _why(deal, kind) {
    const reasons = {
      new: () => (this._late(deal) ? 'ждёт больше суток' : 'новая'),
      exec: () =>
        deal.execSum.next ? `${deal.execSum.next.label} — план ${CrmFmt.day(deal.execSum.next.plan)}` : 'просрочено',
      free: () => 'нет запланированного дела',
      late: () => `ожидалась ${CrmFmt.day(deal.expected)}`,
    };
    return reasons[kind] ? reasons[kind]() : '';
  }

  static _dealRow(deal, kind) {
    const name = deal.title || deal.client;
    const client = deal.client && deal.client !== name ? `${esc(deal.client)} · ` : '';
    const action =
      kind === 'free'
        ? `<button class="btn sm primary" type="button" data-dstep="${esc(deal.id)}" title="Запланировать дело по сделке">＋ Дело</button>`
        : `<button class="btn sm" type="button" data-deal="${esc(deal.id)}">Открыть</button>`;
    return `<div class="md-r"><span class="cab-dot t-${CrmData.toneOf(deal)}" aria-hidden="true"></span><button type="button" class="cab-rl" data-deal="${esc(deal.id)}"><b>${esc(name)}</b><span class="muted">${client}${esc(CrmFunnel.label(deal))} · ${CrmFmt.short(deal.sum)} · ${esc(this._why(deal, kind))}</span></button>${action}</div>`;
  }

  // дела на будущие дни — свёрнуто
  static _later() {
    const now = today();
    const tomorrow = KpDate.addDays(now, 1);
    const later = this._tasks().filter(task => task.due > now);
    if (!later.length) return '';
    const soon = later.filter(task => task.due === tomorrow).length;
    const rows = later.map(task => CrmTask.row(task, { date: true })).join('');
    return `<details class="tk-later"><summary class="tk-g">Запланировано дальше <b class="md-c">${later.length}</b>${soon ? ` <span class="muted">· завтра ${soon}</span>` : ''}</summary>${rows}</details>`;
  }

  static _done() {
    const now = today();
    const done = CrmData.tasks().filter(
      task => task.state === 'done' && String(task.doneAt || '').slice(0, 10) === now,
    );
    if (!done.length) return '';
    return `<details class="tk-done"><summary>Сделано сегодня (${done.length})</summary>${done.map(task => CrmTask.row(task)).join('')}</details>`;
  }

  static _reminders() {
    if (!FEAT.on('reminders') || !CrmData.mine()) return '';
    const items = Reminders.items;
    const limit = Math.round(DefRegistry.num('ui.mdRem', 5));
    const rows = items
      .slice(0, limit)
      .map(
        (item, index) =>
          `<div class="md-r${item.overdue ? ' over' : ''}"><span aria-hidden="true">${Reminders.icon(item.kind)}</span><div><b>${esc(item.text)}</b><span class="muted">КП № ${esc(item.number)} · ${esc(item.client)}${item.overdue ? ' · <span class="bad-t">просрочено</span>' : ''}</span></div><button class="btn sm" type="button" data-mdr="${index}">Открыть КП</button></div>`,
      )
      .join('');
    if (!items.length) return '';
    const all = items.length > limit ? '<button class="lnk" type="button" data-mdall>Все</button>' : '';
    return MyDay.section(`КП: напоминания <b class="md-c">${items.length}</b>`, rows, all);
  }

  static _drafts() {
    if (!Drafts.enabled() || !CrmData.mine()) return '';
    const drafts = Cabinet.drafts || [];
    const limit = Math.round(DefRegistry.num('ui.mdDrafts', 4));
    const rows = drafts
      .slice(0, limit)
      .map(
        draft =>
          `<div class="md-r"><div><b>${esc(draft.client || 'Клиент не указан')}</b><span class="muted">${esc(Drafts.title(draft))} · ${draft.positions || 0} поз. · ${esc(Fmt.dateTime(draft.updated))}</span></div><button class="btn sm" type="button" data-dro="${esc(draft.id)}">Продолжить</button></div>`,
      )
      .join('');
    if (!drafts.length) return '';
    const all = drafts.length > limit ? '<button class="lnk" type="button" data-mddr>Все</button>' : '';
    return MyDay.section(`Черновики КП <b class="md-c">${drafts.length}</b>`, rows, all);
  }

  static _more() {
    const back = Drafts.meaningful(S)
      ? `<button class="btn ghost" type="button" data-cq="back" title="Вернуться к открытому КП">Продолжить ${S.kpId ? `КП № ${esc(S.number)}` : 'текущее КП'}</button>`
      : '';
    return `<div class="md-q cab-more"><button class="btn" type="button" data-cq="journal">Журнал КП</button><button class="btn" type="button" data-cq="catalog">Каталог</button>${back}</div>`;
  }

  /**
   * Щелчки раздела (напоминания, черновики, «показать все»). true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const target = event.target;
    const actions = [
      [
        '[data-mdr]',
        el =>
          this._leave(() =>
            KpLoader.byId(Reminders.items[+el.dataset.mdr].id).catch(error =>
              Toast.show(`Не открылось: ${error.message}`),
            ),
          ),
      ],
      ['[data-mdall]', () => this._leave(() => Reminders.open())],
      ['[data-mddr]', () => this._leave(() => Drafts.dialog())],
      ['[data-dro]', el => this._leave(() => Drafts.open(el.dataset.dro))],
    ];
    for (const [selector, run] of actions) {
      const el = target.closest(selector);
      if (el) {
        run(el);
        return true;
      }
    }
    return false;
  }

  static _leave(next) {
    Cabinet.dlg().close();
    next();
  }
}
