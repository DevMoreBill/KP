import { PipeMaterial } from '../layout/pipe-material.js';
import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StSvg } from './st-svg.js';
import { StView } from './st-view.js';
import { View3dUnits } from './view3d-units.js';

/** 3D-вид станции в SVG (без WebGL): разрез — стенки со стороны зрителя срезаны до пояса, видно оборудование. */
export class StationView3D {
  static W = 1600;
  static H = 1100;
  static AZ = 30; // поворот вокруг вертикали, °
  static EL = 24; // наклон взгляда сверху, °
  static DEFS =
    '<filter id="blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="blur18" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>';

  /** Plan — StationLayout.solve(...); meta: {deck — высота шасси, мм}. */
  static svg(plan, meta = {}) {
    return new StationView3D(plan, meta).draw();
  }

  constructor(plan, meta) {
    const g = plan.geo;
    this.plan = plan;
    this.g = g;
    [this.Le, this.We, this.He] = g.ext;
    [this.Li, this.Wi, this.Hi] = plan.int;
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.dz = plan.chassis ? meta.deck || 1150 : 0;
    this.base = this.dz + StationGeo.zFloor(g.type);
    this.ceil = this.base + this.Hi;
    this.top = this.dz + this.He;
    this.rf = plan.roof || [];
    this.O = (plan.outside || []).map(it => this.placed(it));
    this.project();
    this.wall = plan.wallColor || '#CBD0CC';
    this.frame = plan.frameColor || RalColor.shade(this.wall, 0.7);
    this.roofC = plan.roofColor || this.frame;
    this.lining = RalColor.mix('#eef1f4', this.wall, 0.1);
    this.band = Math.max(650, Math.min(900, this.He * 0.3));
  }

  /** Изделие с габаритом в координатах контейнера: X0…X1, Y0…Y1. */
  placed(it) {
    return { ...it, X0: this.ox + it.x, Y0: this.oy + it.y, X1: this.ox + it.x + it.lx, Y1: this.oy + it.y + it.ly };
  }

  /** Проекция и масштаб — по габаритам контейнера (с шасси, глушителем и ресиверами снаружи). */
  project() {
    const az = (StationView3D.AZ * Math.PI) / 180;
    const el = (StationView3D.EL * Math.PI) / 180;
    const [cs, sn, ce, se] = [Math.cos(az), Math.sin(az), Math.cos(el), Math.sin(el)];
    const P0 = (x, y, z) => [x * cs - y * sn, -((x * sn + y * cs) * se + z * ce)];
    const up = this.rf.length ? Math.max(...this.rf.map(m => m.gap + m.d)) : 0;
    const xe = Math.max(this.Le, ...this.O.map(i => i.X1 + 400));
    const zt = Math.max(this.top + up, ...this.O.map(i => this.base + i.z + i.h));
    const ext = [];
    for (const x of [0, xe]) for (const y of [0, this.We]) for (const z of [0, zt]) ext.push(P0(x, y, z));
    const [minX, maxX] = [Math.min(...ext.map(p => p[0])), Math.max(...ext.map(p => p[0]))];
    const [minY, maxY] = [Math.min(...ext.map(p => p[1])), Math.max(...ext.map(p => p[1]))];
    const { W } = StationView3D;
    const H = Math.round(Math.max(760, Math.min(StationView3D.H, (W * 0.9 * (maxY - minY)) / (maxX - minX) / 0.84)));
    const k = Math.min((W * 0.9) / (maxX - minX), (H * 0.84) / (maxY - minY));
    const tx = (W - (maxX - minX) * k) / 2 - minX * k;
    const ty = (H - (maxY - minY) * k) / 2 - minY * k + H * 0.02;
    this.H = H;
    this.k = k;
    this.V = new StView(
      (x, y, z) => {
        const p = P0(x, y, z);
        return [p[0] * k + tx, p[1] * k + ty];
      },
      k,
      se,
      StSvg,
    );
  }

  draw() {
    const { V, plan, dz } = this;
    const out = [];
    const P = V.P;
    const sh = [
      P(-300, -250, 0),
      P(this.Le + 500, -250, 0),
      P(this.Le + 500, this.We + 450, 0),
      P(-300, this.We + 450, 0),
    ];
    out.push(StSvg.poly(sh, '#000000', '', 0, ' opacity="0.10" filter="url(#blur18)"'));
    if (dz) out.push(...V.chassis(this.Le, this.We, dz));
    out.push(...this.back(), ...this.floor());
    // шкафы на стене прохода — на срезанной стене: не показываются
    const items = plan.items.filter(it => !(it.mount === 'wall' && it.wall === 'front')).map(it => this.placed(it));
    out.push(...this.louvers());
    const over = this.pipes(out, items);
    out.push(...this.equipment(items, over));
    if (this.O.length) out.push(...this.outside());
    out.push(...this.cutBand(), ...this.frontFrame());
    for (const m of this.rf) out.push(...this.muffler(m));
    return StSvg.doc(
      StationView3D.W,
      this.H,
      StSvg.rect([0, 0, StationView3D.W, this.H], '#ffffff') + out.join(''),
      StationView3D.DEFS + V.defs.join(''),
    );
  }

  /** Прямоугольник [x0, y0, z0] → [x1, y1, z1] в плоскости: по углам a, b, c, d. */
  face(Q, fill, sw = 1, extra = '') {
    return this.V.face(Q, fill, sw, extra);
  }

  /** Задняя стена и дальний торец — изнутри; крыша в разрезе, швы обшивки или гофр, стойки сзади. */
  back() {
    const { ox, oy, Li, Wi, Le, We, base, top, lining } = this;
    const roof = RalColor.shade(this.roofC, 1.08);
    const out = [
      this.face(
        [
          [ox, oy + Wi, base],
          [ox + Li, oy + Wi, base],
          [ox + Li, oy + Wi, top],
          [ox, oy + Wi, top],
        ],
        lining,
      ),
      this.face(
        [
          [ox + Li, oy, base],
          [ox + Li, oy + Wi, base],
          [ox + Li, oy + Wi, top],
          [ox + Li, oy, top],
        ],
        RalColor.shade(lining, 0.9),
      ),
      this.face(
        [
          [0, oy + Wi, top],
          [Le, oy + Wi, top],
          [Le, We, top],
          [0, We, top],
        ],
        roof,
      ),
      this.face(
        [
          [ox + Li, 0, top],
          [Le, 0, top],
          [Le, We, top],
          [ox + Li, We, top],
        ],
        roof,
      ),
    ];
    out.push(...this.backRibs());
    return out;
  }

  /** Швы обшивки задней стены (у морского — гофр), стойки каркаса сзади. */
  backRibs() {
    const { V, ox, oy, Li, Wi, Le, We, base, top, lining } = this;
    const out = [];
    const y = oy + Wi - 1;
    if (this.g.sea)
      for (let x = ox + 300; x < ox + Li - 100; x += 560)
        out.push(
          this.face(
            [
              [x, y, base],
              [x + 280, y, base],
              [x + 280, y, top],
              [x, y, top],
            ],
            RalColor.shade(lining, 0.96),
            0,
          ),
        );
    else
      for (let x = ox + 1150; x < ox + Li - 100; x += 1150)
        out.push(V.line([x, y, base], [x, y, top], RalColor.shade(lining, 0.86), 1.2));
    return [
      ...out,
      ...V.box([0, We - 150, this.dz], [150, We, top], this.frame),
      ...V.box([Le - 150, We - 150, this.dz], [Le, We, top], this.frame),
    ];
  }

  floor() {
    const { V, ox, oy, Li, Wi, base } = this;
    const out = [
      this.face(
        [
          [ox, oy, base],
          [ox + Li, oy, base],
          [ox + Li, oy + Wi, base],
          [ox, oy + Wi, base],
        ],
        '#b3b9bf',
      ),
    ];
    for (let x = ox + 1250; x < ox + Li; x += 1250) out.push(V.line([x, oy, base], [x, oy + Wi, base], '#9aa1a8', 1.2));
    return out;
  }

  /** Жалюзи по расчёту вентиляции на задней стене и в дальнем торце — изнутри (размеры — на чертеже). */
  louvers() {
    const { ox, oy, Li, Wi, base } = this;
    const L = ((this.plan.vent && this.plan.vent.louvers) || []).filter(q => q.wall === 'back' || q.wall === 'right');
    return L.map(q => {
      const b = q.wall === 'back';
      const a = b ? [ox + q.u0, oy + Wi - 2, base + q.z0] : [ox + Li - 2, oy + q.u0, base + q.z0];
      const c = b ? [ox + q.u1, oy + Wi - 2, base + q.z1] : [ox + Li - 2, oy + q.u1, base + q.z1];
      return this.V.louver(a, c, b ? 'y' : 'x');
    });
  }

  /** Труба: тёмный контур и светлый блик. */
  tube(a, b, c, w) {
    const { V } = this;
    return (
      V.line(a, b, RalColor.shade(c, 0.62), w + 2) +
      V.line(a, b, c, w) +
      V.line(a, b, RalColor.shade(c, 1.35), Math.max(1, w * 0.3))
    );
  }

  /** Трубопровод вдоль задней стены. */
  pipes(out, items) {
    const over = new Map();
    const w = Math.max(4, 90 * this.k);
    for (const pp of this.plan.piping || [])
      for (const l of pp.lines) {
        const c = PipeMaterial.idColor(l.medium, pp.color); // окраска по ГОСТ 14202-69
        out.push(...this.main(l, c, w));
        for (const b of l.branches) this.branch({ l, b, c, w }, items, out, over);
      }
    return over;
  }

  /** Магистраль и выход к стене (через торец, заднюю стену или над проёмом). */
  main(l, c, w) {
    const [y, z] = [this.oy + l.y, this.base + l.z];
    const out = StationLayout.runs(l).map(([a, b]) => this.tube([this.ox + a, y, z], [this.ox + b, y, z], c, w));
    const op = this.O.length ? null : StationLayout.outPath(l, this.Wi);
    if (!op) return out;
    const Q = op.pts.map(([x, yy, zz]) => [this.ox + x, this.oy + yy, this.base + zz]);
    for (let q = 1; q < Q.length; q++) out.push(this.tube(Q[q - 1], Q[q], c, w));
    return out;
  }

  /** Отвод: подъём к коллектору входов, спуск на оборудование (в over) или по месту. */
  branch({ l, b, c, w }, items, out, over) {
    const { ox, oy, base } = this;
    const z = base + l.z;
    const [p0, p1] = [
      [ox + b.x, oy + b.y0, z],
      [ox + b.x, oy + b.y1, z],
    ];
    if (b.tee) {
      out.push(this.tube(p0, p1, c, w) + this.tube(p1, [ox + b.x, oy + b.y1, base + b.z1], c, w));
      return;
    }
    const t = this.tube(p0, p1, c, w * 0.8);
    if (!(b.z1 < l.z)) {
      out.push(t);
      return;
    }
    const to = items.find(i => `${i.id}#${i.unit}` === b.to);
    const zb = base + (to ? Math.min(b.z1, View3dUnits.top(to)) : b.z1);
    over.set(b.to, (over.get(b.to) || '') + t + this.tube(p1, [ox + b.x, oy + b.y1, zb], c, w * 0.8));
  }

  /** Оборудование: тени, затем по глубине (дальнее — раньше), за каждым — спуск трубы на него. */
  equipment(items, over) {
    const { V, base } = this;
    const out = [];
    for (const it of items.filter(i => i.mount === 'floor' || i.mount === 'frame'))
      out.push(
        this.face(
          [
            [it.X0 + 60, it.Y0 + 40, base + 1],
            [it.X1 + 160, it.Y0 + 40, base + 1],
            [it.X1 + 160, it.Y1 + 120, base + 1],
            [it.X0 + 60, it.Y1 + 120, base + 1],
          ],
          '#000000',
          0,
          ' opacity="0.16" filter="url(#blur6)"',
        ),
      );
    const at = { vent: this.plan.vent, ox: this.ox, oy: this.oy, Li: this.Li, x0: this.plan.geo.x0 || 0 };
    const ctx = { base, ceil: this.ceil, yWall: this.oy + this.Wi, at };
    for (const it of V.order(items)) {
      out.push(...View3dUnits.equip(V, it, ctx));
      const t = over.get(`${it.id}#${it.unit}`);
      if (t) out.push(t);
    }
    return out;
  }

  /** Ресиверы снаружи — за дальним торцом на площадке; трубопровод от торца к ним. */
  outside() {
    const { V, O, base } = this;
    const out = O.map(it =>
      this.face(
        [
          [it.X0 - 200, it.Y0 - 200, base + it.z],
          [it.X1 + 200, it.Y0 - 200, base + it.z],
          [it.X1 + 200, it.Y1 + 200, base + it.z],
          [it.X0 - 200, it.Y1 + 200, base + it.z],
        ],
        '#b9b6ae',
      ),
    );
    const l = (this.plan.piping || [])
      .flatMap(q => q.lines)
      .find(q => q.medium === 'air' && !q.header && q.x1 >= this.Li - 1);
    if (l) out.push(...this.outPipe(l));
    for (const it of V.order(O))
      out.push(...View3dUnits.equip(V, it, { base, ceil: this.ceil, yWall: this.oy + this.Wi }));
    return out;
  }

  outPipe(l) {
    const c = PipeMaterial.idColor('air', '#8d949b');
    const w = Math.max(4, 90 * this.k);
    const xm = (this.Le + Math.min(...this.O.map(i => i.X0))) / 2;
    const [y, z] = [this.oy + l.y, this.base + l.z];
    const out = [this.tube([this.Le, y, z], [xm, y, z], c, w)];
    for (const it of this.O) {
      const yc = (it.Y0 + it.Y1) / 2;
      const zi = this.base + it.z + Math.max(250, it.h * 0.22);
      out.push(
        this.tube([xm, y, z], [xm, yc, z], c, w),
        this.tube([xm, yc, z], [xm, yc, zi], c, w),
        this.tube([xm, yc, zi], [it.X0, yc, zi], c, w),
      );
    }
    return out;
  }

  /** Рама: передние стойки и верхние балки. */
  frontFrame() {
    const { V, Le, We, top, dz, frame } = this;
    return [
      ...V.box([0, 0, dz], [150, 150, top], frame),
      ...V.box([Le - 150, 0, dz], [Le, 150, top], frame),
      ...V.box([0, 0, top - 110], [Le, 110, top], frame),
      ...V.box([0, 0, top - 110], [110, We, top], frame),
    ];
  }

  /** Глушитель на крыше. */
  muffler(m) {
    const { V, ox, oy, top, base } = this;
    const r = m.d / 2;
    const cz = top + m.gap + r;
    const steel = '#8d949b';
    const ex = m.exhaust && [ox + m.exhaust.x, oy + m.exhaust.y];
    const pipe = ex && V.vcyl([...ex, 65], [base + m.exhaust.z, cz], steel, false);
    if (m.dir === 'y+') {
      const cx = ox + m.x + r;
      const ya = oy + m.y;
      return [...(pipe ? [pipe] : []), ...V.box([cx - r, ya, cz - r], [cx + r, ya + m.ly, cz + r], m.color)];
    }
    const x0 = ox + m.x;
    const x1 = x0 + m.lx;
    const cy = oy + m.y + r;
    const out = pipe
      ? [pipe, V.line([...ex, cz], [ex[0], cy, cz], RalColor.shade(steel, 0.7), Math.max(3, 130 * this.k))]
      : [];
    for (const f of [0.18, 0.82])
      out.push(
        ...V.box([x0 + m.lx * f - 40, cy - r * 0.7, top], [x0 + m.lx * f + 40, cy + r * 0.7, cz - r * 0.6], '#3a3f45'),
      );
    out.push(V.hcyl([x0, x1], [cy, cz, r], m.color));
    out.push(
      m.dir === 'x-'
        ? V.hcyl([x0 - m.outlet, x0], [cy, cz, 60], steel)
        : V.hcyl([x1, x1 + m.outlet], [cy, cz, 60], steel),
    );
    return out;
  }

  /** Нижний пояс срезанных стенок: торец у двери и стена прохода (с дверями); гофр морского контейнера. */
  cutBand() {
    const { Le, We, dz, band, ox, oy, wall } = this;
    const cut = RalColor.mix('#dfe3e7', wall, 0.15);
    const zb = dz + band;
    return [
      this.face(
        [
          [0, 0, dz],
          [0, We, dz],
          [0, We, zb],
          [0, 0, zb],
        ],
        RalColor.shade(wall, 0.82),
      ),
      this.face(
        [
          [0, 0, zb],
          [ox, 0, zb],
          [ox, We, zb],
          [0, We, zb],
        ],
        cut,
      ),
      this.face(
        [
          [0, 0, dz],
          [Le, 0, dz],
          [Le, 0, zb],
          [0, 0, zb],
        ],
        wall,
      ),
      this.face(
        [
          [0, 0, zb],
          [Le, 0, zb],
          [Le, oy, zb],
          [0, oy, zb],
        ],
        cut,
      ),
      ...this.bandRibs(),
      ...this.bandDoors(),
    ];
  }

  /** Швы панелей пояса (у морского — гофр): p(d, z) — точка шва со сдвигом d вдоль стены. */
  bandRibs() {
    const { V, Le, We, dz, band } = this;
    const sea = this.g.sea;
    const rib = sea ? 280 : 1150;
    const dark = RalColor.shade(this.wall, sea ? 0.9 : 0.8);
    const side = RalColor.shade(dark, sea ? 0.86 : 0.85);
    const seam = (p, col) =>
      sea
        ? this.face([p(0, dz), p(rib * 0.6, dz), p(rib * 0.6, dz + band), p(0, dz + band)], col, 0)
        : V.line(p(0, dz), p(0, dz + band), col, 1.4);
    const out = [];
    for (let x = rib; x < Le - 100; x += sea ? rib * 2 : rib) out.push(seam((d, z) => [x + d, -1, z], dark));
    for (let y = rib; y < We - 100; y += sea ? rib * 2 : rib) out.push(seam((d, z) => [-1, y + d, z], side));
    return out;
  }

  /** В поясе: ворота в торце у входа (запорные штанги), дверь оператора в торце или в стене прохода. */
  bandDoors() {
    const { V, plan, dz, band, ox, oy, wall } = this;
    const out = [];
    const G = [plan.gates, plan.gates2].find(q => q && q.wall === 'left');
    if (G) {
      const w = G.y1 - G.y0;
      const y0 = oy + G.y0;
      for (const f of [0.12, 0.38, 0.62, 0.88])
        out.push(V.line([-6, y0 + w * f, dz + 40], [-6, y0 + w * f, dz + band], '#3b4148', 2.6));
      out.push(V.line([-6, y0 + w / 2, dz], [-6, y0 + w / 2, dz + band], RalColor.shade(wall, 0.55), 1.6));
    }
    const en = plan.entry;
    const leaf = Q => this.face(Q, RalColor.shade(wall, 0.93), 1.2);
    if (en && en.wall === 'left' && !en.sea)
      out.push(
        leaf([
          [-3, oy + en.y0, dz + 60],
          [-3, oy + en.y1, dz + 60],
          [-3, oy + en.y1, dz + band],
          [-3, oy + en.y0, dz + band],
        ]),
      );
    if (en && en.wall === 'front')
      out.push(
        leaf([
          [ox + en.x0, -3, dz + 60],
          [ox + en.x1, -3, dz + 60],
          [ox + en.x1, -3, dz + band],
          [ox + en.x0, -3, dz + band],
        ]),
      );
    return out;
  }
}
