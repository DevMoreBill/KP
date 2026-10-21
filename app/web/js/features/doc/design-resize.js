import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignModel } from './design-model.js';
import { DesignView } from './design-view.js';
import { $ } from '../../core/util.js';

/** Размер за маркеры: ширина и высота независимо; Shift (или «Сохранять пропорции») — пропорционально. */
export class DesignResize {
  static MIN = 8;
  static STILL = 1;
  static CORNER = 2;

  /**
   * @param {PointerEvent} event
   * @param {string} handle маркер: n, ne, e, se, s, sw, w, nw
   * @param {HTMLElement} element
   */
  constructor(event, handle, element) {
    const sel = Design.state.sel;
    this.sel = sel;
    this.handle = handle;
    this.element = element;
    this.own = DesignModel.item(sel);
    this.rect = element.getBoundingClientRect();
    this.x0 = event.clientX;
    this.y0 = event.clientY;
    this.ratio = this.rect.width / Math.max(1, this.rect.height);
    this.perCm = DesignView.pxPerCm();
    this.frame = this.own && this.own.float ? element.closest('.kp-float') : null;
    this.box = { left: this.rect.left, top: this.rect.top, width: this.rect.width, height: this.rect.height };
    Design.state.drag = true;
    $('#tdMini').hidden = true;
    this.onMove = moveEvent => this.move(moveEvent);
    this.onUp = () => this.release();
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp, { once: true });
  }

  _keepRatio(event, size) {
    if (!event.shiftKey && !(this.own && this.own.lock)) return size;
    const handle = this.handle;
    let { width, height } = size;
    if (handle.length === this.constructor.CORNER) {
      if (width / height > this.ratio) height = width / this.ratio;
      else width = height * this.ratio;
    } else if (handle === 'e' || handle === 'w') height = width / this.ratio;
    else width = height * this.ratio;
    return { width, height };
  }

  /**
   * Движение указателя.
   * @param {PointerEvent} event
   */
  move(event) {
    const dx = event.clientX - this.x0;
    const dy = event.clientY - this.y0;
    const handle = this.handle;
    const rect = this.rect;
    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;
    if (handle.includes('e')) right += dx;
    if (handle.includes('w')) left += dx;
    if (handle.includes('s')) bottom += dy;
    if (handle.includes('n')) top += dy;
    const min = this.constructor.MIN;
    const { width, height } = this._keepRatio(event, {
      width: Math.max(min, right - left),
      height: Math.max(min, bottom - top),
    });
    if (handle.includes('w')) left = right - width;
    if (handle.includes('n')) top = bottom - height;
    this.box = { left, top, width, height };
    const zoom = Design.state.zoom;
    this.element.style.width = `${width / zoom}px`;
    this.element.style.height = `${height / zoom}px`;
    this.element.style.maxWidth = 'none';
    if (this.frame)
      this.frame.style.transform = `translate(${(left - rect.left) / zoom}px, ${(top - rect.top) / zoom}px)`;
    DesignView.placeBox({ left, top, width, height });
  }

  /** Указатель отпущен: размер (и сдвиг свободного объекта) — в настройки. */
  release() {
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    Design.state.drag = false;
    const { box, rect, perCm, sel } = this;
    const size = {
      width: Design.round(box.width / perCm, Design.CENTS),
      height: Design.round(box.height / perCm, Design.CENTS),
      dx: Design.round((box.left - rect.left) / perCm, Design.CENTS),
      dy: Design.round((box.top - rect.top) / perCm, Design.CENTS),
    };
    const still = this.constructor.STILL;
    if (Math.abs(box.width - rect.width) < still && Math.abs(box.height - rect.height) < still) {
      DesignView.markSelection();
      return;
    }
    DesignHistory.change(work => this._apply(work, sel, size), { now: true });
  }

  _apply(work, sel, size) {
    const item = DesignModel.item(sel);
    if (item) {
      item.widthCm = size.width;
      item.heightCm = sel.kind === 'label' || !item.lock ? size.height : 0;
      if (item.float) {
        item.x = Design.round((+item.x || 0) + size.dx, Design.CENTS);
        item.y = Design.round((+item.y || 0) + size.dy, Design.CENTS);
      }
      return;
    }
    if (sel.key === 'headerLogo') {
      work.header.logoWidthCm = size.width;
      work.header.logoHeightCm = size.height;
      return;
    }
    work.imgSize[sel.key] = { w: size.width, h: size.height };
  }
}
