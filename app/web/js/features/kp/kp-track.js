import { KpDate } from './kp-date.js';
import { Api } from '../../core/net.js';
import { DefRegistry } from '../../core/defaults.js';
import { Reminders } from './reminders.js';
import { Toast } from '../../core/toast.js';
import { Fmt } from '../../core/str.js';
import { Modal } from '../../core/modal.js';
import { esc, today } from '../../core/util.js';
import { FEAT } from '../../core/features.js';

/**
 * Ход сделки по КП (сервер: app/kp_track.py): статус (подготовлено → отправлено → в работе → выиграно / проиграно),
 * напоминание «перезвонить», история. Хранится отдельно от КП — пересохранение не стирает.
 */
export class KpTrack {
  static STATUS = { new: 'Подготовлено', sent: 'Отправлено', work: 'В работе', won: 'Выиграно', lost: 'Проиграно' };
  // причины проигрыша — список «Причины проигрыша КП» в «Настройках → Списки и выборы»
  static LOST = [
    'Цена выше, чем у конкурентов',
    'Сроки поставки',
    'Выбрали другого поставщика',
    'Закупка отменена или перенесена',
    'Не прошли по техническим требованиям',
    'Нет ответа от клиента',
    'Другое',
  ];
  static QUICK = [1, 3, 7];
  static QUICK_MAX = 5;
  static DAYS_MAX = 365;
  static WEEK = 7;
  static HISTORY = 8;

  /**
   * Статус хода сделки ('new' — не задан).
   * @param {object} track
   * @returns {string}
   */
  static status(track) {
    return (track && track.status) || 'new';
  }

  static _followUp(track) {
    return track.followUp && !track.followUp.done ? track.followUp : null;
  }

  /**
   * Кнопка статуса в строке КП (журнал, карточка клиента) с напоминанием и отметкой «отправлено».
   * @param {object} row строка журнала
   * @returns {string}
   */
  static chip(row) {
    if (!FEAT.on('track')) return '';
    const track = row.track || {};
    const status = this.status(track);
    const followUp = this._followUp(track);
    const lost = status === 'lost' && track.reason ? ` · ${esc(track.reason)}` : '';
    const sent = track.sent && track.sent.length ? this._sentChip(track.sent) : '';
    const remind = followUp
      ? `<span class="jfu${followUp.date <= today() ? ' due' : ''}" title="${esc(followUp.note || 'Напоминание')}">⏰ ${esc(KpDate.ddmm(followUp.date))}</span>`
      : '';
    return `<button type="button" class="jst st-${esc(status)}" data-jst="${esc(row.id)}" title="Ход сделки: статус, напоминание">${esc(this.STATUS[status])}${lost}</button>${remind}${sent}`;
  }

  static _sentChip(sent) {
    const all = sent.map(item => `${KpDate.ddmm(item.at)} → ${(item.to || []).join(', ')}`).join('; ');
    return `<span class="jsent" title="Отправлено: ${esc(all)}">✉ ${esc(KpDate.ddmm(sent[sent.length - 1].at))}</span>`;
  }

  /**
   * Запись истории о напоминании: объект {date, note}, прежний формат — текстом; null — напоминание снято.
   * @param {object|string|null} followUp
   * @returns {string}
   */
  static followText(followUp) {
    if (followUp === null) return ' напоминание снято';
    if (!followUp) return '';
    if (typeof followUp !== 'object') return ` напоминание: ${esc(followUp)}`;
    return ` напоминание на ${esc(KpDate.ddmm(followUp.date))}${followUp.note ? `: ${esc(followUp.note)}` : ''}`;
  }

  /**
   * Окно статуса КП.
   * @param {object} row строка журнала {id, number, client, track}
   * @param {Function} [onSave] (track) — после сохранения
   */
  static open(row, onSave) {
    const track = row.track || {};
    const ctx = { row, onSave, status: this.status(track), followUp: this._followUp(track) };
    const history = this._history(track);
    ctx.modal = new Modal(
      `<div class="dlg-h"><h3>Ход сделки · КП № ${esc(row.number)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">${esc(row.client || '')}</p>
      <div class="kt-seg" role="radiogroup" aria-label="Статус КП">${this._segments(ctx.status)}</div>
      <label class="f kt-reason"${ctx.status === 'lost' ? '' : ' hidden'}><span>Причина проигрыша</span><select id="ktR">${this._reasons(track)}</select></label>
      <label class="f"><span>Заметка</span><input type="text" id="ktN" value="${esc(track.note || '')}" maxlength="500" placeholder="Например: ждём согласования бюджета до 20-го"></label>
      ${this._remindBox(ctx.followUp)}
      ${history ? `<details class="kt-hist"><summary>История</summary><ul>${history}</ul></details>` : ''}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-ksave>Сохранить</button></div>`,
      'kt-dlg',
    );
    ctx.modal.d.onclick = event => this._click(ctx, event.target);
  }

  static _segments(status) {
    return Object.entries(this.STATUS)
      .map(
        ([key, label]) =>
          `<button type="button" class="st-${key}${key === status ? ' on' : ''}" data-ks="${key}" role="radio" aria-checked="${key === status}">${label}</button>`,
      )
      .join('');
  }

  static _reasons(track) {
    const own = track.reason && !this.LOST.includes(track.reason) ? [track.reason] : [];
    return [...new Set([...this.LOST, ...own])]
      .map(reason => `<option${reason === track.reason ? ' selected' : ''}>${esc(reason)}</option>`)
      .join('');
  }

  static _history(track) {
    return (track.history || [])
      .slice()
      .reverse()
      .slice(0, this.HISTORY)
      .map(
        entry =>
          `<li><span class="muted">${esc(Fmt.dateTime(entry.at))} · ${esc(entry.by || '')}</span> ${entry.status ? esc(this.STATUS[entry.status] || entry.status) : ''}${entry.reason ? ` — ${esc(entry.reason)}` : ''}${entry.note ? ` — ${esc(entry.note)}` : ''}${this.followText(entry.followUp)}</li>`,
      )
      .join('');
  }

  static _quickLabel(days) {
    if (days === 1) return 'Завтра';
    if (days === this.WEEK) return 'Через неделю';
    return `Через ${days} ${KPGen.plural(days, 'день', 'дня', 'дней')}`;
  }

  static _remindBox(followUp) {
    const quick = this.quick()
      .map(days => `<button type="button" class="btn sm" data-kd="${days}">${this._quickLabel(days)}</button>`)
      .join('');
    return `<fieldset class="kt-fu"><legend>Напоминание</legend>
        <div class="row" style="gap:8px;flex-wrap:wrap"><input type="date" id="ktD" value="${esc(followUp ? followUp.date : '')}" aria-label="Дата напоминания">
          ${quick}
          ${followUp ? '<button type="button" class="btn sm ghost" data-kdone>Выполнено</button>' : ''}</div>
        <input type="text" id="ktFN" value="${esc(followUp ? followUp.note : '')}" maxlength="300" placeholder="Что сделать: позвонить главному инженеру, уточнить решение…" aria-label="Что сделать"></fieldset>`;
  }

  static _click(ctx, target) {
    const modal = ctx.modal;
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const segment = target.closest('[data-ks]');
    if (segment) {
      this._pick(ctx, segment);
      return;
    }
    const quick = target.closest('[data-kd]');
    if (quick) {
      modal.$('#ktD').value = KpDate.addDays(today(), +quick.dataset.kd);
      return;
    }
    if (target.closest('[data-kdone]')) {
      this._done(ctx);
      return;
    }
    if (target.closest('[data-ksave]')) this._save(ctx);
  }

  static _pick(ctx, segment) {
    ctx.status = segment.dataset.ks;
    ctx.modal.d.querySelectorAll('[data-ks]').forEach(button => {
      button.classList.toggle('on', button === segment);
      button.setAttribute('aria-checked', button === segment);
    });
    ctx.modal.$('.kt-reason').hidden = ctx.status !== 'lost';
  }

  static async _done({ row, onSave, modal }) {
    try {
      const answer = await this.put(row.id, { followUp: { done: true } });
      if (onSave) onSave(answer.track);
      Toast.show('Напоминание выполнено');
      modal.close();
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message}`);
    }
  }

  static async _save({ row, onSave, modal, status, followUp }) {
    const body = { status, reason: status === 'lost' ? modal.$('#ktR').value : '', note: modal.$('#ktN').value.trim() };
    const date = modal.$('#ktD').value;
    const note = modal.$('#ktFN').value.trim();
    if (date) body.followUp = { date, note };
    else if (followUp) body.followUp = null;
    try {
      const answer = await this.put(row.id, body);
      if (onSave) onSave(answer.track);
      Toast.show(`КП № ${row.number}: ${this.STATUS[status].toLowerCase()}`);
      modal.close();
      Reminders.load();
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message}`);
    }
  }

  /**
   * Дни кнопок быстрого напоминания из «Значений программы» («1, 3, 7»); неверная запись — как в программе.
   * @returns {number[]}
   */
  static quick() {
    const days = String(DefRegistry.value('kp.remQuick') || '')
      .split(/[,;\s]+/)
      .map(value => Math.round(+value))
      .filter(value => value >= 1 && value <= this.DAYS_MAX);
    return days.length ? [...new Set(days)].slice(0, this.QUICK_MAX) : this.QUICK;
  }

  /**
   * Записать ход сделки.
   * @param {string} id КП
   * @param {object} body
   * @returns {Promise<object>} {track}
   */
  static put(id, body) {
    return Api.request(`/api/kp/${encodeURIComponent(id)}/track`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
  }
}
