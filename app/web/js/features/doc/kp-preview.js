import { DocImages } from './doc-images.js';
import { KpSave } from './kp-save.js';
import { PdfExport } from './pdf-export.js';
import { PreviewDocx } from './preview-docx.js';
import { Toast } from '../../core/toast.js';
import { Api, RemoteResult } from '../../core/net.js';
import { FileSave } from '../../core/files.js';
import { Modal } from '../../core/modal.js';
import { $, esc } from '../../core/util.js';
import { S } from '../../core/state.js';
import { KpForm } from '../../core/kp-form.js';

/** Окно предпросмотра всего КП без скачивания; PDF — с компьютера-сервера, иначе печать «Сохранить как PDF». */
export class KpPreview {
  static blob = null;
  static zoom = 1;
  static ZOOM = { min: 0.3, max: 2, step: 0.1, fitMin: 0.4, fitSteps: 20, steps: 10, pad: 48 };
  static PRINT_RESET = 1500;
  static PRINT_DELAY = 300;
  static ACTIONS = {
    close: dialog => dialog.close(),
    print: () => KpPreview.print(),
    pdf: (dialog, button) => KpPreview._pdf(button),
    save: dialog => {
      dialog.close();
      return KpSave.run();
    },
  };

  static _head() {
    const blocked = KpForm.problems().length
      ? ' disabled title="Сначала заполните обязательные поля — список справа"'
      : '';
    return `<div class="pv-hd"><h3>Предпросмотр КП${S.number ? ` № ${esc(S.number)}` : ''}</h3><span class="muted pv-note">${S.kpId ? '' : 'Номер присвоится при сохранении'}</span><span class="sp"></span>
      <div class="pv-zoom"><button class="icon" type="button" data-pz="-1" aria-label="Мельче">−</button><span id="pvZ">100%</span><button class="icon" type="button" data-pz="1" aria-label="Крупнее">+</button></div>
      <button class="btn" type="button" data-pva="pdf"><span class="pv-l">Скачать </span>PDF</button><button class="btn" type="button" data-pva="print" title="Печать или «Сохранить как PDF» средствами браузера">Печать</button>
      <button class="btn primary" type="button" data-pva="save"${blocked}>Сохранить<span class="pv-l">${S.kpId ? ' изменения' : ' КП'}</span></button>
      <button class="icon" type="button" data-pva="close" aria-label="Закрыть">✕</button></div>`;
  }

  /** Открыть окно и собрать документ по текущему КП. */
  static async open() {
    const dialog = Modal.host('pvdlg', 'kpprev', 'Предпросмотр КП');
    dialog.innerHTML = `${this._head()}
    <div class="pv-msg" id="pvMsg" hidden></div>
    <div class="pv-body" id="pvBody"><p class="empty">Собираю документ…</p></div>`;
    if (!dialog.open) dialog.showModal();
    dialog.onclick = event => this._click(dialog, event);
    try {
      this.blob = await PreviewDocx.build();
      await PreviewDocx.renderInto(this.blob, $('#pvBody'));
      this._fit();
      if (DocImages.missing.length)
        this._message(DocImages.html().replace(/^<div class="msg warn">|<\/div>$/g, ''), 'warn');
    } catch (error) {
      $('#pvBody').innerHTML = `<p class="empty">Не удалось собрать КП: ${esc(error.message || error)}</p>`;
    }
  }

  static _click(dialog, event) {
    const zoom = event.target.closest('[data-pz]');
    if (zoom) return this._zoom(+zoom.dataset.pz);
    const button = event.target.closest('[data-pva]');
    const action = button && this.ACTIONS[button.dataset.pva];
    return action ? action(dialog, button) : undefined;
  }

  static _apply() {
    const body = $('#pvBody');
    if (body) body.style.setProperty('--z', this.zoom);
    const label = $('#pvZ');
    if (label) label.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  static _fit() {
    const body = $('#pvBody');
    const section = body && body.querySelector('section.docx');
    if (!section) return;
    const { fitMin, fitSteps, pad } = this.ZOOM;
    this.zoom = Math.max(fitMin, Math.min(1, (body.clientWidth - pad) / section.offsetWidth));
    this.zoom = Math.round(this.zoom * fitSteps) / fitSteps;
    this._apply();
  }

  static _zoom(direction) {
    const { min, max, step, steps } = this.ZOOM;
    this.zoom = Math.max(min, Math.min(max, Math.round((this.zoom + direction * step) * steps) / steps));
    this._apply();
  }

  static _message(html, kind) {
    const box = $('#pvMsg');
    if (!box) return;
    box.hidden = !html;
    box.className = `pv-msg ${kind || ''}`;
    box.innerHTML = html || '';
  }

  /** Печать документа из окна предпросмотра. */
  static print() {
    document.body.classList.add('printing-kp');
    const done = () => {
      document.body.classList.remove('printing-kp');
      removeEventListener('afterprint', done);
    };
    addEventListener('afterprint', done);
    window.print();
    setTimeout(done, this.PRINT_RESET);
  }

  static async _pdf(button) {
    if (!this.blob) return;
    button.disabled = true;
    const text = button.textContent;
    button.textContent = 'Создаю PDF…';
    this._message('');
    try {
      const pdf = await PdfExport.fromBlob(this.blob);
      const saved = await FileSave.save(PdfExport.fileName(), pdf);
      this._message(saved === false ? 'Сохранение отменено.' : 'PDF готов.', saved === false ? '' : 'ok');
    } catch (error) {
      this._message(
        `PDF не создан: ${esc(error.message || error)}. <button class="btn" type="button" data-pva="print">Печать → «Сохранить как PDF»</button>`,
        'err',
      );
    }
    button.disabled = false;
    button.textContent = text;
  }

  static _openPdf(button) {
    Api.request(`/api/kp/${button.dataset.id}/openpdf`, { method: 'POST' })
      .then(reply => RemoteResult.show(reply))
      .catch(error => Toast.show(String(error.message || error)));
  }

  /** Обработчики документа: «Предпросмотр», «Открыть PDF», «Печать → PDF». */
  static listen() {
    const actions = {
      kpPreview: () => this.open(),
      openPdf: button => this._openPdf(button),
      printPdf: () => this.open().then(() => setTimeout(() => this.print(), this.PRINT_DELAY)),
    };
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-a]');
      const action = button && actions[button.dataset.a];
      if (action) action(button);
    });
  }
}
