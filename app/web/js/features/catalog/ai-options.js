import { FEAT } from '../../core/features.js';
import { Str } from '../../core/str.js';
import { S } from '../../core/state.js';
import { Uid, esc } from '../../core/util.js';
import { OptionSale } from '../kp/option-sale.js';
import { Money } from '../../core/money.js';
import { Currency } from '../../core/currency.js';

/**
 * Опции и комплектация из ответа ИИ: аксессуары с ценой (из КП поставщика — закупкой), входящие в состав — «включено»,
 * предлагаемые без цены и опции без цены продажи — с отметкой askPrice (в документ заказчика не попадают),
 * базовая комплектация — блоком описания «Комплектация». Выключатель aiOptions.
 */
export class AiOptions {
  static KINDS = [
    ['auto', 'определит ИИ'],
    ['cost', 'закупка (КП поставщика)'],
    ['rrc', 'РРЦ / цены продажи'],
  ];
  static COMPLECT = /комплектац/i;
  static COMPLECT_LABEL = 'Комплектация';

  /** @returns {boolean} */
  static enabled() {
    return FEAT.on('aiOptions');
  }

  /**
   * Поля ответа ИИ (часть JSON) — для обычного оборудования, не для станций.
   * @param {object} type тип оборудования
   * @returns {string}
   */
  static json(type) {
    if (!this.enabled() || type.station) return '';
    return `,
"priceKind":"cost — цены в исходных данных закупочные (КП, счёт, спецификация поставщика) | rrc — цены продажи или РРЦ (прайс, сайт, буклет) | пустая строка — цен нет",
"price":"цена основного оборудования за единицу числом без пробелов или пустая строка","cur":"RUB | USD | EUR | CNY",
"complect":["что входит в базовую (стандартную) комплектацию поставки"],
"options":[{"name":"дополнительное оборудование, аксессуар или услуга","qty":1,"unit":"шт.","price":"цена за единицу числом или пустая строка","cur":"RUB","included":false}]`;
  }

  /**
   * Правило для ИИ о комплектации и опциях.
   * @param {object} type
   * @returns {string}
   */
  static rule(type) {
    if (!this.enabled() || type.station) return '';
    return ' complect и options — только то, что явно есть в исходных данных: базовая комплектация — в complect; дополнительное оборудование, аксессуары, опции и услуги — в options (included=true, если позиция идёт в составе поставки без отдельной цены); цены и валюту не выдумывай — нет цены в исходных данных, пустая строка.';
  }

  /**
   * Выбор на шаге 3 рядом с «Заполнить карточку»: какие цены в исходных данных («определит ИИ» — что он решил).
   * @param {object} item
   * @param {number} i
   * @param {object|null} answer разобранный ответ ИИ
   * @returns {string}
   */
  static field(item, i, answer) {
    if (!this.enabled()) return '';
    const kind = item._aiPrices || 'auto';
    const said = answer && answer.j ? String(answer.j.priceKind || '').trim() : '';
    const guess = { cost: ': закупка', rrc: ': цены продажи' }[said] || '';
    const opts = this.KINDS.map(
      ([key, label]) =>
        `<option value="${key}"${key === kind ? ' selected' : ''}>${esc(label + (key === 'auto' ? guess : ''))}</option>`,
    ).join('');
    return `<label class="row muted ai-prices">Цены в файле: <select data-aiprices="${i}" aria-label="Какие цены в исходных данных">${opts}</select></label>`;
  }

  /**
   * Опции, комплектация и закупка основной позиции из ответа ИИ.
   * @param {object} item
   * @param {object} data ответ ИИ
   * @returns {{options: number, complect: number, kind: string}}
   */
  static apply(item, data) {
    const none = { options: 0, complect: 0, kind: '' };
    if (!this.enabled() || !data || typeof data !== 'object') return none;
    const kind = this._kind(item, data);
    const complect = this._complect(item, data.complect);
    const options = this._options(item, data.options, kind);
    this._main(item, data, kind);
    return { options, complect, kind };
  }

  static _kind(item, data) {
    const own = item._aiPrices && item._aiPrices !== 'auto' ? item._aiPrices : '';
    return own || (String(data.priceKind || '').trim() === 'cost' ? 'cost' : 'rrc');
  }

  static _cur(value) {
    const cur = String(value || '')
      .trim()
      .toUpperCase();
    return Money.CURS.includes(cur) ? cur : 'RUB';
  }

  static _price(value) {
    const num = Str.num(value);
    return num != null && num > 0 ? num : 0;
  }

  // базовая комплектация — в блок описания «Комплектация» (недостающие строки дописываются)
  static _complect(item, list) {
    const lines = (Array.isArray(list) ? list : []).map(line => String(line || '').trim()).filter(Boolean);
    if (!lines.length) return 0;
    item.features = item.features || [];
    let block = item.features.find(feat => this.COMPLECT.test(feat.label || ''));
    if (!block) {
      block = { id: Uid.next(), label: this.COMPLECT_LABEL, text: '' };
      item.features.push(block);
    }
    const have = Str.norm(block.text || '');
    const add = lines.filter(line => !have.includes(Str.norm(line)));
    if (add.length)
      block.text = [String(block.text || '').trim(), ...add.map(line => `— ${line}`)].filter(Boolean).join('\n');
    return add.length;
  }

  static _options(item, list, kind) {
    item.options = item.options || [];
    const have = new Set(item.options.map(option => Str.norm(option.name)));
    let added = 0;
    for (const raw of Array.isArray(list) ? list : []) {
      const name = String((raw && raw.name) || '').trim();
      if (!name || have.has(Str.norm(name))) continue;
      have.add(Str.norm(name));
      item.options.push(this._option(raw, name, kind));
      added++;
    }
    return added;
  }

  static _option(raw, name, kind) {
    const option = {
      name,
      qty: Math.max(1, Math.round(Str.num(raw.qty) || 1)),
      unit: String(raw.unit || 'шт.'),
      price: 0,
    };
    const price = this._price(raw.price);
    if (raw.included === true && !price) return option; // в составе поставки — «включено»
    if (!price) return { ...option, askPrice: true }; // предлагается, цены нет
    const cur = this._cur(raw.cur);
    if (kind === 'cost') return { ...option, cost: price, costCur: cur, askPrice: true };
    this._sale(option, price, cur);
    return option;
  }

  // цена продажи — в валюте КП, иначе (если можно) своей валютой с пересчётом
  static _sale(option, price, cur) {
    if (cur === Currency.current()) option.price = price;
    else if (OptionSale.enabled()) {
      option.saleCur = cur;
      option.sale = price;
      OptionSale.sync(option);
    } else option.askPrice = true; // другая валюта без пересчёта — цену ставит менеджер
  }

  // закупка основной позиции из КП поставщика — только если не была заполнена
  static _main(item, data, kind) {
    const price = this._price(data.price);
    if (kind !== 'cost' || !price || item.cost > 0) return;
    item.cost = price;
    item.costCur = this._cur(data.cur);
  }

  /**
   * Подпись итога для сообщения «Карточка заполнена».
   * @param {{options: number, complect: number, kind: string}} done
   * @returns {string}
   */
  static note(done) {
    const parts = [];
    if (done.options)
      parts.push(
        `опций и услуг: ${done.options}${done.kind === 'cost' ? ' (цены — закупка, цену продажи поставьте сами)' : ''}`,
      );
    if (done.complect) parts.push(`строк комплектации: ${done.complect}`);
    return parts.length ? ` Добавлено ${parts.join(', ')} — вкладки «Опции и услуги» и «Описание и фото».` : '';
  }

  /** Выбор «Цены в файле». */
  static listen() {
    document.addEventListener('change', event => {
      const field = event.target;
      if (!field.dataset || field.dataset.aiprices == null) return;
      const item = S.items[+field.dataset.aiprices];
      if (item) item._aiPrices = field.value;
    });
  }
}
