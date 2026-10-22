import { Modal } from '../../core/modal.js';
import { esc } from '../../core/util.js';
/** Подсказки кабинета: «?» в шапке — коротко, как пользоваться; совет при первом открытии (скрывается «Понятно»). */
export class CabGuide {
  static KEY = 'kp.cab.tip';
  static STEPS = [
    ['☀ Сегодня', 'Дела на сегодня и просроченные, сделки, которым нужно действие. Начинайте день отсюда.'],
    [
      '＋ Дело',
      'Звонок, встреча, письмо или задача: вид — кнопкой, когда — «Сегодня», «Завтра», «Пн» или датой. Галочка — сделано.',
    ],
    [
      '🤝 Сделки',
      'Доска по стадиям или список. Перетащите карточку в другую стадию; на телефоне стадия меняется в карточке сделки.',
    ],
    ['Карточка сделки', 'Открывается панелью справа: всё сохраняется само, «‹ ›» — соседняя сделка, Esc — закрыть.'],
    [
      'Следующий шаг',
      'У каждой сделки в работе должно быть запланированное дело — сделки без него собраны в «Требуют внимания».',
    ],
    [
      '📄 КП',
      'КП, сохранённое для клиента, само попадает в его сделку; сумма сделки — по последнему КП, если не задана своя.',
    ],
    ['📅 График', 'Сроки сделок, поставка по расчёту сделки и дела на ленте времени.'],
    [
      'Битрикс24',
      'Если связь включена, сделки, стадии, поля и дела обмениваются с Битрикс24 сами — работать можно и там, и здесь.',
    ],
  ];

  /** Окно «Как пользоваться кабинетом». */
  static open() {
    const rows = this.STEPS.map(
      ([title, text]) => `<div class="cg-r"><b>${esc(title)}</b><span>${esc(text)}</span></div>`,
    ).join('');
    const modal = new Modal(
      `<div class="dlg-h"><h3>Как пользоваться кабинетом</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="cg">${rows}</div><p class="muted cg-k">Клавиши: Esc — закрыть окно, ‹ › в карточке сделки — соседняя сделка.</p>
      <div class="row"><span class="sp"></span><button class="btn primary" type="button" data-x>Понятно</button></div>`,
      'cg-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
  }

  /**
   * Совет при первом открытии (пока не нажали «Понятно»).
   * @returns {string}
   */
  static tip() {
    if (this._hidden()) return '';
    this._remember(); // совет — только при первом входе
    return `<div class="cab-tip" role="note"><span aria-hidden="true">💡</span><p><b>Совет.</b> Начинайте день с «Сегодня»: здесь одним списком всё, что нужно сделать, — у каждой строки своя кнопка. Все сделки — во вкладке «Сделки», подсказки — «?».</p><button class="btn sm" type="button" data-ctip>Понятно</button></div>`;
  }

  /** Скрыть совет навсегда (в этом браузере). */
  static hideTip() {
    this._remember();
    document.querySelector('.cab-tip')?.remove();
  }

  static _remember() {
    try {
      localStorage.setItem(this.KEY, '1');
    } catch {
      // без хранилища совет просто покажется снова
    }
  }

  static _hidden() {
    try {
      return localStorage.getItem(this.KEY) === '1';
    } catch {
      return false;
    }
  }
}
