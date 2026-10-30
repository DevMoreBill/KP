import { CatalogFill } from './catalog-fill.js';
import { Catalog } from './catalog-store.js';
import { DefRegistry } from '../../core/defaults.js';
import { Str } from '../../core/str.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { KpForm } from '../../core/kp-form.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';

/**
 * Быстрый поиск по каталогу («Быстро добавить», мастер, поиск по программе). Строка поиска карточки — одна на карточку и
 * её разбор (карточки каталога на месте не меняются, разбор сбрасывается при смене категорий): без запоминания каждое
 * нажатие клавиши нормализовало текст 7000+ карточек.
 */
export class QuickFind {
  static HAY = new WeakMap();
  static SCROLL_DELAY = 60;
  static SHOWN = 8;
  static SCAN_MIN = 40;
  static SCAN_TIMES = 5;
  static NO_VALUE = 9e9;

  static _hay(card, attrs) {
    const cached = this.HAY.get(card);
    if (cached && cached.attrs === attrs) return cached.hay;
    const hay = Str.norm(
      [
        card.name,
        card.spec,
        attrs.maker,
        attrs.model,
        attrs.series,
        attrs.engine,
        attrs.alternator,
        card.art,
        card.feed && card.feed.sku,
        attrs.article,
      ].join(' '),
    );
    this.HAY.set(card, { attrs, hay });
    return hay;
  }

  static _main(card) {
    const attrs = Attrs.of(card);
    return Str.num(attrs[EquipTypes.byId(attrs.cat).main || 'kw']) ?? this.NO_VALUE;
  }

  /**
   * Карточки каталога по словам запроса (без принадлежностей), по категории и главному параметру.
   * @param {string} query
   * @returns {object[]}
   */
  static matches(query) {
    const words = Str.norm(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    const shown = DefRegistry.num('cat.quickN', this.SHOWN);
    const scan = Math.max(this.SCAN_MIN, this.SCAN_TIMES * shown);
    const found = [];
    for (const card of Catalog.cache) {
      const attrs = Attrs.of(card);
      if (EquipTypes.byId(attrs.cat).role === 'accessory') continue;
      const hay = this._hay(card, attrs);
      if (words.every(word => hay.includes(word))) found.push(card);
      if (found.length >= scan) break;
    }
    return found
      .sort(
        (left, right) =>
          String(Attrs.of(left).cat).localeCompare(Attrs.of(right).cat) || this._main(left) - this._main(right),
      )
      .slice(0, Math.round(shown));
  }

  /**
   * Добавить карточку каталога позицией КП (пустая единственная позиция заменяется).
   * @param {object} card
   */
  static async add(card) {
    const opened = S;
    const full = await Catalog.fullDoc(card);
    if (S !== opened) return;
    const item = KpState.newItem();
    CatalogFill.fill(item, full);
    const blank = S.items.length === 1 && !S.items[0].name.trim() && !S.items[0].price;
    if (blank) S.items = [item];
    else S.items.push(item);
    KpForm.render();
    KpState.persist();
    Toast.show(`Добавлено: ${full.name}`);
    setTimeout(
      () => document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      this.SCROLL_DELAY,
    );
  }
}
