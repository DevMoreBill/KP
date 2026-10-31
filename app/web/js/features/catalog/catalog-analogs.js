import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { DefRegistry } from '../../core/defaults.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Modal } from '../../core/modal.js';
import { Str } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { ListPrice } from './list-price.js';

/**
 * «Аналоги других производителей»: та же категория, другой производитель, главные параметры категории (мощность, давление,
 * производительность…) отличаются не больше чем на cat.analogPct %; с ценой и наличием, ближайшие — первыми.
 */
export class CatalogAnalogs {
  static PCT = 15;
  static POINTS = 0.5;
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
          hint: 'Карточка позиции → «Аналоги»: позиции той же категории других производителей, у которых главные параметры (мощность, давление, производительность…) отличаются не больше чем на это число. Пример: 15 — к компрессору 37 кВт подходят 31,45–42,55 кВт. Параметры в процентах (чистота газа) сравниваются отдельно — по следующему значению.',
        },
      ],
      [
        'cat.analogPp',
        'catsearch',
        'Аналоги: параметры в процентах (чистота газа) отличаются не больше',
        'num',
        String(CatalogAnalogs.POINTS),
        {
          unit: 'п. п.',
          req: true,
          min: 0,
          max: 10,
          hint: 'Чистота азота или кислорода и другие параметры в процентах сравниваются разницей, а не долей: 95 % и 99,99 % — не аналоги. Пример: 0,5 — к генератору 99,5 % подходят 99–100 %.',
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
      .map(field => ({ key: field.key, value: Str.num(attrs[field.key]) ?? NaN, share: field.unit === '%' }))
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
    const limit = {
      rel: DefRegistry.num('cat.analogPct', this.PCT) / this.PERCENT,
      pp: DefRegistry.num('cat.analogPp', this.POINTS),
    };
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
    for (const { key, value, share } of own) {
      const theirs = Str.num(attrs[key]) ?? NaN;
      if (!(theirs > 0)) return null;
      const diff = share ? Math.abs(theirs - value) / this.PERCENT : Math.abs(theirs - value) / value;
      if (share ? Math.abs(theirs - value) > limit.pp : diff > limit.rel) return null;
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
    return `<button class="md-r sim-r" type="button" data-simopen="${esc(other.id)}"><div><b>${esc(other.name)}</b><span class="muted">${esc(maker)} · ${ListPrice.html(other)} · ${stock}</span></div><span aria-hidden="true">›</span></button>`;
  }
}
