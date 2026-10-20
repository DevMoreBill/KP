import { LayoutForm } from './layout-form.js';
import { LayoutParams } from '../layout/layout-params.js';
import { RuleEdit } from './rule-edit.js';
import { StationMatrix } from '../layout/station-matrix.js';

/** Правила компоновки станций («Настройки → Нормы станций»): рабочая копия, чтение формы, новая версия правил. */
export class LayoutEditor {
  static AISLE = [1000, 800];
  static TIGHT = 600;

  constructor(panel) {
    this.p = panel;
    this.w = null;
    this.q = '';
    this.form = new LayoutForm(this);
  }

  static label(k) {
    return LayoutForm.label(k);
  }

  static rule(d, id) {
    return (d?.rules || []).find(r => r.id === id);
  }

  static copy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /** Матрица v поверх значений программы (недостающее — из StationMatrix.DEF). */
  static merge(v) {
    const D = StationMatrix.DEF;
    const src = v && typeof v === 'object' ? v : {};
    const mx = {};
    for (const k of Object.keys(D)) {
      mx[k] = LayoutEditor.copy(src[k] && typeof src[k] === 'object' ? { ...D[k], ...src[k] } : D[k]);
    }
    return mx;
  }

  /** Значения по умолчанию — из файла поставки (сервер: layoutDef), без него — заложенные в программу. */
  defs() {
    const L = this.p.layoutDef || {};
    return {
      m: LayoutEditor.merge(L['layout.matrix']),
      a: LayoutEditor.copy(L['norm.aisle'] || LayoutEditor.AISLE),
      t: Number(L['norm.aisle_tight'] || LayoutEditor.TIGHT),
      c: LayoutEditor.copy(L['clear.kind'] || this.w?.c || {}),
    };
  }

  /** Рабочая копия: матрица, проходы, отступы. */
  load() {
    const R = id => LayoutEditor.rule(this.p.data, id)?.value;
    this.w = {
      m: LayoutEditor.merge(R('layout.matrix')),
      a: LayoutEditor.copy(R('norm.aisle') || LayoutEditor.AISLE),
      t: Number(R('norm.aisle_tight') || LayoutEditor.TIGHT),
      c: LayoutEditor.copy(R('clear.kind') || {}),
    };
  }

  html() {
    if (!this.w) this.load();
    return this.form.html();
  }

  filter(root) {
    this.form.filter(root);
  }

  /** Строка после правки — на месте: «изменено» и «↺» без перерисовки формы (ввод в следующее поле не пропадёт). */
  static mark(r) {
    const el = r.querySelector('[data-mx]');
    if (!el || r.dataset.lpd == null) return;
    const v = el.type === 'checkbox' ? String(el.checked) : el.value.trim().replace(/\s+/g, '').replace(',', '.');
    const num = Number(v);
    const chg = String(v !== '' && !Number.isNaN(num) ? num : v) !== r.dataset.lpd;
    r.classList.toggle('chg', chg);
    const b = r.querySelector('[data-lpdef]');
    if (b) b.hidden = !chg;
  }

  /** Набор → форма (только стратегия подбора; нормы отступов не меняются). */
  usePreset(id) {
    const v = LayoutParams.preset(id);
    if (!v) return;
    for (const [k, x] of Object.entries(v)) {
      const [g, f] = k.split('.');
      this.w.m[g][f] = x;
    }
  }

  /** Поля окна → рабочая копия; ошибка ввода — текстом с названием поля. */
  read(root) {
    for (const el of root.querySelectorAll('[data-mx]')) {
      const [t, path] = el.dataset.mx.split('|');
      this._put(t, path, LayoutEditor._value(el, t, path));
    }
    (this.w.m.sides.rows || []).forEach((r, j) => {
      const on = [...root.querySelectorAll(`[data-mxs="${j}"]`)].filter(c => c.checked);
      r.s = on.map(c => c.value).join('') || 'Ф';
    });
  }

  static _value(el, t, path) {
    if (el.type === 'checkbox') return el.checked;
    if (el.tagName === 'SELECT') {
      return /^-?\d+$/.test(el.value) && !/\.(a|b|of)$/.test(path) ? Number(el.value) : el.value;
    }
    return LayoutEditor._number(el, t === 'm' ? LayoutParams.field(...path.split('.')) : null);
  }

  static _label(el) {
    const row = el.closest('.lp-r');
    if (row) return row.querySelector('.lp-t').firstChild.textContent;
    return (el.closest('tr,label') || el).textContent.trim().slice(0, 60);
  }

  static _number(el, f) {
    const s = el.value.trim().replace(/\s+/g, '').replace(',', '.');
    const v = Number(s);
    if (!s || !Number.isFinite(v) || v < 0) throw new Error(`Не число: «${el.value}» — ${LayoutEditor._label(el)}`);
    if (f && (v < f.lo || v > f.hi)) {
      const u = f.u && f.u !== 'доля' ? ` ${f.u}` : '';
      const range = `от ${LayoutParams.show({}, f.lo)} до ${LayoutParams.show({}, f.hi)}${u}`;
      throw new Error(`${LayoutEditor._label(el)}: ${range}`);
    }
    return v;
  }

  static _set(o, path, v) {
    const k = path.split('.');
    const last = k.pop();
    const x = k.reduce((y, p) => y[p], o);
    x[last] = v;
  }

  _put(t, path, v) {
    const w = this.w;
    const put = {
      m: () => this._putMatrix(path, v),
      c: () => LayoutEditor._set(w.c, path, v),
      a: () => {
        w.a[Number(path)] = v;
      },
      t: () => {
        w.t = v;
      },
      r: () => {
        const r = (w.m.rotate.rows || []).find(q => q.kind === path);
        if (r) r.on = v;
      },
    }[t];
    put?.();
  }

  _putMatrix(path, v) {
    if (/^sides\.rows\.\d+\.door$/.test(path)) {
      LayoutEditor._set(this.w.m, path, Boolean(v));
    } else if (/^sides\.rows\.\d+\.tilt$/.test(path) && !v) {
      const k = path.split('.');
      delete this.w.m.sides.rows[Number(k[2])][k[3]];
    } else LayoutEditor._set(this.w.m, path, v);
  }

  /** «↺»: одно значение — по умолчанию программы */
  def(path) {
    const [t, p] = path.split('|'),
      D = this.defs();
    if (t === 'm') {
      const [g, k] = p.split('.');
      this.w.m[g][k] = LayoutEditor.copy(D.m[g][k]);
    } else if (t === 'a') this.w.a[+p] = D.a[+p];
    else if (t === 't') this.w.t = D.t;
  }
  add(root) {
    this.read(root);
    this.w.m.pair.rows.push({ a: 'other', b: 'other', base: 500, k: 0, of: '', min: 300, close: false });
  }
  del(root, j) {
    this.read(root);
    this.w.m.pair.rows.splice(j, 1);
  }
  /** все значения компоновки — как в файле поставки (матрица, проходы, отступы по видам) */
  reset() {
    this.w = this.defs();
  }
  /** новая версия правил с этими значениями */
  build() {
    const w = this.w;
    if (w.a[1] > w.a[0]) throw new Error('Проход оператора: «допустимо» больше «рекомендуется»');
    if (w.t < 600) throw new Error('Проход в крайнем случае — не меньше 600 мм (решение ПНЕВМОТЕХ)');
    if (w.m.service.min > w.m.service.max) throw new Error('Сервисные ворота: «ширина не меньше» больше «не больше»');
    for (const r of w.m.pair.rows)
      if (r.min > Math.max(r.base, 0) && !r.k)
        throw new Error(
          `Пара ${LayoutEditor.label(r.a)} ↔ ${LayoutEditor.label(r.b)}: «плотно» больше «рекомендуется»`,
        );
    return RuleEdit.version(this.p.data, d => {
      RuleEdit.set(d, 'layout.matrix', w.m, {
        id: 'layout.matrix',
        group: 'Компоновка',
        title: 'Матрица расстановки оборудования',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(d, 'norm.aisle', w.a, {
        id: 'norm.aisle',
        group: 'Нормы помещения',
        title: 'Проход обслуживания: рекомендуемый, допустимый',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(d, 'norm.aisle_tight', w.t, {
        id: 'norm.aisle_tight',
        group: 'Компоновка',
        title: 'Проход оператора в крайнем случае',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(d, 'clear.kind', w.c, {
        id: 'clear.kind',
        group: 'Компоновка',
        title: 'Отступы от стен и соседнего оборудования',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
    });
  }
}
