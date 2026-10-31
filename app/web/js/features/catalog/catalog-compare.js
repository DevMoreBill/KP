import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Modal } from '../../core/modal.js';
import { SpecValues } from '../../core/spec-values.js';
import { esc } from '../../core/util.js';
import { ListPrice } from './list-price.js';

/** Сравнение 2–4 моделей каталога таблицей: параметры их категорий, отличия подсвечены, «В КП» у каждой. */
export class CatalogCompare {
  static MIN = 2;
  static MAX = 4;

  /**
   * Открыть сравнение.
   * @param {object[]} cards позиции каталога (облегчённые — характеристики в атрибутах)
   * @param {(id: string) => void} add добавить в КП
   */
  static open(cards, add) {
    const shown = cards.slice(0, this.MAX);
    const modal = new Modal(this._html(shown), 'cmp-dlg');
    modal.d.addEventListener('click', event => {
      const button = event.target.closest('[data-cmpadd]');
      if (button) {
        add(button.dataset.cmpadd);
        button.disabled = true;
        button.textContent = '✓ В КП';
      } else if (event.target.closest('[data-x]')) modal.close();
    });
  }

  static _html(cards) {
    const head = cards.map(card => `<th scope="col">${esc(card.name)}</th>`).join('');
    const rows = [
      this._row('Цена', cards, card => ListPrice.html(card) || '—', { raw: true }),
      this._row('Наличие', cards, card => (CatalogIndex.inStock(card) ? 'в наличии' : 'под заказ')),
      ...this._fields(cards).map(field =>
        this._row(field.label + (field.unit ? `, ${field.unit}` : ''), cards, card =>
          SpecValues.show(field, CatalogIndex.attrs(card)[field.key]),
        ),
      ),
    ].join('');
    const adds = cards
      .map(card => `<td><button class="btn sm primary" type="button" data-cmpadd="${esc(card.id)}">В КП</button></td>`)
      .join('');
    return `<div class="dlg-h"><h3>Сравнение моделей</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted">Отличия подсвечены. Пустые у всех параметры не показаны.</p>
      <div class="tbl-wrap"><table class="cmp-t"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}<tr><th></th>${adds}</tr></tbody></table></div>`;
  }

  // параметры категорий выбранных позиций, у которых хоть одно значение заполнено
  static _fields(cards) {
    const seen = new Map();
    for (const card of cards) {
      for (const field of EquipTypes.byId(CatalogIndex.attrs(card).cat).fields) {
        if (!seen.has(field.key)) seen.set(field.key, field);
      }
    }
    return [...seen.values()].filter(field => cards.some(card => this._has(CatalogIndex.attrs(card)[field.key])));
  }

  static _has(value) {
    return value != null && value !== '';
  }

  static _row(label, cards, show, { raw = false } = {}) {
    const values = cards.map(show);
    const differ = new Set(values).size > 1;
    const cells = values.map(value => `<td>${raw ? value : esc(value || '—')}</td>`).join('');
    return `<tr${differ ? ' class="cmp-d"' : ''}><th scope="row">${esc(label)}</th>${cells}</tr>`;
  }
}

/** «Похожие в наличии»: та же категория, на складе и с ценой — по близости главного параметра. */
export class CatalogSimilar {
  static SHOWN = 8;

  /**
   * Похожие позиции.
   * @param {object} card
   * @returns {object[]}
   */
  static of(card) {
    const attrs = CatalogIndex.attrs(card);
    const field = EquipTypes.byId(attrs.cat).fields.find(row => row.kpi && parseFloat(attrs[row.key]) > 0);
    const base = field ? parseFloat(attrs[field.key]) : 0;
    const distance = other => {
      const value = field ? parseFloat(CatalogIndex.attrs(other)[field.key]) : 0;
      return base && value > 0 ? Math.abs(Math.log(value / base)) : Number.MAX_VALUE;
    };
    return Catalog.cache
      .filter(
        other =>
          other.id !== card.id &&
          other.price > 0 &&
          CatalogIndex.inStock(other) &&
          CatalogIndex.attrs(other).cat === attrs.cat,
      )
      .sort((one, two) => distance(one) - distance(two))
      .slice(0, this.SHOWN);
  }

  /**
   * Окно со списком похожих.
   * @param {object} card
   * @param {(id: string) => void} show открыть позицию в каталоге
   */
  static open(card, show) {
    const list = this.of(card);
    const rows = list.length
      ? list
          .map(
            other =>
              `<button class="md-r sim-r" type="button" data-simopen="${esc(other.id)}"><div><b>${esc(other.name)}</b><span class="muted">${ListPrice.html(other)} · в наличии</span></div><span aria-hidden="true">›</span></button>`,
          )
          .join('')
      : '<p class="empty">В этой категории нет позиций в наличии с ценой.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Похожие в наличии</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted">Вместо «${esc(card.name)}»: та же категория, близкие параметры, есть на складе и с ценой.</p><div class="sim-l">${rows}</div>`,
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
}
