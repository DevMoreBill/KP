import { Str } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * Кабинет: открытый раздел, строка поиска и отбор по ней, черновики КП менеджера. Окно кабинета (загрузка, перерисовка,
 * переход в раздел) подключает себя (crm/index.js): разделы кабинета и карточка сделки не подключают окно (циклы import).
 */
export class CabState {
  static tab = 'today';
  static query = '';
  static drafts = [];
  static shell = {
    dlg: () => null,
    reload: async () => {},
    render: () => {},
    renderBody: () => {},
    show: () => {},
  };

  /**
   * Окно кабинета подключает себя.
   * @param {object} shell {dlg, reload, render, renderBody, show}
   */
  static connect(shell) {
    this.shell = { ...this.shell, ...shell };
  }

  /**
   * Поиск: сделка подходит под строку (название, клиент, ИНН, номер, КП).
   * @param {object} deal
   * @param {string} [text]
   * @returns {boolean}
   */
  static match(deal, text = this.query) {
    const wanted = Str.norm(text);
    if (!wanted) return true;
    const words = [deal.title, deal.client, deal.clientInn, `№${deal.number}`, deal.manager];
    return Str.norm([...words, ...(deal.kps || []).map(offer => offer.number)].join(' ')).includes(wanted);
  }

  /**
   * Поле поиска раздела.
   * @param {string} placeholder
   * @returns {string}
   */
  static search(placeholder) {
    return `<input type="search" id="cabQ" class="cab-s" value="${esc(this.query)}" placeholder="${esc(placeholder)}" aria-label="Поиск" autocomplete="off" enterkeyhint="search">`;
  }

  /**
   * Окно кабинета.
   * @returns {HTMLDialogElement}
   */
  static dlg() {
    return this.shell.dlg();
  }

  /**
   * Загрузить данные и перерисовать.
   * @returns {Promise<void>}
   */
  static reload() {
    return this.shell.reload();
  }

  /** Перерисовать шапку и раздел. */
  static render() {
    this.shell.render();
  }

  /** Перерисовать только раздел (поле поиска не теряет набранное). */
  static renderBody() {
    this.shell.renderBody();
  }

  /**
   * Перейти в раздел.
   * @param {string} tab
   */
  static show(tab) {
    this.shell.show(tab);
  }
}
