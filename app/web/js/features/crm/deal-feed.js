import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmTask } from './crm-task.js';
import { KpTrack } from '../kp/kp-track.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * Лента сделки, как в Битрикс24: сверху — «Дело / Комментарий», запланированные дела, ниже — всё, что было по сделке
 * (комментарии, сделанные дела, КП, смена стадий и полей), новые сверху.
 */
export class DealFeed {
  static MODES = [
    ['task', '＋ Звонок или дело'],
    ['comment', '💬 Комментарий'],
  ];
  static SHOWN = 40;
  // служебное (правки и автозаполнение полей) в ленту не идёт — только то, что важно по сделке
  static SERVICE = new Set(['kp', 'fields', 'edit']);
  static mode = '';
  static all = false;
  static ICONS = {
    create: '✦',
    stage: '➜',
    kp: '▤',
    kpOut: '▤',
    manager: '👤',
    funnel: '⇄',
    fields: '✎',
    edit: '✎',
    exec: '✓',
  };

  /**
   * Правая колонка карточки.
   * @param {object} deal
   * @param {Function} hist строка истории сделки
   * @returns {string}
   */
  static html(deal, hist) {
    const open = (deal.tasks || [])
      .filter(task => task.state === 'open')
      .sort((one, two) => `${one.due}${one.time || ''}`.localeCompare(`${two.due}${two.time || ''}`));
    const none = '<p class="muted dk-none">Пока ничего — нажмите «＋ Звонок или дело».</p>';
    const planned = open.length
      ? `<div class="tk-l dk-open">${open.map(task => CrmTask.row(task, { noDeal: true, date: true })).join('')}</div>`
      : none;
    return `<section class="md-s dk-feed"><div class="dk-fh" role="tablist" aria-label="Добавить в ленту">${this._modes()}</div>
      ${this._form(deal)}
      <p class="sub dk-ft">Запланировано${open.length ? ` <b class="md-c">${open.length}</b>` : ''}</p>${planned}
      <p class="sub dk-ft">Лента</p>${this._events(deal, hist)}</section>`;
  }

  // форма раскрыта только по нажатию: список дел и лента сразу на виду
  static _form(deal) {
    const forms = { task: () => CrmTask.form(deal.id), comment: () => this._comment() };
    return forms[this.mode] ? forms[this.mode]() : '';
  }

  static _modes() {
    return this.MODES.map(([key, label]) => {
      const picked = this.mode === key;
      return `<button type="button" role="tab" aria-selected="${picked}" class="${picked ? 'on' : ''}" data-feedmode="${key}">${label}</button>`;
    }).join('');
  }

  static _comment() {
    return `<div class="dk-cm"><textarea id="dkComment" rows="3" maxlength="2000" placeholder="Что важно по сделке: договорённости, кто принимает решение, что сказал клиент"></textarea>
      <div class="row"><button class="btn primary" type="button" data-dkcomm>Отправить</button><span class="muted">уходит и в ленту сделки Битрикс24</span></div></div>`;
  }

  // события ленты: [время, значок, текст, кто, класс]
  static _items(deal, hist) {
    const comments = (deal.comments || []).map(row => [
      row.at,
      '💬',
      `<span class="fd-text">${esc(row.text)}</span>`,
      row.by,
      'fd-c',
    ]);
    const tasks = (deal.tasks || [])
      .filter(task => task.state !== 'open')
      .map(task => [
        task.doneAt || `${task.due}T${task.time || '00:00'}`,
        CrmData.KINDS[task.kind] || '✓',
        `${esc(task.title)} — <span class="muted">${task.state === 'cancel' ? 'отменено' : 'сделано'}</span>`,
        task.by || '',
        'fd-t',
      ]);
    const offers = (deal.kps || []).map(offer => [
      offer.savedAt || offer.date,
      '▤',
      `<button type="button" class="lnk" data-dko="${esc(offer.id)}">КП № ${esc(offer.number)}</button> — ${CrmFmt.rub(offer.sum)} · ${esc(KpTrack.STATUS[offer.status] || offer.status)}`,
      '',
      'fd-k',
    ]);
    const history = (deal.history || [])
      .filter(item => !this.SERVICE.has(item.what))
      .map(item => [item.at, this.ICONS[item.what] || '•', esc(hist(item)), item.by || '', 'fd-h']);
    return [...comments, ...tasks, ...offers, ...history]
      .filter(([, , text]) => text)
      .sort((one, two) => String(two[0] || '').localeCompare(String(one[0] || '')));
  }

  static _events(deal, hist) {
    const items = this._items(deal, hist);
    if (!items.length) return '<p class="empty">Пока пусто.</p>';
    const shown = this.all ? items : items.slice(0, this.SHOWN);
    const rows = shown
      .map(
        ([when, icon, text, author, css]) =>
          `<div class="fd ${css}"><i class="fd-i" aria-hidden="true">${icon}</i><div><span class="fd-m">${esc(Fmt.dateTime(when))}${author ? ` · ${esc(author)}` : ''}</span>${text}</div></div>`,
      )
      .join('');
    const more =
      items.length > shown.length
        ? `<button type="button" class="btn sm ghost" data-feedall>Показать всё (${items.length})</button>`
        : '';
    return `<div class="fd-l">${rows}</div>${more}`;
  }

  /**
   * Щелчки ленты (вид добавления, «Показать всё»). true — нужно перерисовать.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const mode = event.target.closest('[data-feedmode]');
    if (mode) {
      this.mode = this.mode === mode.dataset.feedmode ? '' : mode.dataset.feedmode;
      return true;
    }
    if (!event.target.closest('[data-feedall]')) return false;
    this.all = true;
    return true;
  }
}
