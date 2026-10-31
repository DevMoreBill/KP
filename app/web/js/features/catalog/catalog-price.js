import { CatalogSession } from './catalog-session.js';
import { Price } from '../../core/str.js';
import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';

/** Цена в карточке каталога: продажа и закупка с валютами; ручная цена — фид её больше не трогает. */
export class CatalogPrice {
  // закупка из фида по сетке скидок поставщика: «РРЦ − 30 % (Компрессоры с ременным приводом до 75 кВт)»
  static _disc(card) {
    const disc = card.costDisc;
    if (!(disc && disc.pct && card.costSrc === 'feed')) return '';
    return ` Закупка — из фида поставщика: ${card.rrc && card.rrc.price ? 'РРЦ' : 'цена прайса'} − ${String(disc.pct).replace('.', ',')} %${disc.label ? ` (${esc(disc.label)})` : ''}.`;
  }

  static _cur(card, key) {
    const opts = Object.keys(KPGen.CURS)
      .map(
        code =>
          `<option value="${code}"${(card[key] || 'RUB') === code ? ' selected' : ''}>${esc(KPGen.CURS[code].sh)}</option>`,
      )
      .join('');
    return `<select data-ccur="${key}" aria-label="Валюта">${opts}</select>`;
  }

  /**
   * Блок «Цена в каталоге».
   * @param {object} card
   * @returns {string}
   */
  static html(card) {
    const priceText = card._priceText ?? (card.price ? KPGen.money(card.price) : '');
    const costText = card._costText ?? (card.cost ? KPGen.money(card.cost) : '');
    return `<div class="ed-sec"><p class="sub">Цена в каталоге</p><div class="cprice">
      <label class="f"><span>Цена продажи</span><input type="text" inputmode="decimal" class="num" data-cprice="price" value="${esc(priceText)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта</span>${this._cur(card, 'priceCur')}</label>
      <label class="f"><span>Закупка</span><input type="text" inputmode="decimal" class="num" data-cprice="cost" value="${esc(costText)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта закупки</span>${this._cur(card, 'costCur')}</label>
      <label class="f"><span>Срок поставки</span><input type="text" data-clead value="${esc(card.lead || '')}" maxlength="80" placeholder="под заказ 6–8 недель" autocomplete="off"></label></div>
    <p class="muted" style="margin:6px 0 0">Цена подставляется в новые КП. При сохранении КП цена позиции в каталоге обновляется сама. Срок поставки — в «Условия» КП, если позиции нет в наличии (пусто — по поставщику).${this._disc(card)}</p></div>`;
  }

  static _input(field) {
    const card = S.items[0];
    const key = field.dataset.cprice;
    const value = Price.parse(field.value);
    card[`_${key}Text`] = field.value;
    card[key] = Number.isNaN(value) ? 0 : value;
    card[`${key}Src`] = 'manual';
    field.classList.toggle('bad', Number.isNaN(value));
  }

  static _blur(field) {
    const card = S.items[0];
    const value = Price.parse(field.value);
    if (Number.isNaN(value)) return;
    delete card[`_${field.dataset.cprice}Text`];
    field.value = value ? KPGen.money(value) : '';
  }

  /** Ввод цены и валюты. */
  static listen() {
    document.addEventListener('input', event => {
      if (event.target.dataset.cprice != null && CatalogSession.current) this._input(event.target);
      if (event.target.dataset.clead != null && CatalogSession.current) S.items[0].lead = event.target.value;
    });
    document.addEventListener('focusout', event => {
      if (event.target.dataset.cprice != null && CatalogSession.current) this._blur(event.target);
    });
    document.addEventListener('change', event => {
      const field = event.target;
      if (field.dataset.ccur != null && CatalogSession.current) S.items[0][field.dataset.ccur] = field.value;
    });
  }
}
