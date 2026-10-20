import { EskdSheet } from '../eskd/eskd-sheet.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationVent } from '../layout/station-vent.js';
import { DrawText } from './draw-text.js';
import { DrawSheets } from './draw-sheets.js';
import { DrawSling } from './draw-sling.js';
import { DrawSide } from './draw-side.js';
import { DrawEnds } from './draw-ends.js';
import { DrawPlan } from './draw-plan.js';

/** Габаритный чертёж станции по ЕСКД (листы А4). */
export class StationDrawing {
  /** Ширина листа А4, точек. */
  static get WIDTH() {
    return EskdSheet.FMT.A4[0] * EskdSheet.DOTS_PER_MM;
  }
  /** Высота листа А4, точек. */
  static get HEIGHT() {
    return EskdSheet.FMT.A4[1] * EskdSheet.DOTS_PER_MM;
  }
  static TITLE_TOP = 237;
  static TOP = 22; // ниже графы 26
  // морские контейнеры
  static FIT = { 2991: 2787, 6058: 5853, 9125: 8918, 12192: 11985 };
  static FIT_W = 2259;

  /** Plan — StationLayout.solve(...); meta: {title, cont, colorText, deck, org, dev, date}. */
  static svg(plan, meta = {}) {
    return new StationDrawing(plan, meta).layout.sheets()[0];
  }
  /** Все листы чертежа — массив SVG. */
  static sheets(plan, meta = {}) {
    return new StationDrawing(plan, meta).layout.sheets();
  }

  constructor(plan, meta) {
    this.text = new DrawText(this);
    this.layout = new DrawSheets(this);
    this.sling = new DrawSling(this);
    this.side = new DrawSide(this);
    this.ends = new DrawEnds(this);
    this.planView = new DrawPlan(this);
    this.plan = plan;
    this.meta = meta || {};
    this.highlight = this.meta.hl || null; // подсветка «Показать на чертеже»
    this.sizes(plan);
    this.doors(plan);
    this.swings(plan);
    this.extras(plan);
    this.outlets();
    this.positions(plan);
  }

  /** Габариты, отступы стенок, пол, крыша, трубопровод и проход. */
  sizes(plan) {
    const geo = plan.geo;
    this.geo = geo;
    [this.Le, this.We, this.He] = geo.ext;
    [this.Li, this.Wi, this.Hi] = plan.int;
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.floorZ = StationGeo.zFloor(geo.type);
    this.dz = plan.chassis ? this.meta.deck || 1150 : 0;
    this.roofItems = plan.roof || [];
    this.roofRise = this.roofItems.length ? Math.max(...this.roofItems.map(item => item.gap + item.d)) : 0; // глушитель на крыше
    this.rise = geo.rise || 0;
    this.fuel = plan.fuel || null;
    this.heaters = (plan.heat && plan.heat.heaters) || [];
    this.pipes = plan.piping || [];
    this.lines = this.pipes.length ? this.pipes[0].lines : [];
    this.aisle = DrawPlan.aisle(plan);
    this.mass = plan.mass || null;
  }

  /** Двери оператора, ворота в торцах, сервисные, двери-жалюзи и выхлоп ДГУ. */
  doors(plan) {
    const service = plan.doors || [];
    this.dguDoors = plan.dguDoors || (plan.dguDoor ? [plan.dguDoor] : []);
    this.dguRight = this.dguDoors.find(door => door.wall === 'right') || null;
    this.dguLeft = this.dguDoors.find(door => door.wall === 'left') || null;
    this.dguBack = this.dguDoors.filter(door => door.wall === 'back');
    this.wallExhausts = (plan.exhausts || []).filter(exhaust => exhaust.how === 'wall');
    this.entry = plan.entry || null;
    this.gate = plan.gates || null;
    this.gates = [plan.gates, plan.gates2].filter(Boolean);
    this.serviceFront = service.filter(door => door.wall !== 'back');
    this.serviceBack = service.filter(door => door.wall === 'back');
  }

  /** Место на плане под открытые створки и маркизы на жалюзи: спереди, сзади, у торцов. */
  swings(plan) {
    const leaf = doorList => (doorList.length ? Math.max(...doorList.map(door => door.w / door.leaves)) : 0);
    const louvers = (plan.vent && plan.vent.louvers) || [];
    const hoodDepth = wall =>
      Math.max(0, ...louvers.filter(louver => louver.hood && louver.wall === wall).map(louver => louver.hood.d));
    const entryW = this.entry && this.entry.wall === 'front' ? this.entry.w : 0;
    const fuelDoor = this.fuel && this.fuel.door ? this.fuel.door.x1 - this.fuel.door.x0 : 0;
    this.swing = Math.max(entryW, leaf(this.serviceFront), fuelDoor, hoodDepth('front'));
    this.swingB = Math.max(leaf(this.serviceBack), ...this.dguBack.map(door => door.w / 2), hoodDepth('back'));
    this.swingR = Math.max(this.dguRight ? this.dguRight.w / 2 : 0, hoodDepth('right'));
    this.hoodLeft = Math.max(hoodDepth('left'), this.dguLeft ? this.dguLeft.w / 2 : 0);
    this.hoodRight = hoodDepth('right');
  }

  /** Ресиверы снаружи (длина с площадкой), колпаки на крыше, высота над крышей; шкафы на стене прохода — не на разрезе А–А. */
  extras(plan) {
    this.outside = plan.outside || [];
    this.outL = this.outside.length ? Math.max(...this.outside.map(i => this.ox + i.x + i.lx + 200)) - this.Le : 0;
    this.hood = plan.vent && (plan.vent.roof || []).length ? StationVent.HOOD : 0;
    this.hTop = Math.max(
      this.roofRise,
      this.hood,
      this.rise,
      ...this.outside.map(i => this.floorZ + i.z + i.h - this.He),
    );
    this.hidden = plan.items.filter(i => i.mount === 'wall' && i.wall === 'front');
  }

  /** Выходы трубопровода: через дальний торец (над проёмом — с подъёмом) и через боковую стену; фитинги морского. */
  outlets() {
    this.outs = this.lines
      .filter(line => line.label && (line.out ? line.out.wall === 'right' : line.x1 >= this.Li - 1))
      .map(line => ({ y: line.y, z: line.out ? line.out.z : line.z, l: line }))
      .sort((first, second) => first.z - second.z);
    this.souts = this.lines
      .filter(line => line.out && (line.out.wall === 'back' || line.out.wall === 'front'))
      .map(line => ({ x: line.out.x, y: line.y, z: line.z, wall: line.out.wall, l: line }));
    this.flange = this.outside.length ? 0 : StationMatrix.grp('pipe').flange;
    const fitLen = StationDrawing.FIT[this.Le];
    this.fit = this.geo.sea && fitLen ? [fitLen, StationDrawing.FIT_W] : null;
  }

  /** Номера позиций — на плане, каждый один раз (глушитель на крыше и трубопровод — если их нет среди расставленных). */
  positions(plan) {
    const first = new Map();
    for (const item of [...plan.items, ...this.outside].sort((left, right) => left.x - right.x))
      if (!first.has(item.pos)) first.set(item.pos, item);
    this.posPlan = [...first.values()];
    this.posRoof = this.roofItems.filter(
      (roofItem, k, list) => list.findIndex(other => other.pos === roofItem.pos) === k && !first.has(roofItem.pos),
    );
    this.pipePos = this.pipes.find(other => other.pos != null && !first.has(other.pos)) || null;
    this.nPos = this.posPlan.length + this.posRoof.length + (this.pipePos ? 1 : 0);
  }

  /** Поле изображений. */
  static FLD = { L0: 25, L1: 200, TOP: 22, BOT: 274 };
  static ROT = { L0: 0, L1: 252, TOP: 0, BOT: 175, rot: true };
  /** Наибольший масштаб из ряда, при котором ok(k). */
  static scaleFor(ok) {
    for (const denom of EskdSheet.SCALES.filter(value => value >= 10)) {
      const res = ok(1 / denom);
      if (res) return Object.assign({ N: denom, k: 1 / denom }, res);
    }
    const denom = EskdSheet.SCALES[EskdSheet.SCALES.length - 1];
    return Object.assign({ N: denom, k: 1 / denom }, ok(1 / denom, true) || {});
  }
  /** Разрез А–А на листе 1 мельче 1:100 (технические требования длинные) — отдельным листом 2. */
  static MIN_N = 100;
  /** Разрез А–А: x вдоль контейнера → лист. */
  sheetX(x) {
    return this.left + x * this.scale;
  }
  /** Высота → лист. */
  sheetZ(z) {
    return this.ground - (this.dz + z) * this.scale;
  }
  /** Жалюзи вентиляции по расчёту (StationVent) на стене w. */
  vents(wall, leaf = false) {
    return ((this.plan.vent && this.plan.vent.louvers) || []).filter(
      louver => louver.wall === wall && !louver.door && !!louver.leaf === leaf,
    );
  }
  /** Выброс через крышу (колпаки). */
  hoods() {
    return (this.plan.vent && this.plan.vent.roof) || [];
  }
}
