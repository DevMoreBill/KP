import { AppTabs } from '../core/app-tabs.js';
import { S } from '../core/state.js';
import { FEAT } from '../core/features.js';
import { AdminNav } from '../features/admin/admin-nav.js';
import { SettingsWindow } from '../features/admin/settings-window.js';
import { CatalogWindow } from '../features/catalog/catalog-window.js';
import { Cabinet } from '../features/crm/cabinet.js';
import { DealState } from '../features/deal/deal-state.js';
import { Journal } from '../features/kp/journal.js';
import { AdminState } from '../features/admin/admin-state.js';
import { CabState } from '../features/crm/cab-state.js';

/**
 * После обновления страницы — тот же раздел, где был человек (вкладка, раздел кабинета, вкладка «Настроек»).
 * Помнит только эта вкладка браузера (sessionStorage): новый запуск программы, как и прежде, — с кабинета.
 */
export class SectionMemory {
  static KEY = 'kp.section';
  static AGAIN = ['reload', 'back_forward'];
  static OPEN = {
    cat: () => CatalogWindow.open({}),
    jrn: () => Journal.open(),
    [AppTabs.HOME]: () => AppTabs.open(AppTabs.HOME),
    set: saved => SettingsWindow.open(saved.set),
    deal: () => (S.items.length ? DealState.open() : null),
  };

  /** Запоминать раздел, когда страница уходит (обновление, закрытие). */
  static listen() {
    window.addEventListener('pagehide', () => this._save());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._save();
    });
  }

  static _save() {
    const panel = AdminNav.panel[AdminState.tab];
    const saved = {
      section: AppTabs.active,
      cab: CabState.tab,
      set: panel ? `${AdminState.tab}:${panel}` : AdminState.tab,
    };
    try {
      sessionStorage.setItem(this.KEY, JSON.stringify(saved));
    } catch {
      // без памяти раздела — откроется кабинет
    }
  }

  static _saved() {
    const entry = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    if (!this.AGAIN.includes(entry.type)) return null;
    try {
      return JSON.parse(sessionStorage.getItem(this.KEY) || 'null');
    } catch {
      return null;
    }
  }

  /**
   * Страницу обновили — открыть раздел, где был человек (кабинет к этому времени уже открыт).
   * @returns {boolean} открыт другой раздел, не кабинет
   */
  static restore() {
    const saved = FEAT.on('sectionMemory') ? this._saved() : null;
    if (!saved || !saved.section) return false;
    if (saved.section === 'cab') {
      if (saved.cab && saved.cab !== CabState.tab) Cabinet.open(saved.cab);
      return false;
    }
    const open = this.OPEN[saved.section];
    if (!open) return false;
    open(saved);
    return true;
  }
}
