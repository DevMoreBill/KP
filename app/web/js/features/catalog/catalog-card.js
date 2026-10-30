import { SafeLink } from '../../core/safe-link.js';
import { CardRules } from './card-rules.js';
import { FEAT } from '../../core/features.js';
import { CatalogAnalogs } from './catalog-analogs.js';
import { PriceAge } from './price-age.js';
import { CatalogIndex } from './catalog-index.js';
import { FeedBadge } from './feed-badge.js';
import { Attrs } from '../../core/item-attrs.js';
import { Auth } from '../kp/auth.js';
import { esc } from '../../core/util.js';
import { EquipTypes } from '../../core/equip-types.js';
import { SpecValues } from '../../core/spec-values.js';
import { Currency } from '../kp/currency.js';

/** Строка списка и карточка-предпросмотр окна каталога. */
export class CatalogCard {
  static TAGS = 3;
  static HISTORY = 5;
  static EMPTY = `<div class="cw-pv0"><b>Карточка позиции</b><p>Нажмите на позицию в списке — здесь появятся фото, параметры, описание, характеристики и история цен.</p>
        <p>Двойной щелчок — карточка крупно, на месте списка. Изменить позицию — кнопка «Редактировать» в карточке.</p><p>Отметьте галочками несколько позиций, чтобы добавить их в КП сразу, перенести в другую категорию или удалить.</p></div>`;

  /**
   * Ссылка из данных — только на сайт (http/https), не javascript: и не file:.
   * @param {string} url
   * @returns {boolean}
   */
  static webUrl(url) {
    return SafeLink.web(url);
  }

  /**
   * Цена в списке: цена, иначе закупка, иначе «без цены».
   * @param {object} card
   * @returns {string}
   */
  static priceHtml(card) {
    if (card.price) return `${KPGen.money(card.price)} ${Currency.short(card.priceCur || 'RUB')}`;
    if (card.cost) return `<small>закупка</small>${KPGen.money(card.cost)} ${Currency.short(card.costCur || 'RUB')}`;
    return '<small>без цены</small>';
  }

  static _facetTag(field, attrs) {
    if (String(attrs[field.key]) === 'Да') return field.label;
    if (field.key === 'engine' && attrs.engineModel) return `${attrs[field.key]} ${attrs.engineModel}`;
    return SpecValues.show(field, attrs[field.key]);
  }

  /**
   * Ключевые параметры и метки позиции.
   * @param {object} win
   * @param {object} card
   * @returns {string}
   */
  static tags(win, card) {
    const attrs = CatalogIndex.attrs(card);
    const type = EquipTypes.byId(attrs.cat);
    const out = [];
    const kpi = type.fields
      .filter(field => field.kpi && attrs[field.key] != null && attrs[field.key] !== '')
      .slice(0, this.TAGS)
      .map(field => SpecValues.show(field, attrs[field.key]));
    if (kpi.length) out.push(`<span class="tag kwt">${esc(kpi.join(' · '))}</span>`);
    const facets = type.fields
      .filter(field => field.facet && !field.kpi && attrs[field.key] && String(attrs[field.key]) !== 'Нет')
      .slice(0, this.TAGS);
    for (const field of facets) out.push(`<span class="tag">${esc(this._facetTag(field, attrs))}</span>`);
    if (!win.F.cat) out.push(`<span class="tag tt">${esc(type.name)}</span>`);
    return out.length ? `<div class="tags">${out.join('')}</div>` : '';
  }

  static _addTitle(win, inKp) {
    if (!inKp) return '';
    return win.optFor != null ? 'Уже добавлено' : 'Уже в КП — увеличить количество';
  }

  /**
   * Строка списка.
   * @param {object} win
   * @param {object} card
   * @returns {string}
   */
  static row(win, card) {
    const id = card.id;
    const count = card.pricesCount || (card.prices || []).length;
    const inKp = win.inKp(id);
    const sel = win.sel.has(id);
    return `<div class="cw-row${sel ? ' sel' : ''}${win.active === id ? ' act' : ''}" data-id="${esc(id)}" draggable="${win.optFor == null}">
      <label class="ck" title="Отметить (Shift — диапазон)"><input type="checkbox" data-ck ${sel ? 'checked' : ''} aria-label="Отметить"></label>
      ${card.photo ? `<img src="${esc(card.photo.src)}" alt="" loading="lazy">` : '<i class="ph"></i>'}
      <div class="cw-mn"><b>${esc(card.name)}</b>${win.pend.has(id) ? '<span class="modb">На модерации</span>' : ''}${this.tags(win, card)}</div>
      <div class="cw-pr">${this.priceHtml(card)}${FeedBadge.html(card)}${count ? `<small>в КП ${count} ${KPGen.plural(count, 'раз', 'раза', 'раз')}</small>` : ''}</div>
      <button class="btn sm${inKp ? ' in' : ''}" type="button" data-add title="${this._addTitle(win, inKp)}">${win.addLabel(id)}</button></div>`;
  }

  static _kpi(type, attrs) {
    return type.fields
      .filter(field => field.kpi && attrs[field.key] != null && attrs[field.key] !== '')
      .map(
        field =>
          `<div class="pv-k"><b>${esc(SpecValues.show(field, attrs[field.key]))}</b><span>${esc(field.label)}</span></div>`,
      )
      .join('');
  }

  static _params(type, attrs) {
    return [
      ['Производитель', attrs.maker],
      ['Серия', attrs.series],
      ['Модель', attrs.model],
      ...type.fields.filter(field => !field.kpi).map(field => [field.label, SpecValues.show(field, attrs[field.key])]),
    ].filter(([, value]) => value != null && value !== '');
  }

  static _table(rows) {
    return `<table class="pv-t">${rows.map(([key, value]) => `<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('')}</table>`;
  }

  static _head(win, card, attrs) {
    const photo = card.photo
      ? `<img src="${esc(card.photo.src)}" alt="" title="${esc(card.name || '')}">`
      : '<span>нет фото</span>';
    const from =
      card.photoFrom && card.photo
        ? `<p class="muted pv-pf">Фото — от похожей модели того же производителя («${esc(card.photoFrom.name || '')}»). Своё фото — «Редактировать» → «Описание и фото».</p>`
        : '';
    const cat =
      win.optFor == null
        ? `<label class="pv-cat"><span>Категория</span><select data-pvcat>${EquipTypes.optionsHtml(attrs.cat)}</select></label>`
        : '';
    return `<div class="pv-photo">${photo}</div>
      ${from}${CardRules.note(card)}
      <div class="pv-ttl"><h4>${esc(card.name || 'Без названия')}</h4>${card.logo ? `<img class="pv-logo" src="${esc(card.logo.src)}" alt="">` : ''}</div>${card.spec ? `<p class="muted pv-spec">${esc(card.spec)}</p>` : ''}
      ${cat}`;
  }

  static _cost(card) {
    if (!card.cost) return '';
    const disc =
      card.costDisc && card.costDisc.pct && card.costSrc === 'feed'
        ? ` (−${String(card.costDisc.pct).replace('.', ',')} %)`
        : '';
    return `<span>закупка ${KPGen.money(card.cost)} ${Currency.short(card.costCur || 'RUB')}${disc}</span>`;
  }

  static _feed(card) {
    const feed = card.feed;
    if (!feed) return '';
    const page = this.webUrl(feed.url)
      ? ` · <a href="${esc(feed.url)}" target="_blank" rel="noopener">страница товара</a>`
      : '';
    const how = feed.files
      ? 'Цены и наличие обновляются из прайса и остатков поставщика.'
      : 'РРЦ и наличие проверяются раз в день.';
    return `<p class="muted pv-pf">Из фида поставщика${feed.sku ? ` · артикул ${esc(feed.sku)}` : ''}${page}. ${how}</p>`;
  }

  static _price(card) {
    const price = card.price
      ? `${KPGen.money(card.price)} ${Currency.short(card.priceCur || 'RUB')}`
      : 'Цена не указана';
    const tip = card.stock && !card.stock.gone && FeedBadge.stockTip(card.stock);
    return `<div class="pv-price"><b>${price}</b>${this._cost(card)}${FeedBadge.html(card)}${this._age(card)}</div>
      ${tip ? `<p class="pv-stock">${esc(FeedBadge.stockTip(card.stock))}</p>` : ''}
      ${this._feed(card)}`;
  }

  static _feature(feat) {
    const label = feat.label ? `<b>${esc(feat.label)}.</b>${/^• /.test(feat.text || '') ? '<br>' : ' '}` : '';
    return `<p class="pv-f">${label}${esc(feat.text || '')}</p>`;
  }

  static _group(group, index) {
    const rows = group.rows.filter(row => row.k || row.v);
    const table = rows
      .map(row => `<tr${row.hl ? ' class="hl"' : ''}><td>${esc(row.k)}</td><td>${esc(row.v)}</td></tr>`)
      .join('');
    return `<details class="pv-g"${index === 0 ? ' open' : ''}><summary>${esc(group.name || 'Основные')} <i>${rows.length}</i></summary><table class="pv-t">${table}</table></details>`;
  }

  static _history(card) {
    const hist = (card.prices || []).slice(0, this.HISTORY);
    if (!hist.length) return '';
    const count = card.pricesCount || (card.prices || []).length;
    const rows = hist
      .map(
        price =>
          `<tr><td>${esc(KPGen.ruDate(price.date))}${price.number ? `<br><small>№ ${esc(price.number)}</small>` : ''}</td><td>${esc(price.client || '')}</td><td>${price.price ? `${KPGen.money(price.price)} ${Currency.short(price.cur || 'RUB')}` : ''}</td></tr>`,
      )
      .join('');
    return `<p class="pv-cap">В коммерческих предложениях <i>${esc(count)}</i></p><table class="pv-t pv-h">${rows}</table>`;
  }

  static _texts(card, loading) {
    const feats = (card.features || []).filter(feat => feat.label || feat.text);
    const groups = (card.groups || []).filter(group => (group.rows || []).some(row => row.k || row.v));
    const gallery = (card.gallery || []).filter(pic => pic.src && pic.on !== false);
    const pics = gallery
      .map(pic => `<img src="${esc(pic.src)}" alt="" title="${esc(pic.caption || '')}" loading="lazy">`)
      .join('');
    return `${loading ? '<p class="muted">Загружаю описание и характеристики…</p>' : ''}
      ${feats.length ? `<p class="pv-cap">Описание</p>${feats.map(feat => this._feature(feat)).join('')}` : ''}
      ${groups.length ? `<p class="pv-cap">Характеристики</p>${groups.map((group, index) => this._group(group, index)).join('')}` : ''}
      ${gallery.length ? `<p class="pv-cap">Изображения <i>${gallery.length}</i></p><div class="pv-gal">${pics}</div>` : ''}
      ${this._history(card)}
      ${!loading && !feats.length && !groups.length ? '<p class="muted pv-empty">Описания и характеристик пока нет — нажмите «Редактировать».</p>' : ''}`;
  }

  // нет цены или нет на складе — сразу предложить замену
  static _similar(card) {
    if (card.price > 0 && CatalogIndex.inStock(card)) return '';
    return '<button class="btn ghost" type="button" data-pv="similar" title="Та же категория, близкие параметры, в наличии и с ценой">Похожие в наличии</button>';
  }

  static _age(card) {
    const note = PriceAge.note(card);
    return note ? `<span class="bad-t" title="Уточните цену у поставщика">${esc(note)}</span>` : '';
  }

  static _analogs(card) {
    if (!FEAT.on('analogs')) return '';
    const count = CatalogAnalogs.of(card).length;
    return count
      ? `<button class="btn ghost" type="button" data-pv="analogs" title="Та же категория, другие производители, близкие главные параметры">Аналоги (${count})</button>`
      : '';
  }

  static _acts(win, card) {
    const main = win.optFor == null;
    const dup = main
      ? '<button class="btn ghost" type="button" data-pv="dup" title="Создать копию позиции и открыть её на редактирование">Создать копию</button>'
      : '';
    const trash =
      main && Auth.can('catDelete')
        ? '<button class="btn ghost danger-t" type="button" data-pv="trash" title="Удалить позицию в корзину (восстанавливает администратор)">В корзину</button>'
        : '';
    const wide = win.dlg().classList.contains('pvwide') ? 'Свернуть карточку' : '⤢ Крупно';
    return `<div class="pv-acts"><div class="pv-main"><button class="btn primary" type="button" data-pv="add">${win.addLabelLong(card.id)}</button><button class="btn" type="button" data-pv="edit">Редактировать</button></div>
      <div class="pv-sub">${this._similar(card)}${this._analogs(card)}${dup}${trash}<span class="sp"></span><button class="btn ghost pv-w" type="button" data-pv="wide" title="Карточка крупно, на месте списка (двойной щелчок по позиции). Esc — назад к списку">${wide}</button><button class="btn ghost pv-x" type="button" data-pv="close">Закрыть карточку</button></div></div>`;
  }

  /**
   * Карточка-предпросмотр.
   * @param {object} win
   * @param {object} card
   * @param {{loading: boolean}} state loading — описание ещё загружается
   * @returns {string}
   */
  static html(win, card, { loading }) {
    const attrs = Attrs.of(card);
    const type = EquipTypes.byId(attrs.cat);
    const kpi = this._kpi(type, attrs);
    const params = this._params(type, attrs);
    return `<div class="pv-mtop"><button class="btn pv-back" type="button" data-pv="close"><span aria-hidden="true">‹</span> К списку</button></div>
    <div class="pv-scroll">
      ${this._head(win, card, attrs)}
      ${this._price(card)}
      ${kpi ? `<div class="pv-kpi">${kpi}</div>` : ''}
      ${params.length ? this._table(params) : ''}
      ${this._texts(card, loading)}
    </div>
    ${this._acts(win, card)}`;
  }
}
