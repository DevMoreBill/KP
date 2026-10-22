import { PreviewDocx } from './preview-docx.js';
import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';

/**
 * Предпросмотр КП рядом с формой на широком экране (от 1600 px): включается кнопкой, обновляется через пару секунд после
 * правки, выбор помнится в браузере. На узком экране — прежнее окно «Предпросмотр КП».
 */
export class LivePreview {
  static KEY = 'kp.livePreview';
  static MIN_WIDTH = 1600;
  static DELAY_MS = 1800;
  static timer = 0;
  static busy = false;
  static again = false;

  /**
   * Включён ли (и помещается ли) предпросмотр рядом.
   * @returns {boolean}
   */
  static active() {
    return this._wanted() && window.innerWidth >= this.MIN_WIDTH;
  }

  static _wanted() {
    try {
      return localStorage.getItem(this.KEY) === '1';
    } catch {
      return false;
    }
  }

  /**
   * Кнопка в боковой панели (видна только на широком экране).
   * @returns {string}
   */
  static button() {
    return `<button class="btn ghost dl pv-live-btn" type="button" data-a="livePreview" aria-pressed="${this._wanted()}">${this._wanted() ? 'Скрыть предпросмотр рядом' : '👁 Предпросмотр рядом'}</button>`;
  }

  /** Включить или выключить. */
  static toggle() {
    try {
      localStorage.setItem(this.KEY, this._wanted() ? '0' : '1');
    } catch {
      // браузер не хранит — только до перезагрузки
    }
    document.querySelectorAll('[data-a="livePreview"]').forEach(button => {
      button.outerHTML = this.button();
    });
    this.apply();
  }

  /** Показать или убрать панель по выбору и ширине окна. */
  static apply() {
    const shown = this.active();
    document.body.classList.toggle('pv-live', shown);
    let box = document.getElementById('pvLive');
    if (shown && !box) {
      box = document.createElement('aside');
      box.id = 'pvLive';
      box.setAttribute('aria-label', 'Предпросмотр КП');
      box.innerHTML = '<div class="pv-live-b"><p class="empty">Собираю документ…</p></div>';
      document.body.appendChild(box);
    }
    if (!shown && box) box.remove();
    if (shown) this.schedule();
  }

  /** Обновить чуть позже (после серии правок — один раз). */
  static schedule() {
    if (!this.active()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._render(), this.DELAY_MS);
  }

  static async _render() {
    const host = document.querySelector('#pvLive .pv-live-b');
    if (!host) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      if (!S.items.length) host.innerHTML = '<p class="empty">Добавьте оборудование — здесь появится КП.</p>';
      else await PreviewDocx.renderInto(await PreviewDocx.build(), host);
    } catch (error) {
      host.innerHTML = `<p class="empty">Не удалось собрать КП: ${esc(error.message || error)}</p>`;
    } finally {
      this.busy = false;
    }
    if (this.again) {
      this.again = false;
      this.schedule();
    }
  }

  /** Кнопка и изменение размера окна. */
  static listen() {
    document.addEventListener('click', event => {
      if (event.target.closest && event.target.closest('[data-a="livePreview"]')) this.toggle();
    });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }
}
