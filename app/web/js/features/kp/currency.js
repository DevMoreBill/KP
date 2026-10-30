import { CbrRates } from './cbr-rates.js';
import { Price } from '../../core/str.js';
import { DealWin } from '../deal/deal-win.js';
import { FormView } from '../../ui/form-view.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { OptionSale } from './option-sale.js';

/** Валюта КП и курсы: короткое обозначение, курс к рублю, смена валюты с пересчётом цен. */
export class Currency {
  static LIST = ['RUB', 'USD', 'EUR', 'CNY'];

  /**
   * Короткое обозначение валюты («руб.», «$»).
   * @param {string} code
   * @returns {string}
   */
  static short(code) {
    return (KPGen.CURS[code] || KPGen.CURS.RUB).sh;
  }

  /**
   * Валюта текущего КП.
   * @returns {string}
   */
  static current() {
    return S.pricing.cur || 'RUB';
  }

  /**
   * Курс валюты к рублю по курсам КП (NaN — курса нет).
   * @param {string} code
   * @returns {number}
   */
  static rate(code) {
    return code === 'RUB' ? 1 : this.parseRate(S.pricing.rates[code]);
  }

  /**
   * Курс из поля «1 234,56» — единственный разбор курса (КП, экономика КП, отчёт); не число или 0 — NaN.
   * @param {*} raw
   * @returns {number}
   */
  static parseRate(raw) {
    const value = parseFloat(
      String(raw ?? '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
    return value > 0 ? value : NaN;
  }

  /**
   * Смена валюты КП: цены позиций, скидки суммой и опции переводятся по курсу.
   * @param {string} code
   */
  static setKp(code) {
    const prev = this.current();
    if (prev === code) return;
    const from = this.rate(prev);
    const rateTo = this.rate(code);
    OptionSale.pin();
    S.pricing.cur = code;
    OptionSale.syncAll();
    if (from > 0 && rateTo > 0) {
      this._convert(value => Math.round((value * from) / rateTo));
      Toast.show(`Цены переведены в ${code} по курсу`);
    } else Toast.show('Укажите курс, чтобы перевести цены: сейчас цены не пересчитаны');
    FormView.render();
    KpState.persist();
    DealWin.render();
    if (code !== 'RUB' && !(this.rate(code) > 0)) CbrRates.fillEmpty();
  }

  static _convert(convert) {
    S.items.forEach(item => {
      if (item.price) item.price = convert(item.price);
      delete item._priceText;
      // скидка суммой — в той же валюте, что цена
      if (item.disc && item.disc.type === 'sum' && +item.disc.v) item.disc = { ...item.disc, v: convert(+item.disc.v) };
      (item.options || []).forEach(option => {
        if (!option.price || option.saleCur) return; // цена в своей валюте — уже пересчитана (OptionSale)
        option.price = convert(option.price);
        delete option._priceText;
      });
    });
  }
}

/** Скидка для заказчика: x.disc = {type: 'pct'|'sum', v} — процент или копейки за единицу; x.discType — выбранный вид. */
export class Discount {
  static PCT_MAX = 100;
  static PCT_TEXT = /^\d+([.,]\d{0,2})?$/;

  /**
   * Вид скидки позиции.
   * @param {object} item
   * @returns {string} pct | sum
   */
  static type(item) {
    return (item.disc && item.disc.type) || item.discType || 'pct';
  }

  /**
   * Скидка текстом поля.
   * @param {object} item
   * @returns {string}
   */
  static text(item) {
    if (!item.disc || !(+item.disc.v > 0)) return '';
    return item.disc.type === 'sum' ? KPGen.money(item.disc.v) : String(item.disc.v).replace('.', ',');
  }

  /**
   * Разбор введённой скидки.
   * @param {object} item
   * @param {string} text
   * @returns {boolean} false — значение неверное (скидка не применяется)
   */
  static set(item, text) {
    const type = this.type(item);
    const value = String(text || '').replace(/[\s %]/g, '');
    item.discType = type;
    if (!value) {
      delete item.disc;
      return true;
    }
    return type === 'sum' ? this._sum(item, value) : this._percent(item, value, type);
  }

  static _sum(item, value) {
    const kopecks = Price.parse(value);
    if (Number.isNaN(kopecks) || kopecks < 0 || (item.price && kopecks > item.price)) {
      delete item.disc;
      return false;
    }
    if (kopecks) item.disc = { type: 'sum', v: kopecks };
    else delete item.disc;
    return true;
  }

  static _percent(item, value, type) {
    const pct = parseFloat(value.replace(',', '.'));
    if (!this.PCT_TEXT.test(value) || !(pct >= 0 && pct < this.PCT_MAX)) {
      delete item.disc;
      return false;
    }
    if (pct) item.disc = { type, v: pct };
    else delete item.disc;
    return true;
  }
}
