import { EskdSheet } from './eskd-sheet.js';

/** Шрифт чертежей osifont Italic (близкий к типу Б по ГОСТ 2.304): загружается один раз и встраивается в лист. */
export class EskdFont {
  static URL = '/web/fonts/osifont-italic.ttf';
  static p = null;
  /** Загрузить (один раз); true — шрифт есть. */
  static load() {
    if (!this.p)
      this.p = (async () => {
        try {
          const r = await fetch(this.URL);
          if (!r.ok) return false;
          const b = new Uint8Array(await r.arrayBuffer());
          let s = '';
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
          EskdSheet.FONT_DATA = btoa(s);
          return true;
        } catch (e) {
          return false;
        }
      })();
    return this.p;
  }
}
