import { Modal } from '../core/modal.js';
import { esc } from '../core/util.js';

/**
 * Изображения станции (разрез и виды снаружи) на весь экран: щипок или колесо — масштаб, перетаскивание — сдвиг,
 * смахивание — соседний ракурс, двойное касание — крупнее / как было; стрелки клавиатуры и ‹ › — тоже.
 */
export class PicView {
  static SELECTOR = 'img[data-st3d], img[data-st3do]';
  static MAX = 6;
  static DOUBLE = 2.5;
  static SWIPE_PX = 60;
  static TAP_MS = 300;
  static WHEEL_STEP = 1.15;

  /** Нажатие по 3D-изображению станции открывает просмотр. */
  static listen() {
    document.addEventListener('click', event => {
      const img = event.target.closest(this.SELECTOR);
      if (!img || img.classList.contains('wait') || event.target.closest('dialog.pv-dlg')) return;
      const box = img.closest('.stl-views') || document;
      const pics = [...box.querySelectorAll(this.SELECTOR)].filter(pic => !pic.classList.contains('wait'));
      this.open(
        pics.map(pic => ({ src: pic.src, cap: pic.alt })),
        Math.max(0, pics.indexOf(img)),
      );
    });
  }

  /**
   * Открыть просмотр.
   * @param {{src: string, cap: string}[]} pics
   * @param {number} index
   */
  static open(pics, index) {
    if (!pics.length) return;
    const modal = new Modal(
      `<div class="pv-top"><b class="pv-cap"></b><span class="muted pv-n"></span><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="pv-stage"><img class="pv-img" alt="" draggable="false"></div>
      ${pics.length > 1 ? '<button class="pv-go pv-prev" type="button" data-pv="-1" aria-label="Предыдущий вид">‹</button><button class="pv-go pv-next" type="button" data-pv="1" aria-label="Следующий вид">›</button>' : ''}
      <p class="muted pv-hint">Двумя пальцами или колесом — крупнее, смахните — другой вид, двойное касание — как было</p>`,
      'pv-dlg',
    );
    new PicView(modal, pics, index).bind();
  }

  /**
   * @param {Modal} modal
   * @param {{src: string, cap: string}[]} pics
   * @param {number} index
   */
  constructor(modal, pics, index) {
    this.modal = modal;
    this.pics = pics;
    this.index = index;
    this.img = modal.$('.pv-img');
    this.stage = modal.$('.pv-stage');
    this.points = new Map();
    this.view = { scale: 1, dx: 0, dy: 0 };
    this.gesture = null;
    this.lastTap = 0;
  }

  /** Обработчики окна. */
  bind() {
    const dialog = this.modal.d;
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) this.modal.close();
      const step = event.target.closest('[data-pv]');
      if (step) this.turn(+step.dataset.pv);
    });
    dialog.addEventListener('keydown', event => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (step) this.turn(step);
    });
    this.stage.addEventListener('pointerdown', event => this._down(event));
    this.stage.addEventListener('pointermove', event => this._move(event));
    for (const name of ['pointerup', 'pointercancel']) this.stage.addEventListener(name, event => this._up(event));
    this.stage.addEventListener('wheel', event => this._wheel(event), { passive: false });
    this.show();
  }

  /**
   * Соседний вид.
   * @param {number} step -1 или 1
   */
  turn(step) {
    this.index = (this.index + step + this.pics.length) % this.pics.length;
    this.show();
  }

  /** Показать текущий вид в исходном масштабе. */
  show() {
    const pic = this.pics[this.index];
    this.img.src = pic.src;
    this.modal.$('.pv-cap').innerHTML = esc(pic.cap || '');
    this.modal.$('.pv-n').textContent = this.pics.length > 1 ? `${this.index + 1} из ${this.pics.length}` : '';
    this._set({ scale: 1, dx: 0, dy: 0 });
  }

  _set(view) {
    const scale = Math.min(this.constructor.MAX, Math.max(1, view.scale));
    this.view = scale === 1 ? { scale, dx: 0, dy: 0 } : { ...view, scale };
    this.img.style.transform = `translate(${this.view.dx}px, ${this.view.dy}px) scale(${this.view.scale})`;
  }

  _down(event) {
    this.stage.setPointerCapture(event.pointerId);
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.gesture = { start: this._snapshot(), view: { ...this.view }, at: Date.now() };
  }

  _snapshot() {
    const list = [...this.points.values()];
    const [first, second] = list;
    if (!second) return { x: first.x, y: first.y, span: 0 };
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      span: Math.hypot(first.x - second.x, first.y - second.y),
    };
  }

  _move(event) {
    if (!this.points.has(event.pointerId) || !this.gesture) return;
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = this._snapshot();
    const { start, view } = this.gesture;
    const scale = start.span && now.span ? (view.scale * now.span) / start.span : view.scale;
    if (scale > 1 || this.points.size > 1)
      this._set({ scale, dx: view.dx + now.x - start.x, dy: view.dy + now.y - start.y });
  }

  _up(event) {
    if (!this.points.has(event.pointerId)) return;
    const end = this._snapshot();
    this.points.delete(event.pointerId);
    const gesture = this.gesture;
    this.gesture = this.points.size ? { start: this._snapshot(), view: { ...this.view }, at: Date.now() } : null;
    if (!gesture || this.points.size || gesture.start.span) return;
    const shift = end.x - gesture.start.x;
    if (this.view.scale === 1 && Math.abs(shift) > this.constructor.SWIPE_PX) {
      this.turn(shift < 0 ? 1 : -1);
      return;
    }
    if (Date.now() - gesture.at < this.constructor.TAP_MS) this._tap();
  }

  _tap() {
    const now = Date.now();
    if (now - this.lastTap < this.constructor.TAP_MS) {
      this._set({ scale: this.view.scale > 1 ? 1 : this.constructor.DOUBLE, dx: 0, dy: 0 });
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
  }

  _wheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? this.constructor.WHEEL_STEP : 1 / this.constructor.WHEEL_STEP;
    this._set({ ...this.view, scale: this.view.scale * factor });
  }
}
