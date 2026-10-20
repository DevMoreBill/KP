import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';

/** Вкладка «Цена КП и валюта»: цены позиций, валюта и курсы ЦБ правятся здесь же и сразу меняют КП; прикидка другой цены. */
export class DealPrice {
  static CUR_NAMES = { RUB: 'Рубли', USD: 'Доллары США', EUR: 'Евро' };
  static CUR_OTHER = 'Юани';

  /**
   * Вкладка «Цена КП и валюта».
   * @param {object} calc
   * @returns {string}
   */
  static step(calc) {
    return DealSteps.html({
      n: 0,
      title: 'Цена КП и валюта',
      sub: 'Здесь меняются цены КП, валюта и курс — так же, как в разделе «Цены и валюта».',
      body: DealPrice.html(calc),
      tot: [
        'Цена КП с НДС',
        calc.S,
        `выручка без НДС ${Fmt.rub(calc.R)}, НДС ${DealFmt.inp(calc.v)} % — ${Fmt.rub(calc.VATs)}`,
      ],
      id: 'price',
    });
  }

  /**
   * Валюта, курсы, цены позиций и прикидка цены.
   * @param {object} calc
   * @returns {string}
   */
  static html(calc) {
    const deal = DealState.deal();
    const kpData = DealState.inputs();
    const cur = kpCur();
    const over = deal.over.price !== '' && deal.over.price != null;
    const guess = DealFmt.field('Цена для расчёта с НДС', 'over.price', {
      calc,
      unit: '₽',
      kp: kpData.sumRub,
      kpLabel: '= цена КП',
      q: 'Только для расчёта: КП не меняется. Чтобы поставить цену в КП — впишите цены позиций выше или нажмите «Перенести цены в КП» справа.',
    });
    return `<div class="dl-g g3">
        ${DealPrice._cur(cur)}
        ${DealPrice._rates(calc, cur, deal)}</div>
      ${DealPrice._items(cur, kpData)}
      <details class="dl-more" data-more="over"${DealFmt.more('over', { open: over })}><summary>Прикинуть другую цену без изменения КП</summary>
        <div class="dl-g g3">${guess}</div></details>`;
  }

  static _cur(cur) {
    const options = CUR_LIST.map(
      code =>
        `<option value="${code}"${code === cur ? ' selected' : ''}>${DealPrice.CUR_NAMES[code] || DealPrice.CUR_OTHER} (${code})</option>`,
    ).join('');
    const note = cur !== 'RUB' ? '<small class="muted">Цены переводятся по курсу</small>' : '';
    return `<label class="f dl-f"><span>Валюта КП</span><select data-kpcur aria-label="Валюта КП">${options}</select>${note}</label>`;
  }

  static _rates(calc, cur, deal) {
    const need = [...new Set([cur, ...calc.used])].filter(code => code !== 'RUB');
    if (!need.length) return '';
    const pricing = S.pricing;
    const date = pricing.rateDate ? ` на ${esc(KPGen.ruDate(pricing.rateDate))}` : '';
    const inputs = need
      .map(code => {
        const value = (deal.rates && deal.rates[code]) || pricing.rates[code] || '';
        return `<span class="dl-in"><i>1 ${code} =</i><input type="text" inputmode="decimal" data-kprate="${code}" value="${esc(value)}" placeholder="0,0000" aria-label="Курс ${code}"${rateOf(code) > 0 ? '' : ' class="bad"'}><i>₽</i></span>`;
      })
      .join('');
    return `<div class="f dl-f dl-rates"><span>Курс ЦБ РФ${date}</span>
          ${inputs}
          <button type="button" class="lnk" data-dlx="cbr">Обновить курс с cbr.ru</button></div>`;
  }

  static _items(cur, kpData) {
    const short = curSh(cur);
    const rows = S.items
      .filter(item => String(item.name || '').trim())
      .map(item => DealPrice._row(item, short))
      .join('');
    if (!rows) return '';
    const rub = cur !== 'RUB' && kpData.sumRub ? `<small>≈ ${Fmt.rub(kpData.sumRub)}</small>` : '';
    return `<table class="dl-it dl-kpt"><thead><tr><th>Позиция</th><th>Цена за ед. с НДС, ${short}</th><th class="num">Сумма, ${short}</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td><b>Итого КП с НДС</b></td><td></td><td class="num"><b>${money(totalsS().sum)} ${short}</b>${rub}</td></tr></tfoot></table>`;
  }

  static _row(item, short) {
    const index = S.items.indexOf(item);
    const text = item._priceText ?? fmtPrice(item.price);
    const disc = KPGen.unitDisc(item);
    return `<tr><td class="c-nm"><b>${esc(item.name)}</b><small>${esc(item.qty)} шт.${disc ? ` · скидка ${money(disc)} ${short}/ед.` : ''}</small></td>
        <td class="c-cost"><input type="text" inputmode="decimal" class="num" data-kpp-i="${index}" value="${esc(text)}" placeholder="0,00" aria-label="Цена за единицу с НДС, ${short}"></td>
        <td class="num">${money(itemSum(item))}</td></tr>`;
  }
}
