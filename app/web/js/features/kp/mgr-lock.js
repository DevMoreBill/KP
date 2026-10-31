import { Auth } from '../../core/auth.js';
import { KpGuard } from './kp-guard.js';
import { Managers } from './managers.js';
import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';

/**
 * Вход по паролю: менеджер в КП — только тот, кто вошёл (другого не выбрать и не завести); свои контакты он правит.
 * Администратор и вход без пароля — выбор из справочника. То же проверяет сервер.
 */
export class MgrLock {
  /** КП открыто, создано, взято из черновика или заготовки — менеджером в нём становится вошедший. */
  static apply() {
    if (!Auth.pinned() || S.managerId === Auth.state.user.id || KpGuard.locked()) return; // КП коллеги на просмотре — не трогать
    const manager = Managers.list.find(row => row.id === Auth.state.user.id);
    if (manager) Managers.use(manager);
  }

  /**
   * Строка «Менеджер в КП — …» вместо выбора.
   * @returns {string}
   */
  static html() {
    const manager = Managers.list.find(row => row.id === Auth.state.user.id);
    return `<p id="mgrStat" style="grid-column:1/-1;margin:0">Менеджер в КП — <b>${esc(manager ? manager.name : Auth.state.user.name || '')}</b> (вы вошли по паролю).
      <span class="muted">Правки полей ниже сохраняются в вашей карточке сами.</span></p>`;
  }
}
