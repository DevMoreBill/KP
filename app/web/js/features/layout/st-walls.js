import { LayoutPipes } from './layout-pipes.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/**
 * Места на стенах помещения оборудования (3D-вид, жалюзи): left — у начала помещения, right — дальний торец, back —
 * задняя, front — со стороны прохода; u — вдоль стены, z — от пола, мм. B — занятые места, S — «мягкие» запреты.
 */
export class StWalls {
  static _isLong = wall => wall === 'front' || wall === 'back';

  static _span = (wall, item) => (StWalls._isLong(wall) ? [item.x, item.x + item.lx] : [item.y, item.y + item.ly]);

  static get _NEAR() {
    return StationMatrix.grp('grille').near;
  }

  /** o.equip=false — оборудование на полу и трубопровод место на стене не занимают (жалюзи за компрессором). */
  constructor(plan, opts = {}) {
    const [Li, Wi] = plan.int;
    this.Li = Li;
    this.Wi = Wi;
    this.x0 = plan.geo.x0 || 0;
    this.hard = { left: [], right: [], back: [], front: [] };
    this.soft = { left: [], right: [], back: [], front: [] };
    this.equipment(plan, opts);
    this.joints(plan);
    for (const heater of (plan.heat && plan.heat.heaters) || [])
      this.busy(heater.wall, ...StWalls._span(heater.wall, heater), 0, heater.z + heater.h + 100);
    this.openings(plan);
    this.pipes(plan, opts);
    if ((plan.sys || {}).power !== false) {
      const rear = (plan.doors || []).some(door => door.rear && door.wall === 'back');
      this.busy(rear ? 'front' : 'back', this.x0, Li, plan.int[2] - 320, plan.int[2]);
    }
  }

  /** Шкафы на стене; оборудование ближе NEAR к стене занимает место перед ним до своей высоты + 150 мм. */
  equipment(plan, opts) {
    const { Li: Li, Wi: Wi, x0 } = this;
    const near = StWalls._NEAR;
    for (const i of (plan.items || []).filter(item => !item.tank)) {
      if (i.mount === 'wall') {
        this.busy(i.wall, ...StWalls._span(i.wall, i), i.z, i.z + i.h);
        continue;
      }
      if (i.mount === 'pipe' || opts.equip === false) continue;
      const top = (i.z || 0) + i.h + 150;
      if (i.y < near) this.busy('front', i.x, i.x + i.lx, 0, top);
      if (Wi - i.y - i.ly < near) this.busy('back', i.x, i.x + i.lx, 0, top);
      if (i.x - x0 < near) this.busy('left', i.y, i.y + i.ly, 0, top);
      if (Li - i.x - i.lx < near) this.busy('right', i.y, i.y + i.ly, 0, top);
    }
  }

  /** Станция из модулей: стыки на стенах (стойки, нащельники). */
  joints(plan) {
    const joints = StationMods.lines(plan.geo);
    const Hi = plan.int[2];
    for (const x of joints.x) for (const wall of ['front', 'back']) this.busy(wall, x - 150, x + 150, 0, Hi);
    for (const y of joints.y) for (const wall of ['left', 'right']) this.busy(wall, y - 150, y + 150, 0, Hi);
  }

  /** Дверь оператора, ворота, вторая дверь, сервисные ворота: изнутри на них ничего не вешать. */
  openings(plan) {
    const entry = plan.entry;
    if (entry)
      this.busy(
        entry.wall,
        ...(entry.wall === 'front' ? [entry.x0 - 100, entry.x1 + 100] : [entry.y0 - 100, entry.y1 + 100]),
        0,
        entry.h + 150,
      );
    for (const gate of [plan.gates, plan.gates2])
      if (gate) this.busy(gate.wall, gate.y0 - 100, gate.y1 + 100, 0, gate.h + 150);
    if (plan.exit) this.busy(plan.exit.wall, plan.exit.y0 - 100, plan.exit.y1 + 100, 0, plan.exit.h + 150);
    for (const door of plan.doors || [])
      this.busy(door.wall === 'back' ? 'back' : 'front', door.x0 - 100, door.x1 + 100, 0, door.h + 150);
  }

  /** Труба у задней стены (жалюзи за ней — можно) и выход трубопровода с фланцем. */
  pipes(plan, opts) {
    const lines = plan.lines || [];
    if (opts.equip !== false) {
      for (const line of lines.filter(item => this.Wi - item.y < 500))
        for (const [from, till] of LayoutPipes.runs(line)) this.busy('back', from, till, line.z - 100, line.z + 100);
    }
    for (const out of lines.filter(line => line.out).map(line => line.out)) {
      const u = StWalls._isLong(out.wall) ? out.x : out.y;
      this.busy(out.wall, u - 250, u + 250, out.z - 250, out.z + 250);
    }
  }

  /** Отмечает занятую полосу стены. */
  busy(wall, u0, u1, z0, z1) {
    if (this.hard[wall]) this.hard[wall].push([u0, u1, z0, z1]);
  }

  /** Отметка занятых мест: reset(mark()) убирает всё, что занято после отметки. */
  mark() {
    return Object.fromEntries(Object.entries(this.hard).map(([k, v]) => [k, v.length]));
  }

  /** Возвращает занятость стен к отметке. */
  reset(marks) {
    for (const k in marks) this.hard[k].length = marks[k];
  }

  /** «Мягкие» запреты для огнетушителей и щитов: стены за оборудованием и стена прохода, где проход узкий. */
  shade(plan) {
    const [Li, Wi] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const aisle = (plan.aisleRule || [1000, 800])[1] + 250;
    const shadow = (wall, u0, u1, z1) => this.soft[wall].push([u0, u1, 0, z1]);
    for (const i of (plan.items || []).filter(item => !item.tank && item.mount !== 'pipe' && item.mount !== 'wall')) {
      const top = (i.z || 0) + i.h + 150;
      if (i.y + i.ly > Wi / 2) shadow('back', i.x - 50, i.x + i.lx + 50, top);
      if (i.y < aisle) shadow('front', i.x - 50, i.x + i.lx + 50, top);
      if (Li - i.x - i.lx < 1200) shadow('right', i.y - 50, i.y + i.ly + 50, top);
      if (i.x - x0 < 1200) shadow('left', i.y - 50, i.y + i.ly + 50, top);
    }
  }

  /** Участок свободен; soft — и без «мягких» запретов. */
  free(wall, [u0, u1], [z0, z1], soft = true) {
    const ok = span => !(span[0] < u1 && span[1] > u0 && span[2] < z1 && span[3] > z0);
    return (this.hard[wall] || []).every(ok) && (!soft || (this.soft[wall] || []).every(ok));
  }

  /** Пределы стены вдоль. */
  range(wall) {
    return wall === 'left' || wall === 'right' ? [0, this.Wi] : [this.x0, this.Li];
  }

  /** Начало свободного участка шириной wd на высоте z0…z1: от начала (lo), от конца (hi) или ближе к точке from; нет — null. */
  find(wall, width, z, from = 'lo', ok = null) {
    const [low, high] = this.range(wall);
    const good = u => this.free(wall, [u, u + width], z) && (!ok || ok(u));
    if (typeof from === 'number')
      return this.near(good, [low + 120, high - 120 - width], Math.round((from - width / 2) / 50) * 50);
    if (from === 'lo') {
      for (let u = low + 120; u + width <= high - 120; u += 50) if (good(u)) return u;
      return null;
    }
    for (let u = high - 120 - width; u >= low + 120; u -= 50) if (good(u)) return u;
    return null;
  }

  /** Ближайшее к u0 подходящее место в пределах. */
  near(good, [low, high], u0) {
    for (let step = 0; u0 - step >= low || u0 + step <= high; step += 50) {
      for (const u of step ? [u0 - step, u0 + step] : [u0]) if (u >= low && u <= high && good(u)) return u;
    }
    return null;
  }
}
