import { HelpWindow } from '../features/kp/help-window.js';

/** Щелчок по «?» окна (HelpLink) — руководство на разделе этого окна. */
export class HelpLinkClicks {
  /** Обработчик страницы. */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-helpsec]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      HelpWindow.open(button.dataset.helpsec);
    });
  }
}
