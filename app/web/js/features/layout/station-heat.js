import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationTidy } from './station-tidy.js';

const mm = v => v / 1000;
const rule = name => StationRules.raw(name);
const NO_HEAT = { n: 0, kw: 0, len: 0, heaters: [], short: false };
const UNIT_WORD = { compressor: 'компрессор', dgu: 'ДГУ', pump: 'насос' };

/**
 * Отопление и вентиляция контейнера: теплопотери ограждений и инфильтрации, самый холодный режим работы, конвекторы
 * и их места у стен, летний воздухообмен (VentCalc). Числа — правила файла («Тепло и вентиляция»).
 */
export class StationHeat {
  static get LAMBDA() {
    return rule('heat.lambda');
  }

  static get R_SURF() {
    return rule('heat.rsurf');
  }

  static get BRIDGE() {
    return rule('heat.bridge');
  }

  static get U_DOOR() {
    return rule('heat.u_door');
  }

  static get U_LOUVER() {
    return rule('heat.u_louver');
  }

  static get ACH() {
    return rule('heat.ach');
  }

  static get AIR() {
    return rule('heat.air');
  }

  static get RESERVE() {
    return rule('heat.reserve');
  }

  static get CASE() {
    return rule('heat.case');
  }

  static get REC() {
    return rule('heat.rec');
  }

  static get LOSS() {
    return rule('heat.loss');
  }

  static get COMB() {
    return rule('heat.comb');
  }

  static get SUN() {
    return rule('heat.sun');
  }

  static get UNITS() {
    return rule('heat.conv_units');
  }

  static get CONV() {
    return { h: 400, d: 90, ...StationMatrix.conv() };
  }

  /** Объёмная теплоёмкость воздуха при t, Вт·ч/(м³·°C): зимой воздух плотнее, чем при +20 °C. */
  static airAt(t) {
    const a = rule('air.cp');
    return a && a.c > 0 && a.rhoK > 0 ? (a.c * a.rhoK) / (273 + t) / 3.6 : this.AIR;
  }

  /** Наружная температура для отопления: из требований, иначе heat.t_default, но не холоднее исполнения. */
  static tOut(r, climate) {
    if (Number.isFinite(r.tmin)) return r.tmin;
    const d = StationRules.opt('heat.t_default');
    const def = Number.isFinite(d) ? d : -40;
    const cold = StationNorms.COLD[climate];
    return cold != null ? Math.max(cold, def) : def;
  }

  static key(i) {
    return `${i.id}#${i.unit}`;
  }

  /** Расчёт по расстановке: теплопотери, режим работы, конвекторы, вентиляция летом и зимой. */
  static calc(plan) {
    const sys = plan.sys || {};
    const r = plan.req || {};
    const tout = this.tOut(r, plan.climate);
    const tin = StationNorms.INSIDE;
    const dT = Math.max(0, tin - tout);
    const env = this.envelope(plan, sys, dT);
    const cW = this.airAt(tout);
    const qInf = this.ACH * env.lenHeated * env.wi * env.hi * cW * dT;
    const qStop = env.qEnv + qInf;
    const rec = sys.rec !== false;
    const units = (plan.items || []).filter(
      i => !i.tank && i.mount !== 'wall' && /^(compressor|dgu|pump)$/.test(i.kind) && i.kw > 0,
    );
    const ex = r.vent || {};
    const net = o => o.q - o.a * cW * dT;
    const run = units.map(i => ({ i, q: this.heatOf(i, rec, ex), a: this.airOf(i) }));
    const base = run.length ? run.reduce((a, b) => (net(a) <= net(b) ? a : b)) : null;
    const qRun = base ? qStop - net(base) : null;
    const need = (Math.max(qStop, qRun || 0) * this.RESERVE) / 1000;
    const on = sys.heat !== false;
    const pick = on ? this.pick(plan, need) : { ...NO_HEAT, heaters: [] };
    const vent = this.vent({ plan, sys, r, units, ex, env, base, tout, tin });
    return {
      tout,
      tin,
      dT,
      rec,
      on,
      U: Math.round(env.U * 1000) / 1000,
      A: Math.round(env.A * 10) / 10,
      qEnv: Math.round(env.qEnv),
      qInf: Math.round(qInf),
      qStop: Math.round(qStop),
      base: base ? { pos: base.i.pos, kind: base.i.kind, q: Math.round(base.q), a: Math.round(base.a) } : null,
      qRun: qRun == null ? null : Math.round(qRun),
      need: Math.round(need * 100) / 100,
      n: pick.n,
      kw: pick.kw,
      total: Math.round(pick.n * pick.kw * 10) / 10,
      short: pick.short,
      heaters: pick.heaters,
      vent,
    };
  }

  /** Ограждения отапливаемой части: U по утеплителю, площадь, двери и жалюзи; перегородка к отсеку бака — с ½ перепада. */
  static envelope(plan, sys, dT) {
    const g = plan.geo;
    const [Le, We, He] = g.ext;
    const [Li, Wi, Hi] = plan.int;
    const fuel = plan.fuel;
    const Lt = fuel ? fuel.x1 + fuel.part : 0;
    const kind = this.bridgeKind(g);
    const U = this.BRIDGE[kind] / (this.R_SURF + mm(g.t) / this.LAMBDA);
    const L = mm(Le - Lt);
    const W = mm(We);
    const H = mm(He);
    const A = 2 * (L * W + L * H + W * H) - (fuel ? W * H : 0);
    const Apart = fuel ? mm(Wi) * mm(Hi) : 0;
    const Ad = this.doorArea(plan).reduce((s, v) => s + v, 0);
    const Al = this.louverArea(plan, sys);
    const qEnv = (U * Math.max(0, A - Ad - Al) + this.U_DOOR * Ad + this.U_LOUVER * Al) * dT + (U * Apart * dT) / 2;
    return {
      U,
      A,
      qEnv,
      Le,
      We,
      lenHeated: mm(Li - Lt),
      wi: mm(Wi),
      hi: mm(Hi),
      volume: mm(Li - Lt) * mm(Wi) * mm(Hi),
    };
  }

  static bridgeKind(g) {
    if (g.sea) return 'sea';
    return this.BRIDGE[g.type] ? g.type : 'block';
  }

  /** Площади дверей и ворот, м². */
  static doorArea(plan) {
    const g = plan.geo;
    const area = (w, h) => mm(w) * mm(h);
    const out = [];
    const en = plan.entry;
    if (en && !en.sea) out.push(area(en.w, en.h));
    if (g.sea && g.door) out.push(area(g.door[0], g.door[1]));
    else if (plan.gates) out.push(area(plan.gates.w, plan.gates.h));
    for (const d of plan.doors || []) out.push(area(d.w, d.h));
    if (plan.exit) out.push(area(plan.exit.w, plan.exit.h));
    return out;
  }

  /** Жалюзи с закрытыми клапанами и жалюзи радиаторов ДГУ, м². */
  static louverArea(plan, sys) {
    const LL = rule('heat.louver_leak');
    const dgu = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank);
    const rad = dgu.reduce((s, g) => s + mm(g.rad === 'back' ? g.lx : g.ly) * mm(g.h) * LL.dguK, 0);
    return (sys.vent !== false ? LL.vent : 0) + rad;
  }

  /** Тепло в помещение при работе: компрессор с рециркуляцией — всё его тепло, без неё — корпус. */
  static heatOf(i, rec, ex) {
    if (i.kind === 'compressor' && rec) return (i.heat > 0 ? i.heat : i.kw * VentCalc.k(i.ctype, ex, [])) * 1000;
    return i.kw * 1000 * (this.LOSS[i.kind] || (rec ? this.REC[i.kind] : 0) || this.CASE);
  }

  /** Воздух, забираемый агрегатом из помещения, м³/ч: на сжатие или на горение. */
  static airOf(i) {
    if (i.kind === 'compressor') {
      return i.air && i.air.flow > 0 ? i.air.flow * 60 : i.kw * rule('heat.comp_air') * 60;
    }
    if (i.kind === 'dgu') return i.comb > 0 ? i.comb : i.kw * this.COMB;
    return 0;
  }

  /** Лето и зима (VentCalc): охлаждение компрессоров, помещение, радиатор ДГУ, рекуперация. */
  static vent({ plan, sys, r, units, ex, env, base, tout, tin }) {
    const I = plan.items || [];
    const tmax = Number.isFinite(r.tmax) ? r.tmax : 35;
    const work = this.working(units, Math.max(0, r.res || 0));
    const sun = this.SUN * mm(env.Le) * mm(env.We);
    const dryers = I.filter(i => i.kind === 'dryer').reduce((s, i) => s + (i.kw || 0) * 1000, 0);
    const qSum =
      work.reduce((s, i) => s + i.kw * 1000 * (this.LOSS[i.kind] || this.CASE), 0) +
      this.SUN * 1000 * mm(env.Le) * mm(env.We) +
      dryers;
    const VW = [];
    const vc = {
      units: work
        .filter(i => i.kind === 'compressor')
        .map(i => ({ key: this.key(i), pos: i.pos, type: i.ctype, kw: i.kw, heat: i.heat, cool: i.cool })),
      qRoom: qSum / 1000,
      qSun: sun,
      use: work.reduce((s, i) => s + this.airOf(i), 0),
      V: env.volume,
      tSum: tmax,
      tWin: tout,
      tInMin: tin,
      boost: Boolean(sys.boost),
      exfan: Boolean(sys.exfan),
      ex,
    };
    const S = VentCalc.summer(vc, VW);
    const winter = {
      ...vc,
      env: { U: env.U, A: env.A, qEnv: env.qEnv },
      Qrun: base ? base.q / 1000 : 0,
      useRun: base ? base.a : 0,
    };
    const Wn = VentCalc.winter(winter, S, VW);
    const Rc = VentCalc.recup(Boolean(sys.hrv), Wn, vc, VW);
    return {
      tmax,
      m3h: S.Lgen + S.use,
      use: S.use,
      cool: S.Lcool,
      rad: this.radiators(work),
      sum: S,
      win: Wn,
      rec: Rc,
      warn: VW,
      ex,
    };
  }

  /** Воздух радиаторов ДГУ, м³/ч: по паспорту, иначе по мощности. */
  static radiators(work) {
    const R = rule('heat.dgu_rad');
    const of = i => (i.cool > 0 ? i.cool : (i.kw * 1000 * R.share) / (this.AIR * R.dt));
    return Math.round(work.filter(i => i.kind === 'dgu').reduce((s, i) => s + of(i), 0));
  }

  /** Воздух охлаждения компрессора i, м³/ч — из летнего расчёта. */
  static coolOf(i, plan) {
    const S = plan && plan.heat && plan.heat.vent && plan.heat.vent.sum;
    const u = S && S.units.find(q => q.key === this.key(i));
    if (u) return u.cool;
    return i.cool > 0 ? i.cool : 0;
  }

  /** Рабочие агрегаты: без res самых мощных каждого вида (резерв). */
  static working(units, res) {
    return ['compressor', 'pump', 'dgu'].flatMap(k => {
      const L = units.filter(i => i.kind === k).sort((a, b) => b.kw - a.kw);
      return L.length > res ? L.slice(res) : L.slice(-1);
    });
  }

  /** Число и мощность конвекторов: наименьший избыток, лишний — штраф; мест не хватает — сколько есть. */
  static pick(plan, need) {
    if (!(need > 0)) return { ...NO_HEAT, heaters: [] };
    const spots = new Map();
    const at = len => {
      if (!spots.has(len)) spots.set(len, this.spots(plan, len));
      return spots.get(len);
    };
    const nMin = Math.max(need > 1.2 ? 2 : 1, Math.ceil((plan.int[0] - (plan.geo.x0 || 0)) / 4500));
    const best = this.fitting(at, need, nMin) || this.most(at, need);
    return {
      n: best.n,
      kw: best.kw,
      len: best.len,
      short: best.n * best.kw < need - 1e-9,
      heaters: this.spread(best.S, best.n, plan, best.kw),
    };
  }

  static fitting(at, need, nMin) {
    let best = null;
    for (const [kw, len] of this.UNITS) {
      const S = at(len);
      const n = Math.max(nMin, Math.ceil(need / kw - 1e-9));
      if (n > S.length) continue;
      const score = (n * kw - need) / need + 0.15 * n;
      if (!best || score < best.score) best = { n, kw, len, score, S };
    }
    return best;
  }

  static most(at, need) {
    let best = null;
    for (const [kw, len] of this.UNITS) {
      const S = at(len);
      const n = Math.min(S.length, Math.ceil(need / kw - 1e-9));
      if (!best || n * kw > best.n * best.kw + 1e-9) best = { n, kw, len, S };
    }
    return best;
  }

  /** Отступы конвекторов: у ДГУ — плотнее. */
  static convOf(dgu) {
    if (!dgu) return this.CONV;
    const M = StationMatrix.grp('dgu');
    return { ...this.CONV, gap: M.convGap, edge: M.convEdge, front: M.convFront };
  }

  /** Свободные места конвектора длиной len у пола: участки стен без оборудования, шкафов, дверей и жалюзи. */
  static spots(plan, len) {
    const [L, W] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const items = (plan.items || []).filter(i => !i.tank);
    const dgu = items.some(i => i.kind === 'dgu');
    const C = this.convOf(dgu);
    const B = this.busy({ plan, items, C, dgu });
    const out = [];
    for (const [w, a0, b0] of [
      ['front', x0, L],
      ['back', x0, L],
      ['left', 0, W],
      ['right', 0, W],
    ]) {
      for (const [p, q] of this.freeSpans(B[w], a0, b0, C, dgu ? C.gap : 100))
        out.push(...this.along(w, p, q, len, { C, L, W, x0 }));
    }
    return out.map(o => Object.assign(o, { z: C.z, h: C.h, cx: o.x + o.lx / 2, cy: o.y + o.ly / 2 }));
  }

  /** Свободные участки стены [a0, b0] без занятых (с запасом mg), от углов — C.edge. */
  static freeSpans(busy, a0, b0, C, mg) {
    const blocks = busy.map(([a, b]) => [a - mg, b + mg]).sort((p, q) => p[0] - q[0]);
    const end = b0 - C.edge;
    const out = [];
    let a = a0 + C.edge;
    for (const [p, q] of blocks) {
      if (p > a) out.push([a, Math.min(p, end)]);
      a = Math.max(a, q);
    }
    if (end > a) out.push([a, end]);
    return out;
  }

  /** Места на участке [p, q] стены w — поровну с равными промежутками. */
  static along(w, p, q, len, { C, L, W, x0 }) {
    const k = Math.floor((q - p + C.gap) / (len + C.gap));
    if (k < 1) return [];
    const step = (q - p - k * len) / (k + 1);
    const box = {
      front: u => ({ wall: w, x: u, y: 0, lx: len, ly: C.d }),
      back: u => ({ wall: w, x: u, y: W - C.d, lx: len, ly: C.d }),
      left: u => ({ wall: w, x: x0, y: u, lx: C.d, ly: len }),
      right: u => ({ wall: w, x: L - C.d, y: u, lx: C.d, ly: len }),
    }[w];
    return Array.from({ length: k }, (_, j) =>
      Object.assign(box(Math.round(p + step * (j + 1) + j * len)), { seg: `${w}:${p}`, p, q }),
    );
  }

  /** Занятые участки стен: оборудование у стены, шкафы, двери, ворота, ДГУ, стыки модулей, выхлоп, тамбур. */
  static busy({ plan, items, C, dgu }) {
    const [L, W] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const rule0 = (plan.aisleRule || [1000, 800])[1];
    const aMin = dgu ? Math.min(600, rule0) : rule0;
    const B = { front: [], back: [], left: [], right: [] };
    const floor = items.filter(i => i.mount === 'floor' || i.mount === 'frame');
    for (const i of floor) this.nearWalls(i, B, { C, L, W, x0, aMin });
    for (const i of items.filter(x => x.mount === 'wall' && B[x.wall]))
      B[i.wall].push(this.span(i.wall, i.x, i.lx, i.y, i.ly));
    this.openings(plan, B);
    this.dguWalls(plan, floor, B);
    this.joints(plan, B);
    for (const e of (plan.exhausts || []).filter(x => x.how === 'wall')) B[e.wall].push([e.u - 200, e.u + 200]);
    if (plan.geo.type === 'north' && x0 > 0) B.left.push([W - 1100, W]);
    return B;
  }

  /** Оборудование ближе к стене, чем конвектор и место перед ним, — участок занят. */
  static nearWalls(i, B, { C, L, W, x0, aMin }) {
    const reach = C.d + C.front;
    if (i.y < reach || (i.y < W / 2 && i.y - C.d < aMin)) B.front.push([i.x, i.x + i.lx]);
    if (i.y + i.ly > W - reach) B.back.push([i.x, i.x + i.lx]);
    if (i.x < x0 + reach) B.left.push([i.y, i.y + i.ly]);
    if (i.x + i.lx > L - reach) B.right.push([i.y, i.y + i.ly]);
  }

  static span(wall, x, lx, y, ly) {
    return wall === 'front' || wall === 'back' ? [x, x + lx] : [y, y + ly];
  }

  static openings(plan, B) {
    const en = plan.entry;
    if (en) B[en.wall].push(en.wall === 'front' ? [en.x0, en.x1] : [en.y0, en.y1]);
    for (const G of [plan.gates, plan.gates2].filter(Boolean)) B[G.wall].push([G.y0, G.y1]);
    for (const d of plan.doors || []) B[d.wall === 'back' ? 'back' : 'front'].push([d.x0, d.x1]);
    if (plan.exit) B[plan.exit.wall].push([plan.exit.y0, plan.exit.y1]);
  }

  /** Радиатор каждой ДГУ и её дверь-жалюзи; напротив ДГУ на стене прохода — место приточных жалюзи. */
  static dguWalls(plan, floor, B) {
    for (const g of floor.filter(i => i.kind === 'dgu')) {
      const w = g.rad || 'right';
      const c = g.x + g.lx / 2;
      const r = Math.min(g.lx, 1200) / 2;
      B[w].push(w === 'back' ? [g.x - 200, g.x + g.lx + 200] : [g.y - 200, g.y + g.ly + 200]);
      B.front.push([c - r, c + r]);
    }
    for (const d of plan.dguDoors || []) B[d.wall].push(d.wall === 'back' ? [d.x0, d.x1] : [d.y0, d.y1]);
  }

  static joints(plan, B) {
    const J = StationMods.lines(plan.geo);
    for (const x of J.x) {
      B.front.push([x - 150, x + 150]);
      B.back.push([x - 150, x + 150]);
    }
    for (const y of J.y) {
      B.left.push([y - 150, y + 150]);
      B.right.push([y - 150, y + 150]);
    }
  }

  /** Точка входа: от неё — первый конвектор (холодный воздух). */
  static entryPoint(plan) {
    const x0 = plan.geo.x0 || 0;
    const W = plan.int[1];
    const en = plan.entry;
    const D = (plan.doors || [])[0];
    if (en) return en.wall === 'front' ? [(en.x0 + en.x1) / 2, 0] : [x0, (en.y0 + en.y1) / 2];
    if (D) return [(D.x0 + D.x1) / 2, D.wall === 'back' ? W : 0];
    return [x0, W / 2];
  }

  /** n мест: первое — ближе ко входу, следующие — дальше всего от уже выбранных; на одном участке — равный шаг. */
  static spread(spots, n, plan, kw) {
    if (!n || !spots.length) return [];
    const dgu = (plan.items || []).some(i => i.kind === 'dgu');
    const awayFromInlet = spots.filter(s => s.wall !== 'left');
    const S = dgu && !plan.fuel && awayFromInlet.length >= n ? awayFromInlet : spots;
    const [ex, ey] = this.entryPoint(plan);
    const d = s => Math.hypot(s.cx - ex, s.cy - ey);
    const got = [S.reduce((a, b) => (d(a) <= d(b) ? a : b))];
    while (got.length < n) {
      const next = this.farthest(S, got);
      if (!next) break;
      got.push(next);
    }
    const H = got.map(s => ({
      kind: 'heater',
      wall: s.wall,
      x: s.x,
      y: s.y,
      z: s.z,
      lx: s.lx,
      ly: s.ly,
      h: s.h,
      kw,
      seg: s.seg,
      p: s.p,
      q: s.q,
    }));
    if (StationTidy.M.lines && !dgu) this.evenOut(H);
    for (const h of H) {
      delete h.seg;
      delete h.p;
      delete h.q;
    }
    return H;
  }

  static farthest(S, got) {
    let best = null;
    let bd = -1;
    for (const s of S.filter(x => !got.includes(x))) {
      const q = Math.min(...got.map(t => Math.hypot(s.cx - t.cx, s.cy - t.cy)));
      if (q > bd) {
        bd = q;
        best = s;
      }
    }
    return best;
  }

  /** Несколько конвекторов на одном свободном участке стены — с равным шагом по всему участку. */
  static evenOut(H) {
    for (const seg of new Set(H.map(h => h.seg))) {
      const G = H.filter(h => h.seg === seg);
      if (G.length < 2 || !G[0].seg) continue;
      const along = G[0].wall === 'front' || G[0].wall === 'back';
      const len = along ? G[0].lx : G[0].ly;
      const k = G.length;
      const st = (G[0].q - G[0].p - k * len) / (k + 1);
      G.sort((a, b) => (along ? a.x - b.x : a.y - b.y));
      G.forEach((h, j) => {
        const u = Math.round(G[0].p + st * (j + 1) + j * len);
        if (along) h.x = u;
        else h.y = u;
      });
    }
  }

  static kw(v) {
    return String(Math.round(v * 10) / 10).replace('.', ',');
  }

  /** Сведения для окна «Компоновка» и требований. */
  static notes(plan) {
    const h = plan.heat;
    if (!h) return;
    if (h.on) this.heatNotes(plan, h);
    StationVent.notes(plan);
  }

  static heatNotes(plan, h) {
    const iss = plan.issues;
    const k = v => this.kw(v / 1000);
    const t = StationNorms.deg(h.tout);
    if (!Number.isFinite((plan.req || {}).tmin)) {
      iss.push({
        level: 'info',
        text: `Отопление посчитано до ${t} снаружи: зимней температуры в требованиях нет — уточните у заказчика и впишите в требованиях станции «Наружный воздух от, °C».`,
      });
    }
    iss.push({
      level: 'info',
      text: `Отопление: теплопотери при ${t} снаружи — ${k(h.qStop)} кВт (ограждения ${k(h.qEnv)}, воздух ${k(h.qInf)}; внутри +${h.tin} °C).${this.runNote(h)} Конвекторы: ${h.n} × ${this.kw(h.kw)} кВт = ${this.kw(h.total)} кВт (запас 10 %) — у стен, места на чертеже и 3D-виде.`,
    });
    if (h.short) {
      iss.push({
        level: 'warn',
        text: `Отопление: нужно ${this.kw(h.need)} кВт, а свободных мест на стенах — для ${this.kw(h.total)} кВт: добавьте мощность иначе (тепловентилятор, обогрев пола) или освободите стену.`,
      });
    }
    if (!h.rec && h.qRun > h.qStop) {
      iss.push({
        level: 'info',
        text: 'Без рециркуляции тёплого воздуха при работе отопление больше: подогрев воздуха на сжатие или горение. С рекуперацией (заслонка с термостатом на выбросе тёплого воздуха) — тепло оборудования остаётся в помещении.',
      });
    }
  }

  /** Что даёт работающий агрегат: покрывает потери или конвекторы нужны и при работе. */
  static runNote(h) {
    if (!h.base) return '';
    const k = v => this.kw(v / 1000);
    if (h.qRun > 0) {
      return ` При работе поз. ${h.base.pos}: ${k(h.base.q)} кВт тепла, подогрев забираемого воздуха ${k(h.base.a * this.AIR * h.dT)} кВт — конвекторы нужны и при работе (${k(h.qRun)} кВт).`;
    }
    const rec = h.rec && h.base.kind !== 'pump' ? ' (рециркуляция тёплого воздуха — рекуперация)' : '';
    return ` При работе ${UNIT_WORD[h.base.kind] || 'агрегат'} поз. ${h.base.pos} даёт ${k(h.base.q)} кВт тепла${rec} — потери покрыты, конвекторы отключаются терморегуляторами.`;
  }
}
