import { AdminApi } from './admin-core.js';
import { BitrixPanel } from './bitrix-panel.js';
import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';

/**
 * «Экономика сделки»: поля раздела «Экономика сделки» карточки сделки Битрикс24 (найдены по настройке карточки портала) и что
 * в каждое пишется из экономики КП (по названию поля; можно выбрать другое или «не заполнять»).
 */
export class BitrixEcon {
  static view = null;

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    if (!FEAT.on('bxEcon'))
      return '<div class="st-card"><p class="muted">Функция «Экономика сделки в Битрикс24» выключена («Настройки → Функции»).</p></div>';
    if (!BitrixPanel.state.hasUrl) return `<div class="st-card"><p class="muted">${BitrixPanel.NO_URL}</p></div>`;
    const view = this.view;
    if (!view) return '<div class="st-card" id="bxEcon"><p class="muted">Загружаю…</p></div>';
    const values = [['', '— не заполнять —'], ...view.values.map(value => [value.key, value.label])];
    const rows = view.rows.map(row => this._row(row, values)).join('');
    const found = view.section
      ? `Раздел «${esc(view.section)}» найден в карточке сделки: полей ${view.rows.filter(row => row.section).length}.`
      : 'Раздел «Экономика сделки» в карточке сделки Битрикс24 не найден — нажмите «Найти раздел и список» или добавьте поле ниже.';
    return `<div class="st-card" id="bxEcon"><div class="row"><p class="sub" style="margin:0">Экономика сделки в Битрикс24</p><span class="sp"></span>
        ${BitrixPanel.chk('id="bxEconOn"', view.on, 'заполнять из экономики КП')}</div>
      <p class="muted">Поля раздела заполняются из экономики последнего КП сделки и уходят в Битрикс24, когда экономика меняется. Статью затрат, изменённую в Битриксе (логистика, монтаж…), программа принимает поправкой в экономику КП и пересчитывает прибыль и маржу; изменённый в Битриксе итог (прибыль, маржа) — только пометкой в карточке сделки.</p>
      <p>${found} <button class="btn sm" type="button" id="bxEconFind">Найти раздел и список</button></p>
      ${rows ? `<div class="tzi-tw"><table class="tzi-t bx-rt"><thead><tr><th>Поле Битрикс24</th><th>Что писать из экономики</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <div class="row" style="margin-top:8px">${BitrixPanel.sel('id="bxEconAdd"', [['', '+ Добавить поле портала…'], ...view.fields.filter(field => !view.rows.some(row => row.code === field.code)).map(field => [field.code, field.label])], '', 'Добавить поле портала')}</div>
      ${this._list(view.list)}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxEconSave" data-autosave>Сохранить</button></div></div>`;
  }

  // список «Оплаты» в «Списках» Битрикс24: элемент на каждую оплату клиента (bitrix_econ_list.py)
  static _list(list) {
    if (!list) return '';
    const found = list.list
      ? `Список «${esc(list.list.name)}» найден${list.link ? `, связь со сделкой — ${esc(list.link)}` : ', но связи со сделкой нет — элементы без привязки'}.`
      : `Список с полями оплаты не найден${list.error ? ` (${esc(list.error)} — дайте вебхуку право «Списки»)` : ''}.`;
    const rows = list.list
      ? `<div class="tzi-tw"><table class="tzi-t bx-rt"><thead><tr><th>Что пишется</th><th>Поле списка</th></tr></thead><tbody>${list.fields
          .map(
            row =>
              `<tr><td>${esc(row.label)}</td><td>${row.field ? esc(row.field) : '<span class="muted">нет в списке</span>'}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '';
    return `<div class="bx-econ-list"><div class="row" style="margin-top:16px"><p class="sub" style="margin:0">Список оплат</p><span class="sp"></span>
        ${BitrixPanel.chk('id="bxEconListOn"', list.on, 'элемент на каждую оплату клиента')}</div>
      <p class="muted">Оплата клиента, отмеченная в «Исполнении» сделки (или пришедшая из 1С), — элемент списка: дата и сумма поступления, поставщик, закупка, доставка и прочие расходы в доле этой оплаты от цены КП, НДС закупки. Закупку, доставку или прочие поправили в элементе — поправка в экономику КП. Список ищется кнопкой «Найти раздел и список».</p>
      <p>${found}</p>${rows}</div>`;
  }

  static _row(row, values) {
    const auto = row.picked && row.key !== row.auto ? ' <em class="muted">выбрано вручную</em>' : '';
    return `<tr><td>${esc(row.label)}${auto}</td><td>${BitrixPanel.sel(`data-bxec="${esc(row.code)}"`, values, row.key, row.label)}</td></tr>`;
  }

  /** События вкладки (данные — при первом открытии). */
  static bind() {
    if (!FEAT.on('bxEcon') || !BitrixPanel.state.hasUrl) return;
    if (!this.view) {
      this._load();
      return;
    }
    BitrixPanel.one('#bxEconSave').onclick = () => this._save();
    BitrixPanel.one('#bxEconFind').onclick = () => this._find();
    BitrixPanel.one('#bxEconAdd').onchange = event => this._add(event.target.value);
  }

  static async _load() {
    try {
      this.view = await AdminApi.get('bitrix/econ');
      BitrixPanel.render();
    } catch (error) {
      BitrixPanel.render({ t: `Экономика сделки не загрузилась: ${error.message || error}`, err: true });
    }
  }

  static _find() {
    BitrixPanel.run(
      async () => {
        this.view = await AdminApi.post('bitrix/econ/find', {});
      },
      () => {
        const list = this.view.list && this.view.list.list;
        const section = this.view.section ? `раздел «${this.view.section}»` : 'раздела нет';
        return `Найдено: ${section}, ${list ? `список «${list.name}»` : 'списка оплат нет'}`;
      },
    );
  }

  static _add(code) {
    const field = this.view.fields.find(one => one.code === code);
    if (!field) return;
    this.view.rows.push({ code, label: field.label, key: '', auto: '', picked: true, section: false });
    BitrixPanel.render();
  }

  static _save() {
    const map = {};
    BitrixPanel.all('[data-bxec]').forEach(select => {
      const row = this.view.rows.find(one => one.code === select.dataset.bxec);
      if (row.picked || select.value !== row.auto) map[row.code] = select.value;
    });
    const listOn = BitrixPanel.one('#bxEconListOn');
    const body = { on: BitrixPanel.one('#bxEconOn').checked, map, ...(listOn ? { listOn: listOn.checked } : {}) };
    // ответ не отдаётся в run: у раздела своё «on», это не состояние связи
    BitrixPanel.run(async () => {
      this.view = await AdminApi.post('bitrix/econ', body);
    }, 'Экономика сделки сохранена');
  }
}
