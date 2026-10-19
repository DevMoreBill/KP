import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationTidy } from './station-tidy.js';
import { StWalls } from './st-walls.js';
import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { VentIntake } from './vent-intake.js';

const key = e => `${e.id}#${e.unit}`;
const r = x => Math.round(x * 100) / 100;
const floorDgu = I => I.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');

/**
 * Места жалюзи по расчёту (решения ПНЕВМОТЕХ). Приток и выброс — никогда на одной стене. Выброс компрессоров: над их
 * сервисными воротами → вверху стены над компрессором → торец у компрессора без ворот → иначе все через крышу каналами
 * одного размера; решётки у всех компрессоров одинаковые. Общая вытяжка — у осушителя, своего размера. Приток — на стене
 * напротив выброса одним проёмом (иначе одинаковыми), в створках ворот и сервисных дверей, на свободных стенах; у ДГУ —
 * напротив каждой, одинаковый. Не встал — приточные вентиляторы, затем нехватка.
 */
export class VentPlan {
  constructor(plan, front, roof) {
    this.plan = plan;
    this.front = front;
    this.roofOnly = roof;
  }

  /** Проекция центра тяжести на стену w (знак № 12): {u, z} или null. */
  static cog(plan, w) {
    const M = plan.mass;
    const g = plan.geo;
    if (!M || !g || !g.ext) return null;
    const c = M.cg;
    const [Le, We] = g.ext;
    const [Li, Wi] = plan.int;
    return {
      u: w === 'left' || w === 'right' ? c.y - (We - Wi) / 2 : c.x - (Le - Li) / 2,
      z: c.z - StationGeo.zFloor(g.type),
    };
  }

  run() {
    if (!this.init()) return null;
    this.snowGaps();
    this.radiators();
    this.compressors();
    const out = this.out;
    this.exW = new Set([this.E, ...out.louvers.filter(q => q.kind === 'out' || q.kind === 'rad').map(q => q.wall)]);
    this.general();
    if (!out.size.out && out.need.out) out.size.out = VentGrille.size(out.need.out.gross, this.OB);
    new VentIntake(this).run();
    this.restOut();
    this.finish();
    return out;
  }

  init() {
    const { plan } = this;
    const v = plan.heat && plan.heat.vent;
    const sys = plan.sys || {};
    const I = plan.items || [];
    const dgu = I.find(i => i.kind === 'dgu' && !i.tank);
    if (!v || (!dgu && sys.vent === false)) return false;
    [this.L, this.Wd, this.H] = plan.int;
    Object.assign(this, { v, sys, I, dgu, Sm: v.sum, x0: plan.geo.x0 || 0, S: VentGrille.STEP, OB: VentGrille.OUT });
    this.speeds();
    this.room = Math.max(0, v.m3h - v.use);
    this.qRad = dgu ? Math.max(v.rad, this.room) : 0;
    this.qIn = this.inFlow();
    this.comp = I.filter(i => i.kind === 'compressor' && i.mount === 'floor' && !i.tank);
    this.radW = new Set(floorDgu(I).map(i => i.rad || 'right'));
    this.E = this.exhaustWall();
    this.W = new StWalls(plan, { equip: false });
    this.roofs = (plan.roof || []).map(m => [m.x - 150, m.x + m.lx + 150, m.y - 150, m.y + m.ly + 150]);
    const IN = VentGrille.IN;
    this.oh = Math.max(this.OB.h[0], Math.min(this.OB.h[1], this.H - this.OB.top - IN.z0 - IN.h[0] - 200));
    this.qWall = dgu ? 0 : this.room;
    this.outRest = 0;
    this.leftOk = this.x0 === 0 && !plan.geo.sea;
    this.out = this.result();
    return true;
  }

  /** Проёмы — по рамке S = L / (3600·v), приток — с запасом. */
  speeds() {
    const Sm = this.Sm;
    const sp = () => StationRules.raw('vent.speed');
    this.vIn = Sm ? Sm.vIn : sp().in;
    this.vOut = Sm ? Sm.vOut : sp().out;
    this.res = Sm ? Sm.res : sp().inReserve;
  }

  inFlow() {
    const { v, Sm } = this;
    if (this.dgu) return this.qRad + v.use + v.cool;
    return Sm && Sm.Lin ? Sm.Lin : v.m3h + v.cool;
  }

  exhaustWall() {
    if (!this.dgu) return 'back';
    return this.radW.has('right') ? 'right' : [...this.radW][0];
  }

  qc(c) {
    return Math.round(StationHeat.coolOf(c, this.plan));
  }

  result() {
    const qOut = (this.dgu ? 0 : this.room) + this.comp.reduce((s, c) => s + this.qc(c), 0);
    return {
      q: { in: Math.round(this.qIn), out: Math.round(qOut), rad: Math.round(this.qRad) },
      need: { in: this.need(this.qIn, 'in'), out: qOut > 0 ? this.need(qOut, 'out') : null },
      size: {},
      louvers: [],
      roof: [],
      exhaust: this.E,
      ducts: {},
      short: { in: 0, out: 0 },
      face: this.vOut,
      vIn: this.vIn,
      vOut: this.vOut,
      res: this.res,
      free: VentGrille.FREE,
      rad: null,
      draft: null,
    };
  }

  need(q, kind) {
    const gross = kind === 'in' ? (q / 3600 / this.vIn) * this.res : q / 3600 / this.vOut;
    return { q, gross: r(gross), free: r(gross * VentGrille.FREE), v: kind === 'in' ? this.vIn : this.vOut };
  }

  /** Выброс по рамке, мм². */
  gross(q) {
    return (q / 3600 / this.vOut) * 1e6;
  }

  cogHit(w, u0, u1, z0, z1) {
    const c = VentPlan.cog(this.plan, w);
    const hh = 150 + 120;
    return !!c && c.z + hh > z0 && c.z - hh < z1 + 220 && u0 < c.u + hh && u1 > c.u - hh;
  }

  /** Маркиза выступает от стены — от дверей и ворот на HOOD_GAP дальше. */
  snowGaps() {
    if (!this.sys.snow && !this.sys.snowout) return;
    const { plan, W } = this;
    const D = VentGrille.HOOD_GAP;
    for (const d of plan.doors || []) W.busy(d.wall === 'back' ? 'back' : 'front', d.x0 - D, d.x1 + D, 0, d.h + 150);
    for (const q of [plan.entry, plan.exit, plan.gates, plan.gates2].filter(Boolean)) {
      if (q.wall === 'front') W.busy('front', q.x0 - D, q.x1 + D, 0, q.h + 150);
      else W.busy(q.wall, q.y0 - D, q.y1 + D, 0, q.h + 150);
    }
  }

  /** У каждой ДГУ — своя дверь-жалюзи (или жалюзи) напротив радиатора; общий расход — в доле её радиатора. */
  radiators() {
    if (!this.dgu) return;
    const DG = floorDgu(this.I);
    const R = StationRules.raw('heat.dgu_rad');
    const own = i => (i.cool > 0 ? i.cool : (i.kw * 1000 * R.share) / (StationHeat.AIR * R.dt));
    const sum = DG.reduce((s, i) => s + own(i), 0) || 1;
    const rads = DG.map(g => this.radiator(g, Math.round((this.qRad * own(g)) / sum)));
    const top = rads.reduce((a, b) => ((b.v || 0) > (a.v || 0) ? b : a), rads[0]);
    if (top) this.out.rad = { ...top, qOne: top.q, q: Math.round(this.qRad), n: rads.length, list: rads };
  }

  radiator(g, q) {
    const wall = g.rad || 'right';
    const end = wall !== 'back';
    const d = (this.plan.dguDoors || []).find(o => o.pos === g.pos && o.unit === g.unit);
    const Lr = d
      ? {
          kind: 'rad',
          wall,
          u0: end ? d.y0 : d.x0,
          u1: end ? d.y1 : d.x1,
          z0: 0,
          z1: d.h,
          door: true,
          pos: g.pos,
          unit: g.unit,
        }
      : {
          kind: 'rad',
          wall,
          u0: Math.round((end ? g.y : g.x) + 80),
          u1: Math.round((end ? g.y + g.ly : g.x + g.lx) - 80),
          z0: Math.round(g.h * 0.12),
          z1: Math.round(g.h * 0.95),
          pos: g.pos,
          unit: g.unit,
        };
    Lr.w = Lr.u1 - Lr.u0;
    Lr.h = Lr.z1 - Lr.z0;
    Lr.q = q;
    this.out.louvers.push(Lr);
    this.W.busy(wall, Lr.u0 - 90, Lr.u1 + 260, Lr.z0, Lr.z1 + 120);
    const fr = ((Lr.w * Lr.h) / 1e6) * VentGrille.FREE;
    return {
      q: Lr.q,
      free: r(fr),
      w: Lr.w,
      h: Lr.h,
      door: !!Lr.door,
      wall,
      v: fr > 0 ? Math.round((Lr.q / 3600 / fr) * 10) / 10 : null,
    };
  }

  /** Колпак выброса на крыше ближе к источнику, мимо глушителя и других колпаков; нет места — двумя поменьше. */
  hood(q, xc, yc, duct, depth = 0) {
    const { S, Wd, out } = this;
    const a = this.gross(q);
    const sy = Math.min(Wd - 300, Math.max(400, Math.ceil(Math.sqrt(a) / S) * S));
    const sx = Math.max(400, Math.ceil(a / sy / S) * S);
    const at = this.roofSpot({ sx, sy }, xc, yc);
    if (!at) {
      if (depth < 2 && a > 0.5e6) {
        this.hood(q / 2, xc, yc, duct, depth + 1);
        this.hood(q / 2, xc, yc, duct, depth + 1);
      } else {
        out.short.out = r(out.short.out + a / 1e6);
      }
      return;
    }
    const [xa, ya] = at;
    this.roofs.push([xa - 150, xa + sx + 150, ya - 150, ya + sy + 150]);
    out.roof.push({
      kind: 'out',
      x0: xa,
      x1: xa + sx,
      y0: ya,
      y1: ya + sy,
      w: sx,
      l: sy,
      q: Math.round(q),
      ...(duct ? { duct } : {}),
    });
  }

  roofSpot({ sx, sy }, xc, yc) {
    const { S, Wd, L, x0 } = this;
    const hit = (x, y) =>
      x < x0 + 150 || x + sx > L - 150 || this.roofs.some(([a, b, c, d]) => x < b && x + sx > a && y < d && y + sy > c);
    const ys = [
      ...new Set([yc - sy / 2, 150, Wd - 150 - sy].map(y => Math.round(Math.max(150, Math.min(Wd - 150 - sy, y))))),
    ];
    const x1 = Math.round(xc - sx / 2);
    for (let d = 0; d <= L; d += S) {
      for (const x of d ? [x1 + d, x1 - d] : [x1]) {
        const y = ys.find(q => !hit(x, q));
        if (y !== undefined) return [x, y];
      }
    }
    return null;
  }

  /** Стена выброса компрессора: задняя; второй ряд — стена прохода (если разрешено) или крыша. */
  exWall(c) {
    if (this.E !== 'back') return null;
    if (this.plan.rows === 2 && c.row === 1) return this.front ? 'front' : null;
    return 'back';
  }

  gate(c, w) {
    return (this.plan.doors || []).find(
      d => d.rear && d.wall === w && d.pos.includes(c.pos) && d.x0 < c.x + c.lx && d.x1 > c.x,
    );
  }

  zTop(w) {
    const rearBack = (this.plan.doors || []).some(d => d.rear && d.wall === 'back');
    return this.H - (w === 'back' && rearBack ? 100 : this.OB.top);
  }

  /** Свободное место для жалюзи w × hh вверху стены: ближе к uc, сдвиг не больше maxd → {u, z0, z1, d} | null. */
  fitAt(wall, [w, hh], uc, maxd, ok) {
    const z1 = this.zTop(wall);
    const z0 = z1 - hh;
    const end = wall === 'left' || wall === 'right';
    const [lo, hi] = end ? [100, this.Wd - 100] : [this.x0 + 100, this.L - 100];
    const good = a =>
      a >= lo &&
      a + w <= hi &&
      this.W.free(wall, [a - 90, a + w + 90], [z0 - 90, z1 + 90]) &&
      !this.cogHit(wall, a, a + w, z0, z1) &&
      (!ok || ok(a));
    for (let d = 0; d <= maxd; d += this.S) {
      for (const sg of d ? [1, -1] : [1]) {
        const a = Math.round(uc - w / 2 + sg * d);
        if (good(a)) return { u: a, z0, z1, d };
      }
    }
    return null;
  }

  /** Торец, у которого компрессор стоит (между ним и торцом нет оборудования, в торце нет ворот): ближайшее место. */
  side(c, w, hh) {
    const { plan, L, x0, Wd } = this;
    if (w > Wd - 200) return null;
    const endsOk = !this.comp.some(q => this.exWall(q) === 'front');
    const gatesOn = e => [plan.gates, plan.gates2].some(g => g && g.wall === e);
    const floor = this.I.filter(i => !i.tank && i.mount !== 'pipe' && i.mount !== 'wall');
    const atEnd = e =>
      !floor.some(
        i =>
          i !== c &&
          i.y < c.y + c.ly &&
          i.y + i.ly > c.y &&
          (e === 'right' ? i.x >= c.x + c.lx - 1 : i.x + i.lx <= c.x + 1),
      );
    const ends = endsOk ? ['right', ...(this.leftOk ? ['left'] : [])].filter(e => !gatesOn(e) && atEnd(e)) : [];
    const cx = c.x + c.lx / 2;
    let best = null;
    for (const e of ends) {
      const r2 = this.fitAt(e, [w, hh], c.y + c.ly / 2, Wd);
      const len = r2 ? (e === 'right' ? L - cx : cx - x0) + r2.d : Infinity;
      if (r2 && (!best || len < best.len)) best = { wall: e, ...r2, len };
    }
    return best;
  }

  mark() {
    return { b: this.W.mark(), n: this.out.louvers.length };
  }

  unmark(m) {
    this.W.reset(m.b);
    this.out.louvers.length = m.n;
  }

  add(Lv) {
    const G = VentGrille.GAP;
    this.out.louvers.push(Lv);
    this.W.busy(Lv.wall, Lv.u0 - 90 - G, Lv.u1 + 260 + G, Lv.z0 - 90, Lv.z1 + 90);
    return Lv;
  }

  /** Место компрессора: над его частью сервисных ворот (от перемычки + 240 мм до 100 мм под потолком) или над ним. */
  slot(c) {
    const wall = this.exWall(c);
    const G = wall && this.gate(c, wall);
    if (!G) return { c, wall, hMax: this.oh, wMax: VentGrille.WHOLE };
    const S2 = this.comp.filter(q => this.exWall(q) === wall && this.gate(q, wall) === G).sort((a, b) => a.x - b.x);
    const sw = (G.x1 - G.x0) / S2.length;
    const gap = S2.length > 1 ? VentGrille.GAP / 2 : 0;
    return {
      c,
      wall,
      G,
      a0: G.x0 + S2.indexOf(c) * sw,
      sw,
      hMax: Math.floor(Math.min(this.OB.h[1], this.H - 100 - (G.h + 240)) / this.S) * this.S,
      wMax: Math.min(VentGrille.WHOLE, Math.floor((sw - 2 * gap) / this.S) * this.S),
    };
  }

  at(s, w, hh) {
    const duct = key(s.c);
    if (s.G) {
      const u = Math.round(s.a0 + (s.sw - w) / 2);
      const z1 = this.H - 100;
      return this.add({ kind: 'out', wall: s.wall, u0: u, u1: u + w, z0: z1 - hh, z1, w, h: hh, duct, over: true });
    }
    const p = this.fitAt(s.wall, [w, hh], s.c.x + s.c.lx / 2, 1500);
    return p && this.add({ kind: 'out', wall: s.wall, u0: p.u, u1: p.u + w, z0: p.z0, z1: p.z1, w, h: hh, duct });
  }

  /** Одна решётка w × hh у каждого компрессора группы; не встала хоть у одного — ничего не ставится. */
  all(G, w, hh, f) {
    const m = this.mark();
    if (G.every(s => f(s, w, hh))) return true;
    this.unmark(m);
    return false;
  }

  /** Все компрессоры — одна группа (решётки одного размера по наибольшему расходу); не вышло на стенах — все через крышу. */
  compressors() {
    const { comp, W, out } = this;
    const groups = comp.length ? [comp.slice().sort((a, b) => this.qc(b) - this.qc(a))] : [];
    const mC = W.mark();
    const [nC, nR0, qW0] = [out.louvers.length, out.roof.length, this.qWall];
    const viaRoof = this.roofOnly || comp.some(c => !this.exWall(c)) || !groups.every(Cs => this.group(Cs));
    if (!viaRoof) return;
    W.reset(mC);
    out.louvers.length = nC;
    out.roof.length = nR0;
    this.qWall = qW0;
    out.ducts = {};
    const qMax = Math.max(...comp.map(c => this.qc(c)));
    for (const c of comp) {
      out.ducts[key(c)] = 'roof';
      this.hood(qMax, c.x + c.lx / 2, c.y + c.ly / 2, key(c));
    }
  }

  /** Размер — по самому стеснённому месту: выше — уже; не хватает — наибольшая, что встаёт у всех; остаток — в торце. */
  group(Cs) {
    const q = this.qc(Cs[0]);
    const Sl = Cs.map(c => this.slot(c));
    const got = this.groupSize(Sl, this.gross(q));
    if (!got) return false;
    let rest = Math.max(0, q - ((got[0] * got[1]) / 1e6) * this.vOut * 3600);
    if (rest > 1) rest = this.sideAdd(Sl, rest);
    for (const c of Cs) this.out.ducts[key(c)] = 'wall';
    if (rest <= 1) return true;
    if (!Sl.every(s => s.wall === 'back')) return false;
    this.qWall += rest * Cs.length;
    return true;
  }

  groupSize(Sl, need0) {
    const { S, OB } = this;
    const at = (s, w, hh) => this.at(s, w, hh);
    const hTop = Math.min(...Sl.map(s => s.hMax));
    const wTop = Math.min(...Sl.map(s => s.wMax));
    const hMin = this.Sm && this.Sm.exfan ? VentGrille.FAN_MIN : OB.h[0];
    let part = null;
    for (let hh = hTop; hh >= hMin && wTop >= OB.w[0]; hh -= 50) {
      const w = Math.max(OB.w[0], Math.min(wTop, Math.ceil(need0 / hh / S) * S));
      const m = this.mark();
      if (this.all(Sl, w, hh, at)) {
        if (w * hh >= need0) return [w, hh];
        this.unmark(m);
        if (!part || w * hh > part[0] * part[1]) part = [w, hh];
      }
    }
    return part && this.all(Sl, part[0], part[1], at) ? part : null;
  }

  /** Остаток — добавка одного размера в торце у каждого компрессора; хоть одному некуда — ни у кого. */
  sideAdd(Sl, rest) {
    const { S, OB } = this;
    const hMin = this.Sm && this.Sm.exfan ? VentGrille.FAN_MIN : OB.h[0];
    const put = (s, w2, h2) => {
      const p = this.side(s.c, w2, h2);
      return (
        p &&
        this.add({
          kind: 'out',
          wall: p.wall,
          u0: p.u,
          u1: p.u + w2,
          z0: p.z0,
          z1: p.z1,
          w: w2,
          h: h2,
          duct: key(s.c),
          side: true,
        })
      );
    };
    for (let hh = this.oh; hh >= hMin && rest > 1; hh -= 50) {
      const w = Math.max(OB.w[0], Math.min(VentGrille.WHOLE, Math.ceil(this.gross(rest) / hh / S) * S));
      if (this.all(Sl, w, hh, put)) rest = Math.max(0, rest - ((w * hh) / 1e6) * this.vOut * 3600);
    }
    return rest;
  }

  /** Место на стене: жалюзи u0…u1 (слева 100 мм, справа 260 мм — электропривод клапана), мимо знака «Центр тяжести». */
  spotAt(wall, from, w, lim, [z0, z1]) {
    return this.W.find(
      wall,
      w + 360,
      [z0 - 90, z1 + 90],
      from,
      a => !this.cogHit(wall, a + 100, a + 100 + w, z0, z1) && (!lim || a + 100 + w <= lim),
    );
  }

  putAt({ kind, wall, w, u, z0, h }) {
    const G = VentGrille.GAP;
    const u0 = u + 100;
    const Lv = { kind, wall, u0, u1: u0 + w, z0, z1: z0 + h, w, h };
    this.out.louvers.push(Lv);
    this.W.busy(wall, u0 - 90 - G, Lv.u1 + 260 + G, z0 - 90, z0 + h + 90);
    return w * h;
  }

  /** Одним проёмом, иначе наименьшим числом одинаковых (до MAXN), если встают целиком; bands — высоты низа. */
  whole(kind, o, walls, gross, bands) {
    for (let n = 1; n <= VentGrille.MAXN; n++) {
      for (const zb of bands) {
        if (this.wholeAt({ kind, o, walls, gross, zb }, n)) return true;
      }
    }
    return false;
  }

  wholeAt({ kind, o, walls, gross, zb }, n) {
    const { S, H, OB, W, out } = this;
    const IN = VentGrille.IN;
    const room = kind === 'in' ? H - OB.top - 90 - zb : H - o.top - IN.z0 - IN.h[0] - 200;
    const hmax = Math.floor(Math.min(o.h[1], room) / S) * S;
    if (hmax < o.h[0]) return false;
    for (const sz of VentGrille.sizesN(
      gross,
      { ...o, w: [o.w[0], Math.max(o.w[1], VentGrille.WHOLE)], h: [o.h[0], hmax] },
      n,
    )) {
      const z0 = kind === 'in' ? zb : H - o.top - sz.h;
      const mark = W.mark();
      const nL = out.louvers.length;
      const got = this.fill({ kind, w: sz.w, z0, h: sz.h }, walls, n);
      if (got === n) {
        out.size[kind] = sz;
        return true;
      }
      W.reset(mark);
      out.louvers.length = nL;
    }
    return false;
  }

  /** n жалюзи w × h на стенах по порядку; сколько встало. */
  fill({ kind, w, z0, h }, walls, n) {
    let got = 0;
    for (const [wall, from, lim] of walls) {
      while (got < n) {
        const u = this.spotAt(wall, from, w, lim, [z0, z0 + h]);
        if (u == null) break;
        this.putAt({ kind, wall, w, u, z0, h });
        got++;
      }
    }
    return got;
  }

  /** Одинаковые жалюзи по расчёту; не встали все — остаток той же высоты, ширина — под свободные участки стен. */
  place(kind, o, walls, need0) {
    if (!need0 || need0.gross <= 0) return 0;
    const sz = VentGrille.size(need0.gross, o);
    this.out.size[kind] = this.out.size[kind] || sz;
    if (!sz) return need0.gross * 1e6;
    const z0 = kind === 'in' ? o.z0 : this.H - o.top - sz.h;
    const spec = { kind, z0, h: sz.h };
    const left = this.placeSame(spec, walls, sz, need0.gross * 1e6);
    return Math.max(0, this.placePieces(spec, walls, o.w[1], left));
  }

  placeSame({ kind, z0, h }, walls, sz, left) {
    let uni = sz.n;
    for (const [wall, from, lim] of walls) {
      while (uni > 0 && left > 1) {
        const u = this.spotAt(wall, from, sz.w, lim, [z0, z0 + h]);
        if (u == null) break;
        left -= this.putAt({ kind, wall, w: sz.w, u, z0, h });
        uni--;
      }
    }
    return left;
  }

  placePieces({ kind, z0, h }, walls, wMax, left) {
    for (const [wall, from, lim] of walls) {
      while (left > 1) {
        const p = this.piece(
          { wall, from, lim, z: [z0, z0 + h] },
          Math.min(wMax, Math.max(VentGrille.PIECE, Math.ceil(left / h / this.S) * this.S)),
        );
        if (!p) break;
        left -= this.putAt({ kind, wall, w: p.w, u: p.u, z0, h });
      }
    }
    return left;
  }

  /** Наибольшая ширина от w0 вниз (не уже PIECE), что встаёт на стене. */
  piece({ wall, from, lim, z }, w0) {
    for (let w = w0; w >= VentGrille.PIECE; w -= this.S) {
      const u = this.spotAt(wall, from, w, lim, z);
      if (u != null) return { w, u };
    }
    return null;
  }

  /** Общая вытяжка — у осушителя, своего размера, вверху стены выброса, не над сервисными воротами; не встала — выше. */
  general() {
    const { comp, I, plan, W, H, OB, oh, S } = this;
    const dr = comp.length
      ? I.filter(i => i.kind === 'dryer' && i.mount === 'floor').sort((a, b) => a.x - b.x)[0]
      : null;
    const hub = dr ? Math.round(dr.x + dr.lx / 2) : 'hi';
    for (const d of (plan.doors || []).filter(q => q.wall === 'back')) W.busy('back', d.x0 - 150, d.x1 + 150, 0, H);
    if (this.qWall <= 0) return;
    const need = this.need(this.qWall, 'out');
    const at = [['back', hub]];
    const o = { ...OB, h: [OB.h[0], oh] };
    let left = need.gross * 1e6;
    if (this.E === 'back') left = this.whole('out', o, at, need.gross, [0]) ? 0 : this.place('out', o, at, need);
    if (left > 1 && this.E === 'back') {
      const hT = Math.floor(Math.max(OB.h[0], H - OB.top - 600) / S) * S;
      if (hT > oh) left = this.place('out', { ...OB, h: [OB.h[0], hT] }, at, { gross: left / 1e6 });
    }
    if (left > 1) this.outRest = left;
  }

  /** Остаток вытяжки — на торцах без притока (наверху), затем через крышу. */
  restOut() {
    if (this.outRest <= 1) return;
    const { OB, H, S, L, x0, Wd, E, out } = this;
    const ends = ['right', ...(this.leftOk ? ['left'] : [])].filter(
      w => w !== E && !out.louvers.some(q => q.kind === 'in' && q.wall === w),
    );
    const hT = Math.floor(Math.max(OB.h[0], H - OB.top - 600) / S) * S;
    if (ends.length) {
      this.outRest = this.place(
        'out',
        { ...OB, h: [OB.h[0], hT] },
        ends.map(w => [w, 'hi']),
        { gross: this.outRest / 1e6 },
      );
    }
    if (this.outRest > 1)
      this.hood((this.outRest / 1e6) * this.vOut * 3600, L - Math.min(1500, (L - x0) / 4), Wd / 2, null);
  }

  /** Маркизы у всех — один угол открытия (наибольший из нужных). */
  marks(I, Q, vmax) {
    if (!I.length) return null;
    const hs = I.map(q => VentGrille.hood(Q(q), q.w, q.h, q.z1, vmax));
    const a = Math.max(...hs.map(h => h.a));
    I.forEach((q, i) => {
      q.hood = VentGrille.hoodAt(hs[i], a, Q(q));
    });
    return {
      n: I.length,
      v: vmax,
      a,
      d: Math.max(...I.map(q => q.hood.d)),
      over: I.filter(q => q.hood.v > vmax + 0.005).length,
    };
  }

  /** Аккуратность проёмов, естественная тяга, маркизы, вытяжные вентиляторы. */
  finish() {
    const { out, Sm, sys } = this;
    if (!this.dgu) StationTidy.louvers(out.louvers, this.W, this.H, VentGrille.GAP);
    this.draft();
    if (sys.snow) {
      const I = out.louvers.filter(q => q.kind === 'in');
      const A = I.reduce((s, q) => s + q.w * q.h, 0);
      out.hood = this.marks(I, q => (this.qIn * q.w * q.h) / A, VentGrille.HOOD_V);
    }
    if (sys.snowout) {
      out.hoodOut = this.marks(
        out.louvers.filter(q => q.kind === 'out'),
        q => ((q.w * q.h) / 1e6) * this.vOut * 3600,
        this.vOut,
      );
    }
    if (Sm && Sm.exfan) {
      const Lx = out.louvers.filter(q => q.kind === 'out');
      for (const q of [...Lx, ...(out.roof || [])]) q.fan = true;
      out.exfan = { n: Lx.length + (out.roof || []).length, L: Sm.exfan.L, dp: Sm.exfan.dp, P: Sm.exfan.P };
    }
  }

  /** Естественная тяга общей вытяжки — у станций без компрессоров: от середины притока до середины выброса. */
  draft() {
    const { out, Sm, v } = this;
    const zc = L =>
      L.reduce((s, q) => s + ((q.z0 + q.z1) / 2) * q.w * q.h, 0) /
      Math.max(
        1,
        L.reduce((s, q) => s + q.w * q.h, 0),
      );
    const Li = out.louvers.filter(q => q.kind === 'in');
    const Lo = out.louvers.filter(q => q.kind === 'out' && !q.duct);
    if (this.dgu || !Sm || Sm.units.length || !Li.length || !(Lo.length || (out.roof || []).some(q => !q.duct))) return;
    const zo = Lo.length ? zc(Lo) : this.H + VentGrille.HOOD;
    out.draft = VentCalc.draft(Sm, (zo - zc(Li)) / 1000, this.room, v.ex || {}, v.warn || []);
  }
}
