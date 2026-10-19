import { LayoutOpening } from './layout-opening.js';
import { LayoutRows } from './layout-rows.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';

const sum = list => list.reduce((s, v) => s + v, 0);
const end = items => Math.max(...items.map(i => i.x + i.lx));

/** Ширина не проходит: {ok:false, why:'width', bad, needW} или null. */
const tooWide = (list, need, W) => {
  const bad = list.filter(e => need(e) > W);
  return bad.length ? { ok: false, why: 'width', bad, needW: Math.max(...bad.map(need)) } : null;
};

/**
 * ДГУ-станция: радиатор каждой ДГУ — вплотную к своим жалюзи (dgu.rad), у каждой свой выброс и выхлоп. Одна — вдоль,
 * посередине ширины; две без бака — к двум торцам радиаторами наружу; от dgu.across (и две с баком) — поперёк, радиаторами
 * к задней стене. Поворот на 90° — если так короче (dgu.rot).
 */
export class LayoutDgu {
  constructor(lay) {
    this.lay = lay;
  }

  static get M() {
    return StationMatrix.grp('dgu');
  }

  /** Варианты: line — вдоль (одна или из модулей), ends — к двум торцам, across — поперёк. */
  ways(D) {
    const M = LayoutDgu.M;
    const n = D.length;
    const two = n === 2 && M.two && !this.lay.tank;
    const out = [];
    if (n === 1 || this.lay.inMods) out.push('line');
    if (two) out.push('ends');
    if (n >= M.across || (n >= 2 && (this.lay.tank || !M.two)) || M.rot) out.push('across');
    return out.length ? out : ['across'];
  }

  /** Лучший вариант — помещается и короче (поровну — по порядку); не поместился ни один — самый близкий отказ. */
  row(units, Lu, W) {
    const D = units.filter(e => e.kind === 'dgu');
    const O = units.filter(e => e.kind !== 'dgu');
    const variants = {
      line: () => this.line(units, Lu, W),
      ends: () => this.ends(D, O, Lu, W),
      across: () => this.across(D, O, Lu, W),
    };
    let best = null;
    let fail = null;
    for (const way of this.ways(D)) {
      let r = variants[way]();
      if (r.ok && this.lay.jGeo && Lu > 0) r = this.lay.joints.fit(r, this.lay.jGeo, Lu, W);
      if (r.ok) {
        if (!best || r.used < best.used) best = r;
      } else if (this.closer(r, fail)) fail = r;
    }
    return best || fail;
  }

  closer(r, fail) {
    if (!fail) return true;
    if (fail.why === 'width' && r.why !== 'width') return true;
    const need = q => q.needL || q.needW || 0;
    return r.why === fail.why && need(r) < need(fail);
  }

  /** Одна ДГУ вдоль: обычный ряд, ДГУ посередине ширины, радиатор — к дальнему торцу. */
  line(units, Lu, W) {
    const r = this.lay.rows.one(units, Lu, W, true);
    if (!r.ok) return r;
    for (const it of r.items.filter(i => i.o.e.kind === 'dgu')) {
      it.o.rad = 'right';
      Object.assign(it, this.middle(it.d, W));
    }
    r.aisleW = Math.min(...r.items.map(i => i.aisle));
    r.iss = (r.iss || []).filter(i => !/^Проход обслуживания/.test(i.text));
    this.pass(r.items, r.iss);
    return Object.assign(r, { used: end(r.items), way: 'line' });
  }

  /** ДГУ вдоль — посередине ширины. */
  middle(d, W) {
    const y = Math.round((W - d) / 2);
    return { back: W - d - y, aisle: y, y };
  }

  /** Проход вдоль ДГУ посередине уже dgu.pass — замечание. */
  pass(items, iss) {
    const P = LayoutDgu.M.pass;
    const a = Math.min(...items.filter(i => i.o.e.kind === 'dgu').map(i => i.aisle));
    if (a < P) {
      iss.push({
        level: 'warn',
        text: `ДГУ посередине ширины: проход с каждой стороны ${Mm.text(a)} мм — меньше ${Mm.text(P)} мм («Настройки → Правила компоновки → ДГУ в контейнере»); нужен контейнер шире.`,
      });
    }
  }

  /** Задний отступ и проход у агрегата глубиной d: сзади рекомендуемый, если проход остаётся не уже допустимого. */
  back(e, d, W) {
    const b = e.c.back;
    const budget = W - d;
    const fm = this.lay.front(e)[1];
    const back = LayoutRows.backFor(b, budget, fm);
    return { back, aisle: budget - back, y: W - back - d };
  }

  /** Промежуток между ДГУ у торцов: прочее на полу и дверь оператора. */
  middleLength(A, B, O, lvl) {
    const l1 = Math.min(1, lvl);
    const door = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0] + 2 * StationMatrix.door().gap;
    if (!O.length) return Math.max(Math.max(A.c.side[l1], B.c.side[l1]), door);
    const between = O.slice(1).reduce(
      (m, e, i) => m + Math.max(O[i].c.side[l1], e.c.side[l1]),
      Math.max(A.c.side[l1], O[0].c.side[l1]),
    );
    return between + Math.max(O[O.length - 1].c.side[l1], B.c.side[l1], door) + sum(O.map(e => e.l));
  }

  /** Две ДГУ — у торцов радиаторами наружу; между ними — прочее и дверь оператора в самом широком промежутке. */
  ends(D, O, Lu, W) {
    const R = LayoutDgu.M.rad;
    const [A, B] = D;
    const Ew = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0];
    const wide = tooWide(D, e => e.w + e.c.back[1] + this.lay.front(e)[1], W);
    if (wide) return wide;
    const body = A.l + B.l + 2 * R;
    const needL = body + this.middleLength(A, B, O, 1);
    if (needL > Lu)
      return { ok: false, why: 'length', needL, needL0: body + this.middleLength(A, B, O, 0), needLc: needL };
    const items = [];
    const put = (e, x, rad) =>
      items.push({ o: { e, rot: false, rad }, ri: 0, x, lx: e.l, d: e.w, face: -1, ...this.middle(e.w, W) });
    put(A, R, 'left');
    put(B, Lu - R - B.l, 'right');
    const x1 = R + A.l;
    const x2 = Lu - R - B.l;
    this.others(items, O, x1 + (O.length ? Math.max(A.c.side[1], O[0].c.side[1]) : 0), W);
    const e0 = this.doorAt(items, x1, x2, Ew);
    const iss = [];
    this.pass(items, iss);
    return {
      ok: true,
      rows: 1,
      aisleW: Math.min(...items.map(i => i.aisle)),
      items,
      iss,
      entry: [e0, e0 + Ew],
      used: Lu,
      way: 'ends',
    };
  }

  /** Прочее на полу — сразу за первой ДГУ, подряд с промежутками по нормам. */
  others(items, O, x0, W) {
    let x = x0;
    O.forEach((e, i) => {
      items.push({ o: { e, rot: false }, ri: 0, x, lx: e.l, d: e.w, face: -1, ...this.back(e, e.w, W) });
      x += e.l + (i < O.length - 1 ? Math.max(e.c.side[1], O[i + 1].c.side[1]) : 0);
    });
  }

  /** Дверь оператора — по середине самого широкого промежутка между генераторами и прочим. */
  doorAt(items, x1, x2, Ew) {
    const occ = items.map(i => [i.x, i.x + i.lx]).sort((a, b) => a[0] - b[0]);
    const gaps = occ.slice(1).map((o, i) => [occ[i][1], o[0]]);
    const widest = gaps.filter(([a, b]) => a >= x1 && b <= x2).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] || [
      x1,
      x2,
    ];
    return Math.round((widest[0] + widest[1] - Ew) / 2);
  }

  /** Промежутки по длине между ДГУ поперёк и прочим: у торцов и между ДГУ — отступ сзади и доступ к боку. */
  acrossGaps(E, lvl) {
    const l = Math.min(1, lvl);
    const sv = StationMatrix.grp('aisle').service;
    const as = StationMatrix.access().side;
    const Dm = StationMatrix.door();
    const edge = Math.max(LayoutOpening.DOOR.pad, Dm.edge - (this.lay.T || 0));
    const over = e => (e.kind === 'dgu' ? (LayoutOpening.dguDoorW(e.w) - e.w) / 2 : 0);
    const side = e => (e.kind === 'dgu' ? Math.max(e.c.back[l], as, over(e) + edge) : e.c.side[l]);
    const between = (a, b) => {
      if (a.kind !== 'dgu' || b.kind !== 'dgu') return Math.max(side(a), side(b));
      const access = l ? Math.max(sv, a.c.back[1]) : Math.max(a.c.side[0], sv);
      return Math.max(sv, access, over(a) + over(b) + Dm.gap);
    };
    return [side(E[0]), ...E.slice(1).map((e, i) => between(E[i], e)), side(E[E.length - 1])];
  }

  /** ДГУ поперёк: повёрнуты на 90°, радиатор — к задней стене, генератор — к проходу у передней стены. */
  across(D, O, Lu, W) {
    const R = LayoutDgu.M.rad;
    const E = [...O, ...D];
    const fr = (e, l) => Math.max(this.lay.aisle[l], e.c.side[l]);
    const wide = tooWide(D, e => e.l + R + fr(e, 1), W);
    if (wide) return wide;
    const lenX = e => (e.kind === 'dgu' ? e.w : e.l);
    const body = sum(E.map(lenX));
    const mn = this.acrossGaps(E, 1);
    const rec = this.acrossGaps(E, 0);
    const needL = body + sum(mn);
    if (needL > Lu) return { ok: false, why: 'length', needL, needL0: body + sum(rec), needLc: needL };
    const q = sum(rec) > sum(mn) ? Math.max(0, Math.min(1, (Lu - needL) / (sum(rec) - sum(mn)))) : 1;
    const gaps = mn.map((v, i) => Math.floor(v + (rec[i] - v) * q));
    const items = [];
    let x = gaps[0] + Math.max(0, Lu - body - sum(gaps));
    E.forEach((e, i) => {
      items.push(
        e.kind === 'dgu'
          ? this.turned(e, x, R, W)
          : { o: { e, rot: false }, ri: 0, x, lx: e.l, d: e.w, face: -1, ...this.back(e, e.w, W) },
      );
      x += lenX(e) + gaps[i + 1];
    });
    const aisleW = Math.min(...items.map(i => i.aisle));
    const iss = [];
    if (aisleW < this.lay.aisle[0]) {
      const n = v => Mm.text(v);
      iss.push({
        level: 'warn',
        text: `Проход перед ДГУ ${n(aisleW)} мм — меньше рекомендуемых ${n(this.lay.aisle[0])} мм (допустимо от ${n(this.lay.aisle[1])} мм).`,
      });
    }
    return { ok: true, rows: 1, aisleW, items, iss, used: end(items) + gaps[gaps.length - 1], way: 'across' };
  }

  turned(e, x, R, W) {
    const d = e.l;
    const y = W - R - d;
    return { o: { e, rot: true, rad: 'back' }, ri: 0, x, lx: e.w, d, face: -1, back: R, aisle: y, y };
  }
}
