import { LivePreview } from '../features/doc/live-preview.js';
import { OptionCost } from '../features/kp/option-cost.js';
import { Steps } from './steps.js';
import { Tender } from './tender.js';
import { CatalogEditor } from '../features/catalog/catalog-edit.js';
import { Templates } from '../features/doc/templates.js';
import { ShortName } from '../features/kp/journal-row.js';
import { KpFile } from '../features/doc/kp-file.js';
import { PdfExport } from '../features/doc/pdf-export.js';
import { DealSide } from '../features/deal/deal-side.js';
import { DealDefaults } from '../features/deal/deal-defaults.js';
import { Morph } from '../core/morph.js';
import { $, esc } from '../core/util.js';
import { KpModels } from '../features/doc/kp-models.js';
import { Currency, Discount } from '../features/kp/currency.js';
import { StationCalc } from '../features/calc/station-calc.js';
import { StationUi } from '../features/station/station-ui.js';
import { Price } from '../core/str.js';
import { Inn } from '../features/kp/client-store.js';
import { KpState, S } from '../core/state.js';
import { OptionSale } from '../features/kp/option-sale.js';

/** Что осталось заполнить, чтобы сохранить КП: [текст, id блока]. */
export class Problems {
  static VAT_MAX = 50;

  /**
   * Замечания по КП.
   * @returns {Array<[string, string]>}
   */
  static list() {
    return [...this._client(), ...this._items(), ...this._doc()];
  }

  static _client() {
    const out = [];
    if (!S.client.trim()) out.push(['Укажите получателя', 'st-client']);
    if (!S.date) out.push(['Укажите дату', 'st-client']);
    if (S.clientInn && !Inn.valid(S.clientInn)) out.push(['ИНН получателя указан с ошибкой', 'st-client']);
    if (Tender.active() && !Tender.number()) out.push(['Тендер: укажите № закупки', 'st-tender']);
    if (Tender.active() && String(S.tender.url || '').trim() && !Tender.url()) {
      out.push(['Тендер: ссылка должна начинаться с http:// или https://', 'st-tender']);
    }
    if (!S.items.length) out.push(['Добавьте хотя бы одну позицию', 'st-items']);
    return out;
  }

  static _items() {
    return S.items.flatMap((item, i) => [...this._item(item, i), ...this._options(item, i)]);
  }

  static _item(item, i) {
    const out = [];
    const label = `Позиция ${i + 1}`;
    if (!item.name.trim()) out.push([`${label}: нет наименования`, `item-${item.id}`]);
    if (!(Number.isInteger(+item.qty) && +item.qty >= 1))
      out.push([`${label}: количество — целое число от 1`, `item-${item.id}`]);
    if (!item.price || Number.isNaN(Price.parse(item._priceText ?? Price.text(item.price)))) {
      out.push([`${label}: укажите цену`, `prow-${item.id}`]);
    }
    if (StationUi.blocked(item))
      out.push([`${label}: оборудование станции не помещается в контейнер`, `item-${item.id}`]);
    const calc = StationCalc.errors(item); // расчёт станции: станция не пройдёт по требованиям
    if (calc.length) {
      const more = calc.length > 1 ? ` (и ещё ${calc.length - 1})` : '';
      out.push([`${label}: расчёт станции — ${calc[0].text}${more}`, `item-${item.id}`]);
    }
    if (item._discBad) {
      const why = Discount.type(item) === 'sum' ? 'сумма не больше цены за единицу' : 'процент от 0 до 99,99';
      out.push([`${label}: скидка — ${why}`, `prow-${item.id}`]);
    }
    return out;
  }

  static _options(item, i) {
    const out = [];
    (item.options || []).forEach(opt => {
      if (!opt.name.trim()) return;
      const label = `Позиция ${i + 1}, опция «${opt.short || opt.name}»`;
      if (!(Number.isInteger(+opt.qty) && +opt.qty >= 1)) out.push([`${label}: количество`, `item-${item.id}`]);
      if (Number.isNaN(Price.parse(opt._priceText ?? ''))) out.push([`${label}: цена`, `item-${item.id}`]);
    });
    return out;
  }

  static _doc() {
    const out = [];
    if (!S.cover.model.trim() && KpModels.list().length < 2) out.push(['Титул: укажите модель или серию', 'st-cover']);
    const vat = +S.vat;
    if (!(vat >= 0 && vat <= this.VAT_MAX)) out.push(['Проверьте ставку НДС', 'st-price']);
    const currencies = [
      Currency.current(),
      ...S.items.filter(item => item.cost).map(item => item.costCur || 'RUB'),
      ...OptionCost.currencies(S.items),
      ...OptionSale.currencies(S.items),
    ];
    for (const code of new Set(currencies.filter(cur => cur !== 'RUB'))) {
      if (!(Currency.rate(code) > 0)) out.push([`Укажите курс ${code}`, 'st-price']);
    }
    if (!S.manager.name.trim() || !S.manager.phone.trim()) out.push(['Контакты: ФИО и телефон', 'st-manager']);
    return out;
  }
}

/**
 * Правая панель: сумма КП, сразу под ней — «Сохранить КП» и «Предпросмотр», что осталось заполнить, затем краткая
 * экономика сделки. На телефоне — нижняя панель (mbar).
 */
export class SidePanel {
  /** Перерисовать панель. */
  static render() {
    const totals = KpState.totals();
    const list = Problems.list();
    const currency = Currency.short(Currency.current());
    const number = $('#kpno');
    if (number) number.textContent = S.number ? `КП № ${S.number}` : '';
    this.mbar(totals, list, currency);
    LivePreview.schedule();
    Morph.apply(
      $('#side'),
      `<h2 class="side-h">Итог и сохранение</h2>${this.total(totals, currency)}${this.actions(list)}${DealDefaults.allowed() ? DealSide.html() : ''}`,
    );
  }

  /**
   * Итог КП.
   * @param {object} totals
   * @param {string} currency
   * @returns {string}
   */
  static total(totals, currency) {
    const count = S.items.length;
    const rub =
      Currency.current() !== 'RUB' && Currency.rate(Currency.current()) > 0
        ? `<dt>В рублях по курсу</dt><dd>${KPGen.money(Math.round(totals.sum * Currency.rate(Currency.current())))}</dd>`
        : '';
    const discount = totals.discount
      ? `<dt>Без скидки</dt><dd>${KPGen.money(totals.gross)}</dd><dt>Скидка для заказчика</dt><dd>−${KPGen.money(totals.discount)}</dd>`
      : '';
    const inWords = totals.sum
      ? esc(Price.words(totals.sum).replace(/^./, char => char.toUpperCase()))
      : 'Сумма прописью появится после ввода цен.';
    return `<div class="total"><div class="lab">Итого к оплате с НДС</div>
      <div class="big">${KPGen.money(totals.sum)} <small>${currency}</small></div>
      <dl>${discount}<dt>в т. ч. НДС ${esc(S.vat)} %</dt><dd>${KPGen.money(totals.vat)}</dd>${rub}</dl>
      <div class="tot-n">${count} ${KPGen.plural(count, 'позиция', 'позиции', 'позиций')} · ${totals.units} ${KPGen.plural(totals.units, 'единица', 'единицы', 'единиц')} оборудования</div>
      <div class="words">${inWords}</div></div>`;
  }

  /**
   * Сохранение и предпросмотр — первыми; под ними — почему «Сохранить» недоступна.
   * @param {Array} list замечания
   * @returns {string}
   */
  static actions(list) {
    const todo = list.length
      ? list.map(row => `<li><button type="button" data-go="${row[1]}">${esc(row[0])}</button></li>`).join('')
      : '<li class="ok">Проверки пройдены — можно сохранять.</li>';
    return `<div class="checks side-act">
      <button class="btn primary dl" type="button" data-a="download" ${list.length ? 'disabled' : ''}>${S.kpId ? `Сохранить изменения КП № ${esc(S.number)}` : 'Сохранить КП'}</button>
      <button class="btn dl pv" type="button" data-a="kpPreview" ${S.items.length ? '' : 'disabled'}>Предпросмотр КП</button>${LivePreview.button()}
      <label class="pdftoo"><input type="checkbox" id="pdfToo" ${PdfExport.wanted() ? 'checked' : ''}> Также сохранить в PDF</label>
      <div class="fname">${S.kpId ? esc(KpFile.saved()) : 'Номер присвоится при сохранении'}</div><div class="msg" id="dlmsg"></div>
      <h3>${list.length ? 'Чтобы сохранить, заполните' : 'Всё заполнено'}</h3>
      <ul>${todo}</ul>
      ${this._manager()}
      ${this._template()}</div>`;
  }

  static _manager() {
    if (!Steps.mgrLine() || Steps.current === 'mgr') return '';
    return `<div class="tplside">Менеджер: <b>${esc(ShortName.of(S.manager.name))}</b>, ${esc(S.manager.phone)} <button type="button" data-step="mgr">изменить</button></div>`;
  }

  static _template() {
    if (Templates.list.length <= 1) return '';
    return `<div class="tplside">Шаблон: <b>${esc((Templates.current() || {}).name || '—')}</b> <button type="button" data-go="st-cover">сменить</button></div>`;
  }

  /**
   * Нижняя панель телефона: назад, итог (переход к сохранению), далее; на последнем шаге — «Сохранить КП».
   * @param {object} totals
   * @param {Array} list замечания
   * @param {string} currency
   */
  static mbar(totals, list, currency) {
    const bar = $('#mbar');
    if (!bar) return;
    const steps = Steps.visible();
    const k = steps.findIndex(step => step.id === Steps.current);
    const prev = steps[k - 1];
    const back = prev
      ? `<button class="mb-back" type="button" data-step="${prev.id}" aria-label="Назад: ${esc(prev.t)}"><span aria-hidden="true">‹</span></button>`
      : '<span class="mb-back" aria-hidden="true"></span>';
    // не заполнено — нажатие ведёт сразу к первому пустому полю, а не в начало раздела
    const target = list.length ? `data-go="${list[0][1]}"` : 'data-a="toSave"';
    const sum = `<button class="mb-sum" type="button" ${target}><small>${list.length ? `Итого · не заполнено: ${list.length} ›` : 'Итого · всё готово'}</small><b>${KPGen.money(totals.sum)} ${esc(currency)}</b></button>`;
    Morph.apply(bar, back + sum + this._next(steps[k + 1], list));
  }

  static _next(next, list) {
    if (next) {
      return `<button class="btn primary mb-next" type="button" data-step="${next.id}"><span>Далее</span><small>${esc(next.t)}</small></button>`;
    }
    if (list.length) {
      return `<button class="btn primary mb-next" type="button" data-go="${list[0][1]}"><span>Заполнить</span><small>осталось ${list.length}</small></button>`;
    }
    return `<button class="btn primary mb-next" type="button" data-a="download"><span>Сохранить</span><small>${S.kpId ? 'изменения КП' : 'КП'}</small></button>`;
  }

  /** Суммы позиций и опций на месте, без перерисовки формы; панель и черновик. */
  static updateLive() {
    S.items.forEach((item, i) => {
      const sum = KPGen.money(KpState.itemSum(item));
      document.querySelectorAll(`[data-sum="${i}"]`).forEach(cell => (cell.textContent = sum));
      (item.options || []).forEach((opt, j) => {
        const text = OptionSale.sum(opt);
        document.querySelectorAll(`[data-osum="${i}.${j}"]`).forEach(cell => (cell.textContent = text));
      });
    });
    if (CatalogEditor.session) return;
    this.render();
    KpState.persist();
  }
}
