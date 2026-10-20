/**
 * Изображения документа КП: файл пропал (удалён из папки картинок, база перенесена без картинок) — КП собирается без него,
 * а кому не хватило фото — в списке missing (показывается после сохранения и в предпросмотре).
 */
export class DocImages {
  static missing = [];
  static SHOWN = 5;

  /** Новая сборка документа — список пропавших фото заново. */
  static reset() {
    this.missing = [];
  }

  static _miss(who) {
    if (who && !this.missing.includes(who)) this.missing.push(who);
  }

  /**
   * Картинка как data:URL или null (нет файла — who в список пропавших).
   * @param {{src: string}|null} image
   * @param {string} [who]
   * @returns {Promise<string|null>}
   */
  static async url(image, who) {
    if (!image || !image.src) return null;
    try {
      if (String(image.src).startsWith('data:')) return image.src;
      const response = await fetch(image.src);
      if (!response.ok || !/^image\//.test(response.headers.get('Content-Type') || '')) {
        throw new Error(String(response.status));
      }
      return await blobToURL(await response.blob());
    } catch {
      this._miss(who);
      return null;
    }
  }

  /**
   * Плитка фото для страницы оборудования (tileFrom) или null.
   * @param {{src: string}|null} image
   * @param {string} [who]
   * @returns {Promise<object|null>} {url, w, h}
   */
  static async tile(image, who) {
    const url = await this.url(image, who);
    if (!url) return null;
    try {
      return await tileFrom({ src: url });
    } catch {
      this._miss(who);
      return null;
    }
  }

  /**
   * Предупреждение о пропавших фото или ''.
   * @returns {string}
   */
  static html() {
    const list = this.missing;
    if (!list.length) return '';
    const more = list.length > this.SHOWN ? ` и ещё ${list.length - this.SHOWN}` : '';
    return `<div class="msg warn">Не найден файл фото: ${esc(list.slice(0, this.SHOWN).join('; '))}${more}. КП собрано без этих фото — замените их в карточке позиции.</div>`;
  }
}
