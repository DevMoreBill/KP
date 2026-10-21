import { DealFmt } from './deal-fmt.js';
import { DealTerms } from './deal-terms.js';
import { InputNum } from './input-num.js';
import { LgFmt } from './lg-fmt.js';
import { LgMoney } from './lg-money.js';
import { LgOffers } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { LgValues } from './lg-values.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/**
 * Перевозчик и цена (все предложения «дверь в дверь», выбор — любое или максимальное) и итог доставки по России в расчёт
 * сделки — по расчёту или своей суммой (в рублях или валюте).
 */
export class LgCarrier {
  static KIND = { model: 'расчёт по тарифам', ftl: 'отдельная машина', ltl: 'сборный груз' };
  static KEYS = [
    ['ati', 'ATI.SU'],
    ['dellin', 'Деловые Линии'],
    ['kit', 'КИТ'],
    ['cdek', 'СДЭК'],
    ['vozovoz', 'Возовоз'],
  ];

  /**
   * @param {object} card карточка поставщика (LgCard)
   */
  constructor(card) {
    this.card = card;
    this.k = card.k;
    this.sup = card.sup;
    this.res = card.res;
    this.fin = card.fin;
    this.lg = card.lg;
    this.pick = card.lg.pick || 'max';
  }

  _help() {
    const tariffs = LgState.tar;
    return DealFmt.help(
      `Все цены — от двери до двери в одних условиях: перевозка (если перевозчик возит до терминала — плюс забор и доставка по городу по тарифам), обязательное страхование груза и разгрузка. Страхование — перевозчика, если он его считает (по объявленной стоимости груза), иначе своё: ${LgFmt.comma(tariffs.insPct)} %, не меньше ${Fmt.rub(tariffs.insMin)}. Агент-экспедитор (${LgFmt.comma(tariffs.agentPct)} %) — только для отдельной машины и расчёта по тарифам, на перевозку, разрешения, прикрытие${LgValues.agentUnload() ? ' и разгрузку' : ''} (страхование — без агентских): у транспортной компании комиссии агента нет. Отдельная машина — ATI.SU «Средние ставки» (верхняя граница за 30 дней, с НДС); сборный груз — ПЭК, Энергия, Деловые Линии, КИТ, СДЭК, Возовоз, ЖелДорЭкспедиция; крупногабаритный и длинномерный груз (больше пределов сборного) — ЖелДорЭкспедиция с надбавкой за негабарит. По умолчанию в сделку идёт максимальное предложение; можно выбрать перевозчика.`,
    );
  }

  _button(quote) {
    const busy = LgState.busy[this.sup.id];
    let text = 'Запросить цены';
    if (busy) text = 'Запрашиваю…';
    else if (quote) text = 'Обновить цены';
    return `<button class="btn ghost lg-qb" type="button" data-lgx="quote" data-k="${this.k}"${busy ? ' disabled' : ''}>${text}</button>`;
  }

  // 5. цены перевозчиков — все «дверь в дверь», с агентом и страхованием; выбор — любое или максимальное
  /**
   * Раздел «Перевозчик и цена»; груз не посчитан — пусто.
   * @returns {string}
   */
  offers() {
    if (this.res.need) return '';
    const quote = LgOffers.quoteFor(this.sup, this.res);
    const providers = (LgState.status && LgState.status.providers) || {};
    const noKey = LgCarrier.KEYS.filter(([key]) => !providers[key]).map(([, name]) => name);
    const err = LgState.err[this.sup.id];
    return `<div class="lg-sec lg-s-off"><h5><span class="lg-sn">${this.card.first + 4}</span>Перевозчик и цена${this._help()}
          ${this._button(quote)}</h5>
        ${noKey.length ? `<p class="muted lg-note">Не подключены: ${esc(noKey.join(', '))} — ключи в «Настройки → Ключи API».</p>` : ''}
        ${err ? `<p class="msg err">${esc(err)}</p>` : ''}
        <div class="lg-tw"><table class="lg-p lg-of"><tbody>
          ${this._maxRow()}
          ${this.fin.offers.map(offer => this._row(offer)).join('')}
        </tbody></table></div>
        ${LgCarrier._errors(quote)}
        <p class="muted lg-note">${this._quoteNote(quote)}</p></div>`;
  }

  _radio(id) {
    return `<input type="radio" name="lgpick${this.k}" data-lgpick="${esc(id)}" data-k="${this.k}"${this.pick === id ? ' checked' : ''}>`;
  }

  _maxRow() {
    const max = this.fin.max;
    return `<tr class="${this.pick === 'max' ? 'on' : ''}"><td><label class="lg-pk">${this._radio('max')}<b>Максимальное предложение</b></label><small>рекомендуется: запас на рост ставок — сейчас ${esc(max.src)}</small></td><td></td><td></td><td class="num">${Fmt.rub(max.total)}</td></tr>`;
  }

  _row(offer) {
    const max = this.fin.max;
    const cls = `${this.pick === offer.id ? 'on' : ''}${offer === max ? ' best' : ''}`;
    const local = offer.local ? ` · + забор и доставка по городу ${Fmt.rub(offer.local)}` : '';
    const agent = offer.agent ? ` · агент ${Fmt.rub(offer.agent)}` : '';
    const unload = offer.unload ? ` · разгрузка ${Fmt.rub(offer.unload)}` : '';
    const note = `${esc(offer.note || '')}${local} ${agent} · страхование ${offer.insTk ? 'перевозчика ' : ''}${Fmt.rub(offer.ins)}${unload}`;
    return `<tr class="${cls}"><td><label class="lg-pk">${this._radio(offer.id)}<b>${esc(offer.src)}</b></label>
              <small>${note}</small></td>
            <td>${esc(LgCarrier.KIND[offer.kind] || '')}</td><td class="num">${offer.days ? `${esc(offer.days)} дн.` : ''}</td><td class="num">${Fmt.rub(offer.total)}${offer === max ? ' <span class="lg-tag">макс.</span>' : ''}${LgCarrier._outlier(offer)}</td></tr>`;
  }

  static _outlier(offer) {
    if (!offer.outlier) return '';
    return ` <span class="lg-tag bad" title="Дороже середины остальных предложений в ${esc(LgFmt.comma(offer.outlier))} раза — в максимум не берётся (порог — «Настройки → Значения программы → Логистика»). Проверьте цену на сайте перевозчика; выбрать можно вручную.">выброс</span>`;
  }

  static _errors(quote) {
    if (!(quote && quote.res.errors.length)) return '';
    const rows = quote.res.errors
      .map(error => {
        const link =
          error.url && !error.skip
            ? ` <a href="${esc(error.url)}" target="_blank" rel="noopener">посчитать на сайте ↗</a>`
            : '';
        return `<li class="${error.skip ? 'muted' : ''}"><b>${esc(error.src)}:</b> ${esc(error.msg)}${link}</li>`;
      })
      .join('');
    return `<ul class="lg-errs">${rows}</ul>`;
  }

  _quoteNote(quote) {
    if (quote) return `Цены перевозчиков запрошены ${esc(Fmt.dateTime(quote.res.at))}`;
    if (LgState.busy[this.sup.id]) return 'Запрашиваю цены перевозчиков…';
    return 'Цены перевозчиков ещё не запрошены — пока только расчёт по тарифам.';
  }

  _breakdown() {
    const tariffs = LgState.tar;
    const { res } = this;
    const chosen = this.fin.chosen;
    const ins = chosen.insTk
      ? `Страхование груза — ${chosen.src} (по объявленной стоимости${res.insBase ? ` ${Fmt.rub(res.insBase)}` : ''})`
      : `Страхование груза ${LgFmt.comma(tariffs.insPct)} %${res.insBase ? ` от ${Fmt.rub(res.insBase)}` : ''}`;
    const rows = [
      ['Перевозка', chosen.base],
      ['Забор и доставка по городу', chosen.local],
      [`Агент-экспедитор ${LgFmt.comma(tariffs.agentPct)} %`, chosen.agent],
      [ins, chosen.ins],
      ['Разгрузка', chosen.unload],
    ].filter(row => row[1]);
    return `<table class="lg-p lg-brk">${rows.map(([title, sum]) => `<tr><td>${esc(title)}</td><td class="num">${Fmt.rub(sum)}</td></tr>`).join('')}</table>`;
  }

  _manual(cur) {
    const { k, sup } = this;
    const card = this.card;
    const invalid = card.calc.err[`${card.path}.logRu`] ? ' aria-invalid="true"' : '';
    const options = DealTerms.CURS.map(code => `<option${code === cur ? ' selected' : ''}>${code}</option>`).join('');
    return `<span class="dl-in cur lg-man"><input type="text" inputmode="decimal" data-lgman="${k}" value="${esc((sup.logRu && sup.logRu.v) || '')}" placeholder="сумма" aria-label="Своя сумма доставки"${invalid}><select data-lgcur="${k}" aria-label="Валюта своей суммы">${options}</select></span>${LgMoney.rubNote(card.calc, card.cs, cur)}`;
  }

  _how(manual, cur) {
    const { fin, res } = this;
    const days =
      res.days && !res.need ? ` · в пути ≈ ${res.days} ${KPGen.plural(res.days, 'день', 'дня', 'дней')}` : '';
    if (manual) {
      return `своя сумма (например, по счёту перевозчика)${cur === 'RUB' ? '' : ' — в расчёт сделки идут рубли по курсу ЦБ'}${days}`;
    }
    return `${fin.picked ? 'выбрано: ' : 'максимальное предложение: '}${esc(fin.name)}${days}`;
  }

  /**
   * Итог доставки по России → в расчёт сделки.
   * @returns {string}
   */
  total() {
    const { k, sup, fin } = this;
    const manual = this.lg.mode === 'manual';
    const cur = LgMoney.cur(sup);
    const sum = InputNum.parse(sup.logRu && sup.logRu.v) || 0;
    const value = manual ? this._manual(cur) : `<b>${Fmt.rub(sum || fin.price)}</b>`;
    const days = this.card.ru
      ? `<label class="cw-chk"><input type="checkbox" data-lgf="setDays" data-k="${k}"${LgMoney.setDays(sup) ? ' checked' : ''}> срок в пути → «Доставка до заказчика»</label>`
      : '';
    return `<div class="lg-tot"><div><small>Доставка по России, дверь в дверь → в расчёт сделки</small>
          ${value}
          <span class="muted">${this._how(manual, cur)}</span>
          ${manual ? '' : this._breakdown()}</div>
        <div class="lg-act"><span class="dl-seg"><button type="button" class="${manual ? '' : 'on'}" data-lgx="mode" data-k="${k}" data-v="auto">По расчёту</button><button type="button" class="${manual ? 'on' : ''}" data-lgx="mode" data-k="${k}" data-v="manual">Своя сумма</button></span>
          ${days}</div></div>
        ${manual ? '' : `<p class="muted lg-note lg-foot">${esc(fin.foot)}</p>`}`;
  }
}
