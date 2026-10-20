import { DealDefaults, DealMoneyRate } from './deal-defaults.js';
import { DealFmt } from './deal-fmt.js';
import { DealResult } from './deal-result.js';
import { DealSteps } from './deal-steps.js';
import { DealUi } from './deal-ui.js';
import { DealValues } from './deal-values.js';

/** Вкладка «Деньги и налог»: стоимость денег (ключевая ставка ЦБ + надбавка), НДС продажи, налог на прибыль, НДС к уплате. */
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
      'НДС с продажи минус весь НДС к вычету по сделке. Ставка НДС продажи — из КП. Ввозной НДС платится на таможне и целиком идёт к вычету, поэтому на прибыль не влияет — только на деньги в обороте.',
    );
    return DealSteps.html({
      n: 0,
      title: 'Деньги и налог',
      sub: 'Обычно менять не нужно: стоимость денег — по ключевой ставке ЦБ, НДС продажи — как в КП, налог на прибыль — 25 %.',
      body: `<div class="dl-card"><div class="dl-g dl-money">
        ${DealMoney._money(calc, kpData)}
        ${DealMoney._vat()}
        ${DealMoney._tax(calc)}</div></div>
        <div class="dl-card dl-vatsec"><h5>НДС к уплате${vatHelp}</h5>${DealResult.vat(calc, res, { wide: true })}</div>`,
      tot: [
        'Итого финансирование и налог',
        calc.F + res.tax,
        `финансирование ${Fmt.rub(calc.F)} + налог на прибыль ${Fmt.rub(res.tax)} · НДС к уплате ${payable}`,
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
      return `Ключевая ставка ЦБ РФ ${DealFmt.inp(key.rate)} % с ${key.date} + ${spread} п.п. годовых, делённое на 12`;
    return DealUi.keyErr ? `Ключевая ставка ЦБ недоступна: ${DealUi.keyErr}` : '';
  }

  static _vat() {
    const help = DealFmt.help(
      'Ставка НДС в цене КП — та же, что в разделе «Условия». С 2026 года основная ставка — 22 %.',
    );
    return `<label class="f dl-f"><span>НДС продажи <i>%</i>${help}</span><span class="dl-in"><input type="text" inputmode="numeric" data-kpvat value="${esc(S.vat)}" aria-label="НДС продажи, %"></span><small class="muted">Как в КП и разделе «Условия»</small></label>`;
  }

  static _tax(calc) {
    return DealFmt.field('Налог на прибыль', 'tax', {
      calc,
      unit: '%',
      hint: 'С 2025 года — 25 % (ст. 284 НК РФ)',
      q: 'Считается с прибыли после всех расходов, включая финансирование. Проценты по кредиту уменьшают налог; если «стоимость денег» — упущенный доход на свои деньги, налоговая её не учитывает, и налог будет немного больше.',
    });
  }
}
