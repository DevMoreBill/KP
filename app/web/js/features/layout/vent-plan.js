import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationTidy } from './station-tidy.js';
import { StWalls } from './st-walls.js';
import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { VentIntake } from './vent-intake.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Места жалюзи по расчёту (решения ПНЕВМОТЕХ). Приток и выброс — никогда на одной стене. Выброс компрессоров: над их
 * сервисными воротами → вверху стены над компрессором → торец у компрессора без ворот → иначе все через крышу каналами
 * одного размера; решётки у всех компрессоров одинаковые. Общая вытяжка — у осушителя, своего размера. Приток — на стене
 * напротив выброса одним проёмом (иначе одинаковыми), в створках ворот и сервисных дверей, на свободных стенах; у ДГУ —
 * напротив каждой, одинаковый. Не встал — приточные вентиляторы, затем нехватка.
 */
export class VentPlan {
  static _key = item => `${item.id}#${item.unit}`;

  static _round2 = x => Math.round(x * 100) / 100;

  static _floorDgu = items => items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');

  constructor(plan, front, roof) {
    this.plan = plan;
    this.front = front;
    this.roofOnly = roof;
  }

  /** Проекция центра тяжести на стену w (знак № 12): {u, z} или null. */
  static cog(plan, wall) {
    const mass = plan.mass;
    const geo = plan.geo;
    if (!mass || !geo || !geo.ext) return null;
    const center = mass.cg;
    const [Le, We] = geo.ext;
    const [Li, Wi] = plan.int;
    return {
      u: wall === 'left' || wall === 'right' ? center.y - (We - Wi) / 2 : center.x - (Le - Li) / 2,
      z: center.z - StationGeo.zFloor(geo.type),
    };
  }

  /** Вентиляция станции: расходы, жалюзи, воздуховоды. */
  run() {
    if (!this.init()) return null;
    this.snowGaps();
    this.radiators();
    this.compressors();
    const out = this.out;
    this.exW = new Set([
      this.exhaust,
      ...out.louvers.filter(louver => louver.kind === 'out' || louver.kind === 'rad').map(louver => louver.wall),
    ]);
    this.general();
    if (!out.size.out && out.need.out) out.size.out = VentGrille.size(out.need.out.gross, this.outSize);
    new VentIntake(this).run();
    this.restOut();
    this.finish();
    return out;
  }

  /** Исходные данные вентиляции; нечего вентилировать — false. */
  init() {
    const { plan } = this;
    const v = plan.heat && plan.heat.vent;
    const sys = plan.sys || {};
    const items = plan.items || [];
    const dgu = items.find(i => i.kind === 'dgu' && !i.tank);
    if (!v || (!dgu && sys.vent === false)) return false;
    [this.len, this.wid, this.height] = plan.int;
    Object.assign(this, {
      vent: v,
      sys,
      items,
      dgu,
      summary: v.sum,
      x0: plan.geo.x0 || 0,
      step: VentGrille.STEP,
      outSize: VentGrille.OUTLET,
    });
    this.speeds();
    this.room = Math.max(0, v.m3h - v.use);
    this.qRad = dgu ? Math.max(v.rad, this.room) : 0;
    this.qIn = this._inFlow();
    this.comp = items.filter(i => i.kind === 'compressor' && i.mount === 'floor' && !i.tank);
    this.radW = new Set(VentPlan._floorDgu(items).map(i => i.rad || 'right'));
    this.exhaust = this._exhaustWall();
    this.walls = new StWalls(plan, { equip: false });
    this.roofs = (plan.roof || []).map(muffler => [
      muffler.x - 150,
      muffler.x + muffler.lx + 150,
      muffler.y - 150,
      muffler.y + muffler.ly + 150,
    ]);
    const inSize = VentGrille.INLET;
    this.outH = Math.max(
      this.outSize.h[0],
      Math.min(this.outSize.h[1], this.height - this.outSize.top - inSize.z0 - inSize.h[0] - 200),
    );
    this.qWall = dgu ? 0 : this.room;
    this.outRest = 0;
    this.leftOk = this.x0 === 0 && !plan.geo.sea;
    this.out = this.result();
    return true;
  }

  /** Проёмы — по рамке S = L / (3600·v), приток — с запасом. */
  speeds() {
    const summary = this.summary;
    const speed = () => StationRules.raw('vent.speed');
    this.vIn = summary ? summary.vIn : speed().in;
    this.vOut = summary ? summary.vOut : speed().out;
    this.res = summary ? summary.res : speed().inReserve;
  }

  _inFlow() {
    const { vent: v, summary: summary } = this;
    if (this.dgu) return this.qRad + v.use + v.cool;
    return summary && summary.Lin ? summary.Lin : v.m3h + v.cool;
  }

  _exhaustWall() {
    if (!this.dgu) return 'back';
    return this.radW.has('right') ? 'right' : [...this.radW][0];
  }

  _coolFlow(comp) {
    return Math.round(StationHeat.coolOf(comp, this.plan));
  }

  /** Итог расчёта вентиляции. */
  result() {
    const qOut = (this.dgu ? 0 : this.room) + this.comp.reduce((sum, comp) => sum + this._coolFlow(comp), 0);
    return {
      q: { in: Math.round(this.qIn), out: Math.round(qOut), rad: Math.round(this.qRad) },
      need: { in: this.need(this.qIn, 'in'), out: qOut > 0 ? this.need(qOut, 'out') : null },
      size: {},
      louvers: [],
      roof: [],
      exhaust: this.exhaust,
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

  /** Нужная площадь жалюзи на расход. */
  need(flow, kind) {
    const gross = kind === 'in' ? (flow / 3600 / this.vIn) * this.res : flow / 3600 / this.vOut;
    return {
      q: flow,
      gross: VentPlan._round2(gross),
      free: VentPlan._round2(gross * VentGrille.FREE),
      v: kind === 'in' ? this.vIn : this.vOut,
    };
  }

  /** Выброс по рамке, мм². */
  gross(flow) {
    return (flow / 3600 / this.vOut) * 1e6;
  }

  /** Задевает ли жалюзи центр тяжести на стене. */
  cogHit(wall, u0, u1, z0, z1) {
    const center = VentPlan.cog(this.plan, wall);
    const signH = 150 + 120;
    return (
      !!center && center.z + signH > z0 && center.z - signH < z1 + 220 && u0 < center.u + signH && u1 > center.u - signH
    );
  }

  /** Маркиза выступает от стены — от дверей и ворот на HOOD_GAP дальше. */
  snowGaps() {
    if (!this.sys.snow && !this.sys.snowout) return;
    const { plan, walls: walls } = this;
    const gap = VentGrille.HOOD_GAP;
    for (const door of plan.doors || [])
      walls.busy(door.wall === 'back' ? 'back' : 'front', door.x0 - gap, door.x1 + gap, 0, door.h + 150);
    for (const louver of [plan.entry, plan.exit, plan.gates, plan.gates2].filter(Boolean)) {
      if (louver.wall === 'front') walls.busy('front', louver.x0 - gap, louver.x1 + gap, 0, louver.h + 150);
      else walls.busy(louver.wall, louver.y0 - gap, louver.y1 + gap, 0, louver.h + 150);
    }
  }

  /** У каждой ДГУ — своя дверь-жалюзи (или жалюзи) напротив радиатора; общий расход — в доле её радиатора. */
  radiators() {
    if (!this.dgu) return;
    const dgus = VentPlan._floorDgu(this.items);
    const rule = StationRules.raw('heat.dgu_rad');
    const own = i => (i.cool > 0 ? i.cool : (i.kw * 1000 * rule.share) / (StationHeat.AIR * rule.dt));
    const sum = dgus.reduce((acc, i) => acc + own(i), 0) || 1;
    const rads = dgus.map(dgu => this.radiator(dgu, Math.round((this.qRad * own(dgu)) / sum)));
    const top = rads.reduce((best, other) => ((other.v || 0) > (best.v || 0) ? other : best), rads[0]);
    if (top) this.out.rad = { ...top, qOne: top.q, q: Math.round(this.qRad), n: rads.length, list: rads };
  }

  /** Выброс радиатора ДГУ. */
  radiator(dgu, flow) {
    const wall = dgu.rad || 'right';
    const end = wall !== 'back';
    const door = (this.plan.dguDoors || []).find(cand => cand.pos === dgu.pos && cand.unit === dgu.unit);
    const louver = door
      ? {
          kind: 'rad',
          wall,
          u0: end ? door.y0 : door.x0,
          u1: end ? door.y1 : door.x1,
          z0: 0,
          z1: door.h,
          door: true,
          pos: dgu.pos,
          unit: dgu.unit,
        }
      : {
          kind: 'rad',
          wall,
          u0: Math.round((end ? dgu.y : dgu.x) + 80),
          u1: Math.round((end ? dgu.y + dgu.ly : dgu.x + dgu.lx) - 80),
          z0: Math.round(dgu.h * 0.12),
          z1: Math.round(dgu.h * 0.95),
          pos: dgu.pos,
          unit: dgu.unit,
        };
    louver.w = louver.u1 - louver.u0;
    louver.h = louver.z1 - louver.z0;
    louver.q = flow;
    this.out.louvers.push(louver);
    this.walls.busy(wall, louver.u0 - 90, louver.u1 + 260, louver.z0, louver.z1 + 120);
    const free = ((louver.w * louver.h) / 1e6) * VentGrille.FREE;
    return {
      q: louver.q,
      free: VentPlan._round2(free),
      w: louver.w,
      h: louver.h,
      door: !!louver.door,
      wall,
      v: free > 0 ? Math.round((louver.q / 3600 / free) * 10) / 10 : null,
    };
  }

  /** Колпак выброса на крыше ближе к источнику, мимо глушителя и других колпаков; нет места — двумя поменьше. */
  hood(flow, midX, midY, duct, depth = 0) {
    const { step: step, wid: wid, out } = this;
    const area = this.gross(flow);
    const sizeY = Math.min(wid - 300, Math.max(400, Math.ceil(Math.sqrt(area) / step) * step));
    const sizeX = Math.max(400, Math.ceil(area / sizeY / step) * step);
    const spot = this._roofSpot({ sx: sizeX, sy: sizeY }, midX, midY);
    if (!spot) {
      if (depth < 2 && area > 0.5e6) {
        this.hood(flow / 2, midX, midY, duct, depth + 1);
        this.hood(flow / 2, midX, midY, duct, depth + 1);
      } else {
        out.short.out = VentPlan._round2(out.short.out + area / 1e6);
      }
      return;
    }
    const [spotX, spotY] = spot;
    this.roofs.push([spotX - 150, spotX + sizeX + 150, spotY - 150, spotY + sizeY + 150]);
    out.roof.push({
      kind: 'out',
      x0: spotX,
      x1: spotX + sizeX,
      y0: spotY,
      y1: spotY + sizeY,
      w: sizeX,
      l: sizeY,
      q: Math.round(flow),
      ...(duct ? { duct } : {}),
    });
  }

  _roofSpot({ sx: sizeX, sy: sizeY }, midX, midY) {
    const { step: step, wid: wid, len: len, x0 } = this;
    const hit = (x, y) =>
      x < x0 + 150 ||
      x + sizeX > len - 150 ||
      this.roofs.some(
        ([fromX, tillX, fromY, tillY]) => x < tillX && x + sizeX > fromX && y < tillY && y + sizeY > fromY,
      );
    const rowsY = [
      ...new Set(
        [midY - sizeY / 2, 150, wid - 150 - sizeY].map(y => Math.round(Math.max(150, Math.min(wid - 150 - sizeY, y)))),
      ),
    ];
    const x1 = Math.round(midX - sizeX / 2);
    for (let dist = 0; dist <= len; dist += step) {
      for (const x of dist ? [x1 + dist, x1 - dist] : [x1]) {
        const y = rowsY.find(cand => !hit(x, cand));
        if (y !== undefined) return [x, y];
      }
    }
    return null;
  }

  /** Стена выброса компрессора: задняя; второй ряд — стена прохода (если разрешено) или крыша. */
  exWall(comp) {
    if (this.exhaust !== 'back') return null;
    if (this.plan.rows === 2 && comp.row === 1) return this.front ? 'front' : null;
    return 'back';
  }

  /** Ворота на стене у компрессора. */
  gate(comp, wall) {
    return (this.plan.doors || []).find(
      door =>
        door.rear &&
        door.wall === wall &&
        door.pos.includes(comp.pos) &&
        door.x0 < comp.x + comp.lx &&
        door.x1 > comp.x,
    );
  }

  /** Верх жалюзи на стене. */
  zTop(wall) {
    const rearBack = (this.plan.doors || []).some(door => door.rear && door.wall === 'back');
    return this.height - (wall === 'back' && rearBack ? 100 : this.outSize.top);
  }

  /** Свободное место для жалюзи w × hh вверху стены: ближе к uc, сдвиг не больше maxd → {u, z0, z1, d} | null. */
  fitAt(wall, [width, height], midU, maxd, ok) {
    const z1 = this.zTop(wall);
    const z0 = z1 - height;
    const end = wall === 'left' || wall === 'right';
    const [low, high] = end ? [100, this.wid - 100] : [this.x0 + 100, this.len - 100];
    const good = from =>
      from >= low &&
      from + width <= high &&
      this.walls.free(wall, [from - 90, from + width + 90], [z0 - 90, z1 + 90]) &&
      !this.cogHit(wall, from, from + width, z0, z1) &&
      (!ok || ok(from));
    for (let dist = 0; dist <= maxd; dist += this.step) {
      for (const sign of dist ? [1, -1] : [1]) {
        const from = Math.round(midU - width / 2 + sign * dist);
        if (good(from)) return { u: from, z0, z1, d: dist };
      }
    }
    return null;
  }

  /** Торец, у которого компрессор стоит (между ним и торцом нет оборудования, в торце нет ворот): ближайшее место. */
  side(comp, width, height) {
    const { plan, len: lenIn, x0, wid: wid } = this;
    if (width > wid - 200) return null;
    const endsOk = !this.comp.some(other => this.exWall(other) === 'front');
    const gatesOn = end => [plan.gates, plan.gates2].some(gate => gate && gate.wall === end);
    const floor = this.items.filter(i => !i.tank && i.mount !== 'pipe' && i.mount !== 'wall');
    const atEnd = end =>
      !floor.some(
        i =>
          i !== comp &&
          i.y < comp.y + comp.ly &&
          i.y + i.ly > comp.y &&
          (end === 'right' ? i.x >= comp.x + comp.lx - 1 : i.x + i.lx <= comp.x + 1),
      );
    const ends = endsOk ? ['right', ...(this.leftOk ? ['left'] : [])].filter(end => !gatesOn(end) && atEnd(end)) : [];
    const midX = comp.x + comp.lx / 2;
    let best = null;
    for (const end of ends) {
      const spot = this.fitAt(end, [width, height], comp.y + comp.ly / 2, wid);
      const len = spot ? (end === 'right' ? lenIn - midX : midX - x0) + spot.d : Infinity;
      if (spot && (!best || len < best.len)) best = { wall: end, ...spot, len };
    }
    return best;
  }

  /** Отметка для отката размещения. */
  mark() {
    return { b: this.walls.mark(), n: this.out.louvers.length };
  }

  _unmark(mark) {
    this.walls.reset(mark.b);
    this.out.louvers.length = mark.n;
  }

  /** Добавляет жалюзи и занимает стену. */
  add(louver) {
    const gap = VentGrille.GAP;
    this.out.louvers.push(louver);
    this.walls.busy(louver.wall, louver.u0 - 90 - gap, louver.u1 + 260 + gap, louver.z0 - 90, louver.z1 + 90);
    return louver;
  }

  /** Место компрессора: над его частью сервисных ворот (от перемычки + 240 мм до 100 мм под потолком) или над ним. */
  slot(comp) {
    const wall = this.exWall(comp);
    const gate = wall && this.gate(comp, wall);
    if (!gate) return { c: comp, wall, hMax: this.outH, wMax: VentGrille.WHOLE };
    const same = this.comp
      .filter(other => this.exWall(other) === wall && this.gate(other, wall) === gate)
      .sort((left, right) => left.x - right.x);
    const slotW = (gate.x1 - gate.x0) / same.length;
    const gap = same.length > 1 ? VentGrille.GAP / 2 : 0;
    return {
      c: comp,
      wall,
      G: gate,
      a0: gate.x0 + same.indexOf(comp) * slotW,
      sw: slotW,
      hMax: Math.floor(Math.min(this.outSize.h[1], this.height - 100 - (gate.h + 240)) / this.step) * this.step,
      wMax: Math.min(VentGrille.WHOLE, Math.floor((slotW - 2 * gap) / this.step) * this.step),
    };
  }

  /** Жалюзи в ячейке воздуховода. */
  placeAt(slot, width, height) {
    const duct = VentPlan._key(slot.c);
    if (slot.G) {
      const u = Math.round(slot.a0 + (slot.sw - width) / 2);
      const z1 = this.height - 100;
      return this.add({
        kind: 'out',
        wall: slot.wall,
        u0: u,
        u1: u + width,
        z0: z1 - height,
        z1,
        w: width,
        h: height,
        duct,
        over: true,
      });
    }
    const spot = this.fitAt(slot.wall, [width, height], slot.c.x + slot.c.lx / 2, 1500);
    return (
      spot &&
      this.add({
        kind: 'out',
        wall: slot.wall,
        u0: spot.u,
        u1: spot.u + width,
        z0: spot.z0,
        z1: spot.z1,
        w: width,
        h: height,
        duct,
      })
    );
  }

  /** Одна решётка w × hh у каждого компрессора группы; не встала хоть у одного — ничего не ставится. */
  all(slots, width, height, put) {
    const mark = this.mark();
    if (slots.every(slot => put(slot, width, height))) return true;
    this._unmark(mark);
    return false;
  }

  /** Все компрессоры — одна группа (решётки одного размера по наибольшему расходу); не вышло на стенах — все через крышу. */
  compressors() {
    const { comp, walls: walls, out } = this;
    const groups = comp.length
      ? [comp.slice().sort((left, right) => this._coolFlow(right) - this._coolFlow(left))]
      : [];
    const markC = walls.mark();
    const [countC, nR0, qW0] = [out.louvers.length, out.roof.length, this.qWall];
    const viaRoof = this.roofOnly || comp.some(cand => !this.exWall(cand)) || !groups.every(group => this.group(group));
    if (!viaRoof) return;
    walls.reset(markC);
    out.louvers.length = countC;
    out.roof.length = nR0;
    this.qWall = qW0;
    out.ducts = {};
    const qMax = Math.max(...comp.map(cand => this._coolFlow(cand)));
    for (const cand of comp) {
      out.ducts[VentPlan._key(cand)] = 'roof';
      this.hood(qMax, cand.x + cand.lx / 2, cand.y + cand.ly / 2, VentPlan._key(cand));
    }
  }

  /** Размер — по самому стеснённому месту: выше — уже; не хватает — наибольшая, что встаёт у всех; остаток — в торце. */
  group(comps) {
    const flow = this._coolFlow(comps[0]);
    const slots = comps.map(comp => this.slot(comp));
    const got = this._groupSize(slots, this.gross(flow));
    if (!got) return false;
    let rest = Math.max(0, flow - ((got[0] * got[1]) / 1e6) * this.vOut * 3600);
    if (rest > 1) rest = this.sideAdd(slots, rest);
    for (const comp of comps) this.out.ducts[VentPlan._key(comp)] = 'wall';
    if (rest <= 1) return true;
    if (!slots.every(slot => slot.wall === 'back')) return false;
    this.qWall += rest * comps.length;
    return true;
  }

  _groupSize(slots, need0) {
    const { step: step, outSize: outSize } = this;
    const place = (slot, width, height) => this.placeAt(slot, width, height);
    const hTop = Math.min(...slots.map(slot => slot.hMax));
    const wTop = Math.min(...slots.map(slot => slot.wMax));
    const hMin = this.summary && this.summary.exfan ? VentGrille.FAN_MIN : outSize.h[0];
    let part = null;
    for (let height = hTop; height >= hMin && wTop >= outSize.w[0]; height -= 50) {
      const width = Math.max(outSize.w[0], Math.min(wTop, Math.ceil(need0 / height / step) * step));
      const mark = this.mark();
      if (this.all(slots, width, height, place)) {
        if (width * height >= need0) return [width, height];
        this._unmark(mark);
        if (!part || width * height > part[0] * part[1]) part = [width, height];
      }
    }
    return part && this.all(slots, part[0], part[1], place) ? part : null;
  }

  /** Остаток — добавка одного размера в торце у каждого компрессора; хоть одному некуда — ни у кого. */
  sideAdd(slots, rest) {
    const { step: step, outSize: outSize } = this;
    const hMin = this.summary && this.summary.exfan ? VentGrille.FAN_MIN : outSize.h[0];
    const put = (slot, width2, height2) => {
      const spot = this.side(slot.c, width2, height2);
      return (
        spot &&
        this.add({
          kind: 'out',
          wall: spot.wall,
          u0: spot.u,
          u1: spot.u + width2,
          z0: spot.z0,
          z1: spot.z1,
          w: width2,
          h: height2,
          duct: VentPlan._key(slot.c),
          side: true,
        })
      );
    };
    for (let height = this.outH; height >= hMin && rest > 1; height -= 50) {
      const width = Math.max(
        outSize.w[0],
        Math.min(VentGrille.WHOLE, Math.ceil(this.gross(rest) / height / step) * step),
      );
      if (this.all(slots, width, height, put)) rest = Math.max(0, rest - ((width * height) / 1e6) * this.vOut * 3600);
    }
    return rest;
  }

  /** Место на стене: жалюзи u0…u1 (слева 100 мм, справа 260 мм — электропривод клапана), мимо знака «Центр тяжести». */
  spotAt(wall, from, width, lim, [z0, z1]) {
    return this.walls.find(
      wall,
      width + 360,
      [z0 - 90, z1 + 90],
      from,
      start => !this.cogHit(wall, start + 100, start + 100 + width, z0, z1) && (!lim || start + 100 + width <= lim),
    );
  }

  /** Жалюзи в точке стены. */
  putAt({ kind, wall, w: width, u, z0, h: height }) {
    const gap = VentGrille.GAP;
    const u0 = u + 100;
    const louver = { kind, wall, u0, u1: u0 + width, z0, z1: z0 + height, w: width, h: height };
    this.out.louvers.push(louver);
    this.walls.busy(wall, u0 - 90 - gap, louver.u1 + 260 + gap, z0 - 90, z0 + height + 90);
    return width * height;
  }

  /** Одним проёмом, иначе наименьшим числом одинаковых (до MAXN), если встают целиком; bands — высоты низа. */
  whole(kind, size, walls, gross, bands) {
    for (let count = 1; count <= VentGrille.MAXN; count++) {
      for (const band of bands) {
        if (this._wholeAt({ kind, o: size, walls, gross, zb: band }, count)) return true;
      }
    }
    return false;
  }

  _wholeAt({ kind, o: size, walls, gross, zb: band }, count) {
    const { step: step, height: height, outSize: outSize, walls: wallsMap, out } = this;
    const inSize = VentGrille.INLET;
    const room = kind === 'in' ? height - outSize.top - 90 - band : height - size.top - inSize.z0 - inSize.h[0] - 200;
    const hmax = Math.floor(Math.min(size.h[1], room) / step) * step;
    if (hmax < size.h[0]) return false;
    for (const size2 of VentGrille.sizesN(
      gross,
      { ...size, w: [size.w[0], Math.max(size.w[1], VentGrille.WHOLE)], h: [size.h[0], hmax] },
      count,
    )) {
      const z0 = kind === 'in' ? band : height - size.top - size2.h;
      const mark = wallsMap.mark();
      const countL = out.louvers.length;
      const got = this.fill({ kind, w: size2.w, z0, h: size2.h }, walls, count);
      if (got === count) {
        out.size[kind] = size2;
        return true;
      }
      wallsMap.reset(mark);
      out.louvers.length = countL;
    }
    return false;
  }

  /** n жалюзи w × h на стенах по порядку; сколько встало. */
  fill({ kind, w: width, z0, h: height }, walls, count) {
    let got = 0;
    for (const [wall, from, lim] of walls) {
      while (got < count) {
        const u = this.spotAt(wall, from, width, lim, [z0, z0 + height]);
        if (u == null) break;
        this.putAt({ kind, wall, w: width, u, z0, h: height });
        got++;
      }
    }
    return got;
  }

  /** Одинаковые жалюзи по расчёту; не встали все — остаток той же высоты, ширина — под свободные участки стен. */
  place(kind, size0, walls, need0) {
    if (!need0 || need0.gross <= 0) return 0;
    const size = VentGrille.size(need0.gross, size0);
    this.out.size[kind] = this.out.size[kind] || size;
    if (!size) return need0.gross * 1e6;
    const z0 = kind === 'in' ? size0.z0 : this.height - size0.top - size.h;
    const spec = { kind, z0, h: size.h };
    const left = this._placeSame(spec, walls, size, need0.gross * 1e6);
    return Math.max(0, this._placePieces(spec, walls, size0.w[1], left));
  }

  _placeSame({ kind, z0, h: height }, walls, size, left) {
    let uni = size.n;
    for (const [wall, from, lim] of walls) {
      while (uni > 0 && left > 1) {
        const u = this.spotAt(wall, from, size.w, lim, [z0, z0 + height]);
        if (u == null) break;
        left -= this.putAt({ kind, wall, w: size.w, u, z0, h: height });
        uni--;
      }
    }
    return left;
  }

  _placePieces({ kind, z0, h: height }, walls, wMax, left) {
    for (const [wall, from, lim] of walls) {
      while (left > 1) {
        const piece = this.piece(
          { wall, from, lim, z: [z0, z0 + height] },
          Math.min(wMax, Math.max(VentGrille.PIECE, Math.ceil(left / height / this.step) * this.step)),
        );
        if (!piece) break;
        left -= this.putAt({ kind, wall, w: piece.w, u: piece.u, z0, h: height });
      }
    }
    return left;
  }

  /** Наибольшая ширина от w0 вниз (не уже PIECE), что встаёт на стене. */
  piece({ wall, from, lim, z }, maxW) {
    for (let width = maxW; width >= VentGrille.PIECE; width -= this.step) {
      const u = this.spotAt(wall, from, width, lim, z);
      if (u != null) return { w: width, u };
    }
    return null;
  }

  /** Общая вытяжка — у осушителя, своего размера, вверху стены выброса, не над сервисными воротами; не встала — выше. */
  general() {
    const { comp, items: items, plan, walls: walls, height: height, outSize: outSize, outH: outH, step: step } = this;
    const dryer = comp.length
      ? items.filter(i => i.kind === 'dryer' && i.mount === 'floor').sort((first, second) => first.x - second.x)[0]
      : null;
    const hub = dryer ? Math.round(dryer.x + dryer.lx / 2) : 'hi';
    for (const door of (plan.doors || []).filter(cand => cand.wall === 'back'))
      walls.busy('back', door.x0 - 150, door.x1 + 150, 0, height);
    if (this.qWall <= 0) return;
    const need = this.need(this.qWall, 'out');
    const spots = [['back', hub]];
    const size = { ...outSize, h: [outSize.h[0], outH] };
    let left = need.gross * 1e6;
    if (this.exhaust === 'back')
      left = this.whole('out', size, spots, need.gross, [0]) ? 0 : this.place('out', size, spots, need);
    if (left > 1 && this.exhaust === 'back') {
      const topH = Math.floor(Math.max(outSize.h[0], height - outSize.top - 600) / step) * step;
      if (topH > outH) left = this.place('out', { ...outSize, h: [outSize.h[0], topH] }, spots, { gross: left / 1e6 });
    }
    if (left > 1) this.outRest = left;
  }

  /** Остаток вытяжки — на торцах без притока (наверху), затем через крышу. */
  restOut() {
    if (this.outRest <= 1) return;
    const { outSize: outSize, height: height, step: step, len: len, x0, wid: wid, exhaust: exhaust, out } = this;
    const ends = ['right', ...(this.leftOk ? ['left'] : [])].filter(
      wall => wall !== exhaust && !out.louvers.some(louver => louver.kind === 'in' && louver.wall === wall),
    );
    const topH = Math.floor(Math.max(outSize.h[0], height - outSize.top - 600) / step) * step;
    if (ends.length) {
      this.outRest = this.place(
        'out',
        { ...outSize, h: [outSize.h[0], topH] },
        ends.map(wall => [wall, 'hi']),
        { gross: this.outRest / 1e6 },
      );
    }
    if (this.outRest > 1)
      this.hood((this.outRest / 1e6) * this.vOut * 3600, len - Math.min(1500, (len - x0) / 4), wid / 2, null);
  }

  /** Маркизы у всех — один угол открытия (наибольший из нужных). */
  marks(list, flowOf, vmax) {
    if (!list.length) return null;
    const hoods = list.map(louver => VentGrille.hood(flowOf(louver), louver.w, louver.h, louver.z1, vmax));
    const angle = Math.max(...hoods.map(hood => hood.a));
    list.forEach((louver, i) => {
      louver.hood = VentGrille.hoodAt(hoods[i], angle, flowOf(louver));
    });
    return {
      n: list.length,
      v: vmax,
      a: angle,
      d: Math.max(...list.map(louver => louver.hood.d)),
      over: list.filter(louver => louver.hood.v > vmax + 0.005).length,
    };
  }

  /** Аккуратность проёмов, естественная тяга, маркизы, вытяжные вентиляторы. */
  finish() {
    const { out, summary: summary, sys } = this;
    if (!this.dgu) StationTidy.louvers(out.louvers, this.walls, this.height, VentGrille.GAP);
    this.draft();
    if (sys.snow) {
      const intake = out.louvers.filter(louver => louver.kind === 'in');
      const area = intake.reduce((sum, louver) => sum + louver.w * louver.h, 0);
      out.hood = this.marks(intake, louver => (this.qIn * louver.w * louver.h) / area, VentGrille.HOOD_V);
    }
    if (sys.snowout) {
      out.hoodOut = this.marks(
        out.louvers.filter(louver => louver.kind === 'out'),
        louver => ((louver.w * louver.h) / 1e6) * this.vOut * 3600,
        this.vOut,
      );
    }
    if (summary && summary.exfan) {
      const outs = out.louvers.filter(louver => louver.kind === 'out');
      for (const louver of [...outs, ...(out.roof || [])]) louver.fan = true;
      out.exfan = {
        n: outs.length + (out.roof || []).length,
        L: summary.exfan.L,
        dp: summary.exfan.dp,
        P: summary.exfan.P,
      };
    }
  }

  /** Естественная тяга общей вытяжки — у станций без компрессоров: от середины притока до середины выброса. */
  draft() {
    const { out, summary: summary, vent: v } = this;
    const midZ = list =>
      list.reduce((sum, louver) => sum + ((louver.z0 + louver.z1) / 2) * louver.w * louver.h, 0) /
      Math.max(
        1,
        list.reduce((sum, louver) => sum + louver.w * louver.h, 0),
      );
    const Li = out.louvers.filter(louver => louver.kind === 'in');
    const outs = out.louvers.filter(louver => louver.kind === 'out' && !louver.duct);
    if (
      this.dgu ||
      !summary ||
      summary.units.length ||
      !Li.length ||
      !(outs.length || (out.roof || []).some(louver => !louver.duct))
    )
      return;
    const outZ = outs.length ? midZ(outs) : this.height + VentGrille.HOOD;
    out.draft = VentCalc.draft(summary, (outZ - midZ(Li)) / 1000, this.room, v.ex || {}, v.warn || []);
  }
}
