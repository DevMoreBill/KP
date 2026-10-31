import { LayoutForm } from './layout-form.js';
import { LayoutParams } from '../layout/layout-params.js';
import { RuleEdit } from './rule-edit.js';
import { LayoutData } from './layout-data.js';

/** Правила компоновки станций («Настройки → Нормы станций»): рабочая копия, чтение формы, новая версия правил. */
export class LayoutEditor {
  static AISLE = [1000, 800];
  static TIGHT = 600;

  constructor(panel) {
    this.panel = panel;
    this.work = null;
    this.query = '';
    this.form = new LayoutForm(this);
  }

  static _keyLabel(k) {
    return LayoutForm.label(k);
  }

  /** Значения по умолчанию — из файла поставки (сервер: layoutDef), без него — заложенные в программу. */
  defs() {
    const layoutDef = this.panel.layoutDef || {};
    return {
      m: LayoutData.merge(layoutDef['layout.matrix']),
      a: LayoutData.copy(layoutDef['norm.aisle'] || LayoutEditor.AISLE),
      t: Number(layoutDef['norm.aisle_tight'] || LayoutEditor.TIGHT),
      c: LayoutData.copy(layoutDef['clear.kind'] || this.work?.c || {}),
    };
  }

  /** Рабочая копия: матрица, проходы, отступы. */
  load() {
    const ruleValue = id => LayoutData.rule(this.panel.data, id)?.value;
    this.work = {
      m: LayoutData.merge(ruleValue('layout.matrix')),
      a: LayoutData.copy(ruleValue('norm.aisle') || LayoutEditor.AISLE),
      t: Number(ruleValue('norm.aisle_tight') || LayoutEditor.TIGHT),
      c: LayoutData.copy(ruleValue('clear.kind') || {}),
    };
  }

  /** Разметка формы по рабочей копии. */
  html() {
    if (!this.work) this.load();
    return this.form.html();
  }

  /** Скрыть разделы формы, где нет искомого параметра. */
  filter(root) {
    this.form.filter(root);
  }

  /** Строка после правки — на месте: «изменено» и «↺» без перерисовки формы (ввод в следующее поле не пропадёт). */
  static mark(row) {
    const el = row.querySelector('[data-mx]');
    if (!el || row.dataset.lpd == null) return;
    const value = el.type === 'checkbox' ? String(el.checked) : el.value.trim().replace(/\s+/g, '').replace(',', '.');
    const num = Number(value);
    const chg = String(value !== '' && !Number.isNaN(num) ? num : value) !== row.dataset.lpd;
    row.classList.toggle('chg', chg);
    const defButton = row.querySelector('[data-lpdef]');
    if (defButton) defButton.hidden = !chg;
  }

  /** Набор → форма (только стратегия подбора; нормы отступов не меняются). */
  usePreset(id) {
    const preset = LayoutParams.preset(id);
    if (!preset) return;
    for (const [k, x] of Object.entries(preset)) {
      const [group, field] = k.split('.');
      this.work.m[group][field] = x;
    }
  }

  /** Поля окна → рабочая копия; ошибка ввода — текстом с названием поля. */
  read(root) {
    for (const el of root.querySelectorAll('[data-mx]')) {
      const [type, path] = el.dataset.mx.split('|');
      this._put(type, path, LayoutEditor._value(el, type, path));
    }
    (this.work.m.sides.rows || []).forEach((row, j) => {
      const checked = [...root.querySelectorAll(`[data-mxs="${j}"]`)].filter(box => box.checked);
      row.s = checked.map(box => box.value).join('') || 'Ф';
    });
  }

  static _value(el, type, path) {
    if (el.type === 'checkbox') return el.checked;
    if (el.tagName === 'SELECT') {
      return /^-?\d+$/.test(el.value) && !/\.(a|b|of)$/.test(path) ? Number(el.value) : el.value;
    }
    return LayoutEditor._number(el, type === 'm' ? LayoutParams.field(...path.split('.')) : null);
  }

  static _label(el) {
    const row = el.closest('.lp-r');
    if (row) return row.querySelector('.lp-t').firstChild.textContent;
    return (el.closest('tr,label') || el).textContent.trim().slice(0, 60);
  }

  static _number(el, field) {
    const text = el.value.trim().replace(/\s+/g, '').replace(',', '.');
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value < 0)
      throw new Error(`Не число: «${el.value}» — ${LayoutEditor._label(el)}`);
    if (field && (value < field.lo || value > field.hi)) {
      const unitText = field.u && field.u !== 'доля' ? ` ${field.u}` : '';
      const range = `от ${LayoutParams.show({}, field.lo)} до ${LayoutParams.show({}, field.hi)}${unitText}`;
      throw new Error(`${LayoutEditor._label(el)}: ${range}`);
    }
    return value;
  }

  static _set(obj, path, value) {
    const k = path.split('.');
    const last = k.pop();
    const x = k.reduce((y, key) => y[key], obj);
    x[last] = value;
  }

  _put(type, path, value) {
    const work = this.work;
    const put = {
      m: () => this._putMatrix(path, value),
      c: () => LayoutEditor._set(work.c, path, value),
      a: () => {
        work.a[Number(path)] = value;
      },
      t: () => {
        work.t = value;
      },
      r: () => {
        const row = (work.m.rotate.rows || []).find(entry => entry.kind === path);
        if (row) row.on = value;
      },
    }[type];
    put?.();
  }

  _putMatrix(path, value) {
    if (/^sides\.rows\.\d+\.door$/.test(path)) {
      LayoutEditor._set(this.work.m, path, Boolean(value));
    } else if (/^sides\.rows\.\d+\.tilt$/.test(path) && !value) {
      const k = path.split('.');
      delete this.work.m.sides.rows[Number(k[2])][k[3]];
    } else LayoutEditor._set(this.work.m, path, value);
  }

  /** «↺»: одно значение — по умолчанию программы */
  def(path) {
    const [type, key] = path.split('|'),
      defs = this.defs();
    if (type === 'm') {
      const [group, k] = key.split('.');
      this.work.m[group][k] = LayoutData.copy(defs.m[group][k]);
    } else if (type === 'a') this.work.a[+key] = defs.a[+key];
    else if (type === 't') this.work.t = defs.t;
  }
  /** Добавить строку в таблицу пар матрицы. */
  add(root) {
    this.read(root);
    this.work.m.pair.rows.push({ a: 'other', b: 'other', base: 500, k: 0, of: '', min: 300, close: false });
  }
  /** Удалить строку j таблицы пар матрицы. */
  del(root, j) {
    this.read(root);
    this.work.m.pair.rows.splice(j, 1);
  }
  /** все значения компоновки — как в файле поставки (матрица, проходы, отступы по видам) */
  reset() {
    this.work = this.defs();
  }
  /** новая версия правил с этими значениями */
  build() {
    const work = this.work;
    if (work.a[1] > work.a[0]) throw new Error('Проход оператора: «допустимо» больше «рекомендуется»');
    if (work.t < 600) throw new Error('Проход в крайнем случае — не меньше 600 мм (решение ПНЕВМОТЕХ)');
    if (work.m.service.min > work.m.service.max)
      throw new Error('Сервисные ворота: «ширина не меньше» больше «не больше»');
    for (const row of work.m.pair.rows)
      if (row.min > Math.max(row.base, 0) && !row.k)
        throw new Error(
          `Пара ${LayoutEditor._keyLabel(row.a)} ↔ ${LayoutEditor._keyLabel(row.b)}: «плотно» больше «рекомендуется»`,
        );
    return RuleEdit.version(this.panel.data, draft => {
      RuleEdit.set(draft, 'layout.matrix', work.m, {
        id: 'layout.matrix',
        group: 'Компоновка',
        title: 'Матрица расстановки оборудования',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(draft, 'norm.aisle', work.a, {
        id: 'norm.aisle',
        group: 'Нормы помещения',
        title: 'Проход обслуживания: рекомендуемый, допустимый',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(draft, 'norm.aisle_tight', work.t, {
        id: 'norm.aisle_tight',
        group: 'Компоновка',
        title: 'Проход оператора в крайнем случае',
        status: 'practice',
        unit: 'мм',
        source: { doc: 'Решение ПНЕВМОТЕХ' },
      });
      RuleEdit.set(draft, 'clear.kind', work.c, {
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
