import { Managers } from './managers.js';
import { FEAT } from '../../core/features.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { S } from '../../core/state.js';
import { FormView } from '../../ui/form-view.js';

/**
 * Чужое КП — только просмотр: администратор или менеджер с правом «КП других менеджеров», открыв КП коллеги, видит его как
 * есть; поля не правятся, черновик не пишется, «Сохранить КП» не сохраняет, пока не нажата «Разрешить правку» (на это КП,
 * пока открыто). Сервер без отметки правки чужое КП тоже не перезапишет.
 */
export class KpGuard {
  static HEADER = 'X-KP-Edit-Other';
  static unlocked = new Set();

  /**
   * КП сохранено и его автор — не тот, кто сейчас работает (администратор без своего КП — тоже «не автор»).
   * @returns {boolean}
   */
  static foreign() {
    const author = S.authorId || S.managerId || '';
    return Boolean(S.kpId && author) && author !== Managers.meId();
  }

  /**
   * Сейчас только просмотр.
   * @returns {boolean}
   */
  static locked() {
    return FEAT.on('kpViewLock') && this.foreign() && !this.unlocked.has(S.kpId);
  }

  static _whose() {
    const author = S.authorId || S.managerId;
    const row = Managers.list.find(one => one.id === author);
    return esc((row && row.name) || 'другого менеджера');
  }

  /**
   * Заголовок запроса сохранения: правка чужого КП разрешена.
   * @returns {object}
   */
  static headers() {
    return this.foreign() && this.unlocked.has(S.kpId) ? { [this.HEADER]: '1' } : {};
  }

  /**
   * Полоса над формой КП.
   * @returns {string}
   */
  static bar() {
    if (!FEAT.on('kpViewLock') || !this.foreign()) return '';
    const whose = this._whose();
    if (!this.locked())
      return `<div class="kpv-bar on">✎ Правка КП менеджера ${whose} разрешена — изменения сохранятся в его КП.</div>`;
    return `<div class="kpv-bar"><span>👁 КП менеджера <b>${whose}</b> — только просмотр. Правки не сохраняются.</span><button class="btn sm" type="button" data-kpunlock>Разрешить правку</button></div>`;
  }

  /**
   * Форма КП: в режиме просмотра поля неактивны (переход по шагам работает).
   * @param {HTMLElement} form
   */
  static apply(form) {
    const off = this.locked();
    for (const el of form.children) {
      if (!el.classList.contains('kpv-bar') && !el.classList.contains('stepnav')) el.inert = off;
    }
  }

  /** Кнопка «Разрешить правку». */
  static listen() {
    document.addEventListener('click', async event => {
      if (!event.target.closest('[data-kpunlock]')) return;
      if (await this.unlock()) FormView.render();
    });
  }

  /** «Разрешить правку» — с вопросом. */
  static async unlock() {
    const whose = this._whose();
    const answer =
      await Modal.ask(`<h3>Править КП коллеги?</h3><p>КП № ${esc(S.number || S.kpId)} — менеджера ${whose}. Изменения после «Сохранить КП» попадут в его КП.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Только смотреть</button><button class="btn primary" type="button" data-v="go">Разрешить правку</button></div>`);
    if (answer !== 'go') return false;
    this.unlocked.add(S.kpId);
    return true;
  }

  /**
   * Сохранение заблокировано (подсказка показана).
   * @returns {boolean}
   */
  static blocksSave() {
    if (!this.locked()) return false;
    Toast.show('Это КП коллеги открыто для просмотра. Нажмите «Разрешить правку», если изменения нужны.');
    return true;
  }
}
