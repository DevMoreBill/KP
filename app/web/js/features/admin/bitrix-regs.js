import { AdminApi } from './admin-core.js';
import { BitrixPanel } from './bitrix-panel.js';
import { esc } from '../../core/util.js';

/**
 * «Регламент сделки»: что менеджер обязан заполнить по «Правилам ведения сделки в Битрикс24» — пункт, когда нужен и поле
 * портала (найдено по названию, можно выбрать другое или выключить пункт).
 */
export class BitrixRegs {
  static view = null;

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    if (!BitrixPanel.state.hasUrl) return `<div class="st-card"><p class="muted">${BitrixPanel.NO_URL}</p></div>`;
    const view = this.view;
    if (!view) return '<div class="st-card" id="bxRegs"><p class="muted">Загружаю…</p></div>';
    const fields = [['', '— нет на портале —'], ...view.fields.map(field => [field.code, field.label])];
    const rows = view.items.map(item => this._row(item, fields)).join('');
    return `<div class="st-card" id="bxRegs"><div class="row"><p class="sub" style="margin:0">Регламент оформления сделки</p><span class="sp"></span>
        ${BitrixPanel.chk('id="bxRegsOn"', view.on, 'проверять перед сменой стадии')}</div>
      <p class="muted">Перед переводом сделки на стадию программа показывает окно «Заполните» только с тем, чего не хватает; найденное сама (по КП, экономике, клиенту) — уже заполнено. Поля пунктов видны в карточке сделки во всех воронках. Поле «— нет на портале —» — пункт не проверяется.</p>
      <div class="tzi-tw"><table class="tzi-t bx-rt"><thead><tr><th>Что заполнить</th><th>Когда</th><th>Поле Битрикс24</th><th>Проверять</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="muted">Клиент и контакт сделки — всегда со стадии после первой: телефон и почта компании, ИНН, ФИО, телефон и почта контакта; программа передаёт их в Битрикс24 и привязывает контакт к компании и сделке.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxRegsSave" data-autosave>Сохранить</button></div></div>`;
  }

  static _row(item, fields) {
    const field = item.note
      ? '<span class="muted">заметка сделки</span>'
      : BitrixPanel.sel(`data-bxrg="${esc(item.key)}"`, fields, item.code || '', item.label);
    const auto = !item.note && item.auto && item.code !== item.auto ? ' <em class="muted">выбрано вручную</em>' : '';
    return `<tr><td>${esc(item.label)}${auto}</td><td class="muted">${esc(item.when)}</td><td>${field}</td>
      <td><label class="bx-rck"><input type="checkbox" data-bxro="${esc(item.key)}"${item.off ? '' : ' checked'} aria-label="Проверять: ${esc(item.label)}"></label></td></tr>`;
  }

  /** События вкладки (данные — при первом открытии). */
  static bind() {
    if (!BitrixPanel.state.hasUrl) return;
    if (!this.view) {
      this._load();
      return;
    }
    BitrixPanel.one('#bxRegsSave').onclick = () => this._save();
  }

  static async _load() {
    try {
      this.view = await AdminApi.get('bitrix/regs');
      BitrixPanel.render();
    } catch (error) {
      BitrixPanel.render({ t: `Регламент не загрузился: ${error.message || error}`, err: true });
    }
  }

  static _save() {
    const panel = BitrixPanel;
    const map = {};
    panel.all('[data-bxrg]').forEach(select => {
      const item = this.view.items.find(row => row.key === select.dataset.bxrg);
      if (select.value && select.value !== item.auto) map[item.key] = select.value;
    });
    const off = panel
      .all('[data-bxro]')
      .filter(box => !box.checked)
      .map(box => box.dataset.bxro);
    const body = { on: panel.one('#bxRegsOn').checked, map, off };
    // ответ не отдаётся в run: у регламента своё «on», это не состояние связи
    panel.run(async () => {
      this.view = await AdminApi.post('bitrix/regs', body);
    }, 'Регламент сохранён');
  }
}
