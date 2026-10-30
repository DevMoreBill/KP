import { DealValues } from './deal-values.js';
import { DealPresets } from './deal-presets.js';
import { InputNum } from './input-num.js';
import { DefRegistry } from '../../core/defaults.js';

/**
 * Условия и данные сделки без интерфейса: валюты, страны поставщиков и их таможенный режим, события оплаты, виды банковских
 * гарантий и документации, новый поставщик и новый расчёт из «Умолчаний», расчёт прежних версий, сроки в днях.
 */
export class DealTerms {
  static CURS = ['RUB', 'CNY', 'USD', 'EUR'];
  static LISTS = { 'deal.countries': () => DealTerms.COUNTRIES };
  static EAEU = ['Беларусь', 'Казахстан', 'Армения', 'Киргизия'];
  static COUNTRIES = [
    ['Китай', 'CNY'],
    ['Турция', 'USD'],
    ['Германия', 'EUR'],
    ['Италия', 'EUR'],
    ['Россия', 'RUB'],
    ['Беларусь', 'RUB'],
    ['Казахстан', 'RUB'],
    ['Индия', 'USD'],
    ['Корея', 'USD'],
    ['Япония', 'USD'],
    ['США', 'USD'],
    ['Чехия', 'EUR'],
    ['Польша', 'EUR'],
    ['Испания', 'EUR'],
    ['Франция', 'EUR'],
    ['Швеция', 'EUR'],
    ['Финляндия', 'EUR'],
    ['Великобритания', 'EUR'],
    ['Тайвань', 'USD'],
    ['Вьетнам', 'USD'],
    ['ОАЭ', 'USD'],
    ['Армения', 'RUB'],
    ['Киргизия', 'RUB'],
  ];
  // этапы оплаты заказчика: событие + дней после него
  static EVENTS = {
    sign: 'после подписания договора',
    ready: 'при готовности к отгрузке',
    delivery: 'после поставки',
    pnr: 'после ПНР',
  };
  static BG_TYPES = { adv: 'На возврат аванса', perf: 'Исполнения договора', warr: 'Гарантийных обязательств' };
  static DOC_KINDS = { pd: 'проектная', rd: 'рабочая', id: 'исполнительная' };
  // этапы оплаты поставщику: событие поставки + дней после него; последний этап — остаток до 100 %
  static SUP_EVENTS = {
    order: 'при заказе',
    ready: 'перед отгрузкой (готовность)',
    delivery: 'после поставки',
    pnr: 'после шефмонтажа и ПНР',
  };
  static BG_RATE = 3;
  static SUP_ADV = 20;
  static DEFER = 30;
  static WEEK = 7;
  static WORK_WEEK = 5;
  static CENTS = 100;
  static TEENS = 100;
  static DECADE = 10;
  static FEW_MIN = 2;
  static FEW_MAX = 4;
  static TEEN_MIN = 10;
  static TEEN_MAX = 20;
  static ELEVEN = 11;
  static DAY_WORDS = {
    work: ['рабочий день', 'рабочих дня', 'рабочих дней'],
    cal: ['календарный день', 'календарных дня', 'календарных дней'],
  };

  /**
   * Страна поставщика → таможенный режим, НДС при ввозе, валюта.
   * @param {string} country
   * @returns {{cusMode: string, vatIn: boolean, cur: string}|null}
   */
  static countryPreset(country) {
    const name = String(country || '').trim();
    if (!name) return null;
    if (/^росс/i.test(name)) return { cusMode: 'none', vatIn: true, cur: 'RUB' };
    const lower = name.toLowerCase();
    if (this.EAEU.some(row => row.toLowerCase() === lower)) return { cusMode: 'eaeu', vatIn: false, cur: 'RUB' };
    const known = this.COUNTRIES.find(row => row[0].toLowerCase() === lower);
    return { cusMode: 'calc', vatIn: false, cur: known ? known[1] : 'USD' };
  }

  /**
   * Виды документации, отмеченные в расходах: «проектная, рабочая».
   * @param {object} deal
   * @returns {string}
   */
  static docKinds(deal) {
    return Object.keys(this.DOC_KINDS)
      .filter(key => deal && deal.docK && deal.docK[key])
      .map(key => this.DOC_KINDS[key])
      .join(', ');
  }

  /**
   * Ставка банка за гарантию по умолчанию, % годовых.
   * @returns {number}
   */
  static bgRate() {
    return DealValues.num('deal.bgRate', this.BG_RATE);
  }

  /**
   * Этапы оплаты поставщику; у расчётов прежних версий — из «Аванс, %».
   * @param {object} supplier
   * @returns {object[]}
   */
  static supPay(supplier) {
    if (Array.isArray(supplier.pay) && supplier.pay.length) return supplier.pay;
    const adv = InputNum.parse(supplier.adv);
    if (adv > 0) {
      return [
        { name: 'Аванс', pct: String(supplier.adv), ev: 'order', off: '0' },
        { name: 'Остаток', ev: 'ready', off: '0' },
      ];
    }
    return [{ name: 'Оплата', ev: 'ready', off: '0' }];
  }

  static _def(key) {
    return DefRegistry.value(key);
  }

  /**
   * Новый поставщик: страна, сроки, НДС при ввозе и этапы оплаты — из «Умолчаний».
   * @param {string} id
   * @param {object} [def] последние значения менеджера
   * @returns {object}
   */
  static newSupplier(id, def = {}) {
    const country = def.country !== undefined ? def.country : this._def('deal.country', 'Россия') || '';
    const preset = this.countryPreset(country) || { cusMode: 'sum', vatIn: false };
    const supplier = {
      id,
      name: '',
      country,
      vatIn: preset.vatIn,
      ...this._timing(def),
      extra: { v: '', cur: 'RUB' },
      log: { v: '', cur: 'RUB' },
      logRu: { v: '' },
      cusMode: preset.cusMode,
      cus: { v: '', cur: 'RUB' },
      vi: '',
      vo: '',
      duty: '',
      ivat: this._def('deal.ivat', '22') || '22',
      fee: '',
      ins: '',
      fx: '',
      brk: { v: '' },
      voRu: '',
    };
    const pay = this._def('deal.supPay', null);
    if (pay && DealPresets.SUP[pay]) supplier.pay = JSON.parse(JSON.stringify(DealPresets.SUP[pay][1]));
    return supplier;
  }

  static _timing(def) {
    return {
      adv: def.adv ?? String(DealValues.num('deal.supAdv', this.SUP_ADV)),
      prod: def.prod ?? this._def('deal.prod', '40') ?? '',
      ship: def.ship ?? this._def('deal.ship', '40') ?? '',
    };
  }

  /**
   * Новый расчёт сделки: поставщик, оплата заказчика, налог, цель — из «Умолчаний» и последних значений менеджера.
   * @param {object} [def]
   * @returns {object}
   */
  static blank(def = {}) {
    return {
      v: 3,
      touched: false,
      over: { price: '', vat: '' },
      rates: {},
      sup: [this.newSupplier('s1', def)],
      map: {},
      mnt: '',
      pnr: '',
      oth: '',
      doc: '',
      docK: {},
      vo: '',
      warr: '',
      bonus: '',
      tax: def.tax ?? this._def('deal.tax', '25') ?? '25',
      cust: { tr: this._customerStages(def) },
      money: def.money ?? '',
      days: {},
      target: { type: 'margin', v: this._def('deal.target', null) || '' },
    };
  }

  static _customerStages(def) {
    const adv = def.cAdv && +def.cAdv > 0 ? String(def.cAdv) : '';
    const preset = this._def('deal.custPay', null);
    const defer = def.defer ?? String(DealValues.num('deal.defer', this.DEFER));
    if (adv) {
      return [
        { pct: adv, ev: 'sign', off: '0' },
        { pct: '', ev: 'delivery', off: defer },
      ];
    }
    if (preset && DealPresets.CUST[preset]) return JSON.parse(JSON.stringify(DealPresets.CUST[preset][1]));
    return [{ pct: '', ev: 'delivery', off: defer }];
  }

  /**
   * Расчёт прежней версии (v1, v2) → v3: недостающие поля, график оплаты заказчика этапами.
   * @param {object} deal
   * @returns {object}
   */
  static upgrade(deal) {
    if (!deal) return deal;
    if (deal.v === 2) {
      deal.sup.forEach(supplier => {
        if (supplier.country == null) supplier.country = '';
      });
      deal.v = 3;
      return deal;
    }
    if (deal.v >= 3) return deal;
    deal.sup = (deal.sup || []).map(supplier => {
      const upgraded = { ...this.newSupplier(supplier.id), ...supplier };
      if (!supplier.pay) delete upgraded.pay; // этапы — из аванса прежней версии
      return upgraded;
    });
    deal.cust = { tr: this._oldStages(deal.cust || {}) };
    Object.assign(deal, {
      pnr: deal.pnr ?? '',
      warr: deal.warr ?? '',
      bonus: deal.bonus ?? '',
      tax: deal.tax ?? '25',
      target: deal.target || { type: 'margin', v: '' },
      v: 3,
    });
    return deal;
  }

  static _oldStages(cust) {
    const adv = InputNum.parse(cust.adv) || 0;
    const last = { pct: '', ev: 'delivery', off: String(cust.defer ?? '30') };
    if (!(adv > 0)) return [last];
    return [{ pct: String(cust.adv), ev: 'sign', off: String(cust.day || '0') }, last];
  }

  /**
   * День после base через n дней; рабочие — по производственному календарю (kpData.addWork), иначе ×7/5.
   * @param {object} kpData данные КП для расчёта (addWork)
   * @param {number} base
   * @param {number} days
   * @param {string} kind '' | 'work'
   * @returns {number}
   */
  static addDays(kpData, base, days, kind) {
    const count = +days || 0;
    if (kind !== 'work' || !count) return base + count;
    return kpData && kpData.addWork
      ? kpData.addWork(base, count)
      : base + Math.ceil((count * this.WEEK) / this.WORK_WEEK);
  }

  /**
   * «5 рабочих дней», «1 календарный день».
   * @param {number} count
   * @param {string} kind '' | 'work'
   * @returns {string}
   */
  static daysText(count, kind) {
    const words = this.DAY_WORDS[kind === 'work' ? 'work' : 'cal'];
    return `${count} ${words[this._form(count)]}`;
  }

  static _form(count) {
    const last = count % this.DECADE;
    const lastTwo = count % this.TEENS;
    if (last === 1 && lastTwo !== this.ELEVEN) return 0;
    const teen = lastTwo >= this.TEEN_MIN && lastTwo < this.TEEN_MAX;
    return last >= this.FEW_MIN && last <= this.FEW_MAX && !teen ? 1 : 2;
  }

  /**
   * Процент текстом: «12,5 %».
   * @param {number} pct
   * @returns {string}
   */
  static pctText(pct) {
    return `${(Math.round(pct * this.CENTS) / this.CENTS).toString().replace('.', ',')} %`;
  }
}
