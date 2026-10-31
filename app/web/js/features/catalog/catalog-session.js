import { CatalogLink } from '../../core/catalog-link.js';
import { AdminSession } from '../../core/net.js';

/** Правка позиции каталога в карточке позиции (открыта из каталога, а не из КП): что правится и куда уйдёт сохранение. */
export class CatalogSession {
  /** правка: {items, base, onSave, snap, isNew} — прежние позиции КП, карточка до правки; null — карточка позиции КП */
  static current = null;

  /**
   * Правка уйдёт на модерацию: модерация включена, а правит не администратор.
   * @returns {boolean}
   */
  static moderated() {
    return CatalogLink.moderated() && !AdminSession.on;
  }

  /**
   * Подпись кнопки сохранения.
   * @returns {string}
   */
  static saveLabel() {
    return this.moderated() ? 'Отправить на модерацию' : 'Сохранить в каталог';
  }
}
