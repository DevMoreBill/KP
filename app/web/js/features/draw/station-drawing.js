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
  static get W() {
    return EskdSheet.FMT.A4[0] * EskdSheet.K;
  }
  static get H() {
    return EskdSheet.FMT.A4[1] * EskdSheet.K;
  }
  static TB = 237; // верх основной надписи, мм листа
  static L0 = 25; // поле изображений по ширине
  static L1 = 200;
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
    this.p = plan;
    this.m = meta || {};
    this.hl = this.m.hl || null; // подсветка «Показать на чертеже»
    this.sizes(plan);
    this.doors(plan);
    this.swings(plan);
    this.extras(plan);
    this.outlets();
    this.positions(plan);
  }

  sizes(plan) {
    const g = plan.geo;
    this.g = g;
    [this.Le, this.We, this.He] = g.ext;
    [this.Li, this.Wi, this.Hi] = plan.int;
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.zf = StationGeo.zFloor(g.type);
    this.dz = plan.chassis ? this.m.deck || 1150 : 0;
    this.rf = plan.roof || [];
    this.up = this.rf.length ? Math.max(...this.rf.map(m => m.gap + m.d)) : 0; // глушитель на крыше
    this.rise = g.rise || 0;
    this.fuel = plan.fuel || null;
    this.heaters = (plan.heat && plan.heat.heaters) || [];
    this.pipes = plan.piping || [];
    this.lines = this.pipes.length ? this.pipes[0].lines : [];
    this.ai = DrawPlan.aisle(plan);
    this.ms = plan.mass || null;
  }

  /** Двери оператора, ворота в торцах, сервисные, двери-жалюзи и выхлоп ДГУ. */
  doors(plan) {
    const sd = plan.doors || [];
    this.dgs = plan.dguDoors || (plan.dguDoor ? [plan.dguDoor] : []);
    this.dg = this.dgs.find(d => d.wall === 'right') || null;
    this.dgL = this.dgs.find(d => d.wall === 'left') || null;
    this.dgB = this.dgs.filter(d => d.wall === 'back');
    this.exW = (plan.exhausts || []).filter(e => e.how === 'wall');
    this.en = plan.entry || null;
    this.gt = plan.gates || null;
    this.gts = [plan.gates, plan.gates2].filter(Boolean);
    this.sdF = sd.filter(d => d.wall !== 'back');
    this.sdB = sd.filter(d => d.wall === 'back');
  }

  /** Место на плане под открытые створки и маркизы на жалюзи: спереди, сзади, у торцов. */
  swings(plan) {
    const leaf = D => (D.length ? Math.max(...D.map(d => d.w / d.leaves)) : 0);
    const L = (plan.vent && plan.vent.louvers) || [];
    const mk = w => Math.max(0, ...L.filter(q => q.hood && q.wall === w).map(q => q.hood.d));
    const en = this.en && this.en.wall === 'front' ? this.en.w : 0;
    const fd = this.fuel && this.fuel.door ? this.fuel.door.x1 - this.fuel.door.x0 : 0;
    this.swing = Math.max(en, leaf(this.sdF), fd, mk('front'));
    this.swingB = Math.max(leaf(this.sdB), ...this.dgB.map(d => d.w / 2), mk('back'));
    this.swingR = Math.max(this.dg ? this.dg.w / 2 : 0, mk('right'));
    this.mkL = Math.max(mk('left'), this.dgL ? this.dgL.w / 2 : 0);
    this.mkR = mk('right');
  }

  /** Ресиверы снаружи (длина с площадкой), колпаки на крыше, высота над крышей; шкафы на стене прохода — не на разрезе А–А. */
  extras(plan) {
    this.ext = plan.outside || [];
    this.outL = this.ext.length ? Math.max(...this.ext.map(i => this.ox + i.x + i.lx + 200)) - this.Le : 0;
    this.hood = plan.vent && (plan.vent.roof || []).length ? StationVent.HOOD : 0;
    this.hTop = Math.max(this.up, this.hood, this.rise, ...this.ext.map(i => this.zf + i.z + i.h - this.He));
    this.hidden = plan.items.filter(i => i.mount === 'wall' && i.wall === 'front');
  }

  /** Выходы трубопровода: через дальний торец (над проёмом — с подъёмом) и через боковую стену; фитинги морского. */
  outlets() {
    this.outs = this.lines
      .filter(l => l.label && (l.out ? l.out.wall === 'right' : l.x1 >= this.Li - 1))
      .map(l => ({ y: l.y, z: l.out ? l.out.z : l.z, l }))
      .sort((a, b) => a.z - b.z);
    this.souts = this.lines
      .filter(l => l.out && (l.out.wall === 'back' || l.out.wall === 'front'))
      .map(l => ({ x: l.out.x, y: l.y, z: l.z, wall: l.out.wall, l }));
    this.flg = this.ext.length ? 0 : StationMatrix.grp('pipe').flange;
    const F = StationDrawing.FIT[this.Le];
    this.fit = this.g.sea && F ? [F, StationDrawing.FIT_W] : null;
  }

  /** Номера позиций — на плане, каждый один раз (глушитель на крыше и трубопровод — если их нет среди расставленных). */
  positions(plan) {
    const first = new Map();
    for (const it of [...plan.items, ...this.ext].sort((a, b) => a.x - b.x))
      if (!first.has(it.pos)) first.set(it.pos, it);
    this.posPlan = [...first.values()];
    this.posRoof = this.rf.filter((m, k, A) => A.findIndex(q => q.pos === m.pos) === k && !first.has(m.pos));
    this.pipePos = this.pipes.find(q => q.pos != null && !first.has(q.pos)) || null;
    this.nPos = this.posPlan.length + this.posRoof.length + (this.pipePos ? 1 : 0);
  }

  /** Поле изображений. */
  static FLD = { L0: 25, L1: 200, TOP: 22, BOT: 274 };
  static ROT = { L0: 0, L1: 252, TOP: 0, BOT: 175, rot: true };
  /** Наибольший масштаб из ряда, при котором ok(k). */
  static scaleFor(ok) {
    for (const N of EskdSheet.SCALES.filter(v => v >= 10)) {
      const r = ok(1 / N);
      if (r) return Object.assign({ N, k: 1 / N }, r);
    }
    const N = EskdSheet.SCALES[EskdSheet.SCALES.length - 1];
    return Object.assign({ N, k: 1 / N }, ok(1 / N, true) || {});
  }
  /** Разрез А–А на листе 1 мельче 1:100 (технические требования длинные) — отдельным листом 2. */
  static MIN_N = 100;
  /** Разрез А–А: x вдоль контейнера → лист. */
  X(x) {
    return this.xL + x * this.k;
  }
  /** Высота → лист. */
  Z(z) {
    return this.Yg - (this.dz + z) * this.k;
  }
  /** Жалюзи вентиляции по расчёту (StationVent) на стене w. */
  vents(w, leaf = false) {
    return ((this.p.vent && this.p.vent.louvers) || []).filter(L => L.wall === w && !L.door && !!L.leaf === leaf);
  }
  /** Выброс через крышу (колпаки). */
  hoods() {
    return (this.p.vent && this.p.vent.roof) || [];
  }
}
