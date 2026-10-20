import { Drafts } from './drafts.js';
import { KpDate } from './kp-date.js';
import { KpTrack } from './kp-track.js';

/** Напоминания: колокольчик в шапке (перезвонить, срок действия КП, отправлено без ответа). */
export class Reminders {
  static items = [];
  static ICONS = { follow: '⏰', expire: '⌛' };
  static MINUTE = 60000;
  static BUTTONS = ['ro', 'rs', 'rd', 'rl'];

  /** Загрузить напоминания и обновить колокольчик. */
  static async load() {
    if (!FEAT.on('reminders')) {
      this.items = [];
      this.badge();
      return;
    }
    try {
      this.items = (await api('/api/reminders')).items || [];
    } catch {
      this.items = [];
    }
    this.badge();
  }

  /** Колокольчик: число и «пора». */
  static badge() {
    const button = $('#btnRem');
    if (!button) return;
    const count = this.items.length;
    const due = this.items.some(item => item.overdue || item.date <= today());
    button.hidden = !count;
    button.classList.toggle('due', due);
    $('#remN').textContent = count || '';
    button.title = count ? `Напоминания: ${count}` : 'Напоминаний нет';
  }

  static _snooze() {
    return Math.round(DEFN('kp.remSnooze', 1));
  }

  /** Колокольчик сам проверяет напоминания раз в N минут («Значения программы»), пока вкладка открыта. */
  static poll() {
    setTimeout(
      () => {
        if (!document.hidden) this.load();
        this.poll();
      },
      DEFN('kp.remRefresh', 10) * this.MINUTE,
    );
  }

  /**
   * Значок напоминания по виду.
   * @param {string} kind follow, expire, stale
   * @returns {string}
   */
  static icon(kind) {
    return this.ICONS[kind] || '✉';
  }

  static _days(count) {
    return `${count} ${plural(count, 'день', 'дня', 'дней')}`;
  }

  static _row(item, index, snooze) {
    const when = item.kind === 'stale' ? `с ${esc(KpDate.ddmm(item.date))}` : esc(KpDate.ddmm(item.date));
    const follow =
      item.kind === 'follow'
        ? `<button class="btn sm ghost" type="button" data-rd="${index}">Выполнено</button><button class="btn sm ghost" type="button" data-rl="${index}" title="Перенести на ${snooze === 1 ? 'завтра' : this._days(snooze)}">+${this._days(snooze)}</button>`
        : '';
    return `<div class="rem-r${item.overdue ? ' over' : ''}"><span class="rem-i" aria-hidden="true">${this.icon(item.kind)}</span>
        <div><b>${esc(item.text)}</b><span class="muted">КП № ${esc(item.number)} · ${esc(item.client)} · ${when}${item.overdue ? ' · <span class="bad-t">просрочено</span>' : ''}</span></div>
        <div class="acts"><button class="btn sm" type="button" data-ro="${index}">Открыть КП</button><button class="btn sm" type="button" data-rs="${index}">Статус…</button>
        ${follow}</div></div>`;
  }

  /** Окно напоминаний. */
  static open() {
    const list = this.items;
    const snooze = this._snooze();
    const body = list.length
      ? `<div class="rem-l">${list.map((item, index) => this._row(item, index, snooze)).join('')}</div>`
      : '<p class="empty">Напоминаний нет. Поставить напоминание — в журнале КП, кнопка статуса у КП.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Напоминания</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${body}`,
      'rem-dlg',
    );
    modal.d.onclick = event => this._click(modal, list, event.target);
  }

  static async _click(modal, list, target) {
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = target.closest('[data-ro],[data-rs],[data-rd],[data-rl]');
    if (!button) return;
    const kind = this.BUTTONS.find(key => button.dataset[key] != null);
    const item = list[+button.dataset[kind]];
    try {
      await this._act(modal, kind, item);
    } catch (error) {
      toast(`Не получилось: ${error.message}`);
    }
  }

  static async _act(modal, kind, item) {
    if (kind === 'ro') {
      await KpLoader.byId(item.id);
      modal.close();
      return;
    }
    if (kind === 'rs') {
      const found = (await api(`/api/history?limit=1&q=${encodeURIComponent(item.number)}`)).items?.find(
        row => row.id === item.id,
      );
      modal.close();
      KpTrack.open(found || { id: item.id, number: item.number, client: item.client });
      return;
    }
    if (kind === 'rd') await KpTrack.put(item.id, { followUp: { done: true } });
    if (kind === 'rl') {
      await KpTrack.put(item.id, { followUp: { date: KpDate.addDays(today(), this._snooze()), note: item.text } });
    }
    await this.load();
    modal.close();
    this.open();
  }

  /** Колокольчик в шапке открывает окно. */
  static listen() {
    document.addEventListener('click', event => {
      if (event.target.closest('#btnRem')) this.open();
    });
  }
}

/** Открыть сохранённое КП по номеру (напоминания, отчёт, кабинет, карточка клиента); текущее — в черновики. */
export class KpLoader {
  /**
   * Открыть КП.
   * @param {string} id
   */
  static async byId(id) {
    if (!(await Drafts.stash())) return;
    const state = await api(`/api/kp/${encodeURIComponent(id)}/state`);
    S = Object.assign(freshState(), state);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    renderForm();
    persist();
    window.scrollTo({ top: 0 });
    toast(`КП № ${S.number || id} открыто`);
  }
}
