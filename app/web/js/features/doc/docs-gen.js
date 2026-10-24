import { Templates } from './templates.js';
import { DocData } from './doc-data.js';
import { DocxWriter } from './docx-writer.js';
import { DocxFill } from './docx-fill.js';
import { FileSave } from '../../core/files.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc, today } from '../../core/util.js';
import { S } from '../../core/state.js';

/**
 * «Счёт, спецификация, договор» из сохранённого КП: продавец — из «Наших реквизитов», покупатель и товары — из КП.
 * Счёт — типовой; спецификация — свой шаблон Word или типовая; договор — только свой шаблон (загружает администратор).
 */
export class DocsGen {
  static KINDS = [
    ['invoice', 'Счёт на оплату', 'Типовой счёт с банковскими реквизитами продавца'],
    ['spec', 'Спецификация', 'Своя форма из «Настроек» или типовая'],
    ['contract', 'Договор', 'Только по своему шаблону из «Настроек»'],
  ];
  static TABLE_W = [10, 85, 14, 12, 24, 25];
  static SIGN_W = [1, 1];
  static BANK_W = [95, 17, 58];
  static TITLE = { run: { b: true, sz: 14 }, before: 12, after: 10 };
  static GAP = 8;
  static GAP_SMALL = 6;

  /**
   * Окно выбора документа.
   * @param {string} id КП
   */
  static async open(id) {
    let state;
    let own;
    try {
      [state, own] = await Promise.all([this._state(id), Api.request('/api/requisites')]);
    } catch (error) {
      Toast.show(`Документы не готовы: ${error.message || error}`);
      return;
    }
    if (!own.items.length) {
      Toast.show('Администратор ещё не заполнил «Настройки → Документы → Наши реквизиты»');
      return;
    }
    const modal = new Modal(this._html(state, own));
    modal.d.addEventListener('click', event => this._click(modal, event.target, { state, own }));
  }

  static _state(id) {
    if (id === S.kpId) return Promise.resolve(S);
    return Api.request(`/api/kp/${encodeURIComponent(id)}/state`);
  }

  static _html(state, own) {
    const sellers = own.items
      .map(
        item => `<option value="${esc(item.id)}"${item.id === own.main ? ' selected' : ''}>${esc(item.name)}</option>`,
      )
      .join('');
    const buttons = this.KINDS.map(([kind, label, hint]) => {
      const off = kind === 'contract' && !own.templates.contract;
      return `<button class="btn${kind === 'invoice' ? ' primary' : ''}" type="button" data-dg="${kind}" title="${esc(hint)}"${off ? ' disabled' : ''}>${esc(label)}</button>`;
    }).join('');
    const noContract = own.templates.contract
      ? ''
      : '<p class="muted">Договор появится, когда администратор загрузит свой шаблон Word.</p>';
    return `<h3>Документы по КП № ${esc(state.number || '')}</h3>
      <p class="muted">${esc(state.clientFull || state.client || 'Клиент не указан')}</p>
      <label class="f"><span>Продавец</span><select id="dgSeller">${sellers}</select></label>
      <label class="f"><span>Номер документа</span><input type="text" id="dgNum" value="${esc(state.number || '')}" maxlength="40"></label>
      <div class="row dg-btns">${buttons}</div>${noContract}
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-x>Закрыть</button></div>`;
  }

  static async _click(modal, target, ctx) {
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = target.closest('[data-dg]');
    if (!button) return;
    const seller = ctx.own.items.find(item => item.id === modal.$('#dgSeller').value) || ctx.own.items[0];
    const doc = { number: modal.$('#dgNum').value.trim() || ctx.state.number || '', date: today() };
    const data = new DocData(ctx.state, seller);
    data.currencyNote = await this._currencyNote(ctx.state);
    button.disabled = true;
    try {
      await this._make(button.dataset.dg, data, doc, ctx.own.templates);
    } catch (error) {
      Toast.show(`Документ не собран: ${error.message || error}`);
    }
    button.disabled = false;
  }

  // примечание о валюте — тем же текстом, что в КП по его шаблону (выключено в шаблоне — строки нет)
  static async _currencyNote(state) {
    try {
      const pack = await Templates.pack(state.template || Templates.MAIN);
      const { blocks = {}, texts = {} } = pack.settings || {};
      const cur = KPGen.CURS[(state.pricing && state.pricing.cur) || 'RUB'];
      return blocks.currencyNote && texts.currencyNote && cur
        ? KPGen.fill(texts.currencyNote, { curName: cur.name })
        : '';
    } catch {
      return '';
    }
  }

  static async _make(kind, data, doc, templates) {
    const client = String(data.state.client || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim();
    const name = { invoice: 'Счёт', spec: 'Спецификация', contract: 'Договор' }[kind];
    const file = `${name} № ${doc.number}${client ? ` ${client}` : ''}.docx`;
    if (kind !== 'invoice' && templates[kind]) return this._fromTemplate(kind, data, doc, file);
    const writer = new DocxWriter({ title: `${name} № ${doc.number}`, author: data.seller.name || '' });
    (kind === 'invoice' ? this.invoice : this.spec).call(this, writer, data, doc);
    return FileSave.download(file, await writer.pack());
  }

  static async _fromTemplate(kind, data, doc, file) {
    const tpl = await Api.request(`/api/doctpl/${kind}`, { raw: true });
    const goods = this._goods(new DocxWriter(), data, { frame: 'lines' }).body.join('');
    const { blob, missing } = await DocxFill.fill(await tpl.arrayBuffer(), data.tags(doc), goods);
    FileSave.download(file, blob);
    if (missing.length)
      Toast.show(`В шаблоне есть незнакомые метки — оставлены как есть: ${missing.map(key => `{${key}}`).join(', ')}`);
  }

  /**
   * Счёт на оплату.
   * @param {DocxWriter} writer
   * @param {DocData} data
   * @param {{number: string, date: string}} doc
   * @returns {DocxWriter}
   */
  static invoice(writer, data, doc) {
    const own = data.seller;
    const offer = data.state;
    const basis = `Основание: коммерческое предложение № ${offer.number || ''}${offer.date ? ` от ${KPGen.ruDate(offer.date)}` : ''}`;
    this._bank(writer, own);
    writer.para(`Счёт на оплату № ${doc.number} от ${KPGen.ruDate(doc.date)}`, this.TITLE);
    writer.para(`Поставщик (Исполнитель): ${data.sellerLine()}`);
    writer.para(`Покупатель (Заказчик): ${data.buyerLine()}`);
    writer.para(basis, { after: this.GAP });
    this._goods(writer, data);
    this._sum(writer, data);
    if (data.cur() !== 'RUB' && data.currencyNote) writer.para(data.currencyNote);
    const accountant = own.accountant || own.director || '';
    return writer.table(
      this.SIGN_W,
      null,
      [[`Руководитель ____________ ${own.director || ''}`, `Бухгалтер ____________ ${accountant}`]],
      {
        frame: 'none',
      },
    );
  }

  static _bank(writer, own) {
    const value = key => own[key] || '';
    writer.table(this.BANK_W, null, [
      [`${value('bank')}\nБанк получателя`, 'БИК', value('bik')],
      ['', 'Сч. №', value('corr')],
      [`ИНН ${value('inn')}   КПП ${value('kpp')}\n${value('name')}\nПолучатель`, 'Сч. №', value('account')],
    ]);
  }

  /**
   * Типовая спецификация.
   * @param {DocxWriter} writer
   * @param {DocData} data
   * @param {{number: string, date: string}} doc
   * @returns {DocxWriter}
   */
  static spec(writer, data, doc) {
    const offer = data.state;
    writer.para(`Спецификация № ${doc.number}`, { ...this.TITLE, align: 'center' });
    writer.para('к договору № ________ от «___» ____________ 20___ г.', { align: 'center', after: this.GAP });
    writer.para(`Поставщик: ${data.sellerLine()}`);
    writer.para(`Покупатель: ${data.buyerLine()}`, { after: this.GAP });
    this._goods(writer, data);
    this._sum(writer, data);
    (offer.conditions || []).filter(cond => cond.value).forEach(cond => writer.para(`${cond.label}: ${cond.value}`));
    if (offer.object && offer.object.address) writer.para(`Адрес поставки: ${offer.object.address}`);
    const buyer = offer.clientFull || offer.client || '';
    return writer.table(
      this.SIGN_W,
      null,
      [
        ['Поставщик', 'Покупатель'],
        [data.seller.name || '', buyer],
        [`____________ / ${data.seller.director || ''} /\nМ.П.`, `____________ / ${offer.clientDir || ''} /\nМ.П.`],
      ],
      { frame: 'none' },
    );
  }

  static _goods(writer, data, look = {}) {
    const head = ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена', 'Сумма'];
    const rows = data
      .rows()
      .map((row, index) => [
        { text: String(index + 1), align: 'center' },
        row.name,
        { text: String(row.qty), align: 'center' },
        { text: row.unit, align: 'center' },
        { text: KPGen.money(row.price), align: 'right' },
        { text: KPGen.money(row.sum), align: 'right' },
      ]);
    return writer.table(this.TABLE_W, head, rows, look);
  }

  static _sum(writer, data) {
    const total = data.totals();
    const words = KPGen.words(total.sum, data.cur());
    writer.para(`Итого: ${data.money(total.sum)}`, { align: 'right', run: { b: true } });
    writer.para(data.vatLine(), { align: 'right' });
    writer.para(`Всего наименований ${data.rows().length}, на сумму ${data.money(total.sum)}`, {
      before: this.GAP_SMALL,
    });
    writer.para(words.charAt(0).toUpperCase() + words.slice(1), { run: { b: true }, after: this.GAP });
  }
}
