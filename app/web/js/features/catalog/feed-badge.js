import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';
import { Currency } from '../kp/currency.js';
import { Str } from '../../core/str.js';
/** РРЦ и наличие у поставщика (позиции из товарного фида, feeds.py): значки в списке и карточке каталога. */
export class FeedBadge {
  static _qtyText(stock) {
    const num = value => Str.comma(value);
    if (stock.qty > 0)
      return `в наличии ${num(stock.qty)} шт.${stock.transit ? ` + ${num(stock.transit)} в пути` : ''}`;
    if (stock.transit) return `в пути ${num(stock.transit)} шт.${stock.eta ? ` (${stock.eta})` : ''}`;
    if (stock.prod) return `в производстве ${num(stock.prod)} шт.`;
    return stock.available || stock.order ? 'под заказ' : 'нет в наличии';
  }

  /**
   * Наличие одной строкой.
   * @param {object} stock
   * @returns {string}
   */
  static stockText(stock) {
    if (!stock) return '';
    if (stock.gone) return 'нет в фиде';
    if (stock.qty != null) return this._qtyText(stock);
    return stock.available ? 'в наличии' : 'нет в наличии';
  }

  /**
   * Подробности остатков: склады, в пути / в производстве, ожидаемая дата, акция — для подсказки.
   * @param {object} stock
   * @returns {string}
   */
  static stockTip(stock) {
    if (!stock) return '';
    const out = [];
    const num = value => Str.comma(value);
    (stock.wh || []).forEach(([store, qty]) => out.push(`${store}: ${num(qty)} шт.`));
    if (stock.transit) out.push(`в пути: ${num(stock.transit)} шт.${stock.eta ? ` — ожидается ${stock.eta}` : ''}`);
    if (stock.prod) {
      out.push(
        `в производстве: ${num(stock.prod)} шт.${stock.eta && !stock.transit ? ` — ожидается ${stock.eta}` : ''}`,
      );
    }
    if (stock.promo) out.push(`акция: ${stock.promo}`);
    return out.join('; ');
  }

  static _arrow(rrc) {
    if (!rrc.prev) return '';
    if (rrc.price > rrc.prev) return ' <i class="up">▲</i>';
    return rrc.price < rrc.prev ? ' <i class="dn">▼</i>' : '';
  }

  static _rrc(rrc) {
    if (!rrc) return '';
    const cur = Currency.short(rrc.cur || 'RUB');
    const prev = rrc.prev
      ? `; прежняя ${KPGen.money(rrc.prev)} ${cur}${rrc.prevAt ? ` (${esc(rrc.prevAt)})` : ''}`
      : '';
    const title = `Рекомендованная розничная цена поставщика${rrc.at ? ` на ${esc(rrc.at)}` : ''}${prev}`;
    return `<span class="fd-rrc" title="${title}">РРЦ ${KPGen.money(rrc.price)} ${cur}${this._arrow(rrc)}</span>`;
  }

  static _state(stock) {
    const ok = !stock.gone && (stock.qty != null ? stock.qty > 0 : stock.available);
    if (ok) return 'ok';
    if (stock.gone) return 'gone';
    return stock.transit || stock.prod ? 'wait' : 'no';
  }

  static _stock(stock) {
    if (!stock) return '';
    const tip = this.stockTip(stock);
    const title = `Наличие у поставщика${stock.at ? ` на ${esc(stock.at)}` : ''}${tip ? `: ${esc(tip)}` : ''}`;
    return `<span class="fd-st ${this._state(stock)}" title="${title}">${esc(this.stockText(stock))}</span>`;
  }

  static _promo(stock) {
    return stock && stock.promo && !stock.gone ? `<span class="fd-promo" title="${esc(stock.promo)}">акция</span>` : '';
  }

  /**
   * Значки РРЦ, наличия и акции.
   * @param {object} card
   * @returns {string}
   */
  static html(card) {
    const { rrc, stock } = card;
    if ((!rrc && !stock) || !FEAT.on('feedInfo')) return '';
    return `<span class="fd-b">${this._rrc(rrc)}${this._stock(stock)}${this._promo(stock)}</span>`;
  }
}
