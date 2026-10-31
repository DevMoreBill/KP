import { esc } from './util.js';
import { Modal } from './modal.js';

/** Окна подтверждения, выбора и формы — «Настройки» и разделы программы. */
export class AdminDialog {
  static DANGER = /Удал|Откат/;
  static WORD = 'УДАЛИТЬ';

  /**
   * Подтверждение.
   * @param {string} title
   * @param {string} text
   * @param {string} ok надпись кнопки
   * @returns {Promise<*>}
   */
  static confirm(title, text, ok) {
    return Modal.ask(
      `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary${this.DANGER.test(ok) ? ' danger-bg' : ''}" type="button" data-v="1">${esc(ok)}</button></div>`,
    );
  }

  /**
   * Подтверждение необратимого: кнопка доступна, только когда введено слово «УДАЛИТЬ».
   * @param {string} title
   * @param {string} text что случится
   * @param {string} ok надпись кнопки
   * @returns {Promise<boolean>}
   */
  static danger(title, text, ok) {
    return new Promise(resolve => {
      let done = false;
      const modal = new Modal(
        `<h3>${esc(title)}</h3><p>${esc(text)}</p><p class="bad-t">Отменить это будет нельзя.</p>
        <label class="f"><span>Чтобы продолжить, введите слово ${esc(this.WORD)}</span><input type="text" data-dzw autocomplete="off" spellcheck="false"></label>
        <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary danger-bg" type="button" data-v="1" disabled>${esc(ok)}</button></div>`,
        'dz-dlg',
      );
      const input = modal.$('[data-dzw]');
      const button = modal.$('[data-v="1"]');
      input.focus();
      input.oninput = () => {
        button.disabled = input.value.trim().toUpperCase() !== this.WORD;
      };
      modal.d.addEventListener('click', event => {
        const choice = event.target.closest('[data-v]');
        if (!choice || choice.disabled) return;
        done = choice.dataset.v === '1';
        modal.close();
      });
      modal.d.addEventListener('close', () => resolve(done));
    });
  }

  /**
   * Выбор одного из вариантов.
   * @param {string} title
   * @param {Array<[string, string]>} opts [значение, подпись]
   * @returns {Promise<*>}
   */
  static choose(title, opts) {
    const buttons = opts
      .map(([value, label]) => `<button class="btn" type="button" data-v="${value}">${esc(label)}</button>`)
      .join('');
    return Modal.ask(
      `<h3>${esc(title)}</h3><div class="st-choose">${buttons}<button class="btn ghost" type="button" data-v="0">Отмена</button></div>`,
    );
  }

  /**
   * Форма из нескольких полей.
   * @param {string} title
   * @param {Array<Array<string>>} fields [[ключ, подпись, значение, тип]]
   * @returns {Promise<object|null>} {ключ: значение} или null
   */
  static form(title, fields) {
    return new Promise(resolve => {
      let values = null;
      const inputs = fields.map(field => this._field(field)).join('');
      const modal = new Modal(
        `<form method="dialog"><h3>${esc(title)}</h3>${inputs}
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="submit">Сохранить</button></div></form>`,
        'st-form',
      );
      modal.$('[data-k]')?.focus();
      modal.$('[data-v="0"]').onclick = () => modal.close();
      modal.$('form').onsubmit = event => {
        event.preventDefault();
        values = {};
        modal.d.querySelectorAll('[data-k]').forEach(input => {
          values[input.dataset.k] = input.value.trim();
        });
        modal.close();
      };
      modal.d.addEventListener('close', () => resolve(values));
    });
  }

  static _field([key, label, value, type]) {
    const control =
      type === 'textarea'
        ? `<textarea data-k="${key}" rows="3">${esc(value ?? '')}</textarea>`
        : `<input type="${type || 'text'}" data-k="${key}" value="${esc(value ?? '')}" autocomplete="off">`;
    return `<label class="f"><span>${esc(label)}</span>${control}</label>`;
  }
}
