import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StMat } from './st-mat.js';
import { StV } from './st-v.js';

/** Стены с проёмами, двери и ворота (полотна, створки), помещение внутри: обшивка, пол, потолок, перегородки. */
export class SceneRoom {
  constructor(scene) {
    this.scene = scene;
  }

  /** Стена со стороны зрителя, когда она не срезана: панели между проёмами сервисных дверей, двери открыты. */
  frontWall(mesh, z0, z1, prof) {
    this.wallWithDoors(mesh, [z0, z1], prof, this.scene.frontOpenings, [0, -1]);
  }

  /** Задняя стена с дверями. */
  backWall(mesh, z0, z1, prof) {
    this.wallWithDoors(mesh, [z0, z1], prof, this.scene.doorsBack, [this.scene.We, 1]);
  }

  /** Длинная стена (yw — наружная плоскость, out — наружу) с проёмами. */
  wallWithDoors(mesh, zSpan, prof, doors, side) {
    const [wallY, out] = side;
    const cuts = doors
      .map(door => ({
        a: this.scene.ox + door.x0 / 1000,
        b: this.scene.ox + door.x1 / 1000,
        h: this.scene.base + door.h / 1000,
        n: door.leaves || 1,
        kind: door.kind || 'service',
        open: !!door.open,
      }))
      .sort((left, right) => left.a - right.a);
    this.sheets(mesh, cuts, prof, side, zSpan);
    const meshes = {
      fr: this.scene.meshFor(StMat.paint(this.scene.frame, 0.45)),
      leaf: this.scene.meshFor(StMat.paint(this.scene.door, 0.45)),
      inner: this.scene.meshFor(StMat.paint(this.scene.lining, 0.55)),
      dk: this.scene.meshFor(StMat.paint('#24292e', 0.55)),
    };
    const depth = this.scene.oy + 0.01;
    const bandY = out < 0 ? [0, depth] : [wallY - depth, wallY];
    for (const cut of cuts) if (cut.kind !== 'dgu') this.opening(cut, meshes, side, bandY); // дверь-жалюзи ДГУ — OutfitDoors
  }

  /** Панели стены между проёмами и над ними. */
  sheets(mesh, cuts, prof, [wallY, out], [z0, z1]) {
    const sheet = (from, till, lowZ, topZ) => {
      if (till <= from + 0.005 || topZ <= lowZ) return;
      if (prof) mesh.corr(0, [from, till], [wallY - out * 0.03, out], [lowZ, topZ], [...prof]);
      else {
        const y = wallY - out * 0.02;
        mesh.quad([from, y, lowZ], [till, y, lowZ], [till, y, topZ], [from, y, topZ], [0, out, 0]);
      }
    };
    let x = 0.16;
    for (const cut of cuts) {
      sheet(x, cut.a, z0, z1);
      sheet(cut.a, cut.b, cut.h, z1);
      x = Math.max(x, cut.b);
    }
    sheet(x, this.scene.Le - 0.16, z0, z1);
  }

  /** Проём: обрамление, закрытая дверь или открытые створки и откос с утеплителем. */
  opening(cut, meshes, side, [y0, y1]) {
    const { fr: frame } = meshes;
    frame.box([cut.a - 0.05, y0, this.scene.base - 0.02], [cut.a, y1, cut.h + 0.05], 0.004);
    frame.box([cut.b, y0, this.scene.base - 0.02], [cut.b + 0.05, y1, cut.h + 0.05], 0.004);
    frame.box([cut.a - 0.05, y0, cut.h], [cut.b + 0.05, y1, cut.h + 0.05], 0.004);
    if (this.scene.closed || !cut.open) {
      this.shut(cut, side, meshes.leaf, meshes.dk);
      return;
    }
    for (let k = 0; k < cut.n; k++) this.openLeaf(cut, k === 0, meshes, side);
    const ins = this.scene.meshFor(StMat.paint(StMat.INS, 0.9));
    ins.quad([cut.a, y0, cut.h], [cut.b, y0, cut.h], [cut.b, y1, cut.h], [cut.a, y1, cut.h], [0, 0, -1]);
  }

  /** Створка, открытая наружу на 100°: полотно, обшивка, жалюзи, ручка, петли. */
  openLeaf(cut, left, { leaf, inner, dk: dark }, [wallY, out]) {
    const leafW = (cut.b - cut.a) / cut.n;
    const height = cut.h - this.scene.base - 0.02;
    const hingeX = left ? cut.a : cut.b;
    const sign = left ? 1 : -1;
    const angle = (100 * Math.PI) / 180;
    const span = [sign * Math.cos(angle) * leafW, out * Math.sin(angle) * leafW, 0];
    const origin = [hingeX, wallY + out * 0.005, this.scene.base + 0.01];
    const thick = StV.mul(StV.norm([-span[1], span[0], 0]), 0.045 * (left ? 1 : -1) * -out);
    leaf.obox(origin, span, thick, [0, 0, height]);
    inner.obox(StV.add(origin, StV.mul(thick, 1.02)), StV.mul(span, 0.96), StV.mul(thick, 0.06), [0, 0, height * 0.98]);
    for (let i = 0; i < 6; i++) {
      const barZ = this.scene.base + height * (0.18 + i * 0.045);
      dark.obox(
        StV.add([hingeX, wallY + out * 0.005, barZ], StV.mul(span, 0.2)),
        StV.mul(span, 0.6),
        StV.mul(thick, -0.15),
        [0, 0, 0.018],
      );
    }
    const handle = StV.add([hingeX, wallY + out * 0.005, this.scene.base + height * 0.5], StV.mul(span, 0.9));
    dark.obox(StV.add(handle, StV.mul(thick, -0.6)), StV.mul(StV.norm(span), 0.025), StV.mul(thick, -0.8), [0, 0, 0.2]);
    for (const z of [0.15, 0.85])
      dark.tube(
        [hingeX, wallY + out * 0.01, this.scene.base + height * z],
        [hingeX, wallY + out * 0.01, this.scene.base + height * z + 0.12],
        0.018,
        10,
      );
  }

  /** Закрытая дверь в проёме (вид снаружи). */
  shut(cut, [wallY, out], leaf, dark) {
    const outerY = wallY + out * 0.005;
    const innerY = outerY + out * 0.045;
    const geom = {
      out,
      z0: this.scene.base + 0.01,
      z1: cut.h - 0.005,
      zh: this.scene.base + 1.0,
      yf: innerY + out * 0.004,
      lock: cut.n === 1 ? cut.b - 0.09 : (cut.a + cut.b) / 2 + 0.06,
      mt: this.scene.meshFor(StMat.metal('#c3c8cd', 0.3)),
    };
    const seam = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.wall, 0.82), 0.5));
    const leafW = (cut.b - cut.a) / cut.n;
    for (let k = 0; k < cut.n; k++) {
      const from = cut.a + k * leafW + 0.004;
      const till = cut.a + (k + 1) * leafW - 0.004;
      leaf.box([from, outerY, geom.z0], [till, innerY, geom.z1], 0.006);
      for (const z of [geom.z0 + 0.12, geom.z1 - 0.12])
        seam.box([from + 0.05, innerY, z - 0.004], [till - 0.05, innerY + out * 0.003, z + 0.004]);
    }
    if (cut.kind === 'service') {
      this.bars(cut, geom, dark);
      return;
    }
    this.handle(geom, dark);
    if (cut.n === 1) this.closer(cut, geom, dark, wallY);
    if (cut.kind === 'tank')
      for (let i = 0; i < 7; i++) {
        const z = geom.z0 + 0.12 + i * 0.045;
        dark.box([cut.a + 0.12, geom.yf, z], [cut.b - 0.12, geom.yf + out * 0.012, z + 0.022]);
      }
  }

  /** Запорные штанги сервисных ворот. */
  bars(cut, { out, z0, z1, zh: handleZ, yf: faceY, lock, mt: metal }, dark) {
    for (const x of cut.n === 1 ? [lock] : [(cut.a + cut.b) / 2 - 0.07, lock]) {
      metal.tube([x, faceY + out * 0.02, z0 + 0.08], [x, faceY + out * 0.02, z1 - 0.08], 0.012, 10);
      dark.box([x - 0.03, faceY, handleZ - 0.12], [x + 0.03, faceY + out * 0.05, handleZ + 0.12], 0.005);
    }
  }

  /** Ручка-скоба с замком. */
  handle({ out, zh: handleZ, yf: faceY, lock, mt: metal }, dark) {
    dark.box([lock - 0.025, faceY, handleZ - 0.09], [lock + 0.025, faceY + out * 0.012, handleZ + 0.09], 0.006);
    metal.box(
      [lock - 0.13, faceY + out * 0.035, handleZ + 0.03],
      [lock + 0.01, faceY + out * 0.055, handleZ + 0.05],
      0.008,
    );
    metal.box([lock - 0.008, faceY, handleZ + 0.025], [lock + 0.012, faceY + out * 0.055, handleZ + 0.055], 0.004);
    metal.tube([lock, faceY, handleZ - 0.05], [lock, faceY + out * 0.015, handleZ - 0.05], 0.011, 12);
  }

  /** Доводчик — всегда внутри: корпус у петель со стороны помещения, рычаг к верху коробки. */
  closer(cut, { out, z1 }, dark, wallY) {
    const x = cut.a + 0.07;
    const bodyZ = z1 - 0.07;
    const inward = -out;
    const yin = wallY + inward * this.scene.oy;
    this.scene
      .meshFor(StMat.metal('#9aa1a8', 0.35))
      .box([x, yin, bodyZ - 0.035], [x + 0.27, yin + inward * 0.06, bodyZ + 0.035], 0.012);
    const arm0 = [x + 0.24, yin + inward * 0.05, bodyZ + 0.01];
    const arm1 = [x + 0.4, yin + inward * 0.07, bodyZ + 0.02];
    const arm2 = [x + 0.46, yin + inward * 0.03, cut.h + 0.03];
    dark.tube(arm0, arm1, 0.009, 8);
    dark.sphere(arm1, 0.012, 8);
    dark.tube(arm1, arm2, 0.008, 8);
  }

  /** Обшивка изнутри стены с проёмами. */
  holes(mesh, y, normal, doors, [lowZ, topZ]) {
    const cuts = doors
      .map(door => [this.scene.ox + door.x0 / 1000, this.scene.ox + door.x1 / 1000, this.scene.base + door.h / 1000])
      .sort((first, second) => first[0] - second[0]);
    let x = this.scene.ox;
    const fill = (from, till, fromZ, tillZ) => {
      if (till > from + 0.005 && tillZ > fromZ)
        mesh.quad([from, y, fromZ], [till, y, fromZ], [till, y, tillZ], [from, y, tillZ], [0, normal, 0]);
    };
    for (const [from, till, cutTop] of cuts) {
      fill(x, from, lowZ, topZ);
      fill(from, till, cutTop, topZ);
      x = Math.max(x, till);
    }
    fill(x, this.scene.ox + this.scene.Li, lowZ, topZ);
  }

  /** Створки в торцах блок-контейнера: ворота, двери оператора, ворота отсека бака. */
  endDoors() {
    const plan = this.scene.plan;
    const entry = plan.entry;
    for (const gate of [plan.gates, plan.gates2]) if (gate && !gate.sea) this.endLeaves(gate, gate.wall, 2);
    if (entry && entry.wall === 'left' && !entry.sea) this.endLeaves(entry, 'left', 1);
    if (plan.fuel && plan.fuel.gate) this.endLeaves(plan.fuel.gate, 'left', 2); // ворота отсека топливного бака
    if (plan.exit) this.endLeaves(plan.exit, plan.exit.wall, 1);
  }

  /** Створки в торце side ('left' — x = 0, 'right' — x = Le). */
  endLeaves(door, side, count) {
    const sign = side === 'left' ? -1 : 1;
    const wallX = side === 'left' ? 0 : this.scene.Le;
    const y0 = this.scene.oy + door.y0 / 1000;
    const width = (door.y1 - door.y0) / 1000;
    const leafW = width / count;
    const z0 = this.scene.base;
    const z1 = this.scene.base + door.h / 1000;
    const leaf = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.door, 0.95), 0.45));
    const dark = this.scene.meshFor(StMat.paint('#23272b', 0.6));
    const frame = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.frame, 0.9), 0.45));
    const spanX = (from, till) => [
      Math.min(wallX + sign * from, wallX + sign * till),
      Math.max(wallX + sign * from, wallX + sign * till),
    ];
    const [frameA, frameB] = spanX(0, 0.03);
    frame.box([frameA, y0 - 0.05, z0], [frameB, y0, z1 + 0.05]);
    frame.box([frameA, y0 + width, z0], [frameB, y0 + width + 0.05, z1 + 0.05]);
    frame.box([frameA, y0 - 0.05, z1], [frameB, y0 + width + 0.05, z1 + 0.05]); // коробка
    const [leafA, leafB] = spanX(0, 0.025);
    for (let i = 0; i < count; i++)
      leaf.box([leafA, y0 + leafW * i + 0.004, z0 + 0.01], [leafB, y0 + leafW * (i + 1) - 0.004, z1 - 0.004], 0.004);
    const [handleA, handleB] = spanX(0.025, 0.055);
    const handleY = count > 1 ? [y0 + width / 2 - 0.08, y0 + width / 2 + 0.06] : [y0 + width - 0.12];
    for (const y of handleY) dark.box([handleA, y, z0 + 0.95], [handleB, y + 0.02, z0 + 1.15], 0.004);
    if (count > 1) {
      const metal = this.scene.meshFor(StMat.metal('#c3c8cd', 0.3));
      const [barA, barB] = spanX(0.04, 0.06);
      for (const y of [y0 + width / 2 - 0.07, y0 + width / 2 + 0.05])
        metal.box([barA, y, z0 + 0.08], [barB, y + 0.02, z1 - 0.08], 0.004);
    } // запорные штанги
    if (door.wicket) {
      const wicketW = door.wicket.w / 1000;
      const wicketH = door.wicket.h / 1000;
      const wicketY0 = y0 + 0.08;
      const wicketY1 = wicketY0 + wicketW;
      const wicketZ0 = z0 + 0.06;
      const wicketZ1 = wicketZ0 + wicketH;
      const [kerbA, kerbB] = spanX(0.025, 0.03);
      // калитка в створке: контур, ручка
      for (const [frameY0, frameY1, frameZ0, frameZ1] of [
        [wicketY0, wicketY1, wicketZ0, wicketZ0 + 0.012],
        [wicketY0, wicketY1, wicketZ1 - 0.012, wicketZ1],
        [wicketY0, wicketY0 + 0.012, wicketZ0, wicketZ1],
        [wicketY1 - 0.012, wicketY1, wicketZ0, wicketZ1],
      ])
        dark.box([kerbA, frameY0, frameZ0], [kerbB, frameY1, frameZ1]);
      dark.box([handleA, wicketY1 - 0.1, z0 + 0.95], [handleB, wicketY1 - 0.08, z0 + 1.15], 0.004);
    }
  }

  /** Внутри: обшивка стен и потолка, пол из рифлёного листа, разрез стены со стороны зрителя (утеплитель). */
  inside() {
    const { ox, oy, Li, Wi, base: base, ceil: ceil } = this.scene;
    const lin = this.scene.meshFor(StMat.paint(this.scene.lining, 0.6));
    if (!this.scene.doorsBack.length)
      lin.quad(
        [ox, oy + Wi, base],
        [ox + Li, oy + Wi, base],
        [ox + Li, oy + Wi, ceil],
        [ox, oy + Wi, ceil],
        [0, -1, 0],
      );
    const ends = this.endOpenings();
    this.endLining(lin, ox + Li, -1, this.scene.cut ? ends.filter(door => door.wall === 'right') : [], [base, ceil]);
    this.endLining(lin, ox, 1, this.scene.cut ? ends.filter(door => door.wall === 'left') : [], [base, ceil]);
    if (this.scene.cut) {
      for (const door of ends) this.innerLeaves(door, door.wall, door.n);
      for (const door of this.scene.doorsBack) this.innerLeaves(door, 'back', door.leaves || 1);
    }
    lin.quad([ox, oy, ceil], [ox + Li, oy, ceil], [ox + Li, oy + Wi, ceil], [ox, oy + Wi, ceil], [0, 0, -1]);
    if (!this.scene.cut) this.holes(lin, oy, 1, this.scene.frontOpenings, [base, ceil]);
    if (this.scene.doorsBack.length) this.holes(lin, oy + Wi, -1, this.scene.doorsBack, [base, ceil]);
    this.seams();
    this.floor();
    if (this.scene.cut) this.section();
    this.tambour();
  }

  /** Швы обшивки по задней стене и потолку. */
  seams() {
    const { ox, oy, Li, Wi, base: base, ceil: ceil } = this.scene;
    const seam = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.lining, 0.86), 0.6));
    const step = this.scene.geo.sea ? 1.2 : 1.15;
    for (let x = ox + step; x < ox + Li - 0.2; x += step) {
      seam.box([x - 0.004, oy + Wi - 0.004, base], [x + 0.004, oy + Wi, ceil]);
      seam.box([x - 0.004, oy, ceil - 0.004], [x + 0.004, oy + Wi, ceil]);
    }
  }

  /** Пол — рифлёный лист: сталь чёрная или алюминий; задан RAL — окрашен. */
  floor() {
    const { ox, oy, Li, Wi, base: base } = this.scene;
    const floorType = StationGeo.FLOORS[this.scene.geo.floor] || StationGeo.FLOORS.steel;
    const col = this.scene.plan.floorColor;
    const floor = this.scene.meshFor(
      col ? { ...StMat.paint(col, 0.5), k: 1 } : { c: floorType.color, r: floorType.r, m: floorType.m, k: 1 },
    );
    floor.quad([ox, oy, base], [ox + Li, oy, base], [ox + Li, oy + Wi, base], [ox, oy + Wi, base], [0, 0, 1]);
  }

  /** Разрез на месте срезанной стены: крыша, пол и торцевые стены в сечении — утеплитель между обшивками. */
  section() {
    const { ox, base: base, ceil: ceil } = this.scene;
    const ins = this.scene.meshFor(StMat.paint(StMat.INS, 0.9));
    const y = 0.002;
    const normal = [0, -1, 0];
    const x0 = 0.15;
    const x1 = this.scene.Le - 0.15;
    const mono = this.scene.geo.roof === 'mono' && this.scene.rise > 0;
    const roofZ = mono ? this.scene.top + this.scene.rise : this.scene.top - (this.scene.geo.sea ? 0.11 : 0.1);
    if (roofZ > ceil) ins.quad([x0, y, ceil], [x1, y, ceil], [x1, y, roofZ], [x0, y, roofZ], normal);
    const floorZ = this.scene.dz + 0.16;
    if (base > floorZ) ins.quad([x0, y, floorZ], [x1, y, floorZ], [x1, y, base], [x0, y, base], normal);
    for (const [from, z] of [
      [x0, ox],
      [this.scene.Le - ox, x1],
    ])
      if (z > from) ins.quad([from, y, base], [z, y, base], [z, y, ceil], [from, y, ceil], normal);
  }

  /** Тамбур «Север»: перегородка с дверью (после отсека бака, если он есть). */
  tambour() {
    const fuel = this.scene.plan.fuel;
    if ((this.scene.geo.x0 || 0) - (fuel ? fuel.x1 + fuel.part : 0) <= 0) return;
    const { oy, Wi, base: base, ceil: ceil } = this.scene;
    const x = this.scene.ox + this.scene.geo.x0 / 1000;
    const lining = this.scene.meshFor(StMat.paint(this.scene.lining, 0.55));
    const doorMesh = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.door, 0.95), 0.45));
    lining.box([x - 0.06, oy, base], [x, oy + Wi - 1.0, ceil]);
    lining.box([x - 0.06, oy + Wi - 0.1, base], [x, oy + Wi, ceil]);
    lining.box([x - 0.06, oy + Wi - 1.0, base + 2.0], [x, oy + Wi - 0.1, ceil]);
    doorMesh.box([x - 0.05, oy + Wi - 0.98, base], [x - 0.01, oy + Wi - 0.12, base + 1.98], 0.004);
    const closerMesh = this.scene.meshFor(StMat.metal('#9aa1a8', 0.35));
    const dark = this.scene.meshFor(StMat.paint('#24292e', 0.55));
    closerMesh.box([x - 0.11, oy + Wi - 0.92, base + 1.84], [x - 0.05, oy + Wi - 0.65, base + 1.91], 0.01); // доводчик
    dark.tube([x - 0.09, oy + Wi - 0.68, base + 1.9], [x - 0.12, oy + Wi - 0.55, base + 1.94], 0.008, 8);
    dark.tube([x - 0.12, oy + Wi - 0.55, base + 1.94], [x - 0.07, oy + Wi - 0.5, base + 2.0], 0.008, 8);
  }

  /** Проёмы в торцах. */
  endOpenings() {
    const plan = this.scene.plan;
    const out = [];
    for (const gate of [plan.gates, plan.gates2])
      if (gate)
        out.push({
          wall: gate.wall,
          y0: gate.y0,
          y1: gate.y1,
          h: gate.h,
          n: 2,
          kind: 'gate',
          wicket: gate.wicket || null,
        });
    if (plan.entry && plan.entry.wall === 'left' && !plan.entry.sea)
      out.push({ wall: 'left', y0: plan.entry.y0, y1: plan.entry.y1, h: plan.entry.h, n: 1, kind: 'entry' });
    if (plan.fuel && plan.fuel.gate) {
      const gate = plan.fuel.gate;
      out.push({ wall: 'left', y0: gate.y0, y1: gate.y1, h: gate.h, n: 2, kind: 'gate' });
    } // ворота отсека бака
    if (plan.exit)
      out.push({ wall: plan.exit.wall, y0: plan.exit.y0, y1: plan.exit.y1, h: plan.exit.h, n: 1, kind: 'entry' });
    for (const door of (plan.dguDoors || []).filter(door => door.wall !== 'back'))
      out.push({ wall: door.wall, y0: door.y0, y1: door.y1, h: door.h, n: 2, kind: 'dgu' });
    return out;
  }

  /** Обшивка торца изнутри (x — плоскость, nx — нормаль внутрь) с проёмами cuts: участки до, между и над проёмами. */
  endLining(mesh, x, normalX, cuts, [lowZ, topZ]) {
    const spans = cuts
      .map(cut => [this.scene.oy + cut.y0 / 1000, this.scene.oy + cut.y1 / 1000, this.scene.base + cut.h / 1000])
      .sort((first, second) => first[0] - second[0]);
    const fill = (from, till, fromZ, tillZ) => {
      if (till > from + 0.005 && tillZ > fromZ)
        mesh.quad([x, from, fromZ], [x, till, fromZ], [x, till, tillZ], [x, from, tillZ], [normalX, 0, 0]);
    };
    let y = this.scene.oy;
    for (const [from, till, cutTop] of spans) {
      fill(y, from, lowZ, topZ);
      fill(from, till, cutTop, topZ);
      y = Math.max(y, till);
    }
    fill(y, this.scene.oy + this.scene.Wi, lowZ, topZ);
  }

  /** Ворота (дверь) изнутри — вид в разрезе. */
  innerLeaves(door, wall, count) {
    const end = wall === 'left' || wall === 'right';
    const plane = { left: this.scene.ox, right: this.scene.ox + this.scene.Li }[wall] ?? this.scene.oy + this.scene.Wi;
    const sign = wall === 'left' ? 1 : -1;
    const origin = end ? this.scene.oy : this.scene.ox;
    const u = end
      ? [origin + door.y0 / 1000, origin + door.y1 / 1000]
      : [origin + door.x0 / 1000, origin + door.x1 / 1000];
    const z = [this.scene.base, this.scene.base + door.h / 1000];
    /** Короб на полотне: u — вдоль стены, zz — по высоте, tt — от плоскости внутрь. */
    const box = (mesh, [from, till], [lowZ, topZ], [off0, off1], round = 0.004) => {
      const plane0 = plane + sign * off0;
      const plane1 = plane + sign * off1;
      if (end) mesh.box([plane0, from, lowZ], [plane1, till, topZ], round);
      else mesh.box([from, plane0, lowZ], [till, plane1, topZ], round);
    };
    const meshes = {
      fr: this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.frame, 0.9), 0.45)),
      lf: this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.lining, 0.9), 0.5)),
      rib: this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.lining, 0.78), 0.55)),
      mt: this.scene.meshFor(StMat.metal('#c3c8cd', 0.3)),
      dk: this.scene.meshFor(StMat.paint('#23272b', 0.6)),
    };
    const [u0, u1] = u;
    const [z0, z1] = z;
    box(meshes.fr, [u0 - 0.05, u0], [z0, z1 + 0.05], [0, 0.03]);
    box(meshes.fr, [u1, u1 + 0.05], [z0, z1 + 0.05], [0, 0.03]);
    box(meshes.fr, [u0 - 0.05, u1 + 0.05], [z1, z1 + 0.05], [0, 0.03]);
    const leafW = (u1 - u0) / count;
    for (let i = 0; i < count; i++)
      SceneRoom.leafIn(box, meshes, [u0 + leafW * i + 0.005, u0 + leafW * (i + 1) - 0.005, i === 0], z);
    SceneRoom.latch(box, meshes, count > 1 && door.kind !== 'entry', u, z);
    if (door.kind === 'dgu')
      for (let barZ = z0 + 0.25; barZ < z1 - 0.2; barZ += 0.06)
        box(meshes.rib, [u0 + 0.08, u1 - 0.08], [barZ, barZ + 0.02], [0.03, 0.04]);
    if (door.wicket) SceneRoom.wicket(box, meshes.dk, door.wicket, u1, z0);
  }

  /** Створка изнутри: обшивка, рёбра каркаса, петли. */
  static leafIn(box, { lf: leaf, rib, dk: dark }, [from, till, first], [z0, z1]) {
    box(leaf, [from, till], [z0 + 0.01, z1 - 0.005], [0.004, 0.018]);
    for (const k of [0.25, 0.5, 0.75]) {
      const z = z0 + (z1 - z0) * k;
      box(rib, [from + 0.04, till - 0.04], [z - 0.02, z + 0.02], [0.018, 0.03]);
    }
    const handleX = first ? from + 0.02 : till - 0.02;
    for (const k of [0.12, 0.5, 0.88]) {
      const z = z0 + (z1 - z0) * k;
      box(dark, [handleX - 0.02, handleX + 0.02], [z - 0.06, z + 0.06], [0.018, 0.045]);
    }
  }

  /** Запорные штанги и ручки у притвора ворот или ручка двери. */
  static latch(box, { mt: metal, dk: dark }, gate, [u0, u1], [z0, z1]) {
    if (!gate) {
      box(dark, [u1 - 0.12, u1 - 0.1], [z0 + 0.95, z0 + 1.15], [0.03, 0.06]);
      return;
    }
    const mid = (u0 + u1) / 2;
    for (const x of [mid - 0.06, mid + 0.04]) box(metal, [x, x + 0.02], [z0 + 0.06, z1 - 0.06], [0.03, 0.05], 0.008);
    for (const x of [mid - 0.1, mid + 0.08]) box(dark, [x, x + 0.02], [z0 + 0.95, z0 + 1.15], [0.03, 0.06]);
  }

  /** Калитка в створке ворот: рамка. */
  static wicket(box, dark, wicket, u1, z0) {
    const wicketW = wicket.w / 1000;
    const wicketH = wicket.h / 1000;
    const wicketU = u1 - 0.08 - wicketW;
    for (const [from, till, lowZ, topZ] of [
      [wicketU, wicketU + wicketW, z0 + 0.06, z0 + 0.075],
      [wicketU, wicketU + wicketW, z0 + 0.06 + wicketH, z0 + 0.075 + wicketH],
      [wicketU, wicketU + 0.015, z0 + 0.06, z0 + 0.06 + wicketH],
      [wicketU + wicketW - 0.015, wicketU + wicketW, z0 + 0.06, z0 + 0.06 + wicketH],
    ])
      box(dark, [from, till], [lowZ, topZ], [0.018, 0.024]);
  }
}
