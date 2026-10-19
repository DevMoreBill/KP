import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationTidy } from './station-tidy.js';

const n = v => Mm.text(v);
const uniq = list => [...new Set(list)];
const onFloor = i => (i.mount === 'floor' || i.mount === 'frame') && !i.tank;
const VIA_GATES = /, монтаж и демонтаж — через ворота в торце$/;

/**
 * Монтаж и демонтаж: распашные ворота в торце (у компрессорной и насосной — всегда, по возможности в дальнем торце; у
 * морского — его штатные двери), сервисные ворота за агрегатом, стоящим плотно к стене, и в боковой стене напротив того,
 * что к торцу не провезти. Осушителям и ресиверам сервисных ворот не делают.
 */
export class LayoutGates {
  constructor(lay) {
    this.lay = lay;
  }

  /** Вид обслуживают сзади (сторона «З») и ему допускаются сервисные ворота за ним. */
  static gated(kind) {
    return (
      kind !== 'dgu' &&
      kind !== 'cabinet' &&
      kind !== 'tank' &&
      !StationMatrix.noDoor(kind) &&
      StationMatrix.sides(kind).B
    );
  }

  /** Стоит плотно к стене: сзади свободно меньше access.back — обслуживание и демонтаж через ворота за ним. */
  static tight(it) {
    return LayoutGates.gated(it.kind) && onFloor(it) && !it.slot && !it.cross && it.back < StationMatrix.access().back;
  }

  /** Полоса прохода поперёк [от, до], мм: один ряд — от стены прохода до оборудования, два — между рядами. */
  static aisleBand(r, W) {
    const fl = r.items.filter(i => onFloor(i) && !i.cross);
    if (!fl.length) return [0, W];
    if (r.rows !== 2) return [0, Math.min(...fl.map(i => i.y))];
    const A = fl.filter(i => i.row === 1);
    const B = fl.filter(i => i.row !== 1);
    return [A.length ? Math.max(...A.map(i => i.y + i.ly)) : 0, B.length ? Math.min(...B.map(i => i.y)) : W];
  }

  static aisleMid(r, W) {
    const [lo, hi] = this.aisleBand(r, W);
    return (lo + hi) / 2;
  }

  /** Что не вынести через дверь оператора — стоя, а сосуды, фильтры, шкафы и баки — и наклонив. [{it, narrow, why}] */
  bulky(r, geo) {
    const E = this.lay.exits.entryOpen(geo, r.door);
    const pass = StationMatrix.move().pass;
    const out = [];
    for (const it of r.items.filter(i => onFloor(i) && i.kind !== 'dgu')) {
      const tilt = StationMatrix.tilt(it.kind);
      const [a, b] = [it.l, it.w, it.h].sort((p, q) => p - q);
      const narrow = tilt ? a : Math.min(it.l, it.w);
      const fits = tilt
        ? (a + 2 * pass <= E.w && b + pass <= E.h) || (b + 2 * pass <= E.w && a + pass <= E.h)
        : narrow + 2 * pass <= E.w && it.h + pass <= E.h;
      if (!fits) {
        out.push({
          it,
          narrow,
          why: `поз. ${it.pos} ${tilt ? 'и наклонённым ' : ''}не проходит в дверь оператора (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм)`,
        });
      }
    }
    return out;
  }

  /** Через ворота в торце: компрессоры (кроме стоящих плотно к стене) и всё, что не проходит в дверь оператора. */
  mounts(r, geo) {
    const big = this.bulky(r, geo).filter(b => !LayoutGates.tight(b.it));
    const compressors = r.items.filter(
      i => i.kind === 'compressor' && i.mount === 'floor' && !LayoutGates.tight(i) && !big.some(b => b.it === i),
    );
    for (const it of compressors) {
      big.push({
        it,
        narrow: Math.min(it.l, it.w),
        why: `поз. ${it.pos} — компрессор (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм): к нему есть доступ для обслуживания, монтаж и демонтаж — через ворота в торце`,
      });
    }
    return big;
  }

  /** Ширина пути к торцу side для агрегата it — по проходу мимо соседей и шкафов на стене ниже его верха, мм. */
  pathTo(it, side, r, geo) {
    const [L, W] = geo.int;
    const left = side === 'left';
    const lo = left ? geo.x0 || 0 : it.x;
    const hi = left ? it.x + it.lx : L;
    const fl = r.items.filter(o => o !== it && onFloor(o) && o.x < hi && o.x + o.lx > lo);
    let w = r.rows === 2 ? this.betweenRows(r, fl, W) : Math.min(...fl.map(o => o.aisle), Infinity);
    for (const c of r.items.filter(
      q => q.mount === 'wall' && q.wall === 'front' && q.x < hi && q.x + q.lx > lo && q.z < it.h + 50,
    )) {
      const under = fl.filter(o => o.x < c.x + c.lx && o.x + o.lx > c.x);
      w = Math.min(w, (under.length ? Math.min(...under.map(o => o.y)) : W) - c.ly);
    }
    return w;
  }

  betweenRows(r, fl, W) {
    const mid = LayoutGates.aisleMid(r, W);
    const A = fl.filter(o => o.y + o.ly <= mid);
    const B = fl.filter(o => o.y >= mid);
    return (B.length ? Math.min(...B.map(o => o.y)) : W) - (A.length ? Math.max(...A.map(o => o.y + o.ly)) : 0);
  }

  /**
   * Двери и ворота: ворота в торце для того, что туда провезти (дальний торец — по возможности), второй торец — для
   * остального или длинной цепочки, сервисные ворота — стоящему плотно к стене и тому, что к торцам не провезти.
   */
  plan(r, geo, avoid = []) {
    Object.assign(r, { gates: null, gates2: null, doors: [], exit: null });
    for (const it of r.items) it.tight = LayoutGates.tight(it);
    if (r.ends) {
      this.ends(r, geo);
      return;
    }
    const L = geo.int[0];
    const x0 = geo.x0 || 0;
    const dgu = r.items.some(i => i.kind === 'dgu' && !i.tank && L - (i.x + i.lx) <= 600);
    const fl = r.items.filter(onFloor);
    if (geo.sea && geo.door && r.door !== 'end') r.gates = this.seaDoors(geo);
    const ctx = { r, geo, fl, big: this.mounts(r, geo) };
    ctx.free = s => !avoid.includes(s) && (s === 'left' ? x0 === 0 && r.door !== 'end' : !dgu);
    ctx.sides = r.gates ? ['left'] : ['right', 'left'].filter(ctx.free);
    ctx.reach = (b, s) => b.narrow + 2 * StationMatrix.move().pass <= this.pathTo(b.it, s, r, geo);
    const always = !dgu && fl.some(i => i.kind === 'compressor' || i.kind === 'pump');
    const best = this.mainGate(ctx, always);
    let far = ctx.big.filter(b => !best || !best.ok.includes(b));
    far = this.secondGate(ctx, best, far);
    far = far.filter(b => !this.toGate(r, geo, b, ctx.sides)).map(b => this.sideWhy(b, ctx, avoid));
    const rear = r.items.filter(i => i.tight).map(it => ({ it, rear: true, why: this.rearWhy(it) }));
    r.side = [...rear, ...far];
    r.doors = this.sideDoors(r.side, r, geo);
    StationTidy.doors(r.doors);
    this.regate(r, geo);
    this.lay.exits.second(r, geo);
  }

  rearWhy(it) {
    return `поз. ${it.pos} стоит в ${n(it.back)} мм от стены (для обслуживания сзади нужно не меньше ${n(StationMatrix.access().back)} мм) — обслуживание сзади, монтаж и демонтаж через них`;
  }

  gateFrom(ctx, side, list) {
    const U = list.length ? list.map(b => b.it) : ctx.fl.filter(i => i.kind === 'compressor' || i.kind === 'pump');
    return this.gateFor(ctx.r, ctx.geo, side, U);
  }

  /** Ворота в торце, куда провезти больше всего; у компрессорной и насосной — всегда. */
  mainGate(ctx, always) {
    const { r } = ctx;
    let best = null;
    for (const s of ctx.sides) {
      const ok = ctx.big.filter(b => ctx.reach(b, s));
      if (ok.length && (!best || ok.length > best.ok.length)) best = { s, ok };
    }
    if (!best && always && ctx.sides.length && !r.gates) best = { s: ctx.sides[0], ok: [] };
    if (!best) return null;
    if (!r.gates) r.gates = this.gateFrom(ctx, best.s, best.ok);
    for (const b of best.ok) this.addTo(r.gates, b.it.pos, b.why);
    return best;
  }

  /** Агрегат через эти ворота (одна позиция — один раз). */
  addTo(G, pos, why) {
    if (G.pos.includes(pos)) return;
    G.pos.push(pos);
    G.why.push(why);
  }

  /** До ворот не провезти — ворота и во втором торце; цепочка длиннее gate.twoAt — ворота с обоих торцов. */
  secondGate(ctx, best, far) {
    const { r } = ctx;
    const other = this.otherSide(r);
    if (!other || !ctx.free(other) || (r.gates.sea && other === 'left')) return far;
    const ok = far.filter(b => ctx.reach(b, other));
    const used = this.chainLength(ctx.fl);
    const twoAt = StationMatrix.gate().twoAt;
    if (!ok.length && used <= twoAt) return far;
    r.gates2 = this.gateFrom(ctx, other, ok.length ? ok : (best && best.ok) || []);
    for (const b of ok) {
      r.gates2.pos.push(b.it.pos);
      r.gates2.why.push(b.why.replace(/ через ворота в торце$/, ' через ворота во втором торце'));
    }
    if (!ok.length)
      r.gates2.why.push(`оборудование стоит на ${n(used)} мм — длиннее ${n(twoAt)} мм: ворота с обоих торцов`);
    return far.filter(b => !ok.includes(b));
  }

  /** Длина цепочки оборудования на полу, мм. */
  chainLength(fl) {
    return fl.length ? Math.max(...fl.map(i => i.x + i.lx)) - Math.min(...fl.map(i => i.x)) : 0;
  }

  otherSide(r) {
    if (!r.gates) return null;
    return r.gates.wall === 'left' ? 'right' : 'left';
  }

  /** Почему сервисные ворота сбоку: к торцу не провезти или торцы заняты. */
  sideWhy(b, { r, geo, sides }, avoid) {
    const base = b.why.replace(VIA_GATES, '');
    if (!sides.length) {
      const busy = avoid.length
        ? ', торцы заняты шкафами на стене'
        : ', торцы заняты (отсек бака, дверь-жалюзи ДГУ, вход оператора)';
      return { ...b, why: base + busy };
    }
    const w = Math.max(0, ...sides.map(s => this.pathTo(b.it, s, r, geo)).filter(Number.isFinite));
    return {
      ...b,
      why: `${base}, по проходу к торцу не провезти (${w ? `проход ${n(w)} мм, ` : ''}агрегат — ${n(b.narrow)} мм)`,
    };
  }

  /** Осушитель или ресивер, которого к воротам не провезти, — через ближние ворота в торце (соседнее переставляют). */
  toGate(r, geo, b, sides) {
    if (!StationMatrix.noDoor(b.it.kind)) return false;
    const L = geo.int[0];
    const x0 = geo.x0 || 0;
    const far = s => (s === 'left' ? b.it.x - x0 : L - b.it.x - b.it.lx);
    let G = [r.gates, r.gates2].filter(Boolean).sort((p, q) => far(p.wall) - far(q.wall))[0];
    if (!G) {
      const s = sides.slice().sort((p, q) => far(p) - far(q))[0];
      if (!s) return false;
      G = r.gates = this.gateFor(r, geo, s, [b.it]);
    }
    if (!G.pos.includes(b.it.pos)) {
      G.pos.push(b.it.pos);
      G.why.push(
        `${b.why.replace(VIA_GATES, '')}: сервисных дверей осушителям и ресиверам не делают — монтаж и демонтаж через ворота в торце, при демонтаже соседнее оборудование переставляют`,
      );
    }
    return true;
  }

  /** Штатные двери морского контейнера в торце у входа — как ворота в торце. */
  seaDoors(geo) {
    const W = geo.int[1];
    const dw = Math.min(geo.door[0], W);
    return {
      wall: 'left',
      y0: Math.round((W - dw) / 2),
      y1: Math.round((W + dw) / 2),
      w: dw,
      h: geo.door[1],
      leaves: 2,
      pos: [],
      why: [],
      sea: true,
    };
  }

  /** Ворота в торце по итогу: ширина — по агрегатам, которые через них монтируют, высота — по самому высокому. */
  regate(r, geo) {
    for (const G of [r.gates, r.gates2].filter(g => g && !g.sea)) {
      const U = r.items.filter(i => G.pos.includes(i.pos) && onFloor(i));
      const q = this.gateFor(r, geo, G.wall, U);
      for (const k of ['y0', 'y1', 'w', 'h', 'full', 'off', 'offWhy', 'manual']) G[k] = q[k];
    }
  }

  /** Без продольного прохода: компрессорам — ворота с обеих сторон и в торце, ресиверам у дальнего торца — ворота там. */
  ends(r, geo) {
    const C = r.items.filter(i => i.ends);
    const T = r.items.filter(i => i.pairEnd);
    for (const it of C) it.tight = false;
    r.gates = geo.sea && geo.door ? this.seaDoors(geo) : this.gateFor(r, geo, 'left', C);
    const many = C.length > 1;
    const pc = uniq(C.map(i => i.pos));
    r.gates.pos.push(...pc);
    r.gates.why.push(
      `поз. ${pc.join(', ')} — ${many ? 'компрессоры в ряд от торца' : 'компрессор у торца'} без продольного прохода: обслуживание сбоку, монтаж и демонтаж — через ворота в торце${many ? ' и сервисные ворота' : ''}`,
    );
    if (T.length) {
      const pr = uniq(T.map(i => i.pos));
      r.gates2 = this.gateFor(r, geo, 'right', T);
      r.gates2.pos.push(...pr);
      r.gates2.why.push(
        `поз. ${pr.join(', ')} — ресиверы в два ряда у дальнего торца: осмотр, обслуживание, монтаж и демонтаж — через ворота в торце`,
      );
    }
    const side = C.flatMap(it =>
      ['front', 'back'].map(wall => ({
        it,
        wall,
        both: true,
        rear: true,
        why: `поз. ${it.pos} — без продольного прохода: обслуживание ${wall === 'front' ? 'спереди' : 'сзади'}`,
      })),
    );
    const mid = this.betweenCompressors(C);
    side.push(...this.endsOthers(r, geo, C, T));
    r.side = side;
    r.doors = mid;
    r.doors = [...this.sideDoors(side, r, geo), ...mid];
    this.regate(r, geo);
    this.lay.exits.second(r, geo);
  }

  /** Дверь оператора между компрессорами — доступ к ним сбоку. */
  betweenCompressors(C) {
    const E = LayoutOpening.ENTRY;
    const ew = E[1] - E[0];
    const eh = StationMatrix.door().h + 100;
    const CS = C.slice().sort((a, b) => a.x - b.x);
    return CS.slice(1).map((c, i) => {
      const x0 = Math.round((CS[i].x + CS[i].lx + c.x - ew) / 2);
      return {
        wall: 'front',
        x0,
        x1: x0 + ew,
        w: ew,
        h: eh,
        leaves: 1,
        kind: 'entry',
        between: true,
        pos: [],
        why: [`между компрессорами поз. ${CS[i].pos} и ${c.pos} — доступ к ним сбоку`],
      };
    });
  }

  /** Остальное, что не пройдёт в дверь оператора: к воротам в торце, иначе — сервисные ворота напротив. */
  endsOthers(r, geo, C, T) {
    const pass = StationMatrix.move().pass;
    const side = [];
    for (const b of this.bulky(r, geo).filter(x => !C.includes(x.it) && !T.includes(x.it))) {
      const G = [r.gates, r.gates2].find(g => g && b.narrow + 2 * pass <= this.pathTo(b.it, g.wall, r, geo));
      if (G) this.addTo(G, b.it.pos, `${b.why}, монтаж и демонтаж — через ворота в торце`);
      else if (!this.toGate(r, geo, b, [])) side.push({ ...b, why: `${b.why}, к воротам в торце не провезти` });
    }
    return side;
  }

  /**
   * Распашные монтажные ворота в торце s для агрегатов U: ширина — по ним, высота — по самому высокому оборудованию
   * станции (в обоих торцах одинаковая); по оси торца, смещение — только если агрегат по проходу у стены иначе не провезти
   * (или вручную, gate.off в требованиях); шире доли торца — во весь торец.
   */
  gateFor(r, geo, s, U) {
    const [, W, H] = geo.int;
    const pad = LayoutOpening.gaps(geo).eW;
    const T = geo.t || 0;
    const GM = StationMatrix.gate();
    const nw = Math.max(0, ...U.map(i => Math.min(i.l, i.w)));
    const hh = Math.max(0, ...r.items.filter(onFloor).map(i => i.h));
    const w0 = Math.max(GM.minW, Math.ceil((nw + GM.addW + 2 * T) / 100) * 100);
    const full = w0 >= GM.full * W || w0 > W - 2 * pad;
    const w = full ? W - 2 * pad : w0;
    const yc = Math.round((W - w) / 2);
    const place = full ? { y0: pad, off: 0, why: '' } : this.offAxis(r, { W, w, yc, nw, pad, U });
    const own = (this.lay.in.req && this.lay.in.req.gate) || {};
    const manual = Boolean(Number.isFinite(own.off) && own.off);
    if (!full && manual) {
      const y0 = Math.round(Math.max(pad, Math.min(W - pad - w, yc + own.off)));
      Object.assign(place, { y0, off: y0 - yc, why: String(own.why || '').trim() });
    }
    const h = Math.min(H - GM.top, Math.max(GM.minH, Math.ceil((hh + GM.addH + T) / 50) * 50));
    return {
      wall: s,
      y0: place.y0,
      y1: place.y0 + w,
      w,
      h,
      leaves: 2,
      pos: [],
      why: [],
      full,
      off: place.off,
      offWhy: place.why,
      manual,
    };
  }

  /** Смещение ворот от оси к проходу у стены: агрегат по оси над проходом не провезти. */
  offAxis(r, { W, w, yc, nw, pad, U }) {
    const band = LayoutGates.aisleBand(r, W);
    const needW = nw + 2 * StationMatrix.move().pass;
    const lap = y => Math.min(y + w, band[1]) - Math.max(y, band[0]);
    if (!U.length || needW > band[1] - band[0] + 1e-9 || !(lap(yc) < needW - 1e-9)) return { y0: yc, off: 0, why: '' };
    const front = band[1] <= W / 2;
    const y = front ? Math.min(yc, band[1] - needW) : Math.max(yc, band[0] + needW - w);
    const y0 = Math.round(Math.max(pad, Math.min(W - pad - w, y)));
    const off = y0 - yc;
    const why = off
      ? `смещены на ${n(Math.abs(off))} мм от оси торца к проходу у ${front ? 'передней' : 'задней'} стены: агрегат шириной ${n(nw)} мм провозят по проходу ${n(Math.round(band[1] - band[0]))} мм, по оси торца проём над проходом уже агрегата`
      : '';
    return { y0, off, why };
  }

  /** Со шкафами на стене: проход до ворот ещё есть; нет — тому агрегату сервисные ворота в боковой стене. */
  recheck(r, geo) {
    const G = r.gates;
    const side = r.side || [];
    delete r.side;
    if (!G || !G.pos.length) return;
    const pass = StationMatrix.move().pass;
    const lost = this.mounts(r, geo).filter(
      b =>
        G.pos.includes(b.it.pos) &&
        !StationMatrix.noDoor(b.it.kind) &&
        !side.some(q => q.it === b.it) &&
        b.narrow + 2 * pass > this.pathTo(b.it, G.wall, r, geo),
    );
    if (!lost.length) return;
    for (const b of lost) {
      const k = G.pos.indexOf(b.it.pos);
      if (k < 0) continue;
      G.pos.splice(k, 1);
      G.why = G.why.filter(t => !t.startsWith(`поз. ${b.it.pos} `));
    }
    if (!G.pos.length && !G.sea) {
      if (G.wicket && !r.exit) r.exit = this.lay.exits.endExit(r, geo, 'right');
      r.gates = null;
    }
    const keep = r.doors.filter(d => d.kind === 'entry');
    const moved = lost.map(b => ({
      ...b,
      why: `${b.why.replace(VIA_GATES, '')}, до ворот в торце не провезти мимо шкафов на стене`,
    }));
    r.doors = [...this.sideDoors([...side, ...moved], r, geo), ...keep];
  }

  /**
   * Сервисные распашные ворота (уже створки — дверь): стоящему плотно к стене — в стене за ним, остальным — в боковой
   * напротив (два ряда — в стене за ним); мимо дверей оператора; соседние — одними воротами до service.max, иначе рядом.
   */
  sideDoors(list, r, geo) {
    const [L, , H] = geo.int;
    const T = geo.t || 0;
    const { gap, eL } = LayoutOpening.gaps(geo);
    const D = LayoutOpening.DOOR;
    const ctx = {
      gap,
      lo: Math.max((geo.x0 || 0) + D.pad, eL),
      hi: L - eL,
      ex: r.door === 'side' ? this.lay.exits.entrySpan(r, geo) : null,
      keep: (r.doors || []).filter(d => d.kind === 'entry'),
    };
    const out = list.map(q => this.serviceDoor(q, r, { ...ctx, T, H }));
    return this.spaced(this.merged(out, ctx), ctx);
  }

  wallFor({ it, rear, wall }, r) {
    if (wall) return wall;
    const two = r.rows === 2;
    if (rear) return two && it.row === 1 ? 'front' : 'back';
    return two && it.row !== 1 ? 'back' : 'front';
  }

  serviceDoor(q, r, { gap, lo, hi, ex, keep, T, H }) {
    const { it, why, rear, both } = q;
    const wall = this.wallFor(q, r);
    const w = LayoutOpening.svcW(it.lx, T);
    let d0 = Math.max(lo, Math.min(hi - w, it.x + it.lx / 2 - w / 2));
    if (wall === 'front' && ex && d0 < ex[1] + gap && d0 + w > ex[0] - gap) {
      d0 = d0 + w / 2 < (ex[0] + ex[1]) / 2 && ex[0] - gap - w >= lo ? ex[0] - gap - w : Math.min(hi - w, ex[1] + gap);
    }
    for (const k of keep.filter(x => wall === x.wall)) {
      if (d0 < k.x1 + gap && d0 + w > k.x0 - gap)
        d0 = k.x0 - gap - w >= lo ? k.x0 - gap - w : Math.min(hi - w, k.x1 + gap);
    }
    return {
      wall,
      x0: Math.round(d0),
      x1: Math.round(d0 + w),
      h: LayoutOpening.svcH(it.h, T, rear, H),
      kind: 'service',
      pos: [it.pos],
      why: [why],
      rear: Boolean(rear),
      both: Boolean(both),
    };
  }

  /** Соседние на одной стене — одними воротами, пока не шире service.max; иначе — рядом через door.gap. */
  merged(out, { gap, hi }) {
    const D = LayoutOpening.DOOR;
    const got = [];
    for (const d of out.sort((p, q) => p.wall.localeCompare(q.wall) || p.x0 - q.x0)) {
      const last = got[got.length - 1];
      if (last && last.wall === d.wall && d.x0 < last.x1 + gap) {
        if (Math.max(last.x1, d.x1) - last.x0 <= D.max) {
          this.join(last, d);
          continue;
        }
        const w = d.x1 - d.x0;
        d.x0 = last.x1 + gap;
        d.x1 = Math.min(hi, d.x0 + w);
        if (d.x1 - d.x0 < D.min) continue;
      }
      got.push(d);
    }
    return got;
  }

  join(last, d) {
    last.x1 = Math.max(last.x1, d.x1);
    last.h = Math.max(last.h, d.h);
    last.rear = last.rear || d.rear;
    for (const v of d.pos) if (!last.pos.includes(v)) last.pos.push(v);
    for (const t of d.why) if (!last.why.includes(t)) last.why.push(t);
  }

  /** Итог по стене: мимо дверей оператора и друг от друга — не ближе door.gap; не уместилась — через соседние ворота. */
  spaced(got, ctx) {
    const res = [];
    for (const wall of ['front', 'back']) {
      let prev = null;
      for (const d of got.filter(q => q.wall === wall).sort((p, q) => p.x0 - q.x0)) {
        if (!this.fit(d, prev, ctx)) continue;
        res.push(d);
        prev = d;
      }
    }
    return res;
  }

  /** Сдвиг ворот мимо предыдущих и дверей оператора; уже service.min — не ставятся. */
  fit(d, prev, { gap, hi, ex, keep }) {
    const D = LayoutOpening.DOOR;
    const w = d.x1 - d.x0;
    const clash = (a, b) => d.x0 < b + gap && d.x1 > a - gap;
    const shift = x => Object.assign(d, { x0: x, x1: x + w });
    if (prev && d.x0 < prev.x1 + gap) shift(prev.x1 + gap);
    if (d.wall === 'front' && ex && clash(ex[0], ex[1])) shift(ex[1] + gap);
    for (const k of keep.filter(q => q.wall === d.wall)) if (clash(k.x0, k.x1)) shift(k.x1 + gap);
    d.x1 = Math.min(hi, d.x1);
    if (d.x1 - d.x0 < D.min) return false;
    d.w = d.x1 - d.x0;
    d.leaves = Math.max(1, Math.ceil(d.w / D.leaf));
    return true;
  }
}
