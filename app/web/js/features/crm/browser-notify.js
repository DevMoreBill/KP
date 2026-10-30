import { CrmData } from './crm-data.js';
import { FEAT } from '../../core/features.js';
import { today } from '../../core/util.js';

/**
 * Уведомления браузера (функция «Уведомления в браузере»): за AHEAD_MIN минут до дела со временем и о новых заявках из
 * Битрикс24. Работают, пока страница программы открыта (вкладка может быть свёрнута). Разрешение даёт сам менеджер
 * кнопкой на «Сегодня»; каждое дело — одно уведомление за сеанс.
 */
export class BrowserNotify {
  static AHEAD_MIN = 15;
  static TICK_MS = 60000;
  static RELOAD_TICKS = 5;
  static MINUTE_MS = 60000;
  static shown = new Set();
  static seenNew = null;
  static ticks = 0;
  static timer = 0;
  static open = null;

  /**
   * Функция включена и браузер умеет уведомлять.
   * @returns {boolean}
   */
  static available() {
    return FEAT.on('notify') && typeof window.Notification !== 'undefined';
  }

  /**
   * Строка «Включить уведомления» на «Сегодня» (пока разрешение не спрашивали).
   * @returns {string}
   */
  static offer() {
    if (!this.available() || window.Notification.permission !== 'default') return '';
    return `<p class="td-ntf">🔔 Уведомления о делах (за ${this.AHEAD_MIN} минут) и новых заявках — даже когда вкладка свёрнута. <button type="button" class="btn sm" data-ntfon>Включить</button></p>`;
  }

  /**
   * Спросить разрешение (по нажатию — иначе браузер не покажет вопрос).
   * @returns {Promise<void>}
   */
  static async ask() {
    if (!this.available()) return;
    await window.Notification.requestPermission();
    this.start();
  }

  /**
   * Начать проверку раз в минуту.
   * @param {Function} [open] открыть сделку по нажатию на уведомление
   */
  static start(open) {
    if (open) this.open = open;
    if (this.timer || !this.available() || window.Notification.permission !== 'granted') return;
    this.timer = setInterval(() => this._tick(), this.TICK_MS);
    this._tick();
  }

  static async _tick() {
    this.ticks += 1;
    // только своя доска: открыт кабинет коллеги или весь отдел — без уведомлений о чужих делах и без перезагрузки
    if (CrmData.board && !CrmData.mine()) return;
    if (this.ticks % this.RELOAD_TICKS === 0 || !CrmData.board) {
      try {
        await CrmData.load();
      } catch {
        return;
      }
    }
    if (!CrmData.mine()) return;
    this._tasks();
    this._fresh();
  }

  static _tasks() {
    const now = Date.now();
    for (const task of CrmData.openTasks()) {
      if (!task.time || task.due !== today() || this.shown.has(task.id)) continue;
      const left = (Date.parse(`${task.due}T${task.time}:00`) - now) / this.MINUTE_MS;
      if (left < 0 || left > this.AHEAD_MIN) continue;
      this.shown.add(task.id);
      this._say(`${task.time} — ${task.title}`, 'Через несколько минут дело', task.deal);
    }
  }

  static _fresh() {
    const fresh = CrmData.openDeals().filter(deal => deal.bxNew);
    const ids = new Set(fresh.map(deal => deal.id));
    if (this.seenNew) {
      const added = fresh.filter(deal => !this.seenNew.has(deal.id));
      if (added.length === 1)
        this._say('Новая заявка из Битрикс24', added[0].title || added[0].client || '', added[0].id);
      else if (added.length > 1) this._say('Новые заявки из Битрикс24', `Пришло: ${added.length}`, '');
    }
    this.seenNew = ids;
  }

  static _say(title, body, deal) {
    const note = new window.Notification(title, { body, tag: `kp-${title}-${deal}` });
    note.onclick = () => {
      window.focus();
      if (deal && this.open) this.open(deal);
      note.close();
    };
  }
}
