import { StationEquip } from '../layout/station-equip.js';
import { StationMatrix } from '../layout/station-matrix.js';
/** Один поставщик в станции: при равных условиях — оборудование того же поставщика, что и основные агрегаты. */
export class StationSup {
  static ctx = ''; // поставщик основного оборудования станции, под которую идёт подбор
  static EPS = 1e-9;
  /** Ключ поставщика для сравнения. */
  static key(supplier) {
    return norm(supplier || '');
  }
  /** Поставщик позиции каталога. */
  static of(item) {
    return item && typeof CW !== 'undefined' ? this.key(CW.supplierOf(item)) : '';
  }
  /** Допуск приоритета поставщика (доля запаса). */
  static get TOL() {
    return Math.max(0, +StationMatrix.grp('pick').oneSup || 0) / 100;
  }
  /** поставщик основного оборудования станции x (компрессоры, ДГУ, насосы — роль main) */
  static use(station) {
    const part = Kit.parts(station).find(z => z.role === 'main'),
      item = part && catCache.find(z => z.id === part.catId);
    this.ctx = this.of(item);
    return this.ctx;
  }
  /** 1 — тот же поставщик, что у основного оборудования. */
  static same(item) {
    return !!this.ctx && this.TOL > 0 && this.of(item) === this.ctx ? 1 : 0;
  }
  /** сколько видов подготовки воздуха (осушитель cat, фильтры) есть у поставщика позиции c — компрессор от того, кто закроет больше состава */
  static cover(item, cats) {
    const supplier = this.of(item);
    if (!supplier || !(this.TOL > 0)) return 0;
    return cats.filter(k => catCache.some(z => attrsOf(z).cat === k && this.of(z) === supplier)).length;
  }
  /** выбор из кандидатов [{…, score}] при «равных условиях»: в пределах допуска от лучшего — с наибольшим rank, затем лучший */
  /** поставщик элемента состава p (позиция каталога), как в каталоге: «ООО Альфа» | '' */
  static label(part) {
    const item = part && part.catId ? catCache.find(z => z.id === part.catId) : null;
    return item && typeof CW !== 'undefined' ? String(CW.supplierOf(item) || '').trim() : '';
  }
  /** поставщики оборудования станции (наше: агрегаты, подготовка воздуха, ресиверы, баки): «Всё у одного поставщика: …» /
   *  «Поставщиков: 2 — Альфа (компрессоры, осушитель); Бета (ресиверы)» | '' — оборудования из каталога нет */
  static summary(station) {
    const KIND = {
        compressor: 'компрессоры',
        dgu: 'ДГУ',
        pump: 'насосы',
        dryer: 'осушители',
        filter: 'фильтры',
        receiver: 'ресиверы',
        tank: 'бак',
      },
      bySupplier = new Map();
    for (const part of Kit.parts(station)) {
      const k = StationEquip.kindOf(part);
      if (!KIND[k]) continue;
      const supplier = this.label(part) || 'без поставщика в каталоге',
        kinds = bySupplier.get(supplier) || new Set();
      kinds.add(KIND[k]);
      bySupplier.set(supplier, kinds);
    }
    if (!bySupplier.size) return '';
    if (bySupplier.size === 1) return `Всё у одного поставщика: ${[...bySupplier.keys()][0]}`;
    return `Поставщиков: ${bySupplier.size} — ${[...bySupplier].map(([supplier, kinds]) => `${supplier} (${[...kinds].join(', ')})`).join('; ')}`;
  }
  /** Лучший по оценке; в пределах допуска — того же поставщика. */
  static pick(options, rank, tol) {
    if (!options.length) return null;
    const best = options.reduce((kept, option) => (option.score < kept.score ? option : kept), options[0]);
    if (!(this.TOL > 0)) return best;
    const near = options.filter(option => option.score <= best.score + tol + this.EPS);
    return near.reduce(
      (kept, option) =>
        rank(option) > rank(kept) || (rank(option) === rank(kept) && option.score < kept.score) ? option : kept,
      best,
    );
  }
}
