import { AdminState } from './admin-core.js';

/** Права вошедшего администратора (сервер — admin_rights.py): какие вкладки «Настроек» видны и что только для просмотра. */
export class AdminRightsView {
  static ALWAYS = ['home', 'users']; // главная и «Мой пароль» — у всех
  static RANK = { none: 0, view: 1, edit: 2 };

  /**
   * Права из ответа /api/admin/status (нет — как у главного: старый сервер).
   * @returns {{main: boolean, sections: object, actions: string[]}}
   */
  static current() {
    return (AdminState.status && AdminState.status.rights) || { main: true, sections: {}, actions: [] };
  }

  /**
   * Главный администратор.
   * @returns {boolean}
   */
  static main() {
    return this.current().main !== false;
  }

  /**
   * Уровень вкладки или панели: none, view, edit.
   * @param {object} tab вкладка меню (с panels — по лучшей панели)
   * @returns {string}
   */
  static level(tab) {
    if (this.main() || this.ALWAYS.includes(tab.key)) return 'edit';
    if (tab.panels) {
      return tab.panels
        .map(panel => this.level(panel))
        .reduce((best, level) => (this.RANK[level] > this.RANK[best] ? level : best), 'none');
    }
    return this.current().sections[tab.key] || 'none';
  }

  /**
   * Вкладка, какой её видит администратор: без недоступных панелей; у не главного «Администраторы» — только свой пароль.
   * @param {object} tab
   * @returns {object|null} null — вкладка не видна
   */
  static visible(tab) {
    if (this.level(tab) === 'none') return null;
    if (tab.panels) return { ...tab, panels: tab.panels.filter(panel => this.level(panel) !== 'none') };
    if (tab.key === 'users' && !this.main()) return { ...tab, parts: tab.parts.filter(([title]) => title) };
    return tab;
  }

  /**
   * Разделы меню с видимыми вкладками (пустые — без раздела).
   * @param {object[]} groups
   * @returns {object[]}
   */
  static groups(groups) {
    return groups
      .map(group => ({ ...group, tabs: group.tabs.map(tab => this.visible(tab)).filter(Boolean) }))
      .filter(group => group.tabs.length);
  }
}
