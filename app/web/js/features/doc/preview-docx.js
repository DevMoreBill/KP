import { KpDocx } from './kp-docx.js';
import { Templates } from './templates.js';

/**
 * Документ КП для показа (vendor/docx-preview): собирается так же, как при сохранении, — без номера и записи в журнал.
 */
export class PreviewDocx {
  static OPTIONS = {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    experimental: true,
    renderHeaders: true,
    renderFooters: true,
    useBase64URL: true,
  };
  static PARTS = /^word\/(document|header\d*|footer\d*|header_kp|footer_kp)\.xml$/;
  static NO_BREAK_HYPHEN = '<w:noBreakHyphen/>';
  static FLOAT_BOXES = 'section.docx > article p.docx_kpfloat div, section.docx > article p[class*="docx_kpanc_"] div';

  /**
   * Документ по текущему КП.
   * @returns {Promise<Blob>}
   */
  static async build() {
    if (!S.items.length) throw new Error('добавьте в КП хотя бы одну позицию');
    if (!window.docx || !window.JSZip) throw new Error('не загрузился модуль предпросмотра — обновите страницу');
    const pack = await Templates.pack(S.template);
    await StationImages.syncAll(); // 3D-вид и чертёж станций — по текущему составу
    const state = KpDocx.state();
    if (!state.number) state.number = S.number || '—';
    return KpDocx.render(state, pack, pack.settings);
  }

  /**
   * Копия для показа: docx-preview теряет неразрывный дефис Word («CAF4-22-5/2» → «CAF4225/2») — в копии он заменён
   * знаком U+2011; сам файл (и PDF из него) не меняется.
   * @param {Blob} blob
   * @returns {Promise<Blob>}
   */
  static async forDisplay(blob) {
    try {
      const zip = await JSZip.loadAsync(blob);
      let changed = false;
      for (const name of Object.keys(zip.files).filter(path => this.PARTS.test(path))) {
        const xml = await zip.file(name).async('string');
        if (xml.indexOf(this.NO_BREAK_HYPHEN) < 0) continue;
        zip.file(name, xml.split(this.NO_BREAK_HYPHEN).join('<w:t>‑</w:t>'));
        changed = true;
      }
      return changed ? await zip.generateAsync({ type: 'blob', compression: 'STORE' }) : blob;
    } catch {
      return blob;
    }
  }

  /**
   * Показать документ в элементе.
   * @param {Blob} blob
   * @param {HTMLElement} host
   */
  static async renderInto(blob, host) {
    const style = document.createElement('div');
    const body = document.createElement('div');
    await docx.renderAsync(await this.forDisplay(blob), body, style, this.OPTIONS);
    this._floats(body, blob.kpFloats);
    host.replaceChildren(style, body);
  }

  // плавающие объекты шаблона docx-preview рисует пустыми блоками нулевого размера — по порядку в документе дорисовываются
  // надписи, картинки «за текстом» уходят под текст; только в абзацах привязки шаблона (фигуры самого макета не считаются)
  static _floats(body, floats) {
    if (!floats || !floats.length) return;
    const boxes = [...body.querySelectorAll(this.FLOAT_BOXES)].filter(
      box => box.style.width === '0px' && box.style.height === '0px',
    );
    floats.forEach((float, index) => {
      const box = boxes[index];
      if (!box) return;
      box.classList.add('kp-float');
      box.dataset.kpf = float.id;
      if (float.kind === 'label' && !box.firstElementChild) box.innerHTML = float.html;
      if (float.behind) box.classList.add('kp-behind');
    });
  }
}
