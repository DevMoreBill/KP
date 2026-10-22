import { CrmData } from './crm-data.js';
import { CrmFmt, DateChips } from './crm-fmt.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { KpDate } from '../kp/kp-date.js';
import { ShortName } from '../kp/journal-row.js';
import { esc, today } from '../../core/util.js';

/** Дела: строка списка, быстрое добавление (вид, что сделать, дата чипом, время), правка; дела не удаляются — отменяются. */
export class CrmTask {
  static VERBS = { call: 'Позвонить', meet: 'Встреча', mail: 'Написать', task: 'Задача' };
  static FOCUS_MS = 50;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Строка дела.
   * @param {object} task
   * @param {{noDeal?: boolean, date?: boolean}} [opts] без ссылки на сделку; с датой
   * @returns {string}
   */
  static row(task, opts = {}) {
    const over = task.state === 'open' && task.due < today();
    const done = task.state !== 'open';
    const sub = this._sub(task, opts);
    const cancelled = task.state === 'cancel' ? ' <span class="muted">(отменено)</span>' : '';
    const later = done
      ? ''
      : `<button class="btn sm ghost" type="button" data-tlater="${task.id}" title="Перенести на завтра">+1 день</button>`;
    return `<div class="tk${over ? ' over' : ''}${done ? ' done' : ''}" data-task="${task.id}"><label class="tk-ck"><input type="checkbox" data-tdone="${task.id}"${done ? ' checked' : ''}${task.state === 'cancel' ? ' disabled' : ''} aria-label="Сделано: ${esc(task.title)}"></label>
      ${CrmData.icon(task.kind)}<div><b>${esc(this._title(task, opts))}${cancelled}</b>${this._who(task, opts)}${sub ? `<span class="muted">${sub}</span>` : ''}${task.note ? `<span class="muted tk-note">${esc(task.note)}</span>` : ''}</div>
      ${later}<button class="icon sm" type="button" data-tedit="${task.id}" aria-label="Изменить дело" title="Изменить">✎</button></div>`;
  }

  // общее название («Звонок», «Письмо») — действием и кому: «Позвонить: Петров П. П.»
  static _title(task, opts) {
    const kind = CrmData.KIND_LIST.find(row => row.key === task.kind);
    const deal = !opts.noDeal && task.deal ? CrmData.deal(task.deal) : null;
    if (!kind || task.title !== kind.label || !deal) return task.title;
    const who = deal.who || {};
    const whom = who.name || who.company || deal.client;
    return whom ? `${this.VERBS[task.kind]}: ${whom}` : task.title;
  }

  // кому звонить или писать: компания, контакт и должность, телефон и почта — нажатием
  static _who(task, opts) {
    const deal = !opts.noDeal && task.deal ? CrmData.deal(task.deal) : null;
    if (!deal) return '';
    const who = deal.who || {};
    const company = who.company || deal.client || '';
    const reach = [this._person(who), ...this._links(who)].filter(Boolean);
    const parts = [company && `<b>${esc(company)}</b>`, ...reach].filter(Boolean);
    if (!parts.length) return '';
    const none = company && !reach.length ? ' <span class="muted">— контакт не указан</span>' : '';
    return `<span class="tk-who">${parts.join(' · ')}${none}</span>`;
  }

  static _person(who) {
    return esc([who.name, who.post && `(${who.post})`].filter(Boolean).join(' '));
  }

  static _links(who) {
    const phone = who.phone
      ? `<a href="tel:${esc(who.phone.replace(/[^\d+]/g, ''))}" title="Позвонить">☎ ${esc(who.phone)}</a>`
      : '';
    const mail = who.email ? `<a href="mailto:${esc(who.email)}" title="Написать письмо">✉ ${esc(who.email)}</a>` : '';
    return [phone, mail];
  }

  static _sub(task, opts) {
    const deal = task.deal ? CrmData.deal(task.deal) : null;
    const link =
      opts.noDeal || !task.deal
        ? ''
        : `<button type="button" class="lnk" data-deal="${esc(task.deal)}">${esc(deal ? deal.title || deal.client : 'Сделка')}</button>`;
    const who =
      CrmData.all() && !opts.noDeal
        ? esc(ShortName.of(CrmData.managers().find(mgr => mgr.id === task.managerId)?.name || ''))
        : '';
    const when = opts.date ? esc(CrmFmt.rel(task.due)) : '';
    return [when, task.time, link, who].filter(Boolean).join(' · ');
  }

  /**
   * Форма быстрого добавления.
   * @param {string} [deal] дело по этой сделке
   * @param {{pick?: boolean, title?: string}} [opts] pick — выбор сделки; title — подпись над формой
   * @returns {string}
   */
  static form(deal = '', opts = {}) {
    return `<form class="tq" data-tq="${esc(deal)}" autocomplete="off">${opts.title ? `<p class="sub tq-t">${esc(opts.title)}</p>` : ''}
      ${this.kinds()}
      <input type="text" name="title" maxlength="200" placeholder="Что сделать? Например: позвонить главному инженеру" aria-label="Что сделать" enterkeyhint="done">
      <div class="tq-r">${DateChips.html(DateChips.TASK, 'due', today())}<input type="date" name="due" value="${today()}" aria-label="Дата"><input type="time" name="time" aria-label="Время (необязательно)" title="Время — необязательно">
      ${opts.pick ? this._dealSelect() : ''}<button class="btn primary" type="submit">Добавить</button></div></form>`;
  }

  static _dealSelect() {
    const deals = CrmData.openDeals();
    if (!deals.length) return '';
    const options = deals
      .map(
        deal =>
          `<option value="${esc(deal.id)}">${esc((deal.title || '') + (deal.client && deal.client !== deal.title ? ` — ${deal.client}` : ''))}</option>`,
      )
      .join('');
    return `<select name="deal" aria-label="Сделка"><option value="">Без сделки</option>${options}</select>`;
  }

  /**
   * Обработчики форм и строк дел внутри box; after(task) — после изменения.
   * @param {HTMLElement} box
   * @param {Function} after
   */
  static bind(box, after) {
    box.addEventListener('click', event => this._click(event, after));
    box.addEventListener('change', event => {
      const check = event.target.closest('[data-tdone]');
      if (check) this.put(+check.dataset.tdone, { state: check.checked ? 'done' : 'open' }, after);
    });
    box.addEventListener('submit', event => {
      const form = event.target.closest('form.tq');
      if (!form) return;
      event.preventDefault();
      this._add(form, after);
    });
  }

  static _click(event, after) {
    if (DateChips.click(event)) return;
    const kind = event.target.closest('[data-tqk]');
    if (kind) {
      this.pickKind(kind);
      return;
    }
    const later = event.target.closest('[data-tlater]');
    if (later) {
      const task = CrmData.tasks().find(row => row.id === +later.dataset.tlater) || {};
      const base = task.due && task.due > today() ? task.due : today();
      this.put(+later.dataset.tlater, { due: KpDate.addDays(base, 1) }, after);
      return;
    }
    const edit = event.target.closest('[data-tedit]');
    if (edit) this.edit(+edit.dataset.tedit, after);
  }

  /**
   * Выбор вида дела кнопками (data-tqk).
   * @param {string} [picked] выбранный вид (по умолчанию — первый)
   * @returns {string}
   */
  static kinds(picked) {
    const list = CrmData.kinds();
    const current = list.some(kind => kind.key === picked) ? picked : list[0].key;
    const buttons = list
      .map(kind => {
        const active = kind.key === current;
        return `<button type="button" role="radio" aria-checked="${active}" class="${active ? 'on' : ''}" data-tqk="${kind.key}" title="${esc(kind.label)}">${CrmData.KINDS[kind.key] || ''} <span>${esc(kind.label)}</span></button>`;
      })
      .join('');
    return `<div class="seg tq-k" role="radiogroup" aria-label="Вид дела">${buttons}</div>`;
  }

  /**
   * Отметить выбранный вид дела.
   * @param {HTMLElement} button
   */
  static pickKind(button) {
    button.parentElement.querySelectorAll('button').forEach(one => {
      const active = one === button;
      one.classList.toggle('on', active);
      one.setAttribute('aria-checked', active);
    });
  }

  static async _add(form, after) {
    const fields = form.elements;
    if (!fields.due.value) {
      Toast.show('Укажите дату дела');
      return;
    }
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    const body = {
      kind: form.querySelector('[data-tqk].on')?.dataset.tqk || 'task',
      title: fields.title.value.trim(),
      due: fields.due.value,
      time: fields.time.value,
      deal: form.dataset.tq || (fields.deal ? fields.deal.value : ''),
    };
    const owner = this._owner(body.deal);
    if (owner) body.managerId = owner;
    try {
      const task = await Api.request('/api/crm/task', {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify(body),
      });
      fields.title.value = '';
      fields.time.value = '';
      Toast.show(`Дело добавлено: ${task.title}, ${CrmFmt.rel(task.due)}`);
      if (after) after(task);
    } catch (error) {
      Toast.show(`Дело не добавлено: ${error.message}`);
    } finally {
      delete form.dataset.busy;
    }
  }

  static _owner(deal) {
    if (CrmData.all() && !deal && CrmData.board) return CrmData.board.me;
    return CrmData.who && CrmData.who !== 'all' ? CrmData.who : '';
  }

  /**
   * Окно быстрого добавления дела (по сделке или с выбором сделки).
   * @param {string} deal
   * @param {Function} [after] после добавления
   * @param {{pick?: boolean}} [opts]
   */
  static quick(deal, after, opts = {}) {
    const found = deal ? CrmData.deal(deal) : null;
    const title = found ? `Следующий шаг: ${found.title || found.client}` : 'Новое дело';
    const modal = new Modal(
      `<div class="dlg-h"><h3>${esc(title)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>${this.form(deal, { pick: opts.pick })}`,
      'tk-dlg tq-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    this.bind(modal.d, task => {
      if (!task) return;
      modal.close();
      if (after) after(task);
    });
    setTimeout(() => modal.d.querySelector('input[name=title]')?.focus(), this.FOCUS_MS);
  }

  /**
   * Изменить дело на сервере.
   * @param {number} id
   * @param {object} body
   * @param {Function} [after]
   * @returns {Promise<object|null>}
   */
  static async put(id, body, after) {
    try {
      const task = await Api.request(`/api/crm/task/${id}`, {
        method: 'PUT',
        headers: this.JSON_HEAD,
        body: JSON.stringify(body),
      });
      if (body.state === 'done') Toast.show(`Сделано: ${task.title}`);
      if (after) after(task);
      return task;
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message}`);
      if (after) after(null);
      return null;
    }
  }

  /**
   * Окно правки дела: вид, что сделать, дата, время, заметка; «Отменить дело».
   * @param {number} id
   * @param {Function} [after]
   * @param {object[]} [source] где искать дело (по умолчанию — дела кабинета)
   */
  static edit(id, after, source) {
    const task = (source || CrmData.tasks()).find(row => row.id === id);
    if (!task) return;
    const modal = new Modal(this._editHtml(task), 'tk-dlg');
    modal.d.addEventListener('click', event => this._editClick(event, modal, task, after));
    modal.d.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const fields = event.target.elements;
      if (!fields.due.value) {
        Toast.show('Укажите дату дела');
        return;
      }
      modal.close();
      this.put(
        id,
        {
          kind: event.target.querySelector('[data-tqk].on')?.dataset.tqk || task.kind,
          title: fields.title.value.trim(),
          due: fields.due.value,
          time: fields.time.value,
          note: fields.note.value,
        },
        after,
      );
    };
  }

  static _editHtml(task) {
    const state =
      task.state === 'open'
        ? '<button class="btn ghost" type="button" data-tcancel>Отменить дело</button>'
        : '<button class="btn ghost" type="button" data-treopen>Вернуть в работу</button>';
    return `<div class="dlg-h"><h3>Дело</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <form class="tk-ed">${this.kinds(task.kind)}
        <label class="f"><span>Что сделать</span><input type="text" name="title" maxlength="200" value="${esc(task.title)}"></label>
        <div class="row tk-dt"><label class="f"><span>Дата</span><input type="date" name="due" value="${esc(task.due)}"></label><label class="f"><span>Время</span><input type="time" name="time" value="${esc(task.time || '')}"></label></div>
        ${DateChips.html(DateChips.TASK, 'due', task.due)}
        <label class="f"><span>Заметка</span><textarea name="note" rows="3" maxlength="1000" placeholder="Что обсудить, номер телефона, итог разговора">${esc(task.note || '')}</textarea></label>
        <div class="row"><button class="btn primary" type="submit">Сохранить</button>${state}<span class="sp"></span><button class="btn" type="button" data-x>Закрыть</button></div></form>`;
  }

  static async _editClick(event, modal, task, after) {
    if (DateChips.click(event)) return;
    const target = event.target;
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const kind = target.closest('[data-tqk]');
    if (kind) {
      this.pickKind(kind);
      return;
    }
    if (target.closest('[data-tcancel]')) {
      if (!confirm(`Отменить дело «${task.title}»? Оно останется в истории.`)) return;
      modal.close();
      this.put(task.id, { state: 'cancel' }, after);
      return;
    }
    if (target.closest('[data-treopen]')) {
      modal.close();
      this.put(task.id, { state: 'open' }, after);
    }
  }
}
