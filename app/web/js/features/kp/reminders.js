import { KpTrack } from './kp-track.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { DefRegistry } from '../../core/defaults.js';
import { $, esc, today } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { KpTabs } from './kp-tabs.js';
import { Drafts } from './drafts.js';
import { KpForm } from '../../core/kp-form.js';
import { KpDate } from '../../core/kp-date.js';

/** Напоминания: колокольчик в шапке (перезвонить, срок действия КП, отправлено без ответа). */
export class Reminders {
  static JOURNAL_ROWS = 50; // строк поиска по номеру КП: номер бывает частью других (2026-100 в 2026-1000…), нужная — по id
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
      this.items = (await Api.request('/api/reminders')).items || [];
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
    return Math.round(DefRegistry.num('kp.remSnooze', 1));
  }

  /** Колокольчик сам проверяет напоминания раз в N минут («Значения программы»), пока вкладка открыта. */
  static poll() {
    setTimeout(
      () => {
        if (!document.hidden) this.load();
        this.poll();
      },
      DefRegistry.num('kp.remRefresh', 10) * this.MINUTE,
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
    return `${count} ${KPGen.plural(count, 'день', 'дня', 'дней')}`;
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
      Toast.show(`Не получилось: ${error.message}`);
    }
  }

  static async _act(modal, kind, item) {
    if (kind === 'ro') {
      await KpLoader.byId(item.id);
      modal.close();
      return;
    }
    if (kind === 'rs') {
      const found = (
        await Api.request(`/api/history?limit=${this.JOURNAL_ROWS}&q=${encodeURIComponent(item.number)}`)
      ).items?.find(row => row.id === item.id);
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

  /** Колокольчик в шапке открывает окно; права изменились (kp:features) — напоминания заново. */
  static listen() {
    document.addEventListener('click', event => {
      if (event.target.closest('#btnRem')) this.open();
    });
    document.addEventListener('kp:features', () => this.load());
  }
}

/** Открыть сохранённое КП по номеру (напоминания, отчёт, кабинет, карточка клиента); текущее — в черновики. */
export class KpLoader {
  /**
   * Открыть КП.
   * @param {string} id
   */
  static async byId(id) {
    const state = await Api.request(`/api/kp/${encodeURIComponent(id)}/state`);
    if (!(await KpTabs.prepare({ kpId: id }))) return;
    KpState.replace(Object.assign(KpState.fresh(), state));
    KpTabs.show();
    KpForm.render();
    KpState.persist();
    window.scrollTo({ top: 0 });
    Drafts.loaded();
    Toast.show(`КП № ${S.number || id} открыто`);
  }
}
