import { CrmFunnel } from './crm-funnel.js';
import { ShortName } from '../kp/journal-row.js';
import { esc, today } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';

/** Этапы своей воронки программы — «Настройки → Списки и тексты → Этапы сделки» (crm.stages); у сервера — тот же список. */
export class CrmStages {
  static LIST = [
    { id: 'lead', name: 'Запрос' },
    { id: 'sent', name: 'КП отправлено' },
    { id: 'talks', name: 'Переговоры' },
    { id: 'contract', name: 'Договор и оплата' },
    { id: 'delivery', name: 'Поставка' },
    { id: 'won', name: 'Выиграно' },
    { id: 'lost', name: 'Проиграно' },
  ];
  static LISTS = ['crm.stages'];
}

/** Данные кабинета: ответ /api/crm/board и чей кабинет открыт. */
export class CrmData {
  static board = null;
  static who = '';
  static seq = 0;
  static KINDS = { call: '☎', meet: '👥', mail: '✉', task: '✓' };
  static KIND_LIST = [
    { key: 'call', label: 'Звонок' },
    { key: 'meet', label: 'Встреча' },
    { key: 'mail', label: 'Письмо' },
    { key: 'task', label: 'Задача' },
  ];

  /**
   * Загрузить кабинет (ответ на устаревший запрос не применяется).
   * @returns {Promise<object>}
   */
  static async load() {
    const mine = ++this.seq;
    const board = await Api.request(`/api/crm/board?manager=${encodeURIComponent(this.who)}`);
    if (mine === this.seq) this.board = board;
    return this.board;
  }

  /**
   * Включён регламент оформления сделки Битрикс24 (источник заявки при создании, окно «Заполните» перед стадией).
   * @returns {boolean}
   */
  static regs() {
    return !!(this.board && this.board.regs);
  }

  /**
   * Все сделки ответа.
   * @returns {object[]}
   */
  static deals() {
    return (this.board && this.board.deals) || [];
  }

  /**
   * Стадии открытой на доске воронки.
   * @param {{open?: boolean}} [opts] open — только незакрытые
   * @returns {object[]}
   */
  static stages({ open = false } = {}) {
    return CrmFunnel.columns(this.funnel()).filter(stage => !open || !stage.closed);
  }

  /**
   * Открытая на доске воронка.
   * @returns {string}
   */
  static funnel() {
    return CrmFunnel.current(this.deals());
  }

  /**
   * Сделка в открытой воронке.
   * @param {object} deal
   * @returns {boolean}
   */
  static inFunnel(deal) {
    return (deal.funnel || CrmFunnel.MAIN) === this.funnel();
  }

  /**
   * Сделка закрыта.
   * @param {object} deal
   * @returns {boolean}
   */
  static closed(deal) {
    return CrmFunnel.closed(deal);
  }

  /**
   * Незакрытые сделки всех воронок.
   * @returns {object[]}
   */
  static openDeals() {
    return this.deals().filter(deal => !this.closed(deal) && !this.paused(deal));
  }

  /**
   * Договор по сделке ожидается не позже месяца month («ГГГГ-ММ»); без ожидаемой даты — нет (не в прогнозе месяца).
   * @param {object} deal
   * @param {string} month
   * @returns {boolean}
   */
  static expectedBy(deal, month) {
    return !!deal.expected && String(deal.expected).slice(0, 7) <= month;
  }

  /**
   * Сделка отложена (до даты позже сегодняшней).
   * @param {object} deal
   * @returns {boolean}
   */
  static paused(deal) {
    return FEAT.on('dealPause') && !!deal.pausedUntil && deal.pausedUntil > today();
  }

  /**
   * Сделка по id.
   * @param {string} id
   * @returns {object|undefined}
   */
  static deal(id) {
    return this.deals().find(deal => deal.id === id);
  }

  /**
   * Открыт свой кабинет.
   * @returns {boolean}
   */
  static mine() {
    return !this.who || (this.board && this.who === this.board.me);
  }

  /**
   * Открыт весь отдел.
   * @returns {boolean}
   */
  static all() {
    return this.who === 'all';
  }

  /**
   * Цвет сделки (классы t-*).
   * @param {object} deal
   * @returns {string}
   */
  static toneOf(deal) {
    return CrmFunnel.toneOf(deal);
  }

  /**
   * Название вида дела.
   * @param {string} key
   * @returns {string}
   */
  static kind(key) {
    return this.kinds().find(row => row.key === key)?.label || key;
  }

  /**
   * Виды дел (ответ сервера; карточка сделки, открытая не из кабинета, — встроенный список).
   * @returns {object[]}
   */
  static kinds() {
    return (this.board && this.board.kinds) || this.KIND_LIST;
  }

  /**
   * Значок вида дела.
   * @param {string} key
   * @returns {string}
   */
  static icon(key) {
    return `<span class="tk-i tk-${esc(key)}" aria-hidden="true">${this.KINDS[key] || '•'}</span>`;
  }

  /**
   * Все дела ответа.
   * @returns {object[]}
   */
  static tasks() {
    return (this.board && this.board.tasks) || [];
  }

  /**
   * Открытые дела.
   * @returns {object[]}
   */
  static openTasks() {
    return this.tasks().filter(task => task.state === 'open');
  }

  /**
   * Менеджеры (руководителю).
   * @returns {object[]}
   */
  static managers() {
    return (this.board && this.board.managers) || [];
  }

  /**
   * «Иванова А. С.» — ответственный сделки.
   * @param {object} deal
   * @returns {string}
   */
  static mgrShort(deal) {
    return ShortName.of(deal.manager || this.managers().find(mgr => mgr.id === deal.managerId)?.name || '');
  }
}
