import { Currency } from './currency.js';
import { KpDate } from './kp-date.js';
import { Toast } from '../../core/toast.js';
import { FormView } from '../../ui/form-view.js';
import { Modal } from '../../core/modal.js';
import { FEAT } from '../../core/features.js';
import { CatFind, Catalog } from '../catalog/catalog-store.js';
import { FeedBadge } from '../catalog/feed-badge.js';
import { esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';

/** Подсказка под строкой цены: скидка для заказчика, контроль РРЦ, цена в каталоге, цены в прошлых КП. */
export class PriceHints {
  static RRC_SAME = 0.05;
  static TENTHS = 10;
  static PERCENT = 100;

  /**
   * Подсказка позиции.
   * @param {object} item
   * @returns {string}
   */
  static of(item) {
    const short = Currency.short(Currency.current());
    const discount = KPGen.unitDisc(item);
    const disc = discount
      ? `Скидка ${KPGen.money(discount)} ${short} за ед. · цена для заказчика <b>${KPGen.money((item.price || 0) - discount)} ${short}</b>`
      : '';
    const rrc = this._rrc(item, (item.price || 0) - discount);
    return [disc, rrc, CatPrice.hint(item), PriceHist.hint(item)].filter(Boolean).join('<br>');
  }

  /**
   * Подсказка позиции i — заново (после ввода цены или скидки).
   * @param {number} index
   */
  static live(index) {
    const box = document.querySelector(`[data-minfo="${index}"]`);
    if (box) box.innerHTML = this.of(S.items[index]);
  }

  static _rrcText(card, rrc) {
    return {
      stock: card.stock ? ` · ${esc(FeedBadge.stockText(card.stock))}` : '',
      rrcText: `РРЦ ${KPGen.money(rrc.price)} ${Currency.short(rrc.cur || 'RUB')}`,
    };
  }

  // контроль РРЦ: цена для заказчика против рекомендованной розничной цены поставщика (позиции из товарного фида)
  static _rrc(item, unit) {
    const card = item.catId ? CatFind.id(item.catId) : null;
    const rrc = card && card.rrc;
    if (!rrc || !(rrc.price > 0)) return '';
    const kpRate = Currency.rate(Currency.current());
    const rrcRate = Currency.rate(rrc.cur || 'RUB');
    const { stock, rrcText } = this._rrcText(card, rrc);
    if (!(kpRate > 0) || !(rrcRate > 0) || !(unit > 0)) return `<span class="rrc-h">${rrcText}${stock}</span>`;
    const diff = ((unit * kpRate - rrc.price * rrcRate) / (rrc.price * rrcRate)) * this.PERCENT;
    if (Math.abs(diff) < this.RRC_SAME) return `<span class="rrc-h ok">По РРЦ (${rrcText})${stock}</span>`;
    const pct = String(Math.round(Math.abs(diff) * this.TENTHS) / this.TENTHS).replace('.', ',');
    return diff < 0
      ? `<span class="rrc-h bad" title="Цена для заказчика ниже рекомендованной розничной цены поставщика">Ниже РРЦ на ${pct} % — ${rrcText}${stock}</span>`
      : `<span class="rrc-h">Выше РРЦ на ${pct} % — ${rrcText}${stock}</span>`;
  }
}

/** Цены позиции в прошлых КП: каталог помнит цену модели в каждом сохранённом КП (последние 50). */
export class PriceHist {
  /**
   * Позиция каталога для позиции КП.
   * @param {object} item
   * @returns {object|null}
   */
  static doc(item) {
    return CatFind.id(item.catId) || (item.name ? CatFind.name(item.name) : null);
  }

  static _rows(card) {
    return ((card && card.prices) || []).filter(
      price => price && price.price > 0 && (!S.number || price.number !== S.number),
    );
  }

  static _fmt(price) {
    return `${KPGen.money(price.price)} ${Currency.short(price.cur || 'RUB')}`;
  }

  static _where(last) {
    return `${last.number ? `№ ${esc(last.number)}, ` : ''}${esc(last.client || '')}${last.date ? `, ${esc(KpDate.ddmm(last.date))}` : ''}`;
  }

  /**
   * Строка «В прошлых КП: …» под ценой.
   * @param {object} item
   * @returns {string}
   */
  static hint(item) {
    if (!FEAT.on('priceHist') || !item.name) return '';
    const card = this.doc(item);
    const rows = this._rows(card);
    if (!rows.length) return '';
    const last = rows[0];
    const count = Math.max(rows.length, (card.pricesCount || 0) - ((card.prices || []).length - rows.length));
    const index = S.items.indexOf(item);
    const same = rows.filter(row => (row.cur || 'RUB') === (last.cur || 'RUB')).map(row => row.price);
    const low = Math.min(...same);
    const high = Math.max(...same);
    const range = same.length > 1 && low !== high ? ` · от ${KPGen.money(low)} до ${KPGen.money(high)}` : '';
    const where = this._where(last);
    const more =
      index >= 0
        ? `<button class="lnk" type="button" data-a="priceHist" data-i="${index}">${count > 1 ? `все ${count}` : 'подробнее'}</button>`
        : '';
    return `<span class="ph-h">В прошлых КП: <b>${this._fmt(last)}</b> — ${where}${range}
      ${more}</span>`;
  }

  /**
   * Окно «Цены в прошлых КП» позиции i.
   * @param {number} index
   * @returns {Promise}
   */
  static open(index) {
    return Modal.once('pricehist', () => this._open(index));
  }

  static async _open(index) {
    const item = S.items[index];
    if (!item) return;
    const lite = this.doc(item);
    if (!lite) return;
    const rows = this._rows(await Catalog.fullDoc(lite));
    const short = Currency.short(Currency.current());
    const modal = new Modal(
      `<div class="dlg-h"><h3>Цены в прошлых КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">${esc(item.name)}${item.price ? ` · сейчас <b>${KPGen.money(item.price)} ${short}</b>` : ''}</p>
      <div class="ph-l"><table class="ph-t"><thead><tr><th>Дата</th><th>КП</th><th>Клиент</th><th class="num">Кол-во</th><th class="num">Цена</th><th></th></tr></thead><tbody>
      ${rows.map((row, k) => this._row(row, k)).join('')}</tbody></table></div>`,
      'ph-dlg',
    );
    modal.d.onclick = event => {
      if (event.target.closest('[data-x]')) {
        modal.close();
        return;
      }
      const button = event.target.closest('[data-phu]');
      if (button) this._take(modal, item, rows[+button.dataset.phu]);
    };
  }

  static _row(row, k) {
    const take =
      (row.cur || 'RUB') === Currency.current()
        ? `<button class="btn sm ghost" type="button" data-phu="${k}" title="Поставить эту цену в КП">Взять</button>`
        : '';
    return `<tr><td>${esc(row.date ? KPGen.ruDate(row.date).replace(/ г\.$/, '') : '')}</td><td>${row.number ? `№ ${esc(row.number)}` : '—'}</td><td>${esc(row.client || '')}</td><td class="num">${row.qty || ''}</td><td class="num"><b>${this._fmt(row)}</b></td>
        <td>${take}</td></tr>`;
  }

  static _take(modal, item, row) {
    item.price = row.price;
    item.priceManual = true;
    delete item._priceText;
    modal.close();
    FormView.render();
    KpState.persist();
    Toast.show(`Цена из КП № ${row.number || ''}: ${this._fmt(row)}`);
  }
}

/** Цена позиции и каталог: у позиции КП видно, если в каталоге цена теперь другая, — кнопкой «обновить цену». */
export class CatPrice {
  static EPS = 0.005; // разница меньше 0,5 % — не разница (курс, округление)
  static PERMILLE = 1000;
  static TENTHS = 10;

  /**
   * Цена позиции каталога в валюте КП (копейки) или null — позиции нет, цены нет или нет курса.
   * @param {object} item
   * @returns {number|null}
   */
  static of(item) {
    const card = PriceHist.doc(item);
    if (!card || !(card.price > 0)) return null;
    const cur = card.priceCur || 'RUB';
    const kpCur = Currency.current();
    if (cur === kpCur) return card.price;
    const from = Currency.rate(cur);
    const rateTo = Currency.rate(kpCur);
    return from > 0 && rateTo > 0 ? Math.round((card.price * from) / rateTo) : null;
  }

  /**
   * В каталоге цена другая.
   * @param {object} item
   * @returns {{now: number, cat: number, pct: number}|null}
   */
  static diff(item) {
    const price = this.of(item);
    if (price == null || !(item.price > 0)) return null;
    if (!(Math.abs(price - item.price) / item.price > this.EPS)) return null;
    return {
      now: item.price,
      cat: price,
      pct: Math.round(((price - item.price) / item.price) * this.PERMILLE) / this.TENTHS,
    };
  }

  /**
   * Строка подсказки под ценой позиции (раздел «Цены и валюта»).
   * @param {object} item
   * @returns {string}
   */
  static hint(item) {
    const diff = this.diff(item);
    const index = S.items.indexOf(item);
    if (!diff || index < 0) return '';
    return `<span class="cp-h">В каталоге сейчас <b>${KPGen.money(diff.cat)} ${Currency.short(Currency.current())}</b> (${diff.pct > 0 ? '+' : ''}${String(diff.pct).replace('.', ',')} %)
      <button class="lnk" type="button" data-a="catPrice" data-i="${index}">обновить цену</button></span>`;
  }

  /**
   * Подставить цену каталога в позицию i.
   * @param {number} index
   */
  static apply(index) {
    const item = S.items[index];
    const diff = item && this.diff(item);
    if (!diff) return;
    item.price = diff.cat;
    delete item._priceText;
    item.priceManual = false;
    FormView.render();
    KpState.persist();
    Toast.show(`Цена «${item.name}» — как в каталоге: ${KPGen.money(diff.cat)} ${Currency.short(Currency.current())}`);
  }
}
