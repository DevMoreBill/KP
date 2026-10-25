import { DealCal } from './deal-cal.js';
import { DealCombo } from './deal-combo.js';
import { DealFmt } from './deal-fmt.js';
import { DealPay } from './deal-pay.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';
import { InputNum } from './input-num.js';
import { Currency } from '../kp/currency.js';
import { Fmt } from '../../core/str.js';
import { S } from '../../core/state.js';
import { KitDoc } from '../kit/kit-doc.js';
import { esc } from '../../core/util.js';

/**
 * Вкладка «Закупка»: сборка станции у производителя контейнера, карточки поставщиков — где покупаем, позиции с ценой
 * закупки, сроки поставки, оплата поставщику, ссылка на логистику, прочие расходы по поставщику.
 */
export class DealPurchase {
  static KOPECKS = 100;
  static PCT = 100;

  /**
   * Вкладка «Закупка».
   * @param {object} calc расчёт сделки
   * @returns {string}
   */
  static html(calc) {
    const deal = DealState.deal();
    deal.sup.forEach(sup => {
      if (!Array.isArray(sup.pay) || !sup.pay.length) sup.pay = JSON.parse(JSON.stringify(DealTerms.supPay(sup)));
    });
    const cards = deal.sup.map((sup, k) => new DealSupplierCard(calc, k).html()).join('');
    return DealSteps.html({
      n: 1,
      title: 'Закупка',
      sub: 'Что и у кого покупаем. Цена — как в счёте поставщика, в его валюте.',
      body: `${DealPurchase.asmCard(calc)}${cards}<button type="button" class="btn dl-add" data-dlx="addsup">+ Ещё поставщик</button>`,
      tot: [
        'Итого закупка и доставка',
        calc.sup.reduce((sum, sup) => sum + sup.cash - sup.T, 0),
        'оборудование, перевозка, страхование, комиссии, брокер — без таможни',
      ],
      id: 'buy',
    });
  }

  /**
   * Сборка станции: кто собирает, сколько дней, сколько стоит; элементы других поставщиков едут к нему.
   * @param {object} calc
   * @returns {string}
   */
  static asmCard(calc) {
    const deal = DealState.deal();
    if (!deal.asm) return '';
    const active = deal.asm.on !== false;
    const seg = `<span class="dl-seg"><button type="button" class="${active ? 'on' : ''}" data-dlx="asmon" data-v="1">Через сборку у производителя контейнера</button><button type="button" class="${active ? '' : 'on'}" data-dlx="asmon" data-v="0">Каждый поставщик везёт заказчику</button></span>`;
    const body = active
      ? DealPurchase._asmBody(calc, deal)
      : '<p class="muted">Элементы станции едут к заказчику напрямую, срок — по самой долгой поставке.</p>';
    const help = DealFmt.help(
      'Элементы станции (ДГУ, насосы, компрессор, шкафы…) везут на производство контейнера, там станцию собирают и испытывают, потом отправляют заказчику. Сроки поставщиков элементов считаются до производителя контейнера, срок станции — после сборки. Маршруты обеих перевозок — на вкладке «Логистика».',
    );
    return `<div class="dl-card dl-asmc"><div class="dl-asmh"><h5>Сборка станции</h5>${seg}${help}</div>${body}</div>`;
  }

  static _asmBody(calc, deal) {
    const who = DealFmt.field('Кто собирает станцию', 'asm.sup', {
      select: [['', '— выберите поставщика —'], ...deal.sup.map((sup, k) => [sup.id, calc.sup[k].name])],
      q: 'Обычно производитель контейнера: к нему едут все элементы, он монтирует оборудование, обвязку и системы, испытывает и отгружает станцию заказчику.',
    });
    const days = DealFmt.field('Сборка и испытания', 'asm.days', {
      calc,
      int: true,
      unit: 'дн.',
      ph: '10',
      q: 'Сколько дней от прихода последнего элемента (и готовности контейнера) до отгрузки собранной станции.',
    });
    const cost = DealFmt.field('Сборка, обвязка, испытания', 'asm.cost.v', {
      calc,
      unit: '₽ с НДС',
      ph: 'в цене контейнера',
      q: 'Если производитель контейнера берёт за сборку отдельно — сумма с НДС. Оплата — после сборки; НДС — к вычету.',
    });
    return `
      <div class="dl-g">${who}
        ${days}
        ${cost}</div>
      ${DealPurchase._asmFlow(calc.asm)}`;
  }

  static _asmFlow(asm) {
    if (!asm) return '<p class="msg warn">Выберите, кто собирает станцию.</p>';
    const when = day => (DealCal.contractDate() ? DealCal.dayRu(day) : `день ${day}`);
    const rows = asm.toAsm
      .map(
        sup =>
          `<span><b>${esc(sup.name)}</b> → на сборке ${when(sup.arr)}${asm.late.includes(sup) ? ' <em class="warn-t">последним</em>' : ''}</span>`,
      )
      .join('');
    return `<div class="dl-asm">${rows}
        <span><b>${esc(asm.A.name)}</b>: контейнер готов ${when(asm.cRdy)}</span>
        <span class="dl-asm-t">Сборка ${when(asm.start)} — ${when(asm.end)} → станция у заказчика <b>${when(asm.arr)}</b></span></div>`;
  }
}

/** Карточка поставщика на вкладке «Закупка». */
export class DealSupplierCard {
  static WHERE_Q =
    'В России — поставщик сам ввёз оборудование и продаёт его здесь (цены с НДС, таможни нет). Ввозим сами — покупаем за границей и сами растаможиваем: укажите, откуда везём.';

  /**
   * @param {object} calc расчёт сделки
   * @param {number} index номер поставщика
   */
  constructor(calc, index) {
    this.calc = calc;
    this.k = index;
    this.deal = DealState.deal();
    this.sup = this.deal.sup[index];
    this.cs = calc.sup[index];
    this.path = `sup.${index}`;
    this.ru = /^росс/i.test(this.sup.country || '');
    this.multi = this.deal.sup.length > 1;
  }

  _where() {
    const sup = this.sup;
    if (sup.where === 'ru' || sup.where === 'imp') return sup.where;
    if (this.ru) return 'ru';
    return sup.country ? 'imp' : '';
  }

  /**
   * Карточка.
   * @returns {string}
   */
  html() {
    const where = this._where();
    return `<div class="dl-card dl-sup">
        ${this._head(where)}
        <p class="dl-dirn">${this._dirNote()}
          ${this._whereNote(where)}</p>
        ${this._items()}
        ${this._vatSeg()}
        <div class="dl-sub"><h5>Сроки поставки</h5>
          ${this.cs.isAsm ? this._asmTerms() : this._terms()}</div>
        <div class="dl-sub"><h5>Оплата поставщику ${DealFmt.help('Доли от стоимости оборудования (с комиссией за перевод). Последний этап — остаток до 100 %. Перевозка, страхование, таможня и брокер оплачиваются перед отгрузкой.')}</h5>${DealPay.supplier(this.calc, this.k)}</div>
        ${this._logLink()}
        ${this._more()}
        <div class="dl-supf"><span>Закупка у поставщика</span><b>${DealFmt.rub(this.cs.equip)}</b></div>
      </div>`;
  }

  _head(where) {
    const path = this.path;
    const name = DealCombo.html('Поставщик', `${path}.name`, {
      ph: 'Начните вводить или выберите из списка ▾',
      q: 'Производитель, дистрибьютор или импортёр. Список — поставщики из справочника и производители позиций КП; можно вписать любого.',
    });
    const seg = `<span class="dl-seg"><button type="button" class="${where === 'ru' ? 'on' : ''}" data-dlx="where" data-k="${this.k}" data-v="ru">В России</button><button type="button" class="${where === 'imp' ? 'on' : ''}" data-dlx="where" data-k="${this.k}" data-v="imp">Ввозим сами</button></span>`;
    const country =
      where === 'imp'
        ? DealCombo.html('Откуда везём', `${path}.country`, {
            ph: 'Страна отгрузки, например Китай',
            q: 'Страна, откуда везём оборудование: Беларусь, Казахстан и др. ЕАЭС — без пошлины; остальные — пошлина по коду ТН ВЭД.',
          })
        : '';
    const del = this.multi
      ? `<button type="button" class="icon dl-del" data-dlx="delsup" data-k="${this.k}" aria-label="Убрать поставщика" title="Убрать поставщика: его позиции перейдут к первому">✕</button>`
      : '';
    return `<div class="dl-suph">
          ${name}
          <div class="f dl-f dl-where"><span>Где покупаем${DealFmt.help(DealSupplierCard.WHERE_Q)}</span>
            ${seg}</div>
          ${country}
          ${del}</div>`;
  }

  _dirNote() {
    const sup = this.sup;
    const known = DealSuppliers.dir(sup.name);
    if (known)
      return '<span class="ok-t">✓ Из справочника</span> — условия подставлены, изменения сохраняются в справочник.';
    if (String(sup.name || '').trim())
      return 'Новый поставщик — сохранится в справочник, в следующий раз выберите его из списка.';
    return 'Введите первые буквы или нажмите «▾» — список поставщиков из справочника и производителей позиций.';
  }

  _whereNote(where) {
    if (where === 'ru') return ' · покупаем в России: таможни нет, НДС поставщика — к вычету';
    if (where !== 'imp') return ' · выберите, где покупаем';
    if (!this.sup.country) return ' · укажите, откуда везём';
    return this.sup.cusMode === 'eaeu'
      ? ' · из ЕАЭС: без пошлины, НДС при ввозе — к вычету'
      : ' · ввозим сами: таможня — на вкладке «Таможня»';
  }

  _items() {
    const lines = KitDoc.lines(S).filter(
      line => String(line.name || '').trim() && DealSuppliers.of(line.id) === this.sup.id,
    );
    if (!lines.length) {
      const text = this.multi
        ? 'Позиций нет — у позиции выберите этого поставщика в другой карточке.'
        : 'В КП нет позиций.';
      return `<p class="muted dl-noitems">${text}</p>`;
    }
    return `<table class="dl-it"><thead><tr><th>Позиция</th><th class="num">Кол-во</th><th>Цена закупки за ед.</th><th class="num">Сумма, ₽</th>${this.multi ? '<th>Поставщик</th>' : ''}</tr></thead><tbody>
          ${lines.map(line => this._itemRow(line)).join('')}
          </tbody></table>`;
  }

  _itemRow(line) {
    const sum = this._lineSum(line);
    const sub = DealSupplierCard._itemSub(line);
    const cls = [line.opt ? 'dl-opt' : '', line.cost ? '' : 'need'].filter(Boolean).join(' ');
    const mark = line.opt ? '<i class="dl-optm">доп.</i>' : '';
    return `<tr${cls ? ` class="${cls}"` : ''}><td class="c-nm"><b>${mark}${esc(line.name)}</b>${sub}</td><td class="num">${esc(line.qty)}</td>
              <td class="c-cost">${DealSupplierCard._costIn(line)}</td>
              <td class="num c-sum">${line.cost ? Fmt.rub(sum) : '—'}</td>
              ${this.multi ? this._mapCell(line) : ''}</tr>`;
  }

  _lineSum(line) {
    if (!line.cost) return 0;
    const rate = Currency.rate(line.costCur || 'RUB');
    const vatK = this.cs.noVat ? 1 + this.calc.v / DealPurchase.PCT : 1;
    return (line.cost / DealPurchase.KOPECKS) * (+line.qty || 0) * (rate || 0) * vatK;
  }

  // поле закупки: позиция, элемент станции или опция — у каждой свой атрибут (обработчик свой)
  static ATTRS = [
    [line => line.part, 'kitcost', 'kitcur'],
    [line => line.opt, 'optcost', 'optcur'],
  ];

  static _costAttrs(line) {
    const hit = DealSupplierCard.ATTRS.find(([test]) => test(line));
    if (!hit) return [`data-cost-i="${line.i}"`, `data-costcur-i="${line.i}"`];
    return [`data-${hit[1]}="${line.i}.${line.j}"`, `data-${hit[2]}="${line.i}.${line.j}"`];
  }

  static _costIn(line) {
    const src = line.part || line.opt || line.item;
    const text = src._costText ?? (line.cost ? DealFmt.inp(line.cost / DealPurchase.KOPECKS) : '');
    const [costAttr, curAttr] = DealSupplierCard._costAttrs(line);
    const curs = DealTerms.CURS.map(
      cur => `<option${(line.costCur || 'RUB') === cur ? ' selected' : ''}>${cur}</option>`,
    ).join('');
    return `<span class="dl-in cur"><input type="text" inputmode="decimal" ${costAttr} value="${esc(text)}" placeholder="цена из счёта" aria-label="Цена закупки за единицу"${line.cost ? '' : ' class="need"'}><select ${curAttr} aria-label="Валюта закупки">${curs}</select></span>`;
  }

  static _itemSub(line) {
    if (line.part) return `<small>в составе «${esc(line.of)}»</small>`;
    if (line.opt) return `<small>к «${esc(line.of)}»</small>`;
    return line.maker ? `<small>${esc(line.maker)}</small>` : '';
  }

  _mapCell(line) {
    const options = this.deal.sup
      .map(
        (sup, j) =>
          `<option value="${esc(sup.id)}"${sup.id === this.sup.id ? ' selected' : ''}>${esc(this.calc.sup[j].name)}</option>`,
      )
      .join('');
    return `<td><select data-dlmap="${esc(line.id)}" aria-label="Поставщик позиции">${options}</select></td>`;
  }

  _vatSeg() {
    if (!this.ru) return '';
    const noVat = this.cs.noVat;
    return `<div class="dl-inl"><span class="dl-lab">Цены в счёте</span><span class="dl-seg"><button type="button" class="${noVat ? '' : 'on'}" data-dlx="novat" data-k="${this.k}" data-v="0">с НДС</button><button type="button" class="${noVat ? 'on' : ''}" data-dlx="novat" data-k="${this.k}" data-v="1">без НДС</button></span>${DealFmt.help('НДС поставщика уменьшает НДС к уплате (вычет). Если в счёте цены без НДС, программа добавит НДС к платежу и учтёт его в вычете.')}</div>`;
  }

  _day(day) {
    return DealCal.contractDate() ? ` · ${DealCal.dayRu(day)}` : '';
  }

  _asmTerms() {
    const { cs, calc, path } = this;
    const prod = DealFmt.field('Контейнер готов через', `${path}.prod`, {
      calc,
      int: true,
      date: { base: 0, val: cs.prod },
      q: 'Сколько дней от заказа до готовности контейнера у производителя. Сборка начнётся, когда готов контейнер и приехали все элементы.',
    });
    const ship = DealFmt.field('Доставка станции заказчику', `${path}.ship`, {
      calc,
      int: true,
      date: { base: cs.rdy, val: cs.ship },
      q: 'Сколько дней едет собранная станция от производителя контейнера до объекта заказчика.',
    });
    return `<div class="dl-g">${prod}${ship}</div>
          <p class="dl-tl"><span>Контейнер готов — <b>день ${cs.cRdy}</b>${this._day(cs.cRdy)}</span><i>→</i><span>Сборка — <b>дни ${cs.asmStart}–${cs.rdy}</b></span><i>→</i><span>Станция у заказчика — <b>день ${cs.arr}</b>${this._day(cs.arr)}</span></p>`;
  }

  _terms() {
    const { cs, calc, path } = this;
    const prod = DealFmt.field('Готово к отгрузке через', `${path}.prod`, {
      calc,
      int: true,
      date: { base: 0, val: cs.prod },
      q: 'Сколько дней от заказа (подписания договора) до готовности оборудования на складе поставщика. Можно выбрать дату — дни посчитаются сами.',
    });
    const ship = DealFmt.field(
      cs.toAsm ? `Доставка на сборку к «${calc.asm.A.name}»` : 'Доставка до заказчика',
      `${path}.ship`,
      {
        calc,
        int: true,
        date: { base: cs.rdy, val: cs.ship },
        q: cs.toAsm
          ? 'Сколько дней едут элементы от склада поставщика до производителя контейнера, где собирают станцию.'
          : 'Сколько дней едет груз от склада поставщика до объекта заказчика, включая таможню. Дата — когда груз будет у заказчика.',
      },
    );
    return `<div class="dl-g">${prod}${ship}</div>
          <p class="dl-tl"><span>Заказ — <b>день 0</b>${this._day(0)}</span><i>→</i><span>Готово к отгрузке — <b>день ${cs.rdy}</b>${this._day(cs.rdy)}</span><i>→</i><span>${cs.toAsm ? 'На сборке' : 'У заказчика'} — <b>день ${cs.arr}</b>${this._day(cs.arr)}</span></p>`;
  }

  _logLink() {
    const customs = this.cs;
    const what = DealSupplierCard._shipWhat(customs);
    const sum = customs.L + customs.Lru + customs.ins;
    return `<div class="dl-sub dl-lglink"><span>Перевозка${this.ru ? '' : ', страхование'} и доставка ${what} — на вкладке «Логистика»${sum > 0 ? `: <b>${Fmt.rub(sum)}</b>` : ''}</span><button type="button" class="btn ghost" data-dlx="step" data-id="log">Открыть «Логистику» →</button></div>`;
  }

  static _shipWhat(customs) {
    if (customs.toAsm) return 'на сборку';
    return customs.isAsm ? 'станции до объекта' : 'до объекта';
  }

  _moreSum() {
    const { sup, cs } = this;
    const extra = InputNum.parse(sup.extra && sup.extra.v);
    const fxPct = InputNum.parse(sup.fx);
    return [
      cs.equip && extra ? `прочая закупка ${DealFmt.inp(extra)} ${(sup.extra && sup.extra.cur) || 'RUB'}` : '',
      fxPct ? `комиссия ${DealFmt.inp(fxPct)} %` : '',
      cs.brk ? `брокер ${Fmt.rub(cs.brk)}` : '',
    ]
      .filter(Boolean)
      .map(esc)
      .join(', ');
  }

  _more() {
    const { sup, cs, calc, path, k } = this;
    const auto = `авто ${calc.v}/${DealPurchase.PCT + calc.v}`;
    const fields = [
      DealFmt.field('Прочая закупка у поставщика', `${path}.extra.v`, {
        calc,
        cur: `${path}.extra.cur`,
        q: 'Опции, ЗИП и всё, чего нет в позициях КП.',
      }),
      this.ru
        ? ''
        : DealFmt.field('Комиссия банка или агента', `${path}.fx`, {
            calc,
            unit: '%',
            ph: '1,5',
            q: 'Комиссия за перевод и конвертацию — процент от платежей поставщику в валюте.',
          }),
      DealFmt.field('Брокер, СВХ, сертификация', `${path}.brk.v`, { calc, unit: '₽' }),
      cs.Lru + cs.brk > 0
        ? DealFmt.field('НДС к вычету по услугам в России', `${path}.voRu`, {
            calc,
            unit: '₽',
            auto: cs.ruSuggest,
            autoLabel: auto,
            q: 'НДС в счетах перевозчика и брокера. Если они без НДС — впишите 0.',
          })
        : '',
      sup.vatIn
        ? DealFmt.field('НДС поставщика к вычету', `${path}.vo`, {
            calc,
            unit: '₽',
            auto: cs.suggest,
            autoLabel: auto,
            q: 'НДС в стоимости оборудования — сверьте со счётом-фактурой.',
          })
        : '',
    ];
    return `<details class="dl-more" data-more="sup${k}"${DealFmt.more(`sup${k}`, { open: false })}><summary>Ещё расходы по поставщику <span class="muted">— ${this._moreSum() || 'опции, комиссия за перевод, брокер'}</span></summary>
          <div class="dl-g">${fields.join('\n            ')}</div></details>`;
  }
}
