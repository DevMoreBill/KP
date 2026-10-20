import { Num } from './num.js';
import { LayoutOpening } from './layout-opening.js';
import { LayoutRows } from './layout-rows.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';

/**
 * ДГУ-станция: радиатор каждой ДГУ — вплотную к своим жалюзи (dgu.rad), у каждой свой выброс и выхлоп. Одна — вдоль,
 * посередине ширины; две без бака — к двум торцам радиаторами наружу; от dgu.across (и две с баком) — поперёк, радиаторами
 * к задней стене. Поворот на 90° — если так короче (dgu.rot).
 */
export class LayoutDgu {
  static _end = items => Math.max(...items.map(i => i.x + i.lx));

  /** Ширина не проходит: {ok:false, why:'width', bad, needW} или null. */
  static _tooWide = (list, need, Wi) => {
    const bad = list.filter(unit => need(unit) > Wi);
    return bad.length ? { ok: false, why: 'width', bad, needW: Math.max(...bad.map(need)) } : null;
  };

  constructor(lay) {
    this.lay = lay;
  }

  /** Правила раздела «ДГУ» матрицы компоновки. */
  static get RULES() {
    return StationMatrix.grp('dgu');
  }

  /** Варианты: line — вдоль (одна или из модулей), ends — к двум торцам, across — поперёк. */
  ways(dgus) {
    const rules = LayoutDgu.RULES;
    const count = dgus.length;
    const two = count === 2 && rules.two && !this.lay.tank;
    const out = [];
    if (count === 1 || this.lay.inMods) out.push('line');
    if (two) out.push('ends');
    if (count >= rules.across || (count >= 2 && (this.lay.tank || !rules.two)) || rules.rot) out.push('across');
    return out.length ? out : ['across'];
  }

  /** Лучший вариант — помещается и короче (поровну — по порядку); не поместился ни один — самый близкий отказ. */
  row(units, lenUse, Wi) {
    const dgus = units.filter(unit => unit.kind === 'dgu');
    const others = units.filter(unit => unit.kind !== 'dgu');
    const variants = {
      line: () => this.line(units, lenUse, Wi),
      ends: () => this.ends(dgus, others, lenUse, Wi),
      across: () => this.across(dgus, others, lenUse, Wi),
    };
    let best = null;
    let fail = null;
    for (const way of this.ways(dgus)) {
      let res = variants[way]();
      if (res.ok && this.lay.jGeo && lenUse > 0) res = this.lay.joints.fit(res, this.lay.jGeo, lenUse, Wi);
      if (res.ok) {
        if (!best || res.used < best.used) best = res;
      } else if (this.closer(res, fail)) fail = res;
    }
    return best || fail;
  }

  /** Ближе ли отказ к успеху, чем прежний: сначала ширина, затем меньшая нехватка. */
  closer(res, fail) {
    if (!fail) return true;
    if (fail.why === 'width' && res.why !== 'width') return true;
    const need = one => one.needL || one.needW || 0;
    return res.why === fail.why && need(res) < need(fail);
  }

  /** Одна ДГУ вдоль: обычный ряд, ДГУ посередине ширины, радиатор — к дальнему торцу. */
  line(units, lenUse, Wi) {
    const res = this.lay.rows.one(units, lenUse, Wi, true);
    if (!res.ok) return res;
    for (const item of res.items.filter(i => i.o.e.kind === 'dgu')) {
      item.o.rad = 'right';
      Object.assign(item, this.middle(item.d, Wi));
    }
    res.aisleW = Math.min(...res.items.map(i => i.aisle));
    res.iss = (res.iss || []).filter(i => !/^Проход обслуживания/.test(i.text));
    this.pass(res.items, res.iss);
    return Object.assign(res, { used: LayoutDgu._end(res.items), way: 'line' });
  }

  /** ДГУ вдоль — посередине ширины. */
  middle(depth, Wi) {
    const y = Math.round((Wi - depth) / 2);
    return { back: Wi - depth - y, aisle: y, y };
  }

  /** Проход вдоль ДГУ посередине уже dgu.pass — замечание. */
  pass(items, iss) {
    const pass = LayoutDgu.RULES.pass;
    const aisle = Math.min(...items.filter(i => i.o.e.kind === 'dgu').map(i => i.aisle));
    if (aisle < pass) {
      iss.push({
        level: 'warn',
        text: `ДГУ посередине ширины: проход с каждой стороны ${Mm.text(aisle)} мм — меньше ${Mm.text(pass)} мм («Настройки → Правила компоновки → ДГУ в контейнере»); нужен контейнер шире.`,
      });
    }
  }

  /** Задний отступ и проход у агрегата глубиной d: сзади рекомендуемый, если проход остаётся не уже допустимого. */
  back(unit, depth, Wi) {
    const backSide = unit.c.back;
    const budget = Wi - depth;
    const frontGap = this.lay.front(unit)[1];
    const back = LayoutRows.backFor(backSide, budget, frontGap);
    return { back, aisle: budget - back, y: Wi - back - depth };
  }

  /** Промежуток между ДГУ у торцов: прочее на полу и дверь оператора. */
  middleLength(first, second, others, lvl) {
    const lvl1 = Math.min(1, lvl);
    const door = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0] + 2 * StationMatrix.door().gap;
    if (!others.length) return Math.max(Math.max(first.c.side[lvl1], second.c.side[lvl1]), door);
    const between = others
      .slice(1)
      .reduce(
        (total, unit, i) => total + Math.max(others[i].c.side[lvl1], unit.c.side[lvl1]),
        Math.max(first.c.side[lvl1], others[0].c.side[lvl1]),
      );
    return (
      between +
      Math.max(others[others.length - 1].c.side[lvl1], second.c.side[lvl1], door) +
      Num.sum(others.map(unit => unit.l))
    );
  }

  /** Две ДГУ — у торцов радиаторами наружу; между ними — прочее и дверь оператора в самом широком промежутке. */
  ends(dgus, others, lenUse, Wi) {
    const radGap = LayoutDgu.RULES.rad;
    const [first, second] = dgus;
    const entryW = LayoutOpening.ENTRY[1] - LayoutOpening.ENTRY[0];
    const wide = LayoutDgu._tooWide(dgus, unit => unit.w + unit.c.back[1] + this.lay.front(unit)[1], Wi);
    if (wide) return wide;
    const body = first.l + second.l + 2 * radGap;
    const needL = body + this.middleLength(first, second, others, 1);
    if (needL > lenUse)
      return {
        ok: false,
        why: 'length',
        needL,
        needL0: body + this.middleLength(first, second, others, 0),
        needLc: needL,
      };
    const items = [];
    const put = (unit, x, rad) =>
      items.push({
        o: { e: unit, rot: false, rad },
        ri: 0,
        x,
        lx: unit.l,
        d: unit.w,
        face: -1,
        ...this.middle(unit.w, Wi),
      });
    put(first, radGap, 'left');
    put(second, lenUse - radGap - second.l, 'right');
    const x1 = radGap + first.l;
    const x2 = lenUse - radGap - second.l;
    this.others(items, others, x1 + (others.length ? Math.max(first.c.side[1], others[0].c.side[1]) : 0), Wi);
    const entry = this.doorAt(items, x1, x2, entryW);
    const iss = [];
    this.pass(items, iss);
    return {
      ok: true,
      rows: 1,
      aisleW: Math.min(...items.map(i => i.aisle)),
      items,
      iss,
      entry: [entry, entry + entryW],
      used: lenUse,
      way: 'ends',
    };
  }

  /** Прочее на полу — сразу за первой ДГУ, подряд с промежутками по нормам. */
  others(items, others, x0, Wi) {
    let x = x0;
    others.forEach((unit, i) => {
      items.push({
        o: { e: unit, rot: false },
        ri: 0,
        x,
        lx: unit.l,
        d: unit.w,
        face: -1,
        ...this.back(unit, unit.w, Wi),
      });
      x += unit.l + (i < others.length - 1 ? Math.max(unit.c.side[1], others[i + 1].c.side[1]) : 0);
    });
  }

  /** Дверь оператора — по середине самого широкого промежутка между генераторами и прочим. */
  doorAt(items, x1, x2, entryW) {
    const occ = items.map(i => [i.x, i.x + i.lx]).sort((one, two) => one[0] - two[0]);
    const gaps = occ.slice(1).map((span, i) => [occ[i][1], span[0]]);
    const widest = gaps
      .filter(([from, till]) => from >= x1 && till <= x2)
      .sort((gapA, gapB) => gapB[1] - gapB[0] - (gapA[1] - gapA[0]))[0] || [x1, x2];
    return Math.round((widest[0] + widest[1] - entryW) / 2);
  }

  /** Промежутки по длине между ДГУ поперёк и прочим: у торцов и между ДГУ — отступ сзади и доступ к боку. */
  acrossGaps(units, lvl) {
    const level = Math.min(1, lvl);
    const service = StationMatrix.grp('aisle').service;
    const sideGap = StationMatrix.access().side;
    const door = StationMatrix.door();
    const edge = Math.max(LayoutOpening.DOOR.pad, door.edge - (this.lay.wallT || 0));
    const over = unit => (unit.kind === 'dgu' ? (LayoutOpening.dguDoorW(unit.w) - unit.w) / 2 : 0);
    const side = unit =>
      unit.kind === 'dgu' ? Math.max(unit.c.back[level], sideGap, over(unit) + edge) : unit.c.side[level];
    const between = (left, right) => {
      if (left.kind !== 'dgu' || right.kind !== 'dgu') return Math.max(side(left), side(right));
      const access = level ? Math.max(service, left.c.back[1]) : Math.max(left.c.side[0], service);
      return Math.max(service, access, over(left) + over(right) + door.gap);
    };
    return [side(units[0]), ...units.slice(1).map((unit, i) => between(units[i], unit)), side(units[units.length - 1])];
  }

  /** ДГУ поперёк: повёрнуты на 90°, радиатор — к задней стене, генератор — к проходу у передней стены. */
  across(dgus, others, lenUse, Wi) {
    const radGap = LayoutDgu.RULES.rad;
    const units = [...others, ...dgus];
    const frontOf = (unit, lvl) => Math.max(this.lay.aisle[lvl], unit.c.side[lvl]);
    const wide = LayoutDgu._tooWide(dgus, unit => unit.l + radGap + frontOf(unit, 1), Wi);
    if (wide) return wide;
    const lenX = unit => (unit.kind === 'dgu' ? unit.w : unit.l);
    const body = Num.sum(units.map(lenX));
    const least = this.acrossGaps(units, 1);
    const rec = this.acrossGaps(units, 0);
    const needL = body + Num.sum(least);
    if (needL > lenUse) return { ok: false, why: 'length', needL, needL0: body + Num.sum(rec), needLc: needL };
    const part =
      Num.sum(rec) > Num.sum(least) ? Math.max(0, Math.min(1, (lenUse - needL) / (Num.sum(rec) - Num.sum(least)))) : 1;
    const gaps = least.map((v, i) => Math.floor(v + (rec[i] - v) * part));
    const items = [];
    let x = gaps[0] + Math.max(0, lenUse - body - Num.sum(gaps));
    units.forEach((unit, i) => {
      items.push(
        unit.kind === 'dgu'
          ? this._turned(unit, x, radGap, Wi)
          : { o: { e: unit, rot: false }, ri: 0, x, lx: unit.l, d: unit.w, face: -1, ...this.back(unit, unit.w, Wi) },
      );
      x += lenX(unit) + gaps[i + 1];
    });
    const aisleW = Math.min(...items.map(i => i.aisle));
    const iss = [];
    if (aisleW < this.lay.aisle[0]) {
      const fmt = v => Mm.text(v);
      iss.push({
        level: 'warn',
        text: `Проход перед ДГУ ${fmt(aisleW)} мм — меньше рекомендуемых ${fmt(this.lay.aisle[0])} мм (допустимо от ${fmt(this.lay.aisle[1])} мм).`,
      });
    }
    return {
      ok: true,
      rows: 1,
      aisleW,
      items,
      iss,
      used: LayoutDgu._end(items) + gaps[gaps.length - 1],
      way: 'across',
    };
  }

  _turned(unit, x, radGap, Wi) {
    const depth = unit.l;
    const y = Wi - radGap - depth;
    return {
      o: { e: unit, rot: true, rad: 'back' },
      ri: 0,
      x,
      lx: unit.w,
      d: depth,
      face: -1,
      back: radGap,
      aisle: y,
      y,
    };
  }
}
