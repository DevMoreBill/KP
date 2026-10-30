import { DealValues } from './deal-values.js';
import { DealCalculator } from './deal-calculator.js';
import { DealBxFix } from './deal-bx-fix.js';
import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { InputNum } from './input-num.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { SellerTax } from '../../core/seller-tax.js';

/**
 * Правая колонка окна: подбор цены продажи под цель (маржинальность, наценка, прибыль) с ценами позиций, безубыточная
 * цена, итог при текущей цене КП, НДС к уплате и структура себестоимости.
 */
export class DealResult {
  static TARGETS = [
    ['margin', 'Маржинальность'],
    ['markup', 'Наценка'],
    ['profit', 'Прибыль до налога'],
    ['net', 'Чистая прибыль'],
  ];
  static RUB_TARGETS = ['profit', 'net'];
  static PCT = 100;
  static EPS = 0.004;
  static EXCESS = 0.5;

  /**
   * Правая колонка.
   * @param {object} calc
   * @returns {string}
   */
  static html(calc) {
    return `<div class="dl-res">
      ${DealResult._price()}
      ${DealResult._now(calc)}
    </div>`;
  }

  static _price() {
    const deal = DealState.deal();
    const kpData = DealState.inputs();
    const goal = deal.target || { type: 'margin', v: '' };
    const value = InputNum.parse(goal.v);
    const need = value != null && !Number.isNaN(value) ? DealCalculator.solve(kpData, deal, goal.type, value) : null;
    const even = DealCalculator.solve(kpData, deal, 'profit', 0);
    const unit = DealResult.RUB_TARGETS.includes(goal.type) ? '₽' : '%';
    const options = DealResult.TARGETS.map(
      ([type, title]) => `<option value="${type}"${goal.type === type ? ' selected' : ''}>${title}</option>`,
    ).join('');
    return `<div class="dl-price"><h4>Цена продажи${DealFmt.help('Укажите нужную маржинальность, наценку или прибыль — программа рассчитает цену КП и цены позиций; «Перенести цены в КП» подставит их.')}</h4>
        <div class="dl-pr"><select data-dl="target.type" aria-label="По какому показателю подобрать цену">${options}</select>
          <span class="dl-in"><input type="text" inputmode="decimal" data-dl="target.v" value="${esc(goal.v || '')}" placeholder="${unit === '%' ? '20' : '500 000'}" aria-label="Нужное значение"><i>${unit}</i></span></div>
        ${DealResult._need(need, value, kpData)}
        <div class="dl-be">Безубыточная цена с НДС: <b>${even != null ? Fmt.rub(even) : '—'}</b>${DealFmt.help('Цена, при которой прибыль после всех расходов и финансирования равна нулю. Ниже — убыток.')}</div></div>`;
  }

  static _need(need, value, kpData) {
    if (need == null) return value != null ? '<p class="muted dl-pmsg">Цель недостижима при этих расходах.</p>' : '';
    const plan = DealState.plan(need);
    const diff =
      Math.abs(need - kpData.sumRub) < 1
        ? 'совпадает с КП'
        : `${need >= kpData.sumRub ? '+' : '−'}${Fmt.rub(Math.abs(need - kpData.sumRub))} к текущей цене КП`;
    return `<p class="dl-need"><small>Цена КП с НДС</small><b>${Fmt.rub(need)}</b><span class="${need < kpData.sumRub ? 'ok-t' : 'muted'}">${diff}</span></p>
          ${DealResult._plan(plan)}<button class="btn primary dl-apply" type="button" data-dlx="apply" data-s="${need}">Перенести цены в КП</button>
          <p class="dl-note">${esc(plan ? `Распределено ${plan.basis}.` : '')}</p>`;
  }

  static _plan(plan) {
    if (!plan) return '';
    const rows = plan.its
      .map((item, k) => {
        const qty = +item.qty > 1 ? ` <small>× ${esc(item.qty)}</small>` : '';
        const now =
          item.price && item.price !== plan.prices[k] ? `<small>сейчас ${KPGen.money(item.price)}</small>` : '';
        return `<tr><td>${esc(item.name)}${qty}</td><td class="num"><b>${KPGen.money(plan.prices[k])}</b>${now}</td></tr>`;
      })
      .join('');
    return `<table class="dl-plan"><thead><tr><th>Позиция</th><th class="num">Цена за ед. с НДС</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  static _range(calc, pick, format) {
    return `${format(pick(calc.lo))} … ${format(pick(calc.hi))}`;
  }

  static _chips(calc) {
    const unknown = calc.unknown.length > 0;
    const bad = !calc.ok || calc.warn.some(warn => warn.bad);
    const noCost = calc.warn.filter(warn => /не указана цена закупки/.test(warn.t)).length;
    let chip = '';
    if (bad) chip = '<span class="dl-chip bad">Проверьте данные</span>';
    else if (unknown) chip = '<span class="dl-chip warn">Нужна сумма ввозного НДС</span>';
    return `${chip}${noCost ? `<span class="dl-chip warn">Расчёт неполный: нет закупки у ${noCost} поз.</span>` : ''}`;
  }

  static _now(calc) {
    const unknown = calc.unknown.length > 0;
    const res = calc.base || calc.lo;
    const profit = unknown ? null : calc.base.P;
    const parts = calc.parts
      .map(
        ([name, value]) =>
          `<dt>${esc(name)}</dt><dd${value < 0 ? ' class="ok-t"' : ''}>${Fmt.rub(value)}${value > 0 && res.Ctot > 0 ? `<small>${DealFmt.inp((value / res.Ctot) * DealResult.PCT)} %</small>` : ''}</dd>`,
      )
      .join('');
    const warns = calc.warn.length
      ? `<ul class="dl-warn">${calc.warn.map(warn => `<li class="${warn.bad ? 'bad' : ''}">${esc(warn.t)}</li>`).join('')}</ul>`
      : '';
    return `<div class="dl-now"><h4>Итог при текущей цене КП <span class="muted">${Fmt.rub(calc.S)}</span></h4>
        ${DealResult._chips(calc)}
        ${DealBxFix.html(calc.bxFix)}
        ${DealResult._big(calc, res, profit)}
        ${DealResult._kpi(calc)}
        ${DealResult._list(calc, res)}
        <details class="dl-more dl-parts" data-more="vat"${DealFmt.more('vat', { open: false })}><summary>Из чего НДС к уплате</summary>${DealResult.vat(calc, res)}</details>
        ${parts ? `<details class="dl-more dl-parts" data-more="parts"${DealFmt.more('parts', { open: false })}><summary>Из чего себестоимость</summary><dl class="dl-dl">${parts}</dl></details>` : ''}
        ${warns}</div>`;
  }

  static _big(calc, res, profit) {
    const unknown = profit == null;
    const cls = `${profit != null && profit < 0 ? ' neg' : ''}${unknown ? ' rng' : ''}`;
    const label = res.K > 0 ? 'Прибыль до налога, за вычетом наличных' : 'Прибыль до налога на прибыль';
    const value = unknown ? DealResult._range(calc, row => row.P, Fmt.rub) : Fmt.rub(profit);
    const net = unknown
      ? ''
      : `<p class="dl-note">Чистая прибыль после налога ${DealFmt.inp(calc.taxP)} %${res.K > 0 ? ' и прочих расходов' : ''}: <b>${Fmt.rub(calc.base.net)}</b></p>`;
    const cash = res.K > 0 ? `<p class="dl-note">С учётом прочих расходов наличными ${Fmt.rub(res.K)}</p>` : '';
    return `<div class="dl-big${cls}"><small>${label}</small><b>${value}</b>
          ${net}${cash}</div>`;
  }

  static _kpi(calc) {
    const show = key =>
      calc.unknown.length > 0 ? DealResult._range(calc, row => row[key], DealFmt.pct) : DealFmt.pct(calc.base[key]);
    return `<div class="dl-kpi"><div><small>Маржинальность ${DealFmt.help('Прибыль ÷ выручка без НДС. Сколько копеек прибыли в каждом рубле выручки. Цвет — «Светофор маржи» в «Параметрах».')}</small><b class="mg-${DealValues.marginTone(calc.base ? calc.base.margin : null) || 'none'}">${show('margin')}</b></div>
          <div><small>Наценка ${DealFmt.help('Прибыль ÷ себестоимость (все расходы с финансированием, без НДС к вычету, и прочие расходы наличными).')}</small><b>${show('markup')}</b></div></div>`;
  }

  static _list(calc, res) {
    const unknown = calc.unknown.length > 0;
    const payable = unknown ? `${Fmt.rub(calc.hi.payable)} … ${Fmt.rub(calc.lo.payable)}` : Fmt.rub(res.payable);
    const cash =
      res.K > 0
        ? `<dt>Прочие расходы (наличные)</dt><dd>${Fmt.rub(res.K)}${res.K !== res.X ? `<small>на руки ${Fmt.rub(res.X)}</small>` : ''}</dd>`
        : '';
    return `<dl class="dl-dl">
          <dt>Выручка без НДС</dt><dd>${Fmt.rub(calc.R)}</dd>
          <dt>Себестоимость с финансированием</dt><dd>${Fmt.rub(res.Ctot)}</dd>
          <dt>в т. ч. финансирование</dt><dd>${Fmt.rub(calc.F)}</dd>
          <dt>НДС к уплате в бюджет${DealFmt.help('НДС с продажи минус НДС к вычету: в цене российских поставщиков, ввозной на таможне, в доставке и услугах в России, прочий. Разбивка — ниже и в шаге «Деньги и налог».')}</dt><dd>${payable}</dd>
          ${cash}
          <dt>Налог на прибыль${res.K > 0 ? ' <small class="muted">— без учёта наличных</small>' : ''}</dt><dd>${Fmt.rub(res.tax)}</dd>
          <dt>Деньги на счёте после сделки</dt><dd>${Fmt.rub(res.cashAfter)}</dd></dl>`;
  }

  /**
   * Вычеты НДС: поставщики в РФ, ввозной на таможне, услуги в России, прочие.
   * @param {object} calc
   * @returns {{viSum: number, unk: boolean, ded: Array}}
   */
  static vatRows(calc) {
    const viSum = calc.sup.reduce((sum, sup) => sum + (sup.vi || 0), 0);
    const unk = calc.unknown.length > 0;
    const ded = [
      ['НДС в цене поставщиков', calc.voSup, 'выделенный в счетах российских поставщиков'],
      [
        'Ввозной НДС на таможне',
        viSum,
        unk
          ? 'нет суммы у поставщика с растаможкой «суммой» — укажите ввозной НДС'
          : 'уплачен при ввозе, весь к вычету',
      ],
      ['НДС в доставке, брокере и услугах в России', calc.voRuSum, 'в ценах перевозчиков, брокера, СВХ'],
      ['НДС в сборке станции', calc.asmVat, 'в цене сборщика'],
      ['Прочий НДС к вычету', calc.Vo, 'монтаж, ПНР и прочие подрядчики с НДС'],
      ['НДС в поправках из Битрикс24', calc.fixVat, 'в статьях, изменённых в Битрикс24'],
    ].filter(row => Math.abs(row[1]) > DealResult.EPS || (row[0].startsWith('Ввозной') && unk));
    return { viSum, unk, ded };
  }

  // вычет: «−сумма»; поправка, уменьшившая статью, — «+сумма»; нет суммы — «?»
  static _dedCell(value) {
    if (!(Math.abs(value) > DealResult.EPS)) return '?';
    return value > 0 ? `−${Fmt.rub(value)}` : `+${Fmt.rub(-value)}`;
  }

  /**
   * НДС к уплате в бюджет: НДС с продажи минус вычеты.
   * @param {object} calc
   * @param {object} res итоги (base или lo)
   * @param {{wide?: boolean}} [look]
   * @returns {string}
   */
  static vat(calc, res, look = {}) {
    if (calc.deduct === false) return DealResult._noDeduct(calc, res, look);
    const { ded, unk } = DealResult.vatRows(calc);
    const { lo: low, hi: high } = calc;
    const pay = unk ? `${Fmt.rub(high.payable)} … ${Fmt.rub(low.payable)}` : Fmt.rub(res.payable);
    const rows = ded
      .map(
        ([title, value, hint]) =>
          `<tr class="ded"><td>− ${esc(title)}${hint ? ` <small>${esc(hint)}</small>` : ''}</td><td class="num">${DealResult._dedCell(value)}</td></tr>`,
      )
      .join('');
    const total = unk ? `${Fmt.rub(low.VATin)} … ${Fmt.rub(high.VATin)}` : `−${Fmt.rub(res.VATin)}`;
    const excess =
      !unk && res.excess > DealResult.EXCESS
        ? `<tr class="ex"><td>Вычеты больше НДС с продажи — к возмещению из бюджета <small>в остаток денег не включается</small></td><td class="num">${Fmt.rub(res.excess)}</td></tr>`
        : '';
    return `<table class="dl-vat${look.wide ? ' wide' : ''}"><tbody>
      ${DealResult._saleRow(calc)}
      ${rows}
      <tr class="sum"><td>Итого НДС к вычету</td><td class="num">${total}</td></tr>
      <tr class="tot"><td><b>НДС к уплате в бюджет</b></td><td class="num"><b>${pay}</b></td></tr>
      ${excess}
    </tbody></table>`;
  }

  static _saleRow(calc) {
    return `<tr><td>НДС ${DealFmt.inp(calc.v)} % с продажи <small>${Fmt.rub(calc.S)} × ${DealFmt.inp(calc.v)} / ${DealFmt.inp(DealResult.PCT + calc.v)}</small></td><td class="num">${Fmt.rub(calc.VATs)}</td></tr>`;
  }

  // продавец без вычета (УСН с НДС 5–7 %, «без НДС»): весь НДС с продажи — к уплате, входной — в себестоимости
  static _noDeduct(calc, res, look) {
    return `<table class="dl-vat${look.wide ? ' wide' : ''}"><tbody>
      ${DealResult._saleRow(calc)}
      <tr class="ded"><td>Вычета нет — продавец: ${esc(SellerTax.label(calc.sellerVat))} <small>НК РФ, ст. 170, п. 2: НДС поставщиков, ввоза и услуг — в себестоимости</small></td><td class="num">0</td></tr>
      <tr class="tot"><td><b>НДС к уплате в бюджет</b></td><td class="num"><b>${Fmt.rub(res.payable)}</b></td></tr>
    </tbody></table>`;
  }
}
