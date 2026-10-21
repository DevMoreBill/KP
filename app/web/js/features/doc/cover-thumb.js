import { PreviewDocx } from './preview-docx.js';
import { FormView } from '../../ui/form-view.js';
import { Steps } from '../../ui/steps.js';
import { $, esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';

/** Живое превью титула в разделе «Оформление КП»: первая страница документа, вписанная по ширине рамки. */
export class CoverThumb {
  static key = '';
  static node = null;
  static timer = null;
  static busy = false;
  static FIRST_DELAY = 150;
  static NEXT_DELAY = 900;
  static BUSY_DELAY = 500;
  static PAGE_WIDTH = 794;
  static PAGE_HEIGHT = 1123;
  static SRC_TAIL = -40;
  static EMPTY =
    '<p class="muted cv-empty">Добавьте оборудование — здесь появится титульный лист с фото, как в КП.</p>';

  static _key() {
    try {
      const items = S.items.map(item => {
        const src = item.photo && item.photo.src;
        return [
          item.id,
          src && src.length,
          src && src.slice(this.SRC_TAIL),
          item.name,
          item.qty,
          item.price,
          item.attrs,
          item.hint,
        ];
      });
      return JSON.stringify([S.template, S.cover, S.client, S.date, items, S.manager.name]);
    } catch {
      return String(Math.random());
    }
  }

  /** Перестроить превью (с задержкой); раздел перерисован — готовое превью ставится в новую рамку. */
  static soon() {
    const box = $('#cvThumb');
    if (!box) return;
    if (!S.items.length) {
      box.innerHTML = this.EMPTY;
      return;
    }
    if (this.node && this.key === this._key()) {
      box.replaceChildren(this.node);
      this.fit();
      return;
    }
    if (this.node) {
      box.replaceChildren(this.node);
      this.fit();
    }
    box.classList.add('loading');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._render(), this.node ? this.NEXT_DELAY : this.FIRST_DELAY);
  }

  static async _render() {
    const box = $('#cvThumb');
    if (!box || Steps.current !== 'cover') return;
    if (this.busy) {
      this.timer = setTimeout(() => this._render(), this.BUSY_DELAY);
      return;
    }
    this.busy = true;
    const key = this._key();
    try {
      await this._build(key);
    } catch (error) {
      const frame = $('#cvThumb');
      if (frame) {
        frame.classList.remove('loading');
        frame.innerHTML = `<p class="muted cv-empty">Превью не построено: ${esc(error.message || error)}</p>`;
      }
    }
    this.busy = false;
    if (Steps.current === 'cover' && this.key !== this._key()) this.soon();
  }

  static async _build(key) {
    const blob = await PreviewDocx.build();
    const host = document.createElement('div');
    host.className = 'cv-page';
    await PreviewDocx.renderInto(blob, host);
    host.querySelectorAll('section.docx').forEach((section, index) => {
      if (index > 0) section.remove();
    });
    this.node = host;
    this.key = key;
    const frame = $('#cvThumb');
    if (!frame) return;
    frame.replaceChildren(host);
    frame.classList.remove('loading');
    this.fit();
  }

  /** Масштаб по ширине рамки; высота рамки — по масштабированной странице (transform сам высоту не уменьшает). */
  static fit() {
    const box = $('#cvThumb');
    const section = box && box.querySelector('section.docx');
    if (!section) return;
    const width = box.clientWidth;
    if (!width) {
      requestAnimationFrame(() => this.fit());
      return;
    }
    const scale = Math.min(1, (width - 2) / (section.offsetWidth || this.PAGE_WIDTH));
    box.style.setProperty('--k', scale);
    box.style.height = `${Math.ceil((section.offsetHeight || this.PAGE_HEIGHT) * scale)}px`;
  }

  /** Обработчики документа. */
  static listen() {
    addEventListener('resize', () => {
      if (Steps.current === 'cover') this.fit();
    });
    document.addEventListener('change', event => {
      if (event.target.dataset.cvphoto == null) return;
      S.cover.photoFrom = event.target.value;
      FormView.render();
      KpState.persist();
    });
  }
}
