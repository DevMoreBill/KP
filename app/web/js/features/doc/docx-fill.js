import { DocxWriter } from './docx-writer.js';

/**
 * Свой шаблон Word с метками {метка}: метки заменяются значениями, абзац с одной меткой {таблица} — таблицей товаров.
 * Word часто режет набранную метку на несколько кусков текста — такие абзацы склеиваются в один кусок перед заменой.
 */
export class DocxFill {
  static PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;
  static PARA = /<w:p[ >][\s\S]*?<\/w:p>/g;
  static TEXT = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g;
  static TAG = /\{([^{}<>]{1,40})\}/g;
  static TABLE_TAG = 'таблица';

  /**
   * Заполнить шаблон.
   * @param {ArrayBuffer} data файл шаблона .docx
   * @param {Object<string, string>} tags значения меток
   * @param {string} table разметка таблицы товаров (для {таблица})
   * @returns {Promise<{blob: Blob, missing: string[]}>} missing — метки шаблона, которых программа не знает
   */
  static async fill(data, tags, table) {
    const zip = await window.JSZip.loadAsync(data);
    const missing = new Set();
    const names = Object.keys(zip.files).filter(name => this.PARTS.test(name));
    for (const name of names) {
      const xml = await zip.file(name).async('string');
      zip.file(
        name,
        xml.replace(this.PARA, para => this._para(para, tags, table, missing)),
      );
    }
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return { blob, missing: [...missing] };
  }

  static _para(para, tags, table, missing) {
    const whole = this._text(para);
    if (!whole.includes('{')) return para;
    if (whole.trim() === `{${this.TABLE_TAG}}`) return `${table}<w:p/>`;
    const joined = this._join(para, whole);
    return joined.replace(this.TAG, (all, key) => {
      if (key in tags) return DocxWriter.esc(tags[key]).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
      missing.add(key);
      return all;
    });
  }

  static _text(para) {
    return [...para.matchAll(this.TEXT)].map(match => this._unesc(match[1])).join('');
  }

  static _unesc(text) {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }

  // весь текст абзаца — в первый кусок, остальные куски пустеют (оформление первого куска)
  static _join(para, whole) {
    let first = true;
    return para.replace(this.TEXT, () => {
      if (!first) return '<w:t></w:t>';
      first = false;
      return `<w:t xml:space="preserve">${DocxWriter.esc(whole)}</w:t>`;
    });
  }
}
