import { Num } from './num.js';
import { LayoutOpening } from './layout-opening.js';
import { LayoutPipes } from './layout-pipes.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationTidy } from './station-tidy.js';

/**
 * Ряды оборудования на полу лицом к проходу: один ряд у задней стены, два ряда у длинных стен с проходом посередине,
 * агрегат поперёк (без сквозного прохода), компрессоры у торца (без продольного прохода). Промежутки — от «не менее»
 * к рекомендуемым; ресиверы — парами, «вплотную» — последним приёмом.
 */
export class LayoutRows {
  static _depthOf = slot => (slot.rot || slot.e.cross ? slot.e.l : slot.e.w);

  static _lenOf = slot => (slot.rot || slot.e.cross ? slot.e.w : slot.e.l);

  constructor(lay) {
    this.lay = lay;
  }

  /** Задний отступ: рекомендуемый, если проход перед агрегатом остаётся не уже f; иначе сколько можно, не меньше «не менее». */
  static backFor(back, budget, need) {
    if (budget - back[0] >= need) return back[0];
    return budget - need >= back[1] ? budget - need : back[1];
  }

  /** Пара ресиверов один за другим (передний a, задний b, промежуток gap): глубина — оба и промежуток. */
  static pairUnit(first, second, gap) {
    return {
      ...first,
      l: Math.max(first.l, second.l),
      w: first.w + gap + second.w,
      h: Math.max(first.h, second.h),
      pairD: Math.max(first.w, second.w),
    };
  }

  /** Можно повернуть боком: разрешено матрицей, короб и заметно длиннее, чем глубже. */
  static turnable(unit) {
    return StationMatrix.rot(unit.kind) && unit.shape === 'box' && unit.l > unit.w + 50;
  }

  /** Поворачивать боком (сначала дающее больше длины), пока ok(o) после поворота и ряд не уложится (fits). */
  static turn(list, ok, fits) {
    for (const slot of list.sort((first, second) => second.e.l - second.e.w - (first.e.l - first.e.w))) {
      slot.rot = true;
      if (!ok(slot)) {
        slot.rot = false;
        continue;
      }
      if (fits()) break;
    }
  }

  /** В два ряда — в задний ряд: ДГУ; аппараты цепочки воздуха (при компрессорах) — подряд по ходу воздуха. */
  static backRow(unit, units) {
    if (unit.kind === 'dgu') return true;
    const chain = (LayoutPipes.series(unit) && unit.kind !== 'receiver') || (unit.slot && unit.kind === 'filter');
    return units.some(u => u.kind === 'compressor') && chain;
  }

  /** Повернуть то, что не проходит по ширине, если после поворота проходит. */
  widen(slots, wide, canRot) {
    for (const slot of slots.filter(x => !wide(x) && canRot(x))) {
      slot.rot = true;
      if (!wide(slot)) slot.rot = false;
    }
  }

  length(slots, lvl) {
    return (
      this.chain(
        slots.map(slot => slot.e),
        lvl,
      ).sum + Num.sum(slots.map(LayoutRows._lenOf))
    );
  }

  /** Один ряд у задней стены лицом к проходу. */
  one(units, lenMax, wid, noRotate) {
    const lay = this.lay;
    const slots = units.map(unit => ({ e: unit, rot: false }));
    const canRot = slot => !noRotate && LayoutRows.turnable(slot.e);
    const pairWall = slot => Math.min(slot.e.c.back[1], StationMatrix.recv().pairWall);
    const need = slot =>
      LayoutRows._depthOf(slot) + (slot.end ? 2 * pairWall(slot) : slot.e.c.back[1] + lay.front(slot.e)[1]);
    const wide = slot => need(slot) <= wid;
    this.widen(slots, wide, canRot);
    const narrow = slots.filter(slot => !wide(slot));
    if (narrow.length)
      return { ok: false, why: 'width', bad: narrow.map(slot => slot.e), needW: Math.max(...narrow.map(need)) };
    const len = lvl => this.length(slots, lvl);
    if (lay.recv2) this.endPairs(slots, wide, () => false);
    if (len(1) > lenMax) {
      const roomy = slot => LayoutRows._depthOf(slot) + slot.e.c.back[0] + lay.front(slot.e)[1] <= wid;
      for (const ok of [roomy, wide]) {
        if (len(1) <= lenMax) break;
        LayoutRows.turn(
          slots.filter(slot => canRot(slot) && !slot.rot),
          ok,
          () => len(1) <= lenMax,
        );
      }
    }
    const level = this.squeeze(slots, len, lenMax, wide, noRotate);
    if (len(level) > lenMax) return { ok: false, why: 'length', needL: len(1), needL0: len(0), needLc: len(2) };
    return this.place([slots], { Lu: lenMax, W: wid, lv: level });
  }

  /** Не хватает длины: ресиверы парой, затем парами поперёк у торца, затем вплотную, затем без прохода у торца. */
  squeeze(slots, len, lenMax, wide, noRotate) {
    const done = () => len(1) <= lenMax;
    if (done()) return 1;
    if (!noRotate) this.pairs(slots, wide, done);
    if (!noRotate && !done()) this.endPairs(slots, wide, done);
    if (done()) return 1;
    if (!this.lay.closeOk) return 1;
    return len(2) <= lenMax ? 2 : 3;
  }

  /** Соседние ресиверы — парой один за другим (задний — ближе к стене), осмотр заднего — сбоку. */
  pairs(slots, wide, done) {
    const solo = slot => !slot.pair && !slot.rot && slot.e.kind === 'receiver' && !slot.e.slot;
    for (let k = 0; k < slots.length - 1 && !done(); k++) {
      const [first, second] = [slots[k], slots[k + 1]];
      if (!solo(first) || !solo(second)) continue;
      const gap = Math.max(first.e.c.side[1], second.e.c.side[1]);
      const slot = { e: LayoutRows.pairUnit(first.e, second.e, gap), rot: false, pair: [first.e, second.e], gap };
      if (wide(slot)) slots.splice(k, 2, slot);
    }
  }

  /** Ресиверы в конце ряда — парами поперёк во всю ширину; вплотную в паре — только где допускается. */
  endPairs(slots, wide, done) {
    const solo = slot => !slot.pair && !slot.rot && slot.e.kind === 'receiver' && !slot.e.slot && !slot.e.cross;
    let k = slots.length;
    while (k > 0 && solo(slots[k - 1])) k--;
    for (let j = slots.length - 2; j >= k && !done(); j -= 2) {
      const slot = this.endPair(slots[j].e, slots[j + 1].e, wide);
      if (!slot) break;
      slots.splice(j, 2, slot);
    }
  }

  endPair(first, second, wide) {
    const side = Math.max(first.c.side[1], second.c.side[1]);
    const gaps = this.lay.closeOk ? [side, 0] : [side];
    return (
      gaps
        .map(gap => ({ e: LayoutRows.pairUnit(first, second, gap), rot: false, pair: [first, second], gap, end: true }))
        .find(wide) || null
    );
  }

  /** Пара ресиверов → два места: передний — у прохода, задний — за ним. */
  unpair(item, geo) {
    const [front, rear] = item.o.pair;
    const gap = item.o.gap;
    const mark = item.o.end ? { pairEnd: true } : {};
    const make = (unit, y, depth, back, aisle) => ({
      ...this.lay.item(
        {
          o: { e: unit, rot: false },
          ri: item.ri,
          x: item.x + Math.round((item.lx - unit.l) / 2),
          lx: unit.l,
          d: depth,
          y,
          face: item.face,
          back,
          aisle,
        },
        geo,
      ),
      pair: true,
      ...mark,
    });
    return [
      make(front, item.y, front.w, item.back + gap + rear.w, item.aisle),
      make(rear, item.y + front.w + gap, rear.w, item.back, item.aisle + front.w + gap),
    ];
  }

  /** Распределение по двум рядам: задний — ДГУ и цепочка воздуха, ресиверы — подряд в одном ряду, прочее — в короткий. */
  split(units) {
    const rowA = [];
    const rowB = [];
    let recv = null;
    for (const unit of units) {
      const slot = { e: unit, rot: false };
      if (LayoutRows.backRow(unit, units)) rowB.push(slot);
      else if (unit.kind === 'receiver' && recv) recv.push(slot);
      else {
        const row = this.length(rowA, 1) <= this.length(rowB, 1) ? rowA : rowB;
        row.push(slot);
        if (unit.kind === 'receiver') recv = row;
      }
    }
    return [rowA, rowB];
  }

  /** Два ряда у длинных стен, проход посередине. */
  two(units, lenMax, wid, noRotate) {
    const lay = this.lay;
    const [rowA, rowB] = this.split(units);
    if (!rowA.length || !rowB.length) return { ok: false, why: 'rows' };
    const deep = row => Math.max(...row.map(slot => LayoutRows._depthOf(slot) + slot.e.c.back[1]));
    const aMin = Math.max(...[...rowA, ...rowB].map(slot => lay.front(slot.e)[1]));
    const fits = () => wid - deep(rowA) - deep(rowB) >= aMin;
    if (!fits()) return { ok: false, why: 'width2' };
    let level = 1;
    const lenFn = () => Math.max(this.length(rowA, level), this.length(rowB, level));
    const len0 = Math.max(this.length(rowA, 0), this.length(rowB, 0));
    if (lenFn() > lenMax && !noRotate)
      LayoutRows.turn(
        [...rowA, ...rowB].filter(slot => LayoutRows.turnable(slot.e)),
        fits,
        () => lenFn() <= lenMax,
      );
    const fitsAt = v => Math.max(this.length(rowA, v), this.length(rowB, v)) <= lenMax;
    if (lenFn() > lenMax && lay.closeOk) level = [2, 3].find(fitsAt) || 1;
    if (lenFn() > lenMax)
      return {
        ok: false,
        why: 'length2',
        needL: lenFn(),
        needL0: len0,
        needLc: Math.max(this.length(rowA, 2), this.length(rowB, 2)),
      };
    return this.place([rowB, rowA], { Lu: lenMax, W: wid, lv: level });
  }

  /**
   * Без сквозного прохода (исключение): один ряд, а агрегат, который с проходом не встаёт по ширине, — поперёк лицом к
   * входу; за ним — вторая часть станции со своей дверью оператора.
   */
  cross(units, lenMax, wid, noRotate) {
    const lay = this.lay;
    const slots = units.map(unit => ({ e: unit, rot: false }));
    const canRot = slot => !noRotate && LayoutRows.turnable(slot.e);
    const need = slot => LayoutRows._depthOf(slot) + slot.e.c.back[1] + lay.front(slot.e)[1];
    const wide = slot => slot.e.cross || need(slot) <= wid;
    this.widen(slots, wide, canRot);
    const narrow = slots.filter(slot => !wide(slot));
    if (narrow.length !== 1) {
      return {
        ok: false,
        why: 'width',
        bad: narrow.map(slot => slot.e),
        needW: narrow.length ? Math.max(...narrow.map(need)) : wid + 1,
      };
    }
    const widest = narrow[0];
    if (/^(dgu|cabinet|pump)$/.test(widest.e.kind) || widest.e.slot || widest.e.l > wid)
      return { ok: false, why: 'width', bad: [widest.e], needW: need(widest) };
    widest.rot = false;
    widest.e = { ...widest.e, cross: true };
    const len = lvl => this.length(slots, lvl);
    if (len(1) > lenMax)
      LayoutRows.turn(
        slots.filter(slot => !slot.e.cross && canRot(slot)),
        wide,
        () => len(1) <= lenMax,
      );
    const level = this.squeeze(slots, len, lenMax, wide, noRotate);
    if (len(level) > lenMax) return { ok: false, why: 'length', needL: len(1), needL0: len(0), needLc: len(2) };
    return this.place([slots], { Lu: lenMax, W: wid, lv: level });
  }

  /** Промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее). */
  chain(units, lvl) {
    if (!units.length) return { gaps: [], sum: 0 };
    const lay = this.lay;
    const level1 = Math.min(1, lvl);
    const front = unit => lay.front(unit)[level1];
    const behind = unit => Math.max(unit.c.back[level1], lay.aisle[1]);
    const neighbours = (prev, next) => {
      const pair = StationMatrix.pair(prev, next);
      if (!pair) return Math.max(prev.c.side[level1], next.c.side[level1]);
      if (lvl >= 2 && (prev.pairD || next.pairD))
        return Math.max(pair[2], Math.min(pair[1], StationMatrix.recv().pairSide));
      return pair[Math.min(lvl, 2)];
    };
    const end = unit => {
      const sides = StationMatrix.sides(unit.kind);
      return Math.max(unit.c.side[level1], lvl < 3 && (sides.L || sides.R) ? StationMatrix.access().side : 0);
    };
    const between = (prev, next) => {
      if (next.cross) return Math.max(prev.c.side[level1], front(next));
      if (prev.cross) return Math.max(behind(prev), next.c.side[level1]);
      return neighbours(prev, next);
    };
    const last = units[units.length - 1];
    const tail = () => {
      if (last.cross) return behind(last);
      return last.c.far ? last.c.far[level1] : end(last);
    };
    const gaps = [
      units[0].cross ? front(units[0]) : end(units[0]),
      ...units.slice(1).map((unit, i) => between(units[i], unit)),
      tail(),
    ];
    return { gaps, sum: Num.sum(gaps) };
  }

  /**
   * Без продольного прохода (исключение, компрессорная): компрессоры у торца по середине ширины, рядом в ряд, с
   * сервисными воротами с обеих сторон; дверь оператора — за последним; ресиверы — парами поперёк у дальнего торца.
   */
  ends(units, lenMax, wid, wallT = 0, edge = StationMatrix.door().edge) {
    const comps = units.filter(unit => unit.kind === 'compressor' && !unit.slot);
    if (!comps.length || units.some(unit => /^(dgu|pump|tank)$/.test(unit.kind))) return { ok: false, why: 'mode' };
    const tightOf = unit => {
      const wallT2 = StationMatrix.wall(unit);
      return wallT2 ? wallT2[1] : unit.c.back[1];
    };
    const wide = comps.filter(unit => unit.w + 2 * tightOf(unit) > wid);
    if (wide.length)
      return { ok: false, why: 'width', bad: wide, needW: Math.max(...wide.map(unit => unit.w + 2 * tightOf(unit))) };
    const slots = this.endsOrder(comps, units);
    this.endsPairs(slots, wid, tightOf(comps[0]));
    const need = slot => slot.e.w + slot.e.c.back[1] + this.lay.front(slot.e)[1];
    const bad = slots.filter(slot => !slot.ends && !slot.end && need(slot) > wid);
    if (bad.length) return { ok: false, why: 'width', bad: bad.map(slot => slot.e), needW: Math.max(...bad.map(need)) };
    return new EndsRow(this, { comps, slots, wid, lenMax, wallT, edge, tightW: tightOf(comps[0]) }).build();
  }

  /** Компрессоры — первыми; шкафы и фильтры без места на стене и трубе — перед ресиверами (ресиверы — у дальнего торца). */
  endsOrder(comps, units) {
    const isR = unit => unit.kind === 'receiver' && !unit.slot;
    const rest = units.filter(unit => !comps.includes(unit));
    let count = rest.length;
    while (count > 0 && (isR(rest[count - 1]) || rest[count - 1].slot)) count--;
    const tail = rest.slice(count);
    const order = [...rest.slice(0, count), ...tail.filter(unit => !isR(unit)), ...tail.filter(isR)];
    return [
      ...comps.map(unit => ({ e: unit, rot: false, ends: true })),
      ...order.map(unit => ({ e: unit, rot: false })),
    ];
  }

  /** Ресиверы в конце — парами поперёк: от стен до «плотно» компрессора, промежуток в паре — по правилу, при нехватке — меньше. */
  endsPairs(slots, wid, tightW) {
    let k = slots.length;
    while (k > 1 && slots[k - 1].e.kind === 'receiver' && !slots[k - 1].e.slot) k--;
    const compWall = (StationMatrix.wall({ kind: 'compressor', w: 0 }) || [0, 100])[1];
    for (let j = slots.length - 2; j >= k; j -= 2) {
      const [first, second] = [slots[j].e, slots[j + 1].e];
      const pair = StationMatrix.pair(first, second);
      const recWall = Math.min(Math.max(first.c.back[1], second.c.back[1]), compWall);
      const low = this.pairLow(pair);
      const gap = Math.min(pair ? pair[0] : 300, wid - first.w - second.w - 2 * recWall);
      if (gap < low || wid - first.w - second.w - gap < 2 * tightW) break;
      slots.splice(j, 2, {
        e: LayoutRows.pairUnit(first, second, gap),
        rot: false,
        pair: [first, second],
        gap,
        end: true,
      });
    }
  }

  pairLow(pair) {
    if (!pair) return 300;
    return pair[2] === 0 ? 0 : pair[1];
  }

  /** Места в рядах: R[0] — у задней стены, R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым. */
  place(rowList, { Lu: lenMax, W: wid, lv: level = 1 }) {
    const items = [];
    const span = { short: false, min: Infinity };
    rowList.forEach((row, rowNo) => {
      if (row.length) items.push(...this.alongRow(row, rowNo, lenMax, level, span));
    });
    StationTidy.even(items);
    const rows = rowList.filter(one => one.length).length;
    if (rows === 1) for (const item of items) this.acrossOne(item, wid);
    else this.acrossTwo(items, wid);
    const aRec = this.lay.aisle[0];
    StationTidy.facade(items, wid, rows, aRec);
    const equip = items.filter(i => !i.o.e.slot && !i.o.e.cross && !i.o.end);
    return {
      ok: true,
      rows,
      aisleW: equip.length ? Math.min(...equip.map(i => i.aisle)) : wid,
      items,
      iss: this.placeNotes(equip, span),
    };
  }

  /** Ряд по длине: промежутки между «не менее» и рекомендуемыми, свободная длина — у двери (после шкафов). */
  alongRow(row, rowNo, lenMax, level, span) {
    const units = row.map(slot => slot.e);
    const rec = this.chain(units, 0);
    const min = this.chain(units, level);
    const body = Num.sum(row.map(LayoutRows._lenOf));
    const k = rec.sum > min.sum ? Math.max(0, Math.min(1, (lenMax - body - min.sum) / (rec.sum - min.sum))) : 1;
    const gaps = min.gaps.map((v, i) => Math.round(v + (rec.gaps[i] - v) * k));
    for (let over = body + Num.sum(gaps) - lenMax, i = gaps.length - 1; over > 0 && i >= 0; i--) {
      const shift = Math.min(over, gaps[i]);
      gaps[i] -= shift;
      over -= shift;
    }
    const free = lenMax - body - Num.sum(gaps);
    if (k < 1) span.short = true;
    const lead = Math.max(
      0,
      units.findIndex(unit => unit.kind !== 'cabinet'),
    );
    const out = [];
    let x = gaps[0];
    row.forEach((slot, i) => {
      if (i === lead && free > 0) x += free;
      out.push({ o: slot, ri: rowNo, x, lx: LayoutRows._lenOf(slot), d: LayoutRows._depthOf(slot) });
      if (i > 0) span.min = Math.min(span.min, gaps[i]);
      x += LayoutRows._lenOf(slot) + gaps[i + 1];
    });
    return out;
  }

  /** Один ряд поперёк: сначала задний отступ до рекомендуемого (если проход не уже допустимого), затем проход. */
  acrossOne(item, wid) {
    const back = item.o.e.c.back;
    const budget = wid - item.d;
    const [front, frontMin] = this.lay.front(item.o.e);
    if (item.o.e.cross) {
      Object.assign(item, { y: Math.round(budget / 2), aisle: 0, face: -2 });
      item.back = item.y;
      return;
    }
    if (item.o.end) {
      const wall = Math.min(back[1], StationMatrix.recv().pairWall);
      item.back = Math.min(Math.max(wall, Math.round(budget / 2)), budget - wall);
    } else {
      item.back = LayoutRows.backFor(back, budget, frontMin);
      if (budget - item.back > front && item.back < back[0]) item.back = Math.min(back[0], budget - front);
    }
    item.aisle = budget - item.back;
    item.y = wid - item.back - item.d;
    item.face = -1;
  }

  /** Два ряда: сзади рекомендуемый, если проход не уже допустимого; иначе излишек прохода — поровну рядам назад. */
  acrossTwo(items, wid) {
    const lay = this.lay;
    const back = item => item.o.e.c.back;
    const rowA = items.filter(i => i.ri === 1);
    const rowB = items.filter(i => i.ri === 0);
    const deep = (list, pick) => (list.length ? Math.max(...list.map(pick)) : 0);
    const recOk = wid - deep(rowA, i => i.d + back(i)[0]) - deep(rowB, i => i.d + back(i)[0]) >= lay.aisle[1];
    for (const item of items) item.back = recOk ? back(item)[0] : back(item)[1];
    if (!recOk) {
      const per =
        Math.max(0, wid - deep(rowA, i => i.d + i.back) - deep(rowB, i => i.d + i.back) - lay.aisle[0]) /
        ((rowA.length ? 1 : 0) + (rowB.length ? 1 : 0));
      for (const item of items) item.back = Math.floor(Math.min(back(item)[0], back(item)[1] + per));
    }
    const free = wid - deep(rowA, i => i.d + i.back) - deep(rowB, i => i.d + i.back);
    for (const item of rowB) Object.assign(item, { y: wid - item.back - item.d, face: -1, aisle: free });
    for (const item of rowA) Object.assign(item, { y: item.back, face: 1, aisle: free });
  }

  /** Замечания расстановки: проход уже рекомендуемого, промежутки уменьшены, агрегат близко к стене. */
  placeNotes(equip, span) {
    const lay = this.lay;
    const aRec = lay.aisle[0];
    const iss = [];
    const dgu = equip.find(i => i.o.e.kind === 'dgu');
    const other = equip.filter(i => i.o.e.kind !== 'dgu');
    const aisleO = other.length ? Math.min(...other.map(i => i.aisle)) : Infinity;
    if (aisleO < aRec)
      iss.push({
        level: 'warn',
        text: `Проход обслуживания ${Mm.text(aisleO)} мм — меньше рекомендуемых ${Mm.text(aRec)} мм (допустимо от ${Mm.text(lay.aisle[1])} мм).`,
      });
    if (dgu && dgu.aisle < aRec) {
      iss.push({
        level: 'warn',
        text: `Проход вдоль ДГУ ${Mm.text(dgu.aisle)} мм — меньше рекомендуемых ${Mm.text(aRec)} мм (допустимо от ${Mm.text(lay.front(dgu.o.e)[1])} мм).`,
      });
    }
    if (span.short) {
      iss.push({
        level: 'warn',
        text: Number.isFinite(span.min)
          ? `Промежутки между оборудованием уменьшены до ${Mm.text(span.min)} мм — по длине не хватает места для рекомендуемых.`
          : 'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.',
      });
    }
    for (const item of equip) {
      const rec = item.o.e.c.back[0];
      if (item.back < rec && rec > 150 && !item.o.e.unit) {
        iss.push({
          level: 'warn',
          tight: item.o.e.pos,
          text: `Поз. ${item.o.e.pos} «${item.o.e.short}» стоит в ${Mm.text(item.back + lay.gap)} мм от стены — рекомендуется ${Mm.text(rec + lay.gap)} мм.`,
        });
      }
    }
    return iss;
  }
}

/** Ряд без продольного прохода: промежутки у торца и между компрессорами (их сервисные ворота и двери оператора). */
class EndsRow {
  constructor(rows, { comps, slots, wid, lenMax, wallT, edge, tightW }) {
    Object.assign(this, { rows, lay: rows.lay, comps, slots, wid, lenMax, wallT, edge, tightW });
    this.entryW = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0];
    this.doorGap = StationMatrix.door().gap;
  }

  /** Выступ сервисных ворот компрессора за его бока. */
  over(unit) {
    return Math.max(0, (LayoutOpening.svcW(unit.l, this.wallT) - unit.l) / 2);
  }

  /** От торца — «плотно», но ворота не упираются в угол; между компрессорами — не меньше modes.next и дверь оператора. */
  gapsAt(lvl) {
    const { comps: comps, entryW: entryW, doorGap: doorGap } = this;
    const countC = comps.length;
    const pad = LayoutOpening.DOOR.pad;
    const next = StationMatrix.modes().next;
    const gaps = this.rows.chain(
      this.slots.map(slot => slot.e),
      lvl,
    ).gaps;
    gaps[0] = Math.max(this.tightW, Math.ceil(this.over(comps[0]) + Math.max(pad, this.edge) - this.lay.gap));
    for (let i = 1; i < countC; i++)
      gaps[i] = Math.max(
        gaps[i],
        next,
        Math.ceil(this.over(comps[i - 1]) + this.over(comps[i]) + 2 * doorGap + entryW),
      );
    gaps[countC] = Math.max(gaps[countC], Math.ceil(this.over(comps[countC - 1]) + doorGap + entryW + pad), next);
    return gaps;
  }

  build() {
    const { slots: slots, lenMax: lenMax, comps: comps } = this;
    const countC = comps.length;
    const body = Num.sum(slots.map(slot => slot.e.l));
    const rec = this.gapsAt(0);
    const min = this.gapsAt(this.lay.closeOk ? 2 : 1);
    if (body + Num.sum(min) > lenMax)
      return { ok: false, why: 'length', needL: body + Num.sum(min), needL0: body + Num.sum(rec) };
    const share =
      Num.sum(rec) > Num.sum(min)
        ? Math.max(0, Math.min(1, (lenMax - body - Num.sum(min)) / (Num.sum(rec) - Num.sum(min))))
        : 1;
    const gaps = min.map((v, i) => Math.floor(v + (rec[i] - v) * share));
    gaps[countC] += lenMax - body - Num.sum(gaps);
    const items = this.items(gaps);
    const last = comps[countC - 1];
    const compEnd = items[countC - 1].x + last.l;
    const restX = Math.round(
      Math.max(compEnd + this.over(last) + this.doorGap, compEnd + (gaps[countC] - this.entryW) / 2),
    );
    const equip = items.filter(i => !i.o.ends && !i.o.end && !i.o.e.slot);
    const aisleW = equip.length ? Math.min(...equip.map(i => i.aisle)) : this.wid - comps[0].w;
    return {
      ok: true,
      rows: 1,
      aisleW,
      items,
      iss: this.notes(equip, aisleW, share, gaps),
      entry: [restX, restX + this.entryW],
    };
  }

  items(gaps) {
    const { wid: wid } = this;
    const out = [];
    let x = gaps[0];
    this.slots.forEach((slot, i) => {
      const depth = slot.e.w;
      const budget = wid - depth;
      const item = { o: slot, ri: 0, x, lx: slot.e.l, d: depth, face: -1 };
      item.back =
        slot.ends || slot.end
          ? Math.round(budget / 2)
          : LayoutRows.backFor(slot.e.c.back, budget, this.lay.front(slot.e)[0]);
      item.aisle = budget - item.back;
      item.y = wid - item.back - depth;
      out.push(item);
      x += slot.e.l + gaps[i + 1];
    });
    return out;
  }

  notes(equip, aisleW, share, gaps) {
    const iss = [];
    const [aRec, aMin] = this.lay.aisle;
    if (equip.length && aisleW < aRec)
      iss.push({
        level: 'warn',
        text: `Проход обслуживания ${Mm.text(aisleW)} мм — меньше рекомендуемых ${Mm.text(aRec)} мм (допустимо от ${Mm.text(aMin)} мм).`,
      });
    if (share < 1 && gaps.length > 2) {
      iss.push({
        level: 'warn',
        text: `Промежутки между оборудованием уменьшены до ${Mm.text(Math.min(...gaps.slice(1, -1)))} мм — по длине не хватает места для рекомендуемых.`,
      });
    }
    return iss;
  }
}
