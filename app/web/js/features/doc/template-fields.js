import { TemplateEditor } from './template-editor.js';
import { Templates } from './templates.js';
import { Srv } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { ObjPath } from '../../core/str.js';

/**
 * Поля формы редактора шаблона по описанию editor.json: текст, шрифт, число, переключатель, список, цвет, пары
 * «заголовок — текст», фирменный знак, разделы, стили текста, картинки, файлы шаблона.
 */
export class TemplateFields {
  static LISTS = ['tpl.fonts'];
  static FONTS = [
    'Arial',
    'Calibri',
    'Cambria',
    'Segoe UI',
    'Tahoma',
    'Times New Roman',
    'Verdana',
    'Georgia',
    'PT Sans',
    'PT Serif',
    'Roboto',
    'Open Sans',
  ];
  static KINDS = {
    group: '_group',
    text: '_text',
    font: '_font',
    textarea: '_textarea',
    number: '_number',
    toggle: '_toggle',
    select: '_select',
    color: '_color',
    pairs: '_pairs',
    brand: '_brand',
    sections: '_sections',
    style: '_style',
    image: '_image',
    files: '_files',
  };
  static PX_NUM = 4; // 1 пт = 4/3 px
  static PX_DEN = 3;
  static MIN_SIZE = 6;
  static DEFAULT_SIZE = 10;
  static HEX = /^[0-9A-Fa-f]{6}$/;

  static get _state() {
    return TemplateEditor.state;
  }

  /**
   * Цвет #RRGGBB для поля выбора цвета.
   * @param {string} value
   * @returns {string}
   */
  static hex(value) {
    return `#${String(value || '000000')
      .replace(/^#/, '')
      .padStart(6, '0')
      .slice(0, 6)}`;
  }

  /**
   * Цвет по имени палитры шаблона или свой (RRGGBB).
   * @param {string} key
   * @returns {string}
   */
  static colorOf(key) {
    if (this.HEX.test(String(key || ''))) return key;
    const work = this._state.work;
    return ((work && work.colors) || {})[key] || '000000';
  }

  /**
   * Поле формы.
   * @param {object} field описание поля из editor.json
   * @returns {string}
   */
  static html(field) {
    const method = this.KINDS[field.type];
    if (!method) return '';
    const value = field.key ? ObjPath.get(this._state.work || {}, field.key) : undefined;
    const ctx = {
      field,
      value,
      key: esc(field.key || ''),
      label: field.label ? `<span>${esc(field.label)}</span>` : '',
      hint: field.hint ? `<small class="muted">${esc(field.hint)}</small>` : '',
    };
    return this[method](ctx);
  }

  static _group({ field }) {
    return `<h4 class="te-group">${esc(field.title || '')}</h4>`;
  }

  static _text({ field, value, key, label, hint }) {
    return `<label class="f te-f">${label}<input type="text" data-k="${key}" value="${esc(value ?? '')}" placeholder="${esc(field.placeholder || '')}">${hint}</label>`;
  }

  static _font({ value, key, label, hint }) {
    const fonts = this.FONTS.map(font => `<option value="${esc(font)}">`).join('');
    return `<label class="f te-f">${label}<input type="text" data-k="${key}" list="teFonts" value="${esc(value ?? '')}"><datalist id="teFonts">${fonts}</datalist>${hint}</label>`;
  }

  static _textarea({ field, value, key, label, hint }) {
    return `<label class="f te-f">${label}<textarea data-k="${key}" rows="${field.rows || 3}">${esc(value ?? '')}</textarea>${hint}</label>`;
  }

  static _number({ field, value, key, label, hint }) {
    return `<label class="f te-f te-num">${label}<span class="te-inline"><input type="number" data-k="${key}" data-num="1" value="${esc(value ?? '')}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 'any'}">${field.unit ? `<em>${esc(field.unit)}</em>` : ''}</span>${hint}</label>`;
  }

  static _toggle({ field, value, key, hint }) {
    return `<div class="te-f te-tog"><button class="sw" type="button" role="switch" aria-checked="${!!value}" data-sw="${key}"><i></i>${esc(field.label || '')}</button>${hint}</div>`;
  }

  static _select({ field, value, key, label, hint }) {
    const options = (field.options || [])
      .map(option => {
        const [code, text] = Array.isArray(option) ? option : [option, option];
        return `<option value="${esc(code)}"${String(code) === String(value) ? ' selected' : ''}>${esc(text)}</option>`;
      })
      .join('');
    return `<label class="f te-f">${label}<select data-k="${key}">${options}</select>${hint}</label>`;
  }

  static _color({ field, value, key, hint }) {
    return `<div class="te-f te-color"><span class="te-lab">${esc(field.label || '')}</span><span class="te-inline"><input type="color" data-color="${key}" value="${this.hex(value)}"><input type="text" class="te-hex" data-hex="${key}" value="${esc(String(value || '').toUpperCase())}" maxlength="7" spellcheck="false"></span>${hint}</div>`;
  }

  /**
   * Варианты цвета: палитра шаблона и свой цвет, если выбран не из палитры.
   * @param {string} selected
   * @returns {string}
   */
  static colorOptions(selected) {
    const { form, work } = this._state;
    const names = (form && form.colorNames) || {};
    const keys = Object.keys((work && work.colors) || {});
    const own = selected && !keys.includes(selected);
    const palette = keys
      .map(
        color =>
          `<option value="${esc(color)}"${color === selected ? ' selected' : ''}>${esc(names[color] || color)}</option>`,
      )
      .join('');
    return palette + (own ? `<option value="${esc(selected)}" selected>#${esc(selected)}</option>` : '');
  }

  static _pairs({ field, value }) {
    const rows = Array.isArray(value) ? value : [];
    const cols = field.cols || ['Заголовок', 'Текст'];
    const key = esc(field.key);
    const list = rows
      .map(
        (
          row,
          i,
        ) => `<div class="te-pair"><input type="text" data-pair="${key}" data-i="${i}" data-j="0" value="${esc(row[0] || '')}" placeholder="${esc(cols[0])}">
      <textarea data-pair="${key}" data-i="${i}" data-j="1" rows="2" placeholder="${esc(cols[1])}">${esc(row[1] || '')}</textarea>
      <button class="icon" type="button" data-row-del="${key}" data-i="${i}" title="Удалить">✕</button></div>`,
      )
      .join('');
    const add =
      !field.max || rows.length < field.max
        ? `<button class="btn ghost" type="button" data-row-add="${key}" data-kind="pair">+ Добавить</button>`
        : '';
    return `<div class="te-f"><span class="te-lab">${esc(field.label || '')}</span>
    <div class="te-rows">${list}</div>
    ${add}${field.hint ? `<small class="muted">${esc(field.hint)}</small>` : ''}</div>`;
  }

  static _brand({ field, value }) {
    const rows = Array.isArray(value) ? value : [];
    const key = esc(field.key);
    const preview = rows
      .map(([text, color]) => `<b style="color:${this.hex(this.colorOf(color))}">${esc(text)}</b>`)
      .join('');
    const list = rows
      .map(
        (
          row,
          i,
        ) => `<div class="te-pair te-brandrow"><input type="text" data-pair="${key}" data-i="${i}" data-j="0" value="${esc(row[0] || '')}" placeholder="Текст">
      <select data-pair="${key}" data-i="${i}" data-j="1">${this.colorOptions(row[1])}</select>
      <button class="icon" type="button" data-row-del="${key}" data-i="${i}" title="Удалить">✕</button></div>`,
      )
      .join('');
    return `<div class="te-f"><span class="te-lab">${esc(field.label || '')} <span class="te-brand" style="font-family:${esc(this._state.work.font || 'Arial')}">${preview || '—'}</span></span>
    <div class="te-rows">${list}</div>
    <button class="btn ghost" type="button" data-row-add="${key}" data-kind="brand">+ Часть</button>${field.hint ? `<small class="muted">${esc(field.hint)}</small>` : ''}</div>`;
  }

  static _sections({ field, value }) {
    const rows = Array.isArray(value) ? value : [];
    const list = rows.map((section, i) => this._section(field, section, i, rows.length)).join('');
    return `<div class="te-f"><span class="te-lab">${esc(field.label || '')}</span><ol class="te-secs">${list}</ol></div>`;
  }

  static _section(field, section, i, count) {
    const names = field.names || {};
    const hints = field.hints || {};
    const newPage =
      'newPage' in section && section.id !== 'equipment'
        ? `<label class="te-chk"><input type="checkbox" data-sec-np="${i}" ${section.newPage ? 'checked' : ''}> с новой страницы</label>`
        : '<span></span>';
    return `<li class="${section.on ? '' : 'off'}">
      <span class="te-move"><button class="icon" type="button" data-sec-mv="-1" data-i="${i}" ${i ? '' : 'disabled'} title="Выше">↑</button><button class="icon" type="button" data-sec-mv="1" data-i="${i}" ${i < count - 1 ? '' : 'disabled'} title="Ниже">↓</button></span>
      <span class="te-secname"><b>${esc(names[section.id] || section.id)}</b>${hints[section.id] ? `<small class="muted">${esc(hints[section.id])}</small>` : ''}</span>
      ${newPage}
      <button class="sw" type="button" role="switch" aria-checked="${!!section.on}" data-sec-on="${i}"><i></i>${section.on ? 'включён' : 'выключен'}</button></li>`;
  }

  /**
   * Образец стиля текста (CSS).
   * @param {object} style
   * @param {object} field
   * @returns {string}
   */
  static sample(style, field) {
    const color = field.dark
      ? `color:#${this.colorOf(style.color)};background:${this.hex(this.colorOf('NAVYD'))}`
      : `color:${this.hex(this.colorOf(style.color))}`;
    const font = esc((this._state.work.font || 'Arial').replace(/'/g, ''));
    const size = this._px(Math.max(this.MIN_SIZE, +style.size || this.DEFAULT_SIZE));
    return `font-family:'${font}',Arial,sans-serif;font-size:${size}px;${color};font-weight:${style.bold ? 700 : 400};font-style:${style.italic ? 'italic' : 'normal'};text-transform:${style.caps ? 'uppercase' : 'none'};letter-spacing:${this._px(+style.spacing || 0)}px`;
  }

  static _px(points) {
    return (points * this.PX_NUM) / this.PX_DEN;
  }

  static _style({ field, value }) {
    const style = value || {};
    const key = esc(field.key);
    const toggle = (prop, text, title) =>
      `<button type="button" class="te-t${style[prop] ? ' on' : ''}" data-st="${key}" data-prop="${prop}" aria-pressed="${!!style[prop]}" title="${title}">${text}</button>`;
    const color = field.noColor
      ? '<span class="muted te-nocol">цвет — по фирменному знаку</span>'
      : `<select data-k="${key}.color" title="Цвет">${this.colorOptions(style.color)}</select>`;
    return `<div class="te-style"><span class="te-lab">${esc(field.label || '')}</span>
    <span class="te-inline"><input type="number" data-k="${key}.size" data-num="1" value="${esc(style.size ?? '')}" min="5" max="72" step="0.5" title="Размер, пт"><em>пт</em></span>
    ${color}
    <span class="te-tgs">${toggle('bold', 'Ж', 'Жирный')}${toggle('italic', '<i>К</i>', 'Курсив')}${toggle('caps', 'АА', 'Прописные')}</span>
    <span class="te-sample" style="${this.sample(style, field)}">${esc(field.sample || 'Образец')}</span></div>`;
  }

  static _image({ field, value }) {
    const url = value ? `/tpl/${encodeURIComponent(this._state.id)}/${encodeURIComponent(value)}?t=${Date.now()}` : '';
    const shown = value
      ? `<img src="${url}" alt=""><span class="muted">${esc(value)}</span>`
      : `<span class="muted">${esc(field.empty || 'Картинки нет — страница не выводится')}</span>`;
    return `<div class="te-f"><span class="te-lab">${esc(field.label || '')}</span>
    <div class="te-img">${shown}</div>
    <div class="row"><label class="btn ghost">Заменить…<input type="file" accept="image/jpeg,image/png" hidden data-img="${esc(field.key)}"></label>${value ? `<button class="btn ghost" type="button" data-img-del="${esc(field.key)}">Убрать</button>` : ''}</div>
    ${field.hint ? `<small class="muted">${esc(field.hint)}</small>` : ''}</div>`;
  }

  static _accept(file) {
    if (file.endsWith('.docx')) return '.docx';
    return file.endsWith('.js') ? '.js' : '.json';
  }

  static _card({ file, title, text, openLabel }) {
    const remote = Srv.info && Srv.info.local === false;
    const folder = encodeURIComponent(this._state.id);
    return `<div class="te-card"><div><b>${esc(title)}</b> <code>${esc(file)}</code><p class="muted">${text}</p></div>
    <div class="row">${remote ? '' : `<button class="btn" type="button" data-te-open="${esc(file)}">${esc(openLabel)}</button>`}
      <a class="btn ghost" href="/tpl/${folder}/${esc(file)}?download=1">Скачать</a>
      <label class="btn ghost">Заменить…<input type="file" hidden data-te-put="${esc(file)}" accept="${this._accept(file)}"></label></div></div>`;
  }

  static _files() {
    const { id, pack } = this._state;
    const info = Templates.list.find(row => row.id === id) || {};
    const remote = Srv.info && Srv.info.local === false;
    const page = pack ? esc(Templates.pageInfo(pack.sect)) : '';
    return `<div class="te-files">
    ${this._card({ file: 'base.docx', title: 'Основа Word', text: `Шапка страницы (логотип, реквизиты), поля, размер листа, стили Word. ${page}. Откройте в Word, измените верхний колонтитул или поля (Макет → Поля), сохраните и закройте — программа подхватит изменения при следующем сохранении КП. Ширина таблиц подстраивается под поля автоматически.`, openLabel: 'Открыть в Word' })}
    ${this._card({ file: 'skeleton.js', title: 'Скелет документа', text: 'Раскладка страниц: какие блоки на титуле, странице оборудования, в таблице цен. Нужен, если настроек не хватает (новый блок, другая компоновка). Сохраните прежнюю версию — она останется в истории.', openLabel: 'Открыть в Блокноте' })}
    ${this._card({ file: 'editor.json', title: 'Форма редактора', text: 'Какие настройки показывать в этом окне, их подписи и подсказки. Добавьте поле — и новая настройка из скелета появится здесь.', openLabel: 'Открыть в Блокноте' })}
    ${this._card({ file: 'template.json', title: 'Настройки шаблона', text: 'То же, что в этом окне, в виде текста. Правки из Блокнота видны после повторного открытия редактора.', openLabel: 'Открыть в Блокноте' })}
    <div class="row te-actions">${remote ? '' : '<button class="btn ghost" type="button" data-te-open="">Открыть папку шаблона</button>'}
      <button class="btn ghost" type="button" data-te="copy">Создать копию шаблона…</button>
      ${info.factory ? '<button class="btn ghost" type="button" data-te="reset">Вернуть заводской шаблон</button>' : ''}
      ${Templates.list.length > 1 ? '<button class="btn ghost danger" type="button" data-te="delete">Удалить шаблон</button>' : ''}</div>
    <h4 class="te-group">История версий</h4><p class="muted">Перед каждым сохранением прежний файл откладывается сюда. «Вернуть» делает выбранную версию текущей (текущая тоже останется в истории).</p>
    <div id="teHist" class="te-hist muted">Загружаю…</div></div>`;
  }
}
