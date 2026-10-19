import { LayoutPipes } from './layout-pipes.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

const long = w => w === 'front' || w === 'back';
const span = (w, o) => (long(w) ? [o.x, o.x + o.lx] : [o.y, o.y + o.ly]);

/**
 * Места на стенах помещения оборудования (3D-вид, жалюзи): left — у начала помещения, right — дальний торец, back —
 * задняя, front — со стороны прохода; u — вдоль стены, z — от пола, мм. B — занятые места, S — «мягкие» запреты.
 */
export class StWalls {
  static get NEAR() {
    return StationMatrix.grp('grille').near;
  }

  /** o.equip=false — оборудование на полу и трубопровод место на стене не занимают (жалюзи за компрессором). */
  constructor(plan, o = {}) {
    const [L, W] = plan.int;
    this.L = L;
    this.W = W;
    this.x0 = plan.geo.x0 || 0;
    this.B = { left: [], right: [], back: [], front: [] };
    this.S = { left: [], right: [], back: [], front: [] };
    this.equipment(plan, o);
    this.joints(plan);
    for (const h of (plan.heat && plan.heat.heaters) || []) this.busy(h.wall, ...span(h.wall, h), 0, h.z + h.h + 100);
    this.openings(plan);
    this.pipes(plan, o);
    if ((plan.sys || {}).power !== false) {
      const rear = (plan.doors || []).some(d => d.rear && d.wall === 'back');
      this.busy(rear ? 'front' : 'back', this.x0, L, plan.int[2] - 320, plan.int[2]);
    }
  }

  /** Шкафы на стене; оборудование ближе NEAR к стене занимает место перед ним до своей высоты + 150 мм. */
  equipment(plan, o) {
    const { L, W, x0 } = this;
    const N = StWalls.NEAR;
    for (const i of (plan.items || []).filter(q => !q.tank)) {
      if (i.mount === 'wall') {
        this.busy(i.wall, ...span(i.wall, i), i.z, i.z + i.h);
        continue;
      }
      if (i.mount === 'pipe' || o.equip === false) continue;
      const top = (i.z || 0) + i.h + 150;
      if (i.y < N) this.busy('front', i.x, i.x + i.lx, 0, top);
      if (W - i.y - i.ly < N) this.busy('back', i.x, i.x + i.lx, 0, top);
      if (i.x - x0 < N) this.busy('left', i.y, i.y + i.ly, 0, top);
      if (L - i.x - i.lx < N) this.busy('right', i.y, i.y + i.ly, 0, top);
    }
  }

  /** Станция из модулей: стыки на стенах (стойки, нащельники). */
  joints(plan) {
    const J = StationMods.lines(plan.geo);
    const H = plan.int[2];
    for (const x of J.x) for (const w of ['front', 'back']) this.busy(w, x - 150, x + 150, 0, H);
    for (const y of J.y) for (const w of ['left', 'right']) this.busy(w, y - 150, y + 150, 0, H);
  }

  /** Дверь оператора, ворота, вторая дверь, сервисные ворота: изнутри на них ничего не вешать. */
  openings(plan) {
    const en = plan.entry;
    if (en)
      this.busy(
        en.wall,
        ...(en.wall === 'front' ? [en.x0 - 100, en.x1 + 100] : [en.y0 - 100, en.y1 + 100]),
        0,
        en.h + 150,
      );
    for (const Q of [plan.gates, plan.gates2]) if (Q) this.busy(Q.wall, Q.y0 - 100, Q.y1 + 100, 0, Q.h + 150);
    if (plan.exit) this.busy(plan.exit.wall, plan.exit.y0 - 100, plan.exit.y1 + 100, 0, plan.exit.h + 150);
    for (const d of plan.doors || [])
      this.busy(d.wall === 'back' ? 'back' : 'front', d.x0 - 100, d.x1 + 100, 0, d.h + 150);
  }

  /** Труба у задней стены (жалюзи за ней — можно) и выход трубопровода с фланцем. */
  pipes(plan, o) {
    const lines = plan.lines || [];
    if (o.equip !== false) {
      for (const l of lines.filter(q => this.W - q.y < 500))
        for (const [a, b] of LayoutPipes.runs(l)) this.busy('back', a, b, l.z - 100, l.z + 100);
    }
    for (const q of lines.filter(l => l.out).map(l => l.out)) {
      const u = long(q.wall) ? q.x : q.y;
      this.busy(q.wall, u - 250, u + 250, q.z - 250, q.z + 250);
    }
  }

  busy(w, u0, u1, z0, z1) {
    if (this.B[w]) this.B[w].push([u0, u1, z0, z1]);
  }

  /** Отметка занятых мест: reset(mark()) убирает всё, что занято после отметки. */
  mark() {
    return Object.fromEntries(Object.entries(this.B).map(([k, v]) => [k, v.length]));
  }

  reset(m) {
    for (const k in m) this.B[k].length = m[k];
  }

  /** «Мягкие» запреты для огнетушителей и щитов: стены за оборудованием и стена прохода, где проход узкий. */
  shade(plan) {
    const [L, W] = plan.int;
    const x0 = plan.geo.x0 || 0;
    const a = (plan.aisleRule || [1000, 800])[1] + 250;
    const S = (w, u0, u1, z1) => this.S[w].push([u0, u1, 0, z1]);
    for (const i of (plan.items || []).filter(q => !q.tank && q.mount !== 'pipe' && q.mount !== 'wall')) {
      const top = (i.z || 0) + i.h + 150;
      if (i.y + i.ly > W / 2) S('back', i.x - 50, i.x + i.lx + 50, top);
      if (i.y < a) S('front', i.x - 50, i.x + i.lx + 50, top);
      if (L - i.x - i.lx < 1200) S('right', i.y - 50, i.y + i.ly + 50, top);
      if (i.x - x0 < 1200) S('left', i.y - 50, i.y + i.ly + 50, top);
    }
  }

  /** Участок свободен; soft — и без «мягких» запретов. */
  free(w, [u0, u1], [z0, z1], soft = true) {
    const ok = q => !(q[0] < u1 && q[1] > u0 && q[2] < z1 && q[3] > z0);
    return (this.B[w] || []).every(ok) && (!soft || (this.S[w] || []).every(ok));
  }

  range(w) {
    return w === 'left' || w === 'right' ? [0, this.W] : [this.x0, this.L];
  }

  /** Начало свободного участка шириной wd на высоте z0…z1: от начала (lo), от конца (hi) или ближе к точке from; нет — null. */
  find(w, wd, z, from = 'lo', ok = null) {
    const [lo, hi] = this.range(w);
    const good = u => this.free(w, [u, u + wd], z) && (!ok || ok(u));
    if (typeof from === 'number')
      return this.near(good, [lo + 120, hi - 120 - wd], Math.round((from - wd / 2) / 50) * 50);
    if (from === 'lo') {
      for (let u = lo + 120; u + wd <= hi - 120; u += 50) if (good(u)) return u;
      return null;
    }
    for (let u = hi - 120 - wd; u >= lo + 120; u -= 50) if (good(u)) return u;
    return null;
  }

  near(good, [a, b], u0) {
    for (let d = 0; u0 - d >= a || u0 + d <= b; d += 50) {
      for (const u of d ? [u0 - d, u0 + d] : [u0]) if (u >= a && u <= b && good(u)) return u;
    }
    return null;
  }
}
