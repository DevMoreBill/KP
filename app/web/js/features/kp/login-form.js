import { Auth } from './auth.js';

/**
 * Поля и отправка форм входа — у менеджера (экран входа) и у администратора («Настройки»): показать пароль, Caps Lock,
 * кнопка занята на время запроса, понятная ошибка, пауза после неверных паролей с обратным отсчётом (Retry-After),
 * на телефоне кнопка не прячется под экранную клавиатуру (visualViewport).
 */
export class LoginForm {
  static EYE =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="pw-x" d="M4 4l16 16"/></svg>';
  static SECOND = 1000;
  static WAIT_DEFAULT = 60;
  static KEYBOARD_MIN = 80;
  static BUTTON_GAP = 12;
  static FOCUS_DELAY = 350;
  static TOO_MANY = 429;

  /**
   * Поле пароля: кнопка «показать», предупреждение Caps Lock.
   * @param {string} id
   * @param {string} label
   * @param {string} autocomplete
   * @param {string} [attrs]
   * @returns {string}
   */
  static password(id, label, autocomplete, attrs = '') {
    return `<div class="f"><label for="${id}">${label}</label><span class="pw-box"><input type="password" id="${id}" autocomplete="${autocomplete}" autocapitalize="none" autocorrect="off" spellcheck="false" required ${attrs}><button type="button" class="pw-eye" data-eye="${id}" aria-label="Показать пароль" aria-pressed="false" title="Показать пароль">${this.EYE}</button></span><small class="pw-caps" hidden>Включён Caps Lock — пароль вводится заглавными</small></div>`;
  }

  /**
   * Поле логина.
   * @param {string} id
   * @param {string} label
   * @param {string} [value]
   * @param {string} [attrs]
   * @returns {string}
   */
  static login(id, label, value = '', attrs = '') {
    return `<label class="f"><span>${label}</span><input type="text" id="${id}" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(value)}" ${attrs}></label>`;
  }

  /**
   * Оживить форму входа.
   * @param {HTMLFormElement} form
   * @param {Function} send запрос (бросает Error; error.wait — сколько секунд вход закрыт)
   * @param {HTMLElement} err элемент для ошибки
   * @param {string} [busy] надпись кнопки на время запроса
   */
  static bind(form, send, err, busy = 'Вход…') {
    form.addEventListener('click', event => this._eye(form, event.target));
    const caps = event => this._caps(form, event);
    form.addEventListener('keydown', caps);
    form.addEventListener('keyup', caps);
    form.addEventListener('focusout', () =>
      setTimeout(
        () =>
          form.querySelectorAll('.pw-caps').forEach(note => {
            if (!note.closest('.f').contains(document.activeElement)) note.hidden = true;
          }),
        0,
      ),
    );
    const button = form.querySelector('button[type=submit]');
    const label = button.textContent;
    form.onsubmit = event => {
      event.preventDefault();
      this._submit({ form, send, err, busy, button, label });
    };
    this.keepVisible(form, button);
  }

  static _eye(form, target) {
    const button = target.closest('[data-eye]');
    if (!button) return;
    const input = form.querySelector(`#${button.dataset.eye}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.title = show ? 'Скрыть пароль' : 'Показать пароль';
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('on', show);
    input.focus({ preventScroll: true });
  }

  static _caps(form, event) {
    if (!event.getModifierState) return;
    const caps = event.getModifierState('CapsLock');
    form.querySelectorAll('.pw-caps').forEach(note => {
      note.hidden = !(caps && note.closest('.f').contains(document.activeElement));
    });
  }

  static async _submit({ form, send, err, busy, button, label }) {
    if (button.disabled) return;
    err.hidden = true;
    err.textContent = '';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busy;
    let wait = 0;
    try {
      await send();
    } catch (error) {
      wait = error.wait || 0;
      this.error(err, error.message || String(error));
      const field =
        form.querySelector('input[autocomplete=current-password]') || form.querySelector('input[type=password]');
      if (field && !wait) {
        field.focus();
        field.select();
      }
    } finally {
      button.removeAttribute('aria-busy');
      button.textContent = label;
      button.disabled = false;
    }
    if (wait) this._countdown({ button, err, seconds: wait, label });
  }

  /**
   * Показать ошибку.
   * @param {HTMLElement} err
   * @param {string} text
   */
  static error(err, text) {
    err.textContent = text;
    err.hidden = false;
  }

  /**
   * Новый пароль два раза: проверка до запроса (то же проверяет сервер).
   * @param {HTMLFormElement} form
   * @param {string} first id поля
   * @param {string} second id поля повтора
   * @returns {string[]} [новый, повтор]
   */
  static newPw(form, first, second) {
    const value = form.querySelector(`#${first}`).value;
    const again = form.querySelector(`#${second}`).value;
    const min = Auth.state.pwMin || Auth.PW_MIN;
    if (!value) throw new Error('Введите новый пароль');
    if (value.length < min) throw new Error(`Пароль — не короче ${min} символов`);
    if (value !== again) throw new Error(again ? 'Новый пароль и повтор не совпадают' : 'Повторите новый пароль');
    return [value, again];
  }

  // вход закрыт после неверных паролей: кнопка недоступна, в ошибке — сколько ждать
  static _countdown({ button, err, seconds, label }) {
    const end = Date.now() + seconds * this.SECOND;
    const base = err.textContent.replace(/(—|\.)\s*(вход с этого компьютера )?(снова через|закрыт на).*$/i, '').trim();
    button.disabled = true;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / this.SECOND));
      if (!left || !button.isConnected) {
        button.disabled = false;
        button.textContent = label;
        err.hidden = true;
        return;
      }
      button.textContent = `Вход через ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      err.textContent = `${base || 'Слишком много неверных попыток'}. Вход с этого компьютера временно закрыт — защита от подбора пароля.`;
      setTimeout(tick, this.SECOND);
    };
    tick();
  }

  /**
   * Запрос входа: ошибка — текстом сервера; 429 — с числом секунд паузы (error.wait).
   * @param {string} url
   * @param {object} body
   * @returns {Promise<object>}
   */
  static async post(url, body) {
    let answer;
    try {
      answer = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Нет связи с программой — проверьте, что компьютер-сервер включён, и повторите');
    }
    if (answer.ok) return answer.json();
    const error = new Error((await answer.text().catch(() => '')) || `Ошибка входа (${answer.status})`);
    if (answer.status === this.TOO_MANY) {
      error.wait = Math.max(1, parseInt(answer.headers.get('Retry-After'), 10) || this.WAIT_DEFAULT);
    }
    throw error;
  }

  /**
   * Телефон: экранная клавиатура уменьшает видимую область — прокрутить так, чтобы кнопка была над клавиатурой.
   * @param {HTMLFormElement} form
   * @param {HTMLElement} button
   */
  static keepVisible(form, button) {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const box = form.closest('.auth-wrap,.st-login');
    if (!box) return;
    const fit = () => {
      if (!form.isConnected) {
        viewport.removeEventListener('resize', fit);
        return;
      }
      const keyboard = Math.max(0, innerHeight - viewport.height - viewport.offsetTop);
      const typing = keyboard > this.KEYBOARD_MIN && form.contains(document.activeElement);
      box.style.paddingBottom = typing ? `${keyboard}px` : '';
      if (!typing) return;
      const over = button.getBoundingClientRect().bottom + this.BUTTON_GAP - (viewport.offsetTop + viewport.height);
      if (over > 0) box.scrollTop += over;
    };
    viewport.addEventListener('resize', fit);
    form.addEventListener('focusin', () => setTimeout(fit, this.FOCUS_DELAY));
  }
}
