import { AppTabs } from '../core/app-tabs.js';
import { AppVersion } from '../features/help.js';
import { Api } from '../core/net.js';
import { Modal } from '../core/modal.js';
import { Toast } from '../core/toast.js';
import { esc } from '../core/util.js';

/**
 * «Сообщить о проблеме» (меню «⋯» и «Ещё»): менеджер пишет одну строку, программа сама добавляет, где это случилось —
 * раздел, открытое окно, версию, размер экрана, тему и последние ошибки страницы. Уходит администратору в «Настройки».
 */
export class ProblemReport {
  static errors = [];
  static ERRORS_KEPT = 10;

  /** Запоминать ошибки страницы (последние несколько) — чтобы приложить к сообщению. */
  static listen() {
    window.addEventListener('error', event => this._keep(event.message));
    window.addEventListener('unhandledrejection', event => this._keep(String(event.reason && event.reason.message)));
  }

  static _keep(text) {
    if (!text) return;
    this.errors = [...this.errors, `${new Date().toLocaleTimeString('ru-RU')} ${text}`].slice(-this.ERRORS_KEPT);
  }

  // где был менеджер: вкладка и верхнее открытое окно
  static _context() {
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const top = dialogs.pop();
    const title = top && top.querySelector('h2, h3');
    return {
      where: AppTabs.titles.get(AppTabs.active) || AppTabs.active,
      dialog: title ? title.textContent.trim().slice(0, 120) : '',
      version: AppVersion.current || '',
      screen: `${window.innerWidth}×${window.innerHeight}`,
      theme: document.documentElement.dataset.theme || 'как в системе',
      errors: this.errors,
    };
  }

  /** Окно сообщения. */
  static open() {
    const ctx = this._context();
    const where = [ctx.dialog || ctx.where, `версия ${ctx.version}`, `экран ${ctx.screen}`].filter(Boolean).join(' · ');
    const modal = new Modal(
      `<div class="dlg-h"><h3>Сообщить о проблеме</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <form class="tk-ed"><label class="f"><span>Что случилось или что неудобно</span><textarea name="text" rows="4" maxlength="2000" placeholder="Например: кнопка «Сохранить» не нажимается в окне сделки"></textarea></label>
        <p class="muted">Приложится само: ${esc(where)}${ctx.errors.length ? `, ошибок страницы — ${ctx.errors.length}` : ''}.</p>
        <div class="row"><button class="btn primary" type="submit">Отправить администратору</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div></form>`,
      'tk-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    modal.$('form').onsubmit = async event => {
      event.preventDefault();
      const text = event.target.elements.text.value.trim();
      if (!text) {
        Toast.show('Опишите в двух словах, что случилось');
        return;
      }
      try {
        await Api.request('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ text, ctx }),
        });
        modal.close();
        Toast.show('Отправлено администратору — спасибо!');
      } catch (error) {
        Toast.show(`Не отправлено: ${error.message}`);
      }
    };
  }
}
