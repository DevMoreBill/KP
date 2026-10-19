import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';

/** Станция из нескольких блок-модулей: раскладка a × b, стыки, стойки каркаса, что в каком модуле. */
export class StationMods {
  static get M() {
    return StationMatrix.grp('mods');
  }

  static get MAX() {
    return Math.max(2, this.M.max || 9);
  }

  /** Ширины модуля, мм: wMin, кратные 100 между ними и wMax (не шире габарита перевозки). */
  static widths() {
    const road = StationGeo.ROAD_W;
    const lo = Math.min(this.M.wMin || 2448, road);
    const hi = Math.max(lo, Math.min(this.M.wMax || 2550, road));
    const out = [lo];
    for (let w = Math.ceil((lo + 1) / 100) * 100; w < hi; w += 100) out.push(w);
    if (hi > lo) out.push(hi);
    return out;
  }

  /** Раскладка элемента «контейнер» — прямоугольник из 2 и больше модулей, иначе null. */
  static of(c) {
    const r = c && c.mods && this.rect(c.mods.cells);
    return r && r.ok && r.n > 1 ? r : null;
  }

  /**
   * Клетки сетки → раскладка, сдвинутая к началу; ok — без повторов, прямоугольник целиком, не больше MAX.
   * @returns {{ok: boolean, n: number, a: number, b: number, cells: number[][]} | null}
   */
  static rect(cells) {
    const C = (Array.isArray(cells) ? cells : []).filter(
      q => Array.isArray(q) && q.length === 2 && q.every(Number.isInteger),
    );
    const n = C.length;
    if (!n) return null;
    const x0 = Math.min(...C.map(q => q[0]));
    const y0 = Math.min(...C.map(q => q[1]));
    const N = C.map(([x, y]) => [x - x0, y - y0]);
    const a = Math.max(...N.map(q => q[0])) + 1;
    const b = Math.max(...N.map(q => q[1])) + 1;
    const uniq = new Set(N.map(q => q.join(','))).size === n;
    return { ok: uniq && a * b === n && n <= this.MAX, n, a, b, cells: N };
  }

  static cells(a, b) {
    return Array.from({ length: a * b }, (_, k) => [k % a, Math.floor(k / a)]);
  }

  /** Прямоугольные раскладки из n модулей: сначала вдоль, затем бок о бок. */
  static shapes(n) {
    const out = [];
    for (let a = n; a >= 1; a--) if (n % a === 0) out.push([a, n / a]);
    return out;
  }

  static joints(m) {
    return m ? (m.a - 1) * m.b + m.a * (m.b - 1) : 0;
  }

  static word(v) {
    const tail10 = v % 10;
    const tail100 = v % 100;
    if (tail10 === 1 && tail100 !== 11) return `${v} модуль`;
    if ([2, 3, 4].includes(tail10) && ![12, 13, 14].includes(tail100)) return `${v} модуля`;
    return `${v} модулей`;
  }

  /** «2 модуля бок о бок», «3 модуля торец к торцу», «4 модуля: 2 по длине × 2 по ширине» */
  static shape(m) {
    if (m.b === 1) return `${this.word(m.n)} торец к торцу`;
    if (m.a === 1) return `${this.word(m.n)} бок о бок`;
    return `${this.word(m.n)}: ${m.a} по длине × ${m.b} по ширине`;
  }

  static offsets(geo) {
    return [(geo.ext[0] - geo.int[0]) / 2, (geo.ext[1] - geo.int[1]) / 2];
  }

  /** Стойки каркаса на пересечениях стыков (a и b от 2): [{x, y}] мм внутри. */
  static posts(geo) {
    const m = geo && geo.mods;
    if (!m || !m.Lm || m.a < 2 || m.b < 2) return [];
    const [ox, oy] = this.offsets(geo);
    const out = [];
    for (let i = 1; i < m.a; i++) for (let j = 1; j < m.b; j++) out.push({ x: i * m.Lm - ox, y: j * m.Wm - oy });
    return out;
  }

  /** Оборудование на полу, стоящее на стойке стыка (с отступом в полстойки). */
  static hits(items, geo) {
    const P = this.posts(geo);
    const s = this.M.post / 2;
    if (!P.length) return [];
    const onPost = i => P.some(p => i.x < p.x + s && i.x + i.lx > p.x - s && i.y < p.y + s && i.y + i.ly > p.y - s);
    return (items || []).filter(i => i.mount !== 'wall' && i.mount !== 'pipe' && onPost(i));
  }

  /** Элементы, заходящие за линию стыка ближе полустойки (трубопровод не считается — его расстыковывают). */
  static cross(items, geo) {
    const J = this.lines(geo);
    const s = this.M.post / 2;
    if (!J.x.length && !J.y.length) return [];
    const onX = i => J.x.some(x => i.x < x + s && i.x + i.lx > x - s);
    const onY = i => J.y.some(y => i.y < y + s && i.y + i.ly > y - s);
    return (items || []).filter(i => i.mount !== 'pipe' && (onX(i) || onY(i)));
  }

  /** Что в каком модуле: Map 'i,j' → [{pos, name}] по позиции один раз, трубопровод и фильтры на нём не считаются. */
  static content(plan) {
    const g = plan && plan.geo;
    const m = g && g.mods;
    const out = new Map();
    if (!m || !m.Lm || !plan.items) return out;
    const [ox, oy] = this.offsets(g);
    const clamp = (v, n) => Math.min(n - 1, Math.max(0, v));
    for (const it of plan.items.filter(i => i.mount !== 'pipe')) {
      const i = clamp(Math.floor((ox + it.x + it.lx / 2) / m.Lm), m.a);
      const j = clamp(Math.floor((oy + it.y + it.ly / 2) / m.Wm), m.b);
      const key = `${i},${j}`;
      if (!out.has(key)) out.set(key, []);
      const list = out.get(key);
      if (!list.some(q => q.pos === it.pos)) list.push({ pos: it.pos, name: it.short || it.name || '' });
    }
    for (const list of out.values()) list.sort((p, q) => p.pos - q.pos);
    return out;
  }

  /** Линии стыков внутри помещения, мм: x — поперёк, y — вдоль. */
  static lines(geo) {
    const m = geo && geo.mods;
    if (!m || !m.Lm) return { x: [], y: [] };
    const [ox, oy] = this.offsets(geo);
    return {
      x: Array.from({ length: m.a - 1 }, (_, i) => (i + 1) * m.Lm - ox),
      y: Array.from({ length: m.b - 1 }, (_, j) => (j + 1) * m.Wm - oy),
    };
  }
}
