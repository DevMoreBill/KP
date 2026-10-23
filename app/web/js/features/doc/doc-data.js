/** Данные КП для счёта, спецификации и договора: строки товаров, итоги, реквизиты сторон и метки шаблона Word. */
export class DocData {
  static UNIT = 'шт.';
  static NO_VAT = 'без НДС';
  static COND = { delivery: 'Срок поставки', payment: 'Условия оплаты' };

  /**
   * @param {object} state КП
   * @param {object} seller наше юрлицо из «Наших реквизитов»
   */
  constructor(state, seller) {
    this.state = state;
    this.seller = seller || {};
  }

  /**
   * Строки товаров: позиции и опции с количеством.
   * @returns {{name: string, qty: number, unit: string, price: number, sum: number}[]}
   */
  rows() {
    return (this.state.items || []).flatMap(item => {
      const qty = +item.qty || 0;
      const price = KPGen.netPrice(item);
      const main = { name: item.name || 'Оборудование', qty, unit: DocData.UNIT, price, sum: qty * price };
      const options = (item.options || [])
        .filter(option => option.name && +option.qty > 0)
        .map(option => ({
          name: option.name,
          qty: +option.qty,
          unit: DocData.UNIT,
          price: option.price || 0,
          sum: +option.qty * (option.price || 0),
        }));
      return [main, ...options];
    });
  }

  /**
   * Итоги в копейках: sum, vat, net.
   * @returns {{sum: number, vat: number, net: number}}
   */
  totals() {
    const items = (this.state.items || []).map(item => ({
      qty: +item.qty || 0,
      price: item.price || 0,
      disc: item.disc,
      options: (item.options || [])
        .filter(option => option.name)
        .map(option => ({ qty: +option.qty || 0, price: option.price || 0 })),
    }));
    return KPGen.totals(items, this.rate());
  }

  /**
   * Продавец без НДС (упрощённая система).
   * @returns {boolean}
   */
  noVat() {
    return this.rate() === 0;
  }

  /**
   * Ставка НДС документа: своя у продавца («Наши реквизиты»), иначе — как в КП; «без НДС» — 0.
   * @returns {number}
   */
  rate() {
    const own = this.seller.vat;
    if (own === DocData.NO_VAT) return 0;
    const fixed = own === undefined || own === null || own === '' ? NaN : Number(own);
    return Number.isFinite(fixed) ? fixed : +this.state.vat || 0;
  }

  /**
   * Валюта КП.
   * @returns {string}
   */
  cur() {
    return (this.state.pricing && this.state.pricing.cur) || 'RUB';
  }

  /**
   * Сумма с валютой.
   * @param {number} kop
   * @returns {string}
   */
  money(kop) {
    return `${KPGen.money(kop)} ${KPGen.CURS[this.cur()] ? KPGen.CURS[this.cur()].sh : ''}`.trim();
  }

  /**
   * Строка «В том числе НДС …» или «Без налога (НДС)».
   * @returns {string}
   */
  vatLine() {
    return this.noVat() ? 'Без налога (НДС)' : `В том числе НДС ${this.rate()} %: ${this.money(this.totals().vat)}`;
  }

  /**
   * Значение условия КП по названию.
   * @param {string} label
   * @returns {string}
   */
  cond(label) {
    const found = (this.state.conditions || []).find(cond => cond.label === label);
    return (found && found.value) || '';
  }

  /**
   * Покупатель одной строкой: наименование, ИНН, КПП, адрес.
   * @returns {string}
   */
  buyerLine() {
    const offer = this.state;
    return [
      offer.clientFull || offer.client,
      offer.clientInn && `ИНН ${offer.clientInn}`,
      offer.clientKpp && `КПП ${offer.clientKpp}`,
      offer.clientAddr,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Продавец одной строкой.
   * @returns {string}
   */
  sellerLine() {
    const own = this.seller;
    return [
      own.name,
      own.inn && `ИНН ${own.inn}`,
      own.kpp && `КПП ${own.kpp}`,
      own.address,
      own.phone && `тел. ${own.phone}`,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Метки для своего шаблона Word: {метка} → значение.
   * @param {{number: string, date: string}} doc номер и дата документа
   * @returns {Object<string, string>}
   */
  tags(doc) {
    const offer = this.state;
    const own = this.seller;
    const total = this.totals();
    return {
      номер: doc.number,
      дата: KPGen.ruDate(doc.date),
      номер_кп: offer.number || '',
      дата_кп: offer.date ? KPGen.ruDate(offer.date) : '',
      ...this._buyer(offer),
      ...this._seller(own),
      сумма: this.money(total.sum),
      сумма_прописью: KPGen.words(total.sum, this.cur()),
      ндс: this.noVat() ? DocData.NO_VAT : this.money(total.vat),
      ставка_ндс: this.noVat() ? DocData.NO_VAT : `${this.rate()} %`,
      валюта: this.cur(),
      срок_поставки: this.cond(DocData.COND.delivery),
      оплата: this.cond(DocData.COND.payment),
      адрес_поставки: (offer.object && offer.object.address) || '',
      условия: (offer.conditions || [])
        .filter(cond => cond.value)
        .map(cond => `${cond.label}: ${cond.value}`)
        .join('\n'),
      менеджер: (offer.manager && offer.manager.name) || '',
    };
  }

  _buyer(offer) {
    return {
      покупатель: offer.client || '',
      покупатель_полное: offer.clientFull || offer.client || '',
      покупатель_инн: offer.clientInn || '',
      покупатель_кпп: offer.clientKpp || '',
      покупатель_огрн: offer.clientOgrn || '',
      покупатель_адрес: offer.clientAddr || '',
      покупатель_руководитель: offer.clientDir || '',
      покупатель_должность: offer.clientDirPost || '',
    };
  }

  _seller(own) {
    return {
      продавец: own.name || '',
      продавец_инн: own.inn || '',
      продавец_кпп: own.kpp || '',
      продавец_огрн: own.ogrn || '',
      продавец_адрес: own.address || '',
      продавец_банк: own.bank || '',
      продавец_бик: own.bik || '',
      продавец_счёт: own.account || '',
      продавец_корсчёт: own.corr || '',
      продавец_руководитель: own.director || '',
      продавец_должность: own.directorPost || '',
    };
  }
}
