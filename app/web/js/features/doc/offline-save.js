import { FEAT } from '../../core/features.js';
import { ServerLink } from '../../core/server-link.js';
import { Toast } from '../../core/toast.js';
import { KpTabs } from '../kp/kp-tabs.js';

/**
 * Работа без связи: «Сохранить КП» при обрыве связи не теряется — КП остаётся в браузере (черновик), а сохранение повторяется
 * само, когда сервер снова отвечает (если открыто то же КП; иначе — напоминание).
 */
export class OfflineSave {
  static pending = '';

  /**
   * Сохранение не дошло до сервера: отложить. true — отложено (сообщение показано).
   * @param {() => Promise<void>} retry
   * @returns {boolean}
   */
  static hold(retry) {
    if (!FEAT.on('offlineSave') || !ServerLink.lost) return false;
    this.pending = KpTabs.current || 'kp';
    ServerLink.onBack(() => this._back(retry));
    Toast.show('Нет связи с сервером — КП в браузере, сохранится само, когда связь вернётся');
    return true;
  }

  static _back(retry) {
    if (!this.pending) return;
    const same = this.pending === (KpTabs.current || 'kp');
    this.pending = '';
    if (!same) {
      Toast.show('Связь вернулась — откройте отложенное КП и нажмите «Сохранить КП»');
      return;
    }
    Toast.show('Связь вернулась — сохраняю КП');
    retry();
  }
}
