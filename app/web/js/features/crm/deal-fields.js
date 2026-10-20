/**
 * Поля сделки Битрикс24 в карточке сделки: по группам, ввод по виду поля (список, дата, число, сотрудник, флажок); файлы и
 * поля, которые правятся только в Битриксе, — для чтения. Сохраняются сразу при изменении (как прочие поля карточки).
 */
export class DealFieldsView {
  static GROUPS = [
    ['Тендер', /тендер|площадк|закон|подач[аи] заяв|размещени|метки/i],
    ['Сервис', /сервис|инженер|модел|серийн|неисправ|объект|проезд|рем.?зон|деф/i],
    ['Деньги', /сумм|оплат|марж|оборот|задолж|прибыл|предоплат|ндс|план|стоимост|закупк|поставщик/i],
    [
      'Клиент и запрос',
      /источник|реклам|тема|бренд|оборудован|товар|регион|компани|организац|отдел|обращени|заявк|город|клиент/i,
    ],
  ];
  static OTHER = 'Прочее';
  static EDIT = new Set([
    'string',
    'double',
    'integer',
    'money',
    'date',
    'datetime',
    'enumeration',
    'boolean',
    'url',
    'crm_status',
    'employee',
  ]);
  static LONG = 80;
  static NUMBER = new Set(['double', 'integer']);

  /**
   * Раздел карточки или пусто (у воронки нет полей Битрикса).
   * @param {object} deal ответ /api/crm/deal (fields, users, uf)
   * @returns {string}
   */
  static html(deal) {
    const fields = deal.fields || [];
    if (!fields.length) return '';
    const values = deal.uf || {};
    const groups = this._groups(fields)
      .map(([title, list], index) => {
        const filled = list.filter(field => this._filled(values[field.code])).length;
        const inputs = list.map(field => this._field(field, values[field.code], deal.users || {})).join('');
        return `<details class="dk-ufg"${index === 0 ? ' open' : ''}><summary>${esc(title)} <span class="muted">${filled} из ${list.length}</span></summary><div class="dk-f dk-uf">${inputs}</div></details>`;
      })
      .join('');
    return `<section class="md-s dk-ufs"><div class="md-h"><p class="sub">Поля Битрикс24</p></div>${groups}</section>`;
  }

  static _groups(fields) {
    const out = new Map();
    for (const field of fields) {
      const found = this.GROUPS.find(([, pattern]) => pattern.test(field.label || field.title || ''));
      const title = found ? found[0] : this.OTHER;
      if (!out.has(title)) out.set(title, []);
      out.get(title).push(field);
    }
    const order = [...this.GROUPS.map(([title]) => title).reverse(), this.OTHER];
    return order.filter(title => out.has(title)).map(title => [title, out.get(title)]);
  }

  static _filled(value) {
    return Array.isArray(value) ? value.length > 0 : value != null && value !== '' && value !== '0';
  }

  static _field(field, value, users) {
    const label = `<span>${esc(field.label || field.title || field.code)}</span>`;
    if (!this.EDIT.has(field.type))
      return `<div class="f dk-ro">${label}<b>${this._text(field, value, users)}</b></div>`;
    const attrs = `data-uf="${esc(field.code)}" aria-label="${esc(field.label || field.code)}"`;
    return `<label class="f${this._wide(field, value) ? ' dk-wide' : ''}">${label}${this._input(field, value, users, attrs)}</label>`;
  }

  static _wide(field, value) {
    return (
      field.type === 'string' && (String(value || '').length > this.LONG || /коммент|описани/i.test(field.label || ''))
    );
  }

  static _input(field, value, users, attrs) {
    const render = {
      enumeration: () => this._select(field.items || [], value, attrs, field.multiple),
      crm_status: () => this._select(field.items || [], value, attrs, field.multiple),
      employee: () => this._select(this._people(users), value, attrs, field.multiple),
      boolean: () => `<input type="checkbox" ${attrs}${String(value) === '1' ? ' checked' : ''}>`,
      date: () => `<input type="date" ${attrs} value="${esc(value || '')}">`,
      datetime: () => `<input type="datetime-local" ${attrs} value="${esc(value || '')}">`,
      money: () => `<input type="text" inputmode="decimal" ${attrs} value="${esc(String(value || '').split('|')[0])}">`,
    };
    if (render[field.type]) return render[field.type]();
    if (this.NUMBER.has(field.type))
      return `<input type="text" inputmode="decimal" ${attrs} value="${esc(value || '')}">`;
    if (this._wide(field, value)) return `<textarea rows="2" maxlength="3000" ${attrs}>${esc(value || '')}</textarea>`;
    return `<input type="${field.type === 'url' ? 'url' : 'text'}" maxlength="3000" ${attrs} value="${esc(Array.isArray(value) ? value.join(', ') : value || '')}">`;
  }

  static _people(users) {
    return Object.entries(users)
      .map(([id, name]) => ({ id, value: name }))
      .sort((one, two) => one.value.localeCompare(two.value, 'ru'));
  }

  static _select(items, value, attrs, multiple) {
    const chosen = new Set((Array.isArray(value) ? value : [value]).map(String));
    const options = items
      .map(
        item =>
          `<option value="${esc(item.id)}"${chosen.has(String(item.id)) ? ' selected' : ''}>${esc(item.value)}</option>`,
      )
      .join('');
    return multiple
      ? `<select multiple size="3" ${attrs}>${options}</select>`
      : `<select ${attrs}><option value="">—</option>${options}</select>`;
  }

  static _text(field, value, users) {
    if (field.type === 'file') return esc((value || []).map(file => file.name || `файл ${file.id}`).join(', ') || '—');
    const list = Array.isArray(value) ? value : [value];
    const named = list.filter(Boolean).map(one => users[one] || one);
    return esc(named.join(', ') || '—');
  }

  /**
   * Значение поля из ввода (для сохранения).
   * @param {HTMLElement} input
   * @param {object} deal
   * @returns {{code: string, value: *}}
   */
  static read(input, deal) {
    const code = input.dataset.uf;
    const field = (deal.fields || []).find(row => row.code === code) || {};
    if (input.type === 'checkbox') return { code, value: input.checked ? '1' : '0' };
    if (input.multiple) return { code, value: [...input.selectedOptions].map(option => option.value) };
    if (field.type === 'money') return { code, value: this._money(input.value, (deal.uf || {})[code]) };
    const text = input.value.trim();
    return { code, value: this.NUMBER.has(field.type) ? text.replace(/\s/g, '').replace(',', '.') : text };
  }

  static _money(text, old) {
    const amount = String(text || '')
      .replace(/\s/g, '')
      .replace(',', '.');
    if (!amount) return '';
    const currency = String(old || '').split('|')[1] || 'RUB';
    return `${amount}|${currency}`;
  }
}
