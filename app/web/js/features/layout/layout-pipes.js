import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { PipeMaterial } from './pipe-material.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

const key = i => `${i.id}#${i.unit}`;
const mid = i => Math.round(i.x + i.lx / 2);
const xs = list => list.map(b => b.x);

/** Свободная полоса под трубой за оборудованием, мм, — меньше: линия над оборудованием. */
const ROOM = { fuel: 50, air: 100, in: 140, out: 140, gen: 100 };

/**
 * Трубопровод одной расстановки: магистрали за оборудованием (у задней стены или между рядами) с отводами и выходом
 * через дальний торец: насосы — всас и напор, компрессорная — сжатый воздух через аппараты, ДГУ — топливо от бака.
 */
class PipeRun {
  constructor(r, geo, dh) {
    [this.L, this.W, this.H] = geo.int;
    this.r = r;
    this.floor = r.items.filter(i => i.mount === 'floor');
    this.zTop = Math.max(600, Math.min(this.H - 400, 1500));
    this.hang = (dh || 0) / 2 + 40;
    this.out = [];
  }

  has(kind) {
    return this.floor.some(i => i.kind === kind);
  }

  of(kind) {
    return this.floor.filter(i => i.kind === kind);
  }

  lines() {
    this.r.segs = [];
    if (!this.floor.length) return this.out;
    if (this.has('pump')) this.pumps();
    else if (this.has('compressor')) this.air();
    else if (this.has('dgu')) this.fuel();
    else
      this.line(
        this.floor.filter(i => i.kind !== 'cabinet'),
        { off: Math.max(150, this.hang), part: 0.5, z: Math.min(this.zTop, 1200), label: 'выход', medium: 'gen' },
      );
    return this.out;
  }

  pumps() {
    const P = this.of('pump');
    this.line(P, { off: 110, part: 0.3, z: 450, label: 'вход', medium: 'in' });
    this.line(P, { off: 240, part: 0.7, z: Math.min(this.zTop, 1300), label: 'выход', medium: 'out' });
  }

  fuel() {
    if (this.has('tank'))
      this.out.push(
        ...LayoutPipes.fuelLine(
          this.floor.filter(i => i.kind === 'tank' || i.kind === 'dgu'),
          this.W,
        ),
      );
  }

  air() {
    const a = new AirMain(this, Math.max(StationMatrix.grp('pipe').airY, this.hang)).build();
    this.out.push(...a.lines);
    this.r.segs = a.segs;
  }

  /** Линия от оборудования conn до дальнего торца. */
  line(conn, { off, part, z, label, medium }) {
    if (!conn.length) return;
    const g = this.place(conn, { off, part, z, medium, x0: Math.min(...conn.map(i => i.x + i.lx / 2)), x1: this.L });
    const branches = conn.map(i => LayoutPipes.branch(i, g.y, g.z)).filter(Boolean);
    const ends = [...xs(branches), ...conn.filter(i => !branches.some(b => b.to === key(i))).map(mid)];
    this.out.push({ x0: Math.min(...ends), x1: this.L, y: g.y, z: g.z, label, medium, branches });
  }

  /**
   * Ось линии: полоса за оборудованием до стены (off — от стены, part — доля полосы, если она уже); нет места или ряды
   * напротив — над оборудованием; над сервисными воротами и над оборудованием на пути — выше.
   */
  place(conn, { off, part, z, medium, x0, x1 }) {
    const { W, H } = this;
    const back = conn.filter(i => i.row !== 1);
    const lo = back.length ? Math.max(...back.map(i => i.y + i.ly)) : 0;
    const band = W - lo;
    const y = Math.round(Math.min(W - 40, W - Math.min(off, band * part)));
    let zz = z;
    if (band < ROOM[medium] || this.r.rows === 2)
      zz = Math.min(H - 150, Math.max(zz, ...conn.map(i => i.h + (medium === 'out' ? 450 : 200))));
    const toWall = y > W / 2 ? W - y : y;
    const doors = (this.r.doors || []).filter(
      d => d.wall === (y > W / 2 ? 'back' : 'front') && d.x0 < x1 + 100 && d.x1 > x0 - 100 && toWall < 600,
    );
    if (doors.length) zz = Math.min(H - 120, Math.max(zz, ...doors.map(d => d.h + 150)));
    const hit = this.floor.filter(
      i => i.x < x1 && i.x + i.lx > x0 && i.y < y + 60 && i.y + i.ly > y - 60 && i.h > zz - 60,
    );
    if (hit.length) zz = Math.min(H - 120, Math.max(zz, ...hit.map(i => i.h + 150)));
    return { y, z: Math.round(zz), lo, hi: W };
  }
}

/**
 * Сжатый воздух по ходу воздуха: компрессоры → коллектор → аппараты (у каждого один вход и один выход: магистраль на нём
 * прервана) → выход. Компрессоры не все до первого аппарата — коллектор отдельной трубой выше магистрали. Одинаковые
 * аппараты подряд — параллельно: выходы в магистраль, входы — от своего коллектора на другой высоте. segs — участки
 * между аппаратами: на них висят фильтры своей ступени.
 */
class AirMain {
  constructor(run, off) {
    const { L, H } = run;
    this.run = run;
    this.L = L;
    this.H = H;
    this.src = run.of('compressor');
    this.ser = run.floor.filter(i => LayoutPipes.series(i)).sort((a, b) => a.air.stage - b.air.stage || a.x - b.x);
    this.off = off;
    this.segs = [];
    this.heads = [];
    this.head = null;
  }

  build() {
    const conn = [...this.src, ...this.ser];
    if (!conn.length) return { lines: [], segs: [] };
    const g = this.run.place(conn, {
      off: this.off,
      part: 0.5,
      z: this.run.zTop,
      medium: 'air',
      x0: Math.min(...conn.map(i => i.x)),
      x1: this.L,
    });
    Object.assign(this, { g, y: g.y, z: g.z });
    this.zh = g.z + 220 <= this.H - 120 ? g.z + 220 : g.z - 220;
    this.yh = Math.max(g.lo + 40, Math.min(g.hi - 40, g.y - 110));
    this.steps = AirChain.groups(this.ser).map(G => ({
      G,
      st: G[0].air.stage,
      P: G.map(i => LayoutPipes.ports(i, g.y, g.z)),
    }));
    this.main = {
      x0: 0,
      x1: this.L,
      y: g.y,
      z: g.z,
      label: 'выход',
      medium: 'air',
      branches: [],
      gaps: [],
      bypass: [],
    };
    this.s0 = 10;
    const rest = this.start();
    for (const s of rest) {
      if (s.G.length === 1) this.single(s);
      else this.parallel(s);
      this.s0 = s.st;
    }
    this.segs.push({ a: this.a, b: this.L, s0: this.s0, s1: Infinity, line: this.main });
    return { lines: [...(this.head ? [this.head] : []), this.main, ...this.heads], segs: this.segs };
  }

  outOf(i, y, z) {
    return { ...(LayoutPipes.branch(i, y, z) || { x: mid(i), y0: y, y1: y, z1: z, to: key(i) }), role: 'out' };
  }

  /** Начало магистрали: компрессоры до первого аппарата — на ней; иначе — коллектор к первому аппарату. */
  start() {
    const own = this.src.map(i => this.outOf(i, this.y, this.z));
    const firstIn = this.steps.length ? this.steps[0].P[0][0].x : this.L;
    if (own.every(b => b.x < firstIn - 60)) {
      this.main.x0 = Math.min(...xs(own), firstIn);
      this.main.branches.push(...own);
      this.a = own.length ? Math.max(...xs(own)) : this.main.x0;
      return this.steps;
    }
    this.header(this.steps[0]);
    return this.steps.slice(1);
  }

  /** Коллектор компрессоров к входу первого аппарата (группы); до него фильтр — на участке со всем воздухом. */
  header(s) {
    const { yh, zh } = this;
    const hb = this.src.map(i => this.outOf(i, yh, zh));
    const hin = s.G.map(i => LayoutPipes.ports(i, yh, zh)[0]);
    const hx = [...xs(hb), ...xs(hin)];
    const x = hin[0].x;
    this.head = {
      x0: Math.min(...hx),
      x1: Math.max(...hx),
      y: yh,
      z: zh,
      label: '',
      medium: 'air',
      branches: [...hb, ...hin],
      gaps: [],
      header: true,
      to: Math.round((x + hin[hin.length - 1].x) / 2),
    };
    if (hin.length > 1) this.head.par = s.G.map(i => i.pos);
    const left = xs(hb.filter(b => b.x < x));
    const right = xs(hb.filter(b => b.x > x));
    const a0 = left.length ? Math.max(...left) : null;
    const b0 = right.length ? Math.min(...right) : null;
    const leftSide = a0 != null && (b0 == null || x - a0 >= b0 - x);
    this.segs.push(
      leftSide
        ? { a: a0, b: x, s0: 10, s1: s.st, line: this.head }
        : { a: x, b: b0, s0: 10, s1: s.st, line: this.head },
    );
    const po = s.P.map(p => p[1]);
    this.main.x0 = Math.min(...xs(po));
    this.main.branches.push(...po);
    this.a = Math.max(...xs(po));
    this.s0 = s.st;
  }

  /** Один аппарат: магистраль прервана от входа до выхода, у осушителя — байпас. */
  single(s) {
    const [pin, pout] = s.P[0];
    const bypass = LayoutPipes.bypass(s.G[0], s.P[0]);
    this.segs.push({ a: this.a, b: pin.x, s0: this.s0, s1: s.st, line: this.main });
    this.main.branches.push(pin, pout);
    this.main.gaps.push([pin.x, pout.x]);
    if (bypass) this.main.bypass.push(bypass);
    this.a = pout.x;
  }

  /** Параллельно: магистраль прервана от подъёма до первого выхода; коллектор входов — на другой высоте. */
  parallel(s) {
    const { H, y, z } = this;
    const fi = s.P[0][0].x;
    const rise = Math.round(Math.min(fi - 40, Math.max((this.a + fi) / 2, fi - 150)));
    const po = s.P.map(p => p[1]);
    let yg = this.yh;
    let zg = this.zh;
    if (this.head && this.head.x1 > rise - 100) {
      const zm = 2 * z - this.zh;
      if (zm >= 300 && zm <= H - 120) zg = zm;
      else yg = Math.max(this.g.lo + 40, this.yh - 110);
    }
    const pin = s.G.map(i => LayoutPipes.ports(i, yg, zg)[0]);
    this.segs.push({ a: this.a, b: rise, s0: this.s0, s1: s.st, line: this.main });
    this.main.branches.push(...po);
    this.main.gaps.push([rise, po[0].x]);
    this.heads.push({
      x0: rise,
      x1: Math.max(...xs(pin)),
      y: yg,
      z: zg,
      label: '',
      medium: 'air',
      branches: [{ x: rise, y0: yg, y1: y, z1: z, tee: true }, ...pin],
      gaps: [],
      par: s.G.map(i => i.pos),
    });
    this.a = Math.max(...xs(po));
  }
}

/** Трубопровод станции: линии, отводы, порты аппаратов, выход из станции, материал. */
export class LayoutPipes {
  static FUEL_Z = 60;

  /** Линии трубопровода расстановки; dh — наибольший фильтр на линии (ось — дальше от стены на его половину). */
  static lines(r, geo, dh) {
    return new PipeRun(r, geo, dh).lines();
  }

  /** Аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу). */
  static series(e) {
    return Boolean(e.air) && e.air.stage != null && e.kind !== 'compressor' && e.mount !== 'pipe' && !e.pipe;
  }

  /** Топливопровод от бака к ДГУ — по полу в лотке: вдоль задней стены за ДГУ, если там есть место, иначе — у двери. */
  static fuelLine(conn, W) {
    const Z = this.FUEL_Z;
    const D = conn.filter(i => i.kind === 'dgu');
    const back = D.every(i => !i.rad || i.rad !== 'back') && D.every(i => W - (i.y + i.ly) >= 200);
    const y = back ? W - 120 : 120;
    const branches = conn.map(i => this.branch(i, y, Z)).filter(Boolean);
    const ends = [...xs(branches), ...conn.map(mid)];
    return [
      { x0: Math.min(...ends), x1: Math.max(...ends), y, z: Z, label: '', medium: 'fuel', floor: true, branches },
    ];
  }

  /** Байпас осушителя с краном между входом и выходом: {x0, x1, pos} или null. */
  static bypass(i, p) {
    const ok = i.kind === 'dryer' && i.air && i.air.type !== 'gen' && p[1].x - p[0].x >= 150;
    return ok ? { x0: p[0].x, x1: p[1].x, pos: i.pos } : null;
  }

  static PORTS = { hcyl: [0.15, 0.85], vcyl: [0.3, 0.7] };

  /** Вход и выход аппарата на магистрали: патрубки сверху у задней стороны; у вертикального ресивера вход — внизу. */
  static ports(i, y, z) {
    const to = key(i);
    const u = this.PORTS[i.shape] || [0.25, 0.75];
    const back = this.backSide(i, y);
    const sg = i.y + i.ly < y - 20 ? -1 : 1;
    const dz = Math.min(150, i.ly / 4);
    const top = z > i.h + 50;
    const low = i.shape === 'vcyl' && i.h >= 900 ? Math.round(Math.max(250, i.h * 0.22)) : 0;
    const at = (share, role, lo) => {
      const x = Math.round(i.x + i.lx * share);
      if (back == null) return { x, y0: y, y1: y, z1: Math.round(top ? i.h : z), to, role };
      if (lo) return { x, y0: y, y1: back, z1: lo, to, role };
      if (top) return { x, y0: y, y1: Math.round(back + sg * dz), z1: Math.round(i.h), to, role };
      return { x, y0: y, y1: back, z1: Math.round(z), to, role };
    };
    return [at(u[0], 'in', low), at(u[1], 'out', 0)];
  }

  /** Сторона аппарата к магистрали: задняя (магистраль за ним), передняя (перед ним) или null — магистраль над ним. */
  static backSide(i, y) {
    if (i.y + i.ly < y - 20) return i.y + i.ly;
    return i.y > y + 20 ? i.y : null;
  }

  /** Участки линии без разрывов (внутри аппарата магистраль прервана): [[x0, x1], …]. */
  static runs(l) {
    const gaps = (l.gaps || []).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const out = [];
    let x = l.x0;
    for (const [a, b] of gaps) {
      if (a > x) out.push([x, Math.min(a, l.x1)]);
      x = Math.max(x, b);
    }
    if (l.x1 > x) out.push([x, l.x1]);
    return out;
  }

  /** Участок для фильтра на трубе по его ступени; без цепочки воздуха — линия, где он висит не ниже 150 мм. */
  static segOf(r, e) {
    const S = r.segs || [];
    const stage = e.air && e.air.stage != null ? e.air.stage : 50;
    if (S.length) return S.find(g => stage > g.s0 && stage < g.s1) || S[S.length - 1];
    const ln = this.airLine(r, e.h);
    return ln ? { a: ln.x0 - 100, b: ln.x1 + 100, s0: -Infinity, s1: Infinity, line: ln } : null;
  }

  /** Отвод от магистрали (y, z) к задней стороне оборудования; магистраль выше — заходит на верх и спускается. */
  static branch(i, y, z) {
    const down = z > i.h + 50;
    const x = Math.round(i.x + i.lx * (down ? 0.8 : 0.5));
    const to = key(i);
    const dz = Math.min(150, i.ly / 4);
    const z1 = Math.round(down ? i.h : z);
    if (i.y + i.ly < y - 20) return { x, y0: y, y1: Math.round(down ? i.y + i.ly - dz : i.y + i.ly), z1, to };
    if (i.y > y + 20) return { x, y0: y, y1: Math.round(down ? i.y + dz : i.y), z1, to };
    return down ? { x, y0: y, y1: y, z1: Math.round(i.h), to } : null;
  }

  /** Линия для фильтров: сжатый воздух; иначе — самая высокая, где фильтр высотой h висит не ниже 150 мм. */
  static airLine(r, h) {
    const L = (r.lines || []).filter(l => l.z + Math.max(60, h * 0.12) - h >= 150);
    return L.find(l => l.medium === 'air') || L.sort((a, b) => b.z - a.z)[0] || null;
  }

  /** Фильтр висит на линии: голова — на оси трубы, корпус — вниз; у стены — сдвинут в помещение. */
  static hangOn(it, ln, W) {
    it.y = Math.round(Math.max(20, Math.min(W - it.ly - 20, ln.y - it.ly / 2)));
    it.z = Math.round(ln.z + Math.max(60, it.h * 0.12) - it.h);
    it.line = ln.medium;
  }

  /** Путь выхода от конца магистрали до стены: {pts — точки внутри, dir — наружу}. */
  static outPath(l, W) {
    const o = l.out;
    if (!o) return null;
    if (o.wall === 'back' || o.wall === 'front') {
      const wy = o.wall === 'back' ? W : 0;
      return {
        pts: [
          [o.x, l.y, l.z],
          [o.x, wy, l.z],
        ],
        dir: [0, o.wall === 'back' ? 1 : -1],
      };
    }
    if (o.rise)
      return {
        pts: [
          [l.x1, l.y, l.z],
          [l.x1, l.y, o.z],
          [o.x, l.y, o.z],
        ],
        dir: [1, 0],
      };
    return { pts: [[o.x, l.y, l.z]], dir: [1, 0] };
  }

  /** Трубопровод в составе → линии с материалом и цветом; нет в составе, а фильтры на трубе — линия условно. */
  static route(plan, eq) {
    const ps = eq.filter(e => e.kind === 'piping');
    const lines = plan.lines || [];
    const steel = PipeMaterial.get('steel').color;
    if (!lines.length) return [];
    if (!ps.length) {
      return plan.items.some(i => i.mount === 'pipe')
        ? [
            {
              pos: null,
              implicit: true,
              name: 'Трубопровод',
              kind: 'piping',
              qty: 1,
              mat: '',
              matText: '',
              color: steel,
              dn: '',
              lines,
            },
          ]
        : [];
    }
    return ps.map(p => {
      const m = PipeMaterial.get(p.mat);
      return {
        pos: p.pos,
        name: p.name,
        brief: p.brief,
        kind: 'piping',
        qty: p.qty,
        mat: p.mat,
        matText: m ? m.name.toLowerCase() : '',
        color: m ? m.color : steel,
        dn: p.dn,
        lines,
      };
    });
  }

  /**
   * Выход трубопровода из станции: через дальний торец; там ворота, дверь или дверь-жалюзи ДГУ — на ближайшую свободную
   * стену (сначала — стену линии), затем над проёмом. Снаружи — патрубок с фланцем. l.out — {wall, x, y, z, moved, why}.
   */
  static outlet(plan, outside) {
    new PipeOutlet(plan, outside).place();
  }
}

/** Выход каждой магистрали из станции мимо проёмов (pipe.outGap от проёма, pipe.outEdge от торца). */
class PipeOutlet {
  constructor(plan, outside) {
    [this.L, this.W, this.H] = plan.int;
    this.plan = plan;
    this.outside = outside;
    this.P = StationMatrix.grp('pipe');
    this.iss = plan.issues = plan.issues || [];
    this.taken = [];
    this.ends = this.endOpenings();
  }

  /** Проёмы дальнего торца: ворота, вторая дверь оператора, двери-жалюзи ДГУ. */
  endOpenings() {
    const { plan, W, H } = this;
    const gates = [plan.gates, plan.gates2].filter(g => g && g.wall === 'right');
    const exit = plan.exit && plan.exit.wall === 'right' ? [plan.exit] : [];
    return [
      ...gates.map(g =>
        g.sea ? { y0: 0, y1: W, h: H, t: 'штатные двери' } : { y0: g.y0, y1: g.y1, h: g.h, t: 'ворота' },
      ),
      ...exit.map(e => ({ y0: e.y0, y1: e.y1, h: e.h, t: 'вторая дверь оператора' })),
      ...(plan.dguDoors || [])
        .filter(d => d.wall === 'right')
        .map(d => ({ y0: d.y0, y1: d.y1, h: d.h, t: 'дверь-жалюзи ДГУ' })),
    ];
  }

  /** Проёмы и занятые места на боковой стене w. */
  wallOpenings(w) {
    const { plan } = this;
    const post = StationMods.M.post / 2;
    const entry =
      plan.entry && plan.entry.wall === w ? [{ x0: plan.entry.x0, x1: plan.entry.x1, t: 'дверь оператора' }] : [];
    return [
      ...(plan.doors || [])
        .filter(d => d.wall === w)
        .map(d => ({ x0: d.x0, x1: d.x1, t: d.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота' })),
      ...entry,
      ...(plan.dguDoors || []).filter(d => d.wall === w).map(d => ({ x0: d.x0, x1: d.x1, t: 'дверь-жалюзи ДГУ' })),
      ...plan.items.filter(i => i.mount === 'wall' && i.wall === w).map(i => ({ x0: i.x, x1: i.x + i.lx, t: 'шкаф' })),
      ...StationMods.lines(plan.geo).x.map(x => ({ x0: x - post, x1: x + post, t: 'стык модулей' })),
    ];
  }

  place() {
    for (const l of (this.plan.lines || []).filter(q => q.label && !q.header && q.x1 >= this.L - 1)) this.one(l);
  }

  one(l) {
    const gap = this.P.outGap;
    const blocked = this.ends.find(o => l.y > o.y0 - gap && l.y < o.y1 + gap && l.z < o.h + gap);
    if (!blocked || this.outside) {
      l.out = this.straight(l);
      if (blocked) {
        this.iss.push({
          level: 'warn',
          text: `Выход трубопровода через торец — в проёме (${blocked.t}): ресиверы снаружи стоят за торцом. Перенесите их или ворота в другой торец.`,
        });
      }
      return;
    }
    const why = blocked.t;
    const o = this.moved(l, why);
    if (!o) {
      l.out = this.straight(l);
      this.iss.push({
        level: 'warn',
        text: `Выход трубопровода в дальнем торце — в проёме (${why}), а на стенах рядом места нет: перенесите ворота или укажите место выхода сборщику.`,
      });
      return;
    }
    if (o.wall !== 'right') l.x1 = o.x;
    else if (o.rise) l.x1 = Math.round(this.L - 150);
    l.out = o;
    this.taken.push(o);
    this.iss.push({ level: 'info', text: this.movedText(l, o, why) });
  }

  straight(l) {
    return { wall: 'right', x: this.L, y: l.y, z: l.z, moved: false, flange: this.P.flange };
  }

  /** Выход на ближнюю стену, на дальнюю или над проёмом в торце; места нет — null. */
  moved(l, why) {
    const near = l.y > this.W / 2 ? 'back' : 'front';
    const far = near === 'back' ? 'front' : 'back';
    return this.side(l, near, why) || this.side(l, far, why) || this.above(l, why);
  }

  above(l, why) {
    const gap = this.P.outGap;
    const z =
      Math.max(...this.ends.filter(q => l.y > q.y0 - gap && l.y < q.y1 + gap).map(q => q.h)) + Math.min(gap, 100);
    return z <= this.H - 100
      ? { wall: 'right', x: this.L, y: l.y, z, rise: true, moved: true, why, flange: this.P.flange }
      : null;
  }

  /** Место на стене w: ближе к торцу, после последнего отвода и фильтров, мимо проёмов и оборудования. */
  side(l, w, why) {
    const { plan, P, W } = this;
    const { outGap: gap, outEdge: edge } = P;
    const pipeEnds = plan.items
      .filter(i => i.mount === 'pipe' && Math.abs(i.y + i.ly / 2 - l.y) < i.ly)
      .map(i => i.x + i.lx);
    const lo = Math.max(0, ...(l.branches || []).map(b => b.x), ...pipeEnds) + 100;
    const wy = w === 'back' ? W : 0;
    const open = this.wallOpenings(w).filter(o => o.x1 > lo - gap);
    const free = x =>
      !open.some(o => x > o.x0 - gap && x < o.x1 + gap) &&
      !this.taken.some(t => t.wall === w && Math.abs(t.x - x) < 300) &&
      !plan.items.some(
        i =>
          i.mount !== 'pipe' &&
          i.mount !== 'wall' &&
          x > i.x - 60 &&
          x < i.x + i.lx + 60 &&
          i.y < Math.max(l.y, wy) + 60 &&
          i.y + i.ly > Math.min(l.y, wy) - 60 &&
          i.h > l.z - 120,
      );
    for (let x = Math.round(this.L - edge); x >= lo; x -= 50) {
      if (free(x)) return { wall: w, x, y: wy, z: l.z, moved: true, why, flange: P.flange };
    }
    return null;
  }

  movedText(l, o, why) {
    const n = v => Mm.text(v);
    const where =
      o.wall === 'right'
        ? `Выход — над проёмом в торце, на высоте ${n(o.z)} мм от пола`
        : `Выход — через ${o.wall === 'back' ? 'заднюю стену' : 'стену прохода'} в ${n(this.L - o.x)} мм от дальнего торца (внутри), на высоте ${n(o.z)} мм от пола`;
    return `Выход трубопровода${l.medium === 'air' ? ' сжатого воздуха' : ''} перенесён: в дальнем торце — ${why}. ${where}; снаружи — патрубок с фланцем.`;
  }
}
