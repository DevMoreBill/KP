import { CatalogIndex } from '../catalog/catalog-index.js';
import { Suppliers } from '../catalog/suppliers.js';
import { DealConds } from '../deal/deal-conds.js';
import { DealTerms } from '../deal/deal-terms.js';
import { FEAT } from '../../core/features.js';
import { Str } from '../../core/str.js';
import { S } from '../../core/state.js';
import { FormView } from '../../ui/form-view.js';

/**
 * Срок поставки позиции из каталога: свой у позиции («Срок поставки» в карточке) или по поставщику (срок изготовления и
 * доставки из справочника), если её нет в наличии. Подставляется в «Условия» КП, пока поле пустое или в нём прежняя
 * подстановка; расчёт «Экономики сделки» важнее.
 */
export class KpLead {
  static LABEL = 'Срок поставки';

  /**
   * Срок поставки позиции каталога (пусто — в наличии или не известен).
   * @param {object} card
   * @returns {string}
   */
  static of(card) {
    if (!card || CatalogIndex.inStock(card)) return '';
    const own = String(card.lead || '').trim();
    if (own) return own;
    const name = Str.norm(Suppliers.of(card));
    const sup = name && Suppliers.sups.find(row => Str.norm(row.name) === name);
    const days = sup ? (+sup.prod || 0) + (+sup.ship || 0) : 0;
    return days > 0 ? `под заказ, ${DealTerms.daysText(days, 'work')}` : ''; // вид дней у поставщика не задан — рабочие: срок не короче обещанного
  }

  /**
   * Запомнить срок у позиции КП и обновить условие.
   * @param {object} item позиция КП
   * @param {object} card позиция каталога
   * @returns {Promise<void>}
   */
  static async take(item, card) {
    if (!FEAT.on('leadTime')) return;
    const later = !Suppliers.sups.length && !CatalogIndex.inStock(card) && !card.lead;
    if (later) await Suppliers.load([]);
    const lead = this.of(card);
    if (lead) item.supLead = lead;
    else delete item.supLead;
    if (this.sync() && later) FormView.render(); // поставщики догрузились после показа КП
  }

  /**
   * Условие «Срок поставки» по позициям КП: один срок — им, разные — по позициям.
   * @returns {boolean} изменилось
   */
  static sync() {
    if (!FEAT.on('leadTime') || (S.deal && S.deal.touched) || !Array.isArray(S.conditions)) return false;
    const leads = S.items.filter(item => item.supLead);
    const texts = [...new Set(leads.map(item => item.supLead))];
    const value =
      texts.length > 1 ? leads.map(item => `${item.name || 'позиция'} — ${item.supLead}`).join('; ') : texts[0] || '';
    return value ? DealConds.apply(this.LABEL, value) : false;
  }
}
