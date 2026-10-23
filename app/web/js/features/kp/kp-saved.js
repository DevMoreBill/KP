import { Currency } from './currency.js';
import { DocsGen } from '../doc/docs-gen.js';
import { KpFilesPanel } from './kp-files.js';
import { KpTrack } from './kp-track.js';
import { NewKp } from './new-kp.js';
import { Presets } from './presets.js';
import { Reminders } from './reminders.js';
import { Toast } from '../../core/toast.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { Api, Srv } from '../../core/net.js';

/** Окно «КП сохранено»: следующие шаги в одном месте — файл, письмо клиенту, ход сделки, заготовка, новое КП. */
export class KpSaved {
  /**
   * Строка журнала сохранённого КП (для окна статуса).
   * @returns {Promise<object|null>}
   */
  static async row() {
    try {
      const rows = (await Api.request(`/api/history?limit=5&offset=0&q=${encodeURIComponent(S.number)}`)).items || [];
      return rows.find(row => row.id === S.kpId) || null;
    } catch {
      return null;
    }
  }

  static _btn(attrs, label, kind = '', title = '') {
    return `<button class="btn${kind ? ` ${kind}` : ''}" type="button" ${attrs}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
  }

  /**
   * Открыть окно.
   * @param {{pdfOk: boolean, pdfErr: string, isNew: boolean}} result
   */
  static open(result) {
    const totals = KpState.totals();
    const modal = new Modal(
      `<div class="dlg-h"><h3><span class="ks-ok" aria-hidden="true">✓</span> КП № ${esc(S.number)} ${result.isNew ? 'сохранено' : '— изменения сохранены'}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 4px">${esc(S.client || '')} · ${KPGen.money(totals.sum)} ${esc(Currency.short(Currency.current()))} · ${S.items.length} поз.${result.pdfOk ? ' · DOCX и PDF' : ''}</p>
      ${result.pdfErr ? `<div class="msg err">PDF не создан: ${esc(result.pdfErr)} ${this._btn('data-a="printPdf"', 'Печать → «Сохранить как PDF»', 'sm')}</div>` : ''}
      <div class="ks-g">
        ${this._file(result)}
        ${this._client()}
        <section><p class="sub">Дальше</p><div class="ks-b">${this._btn('data-ks="new"', '＋ Новое КП')}${Presets.enabled() ? this._btn('data-ks="preset"', 'Сохранить как заготовку', '', 'Позиции, цены и условия — для следующих КП') : ''}${this._btn('data-x', 'Продолжить правку', 'ghost')}</div></section>
      </div>`,
      'ks-dlg',
    );
    modal.d.addEventListener('click', event => this._click(modal, event.target));
  }

  static _file(result) {
    const remote = Srv.info && Srv.info.local === false;
    const id = esc(S.kpId);
    const count = KpFilesPanel.count(S.kpId);
    const files = KpFilesPanel.enabled()
      ? this._btn('data-ks="files"', `📎 Справочные документы${count ? ` (${count})` : ''}`, '', KpFilesPanel.ABOUT)
      : '';
    return `<section><p class="sub">Файл</p><div class="ks-b">${this._btn(`data-a="openDoc" data-id="${id}"`, remote ? 'Скачать .docx' : 'Открыть в Word')}${result.pdfOk ? this._btn(`data-a="openPdf" data-id="${id}"`, remote ? 'Скачать PDF' : 'Открыть PDF') : ''}
          ${remote && !Srv.info.docsShare ? '' : this._btn(`data-a="showDoc" data-id="${id}"`, remote ? 'Путь к файлу' : 'Показать в папке')}
          ${files}${FEAT.on('docsGen') ? this._btn('data-ks="docs"', '🧾 Счёт, спецификация, договор', '', 'Документы Word из этого КП: продавец — из «Наших реквизитов»') : ''}</div></section>`;
  }

  static _client() {
    const mail = FEAT.on('mail');
    const track = FEAT.on('track');
    if (!mail && !track) return '';
    const send = mail
      ? this._btn(
          `data-a="mailKp" data-id="${esc(S.kpId)}"`,
          '✉ Отправить по почте',
          'primary',
          'Письмо клиенту с файлом КП',
        )
      : '';
    const status = track
      ? this._btn(
          'data-ks="sent"',
          'Отметить «Отправлено»',
          '',
          'Если отправили сами — из своей почты или мессенджера',
        ) + this._btn('data-ks="remind"', '⏰ Напоминание', '', 'Когда перезвонить клиенту')
      : '';
    return `<section><p class="sub">Клиенту</p><div class="ks-b">${send}
          ${status}</div></section>`;
  }

  static _ACTIONS = {
    new: modal => {
      modal.close();
      NewKp.open();
    },
    files: (modal, button) =>
      KpFilesPanel.open(S.kpId, S.number, {
        onClose: count => {
          button.textContent = `📎 Справочные документы${count ? ` (${count})` : ''}`;
        },
      }),
    preset: modal => {
      modal.close();
      Presets.ask();
    },
    docs: () => DocsGen.open(S.kpId),
    sent: (modal, button) => KpSaved._sent(button),
    remind: modal => KpSaved._remind(modal),
  };

  static _click(modal, target) {
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    if (target.closest('[data-a="mailKp"]')) {
      modal.close(); // окно письма открывает общий обработчик
      return;
    }
    const button = target.closest('[data-ks]');
    if (button) this._ACTIONS[button.dataset.ks]?.(modal, button);
  }

  static async _sent(button) {
    try {
      await KpTrack.put(S.kpId, { status: 'sent' });
      button.disabled = true;
      button.textContent = '✓ Отправлено';
      Reminders.load();
      Toast.show(`КП № ${S.number}: отправлено`);
    } catch (error) {
      Toast.show(`Не получилось: ${error.message}`);
    }
  }

  static async _remind(modal) {
    const row = await this.row();
    modal.close();
    KpTrack.open(row || { id: S.kpId, number: S.number, client: S.client, track: {} });
  }
}
