import { PipeMaterial } from '../layout/pipe-material.js';
import { StationLayout } from '../layout/station-layout.js';
import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { StMesh } from './st-mesh.js';

/** Трубопровод (линии, отводы, арматура, выход с фланцем), маркировка потока, глушители ДГУ на крыше. */
export class ScenePipes {
  constructor(scene) {
    this.scene = scene;
  }

  /** Выход трубопровода (решение владельца 19.10). */
  outlet(line, outPath, mesh, dark, radius) {
    const points = outPath.pts.map(bolt => this.scene.point(...bolt));
    const last = points[points.length - 1];
    const [dx, dy] = outPath.dir;
    const wallAt = dx ? this.scene.ox : this.scene.oy;
    const flange = (line.out.flange || 150) / 1000;
    const along = dist => [last[0] + dx * dist, last[1] + dy * dist, last[2]];
    for (let k = 1; k < points.length; k++) {
      mesh.tube(points[k - 1], points[k], radius, 20);
      mesh.sphere(points[k], radius * 1.02, 12);
    }
    if (points.length === 1) mesh.sphere(points[0], radius * 1.02, 12);
    mesh.tube(last, along(wallAt + flange), radius, 20); // сквозь стену и патрубок снаружи
    dark.tube(along(wallAt * 0.2), along(wallAt + 0.03), radius * 1.45, 18); // гильза с уплотнением
    const flangeMesh = this.scene.meshFor(StMat.metal('#8d949b', 0.35));
    const thick = 0.018;
    const flangeR = Math.max(radius * 2.3, radius + 0.045);
    flangeMesh.tube(along(wallAt + flange - thick), along(wallAt + flange), flangeR, 24);
    flangeMesh.tube(along(wallAt + flange), along(wallAt + flange + thick), flangeR, 24); // фланец и заглушка
    for (let bolt = 0; bolt < 8; bolt++) {
      const angle = (bolt * Math.PI) / 4;
      const boltR = flangeR * 0.78;
      const offset = [Math.cos(angle) * boltR, Math.sin(angle) * boltR];
      const shift = dx ? [0, offset[0], offset[1]] : [offset[0], 0, offset[1]];
      const boltAt = along(wallAt + flange - thick - 0.006);
      dark.tube(
        [boltAt[0] + shift[0], boltAt[1] + shift[1], boltAt[2] + shift[2]],
        [
          boltAt[0] + shift[0] + dx * (2 * thick + 0.012),
          boltAt[1] + shift[1] + dy * (2 * thick + 0.012),
          boltAt[2] + shift[2],
        ],
        0.005,
        6,
      );
    } // болты
  }

  /** Трубопровод: все линии. */
  piping(piping) {
    const dark = this.scene.meshFor(StMat.paint(StMat.DARK, 0.6));
    const red = this.scene.meshFor(StMat.paint('#c83a2e', 0.4));
    const bore =
      +(String(piping.dn || '').match(/\d+/) || [0])[0] || (this.scene.plan.pipe && this.scene.plan.pipe.dn) || 0;
    for (const line of piping.lines) this.line(piping, line, { dk: dark, red }, bore);
  }

  /** Материал линии: цвет среды или нержавейка. */
  lineMat(piping, line) {
    const id = PipeMaterial.idColor(line.medium, '');
    if (!id && piping.mat === 'inox') return this.scene.meshFor(StMat.metal(StMat.INOX, 0.22));
    const color = id || piping.color;
    return this.scene.meshFor(piping.mat === 'pp' ? StMat.paint(color, 0.32) : { c: color, r: 0.38, m: 0.35 });
  }

  /** Радиус трубы по Ду, м. */
  static radius(line, bore) {
    const def = { fuel: 25, air: 50 }[line.medium] || 80;
    return Math.max(0.012, Math.min(0.08, (bore || def) / 2000 + 0.006));
  }

  /** Линия трубопровода с отводами и выходом. */
  line(piping, line, { dk: dark, red }, bore) {
    const id = PipeMaterial.idColor(line.medium, '');
    const mesh = this.lineMat(piping, line);
    const radius = ScenePipes.radius(line, bore);
    const lineEnd = this.scene.point(line.x1, line.y, line.z);
    const outPath = (this.scene.plan.outside || []).length ? null : StationLayout.outPath(line, this.scene.plan.int[1]);
    const out = !outPath && line.x1 >= this.scene.plan.int[0] - 1;
    const end = out ? [this.scene.Le + 0.12, lineEnd[1], lineEnd[2]] : lineEnd;
    this.runs(line, mesh, radius, end);
    if (id) this.marks(line, radius);
    if (out) {
      mesh.tube(
        [this.scene.Le + 0.04, lineEnd[1], lineEnd[2]],
        [this.scene.Le + 0.07, lineEnd[1], lineEnd[2]],
        radius * 1.7,
        20,
      );
      dark.tube(
        [this.scene.Le - 0.03, lineEnd[1], lineEnd[2]],
        [this.scene.Le + 0.03, lineEnd[1], lineEnd[2]],
        radius * 1.4,
        18,
      );
    }
    if (outPath) this.outlet(line, outPath, mesh, dark, radius);
    this.supports(line, dark, radius);
    for (const bypass of line.bypass || []) this.bypass(line, bypass, { m: mesh, red }, radius);
    for (const branch of line.branches) this.branch(line, branch, { m: mesh, red }, radius);
  }

  /** Участки линии между разрывами. */
  runs(line, mesh, radius, end) {
    for (const [from, till] of StationLayout.runs(line)) {
      const start = this.scene.point(from, line.y, line.z);
      const stop = till >= line.x1 ? end : this.scene.point(till, line.y, line.z);
      mesh.tube(start, stop, radius, 20);
      mesh.sphere(start, radius * 1.02, 12);
      if (till < line.x1) mesh.sphere(stop, radius * 1.02, 12);
    }
  }

  /** Опоры у стены: кронштейн и хомут. */
  supports(line, dark, radius) {
    const start = this.scene.point(line.x0, line.y, line.z);
    const end = this.scene.point(line.x1, line.y, line.z);
    const wallY = this.scene.oy + this.scene.Wi;
    if (wallY - start[1] >= 0.6) return;
    for (let x = start[0] + 0.4; x < Math.min(end[0], this.scene.ox + this.scene.Li) - 0.2; x += 1.4) {
      dark.box([x - 0.02, start[1] - 0.03, start[2] - radius - 0.04], [x + 0.02, wallY, start[2] - radius - 0.01]);
      dark.tube([x - 0.015, start[1], start[2]], [x + 0.015, start[1], start[2]], radius * 1.3, 16, {
        caps: [false, false],
      });
    }
  }

  /** Байпас осушителя: обвод под магистралью, ручка крана — вниз. */
  bypass(line, bypass, { m: mesh, red }, radius) {
    const lowZ = line.z - 260;
    const start = this.scene.point(bypass.x0, line.y, line.z);
    const end = this.scene.point(bypass.x1, line.y, line.z);
    const startLow = this.scene.point(bypass.x0, line.y, lowZ);
    const endLow = this.scene.point(bypass.x1, line.y, lowZ);
    const v = this.scene.point((bypass.x0 + bypass.x1) / 2, line.y, lowZ);
    for (const [from, till] of [
      [start, startLow],
      [end, endLow],
      [startLow, endLow],
    ])
      mesh.tube(from, till, radius * 0.85, 16, { caps: [false, false] });
    for (const till of [start, end, startLow, endLow]) mesh.sphere(till, radius * 0.92, 12);
    mesh.sphere(v, radius * 1.45, 12);
    red.box(
      [v[0] - 0.012, v[1] - 0.012, v[2] - radius * 1.3 - 0.018],
      [v[0] + 0.13, v[1] + 0.012, v[2] - radius * 1.3],
      0.004,
    );
  }

  /** Подъём от магистрали к коллектору входов параллельных аппаратов. */
  tee(mesh, pts, radius) {
    const [head, turn, tail] = pts;
    for (const [start, end] of [
      [head, turn],
      [turn, tail],
    ])
      if (StV.len(StV.sub(end, start)) > 0.01) {
        mesh.tube(start, end, radius, 16, { caps: [false, false] });
        mesh.sphere(end, radius * 1.02, 12);
      }
    mesh.sphere(head, radius * 1.02, 12);
  }

  /** Отвод к оборудованию: спуск, вход сбоку (ресивер — внизу), фланец у оборудования, шаровой кран. */
  branch(line, branch, { m: mesh, red }, radius) {
    const pts = [
      this.scene.point(branch.x, branch.y0, line.z),
      this.scene.point(branch.x, branch.y1, line.z),
      this.scene.point(branch.x, branch.y1, branch.z1),
    ];
    if (branch.tee) {
      this.tee(mesh, pts, radius);
      return;
    }
    const [head, turn, tail] = pts;
    mesh.sphere(head, radius * 1.05, 12);
    if (StV.len(StV.sub(turn, head)) > 0.01) {
      mesh.tube(head, turn, radius * 0.85, 16, { caps: [false, false] });
      mesh.sphere(turn, radius * 0.88, 12);
    }
    const down = branch.z1 < line.z;
    if (down) mesh.tube(turn, tail, radius * 0.85, 16, { caps: [false, false] });
    const run = StV.sub(turn, head);
    const runLen = StV.len(run);
    const [last, dir] = this.branchEnd(branch, pts, down, mesh, radius);
    mesh.tube(StV.add(last, StV.mul(dir, -0.02)), last, radius * 1.6, 18);
    const v =
      runLen > 0.15
        ? StV.add(head, StV.mul(run, Math.min(0.12, runLen * 0.5) / runLen))
        : StV.add(turn, [0, 0, -Math.min(0.12, Math.max(0, ((line.z - branch.z1) / 1000) * 0.5))]);
    mesh.sphere(v, radius * 1.45, 12);
    red.box(
      [v[0] - 0.012, v[1] - 0.012, v[2] + radius * 1.3],
      [v[0] + 0.13, v[1] + 0.012, v[2] + radius * 1.3 + 0.018],
      0.004,
    );
  }

  /** Конец отвода у оборудования и направление входа. */
  branchEnd(branch, [head, turn, tail], down, mesh, radius) {
    const target = this.scene.plan.items.find(i => StationLayout.key(i) === branch.to);
    if (down && target && branch.z1 < target.h - 30) {
      const center = this.scene.point(target.x + target.lx / 2, target.y + target.ly / 2, branch.z1);
      const v = StV.norm([0, center[1] - tail[1], 0]);
      const tip = StV.add(tail, StV.mul(v, 0.07));
      mesh.sphere(tail, radius * 0.88, 12);
      mesh.tube(tail, tip, radius * 0.85, 16, { caps: [false, false] });
      return [tip, v];
    }
    if (down) return [tail, [0, 0, -1]];
    const run = StV.sub(turn, head);
    const runLen = StV.len(run);
    return [turn, runLen > 1e-3 ? StV.mul(run, 1 / runLen) : [0, 0, -1]];
  }

  /** Стрелки направления потока (наклейки сбоку, к зрителю). */
  marks(line, radius) {
    const branchXs = (line.branches || []).map(till => till.x);
    const bypassXs = (line.bypass || []).flatMap(bypass => [bypass.x0, bypass.x1]);
    const height = Math.max(0.035, radius * 1.3);
    const width = height * 3.2;
    for (const [from, till] of StationLayout.runs(line)) {
      if (till - from < 500) continue;
      for (let x = from + 450; x <= till - 300; x += 1000) {
        if ([...branchXs, ...bypassXs].some(v => Math.abs(v - x) < 200)) continue;
        const point = this.scene.point(x, line.y, line.z);
        this.scene.sticker(
          { type: 'sign', id: 'FLOW', dir: PipeMaterial.flow(line, x) },
          [point[0], point[1] - radius - 0.003, point[2]],
          [0, -1, 0],
          [width, height],
        );
      }
    }
    if (line.medium === 'air') this.dropMarks(line, radius);
  }

  /** Метки направления на опусках. */
  dropMarks(line, radius) {
    for (const branch of line.branches || []) {
      const len = line.z - branch.z1;
      if (!branch.role || len < 350) continue;
      const point = this.scene.point(branch.x, branch.y1, branch.z1 + len / 2);
      const markR = radius * 0.85;
      this.scene.sticker(
        { type: 'sign', id: 'FLOWV', dir: branch.role === 'in' ? -1 : 1 },
        [point[0], point[1] - markR - 0.003, point[2]],
        [0, -1, 0],
        [Math.max(0.03, markR * 1.3), Math.max(0.03, markR * 1.3) * 3.2],
      );
    }
  }

  /** Глушитель на крыше. */
  muffler(muffler) {
    const meters = this.scene.meters;
    const dir = muffler.dir || 'x+';
    if (dir === 'x+')
      return this.muffler0(
        muffler,
        [this.scene.ox + meters(muffler.x), this.scene.oy + meters(muffler.y)],
        meters(muffler.lx),
        [
          this.scene.ox + meters(muffler.exhaust ? muffler.exhaust.x : 0),
          this.scene.oy + meters(muffler.exhaust ? muffler.exhaust.y : 0),
        ],
        [k => this.scene.meshFor(k), null],
      );
    if (dir === 'x-') {
      const from = this.scene.ox + meters(muffler.x);
      const till = from + meters(muffler.lx);
      const map = point => [from + till - point[0], point[1], point[2]];
      return this.muffler0(
        muffler,
        [from, this.scene.oy + meters(muffler.y)],
        meters(muffler.lx),
        muffler.exhaust
          ? [from + till - (this.scene.ox + meters(muffler.exhaust.x)), this.scene.oy + meters(muffler.exhaust.y)]
          : null,
        [k => StMesh.mapped(this.scene.meshFor(k), map), null],
      );
    }
    const map = point => [point[1], point[0], point[2]];
    const spanY = [this.scene.oy + meters(muffler.y), this.scene.oy + meters(muffler.y + muffler.ly)];
    const roofZ =
      this.scene.rise > 0
        ? Math.max(...spanY.map(y => this.scene.roofZ(y)), this.scene.roofZ(this.scene.We / 2)) + 0.04
        : null;
    return this.muffler0(
      muffler,
      [spanY[0], this.scene.ox + meters(muffler.x)],
      meters(muffler.ly),
      muffler.exhaust ? [this.scene.oy + meters(muffler.exhaust.y), this.scene.ox + meters(muffler.exhaust.x)] : null,
      [k => StMesh.mapped(this.scene.meshFor(k), map), roofZ],
    );
  }

  /** Высота крыши под глушителем. */
  mufflerRoof(midY, radius, zr0) {
    if (zr0 != null) return [zr0, zr0 - 0.04];
    if (!(this.scene.rise > 0)) return [this.scene.top, this.scene.top];
    const near = this.scene.roofZ(midY - radius);
    const far = this.scene.roofZ(midY + radius);
    return [Math.max(near, far) + 0.04, Math.min(near, far)];
  }

  /** Глушитель в своей системе (вдоль +x, выхлоп к +x). */
  muffler0(muffler, [x0, y0], len, exhaust, [meshFor, zr0]) {
    const meters = this.scene.meters;
    const x1 = x0 + len;
    const radius = meters(muffler.d) / 2;
    const midY = y0 + radius;
    const body = meshFor(StMat.paint(muffler.color, 0.5));
    const dark = meshFor(StMat.paint(StMat.DARK, 0.55));
    const own = zr0 == null && (muffler.dir || 'x+') !== 'y+';
    const [roofZ, baseZ] = this.mufflerRoof(midY, radius, zr0);
    const axisZ = roofZ + meters(muffler.gap) + radius;
    // скатная крыша — опоры от ската
    for (const frac of [0.18, 0.82]) {
      const x = x0 + (x1 - x0) * frac;
      dark.box([x - 0.05, midY - radius * 0.75, baseZ], [x + 0.05, midY + radius * 0.75, axisZ - radius * 0.55], 0.004);
      dark.box([x - 0.06, midY - radius * 0.8, roofZ - 0.02], [x + 0.06, midY + radius * 0.8, roofZ]);
    }
    body.tube([x0 + radius * 0.25, midY, axisZ], [x1 - radius * 0.25, midY, axisZ], radius, 32, {
      caps: [false, false],
    });
    body.tube([x0, midY, axisZ], [x0 + radius * 0.25, midY, axisZ], radius * 0.7, 32, {
      caps: [true, false],
      r2: radius,
    });
    body.tube([x1 - radius * 0.25, midY, axisZ], [x1, midY, axisZ], radius, 32, {
      caps: [false, true],
      r2: radius * 0.7,
    });
    const steel = meshFor(StMat.metal('#a7adb3', 0.4));
    const outR = Math.max(0.05, radius * 0.28);
    const endX = x1 + meters(muffler.outlet);
    // выхлоп — горизонтально в сторону радиатора
    steel.tube([x1 - 0.02, midY, axisZ], [endX, midY, axisZ], outR, 20);
    steel.tube([endX - 0.012, midY, axisZ], [endX, midY, axisZ], outR * 1.2, 20, { caps: [false, false] });
    dark.tube([endX - 0.002, midY, axisZ], [endX, midY, axisZ], outR * 0.9, 20, { caps: [true, true] });
    if (muffler.exhaust && exhaust) {
      const [exx, exhaustY] = exhaust;
      const wrap = meshFor(StMat.metal('#c4c9cd', 0.55));
      wrap.tube(
        [exx, exhaustY, this.scene.base + meters(muffler.exhaust.z)],
        [exx, exhaustY, axisZ - radius * 0.8],
        Math.max(0.06, outR * 1.15),
        22,
      );
      const pipeZ = own && this.scene.rise > 0 ? this.scene.roofZ(exhaustY) + 0.04 : (zr0 ?? this.scene.top);
      dark.tube([exx, exhaustY, pipeZ - 0.02], [exx, exhaustY, pipeZ + 0.06], Math.max(0.06, outR * 1.15) * 1.6, 22);
    } // проходка через крышу
  }
}
