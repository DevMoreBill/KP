import { ScenePipes } from './scene-pipes.js';
import { SceneUnits } from './scene-units.js';
import { SceneAir } from './scene-air.js';
import { SceneRoom } from './scene-room.js';
import { SceneHull } from './scene-hull.js';
import { PipeMaterial } from '../layout/pipe-material.js';
import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StCam } from './st-cam.js';
import { StMat } from './st-mat.js';
import { StMesh } from './st-mesh.js';
import { StOutfit } from './st-outfit.js';
import { StV } from './st-v.js';

export class StScene {
  static INS = '#d9c48a'; // разрез стены: минеральная вата

  static DARK = '#2b3036'; // рамы, решётки, основания

  static GALV = '#b9c0c6'; // оцинковка

  static INOX = '#c9cfd5';

  static SEA_P = [0.278, 0.036]; // гофр морского контейнера

  static WELD_P = [0.2, 0.02]; // профлист цельносварного

  /** Место логотипа на лицевой стороне: u0, u1, v0, v1 (доли длины и высоты). */
  static BADGE = {
    compressor: [0.04, 0.66, 0.76, 0.95],
    dryer: [0.46, 0.94, 0.72, 0.92],
    other: [0.05, 0.5, 0.78, 0.95],
    receiver: [0.25, 0.75, 0.5, 0.78],
  };

  /** Сцена по расстановке plan (StationLayout.solve); meta — {deck, view: 'in' | 'out', az, brand, logos, makers}. */
  constructor(plan, meta = {}) {
    this.hull = new SceneHull(this);
    this.room = new SceneRoom(this);
    this.air = new SceneAir(this);
    this.units = new SceneUnits(this);
    this.pipes = new ScenePipes(this);
    this.plan = plan;
    this.meta = meta;
    this.groups = new Map();
    this.decals = new Map(); // ключ → описание картинки наклейки
    this.g = plan.geo;
    this.mm = v => v / 1000;
    this.sizes(plan, meta);
    this.colors(plan);
    this.doorSets(plan, meta);
  }

  sizes(plan, meta) {
    const g = plan.geo;
    const mm = this.mm;
    [this.Le, this.We, this.He] = g.ext.map(mm);
    [this.Li, this.Wi, this.Hi] = plan.int.map(mm);
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.dz = plan.chassis ? mm(meta.deck || 1150) : 0;
    this.base = this.dz + mm(StationGeo.zFloor(g.type));
    this.ceil = this.base + this.Hi;
    this.top = this.dz + this.He;
    this.rise = g.sea ? 0 : mm(g.rise || 0);
  }

  /** Крыша — в цвет каркаса, двери и ворота — стен, если не заданы свои. */
  colors(plan) {
    this.wall = plan.wallColor || '#CBD0CC';
    this.frame = plan.frameColor || RalColor.shade(this.wall, 0.72);
    this.roofC = plan.roofColor || this.frame;
    this.door = plan.doorColor || this.wall;
    this.lining = plan.geo.sea ? '#e3e6e8' : '#eef0f1';
  }

  /** Сервисные двери (закрыты; дверь оператора и дверь отсека бака — отдельно), двери-жалюзи ДГУ поперёк в задней стене; проёмы стены со стороны зрителя. */
  doorSets(plan, meta) {
    const sd = plan.doors || [];
    this.doorsF = sd.filter(d => d.wall !== 'back');
    this.doorsB = sd.filter(d => d.wall === 'back');
    for (const d of (plan.dguDoors || []).filter(d => d.wall === 'back'))
      this.doorsB.push({ wall: 'back', x0: d.x0, x1: d.x1, w: d.w, h: d.h, leaves: 2, kind: 'dgu' });
    this.view = meta.view === 'out' ? 'out' : 'in';
    this.closed = this.view === 'out';
    this.cut = this.view === 'in';
    this.az = meta.az ?? (this.closed && StScene.farEnd(plan) ? -StCam.AZ : StCam.AZ);
    this.openF = this.openings(plan);
  }

  openings(plan) {
    if (this.cut) return [];
    const F = this.doorsF.map(d => ({
      x0: d.x0,
      x1: d.x1,
      h: d.h,
      leaves: d.leaves,
      kind: d.kind || 'service',
      open: false,
    }));
    if (!this.closed) return F;
    const en = plan.entry;
    if (en && en.wall === 'front') F.push({ x0: en.x0, x1: en.x1, h: en.h, leaves: 1, kind: 'entry' });
    const fd = plan.fuel && plan.fuel.door;
    if (fd) F.push({ x0: fd.x0, x1: fd.x1, h: StationLayout.DOOR.h, leaves: 1, kind: 'tank' });
    return F.sort((a, b) => a.x0 - b.x0);
  }

  /** ДГУ с дверью-жалюзи или ворота для демонтажа в дальнем торце: снаружи — вид спереди справа (на этот торец). */
  static farEnd(plan) {
    return (
      (plan.dguDoors || []).some(d => d.wall === 'right') ||
      [plan.gates, plan.gates2].some(q => q && q.wall === 'right' && !q.sea)
    );
  }

  /** Наклейка. */
  sticker(d, c, n, [w, h], e = 0) {
    const key = JSON.stringify(d);
    this.decals.set(key, d);
    const r = StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1]));
    const o = StV.add(c, StV.mul(n, 0.002));
    const U = StV.mul(r, w / 2);
    const V = [0, 0, h / 2];
    this.M(StMat.decal(key, e)).decal(
      StV.sub(StV.sub(o, U), V),
      StV.sub(StV.add(o, U), V),
      StV.add(StV.add(o, U), V),
      StV.add(StV.sub(o, U), V),
      n,
    );
  }

  /** Пропорция таблички логотипа (ширина / высота): картинка из каталога или название производителя. */
  logoAr(mk) {
    const r = (this.meta.logos || {})[mk.toLowerCase()];
    return r > 0 ? r : Math.max(1.6, Math.min(7, 0.62 * mk.length + 0.5));
  }

  /** Логотип производителя на лицевой стороне — там, где он у изделий этого вида. */
  badge(it) {
    const mk = String(it.maker || (this.meta.makers || {})[it.id] || '').trim();
    if (!mk || it.mount === 'pipe' || it.mount === 'wall') return;
    const ar = this.logoAr(mk);
    const d = { type: 'logo', maker: mk, bg: it.color, ar };
    if (it.kind === 'receiver' && it.shape !== 'hcyl') this.badgeRound(it, d);
    else if (it.kind === 'dgu') this.badgeDgu(it, d);
    else this.badgeFront(it, d);
  }

  /** Табличка ar (ширина / высота), вписанная в mw × mh. */
  static fit(ar, mw, mh) {
    const w = Math.min(mw, mh * ar);
    return [w, w / ar];
  }

  /** На корпусе вертикального ресивера — по дуге. */
  badgeRound(it, d) {
    const [x0, y0, z0, x1, y1, z1] = this.B(it);
    const s = this.side(it);
    const r = Math.min(x1 - x0, y1 - y0) / 2;
    const [w, h] = StScene.fit(d.ar, r * 1.6, 0.16);
    const a = (s < 0 ? -w : w) / 2 / r;
    const ac = (s < 0 ? -Math.PI : Math.PI) / 2;
    const z = z0 + (z1 - z0) * 0.62;
    const key = JSON.stringify(d);
    this.decals.set(key, d);
    this.M(StMat.decal(key)).decalArc(
      [(x0 + x1) / 2, (y0 + y1) / 2, r + 0.003],
      [ac + a, ac - a],
      [z - h / 2, z + h / 2],
    );
  }

  /** На радиаторе ДГУ. */
  badgeDgu(it, d) {
    const [x0, y0, z0, x1, y1, z1] = this.B(it);
    const s = this.side(it);
    const H = z1 - z0;
    const xr = x0 + (x1 - x0) * 0.84;
    const [w, h] = StScene.fit(d.ar, (x1 - xr) * 0.92, H * 0.16);
    const y = s < 0 ? y0 + (y1 - y0) * 0.04 : y1 - (y1 - y0) * 0.04;
    this.sticker(d, [(xr + x1) / 2, y, z0 + H * 0.8], [0, s, 0], [w, h]);
  }

  /** На лицевой стороне — крупно, для узнаваемости, на цвете своей части корпуса. */
  badgeFront(it, d) {
    const at = StScene.BADGE[it.kind];
    if (!at || (it.kind === 'dryer' && StationLayout.twinDryer(it))) return;
    const [x0, y0, z0, x1, y1, z1] = this.B(it);
    d.bg = this.toneAt(it, (at[0] + at[1]) / 2, (at[2] + at[3]) / 2);
    const span = this.endwise(it) ? y1 - y0 : x1 - x0;
    const [w, h] = StScene.fit(d.ar, (at[1] - at[0]) * span, (at[3] - at[2]) * (z1 - z0));
    this.sticker(d, this.front(it, (at[0] + at[1]) / 2, (at[2] + at[3]) / 2, 0.001), this.out(it, 1), [w, h]);
  }

  /** Геометрия материала m. */
  M(m) {
    const k = StMat.key(m);
    let e = this.groups.get(k);
    if (!e) {
      e = { mat: m, mesh: new StMesh() };
      this.groups.set(k, e);
    }
    return e.mesh;
  }

  /** Точка внутри контейнера (мм от внутренних стен и пола) → мир, м. */
  P(x, y, z) {
    return [this.ox + x / 1000, this.oy + y / 1000, this.base + z / 1000];
  }

  build() {
    this.ground();
    if (this.dz) this.hull.chassis();
    this.hull.container();
    this.outfit = new StOutfit(this).build();
    if (this.view === 'in') {
      for (const it of this.plan.items) this.air.equip(it);
      for (const pp of this.plan.piping || []) this.pipes.piping(pp);
    } // снаружи внутреннего не видно
    for (const m of this.plan.roof || []) this.pipes.muffler(m);
    if ((this.plan.outside || []).length) this.outside();
    return this;
  }

  /** Ресиверы снаружи. */
  outside() {
    const E = this.plan.outside;
    const pad = this.M(StMat.paint('#b9b6ae', 0.95));
    const P = this.mm(StationLayout.PAD);
    for (const it of E) {
      const [x0, y0, z0, x1, y1] = this.B(it);
      pad.box([x0 - 0.2, y0 - 0.2, z0 - P], [x1 + 0.2, y1 + 0.2, z0], 0.01);
      this.air.equip(it);
    }
    const pp = (this.plan.piping || [])[0];
    const l = pp && pp.lines.find(q => q.medium === 'air' && !q.header && q.x1 >= this.plan.int[0] - 1);
    if (l) this.outPipe(E, pp, l);
  }

  /** Вход трубы в ресивер: у высокого вертикального — внизу сбоку, иначе посередине. */
  inletZ(it) {
    const [, , z0, , , z1] = this.B(it);
    return it.shape === 'vcyl' && it.h >= 900 ? z0 + Math.max(0.25, this.mm(it.h) * 0.22) : (z0 + z1) / 2;
  }

  outPipe(E, pp, l) {
    const air = { c: PipeMaterial.idColor('air', pp.color), r: 0.38, m: 0.35 };
    const m = this.M(pp.mat === 'inox' ? StMat.metal(StScene.INOX, 0.22) : air);
    const red = this.M(StMat.paint('#c83a2e', 0.4));
    const dn = +(String(pp.dn || '').match(/\d+/) || [0])[0];
    const r = Math.max(0.012, Math.min(0.08, (dn || 50) / 2000 + 0.006));
    const o = this.P(l.x1, l.y, l.z);
    const xm = (this.Le + 0.07 + Math.min(...E.map(i => this.B(i)[0]))) / 2;
    const run = (...Q) => {
      for (let k = 1; k < Q.length; k++) {
        m.tube(Q[k - 1], Q[k], r, 18);
        m.sphere(Q[k], r * 1.03, 12);
      }
    };
    run([this.Le + 0.07, o[1], o[2]], [xm, o[1], o[2]]);
    m.sphere([xm, o[1], o[2]], r * 1.03, 12);
    red.box(
      [this.Le + 0.25, o[1] - 0.012, o[2] + r * 1.3],
      [this.Le + 0.38, o[1] + 0.012, o[2] + r * 1.3 + 0.018],
      0.004,
    );
    for (const it of E) {
      const [ix0, iy0, , , iy1] = this.B(it);
      const y = (iy0 + iy1) / 2;
      const z = this.inletZ(it);
      run([xm, o[1], o[2]], [xm, y, o[2]], [xm, y, z], [ix0, y, z]);
      m.tube([ix0 - 0.02, y, z], [ix0 + 0.01, y, z], r * 1.6, 18);
    }
    const far = E.reduce((a, c) => (c.x + c.lx > a.x + a.lx ? c : a));
    const [fx0, fy0, , fx1, fy1, fz1] = this.B(far);
    const cx = (fx0 + fx1) / 2;
    const cy = (fy0 + fy1) / 2;
    run([cx, cy, fz1 + 0.09], [cx, cy, fz1 + 0.25], [fx1 + 0.4, cy, fz1 + 0.25]);
    m.tube([fx1 + 0.38, cy, fz1 + 0.25], [fx1 + 0.42, cy, fz1 + 0.25], r * 1.7, 20);
  }

  /** Габариты сцены (м): контейнер, глушитель, ресиверы снаружи. */
  bounds() {
    const R = this.plan.roof || [];
    const up = R.reduce((s, m) => Math.max(s, (m.gap + m.d) / 1000 + 0.05), 0);
    const E = (this.plan.outside || []).map(i => this.B(i));
    const xo = Math.max(
      this.Le,
      ...E.map(b => b[3] + 0.45),
      ...R.map(m => this.ox + (m.x + m.lx + m.outlet) / 1000 + 0.03),
    );
    const yo = Math.min(0, ...E.map(b => b[1] - 0.2));
    const yi = Math.max(this.We, ...E.map(b => b[4] + 0.2));
    const zo = Math.max(0, ...E.map(b => b[5] + 0.3));
    return {
      lo: [-0.15, Math.min(yo, -0.15), 0],
      hi: [xo + 0.15, Math.max(yi, this.We + 0.15), Math.max(zo, this.top + this.rise + up + 0.05)],
    };
  }

  /** Число треугольников (проверка и замер). */
  tris() {
    let n = 0;
    for (const e of this.groups.values()) n += e.mesh.i.length / 3;
    return n;
  }

  ground() {
    const m = this.M({ c: '#e7e8ea', r: 0.9, m: 0, k: 2 });
    const R = Math.max(this.Le, this.We) * 3;
    m.quad(
      [this.Le / 2 - R, this.We / 2 - R, 0],
      [this.Le / 2 + R, this.We / 2 - R, 0],
      [this.Le / 2 + R, this.We / 2 + R, 0],
      [this.Le / 2 - R, this.We / 2 + R, 0],
      [0, 0, 1],
    );
  }

  /** Высота крыши над поперечной координатой y (м). */
  roofZ(y) {
    const R = this.rise;
    const W = this.We;
    const t = Math.max(0, Math.min(W, y));
    if (!(R > 0)) return this.top;
    if (this.g.roof === 'arch') {
      const rc = this.hull.arcR();
      return this.top + R - rc + Math.sqrt(Math.max(0, rc * rc - (t - W / 2) * (t - W / 2)));
    }
    return this.top + (this.g.roof === 'gable' ? R * (1 - Math.abs(t - W / 2) / (W / 2)) : R * (1 - t / W));
  }

  /** Жалюзи в стене: along 1 — в торце (x = w), 0 — в длинной стене (y = w); out — наружу (±1). */
  louver(along, w, [u0, u1], [z0, z1], out) {
    const fr = this.M(StMat.paint('#8f969d', 0.5));
    const sl = this.M(StMat.paint('#5d646b', 0.55));
    const n = Math.max(3, Math.round((z1 - z0) / 0.07));
    const P = (u, o, z) => (along === 1 ? [w + out * o, u, z] : [u, w + out * o, z]);
    fr.box(P(u0 - 0.04, 0, z0 - 0.04), P(u1 + 0.04, 0.03, z0));
    fr.box(P(u0 - 0.04, 0, z1), P(u1 + 0.04, 0.03, z1 + 0.04));
    fr.box(P(u0 - 0.04, 0, z0), P(u0, 0.03, z1));
    fr.box(P(u1, 0, z0), P(u1 + 0.04, 0.03, z1));
    for (let i = 0; i < n; i++) {
      const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
      sl.quad(P(u0, 0.035, z + 0.018), P(u1, 0.035, z + 0.018), P(u1, 0.005, z - 0.018), P(u0, 0.005, z - 0.018));
    }
  }

  /** Габарит в мире: [x0, y0, z0, x1, y1, z1] и сторона обслуживания (−1 — к стене прохода, 1 — к задней). */
  B(it) {
    const a = this.P(it.x, it.y, it.z || 0);
    const b = this.P(it.x + it.lx, it.y + it.ly, (it.z || 0) + it.h);
    return [...a, ...b];
  }

  side(it) {
    return it.face > 0 ? 1 : -1;
  }

  /** Лицевая сторона вдоль торца (шкаф на торцевой стене: face ±2). */
  endwise(it) {
    return Math.abs(it.face) === 2;
  }

  /** Наружу от лицевой стороны на k, м. */
  out(it, k) {
    const s = this.side(it) * k;
    return this.endwise(it) ? [s, 0, 0] : [0, s, 0];
  }

  /** Точка на лицевой стороне: u — доля длины, v — доля высоты, o — выступ наружу, м. */
  front(it, u, v, o = 0) {
    const [x0, y0, z0, x1, y1, z1] = this.B(it);
    const s = this.side(it);
    return this.endwise(it)
      ? [(s < 0 ? x0 : x1) + s * o, y0 + (y1 - y0) * u, z0 + (z1 - z0) * v]
      : [x0 + (x1 - x0) * u, (s < 0 ? y0 : y1) + s * o, z0 + (z1 - z0) * v];
  }

  /** Прямоугольник на лицевой стороне: u0…u1, v0…v1, толщина o (наружу). */
  panel(m, it, [u0, u1], [v0, v1], [o, r = 0.003]) {
    const a = this.front(it, u0, v0, 0);
    const b = this.front(it, u1, v1, o);
    m.box([a[0], a[1], a[2]], [b[0], b[1], b[2]], r);
  }

  /** Доля u на лицевой стороне по фото. */
  fu(it, u) {
    return (this.endwise(it) ? this.side(it) < 0 : this.side(it) > 0) ? 1 - u : u;
  }

  /** Окраска частей по фото (it.tones — зоны других цветов, как в карточке товара). */
  tones(it, [x0, y0, zA], [x1, y1, z1], r) {
    const T = it.tones;
    if (!T || !T.length) return;
    const [, , Z0, , , Z1] = this.B(it);
    const e = 0.0015;
    const va = (zA - Z0) / (Z1 - Z0 || 1);
    for (const t of T) {
      const m = this.M(StMat.paint(t.hex, 0.42));
      const v0 = Math.max(va, t.v0);
      const v1 = t.v1;
      if (v1 - v0 < 0.02) continue;
      if (t.u0 <= 0.001 && t.u1 >= 0.999) {
        const za = Z0 + (Z1 - Z0) * v0;
        const zb = Z0 + (Z1 - Z0) * v1;
        const top = v1 >= 0.999;
        m.box([x0 - e, y0 - e, za], [x1 + e, y1 + e, top ? z1 + e : zb], top ? r : Math.min(r, 0.004));
        continue;
      }
      const a = this.fu(it, t.u0);
      const b = this.fu(it, t.u1);
      this.panel(m, it, [Math.min(a, b), Math.max(a, b)], [v0, v1], [e, 0]);
    }
  }

  /** Цвет изделия в точке лицевой стороны (u, v): зона по фото или главный. */
  toneAt(it, u, v) {
    const t = (it.tones || []).find(t => {
      const a = this.fu(it, t.u0),
        b = this.fu(it, t.u1);
      return u >= Math.min(a, b) && u <= Math.max(a, b) && v >= t.v0 && v <= t.v1;
    });
    return t ? t.hex : it.color;
  }

  /** Построитель, рисующий через преобразование точек f (поворот и зеркало по осям). */
  static mapMesh(m, f) {
    const o = f([0, 0, 0]);
    const fv = v => {
      const b = f(v);
      return [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
    };
    return {
      box: (a, b, r) => m.box(f(a), f(b), r),
      tube: (a, b, r, seg, o) => m.tube(f(a), f(b), r, seg, o),
      sphere: (c, r, seg) => m.sphere(f(c), r, seg),
      obox: (p, u, v, w) => m.obox(f(p), fv(u), fv(v), fv(w)),
      quad: (a, b, c, d, n) => m.quad(f(a), f(b), f(c), f(d), n && fv(n)),
      tri: (a, b, c, n) => m.tri(f(a), f(b), f(c), n && fv(n)),
    };
  }
}
