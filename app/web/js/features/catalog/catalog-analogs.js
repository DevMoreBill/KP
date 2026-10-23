import { CatalogCard } from './catalog-card.js';
import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { DefRegistry } from '../../core/defaults.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Modal } from '../../core/modal.js';
import { Str } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * «Аналоги других производителей»: та же категория, другой производитель, главные параметры категории (мощность, давление,
 * производительность…) отличаются не больше чем на cat.analogPct %; с ценой и наличием, ближайшие — первыми.
 */
export class CatalogAnalogs {
  static PCT = 15;
  static KEYS = 3;
  static SHOWN = 8;
  static PERCENT = 100;
  static DEFAULTS = [
    [],
    [
      [
        'cat.analogPct',
        'catsearch',
        'Аналоги: параметры отличаются не больше',
        'num',
        String(CatalogAnalogs.PCT),
        {
          unit: '%',
          req: true,
          min: 1,
          max: 100,
          hint: 'Карточка позиции → «Аналоги»: позиции той же категории других производителей, у которых главные параметры (мощность, давление, производительность…) отличаются не больше чем на это число. Пример: 15 — к компрессору 37 кВт подходят 31,5–42,5 кВт.',
        },
      ],
    ],
  ];

  /**
   * Главные параметры позиции, заданные числом: [{key, value}].
   * @param {object} card
   * @returns {{key: string, value: number}[]}
   */
  static keys(card) {
    const attrs = CatalogIndex.attrs(card);
    return EquipTypes.byId(attrs.cat)
      .fields.filter(field => field.kpi)
      .map(field => ({ key: field.key, value: Str.num(attrs[field.key]) ?? NaN }))
      .filter(row => row.value > 0)
      .slice(0, this.KEYS);
  }

  /**
   * Аналоги позиции, ближайшие первыми.
   * @param {object} card
   * @returns {object[]}
   */
  static of(card) {
    const own = this.keys(card);
    const attrs = CatalogIndex.attrs(card);
    const maker = Str.norm(attrs.maker);
    if (!own.length || !maker) return [];
    const limit = DefRegistry.num('cat.analogPct', this.PCT) / this.PERCENT;
    return Catalog.cache
      .filter(other => other.id !== card.id && CatalogIndex.attrs(other).cat === attrs.cat)
      .filter(other => Str.norm(CatalogIndex.attrs(other).maker) && Str.norm(CatalogIndex.attrs(other).maker) !== maker)
      .map(other => ({ other, gap: this._gap(own, other, limit) }))
      .filter(row => row.gap != null)
      .sort((one, two) => this._rank(one) - this._rank(two))
      .slice(0, this.SHOWN)
      .map(row => row.other);
  }

  // наибольшее относительное отличие главных параметров (null — какой-то параметр не задан или отличается сильнее)
  static _gap(own, other, limit) {
    const attrs = CatalogIndex.attrs(other);
    let gap = 0;
    for (const { key, value } of own) {
      const theirs = Str.num(attrs[key]) ?? NaN;
      if (!(theirs > 0)) return null;
      const diff = Math.abs(theirs - value) / value;
      if (diff > limit) return null;
      gap = Math.max(gap, diff);
    }
    return gap;
  }

  // в наличии и с ценой — выше, затем ближе по параметрам
  static _rank({ other, gap }) {
    return (CatalogIndex.inStock(other) ? 0 : 2) + (other.price > 0 ? 0 : 1) + gap;
  }

  /**
   * Окно аналогов.
   * @param {object} card
   * @param {(id: string) => void} show открыть позицию в каталоге
   */
  static open(card, show) {
    const list = this.of(card);
    const rows = list.length
      ? list.map(other => this._row(other)).join('')
      : '<p class="empty">Аналогов других производителей с такими параметрами в каталоге нет.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Аналоги других производителей</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted">К «${esc(card.name)}»: та же категория, главные параметры отличаются не больше чем на ${DefRegistry.num('cat.analogPct', this.PCT)} %.</p><div class="sim-l">${rows}</div>`,
      'sim-dlg',
    );
    modal.d.addEventListener('click', event => {
      const open = event.target.closest('[data-simopen]');
      if (open) {
        modal.close();
        show(open.dataset.simopen);
      } else if (event.target.closest('[data-x]')) modal.close();
    });
  }

  static _row(other) {
    const maker = CatalogIndex.attrs(other).maker || '';
    const stock = CatalogIndex.inStock(other) ? 'в наличии' : 'под заказ';
    return `<button class="md-r sim-r" type="button" data-simopen="${esc(other.id)}"><div><b>${esc(other.name)}</b><span class="muted">${esc(maker)} · ${CatalogCard.priceHtml(other)} · ${stock}</span></div><span aria-hidden="true">›</span></button>`;
  }
}
