import { DefRegistry } from '../../core/defaults.js';
import { FEAT } from '../../core/features.js';

/**
 * Возраст цены позиции каталога: дата — когда цена последний раз менялась (priceAt, ставит сервер) или подтверждена фидом
 * (rrc.at у цены по РРЦ); старше cat.priceDays дней — «цена устарела» (фильтр каталога и предупреждение при добавлении в КП).
 */
export class PriceAge {
  static DAYS = 90;
  static DAY_MS = 86400000;
  static DEFAULTS = [
    [],
    [
      [
        'cat.priceDays',
        'catsearch',
        'Цена устарела — старше',
        'num',
        String(PriceAge.DAYS),
        {
          unit: 'дней',
          req: true,
          min: 1,
          max: 3650,
          hint: 'Цена позиции, которая не менялась и не подтверждалась фидом дольше этого срока, отмечается «цена устарела»: фильтр «Цена устарела» в каталоге и предупреждение при добавлении в КП. Пример: 90 — цена от 1 июля устареет 30 сентября.',
        },
      ],
    ],
  ];

  /**
   * Сколько дней цене (null — цены или даты нет).
   * @param {object} card
   * @param {number} [now] время отсчёта, мс
   * @returns {number|null}
   */
  static days(card, now = Date.now()) {
    if (!card || !(card.price > 0)) return null;
    const time = Math.max(...this._dates(card).map(text => Date.parse(text) || 0));
    return time > 0 ? Math.floor((now - time) / this.DAY_MS) : null;
  }

  static _dates(card) {
    const fromFeed = (card.priceSrc || 'rrc') === 'rrc' && card.rrc && card.rrc.at;
    const own = card.priceAt || card.updatedAt;
    return [own, fromFeed].filter(Boolean);
  }

  /**
   * Цена устарела (функция выключена — никогда).
   * @param {object} card
   * @returns {boolean}
   */
  static stale(card) {
    if (!FEAT.on('priceAge')) return false;
    const days = this.days(card);
    return days != null && days > DefRegistry.num('cat.priceDays', this.DAYS);
  }

  /**
   * Подпись «цена N дн. не обновлялась» или пусто.
   * @param {object} card
   * @returns {string}
   */
  static note(card) {
    return this.stale(card) ? `цена не обновлялась ${this.days(card)} дн.` : '';
  }
}
