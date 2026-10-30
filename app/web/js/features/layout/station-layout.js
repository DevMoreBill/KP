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
import { AppVersion } from '../help.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Компоновка станции в контейнере: оборудование рядами с проходом обслуживания, двери и ворота, трубопровод, подбор размера
 * контейнера. Координаты внутри контейнера, мм: x — вдоль от торца с дверью, y — поперёк от стены прохода, z — от пола.
 */
export class StationLayout {
  static _warned = res => res.iss.some(i => i.level === 'warn');

  /**
   * Поля элемента, от которых компоновка не зависит: закупка; фото и рисунки — своими отпечатками (_hashPart); служебные
   * поля окна с «_» (текст в поле закупки, место замены, источник для ИИ) — тоже.
   */
  static NO_HASH = new Set(['cost', 'costCur', 'photo', 'draw']);
  static _service = key => key.startsWith('_');

  /** Версия правил и рисунков: изменилась — картинки станций в КП пересобираются. */
  static VER = 25;

  /** Компоновка станции по исходным данным. */
  static solve(input) {
    return new StationLayout(input).run();
  }

  /** Отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить. */
  static hash(input) {
    const rules = StationRules.ok() ? `${StationRules.version()}.${StationRules.stamp()}` : '';
    const app = AppVersion.current;
    const parts = (input.parts || [])
      .filter(part => part && part.role !== 'container')
      .map(part => StationLayout._hashPart(part));
    const text = JSON.stringify([
      StationLayout.VER,
      app,
      rules,
      StationClear.aisle(),
      StationLayout._hashCont(input.cont || {}),
      input.chassisH || null,
      input.recv || '',
      !!input.recvOut,
      input.req || null,
      parts,
    ]);
    return StationRules.fnv(text);
  }

  static _hashCont(cont) {
    const mods = cont.mods ? JSON.stringify(StationMods.rect(cont.mods.cells)) : null;
    return [
      cont.ctype,
      cont.size,
      cont.sizeAuto,
      cont.lenFix || null,
      cont.ins,
      StationPaint.stamp(cont),
      mods,
      cont.sys || null,
      cont.climate || '',
      cont.roof || '',
      StationGeo.floor(cont),
    ];
  }

  // всё, что есть у элемента (поля, строки характеристик, роль, вид ресивера, ступень…): расчёт читает их по месту
  static _hashPart(part) {
    const own = Object.keys(part)
      .filter(key => !StationLayout.NO_HASH.has(key) && !StationLayout._service(key))
      .sort()
      .map(key => [key, part[key]]);
    return [own, StationEquip.tint(part), StationEquip.tones(part), StationEquip.pic(part)];
  }

  /** Наибольшая длина станции, мм. */
  static get MAX_L() {
    return StationMatrix.fit().maxL;
  }
  /** Отступ воздушной магистрали от стены, мм. */
  static get AIR_Y() {
    return StationMatrix.grp('pipe').airY;
  }
  /** Размеры двери обслуживания. */
  static get DOOR() {
    return LayoutOpening.DOOR;
  }
  /** Размеры входной двери. */
  static get ENTRY() {
    return LayoutOpening.ENTRY;
  }
  /** Наименьшая ширина двери, мм. */
  static get DOOR_MIN() {
    return StationMatrix.door().w;
  }
  /** Проход для перемещения агрегатов, мм. */
  static get PASS() {
    return StationMatrix.move().pass;
  }
  /** Верх шкафов от пола, мм. */
  static get CAB_TOP() {
    return StationMatrix.cab().top;
  }
  /** Низ шкафов от пола, мм. */
  static get CAB_LOW() {
    return StationMatrix.cab().low;
  }
  /** Отступ наружного ресивера от стены, мм. */
  static get OUT_GAP() {
    return StationMatrix.recv().outGap;
  }
  /** Площадка под наружный ресивер, мм. */
  static get PAD() {
    return StationMatrix.recv().pad;
  }
  /** Ресиверы в два ряда. */
  static get RECV2() {
    return StationMatrix.fit().recv2;
  }
  /** Правила топливного бака. */
  static get TANK() {
    return LayoutTank.RULES;
  }
  /** Стороны обслуживания. */
  static get SIDE() {
    return LayoutAccess.SIDE;
  }
  /** Высота топливной трассы, мм. */
  static get FUEL_Z() {
    return LayoutPipes.FUEL_Z;
  }
  /** Зазоры проёмов от стен. */
  static gaps(geo) {
    return LayoutOpening.gaps(geo);
  }
  /** Ширина ворот обслуживания под агрегат. */
  static svcW(len, wallT = 0) {
    return LayoutOpening.svcW(len, wallT);
  }
  /** Высота ворот обслуживания под агрегат. */
  static svcH(heightIn, wallT, rear, height) {
    return LayoutOpening.svcH(heightIn, wallT, rear, height);
  }
  /** Ось ворот для текста. */
  static gateAxis(gate) {
    return LayoutMode.gateAxis(gate);
  }
  /** Последовательность агрегатов в трассе. */
  static series(unit) {
    return LayoutPipes.series(unit);
  }
  /** Участки трассы. */
  static runs(line) {
    return LayoutPipes.runs(line);
  }
  /** Путь выхода трубы через стену. */
  static outPath(line, wid) {
    return LayoutPipes.outPath(line, wid);
  }
  /** Ключ агрегата: код позиции и номер экземпляра. */
  static key(unit) {
    return `${unit.id}#${unit.unit}`;
  }

  /** Осушитель двумя колоннами: адсорбционный или генератор (вид — из цепочки сжатого воздуха, иначе по названию). */
  static twinDryer(item) {
    const type = item && item.air && item.air.type;
    if (type) return type === 'ads' || type === 'gen';
    return /адсорбц|десикант|adsorp|desicc/i.test(String((item && item.name) || ''));
  }

  constructor(input) {
    this.input = input || {};
    this.cont = this.input.cont || null;
    this.rows = new LayoutRows(this);
    this.dgu = new LayoutDgu(this);
    this.joints = new LayoutJoints(this);
    this.walls = new LayoutWalls(this);
    this.gates = new LayoutGates(this);
    this.exits = new LayoutExits(this);
    this.access = new LayoutAccess(this);
    this.size = new LayoutSize(this);
    this.notes = new LayoutNotes(this);
    this.equip = StationEquip.list(this.input.parts || [], { recv: this.input.recv, recvOut: this.input.recvOut });
    this.aisle0 = StationClear.aisle();
    this.aisle = this.aisle0;
    this.mode = {};
    const has = kind => this.equip.some(unit => unit.kind === kind);
    this.comp = has('compressor') && !has('dgu');
    this.gap = this.comp ? StationMatrix.gap() : 0;
    this.dguSt =
      this.equip.some(unit => unit.kind === 'dgu' && unit.place) &&
      !this.equip.some(unit => unit.place && (unit.kind === 'compressor' || unit.kind === 'pump'));
  }

  /** Режимы компоновки для этой станции. */
  modes() {
    return LayoutMode.list(this.comp);
  }

  /** Выполнить fn в режиме m. */
  withMode(nextMode, run) {
    const [aisle, mode] = [this.aisle, this.mode];
    this.mode = nextMode || {};
    this.aisle = LayoutMode.aisle(this.aisle0, this.mode);
    try {
      return run();
    } finally {
      this.aisle = aisle;
      this.mode = mode;
    }
  }

  /** Компоновка: размер, расстановка, системы, замечания. */
  run() {
    const placed = this.equip.filter(unit => unit.place);
    const extra = this.equip.filter(unit => !unit.place);
    const chassis = extra.some(unit => unit.kind === 'chassis');
    const base = {
      items: [],
      extra,
      chassis,
      muffler: extra.some(unit => unit.kind === 'muffler'),
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
    this.wallT = geo.t || 0;
    let plan = this.place(units, geo, chassis);
    plan = Object.assign(base, plan, { issues: plan.issues || [] }, this.colors());
    this.check(plan);
    this.notes.plan(plan);
    if (plan.level === 'ok' && plan.issues.some(i => i.level === 'warn')) plan.level = 'warn';
    return this.size.grow(plan, geo);
  }

  /** ДГУ с дополнительным баком — бак в отдельном отсеке у ближнего торца; по оборудованию — в ширине блок-контейнера 2 300 мм. */
  tankRoom(units) {
    const geo0 = StationGeo.of(this.cont);
    const in0 = geo0.int || StationGeo.inner(geo0.type, [10000, StationGeo.ROAD_W, 2600], geo0.t);
    const We = geo0.int ? geo0.ext[1] : Math.min(StationGeo.ROAD_W, 2300);
    const widIn = geo0.int ? in0[1] : StationGeo.inner(geo0.type, [10000, We, 2600], geo0.t)[1];
    const entryW = LayoutOpening.gaps({ ext: [0, We, 0], int: [0, widIn, 0] }).eW;
    this.tank = LayoutTank.room(units, widIn, in0[2], !!geo0.sea, widIn - 2 * entryW);
    return this.tank ? units.filter(unit => unit.kind !== 'tank') : units;
  }

  /** Расстановка и снаружи (глушители, выхлоп, выход трубы, ресиверы); «не помещается» без условных габаритов — точно. */
  place(units, geo, chassis) {
    const fit = list => (geo.auto ? this.size.auto(list, geo) : this.fit(list, geo));
    const plan = !geo.auto && this.input._mode ? this.fit(units, geo, [this.input._mode]) : fit(units);
    if (plan.level === 'error') {
      if (!geo.auto) plan.suggest = this.size.suggest(units, geo);
      if (units.some(unit => !unit.known)) {
        const known = units.filter(unit => unit.known);
        plan.assumed = !known.length || fit(known).level !== 'error';
      }
      return plan;
    }
    if (!geo.auto && !this.input._grow) this.size.excess(units, geo, plan);
    if (plan.items && plan.items.length) this.outside(plan, chassis);
    return plan;
  }

  /** Оборудование на крыше и снаружи. */
  outside(plan, chassis) {
    plan.roof = LayoutRoof.roof(plan, this.equip);
    plan.exhausts = LayoutRoof.exhausts(plan);
    LayoutPipes.outlet(
      plan,
      this.equip.some(unit => unit.outside),
    );
    plan.piping = LayoutPipes.route(plan, this.equip);
    plan.outside = LayoutRoof.outside(plan, this.equip, chassis);
    this.notes.mods(plan);
  }

  /** Сжатый воздух, сосуды под давлением, системы контейнера, нормы. */
  check(plan) {
    this.air(plan);
    const bar = Math.max(
      0,
      ...this.equip.filter(unit => unit.kind === 'compressor' && unit.air).map(unit => unit.air.bar || 0),
    );
    plan.vessels = PressureVessel.list(this.equip, bar);
    plan.req = this.input.req || null;
    plan.climate = (this.cont && this.cont.climate) || '';
    if (plan.geo && plan.geo.ext) plan.geo.rise = StationGeo.rise(plan.geo.roof, plan.geo.ext[1]);
    if (plan.level !== 'error' && plan.geo && plan.geo.ext && plan.int) this.systems(plan);
    if (plan.level !== 'error') StationNorms.check(plan, this.equip);
  }

  /** Проверка воздушной цепочки. */
  air(plan) {
    const req = this.input.req || {};
    const air = AirChain.check(this.equip, this.input.air, req.recvIn, req.dryer);
    if (air && plan.level !== 'error') {
      plan.air = air;
      plan.issues.push(...air.issues);
    }
  }

  /** Системы станции: отопление, вентиляция, свет, электрика, пожаротушение. */
  systems(plan) {
    plan.heat = StationHeat.calc(plan);
    plan.fire = StationFire.calc(plan);
    plan.light = StationLight.calc(plan);
    plan.sockets = StationSockets.calc(plan);
    plan.pipe = StationPipe.calc(plan);
    plan.mass = StationMass.calc(plan);
    plan.issues.push(...StationMass.issues(plan.mass));
    plan.vent = StationVent.calc(plan);
    plan.power = StationPower.calc(plan); // после вентиляции: приточные и вытяжные вентиляторы — в нагрузке
    plan.tidy = StationTidy.score(plan, plan.geo);
    if (plan.fire.low) {
      plan.issues.push({
        level: 'info',
        text: `Высота помещения ${Mm.text(plan.int[2])} мм — ниже паспортной высоты установки модулей «Буран-2,5» (2,5–3,5 м): зона тушения — по диаграмме распыла изготовителя при этой высоте (согласовать с проектировщиком пожаротушения).`,
      });
    }
    const pipe = plan.pipe;
    if (pipe && pipe.small) {
      plan.issues.push({
        level: 'warn',
        text: `Трубопровод DN ${pipe.set} меньше расчётного DN ${pipe.dn} (${pipe.why}): скорость больше ${Mm.dec(pipe.lines[0].v)} м/с — потери давления и шум. Укажите DN ${pipe.dn} в составе станции.`,
      });
    }
  }

  /** Единицы оборудования по порядку от двери: шкафы, остальное по составу (воздух — по ходу), бак, ДГУ — в дальнем торце. */
  units(placed) {
    const u = placed.flatMap(unit =>
      Array.from({ length: unit.qty }, (_, k) => ({
        ...unit,
        unit: k,
        c: this.clear(unit),
        air: AirChain.unit(unit.air, k),
      })),
    );
    const dgu = placed.some(unit => unit.kind === 'dgu');
    const air = placed.some(unit => unit.kind === 'compressor');
    const rank = unit => {
      if (unit.kind === 'cabinet') return 0;
      if (unit.kind === 'dgu') return 2;
      if (unit.kind === 'tank' && dgu) return 1.5;
      if (air && unit.air && unit.air.stage != null) return 1 + unit.air.stage / 100;
      return air ? 1.8 : 1;
    };
    return u
      .map((unit, i) => [unit, i])
      .sort((left, right) => rank(left[0]) - rank(right[0]) || left[1] - right[1])
      .map(([unit]) => unit);
  }

  /** Отступы агрегата: нормы вида и матрица расстановки; «плотно» сзади — только виду с сервисными воротами. */
  clear(unit) {
    const clear = StationClear.of(unit.kind, unit);
    const wall = StationMatrix.wall(unit);
    if (unit.kind === 'dgu') {
      const rad = StationMatrix.grp('dgu').rad;
      return { ...clear, far: [rad, rad] };
    }
    if (!wall || unit.kind === 'cabinet' || unit.kind === 'tank') return clear;
    return {
      ...clear,
      back: [wall[0], LayoutGates.gated(unit.kind) ? wall[1] : Math.max(wall[1], Math.min(wall[0], clear.back[1]))],
    };
  }

  /** Геометрия контейнера: оборудование — после отсека бака. */
  geoOf(cont) {
    const geo = StationGeo.of(cont);
    if (this.tank) geo.x0 = (geo.x0 || 0) + this.tank.len;
    return geo;
  }

  /** Перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё). */
  front(unit) {
    return [this.aisle[0], unit.c.front != null ? Math.min(this.aisle[1], unit.c.front) : this.aisle[1]];
  }

  /** Агрегат ряда в координатах помещения. */
  item(item, geo) {
    return LayoutItem.floor(item, geo, this.gap);
  }

  /** Высота: оборудование и место над ним; шкаф на стене — не ниже CAB_LOW; фильтры висят на трубе. */
  heights(units, height) {
    const iss = [];
    for (const unit of units) {
      if (unit.unit || unit.pipe) continue;
      if (unit.mount === 'wall') {
        if (unit.h + StationLayout.CAB_LOW > height - 50) {
          iss.push({
            level: 'error',
            text: `Поз. ${unit.pos} «${unit.short}» не помещается на стене по высоте: ${Mm.text(unit.h)} мм и не ниже ${Mm.text(StationLayout.CAB_LOW)} мм от пола, а высота внутри — ${Mm.text(height)} мм.`,
          });
        }
      } else {
        this._headroom(unit, height, iss);
      }
    }
    return { bad: iss.some(i => i.level === 'error'), iss };
  }

  _headroom(unit, height, iss) {
    const top = unit.c.top;
    const room = height - unit.h;
    if (room < top[1]) {
      const vol =
        unit.air && unit.air.vol > 0 ? ` (например, 2 × ${Mm.text(Math.ceil(unit.air.vol / 2 / 100) * 100)} л)` : '';
      const recv =
        unit.kind === 'receiver'
          ? ` Замените на горизонтальный ресивер или несколько меньших${vol}, либо ресивер — снаружи (ФНП ОРПД, п. 65).`
          : '';
      iss.push({
        level: 'error',
        text: `Поз. ${unit.pos} «${unit.short}» не проходит по высоте: ${Mm.text(unit.h)} мм и не менее ${Mm.text(top[1])} мм над ним, а высота внутри — ${Mm.text(height)} мм.${recv}`,
      });
    } else if (room < top[0] && unit.kind === 'compressor') {
      iss.push({
        level: 'info',
        text: `Над компрессором (поз. ${unit.pos}) ${Mm.text(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).`,
      });
    } else if (room < top[0]) {
      iss.push({
        level: 'warn',
        text: `Над поз. ${unit.pos} «${unit.short}» ${Mm.text(room)} мм до потолка — рекомендуется ${Mm.text(top[0])} мм.`,
      });
    }
  }

  /** Заданный контейнер: сначала как обычно, не помещается — исключения; нигде — ответ обычного режима (он понятнее). */
  fit(units, geo, modes) {
    let first = null;
    for (const mode of modes || this.modes()) {
      const res = this.withMode(mode, () => this.fit0(units, geo));
      if (res.level !== 'error') {
        this.notes.mode(res, mode, geo);
        if (mode.tight || mode.cross || mode.ends)
          res.level = res.issues.some(i => i.level === 'warn') ? 'warn' : res.level;
        return res;
      }
      first = first || res;
    }
    return first;
  }

  /** Пол — рядами; шкафы — на стене прохода, фильтры — на трубе; не нашлось им места — своё место в ряду. */
  fit0(units, geo) {
    let wall = units.filter(unit => unit.mount === 'wall');
    let hang = units.filter(unit => unit.pipe);
    let floor = units.filter(unit => !unit.pipe && unit.mount !== 'wall');
    if (!floor.length) {
      floor = units.map(unit => ({ ...unit, slot: true }));
      wall = [];
      hang = [];
    }
    const pass = avoid => {
      const row = this.fitRow(floor, geo, units);
      if (row.level === 'error') return { q: row, left: [] };
      if (this.tank) LayoutTank.place(row, geo, this.tank);
      this.gates.plan(row, geo, avoid);
      return { q: row, left: this.walls.attach(row, wall, hang, geo) };
    };
    let { q: res, left } = pass([]);
    if (res.level === 'error') return res;
    ({ r: res, left } = this.wallsFirst(res, left, pass));
    res = this.slots({ r: res, left, floor, wall, hang, geo, units });
    if (res.level !== 'error') this.exits.finish(res, geo);
    return res;
  }

  /** Ворота заняли торец и шкафам не хватило стены — шкафы важнее: ворота в другом торце, нет места — сервисная дверь. */
  wallsFirst(res, left, pass) {
    for (const avoid of [res.gates && !res.gates.sea ? [res.gates.wall] : null, ['left', 'right']]) {
      if (!left.length || !avoid || !(res.gates && !res.gates.sea)) break;
      const tried = pass(avoid);
      if (tried.left.length < left.length) {
        res = tried.q;
        left = tried.left;
      }
    }
    return { r: res, left };
  }

  /** Не нашлось места на стене или трубе — своё место в ряду (в конце, иначе перед ресиверами в конце ряда). */
  slots({ r: res, left, floor, wall, hang, geo, units }) {
    for (let slots = left; left.length; slots = [...slots, ...left]) {
      const ids = new Set(slots.map(StationLayout.key));
      const rest = unit => !ids.has(StationLayout.key(unit));
      const res2 = this._slotRow(floor, slots, geo, units);
      if (res2.level === 'error') return res2;
      if (this.tank) LayoutTank.place(res2, geo, this.tank);
      this.gates.plan(res2, geo);
      left = this.walls.attach(res2, wall.filter(rest), hang.filter(rest), geo);
      res = res2;
    }
    return res;
  }

  _slotRow(floor, slots, geo, units) {
    const slotted = slots.map(unit => ({ ...unit, slot: true }));
    const res = this.fitRow([...floor, ...slotted], geo, units);
    let k = floor.length;
    while (k > 0 && floor[k - 1].kind === 'receiver') k--;
    if (res.level !== 'error' || k >= floor.length) return res;
    const res2 = this.fitRow([...floor.slice(0, k), ...slotted, ...floor.slice(k)], geo, units);
    return res2.level !== 'error' ? res2 : res;
  }

  /** Ряды в заданном контейнере: высота, один ряд, при нехватке — два. Проход для оператора есть всегда. */
  fitRow(units, geo, all) {
    const gap = this.gap;
    const [len, Wi, height] = geo.int;
    const lenMax = len - geo.x0 - 2 * gap;
    const wid = Wi - 2 * gap;
    const heights = this.heights(all, height);
    this.inMods = !!(geo.mods && geo.mods.Lm);
    this.jGeo = this.inMods ? geo : null;
    this.closeOk = !!this.closeAll || (!geo.auto && !geo.road);
    const rowRes = this._rowsOf(units, geo, lenMax, wid);
    const res = { geo, ext: geo.ext, int: geo.int };
    if (!rowRes.ok) return Object.assign(res, this.rowError(rowRes, heights, { Lu: lenMax, Wi, g: gap }));
    return Object.assign(res, this._rowPlan(rowRes, heights, geo));
  }

  _rowsOf(units, geo, lenMax, wid) {
    const res = this.altRows(units, lenMax, wid, this._firstRow(units, geo, lenMax, wid));
    if (this.dguSt) return res;
    if (this.jGeo && !this.mode.ends) return this.modRows(units, geo, lenMax, wid);
    return res.ok && this.jGeo ? this.joints.fit(res, geo, lenMax, wid) : res;
  }

  /** Один ряд не встал или с предупреждениями — два ряда; исключение «поперёк» — агрегат поперёк, две двери. */
  altRows(units, lenMax, wid, res) {
    if (this.dguSt) return res;
    if (!this.mode.ends && (!res.ok || StationLayout._warned(res))) {
      const res2 = this.rows.two(units, lenMax, wid);
      if (res2.ok && (!res.ok || !StationLayout._warned(res2))) res = res2;
    }
    if (!res.ok && this.mode.cross) {
      const res3 = this.rows.cross(units, lenMax, wid);
      if (res3.ok) res = res3;
    }
    return res;
  }

  _firstRow(units, geo, lenMax, wid) {
    if (this.dguSt) return this.dgu.row(units, lenMax, wid);
    if (!this.mode.ends) return this.rows.one(units, lenMax, wid);
    return geo.x0
      ? { ok: false, why: 'mode' }
      : this.rows.ends(units, lenMax, wid, geo.t || 0, LayoutOpening.gaps(geo).eL);
  }

  /** Из модулей: бок о бок — сначала два ряда (ряд в своей полосе модулей); на стыке — другой вариант. */
  modRows(units, geo, lenMax, wid) {
    const order = geo.mods.b > 1 ? ['row2', 'row1'] : ['row1', 'row2'];
    const variants = order
      .map(k => (k === 'row2' ? this.rows.two(units, lenMax, wid) : this.rows.one(units, lenMax, wid)))
      .filter(cand => cand.ok);
    let first = null;
    let res = null;
    for (const cand of variants) {
      const j = this.joints.fit(cand, geo, lenMax, wid);
      if (j.ok && (!res || (StationLayout._warned(res) && !StationLayout._warned(j)))) res = j;
      first = first || j;
      if (res && !StationLayout._warned(res)) break;
    }
    return res || first || this.rows.one(units, lenMax, wid);
  }

  /** Отказ расстановки ряда с причиной. */
  rowError(res, heights, { Lu: lenMax, Wi, g: gap }) {
    const iss = [...heights.iss];
    const list = () =>
      res.bad
        .filter(unit => !unit.unit)
        .slice(0, 3)
        .map(unit => `поз. ${unit.pos} «${unit.short}» (${Mm.text(unit.w)} мм)`)
        .join(', ');
    const texts = {
      joint: () =>
        `Поз. ${res.bad.map(unit => unit.pos).join(', ')} — на стыке модулей: каждый агрегат должен быть целиком в своём модуле (модуль везут с оборудованием внутри).`,
      mode: () => 'Без продольного прохода — только компрессорная (без ДГУ и насосов).',
      width: () =>
        `Не проходит по ширине: ${list()} — вместе с проходом для оператора и обслуживания, отступом от стены и зазором на коммуникации нужно ${Mm.text(res.needW + 2 * gap)} мм, а ширина внутри — ${Mm.text(Wi)} мм.`,
    };
    const long = () =>
      `Не помещается по длине: нужно ${Mm.text(res.needL + 2 * gap)} мм, а внутри контейнера ${Mm.text(lenMax + 2 * gap)} мм — не хватает ${Mm.text(res.needL - lenMax)} мм.`;
    iss.unshift({ level: 'error', text: (texts[res.why] || long)() });
    return { level: 'error', issues: iss, need: { L: res.needL || null, W: res.needW || null } };
  }

  _rowPlan(res, heights, geo) {
    const items = res.items.flatMap(item =>
      item.o.pair
        ? this.rows.unpair(item, geo)
        : [Object.assign(this.item(item, geo), item.o.ends ? { ends: true } : {})],
    );
    const iss = [...heights.iss, ...res.iss];
    const crossItem = items.find(i => i.cross);
    const cross = crossItem ? { pos: crossItem.pos, x0: crossItem.x, x1: crossItem.x + crossItem.lx } : null;
    const pairs = [...new Set(items.filter(i => i.pair).map(i => i.pos))];
    if (pairs.length) {
      const end = items.some(i => i.pairEnd) ? ', в конце ряда поперёк контейнера — станция короче' : '';
      iss.push({
        level: 'info',
        text: `Ресиверы поз. ${pairs.join(', ')} — в два ряда (один за другим${end}): осмотр и обслуживание заднего — сбоку, через промежутки между ресиверами.`,
      });
    }
    const entryX = res.entry ? res.entry.map(v => Math.round(geo.x0 + this.gap + v)) : null;
    return {
      level: heights.bad ? 'error' : 'ok',
      bad: heights.bad,
      items,
      rows: res.rows,
      door: this.doorAt(cross, res, geo),
      cross,
      ends: this.endsOf(items),
      entryX,
      doors: null,
      aisle: { w: res.aisleW, rows: res.rows },
      issues: iss,
    };
  }

  /** Дверь оператора: агрегат поперёк — в стене прохода перед ним, если хватает места, иначе — в ближнем торце. */
  doorAt(cross, res, geo) {
    if (cross) return cross.x0 - geo.x0 >= StationLayout.ENTRY[1] + 100 ? 'side' : 'end';
    return !this.tank && res.rows === 2 ? 'end' : 'side';
  }

  /** Без продольного прохода: компрессоры у торца, что за ними, ресиверы парами у дальнего торца. */
  endsOf(items) {
    const comps = items.filter(i => i.ends).sort((left, right) => left.x - right.x);
    if (!comps.length) return null;
    const [first, last] = [comps[0], comps[comps.length - 1]];
    const after = items
      .filter(i => i.mount === 'floor' && !i.ends && i.x >= last.x + last.lx)
      .sort((left, right) => left.x - right.x)[0];
    return {
      pos: first.pos,
      x0: first.x,
      x1: last.x + last.lx,
      n: comps.length,
      all: [...new Set(comps.map(i => i.pos))],
      next: (after || {}).pos || null,
      recv: [...new Set(items.filter(i => i.pairEnd).map(i => i.pos))],
    };
  }

  /** Окраска контейнера и рисунки заказчика на стенах снаружи. */
  colors() {
    const cont = this.cont || {};
    const k = StationPaint.colors(cont);
    return {
      wallColor: k.wall,
      frameColor: k.frame,
      roofColor: k.roof,
      doorColor: k.door,
      floorColor: k.floor,
      colorKnown: k.known,
      colorText: StationPaint.short(cont),
      arts: StationPaint.arts(cont),
      sys: cont.sys || null,
    };
  }
}
