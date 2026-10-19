import { LayoutOpening } from './layout-opening.js';
import { LayoutPipes } from './layout-pipes.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationTidy } from './station-tidy.js';

const n = v => Mm.text(v);
const sum = list => list.reduce((s, v) => s + v, 0);
const depthOf = o => (o.rot || o.e.cross ? o.e.l : o.e.w);
const lenOf = o => (o.rot || o.e.cross ? o.e.w : o.e.l);

/**
 * Ряды оборудования на полу лицом к проходу: один ряд у задней стены, два ряда у длинных стен с проходом посередине,
 * агрегат поперёк (без сквозного прохода), компрессоры у торца (без продольного прохода). Промежутки — от «не менее»
 * к рекомендуемым; ресиверы — парами, «вплотную» — последним приёмом.
 */
export class LayoutRows {
  constructor(lay) {
    this.lay = lay;
  }

  /** Задний отступ: рекомендуемый, если проход перед агрегатом остаётся не уже f; иначе сколько можно, не меньше «не менее». */
  static backFor(b, budget, f) {
    if (budget - b[0] >= f) return b[0];
    return budget - f >= b[1] ? budget - f : b[1];
  }

  /** Пара ресиверов один за другим (передний a, задний b, промежуток gap): глубина — оба и промежуток. */
  static pairUnit(a, b, gap) {
    return { ...a, l: Math.max(a.l, b.l), w: a.w + gap + b.w, h: Math.max(a.h, b.h), pairD: Math.max(a.w, b.w) };
  }

  /** Можно повернуть боком: разрешено матрицей, короб и заметно длиннее, чем глубже. */
  static turnable(e) {
    return StationMatrix.rot(e.kind) && e.shape === 'box' && e.l > e.w + 50;
  }

  /** Поворачивать боком (сначала дающее больше длины), пока ok(o) после поворота и ряд не уложится (fits). */
  static turn(list, ok, fits) {
    for (const o of list.sort((a, b) => b.e.l - b.e.w - (a.e.l - a.e.w))) {
      o.rot = true;
      if (!ok(o)) {
        o.rot = false;
        continue;
      }
      if (fits()) break;
    }
  }

  /** В два ряда — в задний ряд: ДГУ; аппараты цепочки воздуха (при компрессорах) — подряд по ходу воздуха. */
  static backRow(e, units) {
    if (e.kind === 'dgu') return true;
    const chain = (LayoutPipes.series(e) && e.kind !== 'receiver') || (e.slot && e.kind === 'filter');
    return units.some(u => u.kind === 'compressor') && chain;
  }

  /** Повернуть то, что не проходит по ширине, если после поворота проходит. */
  widen(U, wide, canRot) {
    for (const o of U.filter(x => !wide(x) && canRot(x))) {
      o.rot = true;
      if (!wide(o)) o.rot = false;
    }
  }

  length(U, lvl) {
    return (
      this.chain(
        U.map(o => o.e),
        lvl,
      ).sum + sum(U.map(lenOf))
    );
  }

  /** Один ряд у задней стены лицом к проходу. */
  one(units, Lu, W, noRotate) {
    const lay = this.lay;
    const U = units.map(e => ({ e, rot: false }));
    const canRot = o => !noRotate && LayoutRows.turnable(o.e);
    const pairWall = o => Math.min(o.e.c.back[1], StationMatrix.recv().pairWall);
    const need = o => depthOf(o) + (o.end ? 2 * pairWall(o) : o.e.c.back[1] + lay.front(o.e)[1]);
    const wide = o => need(o) <= W;
    this.widen(U, wide, canRot);
    const narrow = U.filter(o => !wide(o));
    if (narrow.length)
      return { ok: false, why: 'width', bad: narrow.map(o => o.e), needW: Math.max(...narrow.map(need)) };
    const len = lvl => this.length(U, lvl);
    if (lay.recv2) this.endPairs(U, wide, () => false);
    if (len(1) > Lu) {
      const roomy = o => depthOf(o) + o.e.c.back[0] + lay.front(o.e)[1] <= W;
      for (const ok of [roomy, wide]) {
        if (len(1) <= Lu) break;
        LayoutRows.turn(
          U.filter(o => canRot(o) && !o.rot),
          ok,
          () => len(1) <= Lu,
        );
      }
    }
    const lv = this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv) > Lu) return { ok: false, why: 'length', needL: len(1), needL0: len(0), needLc: len(2) };
    return this.place([U], { Lu, W, lv });
  }

  /** Не хватает длины: ресиверы парой, затем парами поперёк у торца, затем вплотную, затем без прохода у торца. */
  squeeze(U, len, Lu, wide, noRotate) {
    const done = () => len(1) <= Lu;
    if (done()) return 1;
    if (!noRotate) this.pairs(U, wide, done);
    if (!noRotate && !done()) this.endPairs(U, wide, done);
    if (done()) return 1;
    if (!this.lay.closeOk) return 1;
    return len(2) <= Lu ? 2 : 3;
  }

  /** Соседние ресиверы — парой один за другим (задний — ближе к стене), осмотр заднего — сбоку. */
  pairs(U, wide, done) {
    const solo = o => !o.pair && !o.rot && o.e.kind === 'receiver' && !o.e.slot;
    for (let k = 0; k < U.length - 1 && !done(); k++) {
      const [a, b] = [U[k], U[k + 1]];
      if (!solo(a) || !solo(b)) continue;
      const gap = Math.max(a.e.c.side[1], b.e.c.side[1]);
      const o = { e: LayoutRows.pairUnit(a.e, b.e, gap), rot: false, pair: [a.e, b.e], gap };
      if (wide(o)) U.splice(k, 2, o);
    }
  }

  /** Ресиверы в конце ряда — парами поперёк во всю ширину; вплотную в паре — только где допускается. */
  endPairs(U, wide, done) {
    const solo = o => !o.pair && !o.rot && o.e.kind === 'receiver' && !o.e.slot && !o.e.cross;
    let k = U.length;
    while (k > 0 && solo(U[k - 1])) k--;
    for (let j = U.length - 2; j >= k && !done(); j -= 2) {
      const o = this.endPair(U[j].e, U[j + 1].e, wide);
      if (!o) break;
      U.splice(j, 2, o);
    }
  }

  endPair(a, b, wide) {
    const side = Math.max(a.c.side[1], b.c.side[1]);
    const gaps = this.lay.closeOk ? [side, 0] : [side];
    return (
      gaps.map(gap => ({ e: LayoutRows.pairUnit(a, b, gap), rot: false, pair: [a, b], gap, end: true })).find(wide) ||
      null
    );
  }

  /** Пара ресиверов → два места: передний — у прохода, задний — за ним. */
  unpair(it, geo) {
    const [f, b] = it.o.pair;
    const g = it.o.gap;
    const mark = it.o.end ? { pairEnd: true } : {};
    const make = (e, y, d, back, aisle) => ({
      ...this.lay.item(
        {
          o: { e, rot: false },
          ri: it.ri,
          x: it.x + Math.round((it.lx - e.l) / 2),
          lx: e.l,
          d,
          y,
          face: it.face,
          back,
          aisle,
        },
        geo,
      ),
      pair: true,
      ...mark,
    });
    return [make(f, it.y, f.w, it.back + g + b.w, it.aisle), make(b, it.y + f.w + g, b.w, it.back, it.aisle + f.w + g)];
  }

  /** Распределение по двум рядам: задний — ДГУ и цепочка воздуха, ресиверы — подряд в одном ряду, прочее — в короткий. */
  split(units) {
    const A = [];
    const B = [];
    let recv = null;
    for (const e of units) {
      const o = { e, rot: false };
      if (LayoutRows.backRow(e, units)) B.push(o);
      else if (e.kind === 'receiver' && recv) recv.push(o);
      else {
        const row = this.length(A, 1) <= this.length(B, 1) ? A : B;
        row.push(o);
        if (e.kind === 'receiver') recv = row;
      }
    }
    return [A, B];
  }

  /** Два ряда у длинных стен, проход посередине. */
  two(units, Lu, W, noRotate) {
    const lay = this.lay;
    const [A, B] = this.split(units);
    if (!A.length || !B.length) return { ok: false, why: 'rows' };
    const deep = R => Math.max(...R.map(o => depthOf(o) + o.e.c.back[1]));
    const aMin = Math.max(...[...A, ...B].map(o => lay.front(o.e)[1]));
    const fits = () => W - deep(A) - deep(B) >= aMin;
    if (!fits()) return { ok: false, why: 'width2' };
    let lv = 1;
    const L = () => Math.max(this.length(A, lv), this.length(B, lv));
    const L0 = Math.max(this.length(A, 0), this.length(B, 0));
    if (L() > Lu && !noRotate)
      LayoutRows.turn(
        [...A, ...B].filter(o => LayoutRows.turnable(o.e)),
        fits,
        () => L() <= Lu,
      );
    const fitsAt = v => Math.max(this.length(A, v), this.length(B, v)) <= Lu;
    if (L() > Lu && lay.closeOk) lv = [2, 3].find(fitsAt) || 1;
    if (L() > Lu)
      return {
        ok: false,
        why: 'length2',
        needL: L(),
        needL0: L0,
        needLc: Math.max(this.length(A, 2), this.length(B, 2)),
      };
    return this.place([B, A], { Lu, W, lv });
  }

  /**
   * Без сквозного прохода (исключение): один ряд, а агрегат, который с проходом не встаёт по ширине, — поперёк лицом к
   * входу; за ним — вторая часть станции со своей дверью оператора.
   */
  cross(units, Lu, W, noRotate) {
    const lay = this.lay;
    const U = units.map(e => ({ e, rot: false }));
    const canRot = o => !noRotate && LayoutRows.turnable(o.e);
    const need = o => depthOf(o) + o.e.c.back[1] + lay.front(o.e)[1];
    const wide = o => o.e.cross || need(o) <= W;
    this.widen(U, wide, canRot);
    const narrow = U.filter(o => !wide(o));
    if (narrow.length !== 1) {
      return {
        ok: false,
        why: 'width',
        bad: narrow.map(o => o.e),
        needW: narrow.length ? Math.max(...narrow.map(need)) : W + 1,
      };
    }
    const X = narrow[0];
    if (/^(dgu|cabinet|pump)$/.test(X.e.kind) || X.e.slot || X.e.l > W)
      return { ok: false, why: 'width', bad: [X.e], needW: need(X) };
    X.rot = false;
    X.e = { ...X.e, cross: true };
    const len = lvl => this.length(U, lvl);
    if (len(1) > Lu)
      LayoutRows.turn(
        U.filter(o => !o.e.cross && canRot(o)),
        wide,
        () => len(1) <= Lu,
      );
    const lv = this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv) > Lu) return { ok: false, why: 'length', needL: len(1), needL0: len(0), needLc: len(2) };
    return this.place([U], { Lu, W, lv });
  }

  /** Промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее). */
  chain(E, lvl) {
    if (!E.length) return { gaps: [], sum: 0 };
    const lay = this.lay;
    const l1 = Math.min(1, lvl);
    const front = e => lay.front(e)[l1];
    const behind = e => Math.max(e.c.back[l1], lay.aisle[1]);
    const neighbours = (a, b) => {
      const p = StationMatrix.pair(a, b);
      if (!p) return Math.max(a.c.side[l1], b.c.side[l1]);
      if (lvl >= 2 && (a.pairD || b.pairD)) return Math.max(p[2], Math.min(p[1], StationMatrix.recv().pairSide));
      return p[Math.min(lvl, 2)];
    };
    const end = e => {
      const S = StationMatrix.sides(e.kind);
      return Math.max(e.c.side[l1], lvl < 3 && (S.L || S.R) ? StationMatrix.access().side : 0);
    };
    const between = (a, b) => {
      if (b.cross) return Math.max(a.c.side[l1], front(b));
      if (a.cross) return Math.max(behind(a), b.c.side[l1]);
      return neighbours(a, b);
    };
    const last = E[E.length - 1];
    const tail = () => {
      if (last.cross) return behind(last);
      return last.c.far ? last.c.far[l1] : end(last);
    };
    const gaps = [E[0].cross ? front(E[0]) : end(E[0]), ...E.slice(1).map((e, i) => between(E[i], e)), tail()];
    return { gaps, sum: sum(gaps) };
  }

  /**
   * Без продольного прохода (исключение, компрессорная): компрессоры у торца по середине ширины, рядом в ряд, с
   * сервисными воротами с обеих сторон; дверь оператора — за последним; ресиверы — парами поперёк у дальнего торца.
   */
  ends(units, Lu, W, T = 0, pe = StationMatrix.door().edge) {
    const C = units.filter(e => e.kind === 'compressor' && !e.slot);
    if (!C.length || units.some(e => /^(dgu|pump|tank)$/.test(e.kind))) return { ok: false, why: 'mode' };
    const tightOf = e => {
      const wt = StationMatrix.wall(e);
      return wt ? wt[1] : e.c.back[1];
    };
    const wide = C.filter(e => e.w + 2 * tightOf(e) > W);
    if (wide.length)
      return { ok: false, why: 'width', bad: wide, needW: Math.max(...wide.map(e => e.w + 2 * tightOf(e))) };
    const U = this.endsOrder(C, units);
    this.endsPairs(U, W, tightOf(C[0]));
    const need = o => o.e.w + o.e.c.back[1] + this.lay.front(o.e)[1];
    const bad = U.filter(o => !o.ends && !o.end && need(o) > W);
    if (bad.length) return { ok: false, why: 'width', bad: bad.map(o => o.e), needW: Math.max(...bad.map(need)) };
    return new EndsRow(this, { C, U, W, Lu, T, pe, tw: tightOf(C[0]) }).build();
  }

  /** Компрессоры — первыми; шкафы и фильтры без места на стене и трубе — перед ресиверами (ресиверы — у дальнего торца). */
  endsOrder(C, units) {
    const isR = e => e.kind === 'receiver' && !e.slot;
    const rest = units.filter(e => !C.includes(e));
    let t = rest.length;
    while (t > 0 && (isR(rest[t - 1]) || rest[t - 1].slot)) t--;
    const tail = rest.slice(t);
    const order = [...rest.slice(0, t), ...tail.filter(e => !isR(e)), ...tail.filter(isR)];
    return [...C.map(e => ({ e, rot: false, ends: true })), ...order.map(e => ({ e, rot: false }))];
  }

  /** Ресиверы в конце — парами поперёк: от стен до «плотно» компрессора, промежуток в паре — по правилу, при нехватке — меньше. */
  endsPairs(U, W, tw) {
    let k = U.length;
    while (k > 1 && U[k - 1].e.kind === 'receiver' && !U[k - 1].e.slot) k--;
    const cw = (StationMatrix.wall({ kind: 'compressor', w: 0 }) || [0, 100])[1];
    for (let j = U.length - 2; j >= k; j -= 2) {
      const [a, b] = [U[j].e, U[j + 1].e];
      const pr = StationMatrix.pair(a, b);
      const rw = Math.min(Math.max(a.c.back[1], b.c.back[1]), cw);
      const lo = this.pairLow(pr);
      const g = Math.min(pr ? pr[0] : 300, W - a.w - b.w - 2 * rw);
      if (g < lo || W - a.w - b.w - g < 2 * tw) break;
      U.splice(j, 2, { e: LayoutRows.pairUnit(a, b, g), rot: false, pair: [a, b], gap: g, end: true });
    }
  }

  pairLow(pr) {
    if (!pr) return 300;
    return pr[2] === 0 ? 0 : pr[1];
  }

  /** Места в рядах: R[0] — у задней стены, R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым. */
  place(R, { Lu, W, lv = 1 }) {
    const items = [];
    const span = { short: false, min: Infinity };
    R.forEach((row, ri) => {
      if (row.length) items.push(...this.alongRow(row, ri, Lu, lv, span));
    });
    StationTidy.even(items);
    const rows = R.filter(r => r.length).length;
    if (rows === 1) for (const it of items) this.acrossOne(it, W);
    else this.acrossTwo(items, W);
    const aRec = this.lay.aisle[0];
    StationTidy.facade(items, W, rows, aRec);
    const eq = items.filter(i => !i.o.e.slot && !i.o.e.cross && !i.o.end);
    return {
      ok: true,
      rows,
      aisleW: eq.length ? Math.min(...eq.map(i => i.aisle)) : W,
      items,
      iss: this.placeNotes(eq, span),
    };
  }

  /** Ряд по длине: промежутки между «не менее» и рекомендуемыми, свободная длина — у двери (после шкафов). */
  alongRow(row, ri, Lu, lv, span) {
    const E = row.map(o => o.e);
    const rec = this.chain(E, 0);
    const min = this.chain(E, lv);
    const body = sum(row.map(lenOf));
    const k = rec.sum > min.sum ? Math.max(0, Math.min(1, (Lu - body - min.sum) / (rec.sum - min.sum))) : 1;
    const gaps = min.gaps.map((v, i) => Math.round(v + (rec.gaps[i] - v) * k));
    for (let over = body + sum(gaps) - Lu, i = gaps.length - 1; over > 0 && i >= 0; i--) {
      const d = Math.min(over, gaps[i]);
      gaps[i] -= d;
      over -= d;
    }
    const free = Lu - body - sum(gaps);
    if (k < 1) span.short = true;
    const lead = Math.max(
      0,
      E.findIndex(e => e.kind !== 'cabinet'),
    );
    const out = [];
    let x = gaps[0];
    row.forEach((o, i) => {
      if (i === lead && free > 0) x += free;
      out.push({ o, ri, x, lx: lenOf(o), d: depthOf(o) });
      if (i > 0) span.min = Math.min(span.min, gaps[i]);
      x += lenOf(o) + gaps[i + 1];
    });
    return out;
  }

  /** Один ряд поперёк: сначала задний отступ до рекомендуемого (если проход не уже допустимого), затем проход. */
  acrossOne(it, W) {
    const b = it.o.e.c.back;
    const budget = W - it.d;
    const [fr, fm] = this.lay.front(it.o.e);
    if (it.o.e.cross) {
      Object.assign(it, { y: Math.round(budget / 2), aisle: 0, face: -2 });
      it.back = it.y;
      return;
    }
    if (it.o.end) {
      const wall = Math.min(b[1], StationMatrix.recv().pairWall);
      it.back = Math.min(Math.max(wall, Math.round(budget / 2)), budget - wall);
    } else {
      it.back = LayoutRows.backFor(b, budget, fm);
      if (budget - it.back > fr && it.back < b[0]) it.back = Math.min(b[0], budget - fr);
    }
    it.aisle = budget - it.back;
    it.y = W - it.back - it.d;
    it.face = -1;
  }

  /** Два ряда: сзади рекомендуемый, если проход не уже допустимого; иначе излишек прохода — поровну рядам назад. */
  acrossTwo(items, W) {
    const lay = this.lay;
    const back = it => it.o.e.c.back;
    const A = items.filter(i => i.ri === 1);
    const B = items.filter(i => i.ri === 0);
    const deep = (S, f) => (S.length ? Math.max(...S.map(f)) : 0);
    const recOk = W - deep(A, i => i.d + back(i)[0]) - deep(B, i => i.d + back(i)[0]) >= lay.aisle[1];
    for (const it of items) it.back = recOk ? back(it)[0] : back(it)[1];
    if (!recOk) {
      const per =
        Math.max(0, W - deep(A, i => i.d + i.back) - deep(B, i => i.d + i.back) - lay.aisle[0]) /
        ((A.length ? 1 : 0) + (B.length ? 1 : 0));
      for (const it of items) it.back = Math.floor(Math.min(back(it)[0], back(it)[1] + per));
    }
    const free = W - deep(A, i => i.d + i.back) - deep(B, i => i.d + i.back);
    for (const it of B) Object.assign(it, { y: W - it.back - it.d, face: -1, aisle: free });
    for (const it of A) Object.assign(it, { y: it.back, face: 1, aisle: free });
  }

  /** Замечания расстановки: проход уже рекомендуемого, промежутки уменьшены, агрегат близко к стене. */
  placeNotes(eq, span) {
    const lay = this.lay;
    const aRec = lay.aisle[0];
    const iss = [];
    const dgu = eq.find(i => i.o.e.kind === 'dgu');
    const other = eq.filter(i => i.o.e.kind !== 'dgu');
    const aisleO = other.length ? Math.min(...other.map(i => i.aisle)) : Infinity;
    if (aisleO < aRec)
      iss.push({
        level: 'warn',
        text: `Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(lay.aisle[1])} мм).`,
      });
    if (dgu && dgu.aisle < aRec) {
      iss.push({
        level: 'warn',
        text: `Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(lay.front(dgu.o.e)[1])} мм).`,
      });
    }
    if (span.short) {
      iss.push({
        level: 'warn',
        text: Number.isFinite(span.min)
          ? `Промежутки между оборудованием уменьшены до ${n(span.min)} мм — по длине не хватает места для рекомендуемых.`
          : 'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.',
      });
    }
    for (const it of eq) {
      const rec = it.o.e.c.back[0];
      if (it.back < rec && rec > 150 && !it.o.e.unit) {
        iss.push({
          level: 'warn',
          tight: it.o.e.pos,
          text: `Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back + lay.G)} мм от стены — рекомендуется ${n(rec + lay.G)} мм.`,
        });
      }
    }
    return iss;
  }
}

/** Ряд без продольного прохода: промежутки у торца и между компрессорами (их сервисные ворота и двери оператора). */
class EndsRow {
  constructor(rows, { C, U, W, Lu, T, pe, tw }) {
    Object.assign(this, { rows, lay: rows.lay, C, U, W, Lu, T, pe, tw });
    this.Ew = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0];
    this.dg = StationMatrix.door().gap;
  }

  /** Выступ сервисных ворот компрессора за его бока. */
  over(e) {
    return Math.max(0, (LayoutOpening.svcW(e.l, this.T) - e.l) / 2);
  }

  /** От торца — «плотно», но ворота не упираются в угол; между компрессорами — не меньше modes.next и дверь оператора. */
  gapsAt(lvl) {
    const { C, Ew, dg } = this;
    const nc = C.length;
    const pad = LayoutOpening.DOOR.pad;
    const next = StationMatrix.modes().next;
    const g = this.rows.chain(
      this.U.map(o => o.e),
      lvl,
    ).gaps;
    g[0] = Math.max(this.tw, Math.ceil(this.over(C[0]) + Math.max(pad, this.pe) - this.lay.G));
    for (let i = 1; i < nc; i++)
      g[i] = Math.max(g[i], next, Math.ceil(this.over(C[i - 1]) + this.over(C[i]) + 2 * dg + Ew));
    g[nc] = Math.max(g[nc], Math.ceil(this.over(C[nc - 1]) + dg + Ew + pad), next);
    return g;
  }

  build() {
    const { U, Lu, C } = this;
    const nc = C.length;
    const body = sum(U.map(o => o.e.l));
    const rec = this.gapsAt(0);
    const min = this.gapsAt(this.lay.closeOk ? 2 : 1);
    if (body + sum(min) > Lu) return { ok: false, why: 'length', needL: body + sum(min), needL0: body + sum(rec) };
    const q = sum(rec) > sum(min) ? Math.max(0, Math.min(1, (Lu - body - sum(min)) / (sum(rec) - sum(min)))) : 1;
    const gaps = min.map((v, i) => Math.floor(v + (rec[i] - v) * q));
    gaps[nc] += Lu - body - sum(gaps);
    const items = this.items(gaps);
    const last = C[nc - 1];
    const ce = items[nc - 1].x + last.l;
    const e0 = Math.round(Math.max(ce + this.over(last) + this.dg, ce + (gaps[nc] - this.Ew) / 2));
    const eq = items.filter(i => !i.o.ends && !i.o.end && !i.o.e.slot);
    const aisleW = eq.length ? Math.min(...eq.map(i => i.aisle)) : this.W - C[0].w;
    return { ok: true, rows: 1, aisleW, items, iss: this.notes(eq, aisleW, q, gaps), entry: [e0, e0 + this.Ew] };
  }

  items(gaps) {
    const { W } = this;
    const out = [];
    let x = gaps[0];
    this.U.forEach((o, i) => {
      const d = o.e.w;
      const budget = W - d;
      const it = { o, ri: 0, x, lx: o.e.l, d, face: -1 };
      it.back =
        o.ends || o.end ? Math.round(budget / 2) : LayoutRows.backFor(o.e.c.back, budget, this.lay.front(o.e)[0]);
      it.aisle = budget - it.back;
      it.y = W - it.back - d;
      out.push(it);
      x += o.e.l + gaps[i + 1];
    });
    return out;
  }

  notes(eq, aisleW, q, gaps) {
    const iss = [];
    const [aRec, aMin] = this.lay.aisle;
    if (eq.length && aisleW < aRec)
      iss.push({
        level: 'warn',
        text: `Проход обслуживания ${n(aisleW)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(aMin)} мм).`,
      });
    if (q < 1 && gaps.length > 2) {
      iss.push({
        level: 'warn',
        text: `Промежутки между оборудованием уменьшены до ${n(Math.min(...gaps.slice(1, -1)))} мм — по длине не хватает места для рекомендуемых.`,
      });
    }
    return iss;
  }
}
