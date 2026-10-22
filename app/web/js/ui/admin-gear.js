import { SettingsWindow } from '../features/admin/settings-window.js';

/** Щелчок по ⚙ (AdminGear) — «Настройки» на нужном месте. */
export class AdminGearClicks {
  /** Обработчик страницы. */
  static listen() {
    document.addEventListener('click', event => {
      const gear = event.target.closest('[data-admgear]');
      if (!gear) return;
      event.preventDefault();
      event.stopPropagation();
      SettingsWindow.open(gear.dataset.admgear);
    });
  }
}
