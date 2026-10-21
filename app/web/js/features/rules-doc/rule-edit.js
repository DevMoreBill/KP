import { StationRulesDoc } from './rules-doc.js';
import { esc, today } from '../../core/util.js';

/** Правка значения любого правила формой по его виду (число, список, таблица, параметры). */
export class RuleEdit {
  /** Правило id в копии файла d. */
  static set(data, id, value, base) {
    let rule = data.rules.find(entry => entry.id === id);
    if (!rule) {
      rule = { ...base };
      data.rules.push(rule);
    }
    if (JSON.stringify(rule.value) !== JSON.stringify(value)) {
      rule.value = value;
      rule.source = { ...(rule.source || {}), item: `правка в «Настройках» ${new Date().toLocaleDateString('ru-RU')}` };
    }
  }
  /** Копия файла правил, изменённая fn, с новым номером версии («…-н1», «…-н2»). */
  static version(data, change) {
    const copy = JSON.parse(JSON.stringify(data));
    change(copy);
    const version = String(copy.version || '1'),
      match = /-н(\d+)$/.exec(version);
    copy.version = `${(match ? version.slice(0, match.index) : version).slice(0, 34)}-н${match ? +match[1] + 1 : 1}`;
    copy.date = today();
    delete copy._saved;
    return copy;
  }
  constructor(panel) {
    this.panel = panel;
    this.id = '';
  }
  /** Поля значения v (путь p). */
  form(value, prefix = '') {
    const inp = (path, x, width = 90) =>
      `<input type="text" ${typeof x === 'number' ? 'inputmode="decimal" ' : ''}data-re="${esc(path)}" data-ty="${typeof x === 'number' ? 'n' : 's'}" value="${esc(typeof x === 'number' ? String(x).replace('.', ',') : String(x ?? ''))}" style="width:${typeof x === 'number' ? width : 220}px">`;
    if (typeof value === 'number' || typeof value === 'string') return inp(prefix, value, 120);
    if (typeof value === 'boolean')
      return `<input type="checkbox" data-re="${esc(prefix)}" data-ty="b"${value ? ' checked' : ''}>`;
    if (Array.isArray(value)) {
      if (
        value.length &&
        value.every(row => Array.isArray(row) && row.length === 2 && row.every(x => typeof x === 'number'))
      )
        return `<table class="tzi-t mx-t re-t"><tbody>${value.map((row, j) => `<tr><td>${inp(`${prefix}.${j}.0`, row[0], 80)}</td><td>→</td><td>${inp(`${prefix}.${j}.1`, row[1], 80)}</td><td><button class="icon" type="button" data-redel="${esc(`${prefix}.${j}`)}" aria-label="Убрать строку">✕</button></td></tr>`).join('')}</tbody></table>
          <button class="btn ghost sm" type="button" data-readd="${esc(prefix)}">+ строка</button>`;
      return `<div class="re-l">${value.map((x, j) => this.form(x, `${prefix}.${j}`)).join(' ')}</div>`;
    }
    if (value && typeof value === 'object')
      return `<div class="re-o">${Object.entries(value)
        .map(([k, x]) => `<div class="re-k"><span>${esc(k)}</span>${this.form(x, `${prefix}.${k}`)}</div>`)
        .join('')}</div>`;
    return '';
  }
  /** Поля правки значения правила в строке таблицы. */
  html(rule) {
    const status = StationRulesDoc.STATUS;
    return `<div class="re" data-reid="${esc(rule.id)}"><div class="re-v">${this.form(this.value, '')}</div>
      <div class="row re-m"><label class="f"><span>Статус</span><select data-rest>${Object.entries(status)
        .map(([k, text]) => `<option value="${k}"${rule.status === k ? ' selected' : ''}>${esc(text)}</option>`)
        .join('')}</select></label>
        <label class="f"><span>Источник, пункт</span><input type="text" data-resrc value="${esc((rule.source || {}).item || '')}" placeholder="например: каталог производителя, с. 12" maxlength="200"></label></div>
      <div class="row" style="gap:8px"><button class="btn primary sm" type="button" data-rl="resave">Сохранить правило</button><button class="btn ghost sm" type="button" data-rl="recancel">Отмена</button></div></div>`;
  }
  /** Начать правку правила (рабочая копия значения). */
  open(rule) {
    this.id = rule.id;
    this.value = JSON.parse(JSON.stringify(rule.value));
  }
  /** Поля → значение; ошибка — текстом. */
  read(root) {
    const set = (path, x) => {
      if (path === '') {
        this.value = x;
        return;
      }
      const k = path.slice(1).split('.');
      let value = this.value;
      for (const key of k.slice(0, -1)) value = value[key];
      value[k[k.length - 1]] = x;
    };
    for (const el of root.querySelectorAll('[data-re]')) {
      const type = el.dataset.ty;
      let x;
      if (type === 'b') x = el.checked;
      else if (type === 'n') {
        const text = el.value.trim().replace(/\s+/g, '').replace(',', '.').replace('−', '-');
        x = +text;
        if (!text || !Number.isFinite(x)) throw new Error(`Не число: «${el.value}»`);
      } else {
        x = el.value.trim();
        if (x.length > 200) throw new Error('Текст — до 200 знаков');
      }
      set(el.dataset.re, x);
    }
  }
  /** Изменить таблицу внутри значения по пути path. */
  rows(path, apply) {
    const k = path.slice(1).split('.').filter(Boolean);
    let value = this.value;
    for (const key of k) value = value[key];
    apply(value);
  }
  /** Добавить строку таблицы значения. */
  add(root, path) {
    this.read(root);
    this.rows(path, table => table.push([...(table[table.length - 1] || [0, 0])]));
  }
  /** Удалить последнюю строку таблицы значения. */
  del(root, path) {
    this.read(root);
    const i = path.lastIndexOf('.'),
      j = +path.slice(i + 1);
    this.rows(path.slice(0, i), table => {
      if (table.length > 1) table.splice(j, 1);
    });
  }
  /** Новая версия файла правил с изменённым значением, статусом и источником. */
  build(root) {
    this.read(root);
    const rule = this.panel.data.rules.find(entry => entry.id === this.id),
      status = root.querySelector('[data-rest]').value,
      src = root.querySelector('[data-resrc]').value.trim();
    return RuleEdit.version(this.panel.data, data => {
      const x = data.rules.find(entry => entry.id === this.id);
      x.value = this.value;
      x.status = status;
      x.source = {
        ...(x.source || {}),
        item: src || `правка в «Настройках» ${new Date().toLocaleDateString('ru-RU')}`,
      };
      if (
        JSON.stringify(rule.value) === JSON.stringify(this.value) &&
        rule.status === status &&
        ((rule.source || {}).item || '') === src
      )
        throw new Error('Ничего не изменено');
    });
  }
}
