import { Design } from './design.js';
import { DesignHistory } from './design-history.js';

/** Порядок разделов в списке «Структура» — перетаскиванием указателем (мышь, перо, палец) за любое место строки. */
export class DesignSort {
  static START = 5;
  static MARKS = ['over-t', 'over-b'];

  /**
   * @param {PointerEvent} event
   * @param {HTMLElement} row строка раздела
   */
  constructor(event, row) {
    this.row = row;
    this.list = row.parentElement;
    this.from = +row.dataset.tdsec;
    this.to = this.from;
    this.y0 = event.clientY;
    this.drag = false;
    this.onMove = moveEvent => this.move(moveEvent);
    this.onUp = () => this.release();
    addEventListener('pointermove', this.onMove, { passive: false });
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
  }

  _rows() {
    return [...this.list.children];
  }

  _target(y) {
    let target = null;
    let after = false;
    for (const other of this._rows().filter(row => row !== this.row)) {
      const rect = other.getBoundingClientRect();
      target = other;
      if (y < rect.top + rect.height / 2) {
        after = false;
        break;
      }
      after = true;
    }
    return { target, after };
  }

  /**
   * Движение указателя.
   * @param {PointerEvent} event
   */
  move(event) {
    if (!this.drag) {
      if (Math.abs(event.clientY - this.y0) < this.constructor.START) return;
      this.drag = true;
      this.row.classList.add('drag');
      document.body.classList.add('td-sorting');
    }
    event.preventDefault();
    this.row.style.transform = `translateY(${event.clientY - this.y0}px)`;
    this._rows().forEach(row => row.classList.remove(...this.constructor.MARKS));
    const { target, after } = this._target(event.clientY);
    if (!target) return;
    target.classList.add(after ? 'over-b' : 'over-t');
    const index = +target.dataset.tdsec;
    this.to = after ? index + 1 : index;
    if (this.to > this.from) this.to--;
  }

  /** Указатель отпущен: новый порядок разделов. */
  release() {
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    document.body.classList.remove('td-sorting');
    this.row.style.transform = '';
    this.row.classList.remove('drag');
    this._rows().forEach(row => row.classList.remove(...this.constructor.MARKS));
    if (!this.drag) return;
    Design.state.clickBlock = true;
    setTimeout(() => {
      Design.state.clickBlock = false;
    }, 0);
    const { from, to } = this;
    if (to === from || to < 0) return;
    DesignHistory.change(
      work => {
        const [section] = work.sections.splice(from, 1);
        work.sections.splice(to, 0, section);
      },
      { now: true },
    );
  }
}
