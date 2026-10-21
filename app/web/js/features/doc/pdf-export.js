import { KpFile } from './kp-file.js';
import { S } from '../../core/state.js';
import { Api } from '../../core/net.js';

/**
 * PDF КП — преобразует компьютер-сервер (Word или LibreOffice, app/pdf_convert.py); запросы — через api() (вход, совместная
 * правка), «PDF не создан:» из ответа сервера в сообщении не дублируется.
 */
export class PdfExport {
  static STORE_KEY = 'kp.pdf';

  /**
   * Запрос PDF к серверу.
   * @param {string} path
   * @param {object} options как у api()
   */
  static async call(path, options) {
    try {
      return await Api.request(path, options);
    } catch (error) {
      error.message = String(error.message || error).replace(/^PDF не создан:\s*/, '');
      throw error;
    }
  }

  /**
   * Имя PDF по имени файла КП.
   * @returns {string}
   */
  static fileName() {
    return KpFile.saved().replace(/\.docx$/i, '.pdf');
  }

  /**
   * PDF по документу текущего КП (без записи в журнал).
   * @param {Blob} blob
   * @returns {Promise<Blob>}
   */
  static async fromBlob(blob) {
    const response = await this.call(`/api/pdf?name=${encodeURIComponent(this.fileName())}`, {
      method: 'POST',
      body: blob,
      raw: true,
    });
    return response.blob();
  }

  /** После сохранения КП: PDF рядом с .docx в папке КП. */
  static async saveKp() {
    return this.call(`/api/kp/${encodeURIComponent(S.kpId)}/pdf`, { method: 'POST' });
  }

  /**
   * Галочка «Также сохранить в PDF».
   * @returns {boolean}
   */
  static wanted() {
    try {
      return localStorage.getItem(this.STORE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Обработчики документа. */
  static listen() {
    document.addEventListener('change', event => {
      if (event.target.id !== 'pdfToo') return;
      try {
        localStorage.setItem(this.STORE_KEY, event.target.checked ? '1' : '0');
      } catch {
        /* хранилище браузера недоступно — галочка не запоминается */
      }
    });
  }
}
