import { esc } from '../../core/util.js';
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
  // заполненные поля — блоками по смыслу; «Служебное» свёрнуто
  static SECTIONS = [
    ['Клиент и источник', /источник|реклам|форма органи|тип компан|регион|город|отдел|обращени/i],
    ['Запрос клиента', /запрош|тема|оборудован/i],
    ['Предложение (из КП)', /бренд|товар|сумм|марж|ткп|сч[её]т|договор|оплат/i],
    ['Служебное', /стади|вероятн|заполняем|дата|время|руководител|ответствен|коммент/i],
  ];
  static SERVICE = 'Служебное';
  // меняет только Битрикс24 — текстом, без поля ввода
  static SYSTEM = /\(сист|заполняем|дата начала|время начала/i;
  static MONEY = /сумм|марж/i;
  static FRACTION = 2;
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
    'iblock_element',
    'employee',
  ]);
  static LONG = 80;
  static CHIPS_MAX = 12;
  static LISTS = new Set(['enumeration', 'crm_status', 'iblock_element', 'employee']);
  static NUMBER = new Set(['double', 'integer']);

  /**
   * Вкладка «Поля Битрикс24»: сверху — чего не хватает для следующей стадии (по регламенту), ниже — заполненные, остальное —
   * под «Все поля Битрикс24 (N)».
   * @param {object} deal ответ /api/crm/deal (fields, users, uf, regsNext)
   * @returns {string} пусто — у воронки нет полей Битрикса
   */
  static body(deal) {
    const fields = deal.fields || [];
    if (!fields.length) return '';
    const values = deal.uf || {};
    const now = this.wanted(deal);
    const twins = this._twins(fields, values);
    const filled = fields.filter(
      field => !now.includes(field) && !twins.has(field) && this._filled(values[field.code]),
    );
    const rest = fields.filter(field => !now.includes(field) && !filled.includes(field));
    const auto = Object.keys(deal.ufAuto || {}).length
      ? '<p class="muted dk-ufnote"><em class="uf-auto">из КП</em> — заполнено программой, можно изменить</p>'
      : '';
    const block = (title, list, cls = '') =>
      list.length
        ? `<section class="dk-ufs${cls}"><p class="sub">${title}</p><div class="dk-f dk-uf">${list.map(field => this._field(field, deal)).join('')}</div></section>`
        : '';
    const next = deal.regsNext;
    const need = next ? block(`Нужно для «${esc(next.label)}»`, now, ' need') : '';
    const more = rest.length
      ? `<details class="dk-ufmore"><summary>Все поля Битрикс24 <span class="muted">(${rest.length})</span></summary>${this._groupsHtml(rest, deal)}</details>`
      : '';
    const empty = !need && !filled.length ? '<p class="muted">Поля пока не заполнены.</p>' : '';
    return `${this._econ(deal)}${need}${this._sections(filled, deal)}${empty}${auto}${more}`;
  }

  // итоги экономики, изменённые в Битрикс24 (по статьям не раскладываются — экономика КП та же, deal_econ.py)
  static _econ(deal) {
    const notes = Object.values(deal.econNotes || {});
    if (!notes.length) return '';
    const number = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    const rows = notes
      .map(
        note =>
          `<li>${esc(note.label)}: в Битрикс24 <b>${number(note.theirs)}</b>, по экономике КП ${number(note.ours)}</li>`,
      )
      .join('');
    return `<section class="dk-ufs need"><p class="sub">Изменено в Битрикс24 — экономика КП не менялась</p><ul class="dk-econ">${rows}</ul><p class="muted">Чтобы итог совпал, поправьте экономику КП; при её изменении значения программы уйдут в Битрикс24.</p></section>`;
  }

  // заполненные — блоками: «Клиент и источник», «Запрос клиента», «Предложение (из КП)», прочее; «Служебное» — свёрнуто
  static _sections(fields, deal) {
    const groups = new Map();
    for (const field of fields) {
      const found = this.SECTIONS.find(([, pattern]) => pattern.test(field.label || field.title || ''));
      const title = found ? found[0] : this.OTHER;
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(field);
    }
    const order = [...this.SECTIONS.map(([title]) => title).filter(title => title !== this.SERVICE), this.OTHER];
    const open = order
      .filter(title => groups.has(title))
      .map(
        title =>
          `<section class="dk-ufs"><p class="sub">${esc(title)}</p><div class="dk-f dk-uf">${groups
            .get(title)
            .map(field => this._field(field, deal))
            .join('')}</div></section>`,
      )
      .join('');
    const service = groups.get(this.SERVICE) || [];
    const folded = service.length
      ? `<details class="dk-ufs dk-ufsv"><summary class="sub">${this.SERVICE} <span class="muted">(${service.length})</span></summary><div class="dk-f dk-uf">${service.map(field => this._field(field, deal)).join('')}</div></details>`
      : '';
    return `${open}${folded}`;
  }

  // одинаковые по названию поля портала («Бренд по Сделке» списком и строкой): на виду — одно, второе — в «Все поля»
  static _twins(fields, values) {
    const seen = new Map();
    const out = new Set();
    for (const field of fields) {
      const key = String(field.label || field.title || '')
        .trim()
        .toLowerCase();
      const other = seen.get(key);
      if (!other) {
        seen.set(key, field);
        continue;
      }
      const keepOther = this.LISTS.has(other.type) || !this._filled(values[field.code]);
      out.add(keepOther ? field : other);
      if (!keepOther) seen.set(key, field);
    }
    return out;
  }

  /**
   * Поля, которых не хватает для следующей стадии и которые можно заполнить в программе.
   * @param {object} deal
   * @returns {object[]}
   */
  static wanted(deal) {
    const codes = new Set((deal.regsNext && deal.regsNext.codes) || []);
    return (deal.fields || []).filter(field => codes.has(field.code) && this.fillable(field, deal.users));
  }

  /**
   * Поля, нужные по регламенту оформления сделки (те, что программа проверяет перед стадиями).
   * @param {object} deal
   * @returns {object[]}
   */
  static needed(deal) {
    return (deal.fields || []).filter(field => field.reg);
  }

  /**
   * Итог для заголовка раздела: сколько нужных (или всех) полей пусто.
   * @param {object} deal
   * @returns {{text: string, empty: number}}
   */
  static note(deal) {
    const values = deal.uf || {};
    const needed = this.needed(deal);
    const list = (needed.length ? needed : deal.fields || []).filter(field => this.EDIT.has(field.type));
    const empty = list.filter(field => !this._filled(values[field.code])).length;
    if (!empty) return { text: '✓ заполнено', empty };
    return { text: `${needed.length ? 'нужных ' : ''}пусто: ${empty}`, empty };
  }

  static _groupsHtml(fields, deal) {
    const values = deal.uf || {};
    return this._groups(fields)
      .map(([title, list]) => {
        const filled = list.filter(field => this._filled(values[field.code])).length;
        const inputs = list.map(field => this._field(field, deal)).join('');
        return `<details class="dk-ufg"><summary>${esc(title)} <span class="muted">${filled} из ${list.length}</span></summary><div class="dk-f dk-uf">${inputs}</div></details>`;
      })
      .join('');
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

  /**
   * Одно поле для ввода (карточка сделки, окно «Заполните»).
   * @param {object} field описание поля портала
   * @param {object} deal {uf, users, ufAuto, regsNext}
   * @returns {string}
   */
  static field(field, deal) {
    return this._field(field, deal);
  }

  /**
   * Поле можно заполнить в программе: известный вид, у списка есть варианты (как DealFields.fillable на сервере).
   * @param {object} field
   * @param {object} users
   * @returns {boolean}
   */
  static fillable(field, users) {
    if (!this.EDIT.has(field.type)) return false;
    if (field.type === 'employee') return Object.keys(users || {}).length > 0;
    return !this.LISTS.has(field.type) || (field.items || []).length > 0;
  }

  static _field(field, deal) {
    const value = (deal.uf || {})[field.code];
    const users = deal.users || {};
    const label = this._label(field, deal, value);
    const state = this._filled(value) ? '' : ' uf-empty';
    if (!this.fillable(field, users) || this.SYSTEM.test(field.label || field.title || ''))
      return `<div class="f dk-ro" title="Это поле заполняется в Битрикс24">${label}<b>${this._text(field, value, users)}</b></div>`;
    if (field.multiple && this.LISTS.has(field.type)) return this._multi(field, value, users, label, state);
    const attrs = `data-uf="${esc(field.code)}" aria-label="${esc(field.label || field.code)}"`;
    return `<label class="f${this._wide(field, value) ? ' dk-wide' : ''}${state}">${label}${this._input(field, value, users, attrs)}</label>`;
  }

  // подпись: название, «₽» у денег, «*» — нужно для следующей стадии, «из КП» — заполнено программой
  static _label(field, deal, value) {
    const mark = this._auto(deal, field.code, value)
      ? ' <em class="uf-auto" title="Заполнено программой по КП — можно изменить">из КП</em>'
      : '';
    const unit = this._isMoney(field) ? ', ₽' : '';
    return `<span>${esc(field.label || field.title || field.code)}${unit}${this._need(deal.regsNext, field.code)}${mark}</span>`;
  }

  // поле нужно по регламенту для следующей стадии
  static _need(next, code) {
    if (!next || !(next.codes || []).includes(code)) return '';
    return ` <b class="uf-req" title="По регламенту — для стадии «${esc(next.label)}»">*</b>`;
  }

  static _auto(deal, code, value) {
    const auto = deal.ufAuto || {};
    return code in auto && JSON.stringify(auto[code]) === JSON.stringify(value) && this._filled(value);
  }

  static _options(field, users) {
    return field.type === 'employee' ? this._people(users) : field.items || [];
  }

  // несколько значений: до CHIPS_MAX вариантов — все кнопками, больше — выбранные и поиск по списку
  static _multi(field, value, users, label, state) {
    const code = esc(field.code);
    const chosen = new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String));
    const items = this._options(field, users);
    const chip = item => {
      const picked = chosen.has(String(item.id));
      return `<button type="button" class="chip sm${picked ? ' on' : ''}" data-ufpick="${code}" data-ufid="${esc(item.id)}" aria-pressed="${picked}">${esc(item.value)}${picked && items.length > this.CHIPS_MAX ? ' ✕' : ''}</button>`;
    };
    if (items.length <= this.CHIPS_MAX)
      return `<div class="f dk-wide uf-multi${state}" role="group">${label}<div class="chips">${items.map(chip).join('')}</div></div>`;
    const chosenItems = items.filter(item => chosen.has(String(item.id)));
    const rest = items
      .filter(item => !chosen.has(String(item.id)))
      .map(item => `<option value="${esc(item.value)}">`)
      .join('');
    const list = `uf-${code}`;
    return `<div class="f dk-wide uf-multi${state}" role="group">${label}<div class="chips">${chosenItems.map(chip).join('')}<input type="text" class="uf-add" data-ufadd="${code}" list="${list}" autocomplete="off" placeholder="＋ добавить — начните вводить" aria-label="Добавить значение"></div><datalist id="${list}">${rest}</datalist></div>`;
  }

  /**
   * Нажата кнопка значения (несколько значений): новое значение поля или null.
   * @param {HTMLElement} button
   * @param {object} deal
   * @returns {{code: string, value: string[]} | null}
   */
  static toggle(button, deal) {
    const code = button.dataset.ufpick;
    const id = button.dataset.ufid;
    const now = (deal.uf || {})[code];
    const list = (Array.isArray(now) ? now : [now]).filter(Boolean).map(String);
    return { code, value: list.includes(id) ? list.filter(one => one !== id) : [...list, id] };
  }

  /**
   * Выбрано значение в поиске (несколько значений): новое значение поля или null (такого в списке нет).
   * @param {HTMLInputElement} input
   * @param {object} deal
   * @returns {{code: string, value: string[]} | null}
   */
  static added(input, deal) {
    const code = input.dataset.ufadd;
    const field = (deal.fields || []).find(row => row.code === code);
    const text = input.value.trim().toLowerCase();
    const item =
      field && this._options(field, deal.users || {}).find(one => String(one.value).trim().toLowerCase() === text);
    if (!item) return null;
    const now = (deal.uf || {})[code];
    const list = (Array.isArray(now) ? now : [now]).filter(Boolean).map(String);
    input.value = '';
    return list.includes(String(item.id)) ? null : { code, value: [...list, String(item.id)] };
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
      iblock_element: () => this._select(field.items || [], value, attrs, field.multiple),
      employee: () => this._select(this._people(users), value, attrs, field.multiple),
      boolean: () => `<input type="checkbox" ${attrs}${String(value) === '1' ? ' checked' : ''}>`,
      date: () => `<input type="date" ${attrs} value="${esc(value || '')}">`,
      datetime: () => `<input type="datetime-local" ${attrs} value="${esc(value || '')}">`,
      money: () =>
        `<input type="text" inputmode="decimal" ${attrs} value="${esc(this._amount(String(value || '').split('|')[0]))}">`,
    };
    if (render[field.type]) return render[field.type]();
    if (this.NUMBER.has(field.type)) {
      const shown = this._isMoney(field) ? this._amount(value) : value || '';
      return `<input type="text" inputmode="decimal" ${attrs} value="${esc(shown)}">`;
    }
    if (this._wide(field, value)) return `<textarea rows="2" maxlength="3000" ${attrs}>${esc(value || '')}</textarea>`;
    return `<input type="${field.type === 'url' ? 'url' : 'text'}" maxlength="3000" ${attrs} value="${esc(Array.isArray(value) ? value.join(', ') : value || '')}">`;
  }

  // деньги — «670 757» (без копеек, если их нет); при сохранении пробелы убираются
  static _isMoney(field) {
    return (field.type === 'money' || this.NUMBER.has(field.type)) && this.MONEY.test(field.label || field.title || '');
  }

  static _amount(raw) {
    const number = Number(
      String(raw ?? '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
    if (raw === '' || raw == null || !Number.isFinite(number)) return String(raw ?? '');
    return number.toLocaleString('ru-RU', { maximumFractionDigits: this.FRACTION }).replace(/\s/g, ' ');
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
