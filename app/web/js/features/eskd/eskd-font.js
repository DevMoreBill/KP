import { EskdSheet } from './eskd-sheet.js';

/** Шрифт чертежей osifont Italic (близкий к типу Б по ГОСТ 2.304): загружается один раз и встраивается в лист. */
export class EskdFont {
  static URL = '/web/fonts/osifont-italic.ttf';
  static loading = null;
  /** Загрузить (один раз); true — шрифт есть. */
  static load() {
    if (!this.loading)
      this.loading = (async () => {
        try {
          const resp = await fetch(this.URL);
          if (!resp.ok) return false;
          const bytes = new Uint8Array(await resp.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          EskdSheet.FONT_DATA = btoa(bin);
          return true;
        } catch (err) {
          return false;
        }
      })();
    return this.loading;
  }
}
