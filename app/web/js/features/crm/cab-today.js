import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { CrmTask } from './crm-task.js';
import { Cabinet } from './cabinet.js';
import { CabDeals } from './cab-deals.js';
import { CabGuide } from './cab-guide.js';

/** «Сегодня»: показатели (нажимаются), дела по срокам с быстрым добавлением, «Требуют внимания», напоминания, черновики. */
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
   * Раздел.
   * @returns {string}
   */
  static html() {
    const who =
      !CrmData.board.me && !CrmData.all()
        ? '<p class="msg warn">Выберите себя в разделе «Менеджер» — тогда здесь будут ваши сделки и дела.</p>'
        : '';
    return `${who}${CabGuide.tip()}${this._kpi()}<div class="md-g cab-g">${this._tasks()}<div class="md-col">${this._attention()}${this._reminders()}${this._drafts()}</div></div>${this._more()}
      <label class="md-start"><input type="checkbox" id="mdStart"${MyDay.atStart() ? ' checked' : ''}> Открывать кабинет при запуске программы</label>`;
  }

  static _sum(deals) {
    return deals.reduce((total, deal) => total + (deal.sum || 0), 0);
  }

  static _kpi() {
    const now = today();
    const month = now.slice(0, 7);
    const tasks = CrmData.openTasks();
    const over = tasks.filter(task => task.due < now).length;
    const due = over + tasks.filter(task => task.due === now).length;
    const done = CrmData.tasks().filter(
      task => task.state === 'done' && String(task.doneAt || '').slice(0, 10) === now,
    ).length;
    const open = CrmData.openDeals();
    const expected = open.filter(deal => String(deal.expected || '').slice(0, 7) <= month);
    const late = open.filter(deal => deal.expected && deal.expected < now).length;
    const won = CrmData.deals().filter(
      deal => deal.stage === 'won' && String(deal.stageAt || '').slice(0, 7) === month,
    );
    const taskNote = over ? `<span class="bad-t">${over} просрочено</span>` : `сделано ${done}`;
    const lateNote = late ? ` · <span class="bad-t">срок прошёл у ${late}</span>` : '';
    return `<div class="cab-kpi">${this._tile({ key: 'tasks', label: 'Дела на сегодня', value: due, note: taskNote, tone: over ? 'bad' : '' })}
      ${this._tile({ key: 'deals', label: 'Сделки в работе', value: open.length, note: CrmFmt.short(this._sum(open)) })}
      ${this._tile({ key: 'month', label: 'Ожидаются в этом месяце', value: expected.length, note: CrmFmt.short(this._sum(expected)) + lateNote })}
      ${this._tile({ key: 'won', label: 'Выиграно в этом месяце', value: won.length, note: CrmFmt.short(this._sum(won)), tone: won.length ? 'ok' : '' })}</div>`;
  }

  static _tile({ key, label, value, note, tone = '' }) {
    return `<button type="button" class="cab-k${tone ? ` ${tone}` : ''}" data-kpi="${key}"><span>${label}</span><b>${value}</b><small>${note}</small></button>`;
  }

  /**
   * Нажатие на показатель: к делам или к сделкам с нужным отбором.
   * @param {string} key
   */
  static kpi(key) {
    if (key === 'tasks') {
      const field = Cabinet.dlg().querySelector('.cab-tasks input[name=title]');
      if (field) field.focus();
      return;
    }
    CabDeals.filter = key === 'month' ? 'month' : '';
    CabDeals.closed = key === 'won';
    Cabinet.query = '';
    Cabinet.show('deals');
  }

  static _groups() {
    const now = today();
    const tomorrow = KpDate.addDays(now, 1);
    const week = KpDate.addDays(now, CrmFmt.WEEK);
    const tasks = CrmData.openTasks().sort((one, two) =>
      `${one.due}${one.time || '99'}`.localeCompare(`${two.due}${two.time || '99'}`),
    );
    return [
      ['Просрочено', tasks.filter(task => task.due < now), { cls: 'bad-t', date: true }],
      ['Сегодня', tasks.filter(task => task.due === now), {}],
      ['Завтра', tasks.filter(task => task.due === tomorrow), {}],
      ['На неделе', tasks.filter(task => task.due > tomorrow && task.due <= week), { date: true }],
      ['Позже', tasks.filter(task => task.due > week), { date: true, later: true }],
    ];
  }

  static _group([title, list, opts]) {
    if (!list.length) return '';
    const rows = list.map(task => CrmTask.row(task, opts)).join('');
    const head = `${title} <b class="md-c">${list.length}</b>`;
    if (opts.later) return `<details class="tk-later"><summary class="tk-g">${head}</summary>${rows}</details>`;
    return `<p class="tk-g${opts.cls ? ` ${opts.cls}` : ''}">${head}</p>${rows}`;
  }

  static _tasks() {
    const groups = this._groups();
    const empty = groups.every(([, list]) => !list.length)
      ? '<p class="empty">Дел нет. Запланируйте звонок или встречу — строкой выше: вид дела, что сделать, когда.</p>'
      : '';
    const now = today();
    const done = CrmData.tasks().filter(
      task => task.state === 'done' && String(task.doneAt || '').slice(0, 10) === now,
    );
    const doneList = done.length
      ? `<details class="tk-done"><summary>Сделано сегодня (${done.length})</summary>${done.map(task => CrmTask.row(task)).join('')}</details>`
      : '';
    return `<section class="md-s cab-tasks"><div class="md-h"><p class="sub">Мои дела${tip('<p>Отметьте дело галочкой, когда сделали. «+1 день» — перенести на завтра, ✎ — изменить или отменить.</p><p>Дело по сделке добавляйте из карточки сделки — оно будет видно на доске как «следующий шаг».</p>')}</p></div>${CrmTask.form('', { pick: true })}
      <div class="tk-l">${groups.map(group => this._group(group)).join('')}${empty}${doneList}</div></section>`;
  }

  static _attention() {
    const now = today();
    const open = CrmData.openDeals();
    const parts = [
      [
        'Новые из Битрикс24',
        this.bxNew(),
        deal => (this._late(deal) ? 'ждёт больше суток' : 'откройте, чтобы принять'),
        'new',
      ],
      ['Без следующего дела', open.filter(deal => !deal.next), () => 'запланируйте звонок или встречу', 'free'],
      [
        'Срок прошёл',
        open.filter(deal => deal.expected && deal.expected < now),
        deal => `ожидалась ${CrmFmt.day(deal.expected)}`,
        'late',
      ],
    ];
    const count = new Set(parts.flatMap(([, list]) => list.map(deal => deal.id))).size;
    const body = parts.map(part => this._attn(...part)).join('');
    return MyDay.section(
      `Требуют внимания${count ? ` <b class="md-c">${count}</b>` : ''}${tip('<p>Сделки, которым нужно действие: новые из Битрикс24, без запланированного дела и с прошедшей ожидаемой датой.</p><p>«＋ Дело» — запланировать следующий шаг, не открывая сделку.</p>')}`,
      body || '<p class="empty">Всё в порядке: у каждой сделки есть следующий шаг.</p>',
    );
  }

  static _attn(title, list, why, filter) {
    if (!list.length) return '';
    const rows = list
      .slice(0, this.SHOW)
      .map(deal => this._attnRow(deal, why(deal), filter))
      .join('');
    const rest = list.length - this.SHOW;
    const more =
      rest > 0
        ? `<button class="lnk cab-all" type="button" data-cflt="${filter}">и ещё ${rest} — показать все</button>`
        : '';
    return `<p class="tk-g${filter === 'late' ? ' bad-t' : ''}">${title} <b class="md-c">${list.length}</b></p>${rows}${more}`;
  }

  static _attnRow(deal, why, filter) {
    const name = deal.title || deal.client;
    const client = deal.client && deal.client !== name ? `${esc(deal.client)} · ` : '';
    const step =
      filter === 'new'
        ? ''
        : `<button class="btn sm" type="button" data-dstep="${esc(deal.id)}" title="Запланировать дело по сделке">＋ Дело</button>`;
    return `<div class="md-r"><span class="cab-dot t-${CrmData.toneOf(deal)}" aria-hidden="true"></span><button type="button" class="cab-rl" data-deal="${esc(deal.id)}"><b>${esc(name)}</b><span class="muted">${client}${esc(CrmFunnel.label(deal))} · ${CrmFmt.short(deal.sum)} · ${esc(why)}</span></button>${step}</div>`;
  }

  static _reminders() {
    if (!FEAT.on('reminders') || !CrmData.mine()) return '';
    const items = Reminders.items;
    const limit = Math.round(DEFN('ui.mdRem', 5));
    const rows = items
      .slice(0, limit)
      .map(
        (item, index) =>
          `<div class="md-r${item.overdue ? ' over' : ''}"><span aria-hidden="true">${Reminders.icon(item.kind)}</span><div><b>${esc(item.text)}</b><span class="muted">КП № ${esc(item.number)} · ${esc(item.client)}${item.overdue ? ' · <span class="bad-t">просрочено</span>' : ''}</span></div><button class="btn sm" type="button" data-mdr="${index}">Открыть КП</button></div>`,
      )
      .join('');
    return MyDay.section(
      `Напоминания по КП${items.length ? ` <b class="md-c">${items.length}</b>` : ''}`,
      rows || '<p class="empty">Напоминаний нет.</p>',
      items.length > limit ? '<button class="lnk" type="button" data-mdall>Все</button>' : '',
    );
  }

  static _drafts() {
    if (!Drafts.on() || !CrmData.mine()) return '';
    const drafts = Cabinet.drafts || [];
    const limit = Math.round(DEFN('ui.mdDrafts', 4));
    const rows = drafts
      .slice(0, limit)
      .map(
        draft =>
          `<div class="md-r"><div><b>${esc(draft.client || 'Клиент не указан')}</b><span class="muted">${esc(Drafts.title(draft))} · ${draft.positions || 0} поз. · ${esc(Fmt.dateTime(draft.updated))}</span></div><button class="btn sm" type="button" data-dro="${esc(draft.id)}">Продолжить</button></div>`,
      )
      .join('');
    return MyDay.section(
      `Черновики КП${drafts.length ? ` <b class="md-c">${drafts.length}</b>` : ''}`,
      rows || '<p class="empty">Незаконченных КП нет.</p>',
      drafts.length > limit ? '<button class="lnk" type="button" data-mddr>Все</button>' : '',
    );
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
            KpLoader.byId(Reminders.items[+el.dataset.mdr].id).catch(error => toast(`Не открылось: ${error.message}`)),
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
