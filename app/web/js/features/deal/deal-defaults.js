import { DealUi } from './deal-ui.js';
import { DealValues } from './deal-values.js';
import { Managers } from '../kp/managers.js';
import { AdminSession } from '../../core/net.js';
import { Auth } from '../kp/auth.js';
import { FEAT } from '../../core/features.js';
import { S } from '../../core/state.js';
import { DefRegistry } from '../../core/defaults.js';

/**
 * Последние значения менеджера в этом браузере (стоимость денег, налог, цель; заданное администратором в «Значениях
 * программы» — главнее) и доступ к экономике сделки: автор КП и администратор, новое несохранённое КП — своё.
 */
export class DealDefaults {
  static KEYS = { money: 'money', tax: 'tax', 'target.v': 'target', 'target.type': 'targetType' };
  static STORE = 'kp.dealDef';
  static SPREAD = 3;
  static MONEY_FB = 2;

  /**
   * Надбавка к ключевой ставке ЦБ, п.п. годовых.
   * @returns {number}
   */
  static spread() {
    return DefRegistry.num('deal.spread', DealDefaults.SPREAD);
  }

  /**
   * Последние значения менеджера без тех, что задал администратор.
   * @returns {object}
   */
  static get() {
    let own = {};
    try {
      own = JSON.parse(localStorage.getItem(DealDefaults.STORE) || '{}') || {};
    } catch {
      own = {};
    }
    const set = key => DefRegistry.srv[key] && typeof DefRegistry.srv[key] === 'object';
    if (set('deal.tax')) delete own.tax;
    if (set('deal.spread')) delete own.money;
    if (set('deal.target')) {
      delete own.target;
      delete own.targetType;
    }
    return own;
  }

  /**
   * Запомнить значение поля для следующих расчётов.
   * @param {string} path
   * @param {string} value
   */
  static remember(path, value) {
    const key = DealDefaults.KEYS[path];
    if (!key) return;
    try {
      const own = DealDefaults.get();
      own[key] = value;
      localStorage.setItem(DealDefaults.STORE, JSON.stringify(own));
    } catch {
      // хранилище браузера недоступно — значение не запоминается
    }
  }

  /**
   * Расчёт виден автору КП и администратору.
   * @param {object} [state]
   * @returns {boolean}
   */
  static allowed(state = S) {
    if (!FEAT.on('deal') || !Auth.can('dealView')) return false;
    if (AdminSession.on || !state.kpId) return true;
    const myId = Managers.meId();
    if (!myId) return false;
    return state.authorId ? state.authorId === myId : state.managerId === myId;
  }

  /**
   * Стоимость денег по умолчанию, % в месяц: ключевая ставка ЦБ + надбавка, иначе — запасное значение.
   * @returns {number}
   */
  static moneyAuto() {
    return DealUi.key && DealUi.key.rate > 0
      ? DealMoneyRate.month(DealUi.key.rate + DealDefaults.spread())
      : DealValues.num('deal.moneyFb', DealDefaults.MONEY_FB);
  }
}

/** Стоимость денег в месяц из годовой: × дней в месяце / 365 — тот же месяц, что в расчёте финансирования. */
export class DealMoneyRate {
  static MONTH = 30;
  static YEAR = 365;

  /**
   * Ставка в месяц.
   * @param {number} year % годовых
   * @returns {number}
   */
  static month(year) {
    return (year * DealValues.num('deal.monthDays', DealMoneyRate.MONTH)) / DealMoneyRate.YEAR;
  }

  /**
   * «30 / 365».
   * @returns {string}
   */
  static text() {
    return `${DealValues.num('deal.monthDays', DealMoneyRate.MONTH)} / ${DealMoneyRate.YEAR}`;
  }
}
