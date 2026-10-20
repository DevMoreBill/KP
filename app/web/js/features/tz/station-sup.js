import { StationEquip } from '../layout/station-equip.js';
import { StationMatrix } from '../layout/station-matrix.js';
/** Один поставщик в станции: при равных условиях — оборудование того же поставщика, что и основные агрегаты. */
export class StationSup {
  static ctx = ''; // поставщик основного оборудования станции, под которую идёт подбор
  static key(s) {
    return norm(s || '');
  }
  static of(c) {
    return c && typeof CW !== 'undefined' ? this.key(CW.supplierOf(c)) : '';
  }
  static get TOL() {
    return Math.max(0, +StationMatrix.grp('pick').oneSup || 0) / 100;
  }
  /** поставщик основного оборудования станции x (компрессоры, ДГУ, насосы — роль main) */
  static use(x) {
    const p = kitParts(x).find(z => z.role === 'main'),
      c = p && catCache.find(z => z.id === p.catId);
    this.ctx = this.of(c);
    return this.ctx;
  }
  static same(c) {
    return !!this.ctx && this.TOL > 0 && this.of(c) === this.ctx ? 1 : 0;
  }
  /** сколько видов подготовки воздуха (осушитель cat, фильтры) есть у поставщика позиции c — компрессор от того, кто закроет больше состава */
  static cover(c, cats) {
    const s = this.of(c);
    if (!s || !(this.TOL > 0)) return 0;
    return cats.filter(k => catCache.some(z => attrsOf(z).cat === k && this.of(z) === s)).length;
  }
  /** выбор из кандидатов [{…, score}] при «равных условиях»: в пределах допуска от лучшего — с наибольшим rank, затем лучший */
  /** поставщик элемента состава p (позиция каталога), как в каталоге: «ООО Альфа» | '' */
  static label(p) {
    const c = p && p.catId ? catCache.find(z => z.id === p.catId) : null;
    return c && typeof CW !== 'undefined' ? String(CW.supplierOf(c) || '').trim() : '';
  }
  /** поставщики оборудования станции (наше: агрегаты, подготовка воздуха, ресиверы, баки): «Всё у одного поставщика: …» /
   *  «Поставщиков: 2 — Альфа (компрессоры, осушитель); Бета (ресиверы)» | '' — оборудования из каталога нет */
  static summary(x) {
    const KIND = {
        compressor: 'компрессоры',
        dgu: 'ДГУ',
        pump: 'насосы',
        dryer: 'осушители',
        filter: 'фильтры',
        receiver: 'ресиверы',
        tank: 'бак',
      },
      by = new Map();
    for (const p of kitParts(x)) {
      const k = StationEquip.kindOf(p);
      if (!KIND[k]) continue;
      const s = this.label(p) || 'без поставщика в каталоге',
        e = by.get(s) || new Set();
      e.add(KIND[k]);
      by.set(s, e);
    }
    if (!by.size) return '';
    if (by.size === 1) return `Всё у одного поставщика: ${[...by.keys()][0]}`;
    return `Поставщиков: ${by.size} — ${[...by].map(([s, e]) => `${s} (${[...e].join(', ')})`).join('; ')}`;
  }
  static pick(L, rank, tol) {
    if (!L.length) return null;
    const b = L.reduce((m, o) => (o.score < m.score ? o : m), L[0]);
    if (!(this.TOL > 0)) return b;
    const near = L.filter(o => o.score <= b.score + tol + 1e-9);
    return near.reduce((m, o) => (rank(o) > rank(m) || (rank(o) === rank(m) && o.score < m.score) ? o : m), b);
  }
}
