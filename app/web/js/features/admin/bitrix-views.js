import { BitrixCompanies, BitrixContacts, BitrixDeals, BitrixTasks } from './bitrix-objects.js';
import { BitrixEcon } from './bitrix-econ.js';
import { BitrixFields, BitrixLog, BitrixManagers, BitrixOld, BitrixStages } from './bitrix-tabs.js';
import { BitrixFlow, BitrixLink, BitrixSchedule, BitrixSend } from './bitrix-link.js';
import { BitrixGuide } from './bitrix-guide.js';
import { BitrixPanel } from './bitrix-panel.js';
import { BitrixRegs } from './bitrix-regs.js';
import { MirrorPanel } from './mirror-panel.js';

/** Вкладки раздела «Настройки → Битрикс24» по ключу меню (BitrixMenu.TABS) — для панели раздела (BitrixPanel.views). */
export class BitrixViews {
  /**
   * Вкладки: ключ → класс с html() и bind().
   * @returns {object}
   */
  static of() {
    return {
      link: BitrixLink,
      mirror: BitrixMirror,
      flow: BitrixFlow,
      mgr: BitrixManagers,
      cats: BitrixStages,
      fields: BitrixFields,
      regs: BitrixRegs,
      econ: BitrixEcon,
      send: BitrixSend,
      sched: BitrixSchedule,
      log: BitrixLog,
      old: BitrixOld,
      deals: BitrixDeals,
      company: BitrixCompanies,
      contacts: BitrixContacts,
      tasks: BitrixTasks,
      guide: BitrixGuide,
    };
  }
}

/** «Кабинет как в Битрикс24»: воронки, стадии и поля сделки (features/crm/). */
export class BitrixMirror {
  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    return BitrixPanel.state.hasUrl
      ? '<div id="bxMirror"><p class="muted">Загружаю…</p></div>'
      : `<div class="st-card"><p class="muted">${BitrixPanel.NO_URL}</p></div>`;
  }

  /** Подключить панель кабинета. */
  static bind() {
    const box = BitrixPanel.one('#bxMirror');
    if (box) MirrorPanel.open(box);
  }
}
