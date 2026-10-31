/** Файлы в браузере: сохранение с выбором места или скачиванием, data: URL ↔ Blob. */
export class FileSave {
  static REVOKE_MS = 4000;
  static PICKER_TYPES = {
    docx: {
      description: 'Документ Word',
      accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
    },
    pdf: { description: 'Документ PDF', accept: { 'application/pdf': ['.pdf'] } },
    json: { description: 'Каталог', accept: { 'application/json': ['.json'] } },
  };

  /**
   * Сохранить с выбором места (где браузер умеет), иначе — скачать; false — выбор места отменён.
   * @param {string} name
   * @param {Blob} blob
   * @returns {Promise<boolean>}
   */
  static async save(name, blob) {
    if (window.showSaveFilePicker) {
      try {
        const ext = name.split('.').pop();
        const types = [Object.hasOwn(this.PICKER_TYPES, ext) ? this.PICKER_TYPES[ext] : this.PICKER_TYPES.json];
        const handle = await window.showSaveFilePicker({ suggestedName: name, types });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
    this.download(name, blob);
    return true;
  }

  /**
   * Скачать файл (ссылка — внутри открытого окна: вне модального окна браузер нажатия не пропускает).
   * @param {string} name
   * @param {Blob} blob
   */
  static download(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    (document.querySelector('dialog[open]') || document.body).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), this.REVOKE_MS);
  }

  /**
   * Скачать файл сервера без перехода по ссылке: запрос → файл в памяти → ссылка на него.
   * @param {string} url
   * @param {string} [name] имя, если сервер его не сообщил
   * @returns {Promise<void>}
   */
  static async fromUrl(url, name = '') {
    const reply = await fetch(url, { credentials: 'same-origin' });
    if (!reply.ok) throw new Error(`сервер ответил ${reply.status}`);
    const fallback = name || decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'file');
    this.download(this.nameOf(reply.headers.get('Content-Disposition'), fallback), await reply.blob());
  }

  /**
   * Имя файла из заголовка Content-Disposition: сначала filename* (UTF-8), затем filename, иначе — запасное.
   * @param {string|null} header
   * @param {string} fallback
   * @returns {string}
   */
  static nameOf(header, fallback) {
    const utf = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header || '');
    if (utf) {
      try {
        return decodeURIComponent(utf[1].trim());
      } catch {
        // испорченное %-кодирование — ниже простое имя
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header || '');
    return plain ? plain[1].trim() : fallback;
  }

  /**
   * data: URL → Blob.
   * @param {string} url
   * @returns {Promise<Blob>}
   */
  static async blob(url) {
    return (await fetch(url)).blob();
  }

  /**
   * Blob → data: URL.
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  static dataUrl(blob) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Содержимое data: URL (base64 после запятой).
   * @param {string} url
   * @returns {string}
   */
  static base64(url) {
    return url.split(',')[1];
  }
}

/**
 * Копирование в буфер обмена. По сети (http://сервер:порт) браузер не даёт странице navigator.clipboard — тогда текст
 * кладётся через событие copy; поле для выделения — внутри открытого окна, потому что всё вне модального окна неактивно.
 */
export class CopyText {
  /**
   * @param {string} text
   * @returns {Promise<boolean>} true — только если текст точно скопирован
   */
  static async copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // запасной способ ниже
      }
    }
    return this._byCopyEvent(text);
  }

  static _byCopyEvent(text) {
    let done = false;
    const onCopy = event => {
      try {
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        done = true;
      } catch {
        // браузер не дал записать — done остаётся false
      }
    };
    document.addEventListener('copy', onCopy, true);
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    host.appendChild(area);
    area.focus();
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      // старый способ недоступен
    }
    document.removeEventListener('copy', onCopy, true);
    area.remove();
    return done;
  }
}
