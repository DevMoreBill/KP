import { StationMatrix } from './station-matrix.js';

/** Станция из нескольких блок-модулей: раскладка a × b, стыки, стойки каркаса, что в каком модуле. */
export class StationMods {
  /** Правила раздела «Модули» матрицы. */
  static get RULES() {
    return StationMatrix.grp('mods');
  }

  /** Наибольшее число модулей. */
  static get MAX() {
    return Math.max(2, this.RULES.max || 9);
  }

  /** Ширины модуля, мм: wMin, кратные 100 между ними и wMax (не шире габарита перевозки). */
  static widths() {
    const road = StationMatrix.fit().roadW; // как StationGeo.ROAD_W (StationGeo подключает модули)
    const low = Math.min(this.RULES.wMin || 2448, road);
    const high = Math.max(low, Math.min(this.RULES.wMax || 2550, road));
    const out = [low];
    for (let width = Math.ceil((low + 1) / 100) * 100; width < high; width += 100) out.push(width);
    if (high > low) out.push(high);
    return out;
  }

  /** Раскладка элемента «контейнер» — прямоугольник из 2 и больше модулей, иначе null. */
  static of(geo) {
    const grid = geo && geo.mods && this.rect(geo.mods.cells);
    return grid && grid.ok && grid.n > 1 ? grid : null;
  }

  /**
   * Клетки сетки → раскладка, сдвинутая к началу; ok — без повторов, прямоугольник целиком, не больше MAX.
   * @returns {{ok: boolean, n: number, a: number, b: number, cells: number[][]} | null}
   */
  static rect(cells) {
    const valid = (Array.isArray(cells) ? cells : []).filter(
      cell => Array.isArray(cell) && cell.length === 2 && cell.every(Number.isInteger),
    );
    const count = valid.length;
    if (!count) return null;
    const x0 = Math.min(...valid.map(cell => cell[0]));
    const y0 = Math.min(...valid.map(cell => cell[1]));
    const norm = valid.map(([x, y]) => [x - x0, y - y0]);
    const cols = Math.max(...norm.map(cell => cell[0])) + 1;
    const rows = Math.max(...norm.map(cell => cell[1])) + 1;
    const uniq = new Set(norm.map(cell => cell.join(','))).size === count;
    return { ok: uniq && cols * rows === count && count <= this.MAX, n: count, a: cols, b: rows, cells: norm };
  }

  /** Ячейки сетки модулей cols × rows. */
  static cells(cols, rows) {
    return Array.from({ length: cols * rows }, (_, k) => [k % cols, Math.floor(k / cols)]);
  }

  /** Прямоугольные раскладки из n модулей: сначала вдоль, затем бок о бок. */
  static shapes(count) {
    const out = [];
    for (let cols = count; cols >= 1; cols--) if (count % cols === 0) out.push([cols, count / cols]);
    return out;
  }

  /** Число стыков сетки модулей. */
  static joints(mods) {
    return mods ? (mods.a - 1) * mods.b + mods.a * (mods.b - 1) : 0;
  }

  /** «модуль», «модуля» или «модулей» по числу. */
  static word(v) {
    const tail10 = v % 10;
    const tail100 = v % 100;
    if (tail10 === 1 && tail100 !== 11) return `${v} модуль`;
    if ([2, 3, 4].includes(tail10) && ![12, 13, 14].includes(tail100)) return `${v} модуля`;
    return `${v} модулей`;
  }

  /** «2 модуля бок о бок», «3 модуля торец к торцу», «4 модуля: 2 по длине × 2 по ширине» */
  static shape(mods) {
    if (mods.b === 1) return `${this.word(mods.n)} торец к торцу`;
    if (mods.a === 1) return `${this.word(mods.n)} бок о бок`;
    return `${this.word(mods.n)}: ${mods.a} по длине × ${mods.b} по ширине`;
  }

  static _offsets(geo) {
    return [(geo.ext[0] - geo.int[0]) / 2, (geo.ext[1] - geo.int[1]) / 2];
  }

  /** Стойки каркаса на пересечениях стыков (a и b от 2): [{x, y}] мм внутри. */
  static posts(geo) {
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm || mods.a < 2 || mods.b < 2) return [];
    const [ox, oy] = this._offsets(geo);
    const out = [];
    for (let i = 1; i < mods.a; i++)
      for (let j = 1; j < mods.b; j++) out.push({ x: i * mods.Lm - ox, y: j * mods.Wm - oy });
    return out;
  }

  /** Оборудование на полу, стоящее на стойке стыка (с отступом в полстойки). */
  static hits(items, geo) {
    const posts = this.posts(geo);
    const half = this.RULES.post / 2;
    if (!posts.length) return [];
    const onPost = i =>
      posts.some(
        post => i.x < post.x + half && i.x + i.lx > post.x - half && i.y < post.y + half && i.y + i.ly > post.y - half,
      );
    return (items || []).filter(i => i.mount !== 'wall' && i.mount !== 'pipe' && onPost(i));
  }

  /** Элементы, заходящие за линию стыка ближе полустойки (трубопровод не считается — его расстыковывают). */
  static cross(items, geo) {
    const joints = this.lines(geo);
    const half = this.RULES.post / 2;
    if (!joints.x.length && !joints.y.length) return [];
    const onX = i => joints.x.some(x => i.x < x + half && i.x + i.lx > x - half);
    const onY = i => joints.y.some(y => i.y < y + half && i.y + i.ly > y - half);
    return (items || []).filter(i => i.mount !== 'pipe' && (onX(i) || onY(i)));
  }

  /** Что в каком модуле: Map 'i,j' → [{pos, name}] по позиции один раз, трубопровод и фильтры на нём не считаются. */
  static content(plan) {
    const geo = plan && plan.geo;
    const mods = geo && geo.mods;
    const out = new Map();
    if (!mods || !mods.Lm || !plan.items) return out;
    const [ox, oy] = this._offsets(geo);
    const clamp = (v, size) => Math.min(size - 1, Math.max(0, v));
    for (const item of plan.items.filter(i => i.mount !== 'pipe')) {
      const i = clamp(Math.floor((ox + item.x + item.lx / 2) / mods.Lm), mods.a);
      const j = clamp(Math.floor((oy + item.y + item.ly / 2) / mods.Wm), mods.b);
      const key = `${i},${j}`;
      if (!out.has(key)) out.set(key, []);
      const list = out.get(key);
      if (!list.some(other => other.pos === item.pos))
        list.push({ pos: item.pos, name: item.short || item.name || '' });
    }
    for (const list of out.values()) list.sort((left, right) => left.pos - right.pos);
    return out;
  }

  /** Линии стыков внутри помещения, мм: x — поперёк, y — вдоль. */
  static lines(geo) {
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm) return { x: [], y: [] };
    const [ox, oy] = this._offsets(geo);
    return {
      x: Array.from({ length: mods.a - 1 }, (_, i) => (i + 1) * mods.Lm - ox),
      y: Array.from({ length: mods.b - 1 }, (_, j) => (j + 1) * mods.Wm - oy),
    };
  }
}
