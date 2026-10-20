/** Форма категории оборудования: основное, параметры таблицей с галочками, быстрые опции, кнопки фото, JSON. */
export class TypeForm {
  static OTHER = 'Прочее';
  static KEY_LEN = 30;
  static FLAGS = ['num', 'range', 'facet', 'kpi'];
  static ROLES = [
    ['equipment', 'Оборудование'],
    ['accessory', 'Комплектующие и опции'],
  ];

  /**
   * Глубокая копия.
   * @param {object} value
   * @returns {object}
   */
  static clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Код параметра латиницей из названия.
   * @param {string} label
   * @returns {string}
   */
  static key(label) {
    return (
      (translit(label) || 'param')
        .replace(/-+(.)/g, (match, char) => char.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/^\d+/, '')
        .slice(0, this.KEY_LEN) || 'param'
    );
  }

  /**
   * Встроенная категория с этим кодом.
   * @param {string} id
   * @returns {object|null}
   */
  static builtin(id) {
    return ((TYPES_BUILTIN && TYPES_BUILTIN.types) || []).find(type => type.id === id) || null;
  }

  // правило распознавания простое (слова и «любое окончание»), если в нём нет групп, якорей и прочих знаков регулярных выражений
  static _simple(match) {
    return !/[()^$.[\]{}?+*\\]/.test(String(match || '').replace(/\\S\*|\\s\+/g, ''));
  }

  /**
   * Быстрая опция — массивом [название, коротко, единица].
   * @param {Array|object} option
   * @returns {string[]}
   */
  static opt(option) {
    if (Array.isArray(option)) return [option[0] || '', option[1] || '', option[2] || ''];
    return [(option && option.name) || '', (option && option.short) || '', (option && option.unit) || ''];
  }

  static _fixField(field, used) {
    const base = field.key || this.key(field.label);
    let key = base;
    let count = 1;
    while (used.has(key)) key = base + ++count;
    used.add(key);
    field.key = key;
    delete field._new;
    for (const flag of this.FLAGS) if (!field[flag]) delete field[flag];
    if (!field.unit) delete field.unit;
    if (!field.values || !field.values.length) delete field.values;
    return field;
  }

  /**
   * Категория для сохранения: опции — массивы, ключи параметров — латиницей и без повторов.
   * @param {object} type
   * @returns {object}
   */
  static out(type) {
    const copy = this.clone(type);
    const used = new Set();
    copy.fields = (copy.fields || [])
      .filter(field => String(field.label || '').trim())
      .map(field => this._fixField(field, used));
    copy.options = (copy.options || [])
      .map(option => this.opt(option))
      .filter(row => row[0].trim())
      .map(row => (row[2] ? row : [row[0], row[1]]));
    if (!copy.fields.some(field => field.key === copy.main)) copy.main = (copy.fields[0] || {}).key || '';
    return copy;
  }

  static _inp(path, value, opts = {}) {
    return `<input type="text" data-ty="${path}" value="${esc(value ?? '')}"${opts.ph ? ` placeholder="${esc(opts.ph)}"` : ''}${opts.list ? ` list="${opts.list}"` : ''}>`;
  }

  static _lbl(title, html, hint) {
    return `<label class="ty-f"><span>${title}</span>${html}${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
  }

  static _checks(type, field, i) {
    return `<td class="c"><input type="checkbox" data-tyb="fields.${i}.num" ${field.num ? 'checked' : ''} title="Числовое значение (можно сравнивать, фильтр «от–до»)"></td>
      <td class="c"><input type="checkbox" data-tyfilter="${i}" ${field.facet || field.range ? 'checked' : ''} title="Фильтр в каталоге: для чисел — «от–до», для текста — список значений"></td>
      <td class="c"><input type="checkbox" data-tyb="fields.${i}.kpi" ${field.kpi ? 'checked' : ''} title="Ключевой параметр: крупно на титуле КП и в карточке"></td>
      <td class="c"><input type="radio" name="tymain" data-tymain="${esc(field.key || '')}" ${type.main === field.key ? 'checked' : ''} title="Основной параметр: по нему сортируется и подписывается оборудование"></td>`;
  }

  static _fieldRow(type, field, i) {
    const inp = this._inp;
    return `<tr data-tyrow="${i}">
      <td class="ty-mv"><button class="icon" type="button" data-tyfmv="-1" data-i="${i}" ${i ? '' : 'disabled'} title="Выше">↑</button><button class="icon" type="button" data-tyfmv="1" data-i="${i}" ${i < type.fields.length - 1 ? '' : 'disabled'} title="Ниже">↓</button></td>
      <td>${inp(`fields.${i}.label`, field.label, { ph: 'Например, Мощность' })}<small class="muted ty-key" title="Код параметра в базе (латиницей)">${esc(field.key || '')}</small></td>
      <td>${inp(`fields.${i}.unit`, field.unit, { ph: '—' })}</td>
      <td>${inp(`fields.${i}.group`, field.group, { ph: 'Основные', list: 'tyFG' })}</td>
      ${this._checks(type, field, i)}
      <td>${inp(`fields.${i}.values`, (field.values || []).join(', '), { ph: 'варианты через запятую' })}</td>
      <td><button class="icon" type="button" data-tyfdel="${i}" title="Удалить параметр">✕</button></td></tr>`;
  }

  static _match(type) {
    if (!this._simple(type.match)) {
      return this._lbl(
        'Правило распознавания',
        this._inp('matchRe', type.match),
        'Регулярное выражение (без учёта регистра): по нему позиция сама попадает в эту категорию по названию',
      );
    }
    const words = String(type.match || '')
      .split('|')
      .filter(Boolean)
      .map(word => word.replace(/\\S\*/g, '*').replace(/\\s\+?/g, ' '))
      .join(', ');
    return this._lbl(
      'Слова для распознавания',
      this._inp('match', words, { ph: 'винтов*, компрессор' }),
      'Через запятую; * — любое окончание («винтов* компрессор»). По ним позиция сама попадает в эту категорию по названию',
    );
  }

  static _role(type) {
    const buttons = this.ROLES.map(
      ([value, label]) =>
        `<button type="button" data-tyrole="${value}" class="${(type.role || 'equipment') === value ? 'on' : ''}">${label}</button>`,
    ).join('');
    return `<div class="ty-f"><span>Что это</span><span class="ty-seg">${buttons}</span><small class="muted">Комплектующие не выводятся отдельной страницей и титулом</small></div>`;
  }

  static _main(type) {
    const inp = this._inp;
    const lbl = this._lbl;
    return `<section class="ty-sec"><h4>Основное</h4><div class="ty-grid">
      ${lbl('Название категории', inp('name', type.name, { ph: 'Винтовые компрессоры' }), 'Так категория называется в каталоге и фильтрах')}
      ${lbl('Раздел каталога', inp('group', type.group, { ph: 'Компрессоры', list: 'tyGroups' }), 'Категории одного раздела стоят рядом')}
      ${lbl('Одна позиция называется', inp('item', type.item, { ph: 'Винтовой компрессор' }), 'В единственном числе — для подписей и карточки')}
      ${lbl('Заголовок на титуле КП', inp('coverTitle', type.coverTitle, { ph: 'Винтовые компрессоры' }), 'Крупная строка над моделью на первой странице')}
      ${this._match(type)}
      ${this._role(type)}
    </div>${TYPES.some(known => known.id === type.id) ? `<p class="muted ty-id">Код категории: <code>${esc(type.id)}</code></p>` : ''}</section>`;
  }

  static _params(type) {
    return `<section class="ty-sec"><h4>Параметры <small class="muted">— характеристики оборудования этой категории</small></h4>
      <div class="ty-tw"><table class="ty-t"><thead><tr><th></th><th>Параметр</th><th>Ед.</th><th>Группа в таблице</th><th title="Числовое значение">Число</th><th title="Фильтр в каталоге">Фильтр</th><th title="Ключевой параметр на титуле">На титул</th><th title="Основной параметр">Основной</th><th>Варианты значений</th><th></th></tr></thead>
      <tbody>${type.fields.map((field, i) => this._fieldRow(type, field, i)).join('')}</tbody></table></div>
      <button class="btn ghost" type="button" data-tyx="addf">+ Параметр</button>
      <p class="muted ty-hint"><b>Число</b> — значение можно сравнивать (мощность, давление). <b>Фильтр</b> — по параметру можно отбирать в каталоге. <b>На титул</b> — показывается крупно на титуле КП. <b>Основной</b> — главный параметр категории.</p></section>`;
  }

  static _option(option, i) {
    return `<div class="ty-opt">${this._inp(`options.${i}.0`, option[0], { ph: 'Полное название, как в КП' })}${this._inp(`options.${i}.1`, option[1], { ph: 'Коротко' })}
        <select data-ty="options.${i}.2"><option value=""${!option[2] ? ' selected' : ''}>шт.</option><option value="усл."${option[2] === 'усл.' ? ' selected' : ''}>услуга</option></select>
        <button class="icon" type="button" data-tyodel="${i}" title="Удалить">✕</button></div>`;
  }

  static _rest(type) {
    const options =
      type.options.map((option, i) => this._option(option, i)).join('') || '<p class="muted">Нет быстрых опций.</p>';
    return `<section class="ty-sec"><h4>Быстрые опции <small class="muted">— добавляются к позиции одной кнопкой</small></h4>
      ${options}
      <button class="btn ghost" type="button" data-tyx="addo">+ Опция</button></section>
    <section class="ty-sec"><h4>Кнопки фото <small class="muted">— быстрые подписи дополнительных изображений в карточке</small></h4>
      ${this._lbl('', this._inp('gallerySlots', type.gallerySlots.join(', '), { ph: 'Контроллер, Двигатель, Габаритный чертёж' }), 'Через запятую. Изображения со словами «схема», «чертёж» выводятся на всю ширину страницы.')}</section>
    <details class="ty-sec ty-json"><summary>Для опытных: категория в формате JSON</summary>
      <textarea rows="14" spellcheck="false" data-tyjson>${esc(JSON.stringify(this.out(type), null, 2))}</textarea>
      <div class="row"><button class="btn ghost" type="button" data-tyx="json">Применить JSON</button><span class="muted" id="tyErr"></span></div></details>`;
  }

  /**
   * Форма категории.
   * @param {object} type
   * @returns {string}
   */
  static html(type) {
    const groups = [...new Set(TYPES.map(known => known.group || this.OTHER))];
    const fieldGroups = [...new Set(TYPES.flatMap(known => known.fields.map(field => field.group).filter(Boolean)))];
    return `<datalist id="tyGroups">${groups.map(group => `<option value="${esc(group)}">`).join('')}</datalist><datalist id="tyFG">${fieldGroups.map(group => `<option value="${esc(group)}">`).join('')}</datalist>
    ${this._main(type)}
    ${this._params(type)}
    ${this._rest(type)}`;
  }
}
