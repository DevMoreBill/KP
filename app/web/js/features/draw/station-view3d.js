import { PipeMaterial } from '../layout/pipe-material.js';
import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StSvg } from './st-svg.js';
import { StView } from './st-view.js';
import { View3dUnits } from './view3d-units.js';

/** 3D-вид станции в SVG (без WebGL): разрез — стенки со стороны зрителя срезаны до пояса, видно оборудование. */
export class StationView3D {
  static WIDTH = 1600;
  static HEIGHT = 1100;
  static AZIMUTH = 30;
  static ELEVATION = 24;
  static DEFS =
    '<filter id="blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="blur18" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>';

  /** Plan — StationLayout.solve(...); meta: {deck — высота шасси, мм}. */
  static svg(plan, meta = {}) {
    return new StationView3D(plan, meta).draw();
  }

  constructor(plan, meta) {
    const geo = plan.geo;
    this.plan = plan;
    this.g = geo;
    [this.Le, this.We, this.He] = geo.ext;
    [this.Li, this.Wi, this.Hi] = plan.int;
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.dz = plan.chassis ? meta.deck || 1150 : 0;
    this.base = this.dz + StationGeo.zFloor(geo.type);
    this.ceil = this.base + this.Hi;
    this.top = this.dz + this.He;
    this.rf = plan.roof || [];
    this.O = (plan.outside || []).map(item => this.placed(item));
    this.project();
    this.wall = plan.wallColor || '#CBD0CC';
    this.frame = plan.frameColor || RalColor.shade(this.wall, 0.7);
    this.roofC = plan.roofColor || this.frame;
    this.lining = RalColor.mix('#eef1f4', this.wall, 0.1);
    this.band = Math.max(650, Math.min(900, this.He * 0.3));
  }

  /** Изделие с габаритом в координатах контейнера: X0…X1, Y0…Y1. */
  placed(item) {
    return {
      ...item,
      X0: this.ox + item.x,
      Y0: this.oy + item.y,
      X1: this.ox + item.x + item.lx,
      Y1: this.oy + item.y + item.ly,
    };
  }

  /** Проекция и масштаб — по габаритам контейнера (с шасси, глушителем и ресиверами снаружи). */
  project() {
    const azimuth = (StationView3D.AZIMUTH * Math.PI) / 180;
    const el = (StationView3D.ELEVATION * Math.PI) / 180;
    const [cosAz, sinAz, cosEl, sinEl] = [Math.cos(azimuth), Math.sin(azimuth), Math.cos(el), Math.sin(el)];
    const rawProject = (x, y, z) => [x * cosAz - y * sinAz, -((x * sinAz + y * cosAz) * sinEl + z * cosEl)];
    const roofUp = this.rf.length ? Math.max(...this.rf.map(muffler => muffler.gap + muffler.d)) : 0;
    const xEnd = Math.max(this.Le, ...this.O.map(i => i.X1 + 400));
    const zTop = Math.max(this.top + roofUp, ...this.O.map(i => this.base + i.z + i.h));
    const ext = [];
    for (const x of [0, xEnd]) for (const y of [0, this.We]) for (const z of [0, zTop]) ext.push(rawProject(x, y, z));
    const [minX, maxX] = [Math.min(...ext.map(point => point[0])), Math.max(...ext.map(point => point[0]))];
    const [minY, maxY] = [Math.min(...ext.map(point => point[1])), Math.max(...ext.map(point => point[1]))];
    const width = StationView3D.WIDTH;
    const height = Math.round(
      Math.max(760, Math.min(StationView3D.HEIGHT, (width * 0.9 * (maxY - minY)) / (maxX - minX) / 0.84)),
    );
    const k = Math.min((width * 0.9) / (maxX - minX), (height * 0.84) / (maxY - minY));
    const shiftX = (width - (maxX - minX) * k) / 2 - minX * k;
    const shiftY = (height - (maxY - minY) * k) / 2 - minY * k + height * 0.02;
    this.height = height;
    this.k = k;
    this.V = new StView(
      (x, y, z) => {
        const point = rawProject(x, y, z);
        return [point[0] * k + shiftX, point[1] * k + shiftY];
      },
      k,
      sinEl,
      StSvg,
    );
  }

  /** Все грани в порядке удалённости — SVG. */
  draw() {
    const { V: view, plan, dz } = this;
    const out = [];
    const project = view.project;
    const shadow = [
      project(-300, -250, 0),
      project(this.Le + 500, -250, 0),
      project(this.Le + 500, this.We + 450, 0),
      project(-300, this.We + 450, 0),
    ];
    out.push(StSvg.poly(shadow, '#000000', '', 0, ' opacity="0.10" filter="url(#blur18)"'));
    if (dz) out.push(...view.chassis(this.Le, this.We, dz));
    out.push(...this.back(), ...this.floor());
    // шкафы на стене прохода — на срезанной стене: не показываются
    const items = plan.items
      .filter(item => !(item.mount === 'wall' && item.wall === 'front'))
      .map(item => this.placed(item));
    out.push(...this.louvers());
    const over = this.pipes(out, items);
    out.push(...this.equipment(items, over));
    if (this.O.length) out.push(...this.outside());
    out.push(...this.cutBand(), ...this.frontFrame());
    for (const muffler of this.rf) out.push(...this.muffler(muffler));
    return StSvg.doc(
      StationView3D.WIDTH,
      this.height,
      StSvg.rect([0, 0, StationView3D.WIDTH, this.height], '#ffffff') + out.join(''),
      StationView3D.DEFS + view.defs.join(''),
    );
  }

  /** Прямоугольник [x0, y0, z0] → [x1, y1, z1] в плоскости: по углам a, b, c, d. */
  face(quad, fill, strokeW = 1, extra = '') {
    return this.V.face(quad, fill, strokeW, extra);
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
    const { V: view, ox, oy, Li, Wi, Le, We, base, top, lining } = this;
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
        out.push(view.line([x, y, base], [x, y, top], RalColor.shade(lining, 0.86), 1.2));
    return [
      ...out,
      ...view.box([0, We - 150, this.dz], [150, We, top], this.frame),
      ...view.box([Le - 150, We - 150, this.dz], [Le, We, top], this.frame),
    ];
  }

  /** Пол и рифлёный настил. */
  floor() {
    const { V: view, ox, oy, Li, Wi, base } = this;
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
    for (let x = ox + 1250; x < ox + Li; x += 1250)
      out.push(view.line([x, oy, base], [x, oy + Wi, base], '#9aa1a8', 1.2));
    return out;
  }

  /** Жалюзи по расчёту вентиляции на задней стене и в дальнем торце — изнутри (размеры — на чертеже). */
  louvers() {
    const { ox, oy, Li, Wi, base } = this;
    const louvers = ((this.plan.vent && this.plan.vent.louvers) || []).filter(
      louver => louver.wall === 'back' || louver.wall === 'right',
    );
    return louvers.map(louver => {
      const onBack = louver.wall === 'back';
      const start = onBack
        ? [ox + louver.u0, oy + Wi - 2, base + louver.z0]
        : [ox + Li - 2, oy + louver.u0, base + louver.z0];
      const end = onBack
        ? [ox + louver.u1, oy + Wi - 2, base + louver.z1]
        : [ox + Li - 2, oy + louver.u1, base + louver.z1];
      return this.V.louver(start, end, onBack ? 'y' : 'x');
    });
  }

  /** Труба: тёмный контур и светлый блик. */
  tube(start, end, color, width) {
    const { V: view } = this;
    return (
      view.line(start, end, RalColor.shade(color, 0.62), width + 2) +
      view.line(start, end, color, width) +
      view.line(start, end, RalColor.shade(color, 1.35), Math.max(1, width * 0.3))
    );
  }

  /** Трубопровод вдоль задней стены. */
  pipes(out, items) {
    const over = new Map();
    const width = Math.max(4, 90 * this.k);
    for (const piping of this.plan.piping || [])
      for (const line of piping.lines) {
        const color = PipeMaterial.idColor(line.medium, piping.color); // окраска по ГОСТ 14202-69
        out.push(...this.main(line, color, width));
        for (const branch of line.branches) this.branch({ l: line, b: branch, c: color, w: width }, items, out, over);
      }
    return over;
  }

  /** Магистраль и выход к стене (через торец, заднюю стену или над проёмом). */
  main(line, color, width) {
    const [y, z] = [this.oy + line.y, this.base + line.z];
    const out = StationLayout.runs(line).map(([start, end]) =>
      this.tube([this.ox + start, y, z], [this.ox + end, y, z], color, width),
    );
    const outPath = this.O.length ? null : StationLayout.outPath(line, this.Wi);
    if (!outPath) return out;
    const points = outPath.pts.map(([x, localY, localZ]) => [this.ox + x, this.oy + localY, this.base + localZ]);
    for (let index = 1; index < points.length; index++)
      out.push(this.tube(points[index - 1], points[index], color, width));
    return out;
  }

  /** Отвод: подъём к коллектору входов, спуск на оборудование (в over) или по месту. */
  branch({ l: line, b: branch, c: color, w: width }, items, out, over) {
    const { ox, oy, base } = this;
    const z = base + line.z;
    const [start, bend] = [
      [ox + branch.x, oy + branch.y0, z],
      [ox + branch.x, oy + branch.y1, z],
    ];
    if (branch.tee) {
      out.push(
        this.tube(start, bend, color, width) +
          this.tube(bend, [ox + branch.x, oy + branch.y1, base + branch.z1], color, width),
      );
      return;
    }
    const tube = this.tube(start, bend, color, width * 0.8);
    if (!(branch.z1 < line.z)) {
      out.push(tube);
      return;
    }
    const target = items.find(i => `${i.id}#${i.unit}` === branch.to);
    const bottomZ = base + (target ? Math.min(branch.z1, View3dUnits.top(target)) : branch.z1);
    over.set(
      branch.to,
      (over.get(branch.to) || '') +
        tube +
        this.tube(bend, [ox + branch.x, oy + branch.y1, bottomZ], color, width * 0.8),
    );
  }

  /** Оборудование: тени, затем по глубине (дальнее — раньше), за каждым — спуск трубы на него. */
  equipment(items, over) {
    const { V: view, base } = this;
    const out = [];
    for (const item of items.filter(i => i.mount === 'floor' || i.mount === 'frame'))
      out.push(
        this.face(
          [
            [item.X0 + 60, item.Y0 + 40, base + 1],
            [item.X1 + 160, item.Y0 + 40, base + 1],
            [item.X1 + 160, item.Y1 + 120, base + 1],
            [item.X0 + 60, item.Y1 + 120, base + 1],
          ],
          '#000000',
          0,
          ' opacity="0.16" filter="url(#blur6)"',
        ),
      );
    const spot = { vent: this.plan.vent, ox: this.ox, oy: this.oy, Li: this.Li, x0: this.plan.geo.x0 || 0 };
    const ctx = { base, ceil: this.ceil, yWall: this.oy + this.Wi, at: spot };
    for (const item of view.order(items)) {
      out.push(...View3dUnits.equip(view, item, ctx));
      const tubeSvg = over.get(`${item.id}#${item.unit}`);
      if (tubeSvg) out.push(tubeSvg);
    }
    return out;
  }

  /** Ресиверы снаружи — за дальним торцом на площадке; трубопровод от торца к ним. */
  outside() {
    const { V: view, O: outside, base } = this;
    const out = outside.map(item =>
      this.face(
        [
          [item.X0 - 200, item.Y0 - 200, base + item.z],
          [item.X1 + 200, item.Y0 - 200, base + item.z],
          [item.X1 + 200, item.Y1 + 200, base + item.z],
          [item.X0 - 200, item.Y1 + 200, base + item.z],
        ],
        '#b9b6ae',
      ),
    );
    const line = (this.plan.piping || [])
      .flatMap(entry => entry.lines)
      .find(entry => entry.medium === 'air' && !entry.header && entry.x1 >= this.Li - 1);
    if (line) out.push(...this.outPipe(line));
    for (const item of view.order(outside))
      out.push(...View3dUnits.equip(view, item, { base, ceil: this.ceil, yWall: this.oy + this.Wi }));
    return out;
  }

  /** Трубопровод к ресиверам снаружи. */
  outPipe(line) {
    const color = PipeMaterial.idColor('air', '#8d949b');
    const width = Math.max(4, 90 * this.k);
    const midX = (this.Le + Math.min(...this.O.map(i => i.X0))) / 2;
    const [y, z] = [this.oy + line.y, this.base + line.z];
    const out = [this.tube([this.Le, y, z], [midX, y, z], color, width)];
    for (const item of this.O) {
      const midY = (item.Y0 + item.Y1) / 2;
      const inletZ = this.base + item.z + Math.max(250, item.h * 0.22);
      out.push(
        this.tube([midX, y, z], [midX, midY, z], color, width),
        this.tube([midX, midY, z], [midX, midY, inletZ], color, width),
        this.tube([midX, midY, inletZ], [item.X0, midY, inletZ], color, width),
      );
    }
    return out;
  }

  /** Рама: передние стойки и верхние балки. */
  frontFrame() {
    const { V: view, Le, We, top, dz, frame } = this;
    return [
      ...view.box([0, 0, dz], [150, 150, top], frame),
      ...view.box([Le - 150, 0, dz], [Le, 150, top], frame),
      ...view.box([0, 0, top - 110], [Le, 110, top], frame),
      ...view.box([0, 0, top - 110], [110, We, top], frame),
    ];
  }

  /** Глушитель на крыше. */
  muffler(muffler) {
    const { V: view, ox, oy, top, base } = this;
    const radius = muffler.d / 2;
    const centerZ = top + muffler.gap + radius;
    const steel = '#8d949b';
    const exhaust = muffler.exhaust && [ox + muffler.exhaust.x, oy + muffler.exhaust.y];
    const pipe = exhaust && view.vcyl([...exhaust, 65], [base + muffler.exhaust.z, centerZ], steel, false);
    if (muffler.dir === 'y+') {
      const centerX = ox + muffler.x + radius;
      const startY = oy + muffler.y;
      return [
        ...(pipe ? [pipe] : []),
        ...view.box(
          [centerX - radius, startY, centerZ - radius],
          [centerX + radius, startY + muffler.ly, centerZ + radius],
          muffler.color,
        ),
      ];
    }
    const x0 = ox + muffler.x;
    const x1 = x0 + muffler.lx;
    const centerY = oy + muffler.y + radius;
    const out = pipe
      ? [
          pipe,
          view.line(
            [...exhaust, centerZ],
            [exhaust[0], centerY, centerZ],
            RalColor.shade(steel, 0.7),
            Math.max(3, 130 * this.k),
          ),
        ]
      : [];
    for (const frac of [0.18, 0.82])
      out.push(
        ...view.box(
          [x0 + muffler.lx * frac - 40, centerY - radius * 0.7, top],
          [x0 + muffler.lx * frac + 40, centerY + radius * 0.7, centerZ - radius * 0.6],
          '#3a3f45',
        ),
      );
    out.push(view.hcyl([x0, x1], [centerY, centerZ, radius], muffler.color));
    out.push(
      muffler.dir === 'x-'
        ? view.hcyl([x0 - muffler.outlet, x0], [centerY, centerZ, 60], steel)
        : view.hcyl([x1, x1 + muffler.outlet], [centerY, centerZ, 60], steel),
    );
    return out;
  }

  /** Нижний пояс срезанных стенок: торец у двери и стена прохода (с дверями); гофр морского контейнера. */
  cutBand() {
    const { Le, We, dz, band, ox, oy, wall } = this;
    const cut = RalColor.mix('#dfe3e7', wall, 0.15);
    const bandTop = dz + band;
    return [
      this.face(
        [
          [0, 0, dz],
          [0, We, dz],
          [0, We, bandTop],
          [0, 0, bandTop],
        ],
        RalColor.shade(wall, 0.82),
      ),
      this.face(
        [
          [0, 0, bandTop],
          [ox, 0, bandTop],
          [ox, We, bandTop],
          [0, We, bandTop],
        ],
        cut,
      ),
      this.face(
        [
          [0, 0, dz],
          [Le, 0, dz],
          [Le, 0, bandTop],
          [0, 0, bandTop],
        ],
        wall,
      ),
      this.face(
        [
          [0, 0, bandTop],
          [Le, 0, bandTop],
          [Le, oy, bandTop],
          [0, oy, bandTop],
        ],
        cut,
      ),
      ...this.bandRibs(),
      ...this.bandDoors(),
    ];
  }

  /** Швы панелей пояса (у морского — гофр): p(d, z) — точка шва со сдвигом d вдоль стены. */
  bandRibs() {
    const { V: view, Le, We, dz, band } = this;
    const sea = this.g.sea;
    const rib = sea ? 280 : 1150;
    const dark = RalColor.shade(this.wall, sea ? 0.9 : 0.8);
    const side = RalColor.shade(dark, sea ? 0.86 : 0.85);
    const seam = (face, col) =>
      sea
        ? this.face([face(0, dz), face(rib * 0.6, dz), face(rib * 0.6, dz + band), face(0, dz + band)], col, 0)
        : view.line(face(0, dz), face(0, dz + band), col, 1.4);
    const out = [];
    for (let x = rib; x < Le - 100; x += sea ? rib * 2 : rib) out.push(seam((offset, z) => [x + offset, -1, z], dark));
    for (let y = rib; y < We - 100; y += sea ? rib * 2 : rib) out.push(seam((offset, z) => [-1, y + offset, z], side));
    return out;
  }

  /** В поясе: ворота в торце у входа (запорные штанги), дверь оператора в торце или в стене прохода. */
  bandDoors() {
    const { V: view, plan, dz, band, ox, oy, wall } = this;
    const out = [];
    const gates = [plan.gates, plan.gates2].find(gate => gate && gate.wall === 'left');
    if (gates) {
      const width = gates.y1 - gates.y0;
      const y0 = oy + gates.y0;
      for (const frac of [0.12, 0.38, 0.62, 0.88])
        out.push(view.line([-6, y0 + width * frac, dz + 40], [-6, y0 + width * frac, dz + band], '#3b4148', 2.6));
      out.push(view.line([-6, y0 + width / 2, dz], [-6, y0 + width / 2, dz + band], RalColor.shade(wall, 0.55), 1.6));
    }
    const entry = plan.entry;
    const leaf = quad => this.face(quad, RalColor.shade(wall, 0.93), 1.2);
    if (entry && entry.wall === 'left' && !entry.sea)
      out.push(
        leaf([
          [-3, oy + entry.y0, dz + 60],
          [-3, oy + entry.y1, dz + 60],
          [-3, oy + entry.y1, dz + band],
          [-3, oy + entry.y0, dz + band],
        ]),
      );
    if (entry && entry.wall === 'front')
      out.push(
        leaf([
          [ox + entry.x0, -3, dz + 60],
          [ox + entry.x1, -3, dz + 60],
          [ox + entry.x1, -3, dz + band],
          [ox + entry.x0, -3, dz + band],
        ]),
      );
    return out;
  }
}
