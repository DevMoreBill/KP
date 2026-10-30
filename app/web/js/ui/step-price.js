import { PriceHints } from '../features/kp/price-hints.js';
import { esc } from '../core/util.js';
import { Price } from '../core/str.js';
import { DealDefaults } from '../features/deal/deal-defaults.js';
import { PricingBlock } from '../features/kp/cbr-rates.js';
import { KpState, S } from '../core/state.js';
import { Currency, Discount } from '../features/kp/currency.js';
import { OptionSale } from '../features/kp/option-sale.js';
import { UiKit } from '../core/ui-kit.js';

/**
 * Раздел 3 «Цены и валюта»: цены продажи вводятся вручную, одна строка на позицию; скидка попадает в КП. Закупка,
 * логистика, таможня и подбор цены под маржу — в окне «Экономика сделки».
 */
export class PriceStep {
  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    const currency = Currency.short(Currency.current());
    const rows = S.items.map((item, i) => this._row(item, i, currency) + this._options(item, i)).join('');
    const table = rows
      ? `<div class="ptable"><div class="phead" aria-hidden="true"><span>№</span><span>Позиция</span><span>Цена за ед. с НДС, ${currency}</span><span>Скидка</span><span>Сумма, ${currency}</span></div>${rows}</div>`
      : `<div class="empty-pick"><p><b>Сначала добавьте оборудование</b></p><button class="btn primary" type="button" data-step="equip">Перейти к оборудованию</button></div>`;
    return `<section class="step" id="st-price"><h2><span class="n">3</span>Цены и валюта${UiKit.tip('<p>Цена продажи за единицу с НДС — вручную. Скидка попадает в КП.</p><p>Закупку и расчёт цены под маржу ведите в «Экономике сделки» — оттуда цены переносятся сюда одной кнопкой.</p>')}</h2>
  ${PricingBlock.html()}
  ${this._deal()}
  ${table}
  </section>`;
  }

  static _deal() {
    if (!(S.items.length && DealDefaults.allowed())) return '';
    return `<button class="dl-cta" type="button" data-a="deal"><i aria-hidden="true">₽</i><span><b>Экономика сделки: логистика, растаможка, финансирование</b><small>Закупка у поставщиков, таможня по кодам ТН ВЭД — и цена продажи под нужную маржу. В КП не выводится.</small></span><em aria-hidden="true">→</em></button>`;
  }

  // опции и услуги позиции — строкой «доп.» под ней: цена продажи (с валютой) и сумма в валюте КП
  static _options(item, i) {
    return (item.options || [])
      .map((option, j) =>
        option.name
          ? `<div class="prow popt"><span></span>
      <div class="pname"><b><i class="popt-m">доп.</i>${esc(option.name)}</b><small>${esc(option.qty)} ${esc(option.unit || 'шт.')} · к «${esc(item.name || 'позиция')}»</small></div>
      <label class="f pprice"><span class="pl">Цена за ед.</span>${OptionSale.field(i, j, option)}</label><span></span>
      <div class="psum"><span class="pl">Сумма</span><b data-osum="${i}.${j}">${OptionSale.sum(option)}</b></div></div>`
          : '',
      )
      .join('');
  }

  static _row(item, i, currency) {
    const priceText = item._priceText ?? Price.text(item.price);
    const opts = (item.options || []).filter(opt => opt.name && opt.price);
    const optSum = opts.reduce((sum, opt) => sum + (+opt.qty || 0) * (opt.price || 0), 0);
    const kind = Discount.type(item);
    return `<div class="prow" id="prow-${esc(item.id)}">
      <span class="item-no">${i + 1}</span>
      <div class="pname"><b>${esc(item.name || 'Без названия')}</b><small>${esc(item.qty)} шт.${opts.length ? ` · опции ${KPGen.money(optSum)} ${currency}` : ''}</small></div>
      <label class="f pprice"><span class="pl">Цена за ед., ${currency}</span><input type="text" inputmode="decimal" class="num strong${Number.isNaN(Price.parse(priceText)) || !item.price ? ' bad' : ''}" data-price="${i}" value="${esc(priceText)}" placeholder="0,00" aria-label="Цена за единицу с НДС, ${currency}"></label>
      <label class="f pdisc" title="Скидка для заказчика — попадёт в КП"><span class="pl">Скидка</span><span class="dwrap"><input type="text" inputmode="decimal" class="num${item._discText != null && item._discBad ? ' bad' : ''}" data-disc="${i}" value="${esc(item._discText ?? Discount.text(item))}" placeholder="нет" aria-label="Скидка"><span class="mtog" role="group" aria-label="Вид скидки"><button type="button" class="${kind === 'pct' ? 'on' : ''}" data-a="dmode" data-i="${i}" data-v="pct" title="Скидка в процентах от цены">%</button><button type="button" class="${kind === 'sum' ? 'on' : ''}" data-a="dmode" data-i="${i}" data-v="sum" title="Скидка суммой на единицу">${currency}</button></span></span></label>
      <div class="psum"><span class="pl">Сумма</span><b data-sum="${i}">${KPGen.money(KpState.itemSum(item))}</b></div>
      <div class="pinfo" data-minfo="${i}">${PriceHints.of(item)}</div>
    </div>`;
  }
}
