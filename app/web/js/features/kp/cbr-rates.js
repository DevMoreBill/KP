import { Currency } from './currency.js';
import { OptionCost } from './option-cost.js';
import { DEF_BY } from '../../core/defaults.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { DealWin } from '../deal/deal-win.js';
import { FormView } from '../../ui/form-view.js';
import { $, esc, today } from '../../core/util.js';
import { Kit } from '../kit/kit.js';
import { KpState, S } from '../../core/state.js';
import { OptionSale } from './option-sale.js';

/** Курсы ЦБ РФ: кнопка «Курс ЦБ» — все валюты; программа сама (нет курса нужной валюты) — только пустые. */
export class CbrRates {
  static RATED = ['USD', 'EUR', 'CNY'];
  static FLASH_MS = 1800;
  static WHY_MAX = 160;
  static DIGITS = 4;
  static busy = false;

  /** Кнопка «Курс ЦБ»: все валюты заменяются курсом ЦБ. */
  static load() {
    return this._load({ emptyOnly: false });
  }

  /** Нет курса нужной валюты: только пустые курсы (договорной курс, введённый вручную, не заменяется). */
  static fillEmpty() {
    return this._load({ emptyOnly: true });
  }

  /** Нужен курс валюты КП, закупки позиций или элементов станции — загрузить один раз. */
  static auto() {
    const need = [
      Currency.current(),
      ...S.items.filter(item => item.cost).map(item => item.costCur || 'RUB'),
      ...OptionCost.currencies(S.items),
      ...OptionSale.currencies(S.items),
      ...S.items.flatMap(item =>
        Kit.parts(item)
          .filter(part => part.cost)
          .map(part => part.costCur || 'RUB'),
      ),
    ].filter(code => code !== 'RUB' && !(Currency.rate(code) > 0));
    if (!need.length || this.busy) return;
    this.busy = true;
    this.fillEmpty().finally(() => {
      this.busy = false;
    });
  }

  static async _load({ emptyOnly }) {
    const msg = $('#cbrMsg');
    if (msg) msg.textContent = 'Загружаю курс ЦБ РФ…';
    const opened = S;
    const answer = await this._fetch();
    if (S !== opened) return;
    if (!answer.rates) {
      this._failed(answer.why);
      return;
    }
    const got = this.RATED.filter(code => answer.rates[code] && !(emptyOnly && Currency.rate(code) > 0));
    for (const code of got) S.pricing.rates[code] = (+answer.rates[code]).toFixed(this.DIGITS).replace('.', ',');
    if (!got.length) return;
    OptionSale.syncAll();
    S.pricing.rateDate = answer.rates.date || today();
    S.pricing.rateSrc = answer.src;
    FormView.render();
    KpState.persist();
    DealWin.render();
    this._flash(got);
    const rest = emptyOnly && got.length < this.RATED.length ? ' (остальные курсы — как были)' : '';
    Toast.show(
      `Курс ЦБ РФ на ${KPGen.ruDate(S.pricing.rateDate)}: ${got.map(code => `${code} ${S.pricing.rates[code]}`).join(', ')}${rest}`,
    );
  }

  static async _fetch() {
    const button = document.querySelector('[data-a="cbr"]');
    const label = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Запрашиваю курс…';
    }
    let out = { rates: null, src: '', why: '' };
    try {
      const rates = await Api.request('/api/cbr');
      out = rates.USD
        ? { rates, src: rates.src || 'ЦБ РФ (cbr.ru)', why: '' }
        : { rates: null, src: '', why: rates.error || '' };
    } catch (error) {
      out.why = String(error.message || error).slice(0, this.WHY_MAX);
    }
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
    return out;
  }

  static _failed(why) {
    const msg = $('#cbrMsg');
    if (msg) {
      msg.textContent = `Курс с cbr.ru не получен${why ? ` (${why})` : ''} — введите вручную ниже.`;
      msg.classList.add('bad-t');
    }
    document.querySelector('details.psettings')?.setAttribute('open', '');
    document.querySelector('[data-rate]')?.focus();
    Toast.show('Курс ЦБ не загружен — введите вручную');
  }

  static _flash(codes) {
    codes.forEach(code => {
      const input = document.querySelector(`[data-rate="${code}"]`);
      if (!input) return;
      input.classList.add('flash');
      setTimeout(() => input.classList.remove('flash'), this.FLASH_MS);
    });
  }
}

/** Раздел «Цены и валюта»: НДС, валюта КП, курсы ЦБ, округление. */
export class PricingBlock {
  static NAMES = { RUB: 'Рубли', USD: 'Доллары США', EUR: 'Евро', CNY: 'Юани' };

  /**
   * Разметка блока.
   * @returns {string}
   */
  static html() {
    const pricing = S.pricing;
    const cur = Currency.current();
    const need = this._need(cur);
    const missing = need.filter(code => !(Currency.rate(code) > 0));
    const options = Currency.LIST.map(
      code => `<option value="${code}"${code === cur ? ' selected' : ''}>${this.NAMES[code]} (${code})</option>`,
    ).join('');
    return `<div class="curbar">
     <label class="cur-sel cur-vat"><span>НДС, %</span><input type="text" inputmode="decimal" data-p="vat" value="${esc(S.vat)}" aria-label="Ставка НДС, %"></label>
     <label class="cur-sel"><span>Валюта КП</span><select data-pr="cur">${options}</select></label>
     ${need.length ? this._rates(pricing, need, missing) : ''}
   </div>
   <details class="psettings"${missing.length ? ' open' : ''}><summary>${need.length ? 'Изменить курсы вручную, округление цен' : 'Округление цен'}</summary>
     <div class="grid g4" style="margin-top:10px">${need.length ? this._inputs(pricing, need) : ''}
       <label class="f"><span>Округление цен из экономики сделки</span><select data-pr="round">${this._rounds(pricing)}</select></label></div></details>`;
  }

  // валюты, курс которых нужен: валюта КП, закупка позиций (не станций) и элементов станций
  static _need(cur) {
    const codes = [
      cur,
      ...S.items.map(item => (item.cost && !Kit.has(item) ? item.costCur || 'RUB' : null)),
      ...OptionCost.currencies(S.items),
      ...OptionSale.currencies(S.items),
      ...S.items.flatMap(item =>
        Kit.parts(item)
          .filter(part => part.cost)
          .map(part => part.costCur || 'RUB'),
      ),
    ];
    return [...new Set(codes.filter(code => code && code !== 'RUB'))];
  }

  static _rates(pricing, need, missing) {
    const shown = CbrRates.RATED.map(code => {
      const lacks = need.includes(code) && !(Currency.rate(code) > 0);
      return `<span class="rt${need.includes(code) ? ' need' : ''}${lacks ? ' bad-t' : ''}">${code}&nbsp;<b data-rshow="${code}">${esc(pricing.rates[code] || '—')}</b></span>`;
    }).join('');
    const date = pricing.rateDate ? ` на ${esc(KPGen.ruDate(pricing.rateDate).replace(/ г\.$/, ''))}` : '';
    let note = pricing.rateSrc === 'вручную' ? 'введён вручную' : '';
    if (missing.length) note = `<span class="bad-t">Нужен курс ${esc(missing.join(', '))}</span>`;
    return `<div class="rates"><span class="muted">Курс ЦБ${date}:</span> ${shown}
       <button class="btn ghost sm" type="button" data-a="cbr" title="Обновить курсы с cbr.ru">↻ Обновить</button>
       <span class="muted" id="cbrMsg">${note}</span></div>`;
  }

  static _inputs(pricing, need) {
    return CbrRates.RATED.map(code => {
      const bad = need.includes(code) && !(Currency.rate(code) > 0);
      return `<label class="f"><span>1 ${code}, руб.</span><input type="text" inputmode="decimal" class="num${bad ? ' bad' : ''}" data-rate="${code}" value="${esc(pricing.rates[code] || '')}" placeholder="0,0000"></label>`;
    }).join('');
  }

  static _rounds(pricing) {
    return DEF_BY['kp.round'][5].opts
      .map(
        ([value, label]) =>
          `<option value="${value}"${String(pricing.round) === value ? ' selected' : ''}>${label}</option>`,
      )
      .join('');
  }
}
