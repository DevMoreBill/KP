import { RalColor } from '../layout/ral-color.js';
import { StationMods } from '../layout/station-mods.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Корпус контейнера снаружи. */
export class SceneHull {
  constructor(scene) {
    this.scene = scene;
  }

  /** Шасси под контейнером. */
  chassis() {
    const dark = this.scene.meshFor(StMat.paint('#30353b', 0.6));
    const tire = this.scene.meshFor(StMat.paint('#1d1f22', 0.85));
    const rim = this.scene.meshFor(StMat.metal('#9ea4aa', 0.4));
    const z = this.scene.dz;
    const Le = this.scene.Le;
    const We = this.scene.We;
    dark.box([0.2, We * 0.18, z - 0.28], [Le - 0.2, We * 0.3, z], 0.01);
    dark.box([0.2, We * 0.7, z - 0.28], [Le - 0.2, We * 0.82, z], 0.01);
    for (let x = 0.6; x < Le - 0.4; x += 1.2) dark.box([x, We * 0.18, z - 0.22], [x + 0.08, We * 0.82, z - 0.06]);
    for (const k of Le <= 7 ? [0.62, 0.78] : [0.66, 0.76, 0.86]) {
      const x = Le * k;
      dark.tube([x, We * 0.12, 0.43], [x, We * 0.88, 0.43], 0.06, 12);
      for (const y of [0.0, We - 0.32]) {
        tire.tube([x, y, 0.43], [x, y + 0.32, 0.43], 0.43, 28);
        rim.tube([x, y - 0.004, 0.43], [x, y + 0.324, 0.43], 0.24, 20);
      }
    }
    for (const y of [We * 0.2, We * 0.75]) dark.box([Le * 0.18, y, 0], [Le * 0.18 + 0.12, y + 0.12, z - 0.28]);
  }

  /** Корпус контейнера по типу. */
  container() {
    if (this.scene.geo.sea) this.sea();
    else if (this.scene.geo.type === 'welded') this.welded();
    else this.block();
    this.joints();
    this.scene.room.inside();
  }

  /** Станция из модулей. */
  joints() {
    const mods = this.scene.geo.mods;
    if (!mods || !mods.Lm) return;
    const Le = this.scene.Le;
    const We = this.scene.We;
    const z0 = this.scene.dz;
    const topZ = z0 + this.scene.He;
    const thick = 0.1;
    const meters = this.scene.meters;
    const frame = this.scene.meshFor(StMat.paint(this.scene.frame, 0.45));
    const cover = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.wall, 0.86), 0.5));
    for (let i = 1; i < mods.a; i++) {
      const x = meters(i * mods.Lm);
      for (const y of [0, We - thick]) frame.box([x - thick, y, z0], [x + thick, y + thick, topZ], 0.006); // стойки обоих модулей
      cover.box([x - 0.06, We, z0 + 0.16], [x + 0.06, We + 0.006, topZ - thick]);
      if (!this.scene.cut) cover.box([x - 0.06, -0.006, z0 + 0.16], [x + 0.06, 0, topZ - thick]); // нащельники
      if (!this.scene.rise) cover.box([x - 0.07, 0, this.scene.top], [x + 0.07, We, this.scene.top + 0.012]);
    } // по кровле (плоской)
    for (let j = 1; j < mods.b; j++) {
      const y = meters(j * mods.Wm);
      for (const x of [0, Le - thick]) frame.box([x, y - thick, z0], [x + thick, y + thick, topZ], 0.006);
      cover.box([Le, y - 0.06, z0 + 0.16], [Le + 0.006, y + 0.06, topZ - thick]);
      cover.box([-0.006, y - 0.06, z0 + 0.16], [0, y + 0.06, topZ - thick]);
      const roofZ = this.scene.roofZ(y);
      cover.box([0, y - 0.07, roofZ], [Le, y + 0.07, roofZ + 0.012]);
    }
    if (this.scene.view === 'in')
      for (const post of StationMods.posts(this.scene.geo)) {
        const half = meters(StationMods.RULES.post) / 2;
        const center = this.scene.point(post.x, post.y, 0);
        frame.box(
          [center[0] - half, center[1] - half, this.scene.base],
          [center[0] + half, center[1] + half, this.scene.ceil],
          0.006,
        );
      }
  }

  /** Морской контейнер: рама, угловые фитинги, гофрированные стены, крыша, торцевые двери. */
  sea() {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const z0 = this.scene.dz;
    const He = this.scene.He;
    const topZ = z0 + He;
    const frame = this.scene.meshFor(StMat.paint(this.scene.frame, 0.5));
    const wall = this.scene.meshFor(StMat.paint(this.scene.wall, 0.5));
    const cast = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.frame, 0.85), 0.55));
    const post = 0.15;
    const rail = 0.16;
    // стойки, нижние и верхние балки, фитинги
    for (const x of [0, Le - post])
      for (const y of [0, We - post]) frame.box([x, y, z0], [x + post, y + post, topZ], 0.008);
    for (const y of [0, We - 0.16]) {
      frame.box([0, y, z0], [Le, y + 0.16, z0 + rail], 0.006);
      frame.box([0, y, topZ - 0.11], [Le, y + 0.16, topZ], 0.006);
    }
    for (const x of [0, Le - 0.2]) {
      frame.box([x, 0, z0], [x + 0.2, We, z0 + 0.2], 0.006);
      frame.box([x, 0, topZ - 0.12], [x + 0.2, We, topZ], 0.006);
    }
    for (const x of [0, Le - 0.178])
      for (const y of [0, We - 0.162])
        for (const z of [z0, topZ - 0.118]) {
          cast.box([x - 0.004, y - 0.004, z], [x + 0.182, y + 0.166, z + 0.118], 0.01);
          const dark = this.scene.meshFor(StMat.paint('#15181b', 0.8));
          dark.box([x + 0.05, y - 0.006, z + 0.035], [x + 0.13, y + 0.004, z + 0.085], 0.01);
        }
    if (this.scene.doorsBack.length) this.scene.room.backWall(wall, z0 + rail, topZ - 0.11, StScene.SEA_P);
    else wall.corr(0, [post, Le - post], [We - 0.03, 1], [z0 + rail, topZ - 0.11]);
    wall.corr(1, [post, We - post], [Le - 0.03, 1], [z0 + 0.2, topZ - 0.12], [0.28, 0.045]);
    if (!this.scene.cut) this.scene.room.frontWall(wall, z0 + rail, topZ - 0.11, StScene.SEA_P);
    // крыша: лист с неглубокими поперечными гофрами
    const roof = this.scene.meshFor(StMat.paint(this.scene.roofColor, 0.5));
    roof.box([post, 0.06, topZ - 0.02], [Le - post, We - 0.06, topZ - 0.004]);
    for (let x = post + 0.25; x < Le - post - 0.1; x += 0.5)
      roof.box([x, 0.08, topZ - 0.004], [x + 0.2, We - 0.08, topZ + 0.008], 0.004);
    this.cargoDoors();
  }

  /** Торцевые двери морского контейнера (торец у двери, x = 0): две створки, четыре запорные штанги, ручки, петли. */
  cargoDoors() {
    const We = this.scene.We;
    const z0 = this.scene.dz + 0.2;
    const z1 = this.scene.dz + this.scene.He - 0.12;
    const leaf = this.scene.meshFor(StMat.paint(this.scene.door, 0.5));
    const bar = this.scene.meshFor(StMat.metal(StScene.GALV, 0.4));
    const dark = this.scene.meshFor(StMat.paint('#202428', 0.6));
    leaf.corr(1, [0.15, We / 2 - 0.01], [0.0, -1], [z0, z1], [0.32, 0.03]);
    leaf.corr(1, [We / 2 + 0.01, We - 0.15], [0.0, -1], [z0, z1], [0.32, 0.03]);
    for (const y of [We / 2 - 0.012, We / 2 + 0.012]) dark.box([-0.035, y - 0.006, z0], [-0.02, y + 0.006, z1]);
    for (const frac of [0.14, 0.36, 0.64, 0.86]) {
      const y = We * frac;
      bar.tube([-0.06, y, z0 + 0.05], [-0.06, y, z1 - 0.05], 0.016, 10);
      for (const z of [z0 + 0.06, z1 - 0.06])
        dark.box([-0.075, y - 0.03, z - 0.03], [-0.035, y + 0.03, z + 0.03], 0.005);
      dark.box(
        [-0.09, y - 0.012, this.scene.dz + this.scene.He * 0.42],
        [-0.06, y + 0.15 * (frac < 0.5 ? 1 : -1), this.scene.dz + this.scene.He * 0.42 + 0.03],
        0.006,
      );
    }
    for (const y of [0.17, We - 0.19])
      for (const k of [0.2, 0.5, 0.8])
        dark.box([-0.05, y, z0 + (z1 - z0) * k], [-0.02, y + 0.04, z0 + (z1 - z0) * k + 0.1], 0.004);
  }

  static _blockFrame(frame, [Le, We], [z0, topZ], thick) {
    for (const x of [0, Le - thick])
      for (const y of [0, We - thick]) frame.box([x, y, z0], [x + thick, y + thick, topZ], 0.006);
    for (const y of [0, We - thick]) {
      frame.box([0, y, z0], [Le, y + thick, z0 + 0.16], 0.006);
      frame.box([0, y, topZ - thick], [Le, y + thick, topZ], 0.006);
    }
    for (const x of [0, Le - thick]) {
      frame.box([x, 0, z0], [x + thick, We, z0 + 0.16], 0.006);
      frame.box([x, 0, topZ - thick], [x + thick, We, topZ], 0.006);
    }
  }

  /** Блок-контейнер: каркас из профильной трубы, стены и кровля — сэндвич-панели со швами. */
  block() {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const z0 = this.scene.dz;
    const topZ = z0 + this.scene.He;
    const frame = this.scene.meshFor(StMat.paint(this.scene.frame, 0.45));
    const wall = this.scene.meshFor(StMat.paint(this.scene.wall, 0.42));
    const seam = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.wall, 0.82), 0.6));
    const thick = 0.1;
    SceneHull._blockFrame(frame, [Le, We], [z0, topZ], thick);
    // стены: задняя, торцы; швы панелей шагом около 1,15 м
    const panel = (along, u0, u1, plane, out) => {
      const toWorld = (u, z) => (along === 0 ? [u, plane, z] : [plane, u, z]),
        normal = along === 0 ? [0, out, 0] : [out, 0, 0];
      wall.quad(
        toWorld(u0, z0 + 0.16),
        toWorld(u1, z0 + 0.16),
        toWorld(u1, topZ - thick),
        toWorld(u0, topZ - thick),
        normal,
      );
      const k = Math.max(1, Math.round((u1 - u0) / 1.15));
      for (let i = 1; i < k; i++) {
        const u = u0 + ((u1 - u0) * i) / k,
          lift = out * 0.004;
        seam.box(
          ...(along === 0
            ? [
                [u - 0.006, plane + lift - 0.002, z0 + 0.16],
                [u + 0.006, plane + lift + 0.002, topZ - thick],
              ]
            : [
                [plane + lift - 0.002, u - 0.006, z0 + 0.16],
                [plane + lift + 0.002, u + 0.006, topZ - thick],
              ]),
        );
      }
    };
    if (this.scene.doorsBack.length) this.scene.room.backWall(wall, z0 + 0.16, topZ - thick, null);
    else panel(0, thick, Le - thick, We - 0.02, 1);
    panel(1, thick, We - thick, Le - 0.02, 1);
    panel(1, thick, We - thick, 0.02, -1);
    if (!this.scene.cut) this.scene.room.frontWall(wall, z0 + 0.16, topZ - thick, null);
    this.roof(topZ, this.scene.roofColor);
    this.scene.room.endDoors();
  }

  /** Цельносварной: рама из гнутого швеллера и стойки, стены — профилированный лист (трапеция), приваренный к раме. */
  welded() {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const z0 = this.scene.dz;
    const topZ = z0 + this.scene.He;
    const frame = this.scene.meshFor(StMat.paint(this.scene.frame, 0.45));
    const wall = this.scene.meshFor(StMat.paint(this.scene.wall, 0.45));
    const thick = 0.12;
    const band = 0.2;
    const pitch = StScene.WELD_P;
    for (const x of [0, Le - thick])
      for (const y of [0, We - thick]) frame.box([x, y, z0], [x + thick, y + thick, topZ], 0.006);
    for (const y of [0, We - thick]) {
      frame.box([0, y, z0], [Le, y + thick, z0 + band], 0.006);
      frame.box([0, y, topZ - 0.1], [Le, y + thick, topZ], 0.006);
    }
    for (const x of [0, Le - thick]) {
      frame.box([x, 0, z0], [x + thick, We, z0 + band], 0.006);
      frame.box([x, 0, topZ - 0.1], [x + thick, We, topZ], 0.006);
    }
    if (this.scene.doorsBack.length) this.scene.room.backWall(wall, z0 + band, topZ - 0.1, pitch);
    else wall.corr(0, [thick, Le - thick], [We - 0.025, 1], [z0 + band, topZ - 0.1], [...pitch]);
    wall.corr(1, [thick, We - thick], [Le - 0.025, 1], [z0 + band, topZ - 0.1], [...pitch]);
    wall.corr(1, [thick, We - thick], [0.025, -1], [z0 + band, topZ - 0.1], [...pitch]);
    if (!this.scene.cut) this.scene.room.frontWall(wall, z0 + band, topZ - 0.1, pitch);
    this.roof(topZ, this.scene.roofColor);
    this.scene.room.endDoors();
  }

  /** Радиус дуги арочной крыши: хорда — ширина контейнера, стрела — подъём. */
  arcR() {
    const rise = this.scene.rise;
    const half = this.scene.We / 2;
    return (half * half + rise * rise) / (2 * rise);
  }

  /** Крыша блок-контейнера и цельносварного. */
  roof(topZ, col) {
    const mesh = this.scene.meshFor(StMat.paint(col, 0.45));
    if (this.scene.rise > 0) {
      const ribs = [
        this.scene.meshFor(StMat.paint(RalColor.shade(col, 0.93), 0.45)),
        this.scene.meshFor(StMat.paint(this.scene.wall, 0.42)),
      ];
      const kind = this.scene.geo.roof;
      if (kind === 'arch') this.arch(topZ, mesh, ribs, 0.06, 0.04);
      else if (kind === 'gable') this.gable(topZ, mesh, ribs);
      else this.shed(topZ, mesh, ribs);
    } else mesh.box([-0.03, -0.03, topZ - 0.02], [this.scene.Le + 0.03, this.scene.We + 0.03, topZ + 0.03], 0.01);
    this.lugs(topZ);
  }

  /** Скат кровли от (ya, za) до (yb, zb) со свесом по длине: лист и рёбра. */
  slope(mesh, rib, [fromY, fromZ], [tillY, tillZ]) {
    const over = 0.06;
    const Le = this.scene.Le;
    const dy = tillY - fromY;
    const dz = tillZ - fromZ;
    const length = Math.hypot(dy, dz);
    const sign = Math.sign(dy);
    const normal = [0, (-dz * sign) / length, (dy * sign) / length];
    const v = [0, dy, dz];
    const thickVec = StV.mul(normal, 0.04);
    mesh.obox([-over, fromY, fromZ], [Le + 2 * over, 0, 0], v, thickVec);
    for (let x = 0.12; x < Le + 2 * over - 0.08; x += 0.333)
      rib.obox(StV.add([x - over, fromY, fromZ], thickVec), [0.035, 0, 0], v, StV.mul(normal, 0.028));
  }

  /** Двускатная: конёк вдоль контейнера, фронтоны в торцах. */
  gable(topZ, mesh, [rib, gable]) {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const rise = this.scene.rise;
    const over = 0.06;
    const eaveZ = topZ - (over * rise) / (We / 2);
    this.slope(mesh, rib, [-over, eaveZ], [We / 2, topZ + rise]);
    this.slope(mesh, rib, [We + over, eaveZ], [We / 2, topZ + rise]);
    mesh.box(
      [-over, We / 2 - 0.09, topZ + rise + 0.04 * 0.3],
      [Le + over, We / 2 + 0.09, topZ + rise + 0.04 + 0.02],
      0.01,
    );
    for (const [x, normal] of [
      [0, -1],
      [Le, 1],
    ])
      gable.tri([x, 0, topZ], [x, We, topZ], [x, We / 2, topZ + rise], [normal, 0, 0]);
  }

  /** Односкатная: выше у стены с дверью, скат — к задней стене. */
  shed(topZ, mesh, [rib, gable]) {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const rise = this.scene.rise;
    const over = 0.06;
    const k = rise / We;
    this.slope(mesh, rib, [We + over, topZ - over * k], [-over, topZ + rise + over * k]);
    for (const [x, normal] of [
      [0, -1],
      [Le, 1],
    ])
      gable.tri([x, 0, topZ], [x, We, topZ], [x, 0, topZ + rise], [normal, 0, 0]);
    if (!this.scene.cut) gable.quad([0, 0, topZ], [Le, 0, topZ], [Le, 0, topZ + rise], [0, 0, topZ + rise], [0, -1, 0]);
  }

  /** Арочная крыша: лист по дуге (гладкие нормали) толщиной t со свесами o, рёбра по дуге, торцы под дугой — стеной. */
  arch(topZ, mesh, [rib, gable], over, thick) {
    const Le = this.scene.Le;
    const points = this.arcPts(topZ, over);
    SceneHull.strip(mesh, points, [-over, Le + over], 0, false);
    SceneHull.strip(mesh, points, [-over, Le + over], -thick, true);
    SceneHull.band(mesh, points, -over, -thick, -1);
    SceneHull.band(mesh, points, Le + over, -thick, 1);
    for (let x = 0.12; x < Le + 2 * over - 0.08; x += 0.333) {
      const x0 = x - over;
      const x1 = x0 + 0.035;
      SceneHull.strip(rib, points, [x0, x1], 0.026, false);
      SceneHull.band(rib, points, x0, 0.026, -1);
      SceneHull.band(rib, points, x1, 0.026, 1);
    }
    const We = this.scene.We;
    for (const [x, sign] of [
      [0, -1],
      [Le, 1],
    ])
      for (let k = 0; k < points.length - 1; k++) {
        const near = points[k];
        const next = points[k + 1];
        if (near.y < 0 || next.y > We) continue; // торец под дугой
        gable.tri(
          [x, We / 2, topZ],
          [x, near.y, Math.max(topZ, near.z - thick)],
          [x, next.y, Math.max(topZ, next.z - thick)],
          [sign, 0, 0],
        );
      }
  }

  /** Точки дуги поперёк контейнера со свесами o: y, z и нормаль. */
  arcPts(topZ, over) {
    const We = this.scene.We;
    const radius = this.arcR();
    const centerZ = topZ + this.scene.rise - radius;
    const steps = 20;
    const points = [];
    for (let k = 0; k <= steps; k++) {
      const y = -over + ((We + 2 * over) * k) / steps;
      const z = centerZ + Math.sqrt(Math.max(0, radius * radius - (y - We / 2) * (y - We / 2)));
      points.push({ y, z, n: StV.norm([0, y - We / 2, z - centerZ]) });
    }
    return points;
  }

  /** Полоса по дуге от x0 до x1, смещённая по нормали на off (flip — нормаль внутрь). */
  static strip(mesh, points, [x0, x1], off, flip) {
    const sign = flip ? -1 : 1;
    const shift = (point, x) => [x, point.y + point.n[1] * off, point.z + point.n[2] * off];
    for (let k = 0; k < points.length - 1; k++) {
      const near = points[k];
      const next = points[k + 1];
      const i = mesh.count;
      mesh.vert(shift(near, x0), StV.mul(near.n, sign));
      mesh.vert(shift(near, x1), StV.mul(near.n, sign));
      mesh.vert(shift(next, x1), StV.mul(next.n, sign));
      mesh.vert(shift(next, x0), StV.mul(next.n, sign));
      mesh.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  /** Торец полосы в плоскости x: от дуги до смещения off по нормали, нормаль торца — sx по x. */
  static band(mesh, points, x, off, sign) {
    for (let k = 0; k < points.length - 1; k++) {
      const near = points[k];
      const next = points[k + 1];
      mesh.quad(
        [x, near.y, near.z],
        [x, next.y, next.z],
        [x, next.y + next.n[1] * off, next.z + next.n[2] * off],
        [x, near.y + near.n[1] * off, near.z + near.n[2] * off],
        [sign, 0, 0],
      );
    }
  }

  /** Строповочные петли в верхних углах рамы (блок-контейнер, цельносварной). */
  lugs(topZ) {
    const Le = this.scene.Le;
    const We = this.scene.We;
    const mesh = this.scene.meshFor(StMat.paint(RalColor.shade(this.scene.frame, 0.9), 0.45));
    const dark = this.scene.meshFor(StMat.paint('#15181b', 0.8));
    for (const x of [0.09, Le - 0.09])
      for (const y of [0.05, We - 0.05]) {
        const z0 = this.scene.rise > 0 ? this.scene.roofZ(y) + 0.03 : topZ + 0.03;
        mesh.box([x - 0.08, y - 0.012, z0 - 0.02], [x + 0.08, y + 0.012, z0 + 0.12], 0.008);
        dark.tube([x, y - 0.015, z0 + 0.07], [x, y + 0.015, z0 + 0.07], 0.03, 16);
      }
  }
}
