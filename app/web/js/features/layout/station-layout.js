import { AirChain } from './air-chain.js';
import { LayoutAccess } from './layout-access.js';
import { LayoutDgu } from './layout-dgu.js';
import { LayoutExits } from './layout-exits.js';
import { LayoutGates } from './layout-gates.js';
import { LayoutItem } from './layout-item.js';
import { LayoutJoints } from './layout-joints.js';
import { LayoutMode } from './layout-mode.js';
import { LayoutNotes } from './layout-notes.js';
import { LayoutOpening } from './layout-opening.js';
import { LayoutPipes } from './layout-pipes.js';
import { LayoutRoof } from './layout-roof.js';
import { LayoutRows } from './layout-rows.js';
import { LayoutSize } from './layout-size.js';
import { LayoutTank } from './layout-tank.js';
import { LayoutWalls } from './layout-walls.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { StationClear } from './station-clear.js';
import { StationEquip } from './station-equip.js';
import { StationFire } from './station-fire.js';
import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationLight } from './station-light.js';
import { StationMass } from './station-mass.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationPaint } from './station-paint.js';
import { StationPipe } from './station-pipe.js';
import { StationPower } from './station-power.js';
import { StationSockets } from './station-sockets.js';
import { StationTidy } from './station-tidy.js';
import { StationVent } from './station-vent.js';

const n = v => Mm.text(v);
const warned = q => q.iss.some(i => i.level === 'warn');
const ATTRS = [
  'cat',
  'size',
  'mass',
  'model',
  'maker',
  'orient',
  'kw',
  'volume',
  'color',
  'flow',
  'pressure',
  'stage',
  'dryer',
  'vsd',
  'dewPoint',
  'receiver',
];
const ROW_KEYS =
  /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL|установк|исполнен|производительн|пропускн|давлени|ступен|очистк|фильтр|осушител|регулирован|точк\S* росы|воздух|теплов|охлажд/i;

/**
 * Компоновка станции в контейнере: оборудование рядами с проходом обслуживания, двери и ворота, трубопровод, подбор размера
 * контейнера. Координаты внутри контейнера, мм: x — вдоль от торца с дверью, y — поперёк от стены прохода, z — от пола.
 */
export class StationLayout {
  /** Версия правил и рисунков: изменилась — картинки станций в КП пересобираются. */
  static VER = 25;

  static solve(input) {
    return new StationLayout(input).run();
  }

  static n(v) {
    return Mm.text(v);
  }

  /** Отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить. */
  static hash(input) {
    const rules =
      typeof StationRules !== 'undefined' && StationRules.ok()
        ? `${StationRules.version()}.${StationRules.stamp()}`
        : '';
    const app = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
    const parts = (input.parts || []).filter(p => p && p.role !== 'container').map(p => StationLayout.hashPart(p));
    const s = JSON.stringify([
      StationLayout.VER,
      app,
      rules,
      StationClear.aisle(),
      StationLayout.hashCont(input.cont || {}),
      input.chassisH || null,
      input.recv || '',
      !!input.recvOut,
      input.req || null,
      parts,
    ]);
    return StationRules.fnv(s);
  }

  static hashCont(c) {
    const mods = c.mods ? JSON.stringify(StationMods.rect(c.mods.cells)) : null;
    return [
      c.ctype,
      c.size,
      c.sizeAuto,
      c.lenFix || null,
      c.ins,
      StationPaint.stamp(c),
      mods,
      c.sys || null,
      c.climate || '',
      c.roof || '',
      StationGeo.floor(c),
    ];
  }

  static hashPart(p) {
    const attrs = p.attrs ? Object.fromEntries(ATTRS.map(k => [k, p.attrs[k]])) : null;
    const rows = (p.rows || [])
      .filter(r => r && ROW_KEYS.test(`${String(r.k || '')} ${String(r.v || '')}`))
      .map(r => [r.k, r.v]);
    return [
      p.name,
      p.qty,
      p.role || '',
      p.pipeMat || '',
      p.dn || '',
      p.mount || '',
      attrs,
      StationEquip.tint(p),
      StationEquip.tones(p),
      rows,
      StationEquip.pic(p),
    ];
  }

  static get MAX_L() {
    return StationMatrix.fit().maxL;
  }
  static get PIPE_PAD() {
    return StationMatrix.grp('pipe').pad;
  }
  static get AIR_Y() {
    return StationMatrix.grp('pipe').airY;
  }
  static get DOOR() {
    return LayoutOpening.DOOR;
  }
  static get ENTRY() {
    return LayoutOpening.ENTRY;
  }
  static get DOOR_MIN() {
    return StationMatrix.door().w;
  }
  static get PASS() {
    return StationMatrix.move().pass;
  }
  static get CAB_TOP() {
    return StationMatrix.cab().top;
  }
  static get CAB_LOW() {
    return StationMatrix.cab().low;
  }
  static get OUT_GAP() {
    return StationMatrix.recv().outGap;
  }
  static get PAD() {
    return StationMatrix.recv().pad;
  }
  static get RECV2() {
    return StationMatrix.fit().recv2;
  }
  static get TANK() {
    return LayoutTank.M;
  }
  static get SIDE() {
    return LayoutAccess.SIDE;
  }
  static get FUEL_Z() {
    return LayoutPipes.FUEL_Z;
  }
  static gaps(geo) {
    return LayoutOpening.gaps(geo);
  }
  static svcW(len, T = 0) {
    return LayoutOpening.svcW(len, T);
  }
  static svcH(h, T, rear, H) {
    return LayoutOpening.svcH(h, T, rear, H);
  }
  static gateAxis(q) {
    return LayoutMode.gateAxis(q);
  }
  static series(e) {
    return LayoutPipes.series(e);
  }
  static runs(l) {
    return LayoutPipes.runs(l);
  }
  static outPath(l, W) {
    return LayoutPipes.outPath(l, W);
  }
  static key(e) {
    return `${e.id}#${e.unit}`;
  }

  /** Осушитель двумя колоннами: адсорбционный или генератор (вид — из цепочки сжатого воздуха, иначе по названию). */
  static twinDryer(it) {
    const t = it && it.air && it.air.type;
    if (t) return t === 'ads' || t === 'gen';
    return /адсорбц|десикант|adsorp|desicc/i.test(String((it && it.name) || ''));
  }

  constructor(input) {
    this.in = input || {};
    this.cont = this.in.cont || null;
    this.rows = new LayoutRows(this);
    this.dgu = new LayoutDgu(this);
    this.joints = new LayoutJoints(this);
    this.walls = new LayoutWalls(this);
    this.gates = new LayoutGates(this);
    this.exits = new LayoutExits(this);
    this.access = new LayoutAccess(this);
    this.size = new LayoutSize(this);
    this.notes = new LayoutNotes(this);
    this.eq = StationEquip.list(this.in.parts || [], { recv: this.in.recv, recvOut: this.in.recvOut });
    this.aisle0 = StationClear.aisle();
    this.aisle = this.aisle0;
    this.mode = {};
    const has = kind => this.eq.some(e => e.kind === kind);
    this.comp = has('compressor') && !has('dgu');
    this.G = this.comp ? StationMatrix.gap() : 0;
    this.dguSt =
      this.eq.some(e => e.kind === 'dgu' && e.place) &&
      !this.eq.some(e => e.place && (e.kind === 'compressor' || e.kind === 'pump'));
  }

  modes() {
    return LayoutMode.list(this.comp);
  }

  /** Выполнить fn в режиме m. */
  withMode(m, fn) {
    const [aisle, mode] = [this.aisle, this.mode];
    this.mode = m || {};
    this.aisle = LayoutMode.aisle(this.aisle0, this.mode);
    try {
      return fn();
    } finally {
      this.aisle = aisle;
      this.mode = mode;
    }
  }

  run() {
    const placed = this.eq.filter(e => e.place);
    const extra = this.eq.filter(e => !e.place);
    const chassis = extra.some(e => e.kind === 'chassis');
    const base = {
      items: [],
      extra,
      chassis,
      muffler: extra.some(e => e.kind === 'muffler'),
      aisleRule: this.aisle,
      issues: [],
    };
    if (!this.cont) return Object.assign(base, { level: 'none', text: 'Выберите контейнер в составе станции.' });
    if (!placed.length)
      return Object.assign(base, {
        level: 'none',
        text: 'Добавьте в состав оборудование — компрессор, насос, ДГУ и т. п.',
      });
    const units = this.tankRoom(this.units(placed));
    const geo = this.geoOf(this.cont);
    this.T = geo.t || 0;
    let plan = this.place(units, geo, chassis);
    plan = Object.assign(base, plan, { issues: plan.issues || [] }, this.colors());
    this.check(plan);
    this.notes.plan(plan);
    if (plan.level === 'ok' && plan.issues.some(i => i.level === 'warn')) plan.level = 'warn';
    return this.size.grow(plan, geo);
  }

  /** ДГУ с дополнительным баком — бак в отдельном отсеке у ближнего торца; по оборудованию — в ширине блок-контейнера 2 300 мм. */
  tankRoom(units) {
    const g0 = StationGeo.of(this.cont);
    const in0 = g0.int || StationGeo.inner(g0.type, [10000, StationGeo.ROAD_W, 2600], g0.t);
    const We = g0.int ? g0.ext[1] : Math.min(StationGeo.ROAD_W, 2300);
    const Wt = g0.int ? in0[1] : StationGeo.inner(g0.type, [10000, We, 2600], g0.t)[1];
    const eW = LayoutOpening.gaps({ ext: [0, We, 0], int: [0, Wt, 0] }).eW;
    this.tank = LayoutTank.room(units, Wt, in0[2], !!g0.sea, Wt - 2 * eW);
    return this.tank ? units.filter(e => e.kind !== 'tank') : units;
  }

  /** Расстановка и снаружи (глушители, выхлоп, выход трубы, ресиверы); «не помещается» без условных габаритов — точно. */
  place(units, geo, chassis) {
    const fit = U => (geo.auto ? this.size.auto(U, geo) : this.fit(U, geo));
    const plan = !geo.auto && this.in._mode ? this.fit(units, geo, [this.in._mode]) : fit(units);
    if (plan.level === 'error') {
      if (!geo.auto) plan.suggest = this.size.suggest(units, geo);
      if (units.some(e => !e.known)) {
        const known = units.filter(e => e.known);
        plan.assumed = !known.length || fit(known).level !== 'error';
      }
      return plan;
    }
    if (!geo.auto && !this.in._grow) this.size.excess(units, geo, plan);
    if (plan.items && plan.items.length) this.outside(plan, chassis);
    return plan;
  }

  outside(plan, chassis) {
    plan.roof = LayoutRoof.roof(plan, this.eq);
    plan.exhausts = LayoutRoof.exhausts(plan);
    LayoutPipes.outlet(
      plan,
      this.eq.some(e => e.outside),
    );
    plan.piping = LayoutPipes.route(plan, this.eq);
    plan.outside = LayoutRoof.outside(plan, this.eq, chassis);
    this.notes.mods(plan);
  }

  /** Сжатый воздух, сосуды под давлением, системы контейнера, нормы. */
  check(plan) {
    this.air(plan);
    const bar = Math.max(0, ...this.eq.filter(e => e.kind === 'compressor' && e.air).map(e => e.air.bar || 0));
    plan.vessels = PressureVessel.list(this.eq, bar);
    plan.req = this.in.req || null;
    plan.climate = (this.cont && this.cont.climate) || '';
    if (plan.geo && plan.geo.ext) plan.geo.rise = StationGeo.rise(plan.geo.roof, plan.geo.ext[1]);
    if (plan.level !== 'error' && plan.geo && plan.geo.ext && plan.int) this.systems(plan);
    if (plan.level !== 'error') StationNorms.check(plan, this.eq);
  }

  air(plan) {
    const air = AirChain.check(this.eq, this.in.air, this.in.req && this.in.req.recvIn);
    if (air && plan.level !== 'error') {
      plan.air = air;
      plan.issues.push(...air.issues);
    }
  }

  systems(plan) {
    plan.heat = StationHeat.calc(plan);
    plan.fire = StationFire.calc(plan);
    plan.light = StationLight.calc(plan);
    plan.sockets = StationSockets.calc(plan);
    plan.power = StationPower.calc(plan);
    plan.pipe = StationPipe.calc(plan);
    plan.mass = StationMass.calc(plan);
    plan.issues.push(...StationMass.issues(plan.mass));
    plan.vent = StationVent.calc(plan);
    plan.tidy = StationTidy.score(plan, plan.geo);
    if (plan.fire.low) {
      plan.issues.push({
        level: 'info',
        text: `Высота помещения ${n(plan.int[2])} мм — ниже паспортной высоты установки модулей «Буран-2,5» (2,5–3,5 м): зона тушения — по диаграмме распыла изготовителя при этой высоте (согласовать с проектировщиком пожаротушения).`,
      });
    }
    const pq = plan.pipe;
    if (pq && pq.small) {
      plan.issues.push({
        level: 'warn',
        text: `Трубопровод DN ${pq.set} меньше расчётного DN ${pq.dn} (${pq.why}): скорость больше ${Mm.dec(pq.lines[0].v)} м/с — потери давления и шум. Укажите DN ${pq.dn} в составе станции.`,
      });
    }
  }

  /** Единицы оборудования по порядку от двери: шкафы, остальное по составу (воздух — по ходу), бак, ДГУ — в дальнем торце. */
  units(placed) {
    const u = placed.flatMap(e =>
      Array.from({ length: e.qty }, (_, k) => ({ ...e, unit: k, c: this.clear(e), air: AirChain.unit(e.air, k) })),
    );
    const dgu = placed.some(e => e.kind === 'dgu');
    const air = placed.some(e => e.kind === 'compressor');
    const rank = e => {
      if (e.kind === 'cabinet') return 0;
      if (e.kind === 'dgu') return 2;
      if (e.kind === 'tank' && dgu) return 1.5;
      if (air && e.air && e.air.stage != null) return 1 + e.air.stage / 100;
      return air ? 1.8 : 1;
    };
    return u
      .map((e, i) => [e, i])
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([e]) => e);
  }

  /** Отступы агрегата: нормы вида и матрица расстановки; «плотно» сзади — только виду с сервисными воротами. */
  clear(e) {
    const c = StationClear.of(e.kind, e);
    const w = StationMatrix.wall(e);
    if (e.kind === 'dgu') {
      const R = StationMatrix.grp('dgu').rad;
      return { ...c, far: [R, R] };
    }
    if (!w || e.kind === 'cabinet' || e.kind === 'tank') return c;
    return { ...c, back: [w[0], LayoutGates.gated(e.kind) ? w[1] : Math.max(w[1], Math.min(w[0], c.back[1]))] };
  }

  /** Геометрия контейнера: оборудование — после отсека бака. */
  geoOf(c) {
    const g = StationGeo.of(c);
    if (this.tank) g.x0 = (g.x0 || 0) + this.tank.len;
    return g;
  }

  /** Перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё). */
  front(e) {
    return [this.aisle[0], e.c.front != null ? Math.min(this.aisle[1], e.c.front) : this.aisle[1]];
  }

  item(it, geo) {
    return LayoutItem.floor(it, geo, this.G);
  }

  /** Высота: оборудование и место над ним; шкаф на стене — не ниже CAB_LOW; фильтры висят на трубе. */
  heights(units, H) {
    const iss = [];
    for (const e of units) {
      if (e.unit || e.pipe) continue;
      if (e.mount === 'wall') {
        if (e.h + StationLayout.CAB_LOW > H - 50) {
          iss.push({
            level: 'error',
            text: `Поз. ${e.pos} «${e.short}» не помещается на стене по высоте: ${n(e.h)} мм и не ниже ${n(StationLayout.CAB_LOW)} мм от пола, а высота внутри — ${n(H)} мм.`,
          });
        }
      } else {
        this.headroom(e, H, iss);
      }
    }
    return { bad: iss.some(i => i.level === 'error'), iss };
  }

  headroom(e, H, iss) {
    const top = e.c.top;
    const room = H - e.h;
    if (room < top[1]) {
      const vol = e.air && e.air.vol > 0 ? ` (например, 2 × ${n(Math.ceil(e.air.vol / 2 / 100) * 100)} л)` : '';
      const recv =
        e.kind === 'receiver'
          ? ` Замените на горизонтальный ресивер или несколько меньших${vol}, либо ресивер — снаружи (ФНП ОРПД, п. 65).`
          : '';
      iss.push({
        level: 'error',
        text: `Поз. ${e.pos} «${e.short}» не проходит по высоте: ${n(e.h)} мм и не менее ${n(top[1])} мм над ним, а высота внутри — ${n(H)} мм.${recv}`,
      });
    } else if (room < top[0] && e.kind === 'compressor') {
      iss.push({
        level: 'info',
        text: `Над компрессором (поз. ${e.pos}) ${n(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).`,
      });
    } else if (room < top[0]) {
      iss.push({
        level: 'warn',
        text: `Над поз. ${e.pos} «${e.short}» ${n(room)} мм до потолка — рекомендуется ${n(top[0])} мм.`,
      });
    }
  }

  /** Заданный контейнер: сначала как обычно, не помещается — исключения; нигде — ответ обычного режима (он понятнее). */
  fit(units, geo, modes) {
    let first = null;
    for (const m of modes || this.modes()) {
      const r = this.withMode(m, () => this.fit0(units, geo));
      if (r.level !== 'error') {
        this.notes.mode(r, m, geo);
        if (m.tight || m.cross || m.ends) r.level = r.issues.some(i => i.level === 'warn') ? 'warn' : r.level;
        return r;
      }
      first = first || r;
    }
    return first;
  }

  /** Пол — рядами; шкафы — на стене прохода, фильтры — на трубе; не нашлось им места — своё место в ряду. */
  fit0(units, geo) {
    let wall = units.filter(e => e.mount === 'wall');
    let hang = units.filter(e => e.pipe);
    let floor = units.filter(e => !e.pipe && e.mount !== 'wall');
    if (!floor.length) {
      floor = units.map(e => ({ ...e, slot: true }));
      wall = [];
      hang = [];
    }
    const pass = avoid => {
      const q = this.fitRow(floor, geo, units);
      if (q.level === 'error') return { q, left: [] };
      if (this.tank) LayoutTank.place(q, geo, this.tank);
      this.gates.plan(q, geo, avoid);
      return { q, left: this.walls.attach(q, wall, hang, geo) };
    };
    let { q: r, left } = pass([]);
    if (r.level === 'error') return r;
    ({ r, left } = this.wallsFirst(r, left, pass));
    r = this.slots({ r, left, floor, wall, hang, geo, units });
    if (r.level !== 'error') this.exits.finish(r, geo);
    return r;
  }

  /** Ворота заняли торец и шкафам не хватило стены — шкафы важнее: ворота в другом торце, нет места — сервисная дверь. */
  wallsFirst(r, left, pass) {
    for (const avoid of [r.gates && !r.gates.sea ? [r.gates.wall] : null, ['left', 'right']]) {
      if (!left.length || !avoid || !(r.gates && !r.gates.sea)) break;
      const t = pass(avoid);
      if (t.left.length < left.length) {
        r = t.q;
        left = t.left;
      }
    }
    return { r, left };
  }

  /** Не нашлось места на стене или трубе — своё место в ряду (в конце, иначе перед ресиверами в конце ряда). */
  slots({ r, left, floor, wall, hang, geo, units }) {
    for (let slots = left; left.length; slots = [...slots, ...left]) {
      const ids = new Set(slots.map(StationLayout.key));
      const rest = e => !ids.has(StationLayout.key(e));
      const r2 = this.slotRow(floor, slots, geo, units);
      if (r2.level === 'error') return r2;
      if (this.tank) LayoutTank.place(r2, geo, this.tank);
      this.gates.plan(r2, geo);
      left = this.walls.attach(r2, wall.filter(rest), hang.filter(rest), geo);
      r = r2;
    }
    return r;
  }

  slotRow(floor, slots, geo, units) {
    const sl = slots.map(e => ({ ...e, slot: true }));
    const r = this.fitRow([...floor, ...sl], geo, units);
    let k = floor.length;
    while (k > 0 && floor[k - 1].kind === 'receiver') k--;
    if (r.level !== 'error' || k >= floor.length) return r;
    const r2 = this.fitRow([...floor.slice(0, k), ...sl, ...floor.slice(k)], geo, units);
    return r2.level !== 'error' ? r2 : r;
  }

  /** Ряды в заданном контейнере: высота, один ряд, при нехватке — два. Проход для оператора есть всегда. */
  fitRow(units, geo, all) {
    const g = this.G;
    const [L, Wi, H] = geo.int;
    const Lu = L - geo.x0 - 2 * g;
    const W = Wi - 2 * g;
    const hh = this.heights(all, H);
    this.inMods = !!(geo.mods && geo.mods.Lm);
    this.jGeo = this.inMods ? geo : null;
    this.closeOk = !!this.closeAll || (!geo.auto && !geo.road);
    const r = this.rowsOf(units, geo, Lu, W);
    const res = { geo, ext: geo.ext, int: geo.int };
    if (!r.ok) return Object.assign(res, this.rowError(r, hh, { Lu, Wi, g }));
    return Object.assign(res, this.rowPlan(r, hh, geo));
  }

  rowsOf(units, geo, Lu, W) {
    const r = this.altRows(units, Lu, W, this.firstRow(units, geo, Lu, W));
    if (this.dguSt) return r;
    if (this.jGeo && !this.mode.ends) return this.modRows(units, geo, Lu, W);
    return r.ok && this.jGeo ? this.joints.fit(r, geo, Lu, W) : r;
  }

  /** Один ряд не встал или с предупреждениями — два ряда; исключение «поперёк» — агрегат поперёк, две двери. */
  altRows(units, Lu, W, r) {
    if (this.dguSt) return r;
    if (!this.mode.ends && (!r.ok || warned(r))) {
      const r2 = this.rows.two(units, Lu, W);
      if (r2.ok && (!r.ok || !warned(r2))) r = r2;
    }
    if (!r.ok && this.mode.cross) {
      const r3 = this.rows.cross(units, Lu, W);
      if (r3.ok) r = r3;
    }
    return r;
  }

  firstRow(units, geo, Lu, W) {
    if (this.dguSt) return this.dgu.row(units, Lu, W);
    if (!this.mode.ends) return this.rows.one(units, Lu, W);
    return geo.x0 ? { ok: false, why: 'mode' } : this.rows.ends(units, Lu, W, geo.t || 0, LayoutOpening.gaps(geo).eL);
  }

  /** Из модулей: бок о бок — сначала два ряда (ряд в своей полосе модулей); на стыке — другой вариант. */
  modRows(units, geo, Lu, W) {
    const order = geo.mods.b > 1 ? ['row2', 'row1'] : ['row1', 'row2'];
    const V = order
      .map(k => (k === 'row2' ? this.rows.two(units, Lu, W) : this.rows.one(units, Lu, W)))
      .filter(q => q.ok);
    let first = null;
    let r = null;
    for (const q of V) {
      const j = this.joints.fit(q, geo, Lu, W);
      if (j.ok && (!r || (warned(r) && !warned(j)))) r = j;
      first = first || j;
      if (r && !warned(r)) break;
    }
    return r || first || this.rows.one(units, Lu, W);
  }

  rowError(r, hh, { Lu, Wi, g }) {
    const iss = [...hh.iss];
    const list = () =>
      r.bad
        .filter(e => !e.unit)
        .slice(0, 3)
        .map(e => `поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`)
        .join(', ');
    const texts = {
      joint: () =>
        `Поз. ${r.bad.map(e => e.pos).join(', ')} — на стыке модулей: каждый агрегат должен быть целиком в своём модуле (модуль везут с оборудованием внутри).`,
      mode: () => 'Без продольного прохода — только компрессорная (без ДГУ и насосов).',
      width: () =>
        `Не проходит по ширине: ${list()} — вместе с проходом для оператора и обслуживания, отступом от стены и зазором на коммуникации нужно ${n(r.needW + 2 * g)} мм, а ширина внутри — ${n(Wi)} мм.`,
    };
    const long = () =>
      `Не помещается по длине: нужно ${n(r.needL + 2 * g)} мм, а внутри контейнера ${n(Lu + 2 * g)} мм — не хватает ${n(r.needL - Lu)} мм.`;
    iss.unshift({ level: 'error', text: (texts[r.why] || long)() });
    return { level: 'error', issues: iss, need: { L: r.needL || null, W: r.needW || null } };
  }

  rowPlan(r, hh, geo) {
    const items = r.items.flatMap(it =>
      it.o.pair ? this.rows.unpair(it, geo) : [Object.assign(this.item(it, geo), it.o.ends ? { ends: true } : {})],
    );
    const iss = [...hh.iss, ...r.iss];
    const X = items.find(i => i.cross);
    const cross = X ? { pos: X.pos, x0: X.x, x1: X.x + X.lx } : null;
    const P = [...new Set(items.filter(i => i.pair).map(i => i.pos))];
    if (P.length) {
      const end = items.some(i => i.pairEnd) ? ', в конце ряда поперёк контейнера — станция короче' : '';
      iss.push({
        level: 'info',
        text: `Ресиверы поз. ${P.join(', ')} — в два ряда (один за другим${end}): осмотр и обслуживание заднего — сбоку, через промежутки между ресиверами.`,
      });
    }
    const entryX = r.entry ? r.entry.map(v => Math.round(geo.x0 + this.G + v)) : null;
    return {
      level: hh.bad ? 'error' : 'ok',
      bad: hh.bad,
      items,
      rows: r.rows,
      door: this.doorAt(cross, r, geo),
      cross,
      ends: this.endsOf(items),
      entryX,
      doors: null,
      aisle: { w: r.aisleW, rows: r.rows },
      issues: iss,
    };
  }

  /** Дверь оператора: агрегат поперёк — в стене прохода перед ним, если хватает места, иначе — в ближнем торце. */
  doorAt(cross, r, geo) {
    if (cross) return cross.x0 - geo.x0 >= StationLayout.ENTRY[1] + 100 ? 'side' : 'end';
    return !this.tank && r.rows === 2 ? 'end' : 'side';
  }

  /** Без продольного прохода: компрессоры у торца, что за ними, ресиверы парами у дальнего торца. */
  endsOf(items) {
    const CE = items.filter(i => i.ends).sort((a, b) => a.x - b.x);
    if (!CE.length) return null;
    const [C, CZ] = [CE[0], CE[CE.length - 1]];
    const after = items.filter(i => i.mount === 'floor' && !i.ends && i.x >= CZ.x + CZ.lx).sort((a, b) => a.x - b.x)[0];
    return {
      pos: C.pos,
      x0: C.x,
      x1: CZ.x + CZ.lx,
      n: CE.length,
      all: [...new Set(CE.map(i => i.pos))],
      next: (after || {}).pos || null,
      recv: [...new Set(items.filter(i => i.pairEnd).map(i => i.pos))],
    };
  }

  /** Окраска контейнера и рисунки заказчика на стенах снаружи. */
  colors() {
    const c = this.cont || {};
    const k = StationPaint.colors(c);
    return {
      wallColor: k.wall,
      frameColor: k.frame,
      roofColor: k.roof,
      doorColor: k.door,
      floorColor: k.floor,
      colorKnown: k.known,
      colorText: StationPaint.short(c),
      arts: StationPaint.arts(c),
      sys: c.sys || null,
    };
  }
}
