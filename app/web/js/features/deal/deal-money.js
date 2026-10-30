import { DealDefaults, DealMoneyRate } from './deal-defaults.js';
import { DealFmt } from './deal-fmt.js';
import { DealResult } from './deal-result.js';
import { DealSeller } from './deal-seller.js';
import { DealSteps } from './deal-steps.js';
import { DealUi } from './deal-ui.js';
import { DealValues } from './deal-values.js';
import { FEAT } from '../../core/features.js';
import { IncomeTax } from '../../core/income-tax.js';
import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/** Вкладка «Деньги и налог»: стоимость денег (ключевая ставка ЦБ + надбавка), НДС продажи, налог на прибыль или УСН, НДС к уплате. */
export class DealMoney {
  static MONEY_FB = 2;

  /**
   * Вкладка «Деньги и налог».
   * @param {object} calc
   * @param {object} kpData входы расчёта из КП
   * @returns {string}
   */
  static step(calc, kpData) {
    const res = calc.base || calc.lo;
    const payable = calc.unknown.length
      ? `${Fmt.rub(calc.hi.payable)} … ${Fmt.rub(calc.lo.payable)}`
      : Fmt.rub(res.payable);
    const vatHelp = DealFmt.help(
      'НДС с продажи минус весь НДС к вычету по сделке. Ставка НДС продажи — из КП. Ввозной НДС платится на таможне и целиком идёт к вычету, поэтому на прибыль не влияет — только на деньги в обороте. Продавец на УСН с НДС 5–7 % или «без НДС» — вычета нет: входной НДС в себестоимости.',
    );
    const tax = IncomeTax.of(calc.usn);
    return DealSteps.html({
      n: 0,
      title: 'Деньги и налог',
      sub: `Обычно менять не нужно: стоимость денег — по ключевой ставке ЦБ, НДС продажи — как в КП, ${calc.usn ? `налог — ${tax.short} ${DealFmt.inp(calc.taxP)} % (как у продавца)` : 'налог на прибыль — 25 %'}.`,
      body: `<div class="dl-card"><div class="dl-g dl-money">
        ${DealMoney._money(calc, kpData)}
        ${DealMoney._seller()}
        ${DealMoney._vat()}
        ${DealMoney._tax(calc)}</div></div>
        <div class="dl-card dl-vatsec"><h5>НДС к уплате${vatHelp}</h5>${DealResult.vat(calc, res, { wide: true })}</div>`,
      tot: [
        'Итого финансирование и налог',
        calc.F + res.tax,
        `финансирование ${Fmt.rub(calc.F)} + ${tax.lower} ${Fmt.rub(res.tax)} · НДС к уплате ${payable}`,
      ],
      id: 'money',
    });
  }

  static _money(calc, kpData) {
    const key = DealUi.key;
    const spread = DealDefaults.spread();
    const fallback = DealFmt.inp(DealValues.num('deal.moneyFb', DealMoney.MONEY_FB));
    return DealFmt.field('Стоимость денег', 'money', {
      calc,
      unit: '% в месяц',
      auto: kpData.moneyAuto,
      autoLabel: key ? `ключевая ${DealFmt.inp(key.rate)} % + ${spread}` : 'по умолчанию',
      autoTitle: DealMoney._autoTitle(key, spread),
      hint: key
        ? `Ключевая ставка ЦБ ${DealFmt.inp(key.rate)} % + ${spread} п.п. = ${DealFmt.inp(key.rate + spread)} % годовых × ${DealMoneyRate.text()} → ${DealFmt.inp(DealMoneyRate.month(key.rate + spread))} % в месяц`
        : 'Процент в месяц на деньги, вложенные до оплаты заказчика',
      q: `Сколько стоят деньги, вложенные в сделку до оплаты заказчика: кредит или упущенный доход. По умолчанию — ключевая ставка ЦБ + ${DealFmt.inp(spread)} п.п. в год (нет ставки ЦБ — ${fallback} % в месяц).`,
    });
  }

  static _autoTitle(key, spread) {
    if (key)
      return `Ключевая ставка ЦБ РФ ${DealFmt.inp(key.rate)} % с ${key.date} + ${spread} п.п. годовых × ${DealMoneyRate.text()}`;
    return DealUi.keyErr ? `Ключевая ставка ЦБ недоступна: ${DealUi.keyErr}` : '';
  }

  static _vat() {
    const help = DealFmt.help(
      'Ставка НДС в цене КП — та же, что в разделе «Условия». С 2026 года основная ставка — 22 %.',
    );
    return `<label class="f dl-f"><span>НДС продажи <i>%</i>${help}</span><span class="dl-in"><input type="text" inputmode="numeric" data-kpvat value="${esc(S.vat)}" aria-label="НДС продажи, %"></span><small class="muted">Как в КП и разделе «Условия»</small></label>`;
  }

  // наше юрлицо-продавец: от его налогообложения — вычет входного НДС
  static _seller() {
    if (!FEAT.on('sellerTax')) return '';
    const deal = S.deal || {};
    const items = DealSeller.own.items || [];
    const help = DealFmt.help(
      'Наше юрлицо, которое продаёт («Настройки → Документы → Наши реквизиты»), по умолчанию — основное. ОСНО и экспорт 0 % — НДС поставщиков, ввоза и услуг к вычету; УСН с НДС 5 или 7 % и «без НДС» — вычета нет, этот НДС остаётся в себестоимости (НК РФ, ст. 170, п. 2).',
    );
    const none = DealSeller.failed ? 'Наши реквизиты не загрузились' : 'Наши реквизиты не заполнены';
    const options = items
      .map(
        item =>
          `<option value="${esc(item.id)}"${item.id === deal.seller ? ' selected' : ''}>${esc(item.name)}</option>`,
      )
      .join('');
    const input =
      items.length > 1
        ? `<select data-dlseller aria-label="Продавец">${options}</select>`
        : `<b>${esc(items.length ? items[0].name : none)}</b>`;
    return `<label class="f dl-f"><span>Продавец${help}</span><span class="dl-in">${input}</span><small class="muted">${esc(DealSeller.label(deal))}</small></label>`;
  }

  static _tax(calc) {
    if (calc.usn) return DealMoney._usnTax(calc);
    return DealFmt.field('Налог на прибыль', 'tax', {
      calc,
      unit: '%',
      hint: 'С 2025 года — 25 % (ст. 284 НК РФ)',
      q: 'Считается с прибыли после всех расходов, включая финансирование. Проценты по кредиту уменьшают налог; если «стоимость денег» — упущенный доход на свои деньги, налоговая её не учитывает, и налог будет немного больше.',
    });
  }

  // УСН: ставка — юрлица продавца («Наши реквизиты»), в сделке не правится
  static _usnTax(calc) {
    const tax = IncomeTax.of(calc.usn);
    return `<div class="f dl-f"><span>${esc(tax.name)}${DealFmt.help(tax.help)}</span><span class="dl-in"><b>${DealFmt.inp(calc.taxP)} %</b></span><small class="muted">${esc(tax.from)} · ставка юрлица — «Наши реквизиты»</small></div>`;
  }
}
