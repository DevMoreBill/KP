import { LayoutItem } from './layout-item.js';
import { LayoutPipes } from './layout-pipes.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

const stageOf = e => (e.air && e.air.stage != null ? e.air.stage : 50);
const overlaps = (list, a, b) => list.some(([p, q]) => a < q && b > p);

/** Голова фильтра на линии ln: корпус ниже оси, не ниже 150 мм от пола и не под потолком. */
const hangs = (ln, h, H) => ln.z + Math.max(60, h * 0.12) - h >= 150 && ln.z + Math.max(60, h * 0.12) <= H - 50;

/** Настенный шкаф: место на стене прохода, на торцах, на задней стене (без продольного прохода). */
class CabinetSpot {
  constructor(lay, e, r, geo) {
    [this.L, this.W, this.H] = geo.int;
    Object.assign(this, { lay, e, r, geo, x0: geo.x0 || 0, w: e.l, d: e.w });
    const cab = StationMatrix.cab();
    this.z = Math.max(cab.low, Math.min(cab.top, this.H - 150) - e.h);
    this.floor = r.items.filter(i => i.mount !== 'wall' && i.mount !== 'pipe');
    this.cabs = r.items.filter(i => i.mount === 'wall');
    const J = StationMods.lines(geo);
    const half = StationMods.M.post / 2;
    this.jX = J.x.map(v => [v - half, v + half]);
    this.jY = J.y.map(v => [v - half, v + half]);
    this.gate = r.gates && r.gates.pos.length ? r.gates : null;
    this.out = this.gate ? lay.gates.bulky(r, geo).filter(b => this.gate.pos.includes(b.it.pos)) : [];
  }

  /** Места по порядку: у ДГУ торец у входа — под приток воздуха. */
  find() {
    if (this.r.rows !== 1 || this.z + this.e.h > this.H - 50) return null;
    const [rec, min] = this.lay.aisle;
    if (this.floor.some(i => i.kind === 'dgu')) return this.front(rec) || this.front(min) || this.end('left');
    return (
      this.front(rec) || this.back(rec) || this.end('left') || this.end('right') || this.front(min) || this.back(min)
    );
  }

  /** То, что выносят через ворота в торце, проходит мимо шкафа. */
  clear(x) {
    if (!this.out.length) return true;
    const { w, d, W } = this;
    const under = this.floor.filter(i => i.x < x + w && i.x + i.lx > x);
    const room = (under.length ? Math.min(...under.map(i => i.y)) : W) - d;
    const pass = StationMatrix.move().pass;
    const beyond = b => (this.gate.wall === 'right' ? b.it.x >= x + w : b.it.x + b.it.lx <= x);
    return this.out.every(b => beyond(b) || b.narrow + 2 * pass <= room);
  }

  box(x, y, lx, ly) {
    return { x, y, z: this.z, lx, ly, h: this.e.h };
  }

  free(box) {
    return !this.r.items.some(i => LayoutItem.hit(box, i, 0));
  }

  /** На стене прохода: перед шкафом проход не уже need; не на двери оператора и сервисных воротах. */
  front(need) {
    const { r, w, d } = this;
    const busy = [...this.cabs.filter(i => i.wall === 'front').map(i => [i.x - 100, i.x + i.lx + 100]), ...this.jX];
    if (r.door === 'side') {
      const ex = this.lay.exits.entrySpan(r, this.geo);
      busy.push([ex[0] - 150, ex[1] + 150]);
    }
    for (const dd of (r.doors || []).filter(q => q.wall === 'front')) busy.push([dd.x0 - 150, dd.x1 + 150]);
    const ok = x =>
      !overlaps(busy, x, x + w) &&
      this.floor.every(i => i.x >= x + w || i.x + i.lx <= x || i.y - d >= need) &&
      this.clear(x) &&
      this.free(this.box(x, 0, w, d));
    const x = this.scan(ok);
    return x == null ? null : this.place({ x, y: 0, z: this.z, mount: 'wall', wall: 'front', face: 1 });
  }

  /** Без продольного прохода: на задней стене напротив двери оператора. */
  back(need) {
    const { r, w, d, W } = this;
    if (!r.ends) return null;
    const busy = [
      ...this.cabs.filter(i => i.wall === 'back').map(i => [i.x - 100, i.x + i.lx + 100]),
      ...this.jX,
      ...(r.doors || []).filter(q => q.wall === 'back').map(q => [q.x0 - 150, q.x1 + 150]),
    ];
    const ok = x =>
      !overlaps(busy, x, x + w) &&
      this.floor.every(i => i.x >= x + w || i.x + i.lx <= x || W - d - (i.y + i.ly) >= need) &&
      this.free(this.box(x, W - d, w, d));
    const x = this.scan(ok);
    return x == null ? null : this.place({ x, y: W - d, z: this.z, mount: 'wall', wall: 'back', face: -1 });
  }

  scan(ok) {
    for (let x = this.x0 + 150; x + this.w <= this.L - 150; x += 50) if (ok(x)) return x;
    return null;
  }

  /** Торец закрыт: вход оператора, тамбур «Севера», ворота, жалюзи радиатора ДГУ. */
  endClosed(side) {
    const { r, geo } = this;
    if (side === 'left' && (r.door === 'end' || (this.x0 > 0 && geo.type === 'north'))) return true;
    if ([r.gates, r.gates2].some(g => g && g.wall === side)) return true;
    return side === 'right' && this.floor.some(i => i.kind === 'dgu');
  }

  /** На торце вдоль торцевой стены в зоне прохода: перед шкафом проход «не менее» свободен. */
  end(side) {
    if (this.endClosed(side)) return null;
    const { w, d, W, L, x0 } = this;
    const aMin = this.lay.aisle[1];
    const left = side === 'left';
    const xa = left ? x0 : L - d;
    const zone = left ? [x0, x0 + d + aMin] : [L - d - aMin, L];
    const taken = [...this.cabs.filter(i => i.wall === side).map(i => [i.y - 100, i.y + i.ly + 100]), ...this.jY];
    const ok = y =>
      !overlaps(taken, y, y + w) &&
      !this.floor.some(i => i.x < zone[1] && i.x + i.lx > zone[0] && i.y < y + w && i.y + i.ly > y) &&
      this.free(this.box(xa, y, d, w));
    for (let y = 100; y + w <= W - 100; y += 50) {
      if (ok(y))
        return this.place({ x: xa, y, z: this.z, lx: d, ly: w, mount: 'wall', wall: side, face: left ? 2 : -2 });
    }
    return null;
  }

  place(o) {
    return LayoutItem.unit(this.e, o);
  }
}

/** Шкафы на стенах и фильтры на трубопроводе; чему места нет — своё место в ряду. */
export class LayoutWalls {
  constructor(lay) {
    this.lay = lay;
  }

  /** Трубопровод, свои места в ряду, настенные шкафы, фильтры на линии; возвращает то, чему места не нашлось. */
  attach(r, cabs, hang, geo) {
    const left = [];
    const filters = [...hang, ...r.items.filter(i => i.slot && i.kind === 'filter')];
    r.lines = LayoutPipes.lines(r, geo, Math.max(0, ...filters.map(e => Math.max(e.l, e.w))));
    for (const it of r.items.filter(i => i.slot)) this.mountSlot(it, r, geo);
    for (const e of cabs) {
      const it = new CabinetSpot(this.lay, e, r, geo).find();
      if (it) r.items.push(it);
      else left.push(e);
    }
    for (const [g, list] of this.bySegment(r, hang)) left.push(...this.hangGroup(g, list, r, geo));
    return left;
  }

  bySegment(r, hang) {
    const groups = new Map();
    for (const e of hang) {
      const g = LayoutPipes.segOf(r, e);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    return groups;
  }

  /**
   * Фильтры участка: перед осушителем — справа налево от его входа, после — слева направо; одинаковые (одна ступень) —
   * параллельно: первый на магистрали, следующие — на обводных петлях рядом. Возвращает не вставшие.
   */
  hangGroup(g, list, r, geo) {
    const back = Boolean(g) && g.s1 >= 40 && g.s1 < 50;
    const first = new Map();
    const count = new Map();
    const left = [];
    list.sort((a, b) => (back ? stageOf(b) - stageOf(a) : stageOf(a) - stageOf(b)));
    for (const e of list) count.set(stageOf(e), (count.get(stageOf(e)) || 0) + 1);
    for (const e of list) {
      const b = first.get(stageOf(e));
      const it =
        (b && this.loop(e, b, r, geo)) || this.pipeSpot(e, r, geo, { g, back, wide: !b && count.get(stageOf(e)) > 1 });
      if (!it) {
        left.push(e);
        continue;
      }
      r.items.push(it);
      if (!b) first.set(stageOf(e), { it, n: 0 });
    }
    return left;
  }

  /** Фильтр параллельно фильтру b.it — на своей обводной петле рядом (над или под магистралью); места нет — null. */
  loop(e, b, r, geo) {
    const [, W, H] = geo.int;
    const f = b.it;
    const ln = (r.lines || [])[f.on];
    if (!ln || ln.loop) return null;
    const d = f.lx;
    const span = { xa: f.x - 100, xb: f.x + d + 100 };
    const s = b.n + 1;
    const dy = s * (d + 100);
    const dz = s * (e.h - Math.max(60, e.h * 0.12) + 90);
    for (const [y, z] of [
      [ln.y - dy, ln.z],
      [ln.y + dy, ln.z],
      [ln.y, ln.z + dz],
      [ln.y, ln.z - dz],
    ]) {
      if (y < 40 || y > W - 40 || z > H - 120) continue;
      const it = LayoutItem.unit(e, {
        x: f.x,
        y: Math.round(Math.max(20, Math.min(W - d - 20, y - d / 2))),
        z: Math.round(z + Math.max(60, e.h * 0.12) - e.h),
        mount: 'pipe',
        lx: d,
        ly: d,
        line: ln.medium,
        on: -1,
      });
      if (it.z < 150 || it.z + e.h > H - 50 || this.loopBlocked(it, f, r, { ...span, y, z, ln })) continue;
      r.lines.push(this.loopLine({ ...span, y, z, ln }, [f.pos, e.pos]));
      b.n = s;
      return it;
    }
    return null;
  }

  /** Фильтр на петле или перемычки к магистрали задевают оборудование. */
  loopBlocked(it, f, r, { xa, xb, y, z, ln }) {
    const stub = {
      x: xa - 30,
      y: Math.min(y, ln.y) - 30,
      z: Math.min(z, ln.z) - 30,
      lx: xb - xa + 60,
      ly: Math.abs(y - ln.y) + 60,
      h: Math.abs(z - ln.z) + 60,
    };
    return r.items.some(i => LayoutItem.hit(it, i, 0) || (i !== f && i.mount !== 'pipe' && LayoutItem.hit(stub, i, 0)));
  }

  /** Обводная петля: линия вдоль фильтра и две перемычки к магистрали по краям. */
  loopLine({ xa, xb, y, z, ln }, par) {
    return {
      x0: xa,
      x1: xb,
      y: Math.round(y),
      z: Math.round(z),
      label: '',
      medium: ln.medium,
      branches: [xa, xb].map(x => ({ x, y0: Math.round(y), y1: ln.y, z1: ln.z, tee: true })),
      gaps: [],
      par,
      loop: true,
    };
  }

  /** Своё место в ряду: шкаф — на стене за местом, фильтр — на трубе над местом (не вышло — на полу). */
  mountSlot(it, r, geo) {
    const [, W, H] = geo.int;
    if (it.kind === 'cabinet') {
      const cab = StationMatrix.cab();
      it.z = Math.max(cab.low, Math.min(cab.top, H - 150) - it.h);
      it.mount = 'wall';
      Object.assign(it, it.row === 1 ? { y: 0, wall: 'front' } : { y: W - it.ly, wall: 'back' });
      return;
    }
    const g = LayoutPipes.segOf(r, it);
    const ln = g && g.line;
    if (!ln || !hangs(ln, it.h, H)) {
      Object.assign(it, { mount: 'floor', z: 0 });
      return;
    }
    const was = { x: it.x, y: it.y, z: it.z };
    it.mount = 'pipe';
    LayoutPipes.hangOn(it, ln, W);
    this.shift(it, r, ln, W);
    if (r.items.some(i => i !== it && i.mount === 'pipe' && LayoutItem.hit(it, i, 0))) {
      Object.assign(it, was, { mount: 'floor', z: 0 });
      return;
    }
    ln.x0 = Math.min(ln.x0, Math.round(it.x + it.lx / 2));
    ln.x1 = Math.max(ln.x1, Math.round(it.x + it.lx / 2));
  }

  /** Фильтр заходит в соседнее оборудование — сдвиг поперёк трубы (труба остаётся внутри его габарита). */
  shift(it, r, ln, W) {
    const floor = r.items.filter(i => i !== it && i.mount !== 'pipe' && i.mount !== 'wall');
    const clash = box => floor.some(i => LayoutItem.hit(box, i, 0));
    if (!clash(it)) return;
    const y0 = it.y;
    for (let d = 10; d <= it.ly; d += 10) {
      for (const y of [y0 + d, y0 - d]) {
        const fits = ln.y >= y + 20 && ln.y <= y + it.ly - 20 && y >= 20 && y + it.ly <= W - 20;
        if (fits && !clash({ ...it, y })) {
          it.y = y;
          return;
        }
      }
    }
  }

  /**
   * Фильтр на трубопроводе — на своём участке по ходу воздуха, по порядку ступеней; сначала — где к нему подойти из
   * прохода. wide — первый из одинаковых: по краям место под перемычки обводных петель.
   */
  pipeSpot(e, r, geo, { g, back, wide }) {
    const ln = g && g.line;
    if (!ln || !hangs(ln, e.h, geo.int[2])) return null;
    const d = Math.max(e.l, e.w);
    const ex = wide ? 100 : 0;
    const pad = StationMatrix.grp('pipe').pad + ex;
    const it = LayoutItem.unit(e, { x: 0, y: 0, z: 0, mount: 'pipe', lx: d, ly: d, on: (r.lines || []).indexOf(ln) });
    LayoutPipes.hangOn(it, ln, geo.int[1]);
    const lo = Math.ceil(Math.max(g.a + 80 + ex, (g.next ?? -Infinity) + ex, ln.x0 - d / 2) / 10) * 10;
    const hi =
      Math.floor((Math.min(g.b - 80 - ex, (g.lim ?? Infinity) - ex, ln.x1 + d / 2, geo.int[0] - 100) - d) / 10) * 10;
    const open = x =>
      r.rows !== 1 || !r.items.some(i => i.mount === 'floor' && i.x < x + d && i.x + i.lx > x && i.y < it.y);
    const free = (x, reachable) =>
      !ln.branches.some(b => b.x > x - 80 - ex && b.x < x + d + 80 + ex) &&
      !r.items.some(i => LayoutItem.hit({ x, y: it.y, z: it.z, lx: d, ly: d, h: it.h }, i, pad)) &&
      (!reachable || open(x));
    for (const reachable of [true, false]) {
      const x = this.scan(lo, hi, back, x0 => free(x0, reachable));
      if (x == null) continue;
      it.x = x;
      if (back) g.lim = x - pad;
      else g.next = x + d + pad;
      return it;
    }
    return null;
  }

  /** Перебор x с шагом 20 мм: back — справа налево. */
  scan(lo, hi, back, ok) {
    if (back) {
      for (let x = hi; x >= lo; x -= 20) if (ok(x)) return x;
      return null;
    }
    for (let x = lo; x <= hi; x += 20) if (ok(x)) return x;
    return null;
  }
}
