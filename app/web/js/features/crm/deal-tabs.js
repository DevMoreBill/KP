import { CrmFunnel } from './crm-funnel.js';
import { DealExec } from './deal-exec.js';
import { esc } from '../../core/util.js';
import { PhoneLayout } from '../../core/phone-layout.js';

/**
 * Вкладки карточки сделки слева: «Сделка · Поля Битрикс24 · Документы · Исполнение»; на телефоне — ещё «Дела» (лента).
 * Выбранная вкладка помнится в браузере; «Исполнение» — со стадии договора (или когда договор уже отмечен).
 */
export class DealTabs {
  static KEY = 'kp.dk.tab';
  static current = '';
  // стадия, с которой сделка — уже про договор и исполнение
  static EXEC_FROM = /договор|сч[её]т|оплат|поставк|отгруз|исполн|(?:^|\D)[6-9]\d\s*%/i;

  /**
   * Вкладки и открытая панель.
   * @param {Record<string, {title: string, badge?: string, tone?: string, body: () => string}>} panels
   * @returns {string}
   */
  static html(panels) {
    const keys = Object.keys(panels);
    const active = keys.includes(this._chosen()) ? this._chosen() : keys[0];
    const tabs = keys
      .map(key => {
        const panel = panels[key];
        const picked = key === active;
        const badge = panel.badge
          ? ` <span class="dk-tb${panel.tone ? ` ${panel.tone}` : ''}">${esc(panel.badge)}</span>`
          : '';
        return `<button type="button" role="tab" id="dkt-${key}" aria-selected="${picked}" aria-controls="dkp-${key}" class="dk-tab${picked ? ' on' : ''}" data-dktab="${key}">${esc(panel.title)}${badge}</button>`;
      })
      .join('');
    return `<div class="dk-tabs" role="tablist" aria-label="Разделы сделки">${tabs}</div>
      <div class="dk-panel" role="tabpanel" id="dkp-${active}" aria-labelledby="dkt-${active}" data-dkpart="${active}">${panels[active].body()}</div>`;
  }

  /**
   * Открыть вкладку (по нажатию или по кнопке «Что сделать сейчас»).
   * @param {string} key
   */
  static show(key) {
    this.current = key;
    try {
      localStorage.setItem(this.KEY, key);
    } catch {
      // выбор просто не запомнится
    }
  }

  /**
   * На телефоне дела и лента — отдельной вкладкой, а не колонкой справа.
   * @returns {boolean}
   */
  static feedTab() {
    return PhoneLayout.active();
  }

  /**
   * Показывать ли «Исполнение»: договор отмечен или сделка на стадии договора и дальше.
   * @param {object} deal
   * @returns {boolean}
   */
  static execShown(deal) {
    if (!DealExec.has(deal)) return false;
    if ((deal.exec || {}).signed || deal.stage === 'won') return true;
    const open = CrmFunnel.columns(deal.funnel).filter(stage => !stage.closed);
    const from = open.findIndex(stage => this.EXEC_FROM.test(stage.label || ''));
    const now = open.findIndex(stage => stage.key === deal.stage);
    return from >= 0 && now >= from;
  }

  static _chosen() {
    if (this.current) return this.current;
    try {
      this.current = localStorage.getItem(this.KEY) || 'deal';
    } catch {
      this.current = 'deal';
    }
    return this.current;
  }
}
