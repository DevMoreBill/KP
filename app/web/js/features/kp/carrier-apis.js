import { LgState } from '../deal/lg-state.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
/**
 * Перевозчики: включение и адреса API («Настройки → Внешние сервисы → Ключи API», под ключами доставки). Адрес пустой —
 * действует адрес программы; перевозчик сменил адрес — вписать новый и «Проверить». Сервер: /api/logistics/carriers.
 */
export class CarrierApis {
  /**
   * Карточка перевозчиков.
   * @returns {Promise<string>}
   */
  static async card() {
    let answer = { carriers: [] };
    try {
      answer = await Api.request('/api/logistics/carriers');
    } catch (error) {
      return `<div class="st-card"><p class="msg err">Перевозчики: ${esc(error.message || error)}</p></div>`;
    }
    return `<div class="st-card ca-card"><p class="sub">Перевозчики: включение и адреса API</p>
      <p class="muted">Выключенный перевозчик не участвует в расчёте доставки. Если перевозчик сменил адрес API (ошибка «адрес сервиса изменился», HTTP 404 или 307) — впишите новый адрес из его документации и нажмите «Проверить». Пустое поле — адрес программы, «↺» — вернуть его.</p>
      ${answer.carriers.map(carrier => this._row(carrier)).join('')}
      <div class="row"><span class="sp"></span><button class="btn primary" type="button" data-casave>Сохранить перевозчиков</button></div></div>`;
  }

  static _row(carrier) {
    const fields = carrier.fields
      .map(
        field => `<label class="f ca-f"><span>${esc(field.label)}</span><span class="ca-in"><input type="url" data-caf="${esc(field.id)}" value="${esc(field.value)}" placeholder="${esc(field.default)}" autocomplete="off" spellcheck="false">
          <button class="icon" type="button" data-careset title="Вернуть адрес программы: ${esc(field.default)}" aria-label="Вернуть адрес программы"${field.value ? '' : ' disabled'}>↺</button></span></label>`,
      )
      .join('');
    return `<div class="ca-row" data-ca="${esc(carrier.id)}">
        <div class="ca-h"><label class="sw df-sw" title="Включить / выключить"><input type="checkbox" data-caon${carrier.on ? ' checked' : ''}><span></span></label>
          <b>${esc(carrier.name)}</b>${carrier.docs ? `<a class="lnk" href="${esc(carrier.docs)}" target="_blank" rel="noopener noreferrer">документация API ↗</a>` : ''}
          <span class="sp"></span><button class="btn ghost sm" type="button" data-catest>Проверить</button></div>
        ${fields}
        <p class="muted ca-res" hidden></p></div>`;
  }

  static _body(host) {
    const out = {};
    host.querySelectorAll('[data-ca]').forEach(row => {
      const urls = {};
      row.querySelectorAll('[data-caf]').forEach(input => {
        urls[input.dataset.caf] = input.value.trim();
      });
      out[row.dataset.ca] = { on: row.querySelector('[data-caon]').checked, urls };
    });
    return out;
  }

  /**
   * Сохранить перевозчиков.
   * @param {HTMLElement} host вкладка ключей
   * @returns {Promise<boolean>}
   */
  static async save(host) {
    if (!(await this._put(host))) return false;
    Toast.show('Перевозчики сохранены');
    return true;
  }

  static async _put(host) {
    try {
      await Api.request('/api/logistics/carriers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(this._body(host)),
      });
      LgState.status = null;
      return true;
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Щелчок внутри вкладки ключей.
   * @param {Event} event
   * @param {HTMLElement} host
   * @returns {Promise<boolean>} обработано
   */
  static async click(event, host) {
    const reset = event.target.closest('[data-careset]');
    if (reset) {
      reset.parentElement.querySelector('[data-caf]').value = '';
      reset.disabled = true;
      return true;
    }
    if (event.target.closest('[data-casave]')) {
      await this.save(host);
      return true;
    }
    const test = event.target.closest('[data-catest]');
    if (!test) return false;
    await this._test(host, test);
    return true;
  }

  static async _test(host, button) {
    const row = button.closest('[data-ca]');
    const out = row.querySelector('.ca-res');
    if (!(await this._put(host))) return; // проверяется то, что вписано сейчас
    button.disabled = true;
    out.hidden = false;
    out.className = 'muted ca-res';
    out.textContent = 'Проверяю…';
    try {
      const answer = await Api.request('/api/logistics/carriers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ id: row.dataset.ca }),
      });
      out.className = `ca-res ${answer.ok ? 'ok-t' : 'warn-t'}`;
      out.textContent = `${answer.ok ? '✓ ' : '✕ '}${answer.msg}`;
    } catch (error) {
      out.className = 'ca-res warn-t';
      out.textContent = `✕ ${error.message || error}`;
    }
    button.disabled = false;
  }
}
