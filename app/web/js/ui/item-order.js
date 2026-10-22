import { S, KpState } from '../core/state.js';
import { Toast } from '../core/toast.js';
import { FormView } from './form-view.js';

/** Порядок позиций КП перетаскиванием за «⋮⋮» (ПК); на телефоне — кнопками ↑ ↓ в строке позиции. */
export class ItemOrder {
  static from = -1;

  /** Обработчики перетаскивания. */
  static listen() {
    document.addEventListener('dragstart', event => {
      const handle = event.target.closest && event.target.closest('[data-drag]');
      if (!handle) return;
      this.from = +handle.dataset.drag;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(this.from));
    });
    document.addEventListener('dragover', event => {
      if (this.from < 0 || !event.target.closest || !event.target.closest('.item[data-pos]')) return;
      event.preventDefault();
    });
    document.addEventListener('drop', event => {
      const target = this.from >= 0 && event.target.closest && event.target.closest('.item[data-pos]');
      if (!target) return;
      event.preventDefault();
      this.move(this.from, +target.dataset.pos);
    });
    document.addEventListener('dragend', () => {
      this.from = -1;
    });
  }

  /**
   * Переставить позицию.
   * @param {number} from
   * @param {number} place
   */
  static move(from, place) {
    this.from = -1;
    if (from === place || !S.items[from] || !S.items[place]) return;
    const [item] = S.items.splice(from, 1);
    S.items.splice(place, 0, item);
    FormView.render();
    KpState.persist();
    Toast.show(`Позиция ${from + 1} → ${place + 1}`);
  }
}
