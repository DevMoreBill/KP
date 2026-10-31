import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignModel } from './design-model.js';
import { DesignPanels } from './design-panels.js';
import { DesignView } from './design-view.js';
import { Toast } from '../../core/toast.js';
import { $ } from '../../core/util.js';

/**
 * Перенос мышью: свой объект — в любое место страницы (место привязки и координаты, направляющие притягивают), элемент
 * макета — сдвиг отступов абзаца его стиля.
 */
export class DesignMove {
  static START = 5;
  static EDGE = 30;
  static SCROLL = 12;
  static STILL = 2;
  static HALVES = 2;

  /**
   * @param {PointerEvent} event
   * @param {object} sel что двигается
   */
  constructor(event, sel) {
    this.sel = sel;
    this.x0 = event.clientX;
    this.y0 = event.clientY;
    this.own = DesignModel.item(sel);
    this.canvas = $('#tdCanvas');
    this.drag = false;
    this.moved = [];
    this.rect = null;
    this.last = { dx: 0, dy: 0, snap: null };
    this.onMove = moveEvent => this.move(moveEvent);
    this.onUp = () => this.release();
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp, { once: true });
  }

  // что двигается на экране: свой объект — его рамка (или сам он), элемент макета — все его абзацы
  _start() {
    const state = Design.state;
    this.drag = true;
    state.drag = true;
    if (state.sel?.key !== this.sel.key) {
      state.sel = this.sel;
      DesignPanels.panels();
      DesignView.markSelection();
    }
    this.rect = this.sel.el.getBoundingClientRect();
    this.moved = this.own
      ? [this.sel.el.closest('.kp-float') || this.sel.el]
      : [...new Set(DesignModel.elements(this.sel).map(element => element.closest('p') || element))];
    this.moved.forEach(element => element.classList.add('td-moving'));
    $('#tdMini').hidden = true;
  }

  /**
   * Движение указателя.
   * @param {PointerEvent} event
   */
  move(event) {
    let dx = event.clientX - this.x0;
    const dy = event.clientY - this.y0;
    if (!this.drag) {
      if (Math.hypot(dx, dy) < this.START) return;
      this._start();
    }
    const rect = this.rect;
    let snap = null;
    if (this.own) {
      const page = DesignView.pageAt(rect.top + dy) || DesignView.pageAt(event.clientY);
      const found = DesignView.snapX(rect.left + dx, rect.width, page);
      if (found.x != null) {
        dx += found.dx;
        snap = found.x;
      }
    }
    this.last = { dx, dy, snap };
    this.moved.forEach(element => {
      element.style.transform = `translate(${dx / Design.state.zoom}px, ${dy / Design.state.zoom}px)`;
    });
    DesignView.guide(snap);
    this._box(dx, dy);
    this._scroll(event);
  }

  _box(dx, dy) {
    const box = $('#tdSelBox');
    if (!this.own || !box) return;
    const rect = this.rect;
    DesignView.placeBox({ left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height });
    const anchor = DesignView.anchorFor(rect.left + dx, rect.top + dy);
    if (anchor)
      box.querySelector('.td-dim').textContent = `X ${Design.cmText(anchor.x)} · Y ${Design.cmText(anchor.y)} см`;
  }

  _scroll(event) {
    const frame = this.canvas.getBoundingClientRect();
    if (event.clientY < frame.top + this.constructor.EDGE) this.canvas.scrollTop -= this.constructor.SCROLL;
    else if (event.clientY > frame.bottom - this.constructor.EDGE) this.canvas.scrollTop += this.constructor.SCROLL;
  }

  /** Указатель отпущен: новое место записывается в настройки. */
  release() {
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    DesignView.guide(null);
    if (!this.drag) return;
    Design.state.drag = false;
    Design.state.clickBlock = true;
    setTimeout(() => {
      Design.state.clickBlock = false;
    }, 0);
    if (this.own) this._placeOwn();
    else this._shiftLayout();
  }

  _placeOwn() {
    const { dx, dy } = this.last;
    const rect = this.rect;
    const perCm = Design.pxPerCm();
    const anchor = DesignView.anchorFor(rect.left + dx, rect.top + dy);
    if (!anchor) {
      this.moved.forEach(element => {
        element.style.transform = '';
      });
      return;
    }
    if (anchor.far) Toast.show('На этой странице нет места привязки — объект привязан к ближайшему разделу выше');
    DesignHistory.change(
      () => {
        const item = DesignModel.item(this.sel);
        if (!item) return;
        const was = item.float;
        Object.assign(item, { float: true, place: anchor.place, x: anchor.x, y: anchor.y });
        if (!was && this.sel.kind === 'label') {
          item.widthCm = item.widthCm || Design.round(rect.width / perCm, Design.CENTS);
          item.heightCm = item.heightCm || Design.round(rect.height / perCm, Design.CENTS);
        }
      },
      { now: true },
    );
  }

  _shiftLayout() {
    const { dx, dy } = this.last;
    const { STILL, HALVES } = this.constructor;
    const perCm = Design.pxPerCm();
    const paraKey = DesignModel.paraKey(this.sel);
    if (!paraKey) return;
    DesignHistory.change(
      work => {
        const para = (work.para[paraKey] = work.para[paraKey] || {});
        if (Math.abs(dx) > STILL) para.indent = Design.round((+para.indent || 0) + dx / perCm, Design.CENTS);
        if (Math.abs(dy) > STILL)
          para.before = Design.round((+para.before || 0) + (dy / perCm) * Design.PT_PER_CM, HALVES);
        if (!Object.keys(para).length) delete work.para[paraKey];
      },
      { now: true },
    );
    if (dy < -STILL) Toast.show('Сдвиг вверх ограничен отступом макета над элементом');
  }
}
