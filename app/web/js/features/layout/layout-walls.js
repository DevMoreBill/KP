import { LayoutItem } from './layout-item.js';
import { LayoutPipes } from './layout-pipes.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/** Настенный шкаф: место на стене прохода, на торцах, на задней стене (без продольного прохода). */
class CabinetSpot {
  constructor(lay, unit, res, geo) {
    [this.Li, this.Wi, this.Hi] = geo.int;
    Object.assign(this, { lay, unit, res, geo, x0: geo.x0 || 0, width: unit.l, depth: unit.w });
    const cab = StationMatrix.cab();
    this.z = Math.max(cab.low, Math.min(cab.top, this.Hi - 150) - unit.h);
    this.floor = res.items.filter(i => i.mount !== 'wall' && i.mount !== 'pipe');
    this.cabs = res.items.filter(i => i.mount === 'wall');
    const joints = StationMods.lines(geo);
    const half = StationMods.RULES.post / 2;
    this.jointsX = joints.x.map(v => [v - half, v + half]);
    this.jointsY = joints.y.map(v => [v - half, v + half]);
    this.gate = res.gates && res.gates.pos.length ? res.gates : null;
    this.out = this.gate ? lay.gates.bulky(res, geo).filter(big => this.gate.pos.includes(big.it.pos)) : [];
  }

  /** Места по порядку: у ДГУ торец у входа — под приток воздуха. */
  find() {
    if (this.res.rows !== 1 || this.z + this.unit.h > this.Hi - 50) return null;
    const [rec, min] = this.lay.aisle;
    if (this.floor.some(i => i.kind === 'dgu')) return this.front(rec) || this.front(min) || this.end('left');
    return (
      this.front(rec) || this.back(rec) || this.end('left') || this.end('right') || this.front(min) || this.back(min)
    );
  }

  /** То, что выносят через ворота в торце, проходит мимо шкафа. */
  clear(x) {
    if (!this.out.length) return true;
    const { width: width, depth: depth, Wi: Wi } = this;
    const under = this.floor.filter(i => i.x < x + width && i.x + i.lx > x);
    const room = (under.length ? Math.min(...under.map(i => i.y)) : Wi) - depth;
    const pass = StationMatrix.move().pass;
    const beyond = one => (this.gate.wall === 'right' ? one.it.x >= x + width : one.it.x + one.it.lx <= x);
    return this.out.every(one => beyond(one) || one.narrow + 2 * pass <= room);
  }

  /** Габарит шкафа в точке на стене. */
  box(x, y, lenX, lenY) {
    return { x, y, z: this.z, lx: lenX, ly: lenY, h: this.unit.h };
  }

  /** Свободно ли место под шкаф. */
  free(box) {
    return !this.res.items.some(i => LayoutItem.hit(box, i, 0));
  }

  /** На стене прохода: перед шкафом проход не уже need; не на двери оператора и сервисных воротах. */
  front(need) {
    const { res: res, width: width, depth: depth } = this;
    const busy = [
      ...this.cabs.filter(i => i.wall === 'front').map(i => [i.x - 100, i.x + i.lx + 100]),
      ...this.jointsX,
    ];
    if (res.door === 'side') {
      const entry = this.lay.exits.entrySpan(res, this.geo);
      busy.push([entry[0] - 150, entry[1] + 150]);
    }
    for (const door2 of (res.doors || []).filter(door => door.wall === 'front'))
      busy.push([door2.x0 - 150, door2.x1 + 150]);
    const ok = x =>
      !LayoutWalls._overlaps(busy, x, x + width) &&
      this.floor.every(i => i.x >= x + width || i.x + i.lx <= x || i.y - depth >= need) &&
      this.clear(x) &&
      this.free(this.box(x, 0, width, depth));
    const x = this.scan(ok);
    return x == null ? null : this.place({ x, y: 0, z: this.z, mount: 'wall', wall: 'front', face: 1 });
  }

  /** Без продольного прохода: на задней стене напротив двери оператора. */
  back(need) {
    const { res: res, width: width, depth: depth, Wi: Wi } = this;
    if (!res.ends) return null;
    const busy = [
      ...this.cabs.filter(i => i.wall === 'back').map(i => [i.x - 100, i.x + i.lx + 100]),
      ...this.jointsX,
      ...(res.doors || []).filter(door => door.wall === 'back').map(door => [door.x0 - 150, door.x1 + 150]),
    ];
    const ok = x =>
      !LayoutWalls._overlaps(busy, x, x + width) &&
      this.floor.every(i => i.x >= x + width || i.x + i.lx <= x || Wi - depth - (i.y + i.ly) >= need) &&
      this.free(this.box(x, Wi - depth, width, depth));
    const x = this.scan(ok);
    return x == null ? null : this.place({ x, y: Wi - depth, z: this.z, mount: 'wall', wall: 'back', face: -1 });
  }

  /** Первое подходящее место вдоль стены. */
  scan(ok) {
    for (let x = this.x0 + 150; x + this.width <= this.Li - 150; x += 50) if (ok(x)) return x;
    return null;
  }

  /** Торец закрыт: вход оператора, тамбур «Севера», ворота, жалюзи радиатора ДГУ. */
  endClosed(side) {
    const { res: res, geo } = this;
    if (side === 'left' && (res.door === 'end' || (this.x0 > 0 && geo.type === 'north'))) return true;
    if ([res.gates, res.gates2].some(gate => gate && gate.wall === side)) return true;
    return side === 'right' && this.floor.some(i => i.kind === 'dgu');
  }

  /** На торце вдоль торцевой стены в зоне прохода: перед шкафом проход «не менее» свободен. */
  end(side) {
    if (this.endClosed(side)) return null;
    const { width: width, depth: depth, Wi: Wi, Li: Li, x0 } = this;
    const aMin = this.lay.aisle[1];
    const left = side === 'left';
    const atX = left ? x0 : Li - depth;
    const zone = left ? [x0, x0 + depth + aMin] : [Li - depth - aMin, Li];
    const taken = [...this.cabs.filter(i => i.wall === side).map(i => [i.y - 100, i.y + i.ly + 100]), ...this.jointsY];
    const ok = y =>
      !LayoutWalls._overlaps(taken, y, y + width) &&
      !this.floor.some(i => i.x < zone[1] && i.x + i.lx > zone[0] && i.y < y + width && i.y + i.ly > y) &&
      this.free(this.box(atX, y, depth, width));
    for (let y = 100; y + width <= Wi - 100; y += 50) {
      if (ok(y))
        return this.place({
          x: atX,
          y,
          z: this.z,
          lx: depth,
          ly: width,
          mount: 'wall',
          wall: side,
          face: left ? 2 : -2,
        });
    }
    return null;
  }

  /** Шкаф как элемент компоновки. */
  place(opts) {
    return LayoutItem.unit(this.unit, opts);
  }
}

/** Шкафы на стенах и фильтры на трубопроводе; чему места нет — своё место в ряду. */
export class LayoutWalls {
  static _stageOf = unit => (unit.air && unit.air.stage != null ? unit.air.stage : 50);

  static _overlaps = (list, from, till) => list.some(([spanFrom, spanTill]) => from < spanTill && till > spanFrom);

  /** Голова фильтра на линии ln: корпус ниже оси, не ниже 150 мм от пола и не под потолком. */
  static _hangs = (line, height, Hi) =>
    line.z + Math.max(60, height * 0.12) - height >= 150 && line.z + Math.max(60, height * 0.12) <= Hi - 50;

  constructor(lay) {
    this.lay = lay;
  }

  /** Трубопровод, свои места в ряду, настенные шкафы, фильтры на линии; возвращает то, чему места не нашлось. */
  attach(res, cabs, hang, geo) {
    const left = [];
    const filters = [...hang, ...res.items.filter(i => i.slot && i.kind === 'filter')];
    res.lines = LayoutPipes.lines(res, geo, Math.max(0, ...filters.map(unit => Math.max(unit.l, unit.w))));
    for (const item of res.items.filter(i => i.slot)) this.mountSlot(item, res, geo);
    for (const unit of cabs) {
      const item = new CabinetSpot(this.lay, unit, res, geo).find();
      if (item) res.items.push(item);
      else left.push(unit);
    }
    for (const [group, list] of this._bySegment(res, hang)) left.push(...this.hangGroup(group, list, res, geo));
    return left;
  }

  _bySegment(res, hang) {
    const groups = new Map();
    for (const unit of hang) {
      const group = LayoutPipes.segOf(res, unit);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(unit);
    }
    return groups;
  }

  /**
   * Фильтры участка: перед осушителем — справа налево от его входа, после — слева направо; одинаковые (одна ступень) —
   * параллельно: первый на магистрали, следующие — на обводных петлях рядом. Возвращает не вставшие.
   */
  hangGroup(group, list, res, geo) {
    const back = Boolean(group) && group.s1 >= 40 && group.s1 < 50;
    const first = new Map();
    const count = new Map();
    const left = [];
    list.sort((one, two) =>
      back
        ? LayoutWalls._stageOf(two) - LayoutWalls._stageOf(one)
        : LayoutWalls._stageOf(one) - LayoutWalls._stageOf(two),
    );
    for (const unit of list) count.set(LayoutWalls._stageOf(unit), (count.get(LayoutWalls._stageOf(unit)) || 0) + 1);
    for (const unit of list) {
      const anchor = first.get(LayoutWalls._stageOf(unit));
      const item =
        (anchor && this.loop(unit, anchor, res, geo)) ||
        this.pipeSpot(unit, res, geo, { g: group, back, wide: !anchor && count.get(LayoutWalls._stageOf(unit)) > 1 });
      if (!item) {
        left.push(unit);
        continue;
      }
      res.items.push(item);
      if (!anchor) first.set(LayoutWalls._stageOf(unit), { it: item, n: 0 });
    }
    return left;
  }

  /** Фильтр параллельно фильтру b.it — на своей обводной петле рядом (над или под магистралью); места нет — null. */
  loop(unit, anchor, res, geo) {
    const [, Wi, Hi] = geo.int;
    const first = anchor.it;
    const line = (res.lines || [])[first.on];
    if (!line || line.loop) return null;
    const depth = first.lx;
    const span = { xa: first.x - 100, xb: first.x + depth + 100 };
    const sign = anchor.n + 1;
    const dy = sign * (depth + 100);
    const dz = sign * (unit.h - Math.max(60, unit.h * 0.12) + 90);
    for (const [y, z] of [
      [line.y - dy, line.z],
      [line.y + dy, line.z],
      [line.y, line.z + dz],
      [line.y, line.z - dz],
    ]) {
      if (y < 40 || y > Wi - 40 || z > Hi - 120) continue;
      const item = LayoutItem.unit(unit, {
        x: first.x,
        y: Math.round(Math.max(20, Math.min(Wi - depth - 20, y - depth / 2))),
        z: Math.round(z + Math.max(60, unit.h * 0.12) - unit.h),
        mount: 'pipe',
        lx: depth,
        ly: depth,
        line: line.medium,
        on: -1,
      });
      if (item.z < 150 || item.z + unit.h > Hi - 50 || this.loopBlocked(item, first, res, { ...span, y, z, ln: line }))
        continue;
      res.lines.push(this.loopLine({ ...span, y, z, ln: line }, [first.pos, unit.pos]));
      anchor.n = sign;
      return item;
    }
    return null;
  }

  /** Фильтр на петле или перемычки к магистрали задевают оборудование. */
  loopBlocked(item, first, res, { xa: fromX, xb: tillX, y, z, ln: line }) {
    const stub = {
      x: fromX - 30,
      y: Math.min(y, line.y) - 30,
      z: Math.min(z, line.z) - 30,
      lx: tillX - fromX + 60,
      ly: Math.abs(y - line.y) + 60,
      h: Math.abs(z - line.z) + 60,
    };
    return res.items.some(
      i => LayoutItem.hit(item, i, 0) || (i !== first && i.mount !== 'pipe' && LayoutItem.hit(stub, i, 0)),
    );
  }

  /** Обводная петля: линия вдоль фильтра и две перемычки к магистрали по краям. */
  loopLine({ xa: fromX, xb: tillX, y, z, ln: line }, par) {
    return {
      x0: fromX,
      x1: tillX,
      y: Math.round(y),
      z: Math.round(z),
      label: '',
      medium: line.medium,
      branches: [fromX, tillX].map(x => ({ x, y0: Math.round(y), y1: line.y, z1: line.z, tee: true })),
      gaps: [],
      par,
      loop: true,
    };
  }

  /** Своё место в ряду: шкаф — на стене за местом, фильтр — на трубе над местом (не вышло — на полу). */
  mountSlot(item, res, geo) {
    const [, Wi, Hi] = geo.int;
    if (item.kind === 'cabinet') {
      const cab = StationMatrix.cab();
      item.z = Math.max(cab.low, Math.min(cab.top, Hi - 150) - item.h);
      item.mount = 'wall';
      Object.assign(item, item.row === 1 ? { y: 0, wall: 'front' } : { y: Wi - item.ly, wall: 'back' });
      return;
    }
    const group = LayoutPipes.segOf(res, item);
    const line = group && group.line;
    if (!line || !LayoutWalls._hangs(line, item.h, Hi)) {
      Object.assign(item, { mount: 'floor', z: 0 });
      return;
    }
    const was = { x: item.x, y: item.y, z: item.z };
    item.mount = 'pipe';
    LayoutPipes.hangOn(item, line, Wi);
    this.shift(item, res, line, Wi);
    if (res.items.some(i => i !== item && i.mount === 'pipe' && LayoutItem.hit(item, i, 0))) {
      Object.assign(item, was, { mount: 'floor', z: 0 });
      return;
    }
    line.x0 = Math.min(line.x0, Math.round(item.x + item.lx / 2));
    line.x1 = Math.max(line.x1, Math.round(item.x + item.lx / 2));
  }

  /** Фильтр заходит в соседнее оборудование — сдвиг поперёк трубы (труба остаётся внутри его габарита). */
  shift(item, res, line, Wi) {
    const floor = res.items.filter(i => i !== item && i.mount !== 'pipe' && i.mount !== 'wall');
    const clash = box => floor.some(i => LayoutItem.hit(box, i, 0));
    if (!clash(item)) return;
    const y0 = item.y;
    for (let step = 10; step <= item.ly; step += 10) {
      for (const y of [y0 + step, y0 - step]) {
        const fits = line.y >= y + 20 && line.y <= y + item.ly - 20 && y >= 20 && y + item.ly <= Wi - 20;
        if (fits && !clash({ ...item, y })) {
          item.y = y;
          return;
        }
      }
    }
  }

  /**
   * Фильтр на трубопроводе — на своём участке по ходу воздуха, по порядку ступеней; сначала — где к нему подойти из
   * прохода. wide — первый из одинаковых: по краям место под перемычки обводных петель.
   */
  pipeSpot(unit, res, geo, { g: group, back, wide }) {
    const line = group && group.line;
    if (!line || !LayoutWalls._hangs(line, unit.h, geo.int[2])) return null;
    const size = Math.max(unit.l, unit.w);
    const extra = wide ? 100 : 0;
    const pad = StationMatrix.grp('pipe').pad + extra;
    const item = LayoutItem.unit(unit, {
      x: 0,
      y: 0,
      z: 0,
      mount: 'pipe',
      lx: size,
      ly: size,
      on: (res.lines || []).indexOf(line),
    });
    LayoutPipes.hangOn(item, line, geo.int[1]);
    const low =
      Math.ceil(Math.max(group.a + 80 + extra, (group.next ?? -Infinity) + extra, line.x0 - size / 2) / 10) * 10;
    const high =
      Math.floor(
        (Math.min(group.b - 80 - extra, (group.lim ?? Infinity) - extra, line.x1 + size / 2, geo.int[0] - 100) - size) /
          10,
      ) * 10;
    const open = x =>
      res.rows !== 1 || !res.items.some(i => i.mount === 'floor' && i.x < x + size && i.x + i.lx > x && i.y < item.y);
    const free = (x, reachable) =>
      !line.branches.some(branch => branch.x > x - 80 - extra && branch.x < x + size + 80 + extra) &&
      !res.items.some(i => LayoutItem.hit({ x, y: item.y, z: item.z, lx: size, ly: size, h: item.h }, i, pad)) &&
      (!reachable || open(x));
    for (const reachable of [true, false]) {
      const x = this.scan(low, high, back, x0 => free(x0, reachable));
      if (x == null) continue;
      item.x = x;
      if (back) group.lim = x - pad;
      else group.next = x + size + pad;
      return item;
    }
    return null;
  }

  /** Перебор x с шагом 20 мм: back — справа налево. */
  scan(low, high, back, ok) {
    if (back) {
      for (let x = high; x >= low; x -= 20) if (ok(x)) return x;
      return null;
    }
    for (let x = low; x <= high; x += 20) if (ok(x)) return x;
    return null;
  }
}
