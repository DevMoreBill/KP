import { WinSize } from '../../core/win-size.js';

/**
 * Размер и место окна сделки на ПК: у правого края — ширина тянется за левую кромку; потянуть за шапку — окно
 * отрывается и двигается, размер — за правый нижний угол; двойной щелчок по шапке — обратно к краю. Помнится в браузере.
 */
export class DealWin {
  static KEY = 'kp.dealWin';
  static MIN_WIDTH = 640;
  static MIN_HEIGHT = 420;
  static EDGE = 8;
  static MOVE_FROM = 4;
  static PHONE = 760;
  static FLOAT_HEIGHT = 0.86; // доля высоты экрана у оторванного окна
  static place = null;
  static _dragged = false;

  /**
   * Подключить окно: ручка ширины, перенос за шапку, сохранённое место.
   * @param {HTMLDialogElement} dialog
   */
  static bind(dialog) {
    if (window.innerWidth <= this.PHONE) return;
    this.place = this._load();
    dialog.classList.add('dk-pc');
    dialog.addEventListener('pointerdown', event => this._grab(dialog, event));
    dialog.addEventListener('dblclick', event => {
      if (this._handle(event)) this.dock(dialog);
    });
    new ResizeObserver(() => this._sized(dialog)).observe(dialog);
    this.apply(dialog);
  }

  /**
   * Щелчок мимо окна (по затемнению), а не по нему самому или его уголку.
   * @param {HTMLDialogElement} dialog
   * @param {MouseEvent} event
   * @returns {boolean}
   */
  static outside(dialog, event) {
    if (event.target !== dialog || this._dragged) return false;
    const box = dialog.getBoundingClientRect();
    const { clientX: pointX, clientY: pointY } = event;
    return pointX < box.left || pointX > box.right || pointY < box.top || pointY > box.bottom;
  }

  /**
   * Поставить окно по сохранённому месту.
   * @param {HTMLDialogElement} dialog
   */
  static apply(dialog) {
    const place = this.place || {};
    const width = this._clampWidth(place.width);
    if (width) WinSize.set(dialog, { width: `${width}px` });
    dialog.classList.toggle('dk-float', !!place.float);
    if (!place.float) {
      WinSize.set(dialog, { left: '', top: '', height: '' });
      return;
    }
    const height = Math.min(
      Math.max(place.height || window.innerHeight, this.MIN_HEIGHT),
      window.innerHeight - this.EDGE * 2,
    );
    const left = this._clamp(place.left, this.EDGE, window.innerWidth - (width || this.MIN_WIDTH) - this.EDGE);
    const top = this._clamp(place.top, this.EDGE, window.innerHeight - height - this.EDGE);
    WinSize.set(dialog, { left: `${left}px`, top: `${top}px`, height: `${height}px` });
    this.place = { ...place, width: width || place.width, height, left, top };
  }

  /**
   * Вернуть окно к правому краю (ширина остаётся).
   * @param {HTMLDialogElement} dialog
   */
  static dock(dialog) {
    this.place = { width: (this.place || {}).width };
    this._save();
    this.apply(dialog);
  }

  static _handle(event) {
    const head = event.target.closest('.dk-top');
    return head && !event.target.closest('button,input,select,textarea,a,label');
  }

  static _widen(dialog, event) {
    event.preventDefault();
    const startX = event.clientX;
    const box = dialog.getBoundingClientRect();
    const floating = dialog.classList.contains('dk-float');
    this._drag(event, moveEvent => {
      const shift = startX - moveEvent.clientX;
      const width = this._clampWidth(box.width + shift);
      WinSize.set(dialog, floating ? { width: `${width}px`, left: `${box.right - width}px` } : { width: `${width}px` });
      this.place = { ...this.place, width, ...(floating ? { left: box.right - width } : {}) };
    });
  }

  /**
   * Ручка ширины — первым элементом окна (перерисовка карточки её сохраняет).
   * @returns {string}
   */
  static grip() {
    return '<div class="dk-grip" title="Потяните, чтобы изменить ширину" aria-hidden="true"></div>';
  }

  static _grab(dialog, event) {
    if (event.button !== 0) return;
    if (event.target.closest('.dk-grip')) {
      this._widen(dialog, event);
      return;
    }
    if (!this._handle(event)) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const box = dialog.getBoundingClientRect();
    const height = dialog.classList.contains('dk-float')
      ? box.height
      : Math.round(window.innerHeight * this.FLOAT_HEIGHT);
    this._drag(event, moveEvent => {
      const shiftX = moveEvent.clientX - startX;
      const shiftY = moveEvent.clientY - startY;
      if (!this._dragged && Math.hypot(shiftX, shiftY) < this.MOVE_FROM) return;
      this._dragged = true;
      this.place = {
        ...this.place,
        float: true,
        width: box.width,
        height,
        left: box.left + shiftX,
        top: box.top + shiftY,
      };
      this.apply(dialog);
    });
  }

  static _drag(event, move) {
    this._dragged = false;
    const target = event.target;
    target.setPointerCapture?.(event.pointerId);
    const stop = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
      this._save();
      setTimeout(() => {
        this._dragged = false;
      });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
  }

  static _sized(dialog) {
    if (!dialog.classList.contains('dk-float') || !this.place) return;
    const box = dialog.getBoundingClientRect();
    if (
      Math.round(box.width) === Math.round(this.place.width) &&
      Math.round(box.height) === Math.round(this.place.height)
    )
      return;
    this.place = { ...this.place, width: box.width, height: box.height };
    WinSize.set(dialog, { width: `${Math.round(box.width)}px`, height: `${Math.round(box.height)}px` });
    this._save();
  }

  static _clampWidth(width) {
    if (!width) return 0;
    return Math.round(this._clamp(width, this.MIN_WIDTH, window.innerWidth - this.EDGE * 2));
  }

  static _clamp(value, low, high) {
    return Math.max(low, Math.min(Number(value) || 0, Math.max(low, high)));
  }

  static _load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : null;
    } catch {
      return null;
    }
  }

  static _save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.place || {}));
    } catch {
      // нет хранилища браузера — место окна просто не запомнится
    }
  }
}
