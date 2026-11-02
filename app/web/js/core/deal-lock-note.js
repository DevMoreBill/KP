import { esc } from './util.js';
import { KpDate } from './kp-date.js';

/**
 * Правило «одна сделка на клиента» (сервер — deal_guard.DealGuard): почему КП встаёт в незакрытую сделку клиента, а не
 * заводит новую. Общее для сохранения КП (документ) и выбора сделки в разделе «Клиент» (кабинет).
 */
export class DealLockNote {
  /**
   * Почему новой сделки нет: срок после последнего КП (сделка без КП — после её создания) или запрет администратора.
   * @param {{last: string, until: string, reason: string, basis?: string}} lock
   * @returns {string} текст без разметки
   */
  static why(lock) {
    if (lock.reason === 'client')
      return 'администратор запретил новые сделки по этому клиенту, пока эта сделка открыта';
    const since = lock.basis === 'created' ? 'она заведена' : 'последнее КП в ней —';
    return `${since} ${KpDate.ddmm(lock.last)}, новая сделка по клиенту — не раньше ${KpDate.ddmm(lock.until)}`;
  }

  /**
   * Название сделки для строки: «№ 12 «Компрессор»».
   * @param {{number: *, title: string}} lock
   * @returns {string} разметка
   */
  static deal(lock) {
    return `№ ${esc(lock.number)}${lock.title ? ` «${esc(lock.title)}»` : ''}`;
  }

  /**
   * Строка после «Сохранить КП» (сообщение и окно «КП сохранено»); КП завело свою сделку — пусто.
   * @param {object|null} lock ответ сервера dealLock
   * @returns {string}
   */
  static saved(lock) {
    if (!lock) return '';
    return `<div class="msg warn dl-note">КП добавлено в сделку ${this.deal(lock)}: у клиента уже есть незакрытая сделка — ${esc(this.why(lock))}. <button class="btn sm ghost" type="button" data-a="dealOpen" data-id="${esc(lock.deal)}">Открыть сделку</button></div>`;
  }
}
