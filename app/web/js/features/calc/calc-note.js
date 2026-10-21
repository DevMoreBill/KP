import { StationRules } from '../rules/station-rules.js';
/**
 * Расчётная записка: разделы и шаги (данные, формула, правила, результат, запас), замечания, допущения, вопросы
 * заказчику; правила «требует подтверждения» и данные, которых нет в каталоге, — отдельным списком.
 */
export class CalcNote {
  constructor() {
    this.sections = [];
    this.cur = null;
    this.issues = [];
    this.weak = new Map();
    this.assumptions = [];
    this.questions = [];
    this.later = [];
    this.used = new Set();
  }

  /** «Осушитель …», если название не начинается с этого слова. */
  static lbl(word, name) {
    return String(name || '')
      .toLowerCase()
      .startsWith(word.toLowerCase().slice(0, 5))
      ? name
      : `${word} ${name}`;
  }

  /** Число с запятой и digits знаками; нет числа — «—». */
  static fmt(value, digits = 2) {
    if (value == null || !Number.isFinite(+value)) return '—';
    const k = Math.pow(10, digits);
    return String(Math.round(+value * k) / k)
      .replace('.', ',')
      .replace(/^-/, '−');
  }

  /** Доля part от whole в процентах. */
  static pct(part, whole) {
    return whole > 0 ? Math.round((part / whole - 1) * 1000) / 10 : null;
  }

  /** Новый раздел записки; дальше шаги идут в него. */
  section(id, title) {
    this.cur = { id, title, steps: [] };
    this.sections.push(this.cur);
    return this;
  }

  /** Значение правила; «требует подтверждения» — в список. */
  rule(id) {
    this.used.add(id);
    const rule = StationRules.rule(id);
    if (rule.status === 'unconfirmed' && !this.weak.has(id))
      this.weak.set(id, { id, title: rule.title, src: StationRules.src(id), note: rule.note || '' });
    return rule.value;
  }

  /** Шаг: {what, formula, data, rules, result, ok, margin, pick, note}. */
  step(step) {
    if (!this.cur) this.section('misc', 'Прочее');
    step.rules = (step.rules || []).filter(Boolean);
    this.cur.steps.push(step);
    return step;
  }

  /** Замечание: error — ошибка, warn — предупреждение. */
  issue(level, text) {
    this.issues.push({ level, text, sec: this.cur ? this.cur.id : '' });
  }

  /** Хватает ли с учётом погрешности данных (calc.tolerance): недобор в допуске — в пользу заказчика, не ошибка. */
  fits(have, need) {
    const tol = this.rule('calc.tolerance');
    const ok = have >= need * (1 - tol) - 1e-9;
    const edge = ok && have < need - 1e-9;
    const note = edge
      ? `На пределе: недобор ${CalcNote.fmt((1 - have / need) * 100, 1)} % — в пределах погрешности данных каталога; при желании — следующий типоразмер.`
      : '';
    return { ok, edge, note };
  }

  /** Данных нет в каталоге или в ТЗ — «требует подтверждения»; вопрос — «можно уточнить позже». */
  missing(key, text, ask) {
    if (!this.weak.has(key)) this.weak.set(key, { id: key, title: text, src: 'нет данных', note: '' });
    if (ask) this.ask(ask, true);
  }

  /** Допущение расчёта (без повторов). */
  assume(text) {
    if (!this.assumptions.includes(text)) this.assumptions.push(text);
  }

  /** Вопрос заказчику: обязательный — без ответа станцию не подобрать; later — уточнение, расчёт идёт по умолчанию. */
  ask(text, later) {
    const list = later ? this.later : this.questions;
    if (!list.includes(text)) list.push(text);
  }

  /** Итог записки: разделы, ошибки, предупреждения, допущения, вопросы. */
  result() {
    const errors = this.issues.filter(i => i.level === 'error');
    return {
      sections: this.sections.filter(section => section.steps.length),
      issues: this.issues,
      errors,
      warnings: this.issues.filter(i => i.level === 'warn'),
      weak: [...this.weak.values()],
      assumptions: this.assumptions,
      questions: this.questions,
      later: this.later,
      rules: [...this.used],
      version: StationRules.version(),
      ok: !errors.length,
    };
  }
}
