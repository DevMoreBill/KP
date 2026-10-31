import { FileSave } from './files.js';
import { Toast } from './toast.js';

/**
 * Программа значком с экрана «Домой» (iPhone, iPad): на весь экран, без адресной строки браузера. В этом режиме iPhone
 * не скачивает файл переходом по ссылке — приложение остаётся на экране файла без возврата, — поэтому файлы сервера
 * скачиваются без перехода: запрос → файл в памяти → ссылка на него.
 */
export class WebApp {
  static CLASS = 'web-app';
  static FILE_LINK = 'a[download], a[href*="download=1"]';
  static HINT =
    'Файл передан телефону. Если iPhone не предложил его сохранить — откройте программу в Safari или отправьте КП письмом.';

  /**
   * Программа открыта значком с экрана «Домой».
   * @returns {boolean}
   */
  static standalone() {
    return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  }

  /**
   * Значком на весь экран можно открыть отсюда: iPhone и iPad в браузере (Chrome на Android открывает так только адреса
   * https, у сервера отдела — http).
   * @returns {boolean}
   */
  static offer() {
    return navigator.standalone === false;
  }

  /** Метка режима на странице и ссылки «Скачать» — без перехода (только в режиме значка). */
  static listen() {
    if (!this.standalone()) return;
    document.documentElement.classList.add(this.CLASS);
    document.addEventListener('click', event => this._link(event), true);
  }

  /**
   * Скачать файл сервера без перехода по ссылке и подсказать, что делать, если телефон его не сохранил.
   * @param {string} url
   * @param {string} [name] имя, если сервер его не сообщил
   * @returns {Promise<void>}
   */
  static async download(url, name = '') {
    try {
      await FileSave.fromUrl(url, name);
      Toast.show(this.HINT);
    } catch (error) {
      Toast.show(`Файл не скачан: ${error.message || error}`);
    }
  }

  // ссылка на файл сервера (не blob: и не data: — их и так создаёт FileSave без перехода)
  static _link(event) {
    const link = event.target.closest?.(this.FILE_LINK);
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.protocol === 'blob:' || url.protocol === 'data:') return;
    event.preventDefault();
    this.download(url.href, link.getAttribute('download') || '');
  }
}
