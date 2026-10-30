import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationTidy } from './station-tidy.js';
import { SummerTemp } from './summer-temp.js';
import { VentCalc } from './vent-calc.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Отопление и вентиляция контейнера: теплопотери ограждений и инфильтрации, самый холодный режим работы, конвекторы
 * и их места у стен, летний воздухообмен (VentCalc). Числа — правила файла («Тепло и вентиляция»).
 */
export class StationHeat {
  static _rule = name => StationRules.raw(name);

  static NO_HEAT = { n: 0, kw: 0, len: 0, heaters: [], short: false };
  static SEC_PER_H = 3600;

  static UNIT_WORD = { compressor: 'компрессор', dgu: 'ДГУ', pump: 'насос' };

  static get _LAMBDA() {
    return StationHeat._rule('heat.lambda');
  }

  static get _R_SURF() {
    return StationHeat._rule('heat.rsurf');
  }

  static get _BRIDGE() {
    return StationHeat._rule('heat.bridge');
  }

  static get _U_DOOR() {
    return StationHeat._rule('heat.u_door');
  }

  static get _U_LOUVER() {
    return StationHeat._rule('heat.u_louver');
  }

  static get _ACH() {
    return StationHeat._rule('heat.ach');
  }

  /** Температура воздуха для расчёта отопления. */
  static get AIR() {
    return StationHeat._rule('heat.air');
  }

  /** Запас мощности отопления. */
  static get RESERVE() {
    return StationHeat._rule('heat.reserve');
  }

  static get _CASE() {
    return StationHeat._rule('heat.case');
  }

  static get _REC() {
    return StationHeat._rule('heat.rec');
  }

  /** Теплопотери ограждений. */
  static get LOSS() {
    return StationHeat._rule('heat.loss');
  }

  static get _COMB() {
    return StationHeat._rule('heat.comb');
  }

  /** Теплопоступления от солнца. */
  static get SUN() {
    return StationHeat._rule('heat.sun');
  }

  /** Мощности конвекторов. */
  static get UNITS() {
    return StationHeat._rule('heat.conv_units');
  }

  /** Размеры и места конвектора (раздел conv матрицы). */
  static get CONV() {
    return StationMatrix.conv();
  }

  /** Объёмная теплоёмкость воздуха при t, Вт·ч/(м³·°C): зимой воздух плотнее, чем при +20 °C. */
  static airAt(temp) {
    const air = StationHeat._rule('air.cp');
    return air && air.c > 0 && air.rhoK > 0 ? (air.c * air.rhoK) / (273 + temp) / 3.6 : this.AIR;
  }

  /**
   * Запас мощности отопления в процентах (heat.reserve): «10».
   * @returns {number}
   */
  static reservePct() {
    return Math.round((this.RESERVE - 1) * 100);
  }

  /** Наружная температура для отопления: из требований, иначе heat.t_default, но не холоднее исполнения. */
  static tOut(req, climate) {
    if (Number.isFinite(req.tmin)) return req.tmin;
    const fallback = StationRules.opt('heat.t_default');
    const def = Number.isFinite(fallback) ? fallback : -40;
    const cold = StationNorms.COLD[climate];
    return cold != null ? Math.max(cold, def) : def;
  }

  /** Ключ агрегата: код позиции и номер экземпляра. */
  static key(i) {
    return `${i.id}#${i.unit}`;
  }

  /** Расчёт по расстановке: теплопотери, режим работы, конвекторы, вентиляция летом и зимой. */
  static calc(plan) {
    const sys = plan.sys || {};
    const req = plan.req || {};
    const tout = this.tOut(req, plan.climate);
    const tin = StationNorms.INSIDE;
    const deltaT = Math.max(0, tin - tout);
    const units = (plan.items || []).filter(
      i => !i.tank && i.mount !== 'wall' && /^(compressor|dgu|pump)$/.test(i.kind) && i.kw > 0,
    );
    const exhaust = req.vent || {};
    // сначала лето: площадь жалюзи по рамке нужна теплопотерям ограждений
    const summer = this.summer({ plan, sys, r: req, units, ex: exhaust, room: this.room(plan), tout, tin });
    const env = this.envelope(plan, sys, deltaT, summer);
    const airCap = this.airAt(tout);
    const qInf = this._ACH * env.lenHeated * env.wi * env.hi * airCap * deltaT;
    const qStop = env.qEnv + qInf;
    const rec = sys.rec !== false;
    // при работе — воздухообмен зимней вентиляции (VentCalc.winter), не меньше инфильтрации
    const roomAir = Math.max(this._rule('vent.ach').winter, this._ACH) * env.volume;
    const runNeed = opt => env.qEnv + Math.max(roomAir, opt.a) * airCap * deltaT - opt.q;
    const run = units.map(i => ({ i, q: this.heatOf(i, rec, exhaust), a: this.airOf(i) }));
    const base = run.length
      ? run.reduce((first, second) => (runNeed(first) >= runNeed(second) ? first : second))
      : null;
    const qRun = base ? runNeed(base) : null;
    const need = (Math.max(qStop, qRun || 0) * this.RESERVE) / 1000;
    const isOn = sys.heat !== false;
    const pick = isOn ? this.pick(plan, need) : { ...StationHeat.NO_HEAT, heaters: [] };
    const vent = this.vent({ summer, sys, env, base, ex: exhaust });
    return {
      tout,
      tin,
      dT: deltaT,
      rec,
      on: isOn,
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

  /** Помещение: наружные длина и ширина; отапливаемая часть (без отсека бака) и её объём, м. */
  static room(plan) {
    const [Le, We] = plan.geo.ext;
    const [Li, Wi, Hi] = plan.int;
    const fuel = plan.fuel;
    const tankLen = fuel ? fuel.x1 + fuel.part : 0;
    const lenHeated = Mm.meters(Li - tankLen);
    const width = Mm.meters(Wi);
    const height = Mm.meters(Hi);
    return { Le, We, tankLen, lenHeated, wi: width, hi: height, volume: lenHeated * width * height };
  }

  /**
   * Ограждения отапливаемой части: U по утеплителю, площадь, двери и жалюзи (по рамке из летнего расчёта summer — {sum, work});
   * перегородка к отсеку бака — с ½ перепада.
   */
  static envelope(plan, sys, deltaT, summer) {
    const geo = plan.geo;
    const room = this.room(plan);
    const fuel = plan.fuel;
    const kind = this._bridgeKind(geo);
    const uWall = this.uWall(geo.t, kind);
    const len = Mm.meters(room.Le - room.tankLen);
    const wid = Mm.meters(room.We);
    const height = Mm.meters(geo.ext[2]);
    const area = 2 * (len * wid + len * height + wid * height) - (fuel ? wid * height : 0);
    const Apart = fuel ? room.wi * room.hi : 0;
    const doorArea = this.doorArea(plan).reduce((acc, v) => acc + v, 0);
    const louverArea = this.louverArea(plan, sys, summer);
    const qEnv =
      (uWall * Math.max(0, area - doorArea - louverArea) + this._U_DOOR * doorArea + this._U_LOUVER * louverArea) *
        deltaT +
      (uWall * Apart * deltaT) / 2;
    return { U: uWall, A: area, qEnv, ...room };
  }

  /**
   * U ограждения, Вт/(м²·°C): по утеплителю thick мм; без утепления — U неутеплённого контейнера (vent.winter.uBare).
   * @param {number} thick мм
   * @param {string} kind вид поправки на каркас (heat.bridge)
   * @returns {number}
   */
  static uWall(thick, kind) {
    if (!(thick > 0)) return StationHeat._rule('vent.winter').uBare;
    return this._BRIDGE[kind] / (this._R_SURF + Mm.meters(thick) / this._LAMBDA);
  }

  static _bridgeKind(geo) {
    if (geo.sea) return 'sea';
    return this._BRIDGE[geo.type] ? geo.type : 'block';
  }

  /** Площади дверей и ворот, м². */
  static doorArea(plan) {
    const geo = plan.geo;
    const area = (width, height) => Mm.meters(width) * Mm.meters(height);
    const out = [];
    const entry = plan.entry;
    if (entry && !entry.sea) out.push(area(entry.w, entry.h));
    if (geo.sea && geo.door) out.push(area(geo.door[0], geo.door[1]));
    else if (plan.gates) out.push(area(plan.gates.w, plan.gates.h));
    for (const door of plan.doors || []) out.push(area(door.w, door.h));
    if (plan.exit) out.push(area(plan.exit.w, plan.exit.h));
    return out;
  }

  /**
   * Жалюзи с закрытыми клапанами, м²: приток и выброс по рамке из летнего расчёта summer ({sum, work}) — у ДГУ приток на
   * воздух радиаторов, как на плане вентиляции, — не меньше heat.louver_leak.vent; плюс жалюзи радиаторов ДГУ.
   */
  static louverArea(plan, sys, summer) {
    const leak = StationHeat._rule('heat.louver_leak');
    const dgu = (plan.items || []).filter(i => i.kind === 'dgu' && !i.tank);
    const rad = dgu.reduce(
      (acc, unit) => acc + Mm.meters(unit.rad === 'back' ? unit.lx : unit.ly) * Mm.meters(unit.h) * leak.dguK,
      0,
    );
    if (sys.vent === false && !dgu.length) return rad;
    const frame = dgu.length ? this._dguFrame(summer) : this._frame(summer);
    return Math.max(leak.vent, frame) + rad;
  }

  // проёмы по рамке из летнего расчёта: приток и выброс
  static _frame(summer) {
    const sum = summer && summer.sum;
    return sum ? (sum.Sin || 0) + (sum.Sout || 0) : 0;
  }

  // у ДГУ — как на плане вентиляции (VentPlan): один приток на радиаторы, помещение, горение и охлаждение компрессоров;
  // выброс помещения — через радиаторы, свой — только у охлаждения компрессоров
  static _dguFrame(summer) {
    const sum = summer && summer.sum;
    if (!sum) return 0;
    const flow = Math.max(this.radiators(summer.work || [], summer.tmax), sum.Lgen) + sum.use + sum.Lcool;
    return (flow / this.SEC_PER_H / sum.vIn) * sum.res + sum.Lcool / this.SEC_PER_H / sum.vOut;
  }

  /** Тепло в помещение при работе: компрессор с рециркуляцией — всё его тепло, без неё — корпус. */
  static heatOf(i, rec, exhaust) {
    if (i.kind === 'compressor' && rec)
      return (i.heat > 0 ? i.heat : i.kw * VentCalc.heatK(i.ctype, exhaust, [])) * 1000;
    return i.kw * 1000 * (this.LOSS[i.kind] || (rec ? this._REC[i.kind] : 0) || this._CASE);
  }

  /** Воздух, забираемый агрегатом из помещения, м³/ч: на сжатие или на горение. */
  static airOf(i) {
    if (i.kind === 'compressor') {
      return i.air && i.air.flow > 0 ? i.air.flow * 60 : i.kw * StationHeat._rule('heat.comp_air') * 60;
    }
    if (i.kind === 'dgu') return i.comb > 0 ? i.comb : i.kw * this._COMB;
    return 0;
  }

  /** Лето (VentCalc.summer): охлаждение компрессоров, помещение, расход и проёмы по рамке. */
  static summer({ plan, sys, r: req, units, ex: exhaust, room, tout, tin }) {
    const items = plan.items || [];
    const tmax = SummerTemp.of(req.tmax);
    const work = this.working(units, Math.max(0, req.res || 0));
    const sun = this.SUN * Mm.meters(room.Le) * Mm.meters(room.We);
    const dryers = items.filter(i => i.kind === 'dryer').reduce((acc, i) => acc + (i.kw || 0) * 1000, 0);
    const qSum =
      work.reduce((acc, i) => acc + i.kw * 1000 * (this.LOSS[i.kind] || this._CASE), 0) +
      this.SUN * 1000 * Mm.meters(room.Le) * Mm.meters(room.We) +
      dryers;
    const warn = [];
    const input = {
      units: work
        .filter(i => i.kind === 'compressor')
        .map(i => ({ key: this.key(i), pos: i.pos, type: i.ctype, kw: i.kw, heat: i.heat, cool: i.cool })),
      qRoom: qSum / 1000,
      qSun: sun,
      use: work.reduce((acc, i) => acc + this.airOf(i), 0),
      V: room.volume,
      tSum: tmax,
      tWin: tout,
      tInMin: tin,
      boost: Boolean(sys.boost),
      exfan: Boolean(sys.exfan),
      ex: exhaust,
    };
    return { tmax, work, input, warn, sum: VentCalc.summer(input, warn) };
  }

  /** Лето и зима (VentCalc): зима и рекуперация — по летнему режиму summer и ограждениям env; радиатор ДГУ. */
  static vent({ summer, sys, env, base, ex: exhaust }) {
    const { input, warn, sum } = summer;
    const winter = {
      ...input,
      env: { U: env.U, A: env.A, qEnv: env.qEnv },
      Qrun: base ? base.q / 1000 : 0,
      useRun: base ? base.a : 0,
    };
    const winterRes = VentCalc.winter(winter, sum, warn);
    const recup = VentCalc.recup(Boolean(sys.hrv), winterRes, input, warn);
    return {
      tmax: summer.tmax,
      m3h: sum.Lgen + sum.use,
      use: sum.use,
      cool: sum.Lcool,
      rad: this.radiators(summer.work, summer.tmax),
      sum,
      win: winterRes,
      rec: recup,
      warn,
      ex: exhaust,
    };
  }

  /** Воздух радиаторов ДГУ, м³/ч: по паспорту, иначе по мощности при летней температуре tmax. */
  static radiators(work, tmax) {
    return Math.round(work.filter(i => i.kind === 'dgu').reduce((acc, i) => acc + this.radiatorAir(i, tmax), 0));
  }

  /**
   * Воздух радиатора ДГУ i, м³/ч: по паспорту, иначе доля мощности в радиатор при нагреве heat.dgu_rad.dt и tmax.
   * @param {object} i агрегат плана
   * @param {number} tmax летняя температура, °C
   * @returns {number}
   */
  static radiatorAir(i, tmax) {
    if (i.cool > 0) return i.cool;
    const rule = StationHeat._rule('heat.dgu_rad');
    return (i.kw * 1000 * rule.share) / (this.airAt(SummerTemp.of(tmax)) * rule.dt);
  }

  /** Воздух охлаждения компрессора i, м³/ч — из летнего расчёта. */
  static coolOf(i, plan) {
    const summary = plan && plan.heat && plan.heat.vent && plan.heat.vent.sum;
    const u = summary && summary.units.find(unit => unit.key === this.key(i));
    if (u) return u.cool;
    return i.cool > 0 ? i.cool : 0;
  }

  /**
   * Рабочие агрегаты летом: резерв — res агрегатов каждого вида; тепло и воздух — в запас, по самым мощным из
   * работающих (их число — без резерва).
   */
  static working(units, res) {
    return ['compressor', 'pump', 'dgu'].flatMap(k => {
      const list = units.filter(i => i.kind === k).sort((first, second) => second.kw - first.kw);
      return list.slice(0, Math.max(1, list.length - res));
    });
  }

  /** Число и мощность конвекторов: наименьший избыток, лишний — штраф; мест не хватает — сколько есть. */
  static pick(plan, need) {
    if (!(need > 0)) return { ...StationHeat.NO_HEAT, heaters: [] };
    const spots = new Map();
    const spotsAt = len => {
      if (!spots.has(len)) spots.set(len, this.spots(plan, len));
      return spots.get(len);
    };
    const nMin = Math.max(need > 1.2 ? 2 : 1, Math.ceil((plan.int[0] - (plan.geo.x0 || 0)) / 4500));
    const best = this._fitting(spotsAt, need, nMin) || this._most(spotsAt, need);
    return {
      n: best.n,
      kw: best.kw,
      len: best.len,
      short: best.n * best.kw < need - 1e-9,
      heaters: this.spread(best.S, best.n, plan, best.kw),
    };
  }

  static _fitting(spotsAt, need, nMin) {
    let best = null;
    for (const [kw, len] of this.UNITS) {
      const spots = spotsAt(len);
      const count = Math.max(nMin, Math.ceil(need / kw - 1e-9));
      if (count > spots.length) continue;
      const score = (count * kw - need) / need + 0.15 * count;
      if (!best || score < best.score) best = { n: count, kw, len, score, S: spots };
    }
    return best;
  }

  static _most(spotsAt, need) {
    let best = null;
    for (const [kw, len] of this.UNITS) {
      const spots = spotsAt(len);
      const count = Math.min(spots.length, Math.ceil(need / kw - 1e-9));
      if (!best || count * kw > best.n * best.kw + 1e-9) best = { n: count, kw, len, S: spots };
    }
    return best;
  }

  /** Отступы конвекторов: у ДГУ — плотнее. */
  static convOf(dgu) {
    if (!dgu) return this.CONV;
    const dguRule = StationMatrix.grp('dgu');
    return { ...this.CONV, gap: dguRule.convGap, edge: dguRule.convEdge, front: dguRule.convFront };
  }

  /** Свободные места конвектора длиной len у пола: участки стен без оборудования, шкафов, дверей и жалюзи. */
  static spots(plan, len) {
    const [lenIn, wid] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const items = (plan.items || []).filter(i => !i.tank);
    const dgu = items.some(i => i.kind === 'dgu');
    const conv = this.convOf(dgu);
    const busy = this.busy({ plan, items, C: conv, dgu });
    const out = [];
    for (const [wall, from, till] of [
      ['front', x0, lenIn],
      ['back', x0, lenIn],
      ['left', 0, wid],
      ['right', 0, wid],
    ]) {
      for (const [spanFrom, spanTill] of this.freeSpans(busy[wall], from, till, conv, dgu ? conv.gap : 100))
        out.push(...this.along(wall, spanFrom, spanTill, len, { C: conv, L: lenIn, W: wid, x0 }));
    }
    return out.map(spot =>
      Object.assign(spot, { z: conv.z, h: conv.h, cx: spot.x + spot.lx / 2, cy: spot.y + spot.ly / 2 }),
    );
  }

  /** Свободные участки стены [a0, b0] без занятых (с запасом mg), от углов — C.edge. */
  static freeSpans(busy, from0, till0, conv, margin) {
    const blocks = busy.map(([low, high]) => [low - margin, high + margin]).sort((left, right) => left[0] - right[0]);
    const end = till0 - conv.edge;
    const out = [];
    let cursor = from0 + conv.edge;
    for (const [from, till] of blocks) {
      if (from > cursor) out.push([cursor, Math.min(from, end)]);
      cursor = Math.max(cursor, till);
    }
    if (end > cursor) out.push([cursor, end]);
    return out;
  }

  /** Места на участке [p, q] стены w — поровну с равными промежутками. */
  static along(wall, from, till, len, { C: conv, L: lenIn, W: wid, x0 }) {
    const k = Math.floor((till - from + conv.gap) / (len + conv.gap));
    if (k < 1) return [];
    const step = (till - from - k * len) / (k + 1);
    const box = {
      front: u => ({ wall, x: u, y: 0, lx: len, ly: conv.d }),
      back: u => ({ wall, x: u, y: wid - conv.d, lx: len, ly: conv.d }),
      left: u => ({ wall, x: x0, y: u, lx: conv.d, ly: len }),
      right: u => ({ wall, x: lenIn - conv.d, y: u, lx: conv.d, ly: len }),
    }[wall];
    return Array.from({ length: k }, (_, j) =>
      Object.assign(box(Math.round(from + step * (j + 1) + j * len)), { seg: `${wall}:${from}`, p: from, q: till }),
    );
  }

  /** Занятые участки стен: оборудование у стены, шкафы, двери, ворота, ДГУ, стыки модулей, выхлоп, тамбур. */
  static busy({ plan, items, C: conv, dgu }) {
    const [len, wid] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const rule0 = (plan.aisleRule || [1000, 800])[1];
    const aMin = dgu ? Math.min(600, rule0) : rule0;
    const busy = { front: [], back: [], left: [], right: [] };
    const floor = items.filter(i => i.mount === 'floor' || i.mount === 'frame');
    for (const i of floor) this.nearWalls(i, busy, { C: conv, L: len, W: wid, x0, aMin });
    for (const i of items.filter(x => x.mount === 'wall' && busy[x.wall]))
      busy[i.wall].push(this.span(i.wall, i.x, i.lx, i.y, i.ly));
    this.openings(plan, busy);
    this.dguWalls(plan, floor, busy);
    this.joints(plan, busy);
    for (const exh of (plan.exhausts || []).filter(x => x.how === 'wall'))
      busy[exh.wall].push([exh.u - 200, exh.u + 200]);
    if (plan.geo.type === 'north' && x0 > 0) busy.left.push([wid - 1100, wid]);
    return busy;
  }

  /** Оборудование ближе к стене, чем конвектор и место перед ним, — участок занят. */
  static nearWalls(i, busy, { C: conv, L: len, W: wid, x0, aMin }) {
    const reach = conv.d + conv.front;
    if (i.y < reach || (i.y < wid / 2 && i.y - conv.d < aMin)) busy.front.push([i.x, i.x + i.lx]);
    if (i.y + i.ly > wid - reach) busy.back.push([i.x, i.x + i.lx]);
    if (i.x < x0 + reach) busy.left.push([i.y, i.y + i.ly]);
    if (i.x + i.lx > len - reach) busy.right.push([i.y, i.y + i.ly]);
  }

  /** Полоса агрегата вдоль стены. */
  static span(wall, x, lenX, y, lenY) {
    return wall === 'front' || wall === 'back' ? [x, x + lenX] : [y, y + lenY];
  }

  /** Отмечает проёмы на стенах занятыми. */
  static openings(plan, busy) {
    const entry = plan.entry;
    if (entry) busy[entry.wall].push(entry.wall === 'front' ? [entry.x0, entry.x1] : [entry.y0, entry.y1]);
    for (const gate of [plan.gates, plan.gates2].filter(Boolean)) busy[gate.wall].push([gate.y0, gate.y1]);
    for (const door of plan.doors || []) busy[door.wall === 'back' ? 'back' : 'front'].push([door.x0, door.x1]);
    if (plan.exit) busy[plan.exit.wall].push([plan.exit.y0, plan.exit.y1]);
  }

  /** Радиатор каждой ДГУ и её дверь-жалюзи; напротив ДГУ на стене прохода — место приточных жалюзи. */
  static dguWalls(plan, floor, busy) {
    for (const dgu of floor.filter(i => i.kind === 'dgu')) {
      const wall = dgu.rad || 'right';
      const mid = dgu.x + dgu.lx / 2;
      const half = Math.min(dgu.lx, 1200) / 2;
      busy[wall].push(wall === 'back' ? [dgu.x - 200, dgu.x + dgu.lx + 200] : [dgu.y - 200, dgu.y + dgu.ly + 200]);
      busy.front.push([mid - half, mid + half]);
    }
    for (const door of plan.dguDoors || [])
      busy[door.wall].push(door.wall === 'back' ? [door.x0, door.x1] : [door.y0, door.y1]);
  }

  /** Отмечает стыки модулей занятыми. */
  static joints(plan, busy) {
    const joints = StationMods.lines(plan.geo);
    for (const x of joints.x) {
      busy.front.push([x - 150, x + 150]);
      busy.back.push([x - 150, x + 150]);
    }
    for (const y of joints.y) {
      busy.left.push([y - 150, y + 150]);
      busy.right.push([y - 150, y + 150]);
    }
  }

  /** Точка входа: от неё — первый конвектор (холодный воздух). */
  static entryPoint(plan) {
    const x0 = plan.geo.x0 || 0;
    const wid = plan.int[1];
    const entry = plan.entry;
    const door = (plan.doors || [])[0];
    if (entry) return entry.wall === 'front' ? [(entry.x0 + entry.x1) / 2, 0] : [x0, (entry.y0 + entry.y1) / 2];
    if (door) return [(door.x0 + door.x1) / 2, door.wall === 'back' ? wid : 0];
    return [x0, wid / 2];
  }

  /** n мест: первое — ближе ко входу, следующие — дальше всего от уже выбранных; на одном участке — равный шаг. */
  static spread(spots, count, plan, kw) {
    if (!count || !spots.length) return [];
    const dgu = (plan.items || []).some(i => i.kind === 'dgu');
    const awayFromInlet = spots.filter(spot => spot.wall !== 'left');
    const pool = dgu && !plan.fuel && awayFromInlet.length >= count ? awayFromInlet : spots;
    const [entryX, entryY] = this.entryPoint(plan);
    const dist = spot => Math.hypot(spot.cx - entryX, spot.cy - entryY);
    const got = [pool.reduce((first, second) => (dist(first) <= dist(second) ? first : second))];
    while (got.length < count) {
      const next = this._farthest(pool, got);
      if (!next) break;
      got.push(next);
    }
    const heaters = got.map(spot => ({
      kind: 'heater',
      wall: spot.wall,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      lx: spot.lx,
      ly: spot.ly,
      h: spot.h,
      kw,
      seg: spot.seg,
      p: spot.p,
      q: spot.q,
    }));
    if (StationTidy.RULES.lines && !dgu) this.evenOut(heaters);
    for (const heater of heaters) {
      delete heater.seg;
      delete heater.p;
      delete heater.q;
    }
    return heaters;
  }

  static _farthest(pool, got) {
    let best = null;
    let bestD = -1;
    for (const spot of pool.filter(x => !got.includes(x))) {
      const dist = Math.min(...got.map(taken => Math.hypot(spot.cx - taken.cx, spot.cy - taken.cy)));
      if (dist > bestD) {
        bestD = dist;
        best = spot;
      }
    }
    return best;
  }

  /** Несколько конвекторов на одном свободном участке стены — с равным шагом по всему участку. */
  static evenOut(heaters) {
    for (const seg of new Set(heaters.map(heater => heater.seg))) {
      const group = heaters.filter(heater => heater.seg === seg);
      if (group.length < 2 || !group[0].seg) continue;
      const along = group[0].wall === 'front' || group[0].wall === 'back';
      const len = along ? group[0].lx : group[0].ly;
      const k = group.length;
      const gapU = (group[0].q - group[0].p - k * len) / (k + 1);
      group.sort((first, second) => (along ? first.x - second.x : first.y - second.y));
      group.forEach((heater, j) => {
        const u = Math.round(group[0].p + gapU * (j + 1) + j * len);
        if (along) heater.x = u;
        else heater.y = u;
      });
    }
  }

  /** Мощность для текста: «1,5». */
  static kw(v) {
    return String(Math.round(v * 10) / 10).replace('.', ',');
  }

  /** Сведения для окна «Компоновка» и требований. */
  static notes(plan) {
    const heat = plan.heat;
    if (!heat) return;
    if (heat.on) this._heatNotes(plan, heat);
  }

  static _heatNotes(plan, heat) {
    const iss = plan.issues;
    const k = v => this.kw(v / 1000);
    const tempText = StationNorms.deg(heat.tout);
    if (!Number.isFinite((plan.req || {}).tmin)) {
      iss.push({
        level: 'info',
        text: `Отопление посчитано до ${tempText} снаружи: зимней температуры в требованиях нет — уточните у заказчика и впишите в требованиях станции «Наружный воздух от, °C».`,
      });
    }
    iss.push({
      level: 'info',
      text: `Отопление: теплопотери при ${tempText} снаружи — ${k(heat.qStop)} кВт (ограждения ${k(heat.qEnv)}, воздух ${k(heat.qInf)}; внутри +${heat.tin} °C).${this.runNote(heat)} Конвекторы: ${heat.n} × ${this.kw(heat.kw)} кВт = ${this.kw(heat.total)} кВт (запас ${this.reservePct()} %) — у стен, места на чертеже и 3D-виде.`,
    });
    if (heat.short) {
      iss.push({
        level: 'warn',
        text: `Отопление: нужно ${this.kw(heat.need)} кВт, а свободных мест на стенах — для ${this.kw(heat.total)} кВт: добавьте мощность иначе (тепловентилятор, обогрев пола) или освободите стену.`,
      });
    }
    if (!heat.rec && heat.qRun > heat.qStop) {
      iss.push({
        level: 'info',
        text: 'Без рециркуляции тёплого воздуха при работе отопление больше: подогрев воздуха на сжатие или горение. С рекуперацией (заслонка с термостатом на выбросе тёплого воздуха) — тепло оборудования остаётся в помещении.',
      });
    }
  }

  /** Что даёт работающий агрегат: покрывает потери или конвекторы нужны и при работе. */
  static runNote(heat) {
    if (!heat.base) return '';
    const k = v => this.kw(v / 1000);
    if (heat.qRun > 0) {
      const air = heat.qRun + heat.base.q - heat.qEnv;
      return ` При работе поз. ${heat.base.pos}: ${k(heat.base.q)} кВт тепла, подогрев приточного воздуха ${k(air)} кВт — конвекторы нужны и при работе (${k(heat.qRun)} кВт).`;
    }
    const rec = heat.rec && heat.base.kind !== 'pump' ? ' (рециркуляция тёплого воздуха — рекуперация)' : '';
    return ` При работе ${StationHeat.UNIT_WORD[heat.base.kind] || 'агрегат'} поз. ${heat.base.pos} даёт ${k(heat.base.q)} кВт тепла${rec} — потери покрыты, конвекторы отключаются терморегуляторами.`;
  }
}
