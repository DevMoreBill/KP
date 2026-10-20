import { StationRulesDoc } from './rules-doc.js';

/** Правка значения любого правила формой по его виду (число, список, таблица, параметры). */
export class RuleEdit {
  /** Правило id в копии файла d. */
  static set(d, id, value, base) {
    let r = d.rules.find(q => q.id === id);
    if (!r) {
      r = { ...base };
      d.rules.push(r);
    }
    if (JSON.stringify(r.value) !== JSON.stringify(value)) {
      r.value = value;
      r.source = { ...(r.source || {}), item: `правка в «Настройках» ${new Date().toLocaleDateString('ru-RU')}` };
    }
  }
  /** Копия файла правил, изменённая fn, с новым номером версии («…-н1», «…-н2»). */
  static version(data, fn) {
    const d = JSON.parse(JSON.stringify(data));
    fn(d);
    const v = String(d.version || '1'),
      m = /-н(\d+)$/.exec(v);
    d.version = `${(m ? v.slice(0, m.index) : v).slice(0, 34)}-н${m ? +m[1] + 1 : 1}`;
    d.date = today();
    delete d._saved;
    return d;
  }
  constructor(panel) {
    this.p = panel;
    this.id = '';
  }
  /** Поля значения v (путь p). */
  form(v, p = '') {
    const inp = (path, x, w = 90) =>
      `<input type="text" ${typeof x === 'number' ? 'inputmode="decimal" ' : ''}data-re="${esc(path)}" data-ty="${typeof x === 'number' ? 'n' : 's'}" value="${esc(typeof x === 'number' ? String(x).replace('.', ',') : String(x ?? ''))}" style="width:${typeof x === 'number' ? w : 220}px">`;
    if (typeof v === 'number' || typeof v === 'string') return inp(p, v, 120);
    if (typeof v === 'boolean') return `<input type="checkbox" data-re="${esc(p)}" data-ty="b"${v ? ' checked' : ''}>`;
    if (Array.isArray(v)) {
      if (v.length && v.every(r => Array.isArray(r) && r.length === 2 && r.every(x => typeof x === 'number')))
        return `<table class="tzi-t mx-t re-t"><tbody>${v.map((r, j) => `<tr><td>${inp(`${p}.${j}.0`, r[0], 80)}</td><td>→</td><td>${inp(`${p}.${j}.1`, r[1], 80)}</td><td><button class="icon" type="button" data-redel="${esc(`${p}.${j}`)}" aria-label="Убрать строку">✕</button></td></tr>`).join('')}</tbody></table>
          <button class="btn ghost sm" type="button" data-readd="${esc(p)}">+ строка</button>`;
      return `<div class="re-l">${v.map((x, j) => this.form(x, `${p}.${j}`)).join(' ')}</div>`;
    }
    if (v && typeof v === 'object')
      return `<div class="re-o">${Object.entries(v)
        .map(([k, x]) => `<div class="re-k"><span>${esc(k)}</span>${this.form(x, `${p}.${k}`)}</div>`)
        .join('')}</div>`;
    return '';
  }
  html(r) {
    const st = StationRulesDoc.STATUS;
    return `<div class="re" data-reid="${esc(r.id)}"><div class="re-v">${this.form(this.v, '')}</div>
      <div class="row re-m"><label class="f"><span>Статус</span><select data-rest>${Object.entries(st)
        .map(([k, t]) => `<option value="${k}"${r.status === k ? ' selected' : ''}>${esc(t)}</option>`)
        .join('')}</select></label>
        <label class="f"><span>Источник, пункт</span><input type="text" data-resrc value="${esc((r.source || {}).item || '')}" placeholder="например: каталог производителя, с. 12" maxlength="200"></label></div>
      <div class="row" style="gap:8px"><button class="btn primary sm" type="button" data-rl="resave">Сохранить правило</button><button class="btn ghost sm" type="button" data-rl="recancel">Отмена</button></div></div>`;
  }
  open(r) {
    this.id = r.id;
    this.v = JSON.parse(JSON.stringify(r.value));
  }
  /** Поля → значение; ошибка — текстом. */
  read(root) {
    const set = (path, x) => {
      if (path === '') {
        this.v = x;
        return;
      }
      const k = path.slice(1).split('.');
      let o = this.v;
      for (const q of k.slice(0, -1)) o = o[q];
      o[k[k.length - 1]] = x;
    };
    for (const el of root.querySelectorAll('[data-re]')) {
      const ty = el.dataset.ty;
      let x;
      if (ty === 'b') x = el.checked;
      else if (ty === 'n') {
        const s = el.value.trim().replace(/\s+/g, '').replace(',', '.').replace('−', '-');
        x = +s;
        if (!s || !Number.isFinite(x)) throw new Error(`Не число: «${el.value}»`);
      } else {
        x = el.value.trim();
        if (x.length > 200) throw new Error('Текст — до 200 знаков');
      }
      set(el.dataset.re, x);
    }
  }
  rows(path, fn) {
    const k = path.slice(1).split('.').filter(Boolean);
    let o = this.v;
    for (const q of k) o = o[q];
    fn(o);
  }
  add(root, path) {
    this.read(root);
    this.rows(path, T => T.push([...(T[T.length - 1] || [0, 0])]));
  }
  del(root, path) {
    this.read(root);
    const i = path.lastIndexOf('.'),
      j = +path.slice(i + 1);
    this.rows(path.slice(0, i), T => {
      if (T.length > 1) T.splice(j, 1);
    });
  }
  build(root) {
    this.read(root);
    const r = this.p.data.rules.find(q => q.id === this.id),
      st = root.querySelector('[data-rest]').value,
      src = root.querySelector('[data-resrc]').value.trim();
    return RuleEdit.version(this.p.data, d => {
      const x = d.rules.find(q => q.id === this.id);
      x.value = this.v;
      x.status = st;
      x.source = {
        ...(x.source || {}),
        item: src || `правка в «Настройках» ${new Date().toLocaleDateString('ru-RU')}`,
      };
      if (
        JSON.stringify(r.value) === JSON.stringify(this.v) &&
        r.status === st &&
        ((r.source || {}).item || '') === src
      )
        throw new Error('Ничего не изменено');
    });
  }
}
