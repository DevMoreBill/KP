import { ImageFiles } from './images.js';
import { ItemLinks } from './item-links.js';

/**
 * Все места для картинок устроены одинаково: нажать — выбрать файл; перетащить файл или картинку со страницы сайта;
 * вставить из буфера — Ctrl+V, когда поле выбрано или под курсором, либо кнопкой «Вставить из буфера». Места: главное фото
 * и логотип (data-drop), миниатюра позиции (data-thumb), фото к блоку описания (data-fimg), схемы и изображения (data-gal).
 */
export class ImageSlots {
  static SLOT = '[data-drop],[data-thumb],[data-fimg],[data-gal]';
  static URL_RE = /^(https?:|data:image\/)/i;
  static ERR_LEN = 160;
  static hover = null;

  /**
   * Место для картинки под элементом.
   * @param {Element} el
   * @returns {HTMLElement|null}
   */
  static of(el) {
    return el && el.closest ? el.closest(this.SLOT) : null;
  }

  static _images(files) {
    return (files || []).filter(file => file && file.type && file.type.startsWith('image/'));
  }

  /**
   * Положить картинки в место.
   * @param {HTMLElement} slot
   * @param {File[]} files
   * @returns {Promise<*>}
   */
  static async put(slot, files) {
    const images = this._images(files);
    if (!images.length) return toast('Нужна картинка: JPG, PNG, WEBP или скопированное изображение');
    const data = slot.dataset;
    if (data.drop) return ImageFiles.load(images[0], data.drop, +data.i);
    if (data.thumb != null) {
      await ImageFiles.load(images[0], 'photo', +data.thumb);
      return toast('Главное фото добавлено');
    }
    if (data.fimg != null) return ItemLinks.addFeatImage(+data.fimg, data.fid, images.slice(0, 1));
    if (data.gal != null) return ImageFiles.addGallery(+data.gal, images, '');
    return undefined;
  }

  /**
   * Картинка по ссылке (перетащили со страницы сайта): data:-ссылка — сразу, http(s) — через сервер программы.
   * @param {string} link
   * @returns {Promise<File|null>}
   */
  static async fromUrl(link) {
    const url = String(link || '').trim();
    if (!url) return null;
    try {
      const answer = url.startsWith('data:image/')
        ? await fetch(url)
        : await api(`/api/imgfetch?url=${encodeURIComponent(url)}`, { raw: true });
      if (!answer.ok) throw new Error(await answer.text());
      const blob = await answer.blob();
      return new File([blob], 'image', { type: blob.type || 'image/png' });
    } catch (error) {
      toast(
        String(error.message || error).slice(0, this.ERR_LEN) ||
          'Картинку по ссылке загрузить не удалось — сохраните её в файл и перетащите файл',
      );
      return null;
    }
  }

  static _link(data) {
    const html = (data.getData && data.getData('text/html')) || '';
    const img = /<img[^>]+src="([^"]+)"/i.exec(html);
    if (img) return img[1].replace(/&amp;/g, '&');
    const text = (data.getData && (data.getData('text/uri-list') || data.getData('text/plain'))) || '';
    return text.split(/\r?\n/).find(line => this.URL_RE.test(line.trim()));
  }

  /**
   * Картинки из перетаскивания: файлы или картинка со страницы сайта.
   * @param {DataTransfer} data
   * @returns {Promise<File[]>}
   */
  static async filesFrom(data) {
    const files = [...(data.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) return files;
    const url = this._link(data);
    if (!url) return [];
    const file = await this.fromUrl(url);
    return file ? [file] : [];
  }

  static async _clipboard(slot, items) {
    for (const item of items) {
      const type = item.types.find(one => one.startsWith('image/'));
      if (type) return this.put(slot, [new File([await item.getType(type)], 'clipboard', { type })]);
    }
    for (const item of items) {
      if (!item.types.includes('text/plain')) continue;
      const text = await (await item.getType('text/plain')).text();
      if (!this.URL_RE.test(text.trim())) continue;
      const file = await this.fromUrl(text);
      if (file) return this.put(slot, [file]);
    }
    return toast('В буфере обмена нет картинки — скопируйте изображение (правый клик → «Копировать изображение»)');
  }

  /**
   * Кнопка «Вставить из буфера»: картинку читает браузер (на этом компьютере — сразу; по сети — через Ctrl+V).
   * @param {HTMLElement} slot
   * @returns {Promise<*>}
   */
  static async pasteButton(slot) {
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        return await this._clipboard(slot, await navigator.clipboard.read());
      } catch {
        // буфер недоступен — Ctrl+V
      }
    }
    slot.focus();
    return toast('Нажмите Ctrl+V — картинка из буфера вставится сюда');
  }

  static async _drop(type, event) {
    const slot = this.of(event.target);
    if (!slot) return;
    event.preventDefault();
    slot.classList.toggle('over', type === 'dragover');
    if (type !== 'drop') return;
    const files = await this.filesFrom(event.dataTransfer);
    if (files.length) this.put(slot, files);
    else toast('Перетащите файл картинки или изображение со страницы сайта');
  }

  static _pasteSlot() {
    const active = document.activeElement;
    const slot = this.of(active) || (this.hover && this.hover.isConnected ? this.hover : null);
    if (!slot) return null;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName) && !this.of(active)) return null;
    return slot;
  }

  static async _paste(event) {
    const slot = this._pasteSlot();
    if (!slot) return;
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      this.put(slot, files);
      return;
    }
    const text = ((event.clipboardData && event.clipboardData.getData('text/plain')) || '').trim();
    if (!this.URL_RE.test(text)) return;
    event.preventDefault();
    const file = await this.fromUrl(text);
    if (file) this.put(slot, [file]);
  }

  static _pasteClick(event) {
    const button = event.target.closest('[data-imgpaste]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const slot = button.dataset.imgpaste ? document.querySelector(button.dataset.imgpaste) : this.of(button);
    if (slot) this.pasteButton(slot);
  }

  /** Перетаскивание, вставка и кнопки «Вставить из буфера» на всей странице. */
  static listen() {
    document.addEventListener('pointerover', event => {
      this.hover = this.of(event.target);
    });
    document.addEventListener('click', event => this._pasteClick(event), true);
    ['dragover', 'dragleave', 'drop'].forEach(type =>
      document.addEventListener(type, event => this._drop(type, event)),
    );
    document.addEventListener('paste', event => this._paste(event));
  }
}

/** Логотип производителя: из каталога при точном совпадении названия производителя. */
export class Logos {
  static map = null;

  /**
   * Логотипы производителей (один раз).
   * @returns {Promise<object>}
   */
  static async load() {
    if (this.map) return this.map;
    return await this.reload();
  }

  /**
   * Логотипы производителей — заново с сервера.
   * @returns {Promise<object>}
   */
  static async reload() {
    try {
      this.map = await api('/api/logos');
    } catch {
      this.map = this.map || {};
    }
    return this.map;
  }

  /**
   * Логотип производителя.
   * @param {string} maker
   * @returns {object|null}
   */
  static of(maker) {
    const key = String(maker || '')
      .trim()
      .toLowerCase();
    return key && this.map ? this.map[key] || null : null;
  }

  /**
   * Подставить логотип, если его нет.
   * @param {object} item
   * @returns {boolean} подставлен
   */
  static auto(item) {
    if (!item || (item.logo && item.logo.src)) return false;
    const logo = this.of(attrsOf(item).maker);
    if (!logo) return false;
    item.logo = { src: logo.src, w: logo.w, h: logo.h, auto: logo.maker };
    return true;
  }
}
