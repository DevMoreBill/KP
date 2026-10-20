import { Catalog, CatalogStore, CatFind } from './catalog-store.js';
import { CatalogWindow } from './catalog-window.js';

/**
 * Код позиции из строки прайса: прежняя схема (её коды уже в каталоге — повторная загрузка обновляет те же позиции), но у
 * длинных русских названий значимы лишь первые ~17 букв. Совпал с другой строкой файла или с позицией каталога под другим
 * названием — к коду добавляется отпечаток полной строки.
 */
export class XlsId {
  static BASE_LEN = 60;
  static MAX_LEN = 64;
  static CUT_LEN = 56;
  static RADIX = 36;
  static FNV_SEED = 0x811c9dc5;
  static FNV_PRIME = 16777619;

  /**
   * Код по прежней схеме.
   * @param {string} cat
   * @param {string} key
   * @returns {string}
   */
  static base(cat, key) {
    return `${cat}_${norm(key).replace(/[^a-z0-9а-я]+/g, '')}`
      .slice(0, this.BASE_LEN)
      .replace(/[^A-Za-z0-9_-]/g, char => `x${char.charCodeAt(0).toString(this.RADIX)}`)
      .slice(0, this.MAX_LEN);
  }

  /**
   * Отпечаток строки (FNV-1a).
   * @param {string} text
   * @returns {string}
   */
  static hash(text) {
    let hash = this.FNV_SEED;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, this.FNV_PRIME);
    }
    return (hash >>> 0).toString(this.RADIX);
  }

  /**
   * Код позиции строки.
   * @param {{cat: string, key: string, name: string}} row
   * @param {Set<string>} seen коды этого файла
   * @returns {string}
   */
  static of({ cat, key, name }, seen) {
    let id = this.base(cat, key);
    const known = CatFind.id(id);
    if (seen.has(id) || (known && norm(known.name) !== norm(name))) {
      id = `${id.slice(0, this.CUT_LEN)}_${this.hash(norm(key))}`;
    }
    seen.add(id);
    return id;
  }
}

/** Таблица Excel/CSV: столбцы шаблона категории и разбор вставленного текста. */
export class XlsTable {
  static QUOTE = '"';

  /**
   * Столбцы шаблона категории.
   * @param {object} type
   * @returns {string[][]}
   */
  static columns(type) {
    const cols = [
      ['name', 'Наименование'],
      ['maker', 'Производитель'],
      ['series', 'Серия'],
      ['model', 'Модель'],
      ['spec', 'Краткие характеристики'],
    ];
    for (const field of type.fields) cols.push([field.key, field.label + (field.unit ? `, ${field.unit}` : '')]);
    cols.push(
      ['cost', 'Закупка за ед.'],
      ['costCur', 'Валюта закупки (RUB/USD/EUR/CNY)'],
      ['price', 'Цена продажи за ед., руб.'],
      ['margin', 'Маржа, %'],
    );
    return cols;
  }

  static _sep(text) {
    const first = text.split(/\r?\n/)[0] || '';
    if (first.includes('\t')) return '\t';
    return first.split(';').length >= first.split(',').length ? ';' : ',';
  }

  /**
   * Разобрать таблицу (табуляция, «;» или «,»; кавычки как в CSV).
   * @param {string} source
   * @returns {string[][]}
   */
  static parse(source) {
    const text = source.replace(/^﻿/, '');
    const reader = new XlsReader(text, this._sep(text));
    for (let k = 0; k < text.length; k++) k = reader.step(k);
    return reader.done().filter(row => row.some(cell => String(cell).trim() !== ''));
  }
}

/** Посимвольный разбор CSV. */
class XlsReader {
  constructor(text, sep) {
    Object.assign(this, { text, sep, rows: [], row: [], cell: '', quoted: false });
  }

  _quoted(k) {
    const char = this.text[k];
    if (char !== XlsTable.QUOTE) {
      this.cell += char;
      return k;
    }
    if (this.text[k + 1] === XlsTable.QUOTE) {
      this.cell += XlsTable.QUOTE;
      return k + 1;
    }
    this.quoted = false;
    return k;
  }

  _endRow() {
    this.row.push(this.cell);
    this.rows.push(this.row);
    this.row = [];
    this.cell = '';
  }

  /**
   * Разобрать символ k.
   * @param {number} k
   * @returns {number} последний разобранный символ
   */
  step(k) {
    if (this.quoted) return this._quoted(k);
    const char = this.text[k];
    if (char === XlsTable.QUOTE) {
      this.quoted = true;
      return k;
    }
    if (char === this.sep) {
      this.row.push(this.cell);
      this.cell = '';
      return k;
    }
    if (char !== '\n' && char !== '\r') {
      this.cell += char;
      return k;
    }
    this._endRow();
    return char === '\r' && this.text[k + 1] === '\n' ? k + 1 : k;
  }

  /**
   * Строки таблицы.
   * @returns {string[][]}
   */
  done() {
    if (this.cell !== '' || this.row.length) {
      this.row.push(this.cell);
      this.rows.push(this.row);
    }
    return this.rows;
  }
}

/** Импорт позиций каталога из Excel/CSV по шаблону категории. */
export class XlsImport {
  static cur = '';
  static SKIP_TEXT = 40;
  static SPEC_PARAMS = 4;

  static _html() {
    return `<div class="dlg-h"><h3>Импорт позиций из Excel</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="grid g2"><label class="f"><span>Тип оборудования</span><select id="xType">${typeOptionsHtml(this.cur)}</select></label>
     <div style="align-self:end"><button class="btn" type="button" id="xTpl">Скачать шаблон для Excel</button></div></div>
   <ol class="muted" style="margin:12px 0;padding-left:18px"><li>Скачайте шаблон выбранного типа и откройте его в Excel — в нём все нужные столбцы.</li>
     <li>Заполните строки (одна строка — одна позиция) и сохраните как CSV или просто скопируйте таблицу вместе с заголовками.</li>
     <li>Вставьте таблицу ниже или выберите файл CSV — позиции появятся в каталоге. Фото можно добавить потом в карточке позиции.</li></ol>
   <textarea id="xText" rows="8" placeholder="Вставьте сюда таблицу из Excel вместе со строкой заголовков"></textarea>
   <div class="row" style="margin-top:10px"><button class="btn" type="button" id="xFile">Выбрать файл CSV…</button><span class="muted" id="xInfo"></span>
     <span style="flex:1"></span><button class="btn primary" type="button" id="xGo">Импортировать</button></div></div>`;
  }

  /**
   * Открыть окно импорта.
   * @param {string} [cat] категория по умолчанию
   */
  static open(cat) {
    const dialog = $('#dlg');
    dialog.classList.remove('wide');
    this.cur = cat || TYPES.find(type => type.role !== 'accessory' && !type.station)?.id || 'other';
    dialog.innerHTML = this._html();
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    $('#xType').onchange = event => {
      this.cur = event.target.value;
    };
    $('#xTpl').onclick = () => this._template();
    $('#xFile').onclick = () => this._file(dialog);
    $('#xGo').onclick = () => this._run(dialog);
  }

  static _template() {
    const type = typeById(this.cur);
    const head = XlsTable.columns(type)
      .map(col => `"${col[1].replace(/"/g, '""')}"`)
      .join(';');
    FileSave.save(
      `Шаблон_${type.name.replace(/\s+/g, '_')}.csv`,
      new Blob([`﻿${head}\r\n`], { type: 'text/csv;charset=utf-8' }),
    );
  }

  static _file(dialog) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv';
    input.hidden = true;
    dialog.appendChild(input);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf); // CSV из старого Excel
      $('#xText').value = text;
      $('#xInfo').textContent = file.name;
      input.remove();
    };
    input.click();
  }

  static _head(text) {
    return norm(
      String(text)
        .replace(/,.*$/, '')
        .replace(/\(.*\)/, ''),
    );
  }

  static _map(type, head) {
    const cols = XlsTable.columns(type);
    const labels = type.fields.map(field => [field.key, field.label]);
    return head.map(title => {
      const key = this._head(title);
      const col = cols.find(row => this._head(row[1]) === key) || labels.find(row => this._head(row[1]) === key);
      return col ? col[0] : null;
    });
  }

  static _values(map, row) {
    const values = {};
    map.forEach((key, i) => {
      if (key && String(row[i] ?? '').trim() !== '') values[key] = String(row[i]).trim();
    });
    return values;
  }

  static _attrs(type, values) {
    const attrs = { cat: type.id };
    for (const key of ['maker', 'series', 'model']) if (values[key]) attrs[key] = values[key];
    for (const field of type.fields) {
      if (values[field.key] == null) continue;
      attrs[field.key] = field.num ? (numOf(values[field.key]) ?? values[field.key]) : values[field.key];
    }
    return attrs;
  }

  static _money(values) {
    return {
      price: parsePrice(values.price || '') || 0,
      priceCur: 'RUB',
      cost: parsePrice(values.cost || '') || 0,
      costCur: (values.costCur || 'RUB').toUpperCase().slice(0, 3),
      margin: values.margin ? numOf(values.margin) : undefined,
    };
  }

  static _card(type, values, seen) {
    const name = values.name || [type.item, values.maker, values.model].filter(Boolean).join(' ');
    const card = {
      id: XlsId.of({ cat: type.id, key: `${values.maker || ''} ${values.model || name}`, name }, seen),
      name,
      spec: values.spec || '',
      attrs: this._attrs(type, values),
      ...this._money(values),
      features: [],
      groups: [],
      photo: null,
      logo: null,
      prices: [],
      updatedAt: new Date().toISOString(),
      pageTitle: name,
      photoCaption: '',
    };
    if (!CUR_LIST.includes(card.costCur)) card.costCur = 'RUB';
    card.groups = groupsFromAttrs(card);
    card.hint = CoverHint.of(card);
    if (!card.spec) card.spec = mainLine(card, this.SPEC_PARAMS);
    return card;
  }

  // позиция уже в каталоге: фото, логотип, история цен и описание остаются
  static async _keep(card) {
    const old = await Catalog.fullDoc(CatFind.id(card.id));
    if (!old) return;
    card.photo = old.photo;
    card.logo = old.logo;
    card.prices = old.prices || [];
    if (!card.price) card.price = old.price || 0;
    if (old.features && old.features.length) card.features = old.features;
  }

  static async _run(dialog) {
    const type = typeById(this.cur);
    const rows = XlsTable.parse($('#xText').value);
    if (rows.length < 2) {
      toast('Нужна строка заголовков и хотя бы одна строка данных');
      return;
    }
    const map = this._map(type, rows[0]);
    if (!map.includes('name') && !map.includes('model')) {
      toast('Не найден столбец «Наименование» или «Модель» — используйте шаблон');
      return;
    }
    let count = 0;
    const skipped = [];
    const seen = new Set();
    for (const row of rows.slice(1)) {
      const values = this._values(map, row);
      if (!values.name && !values.model) {
        skipped.push(row.join(' ').slice(0, this.SKIP_TEXT));
        continue;
      }
      const card = this._card(type, values, seen);
      await this._keep(card);
      await CatalogStore.put(card);
      count++;
    }
    await Catalog.refresh();
    dialog.close();
    toast(
      `Импортировано позиций: ${count}${skipped.length ? `, пропущено строк без наименования: ${skipped.length}` : ''}`,
    );
    CatalogWindow.open({ cat: type.id });
  }
}
