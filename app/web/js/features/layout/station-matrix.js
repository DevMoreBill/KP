import { LayoutParams } from './layout-params.js';
import { StationRules } from '../rules/station-rules.js';
import { MatrixDefaults } from './matrix-defaults.js';

/** Матрица расстановки: правила файла поверх значений по умолчанию; разобранное — один раз на матрицу. */
export class StationMatrix {
  static NO_DOOR = /^(dryer|receiver)$/;
  static #rules = null;
  static #merged = null;
  static #memoFor = null;
  static #memo = null;

  /** Действующая матрица: правило layout.matrix поверх DEF (по разделам). */
  static get MATRIX() {
    const v = StationRules.ok() ? StationRules.opt('layout.matrix') : null;
    if (!v || typeof v !== 'object') return MatrixDefaults.DEF;
    if (this.#rules !== v) {
      this.#rules = v;
      this.#merged = Object.fromEntries(
        Object.keys(MatrixDefaults.DEF).map(k => [
          k,
          v[k] && typeof v[k] === 'object' ? { ...MatrixDefaults.DEF[k], ...v[k] } : MatrixDefaults.DEF[k],
        ]),
      );
    }
    return this.#merged;
  }

  /** Разобранное из матрицы: g — разделы, s — стороны вида, p — пары соседей, d — производные объекты. */
  static memo() {
    const matrix = this.MATRIX;
    if (this.#memoFor !== matrix) {
      this.#memoFor = matrix;
      this.#memo = { g: new Map(), s: new Map(), p: new Map(), d: new Map() };
    }
    return this.#memo;
  }

  /** Значение из памяти или вычисленное и запомненное. */
  static cached(map, key, make) {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
  }

  /** Числа раздела g: значения правил в пределах LayoutParams, недостающее — по умолчанию. */
  static grp(group) {
    return this.cached(this.memo().g, group, () => {
      const v = this.MATRIX[group];
      const out = {};
      for (const [k, fallback] of Object.entries(MatrixDefaults.DEF[group])) {
        const limits = LayoutParams.field(group, k);
        const x = this.num(v[k], fallback);
        out[k] = limits ? Math.max(limits.lo, Math.min(limits.hi, x)) : x;
      }
      return Object.freeze(out);
    });
  }

  /** Объект, собранный из чисел матрицы, — один на матрицу. */
  static derive(k, make) {
    return this.cached(this.memo().d, k, make);
  }

  /** Число или значение по умолчанию. */
  static num(v, fallback) {
    const num = +v;
    return Number.isFinite(num) ? num : fallback;
  }

  /** Строки таблицы группы матрицы. */
  static rows(group) {
    return this.MATRIX[group].rows || [];
  }

  /** Зазор от стен, мм (0–150). */
  static gap() {
    return Math.max(0, Math.min(150, this.num(this.MATRIX.gap.v, 50)));
  }

  /** Размер «of» пары: 'receiver.w' — ширина (Ø) большего ресивера из пары; '' — 0. */
  static dim(ref, left, right) {
    const [kind, field] = String(ref || '').split('.');
    if (!kind) return 0;
    const size = { l: unit => unit.l, h: unit => unit.h }[field] || (unit => unit.pairD || unit.w);
    const v = unit => (unit && unit.kind === kind ? +size(unit) || 0 : 0);
    return Math.max(0, v(left), v(right));
  }

  /**
   * Между соседями по длине: [рекомендуется, не менее, крайний случай] или null — правила для пары нет.
   * @returns {number[] | null}
   */
  static pair(left, right) {
    const row = this.cached(
      this.memo().p,
      `${left.kind}|${right.kind}`,
      () =>
        this.rows('pair').find(
          line => (line.a === left.kind && line.b === right.kind) || (line.a === right.kind && line.b === left.kind),
        ) || null,
    );
    if (!row) return null;
    const rec = Math.round(Math.max(this.num(row.base, 0), this.num(row.k, 0) * this.dim(row.of, left, right)));
    const min = Math.min(rec, Math.max(0, this.num(row.min, rec)));
    return [rec, min, row.close ? 0 : min];
  }

  static OWN_WALL = ['pump', 'compressor', 'dryer', 'receiver'];

  /** От стены за агрегатом: [рекомендуется, «плотно»] или null. */
  static wall(unit) {
    const rows = this.rows('wall');
    const row =
      rows.find(line => line.kind === unit.kind) ||
      (this.OWN_WALL.includes(unit.kind) ? null : rows.find(line => line.kind === 'other'));
    if (!row) return null;
    const rec = Math.round(Math.max(this.num(row.base, 0), this.num(row.k, 0) * (+unit.w || 0)));
    return [rec, Math.min(rec, Math.max(0, this.num(row.tight, rec)))];
  }

  /** Правила доступа к агрегатам. */
  static access() {
    const access = this.MATRIX.access;
    return { back: this.num(access.back, 500), side: this.num(access.side, 600) };
  }

  static _sideRow(kind) {
    return this.rows('sides').find(line => line.kind === kind);
  }

  /** Обслуживаемые стороны вида: {F, B, L, R} — фронт, зад, бока. */
  static sides(kind) {
    return this.cached(this.memo().s, kind, () => {
      const row = this._sideRow(kind) || this._sideRow('other');
      const sides = String((row && row.s) || 'Ф').toUpperCase();
      return Object.freeze({
        F: sides.includes('Ф'),
        B: sides.includes('З'),
        L: sides.includes('Л'),
        R: sides.includes('П'),
      });
    });
  }

  /** Можно ли поворачивать агрегат вида. */
  static rot(kind) {
    const row = this.rows('rotate').find(line => line.kind === kind);
    return row ? row.on !== false : !/^(dgu|cabinet)$/.test(kind);
  }

  /** Без сервисных ворот: по отметке таблицы «Стороны», без отметки — осушители и ресиверы. */
  static noDoor(kind) {
    const row = this._sideRow(kind);
    return row && typeof row.door === 'boolean' ? !row.door : this.NO_DOOR.test(kind);
  }

  /** При выносе можно наклонить. */
  static tilt(kind) {
    const row = this._sideRow(kind);
    return row ? Boolean(row.tilt) : /^(receiver|filter|cabinet|tank)$/.test(kind);
  }

  /** Группа «Ворота». */
  static gate() {
    return this.grp('gate');
  }

  /** Группа «Обслуживание». */
  static service() {
    return this.grp('service');
  }

  /** Группа «Двери». */
  static door() {
    return this.grp('door');
  }

  /** Группа «Проходы». */
  static aisle() {
    return this.grp('aisle');
  }

  /** Группа «Выходы». */
  static exits() {
    return this.grp('exits');
  }

  /** Жалюзи выброса. */
  static louvre() {
    return this.grp('exhaust').louvre;
  }

  /** Группа «Подбор размера». */
  static fit() {
    return this.grp('fit');
  }

  /** Группа «Режимы». */
  static modes() {
    return this.grp('modes');
  }

  /** Группа «Ресиверы». */
  static recv() {
    return this.grp('recv');
  }

  /** Группа «Шкафы». */
  static cab() {
    return this.grp('cab');
  }

  /** Группа «Перемещение». */
  static move() {
    return this.grp('move');
  }

  /** Группа «Бак». */
  static tank() {
    return this.grp('tank');
  }

  /** Группа «Конвекторы». */
  static conv() {
    return this.grp('conv');
  }

  /** Группа «Глушители». */
  static muffler() {
    return this.grp('muffler');
  }
}
