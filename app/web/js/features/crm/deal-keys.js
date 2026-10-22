import { Modal } from '../../core/modal.js';
import { esc } from '../../core/util.js';

/** Горячие клавиши карточки сделки: буква — латинская или русская (Д — дело, С — комментарий, К — КП, П — печать). */
export class DealKeys {
  // [буквы, действие, подпись в справке]
  static KEYS = [
    [['d', 'д'], 'task', 'Д — звонок или дело'],
    [['c', 'с'], 'comment', 'С — комментарий'],
    [['k', 'к'], 'kp', 'К — новое КП по сделке'],
    [['p', 'п'], 'print', 'П — печать карточки'],
    [['?'], 'help', '? — эта справка'],
  ];
  static FIXED = ['← → — соседняя сделка списка', 'Esc — закрыть карточку'];

  /**
   * Действие по нажатой клавише (или пусто).
   * @param {KeyboardEvent} event
   * @returns {string}
   */
  static action(event) {
    const letter = String(event.key || '').toLowerCase();
    const hit = this.KEYS.find(([letters]) => letters.includes(letter));
    return hit ? hit[1] : '';
  }

  /** Окно со списком клавиш. */
  static help() {
    const rows = [...this.KEYS.map(row => row[2]), ...this.FIXED].map(text => `<li>${esc(text)}</li>`).join('');
    const modal = new Modal(
      `<div class="dlg-h"><h3>Горячие клавиши карточки сделки</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <ul class="dkk-l">${rows}</ul><p class="muted">Работают, когда курсор не в поле ввода.</p>`,
      'dkk-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
  }
}
