import { StMat } from './st-mat.js';
import { RalColor } from '../layout/ral-color.js';
import { StationVent } from '../layout/station-vent.js';

/** Вентиляция: жалюзи с козырьками и маркизами, вентиляторы, колпаки на крыше, двери-жалюзи ДГУ, выхлоп через стену. */
export class OutfitAir {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /** Жалюзи по расчёту вентиляции (plan.vent), колпаки на крыше, воздуховоды радиаторов ДГУ; подписей на 3D-виде нет. */
  vents() {
    const plan = this.outfit.plan;
    const vent = plan.vent;
    const dgu = plan.items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');
    if (!vent) return;
    for (const louver of vent.louvers) this.louver(louver);
    for (const hood of vent.roof || []) this.roofHood(hood);
    for (const unit of dgu) this.outfit.inner.duct(unit);
  }

  /** Жалюзи вентиляции: створка, решётка или дверь-жалюзи ДГУ. */
  louver(louver) {
    const plan = this.outfit.plan;
    if (louver.kind === 'rad' && louver.door) {
      const door =
        (plan.dguDoors || []).find(cand => cand.pos === louver.pos && cand.unit === louver.unit) || plan.dguDoor;
      if (door) this.endDoor(door);
    } else if (louver.leaf) {
      this.leafVent(louver);
    } else {
      this.vent(louver);
      if (louver.fan) this.fan(louver);
    }
  }

  /** Жалюзи снаружи стены w (u a…b, высота Z0…Z1, м); off — поверх полотна створки. */
  outLouver(wall, [from, till], [lowZ, topZ], off = 0) {
    const scene = this.outfit.scene;
    if (wall === 'right') scene.louver(1, scene.Le + off, [scene.oy + from, scene.oy + till], [lowZ, topZ], 1);
    else if (wall === 'left') scene.louver(1, -off, [scene.oy + from, scene.oy + till], [lowZ, topZ], -1);
    else if (wall === 'back') scene.louver(0, scene.We + off, [scene.ox + from, scene.ox + till], [lowZ, topZ], 1);
    else if (!scene.cut) scene.louver(0, -off, [scene.ox + from, scene.ox + till], [lowZ, topZ], -1);
  }

  /** Вентилятор в проёме (вытяжной — система «Вытяжные вентиляторы», приточный — если жалюзи притока не встали): изнутри —
   *  монтажная плита с осевыми вентиляторами (обечайка, ступица с двигателем) и датчик температуры рядом; снаружи — те же
   *  жалюзи (гравитационные) с козырьком. Число вентиляторов в проёме — по его форме (ширина / высота) */
  fan(louver) {
    if (!this.outfit.shown(louver.wall)) return;
    const scene = this.outfit.scene;
    const wall = louver.wall;
    const count = Math.max(1, Math.round((louver.u1 - louver.u0) / (louver.z1 - louver.z0)));
    const du = (louver.u1 - louver.u0) / count;
    const midZ = (louver.z0 + louver.z1) / 2;
    const radius = Math.min(du, louver.z1 - louver.z0) * 0.42;
    const plate = scene.meshFor(StMat.paint('#b9bfc5', 0.45));
    const ring = scene.meshFor(StMat.metal(StMat.GALV, 0.35));
    const dark = scene.meshFor(StMat.paint('#2a2f34', 0.55));
    this.outfit.box(
      plate,
      wall,
      [(louver.u0 + louver.u1) / 2, midZ],
      [louver.u1 - louver.u0 + 40, louver.z1 - louver.z0 + 40, 30],
    ); // монтажная плита
    for (let i = 0; i < count; i++) {
      const u = louver.u0 + du * (i + 0.5);
      ring.tube(
        this.outfit.wallPoint(wall, u, midZ, 30),
        this.outfit.wallPoint(wall, u, midZ, 190),
        radius / 1000,
        28,
        { caps: [false, false] },
      ); // обечайка
      dark.tube(
        this.outfit.wallPoint(wall, u, midZ, 60),
        this.outfit.wallPoint(wall, u, midZ, 230),
        (radius * 0.28) / 1000,
        18,
      ); // ступица с двигателем
      for (let k = 0; k < 3; k++) {
        const angle = (k * Math.PI * 2) / 3;
        const tip = [Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8];
        // кронштейны двигателя
        dark.tube(
          this.outfit.wallPoint(wall, u, midZ, 200),
          this.outfit.wallPoint(wall, u + tip[0], midZ + tip[1], 200),
          0.008,
          6,
        );
      }
    }
    this.outfit.box(dark, wall, [louver.u1 + 120, midZ - (louver.z1 - louver.z0) / 2 + 60], [70, 90, 35], 0.006); // датчик температуры (термостат)
  }

  /** Приток в створке ворот или сервисной двери: жалюзи на полотне (маркиза открывается вместе с ним). */
  leafVent(louver) {
    const scene = this.outfit.scene;
    const [from, till] = [louver.u0 / 1000, louver.u1 / 1000];
    const topZ = scene.base + louver.z1 / 1000;
    const off = louver.wall === 'left' || louver.wall === 'right' ? 0.03 : 0.052;
    this.outfit.outer(louver.wall, louver.u0 - 60, louver.u1 + 60, louver.z0 - 60, louver.z1 + 60);
    this.outLouver(louver.wall, [from, till], [scene.base + louver.z0 / 1000, topZ], off);
    if (louver.hood) this.outfit.snow(louver.wall, [from, till], topZ, louver.hood, off);
  }

  /** Выброс через крышу: колпак над проёмом (оцинковка) — жалюзи по сторонам, крышка с выносом; внутри под проёмом —
   *  клапан (у компрессора — его воздуховод доходит до потолка) */
  roofHood(hood) {
    const scene = this.outfit.scene;
    const galv = scene.meshFor(StMat.metal(StMat.GALV, 0.38));
    const slats = scene.meshFor(StMat.paint('#5d646b', 0.55));
    const near = scene.point(hood.x0, hood.y0, 0);
    const far = scene.point(hood.x1, hood.y1, 0);
    const roofZ = Math.max(scene.roofZ(near[1]), scene.roofZ(far[1])) + (scene.rise > 0 ? 0.04 : 0);
    const height = 0.36;
    const x0 = near[0];
    const y0 = near[1];
    const x1 = far[0];
    const y1 = far[1];
    galv.box(
      [x0 - 0.03, y0 - 0.03, Math.min(scene.roofZ(near[1]), scene.roofZ(far[1]))],
      [x1 + 0.03, y1 + 0.03, roofZ + 0.06],
      0.004,
    ); // стакан
    for (const [low, high] of [
      [0.02, 0.04],
      [height - 0.04, height - 0.02],
    ])
      galv.box([x0, y0, roofZ + low], [x1, y1, roofZ + high]);
    for (const k of [0, 1, 2, 3])
      galv.box(
        [k % 2 ? x1 - 0.03 : x0, k < 2 ? y0 : y1 - 0.03, roofZ + 0.04],
        [k % 2 ? x1 : x0 + 0.03, k < 2 ? y0 + 0.03 : y1, roofZ + height - 0.04],
      ); // стойки по углам
    for (let z = roofZ + 0.08; z < roofZ + height - 0.05; z += 0.055) {
      slats.box([x0 + 0.03, y0 - 0.005, z], [x1 - 0.03, y0 + 0.005, z + 0.02]);
      slats.box([x0 + 0.03, y1 - 0.005, z], [x1 - 0.03, y1 + 0.005, z + 0.02]);
      slats.box([x0 - 0.005, y0 + 0.03, z], [x0 + 0.005, y1 - 0.03, z + 0.02]);
      slats.box([x1 - 0.005, y0 + 0.03, z], [x1 + 0.005, y1 - 0.03, z + 0.02]);
    }
    galv.box([x0 - 0.09, y0 - 0.09, roofZ + height], [x1 + 0.09, y1 + 0.09, roofZ + height + 0.03], 0.006); // крышка с выносом
  }

  /** Проём в стене: снаружи — жалюзи с козырьком (с маркизой — маркиза вместо него), изнутри — решётка и клапан с приводом. */
  vent(louver) {
    const { wall: wall, u0, u1, z0, z1, hood: hood } = louver;
    const scene = this.outfit.scene;
    const [from, till] = [u0 / 1000, u1 / 1000];
    const topZ = scene.base + z1 / 1000;
    if (hood) this.outfit.snow(wall, [from, till], topZ, hood);
    this.outfit.walls.busy(wall, u0 - 90, u1 + 260, z0 - 90, z1 + 90);
    const low = hood ? Math.min(z0, z1 + StationVent.HOOD_LAP - hood.drop) : z0;
    this.outfit.outer(
      wall,
      u0 - StationVent.HOOD_SIDE - 20,
      u1 + StationVent.HOOD_SIDE + 20,
      low - 80,
      z1 + (hood ? 140 : 220),
    );
    this.outLouver(wall, [from, till], [scene.base + z0 / 1000, topZ]);
    if (!hood) this.outfit.hood(wall, from - 0.06, till + 0.06, topZ + 0.06);
    if (this.outfit.shown(wall)) this.grille(louver);
  }

  /** Изнутри: рамка, ламели, клапан с электроприводом. */
  grille({ wall: wall, u0, u1, z0, z1 }) {
    const scene = this.outfit.scene;
    const frame = scene.meshFor(StMat.paint('#9aa1a8', 0.5));
    const slats = scene.meshFor(StMat.paint('#6b737b', 0.55));
    const dark = scene.meshFor(StMat.paint('#202428', 0.6));
    const [midU, midZ, du, dz] = [(u0 + u1) / 2, (z0 + z1) / 2, u1 - u0, z1 - z0];
    for (const [u, z, spanU, spanZ] of [
      [midU, z0, du + 60, 30],
      [midU, z1, du + 60, 30],
      [u0, midZ, 30, dz + 60],
      [u1, midZ, 30, dz + 60],
    ]) {
      this.outfit.box(frame, wall, [u, z], [spanU, spanZ, 25]);
    }
    for (let z = z0 + 40; z < z1 - 20; z += 55) this.outfit.box(slats, wall, [midU, z], [du - 10, 12, 18], 0);
    this.outfit.box(dark, wall, [u1 + 130, midZ], [110, 150, 90], 0.008);
    this.outfit.box(frame, wall, [u1 + 50, midZ], [50, 20, 40], 0);
  }

  /**
   * ДГУ: напротив радиатора — двустворчатая дверь-жалюзи в торце (d.y0…d.y1) или в задней стене (ДГУ поперёк, d.x0…d.x1):
   * коробка, створки с ламелями, петли, запорные штанги, ручка, козырёк; изнутри — клапан с электроприводом.
   */
  endDoor(door) {
    const scene = this.outfit.scene;
    const wall = door.wall || 'right';
    const end = wall !== 'back';
    const [u0m, u1m] = end ? [door.y0, door.y1] : [door.x0, door.x1];
    const frame = this.doorFrame(wall, end);
    this.outfit.walls.busy(wall, u0m - 60, u1m + 260, 0, door.h + 120);
    this.outfit.outer(wall, u0m - 100, u1m + 100, 0, door.h + 220);
    const meshes = {
      fr: scene.meshFor(StMat.paint(RalColor.shade(scene.frame, 0.9), 0.45)),
      lf: scene.meshFor(StMat.paint(scene.wall, 0.45)),
      sl: scene.meshFor(StMat.paint('#5d646b', 0.55)),
      dk: scene.meshFor(StMat.paint('#24292e', 0.55)),
      mt: scene.meshFor(StMat.metal('#c3c8cd', 0.3)),
    };
    const [from, till] = [u0m / 1000, u1m / 1000];
    const zSpan = [scene.base + 0.01, scene.base + door.h / 1000];
    this.leaves(frame, meshes, [from, till], zSpan);
    this.outfit.hood(wall, from - 0.08, till + 0.08, zSpan[1] + 0.08);
    this.outfit.log.push({ kind: 'dgudoor', wall, u: (u0m + u1m) / 2, w: door.w, h: door.h });
    if (!this.outfit.shown(wall)) return;
    this.outfit.box(meshes.dk, wall, [u1m + 150, door.h / 2], [110, 150, 90], 0.008);
    this.outfit.box(meshes.fr, wall, [u1m + 70, door.h / 2], [50, 20, 40], 0);
  }

  /** Точки двери в плоскости стены: toWorld(u — вдоль, наружу, z), toVec — вектор, slab — короб. */
  doorFrame(wall, end) {
    const scene = this.outfit.scene;
    const origin = end ? scene.oy : scene.ox;
    const sign = wall === 'left' ? -1 : 1;
    const plane = { left: 0, right: scene.Le }[wall] ?? scene.We;
    const toWorld = (u, out, z) => (end ? [plane + sign * out, origin + u, z] : [origin + u, plane + sign * out, z]);
    const toVec = (du, dOut, dz) => (end ? [sign * dOut, du, dz] : [du, sign * dOut, dz]);
    const slab = (mesh, [fromU, tillU], [fromOut, tillOut], [fromZ, tillZ], round = 0) => {
      const [near, far] = [toWorld(fromU, fromOut, fromZ), toWorld(tillU, tillOut, tillZ)];
      mesh.box([near[0], near[1], near[2]], [far[0], far[1], far[2]], round);
    };
    return { toWorld, toVec, slab };
  }

  /** Коробка, две створки с ламелями и петлями, запорные штанги, ручка с замком. */
  leaves({ toWorld, toVec, slab }, meshes, [from, till], [lowZ, topZ]) {
    const mid = (from + till) / 2;
    slab(meshes.fr, [from - 0.05, from], [0, 0.03], [lowZ - 0.01, topZ + 0.05]);
    slab(meshes.fr, [till, till + 0.05], [0, 0.03], [lowZ - 0.01, topZ + 0.05]);
    slab(meshes.fr, [from - 0.05, till + 0.05], [0, 0.03], [topZ, topZ + 0.05]);
    for (const [u0, u1, hinge] of [
      [from, mid - 0.003, from],
      [mid + 0.003, till, till],
    ]) {
      slab(meshes.lf, [u0, u1], [0, 0.022], [lowZ, topZ - 0.004], 0.004);
      for (let z = lowZ + 0.24; z < topZ - 0.1; z += 0.07)
        meshes.sl.obox(
          toWorld(u0 + 0.06, 0.022, z),
          toVec(u1 - u0 - 0.12, 0, 0),
          toVec(0, 0.03, -0.022),
          toVec(0, 0, 0.012),
        );
      const hingeU = hinge + (hinge === from ? 0.015 : -0.015);
      for (const k of [0.15, 0.5, 0.85])
        meshes.dk.tube(
          toWorld(hingeU, 0.03, lowZ + (topZ - lowZ) * k),
          toWorld(hingeU, 0.03, lowZ + (topZ - lowZ) * k + 0.12),
          0.016,
          10,
        );
    }
    for (const u of [mid - 0.07, mid + 0.06])
      meshes.mt.tube(toWorld(u, 0.06, lowZ + 0.08), toWorld(u, 0.06, topZ - 0.08), 0.012, 10);
    slab(meshes.dk, [mid + 0.02, mid + 0.1], [0.05, 0.075], [lowZ + 0.95, lowZ + 1.17], 0.005);
  }

  /** Выхлоп ДГУ через стену (plan.exhausts, how 'wall' — глушитель встроен в ДГУ): от турбины вверх и к стене в теплоизоляции,
   *  проходка-гильза, снаружи — отвод вниз под 45° с дождевым колпаком */
  exhausts() {
    const scene = this.outfit.scene;
    const plan = this.outfit.plan;
    const [, wid] = plan.int;
    const wallExhausts = (plan.exhausts || []).filter(exhaust => exhaust.how === 'wall');
    if (!wallExhausts.length) return;
    const wrap = scene.meshFor(StMat.metal('#c4c9cd', 0.55));
    const steel = scene.meshFor(StMat.metal('#a7adb3', 0.4));
    const dark = scene.meshFor(StMat.paint(StMat.DARK, 0.55));
    const radius = 55;
    for (const exhaust of wallExhausts) {
      const dgu = plan.items.find(i => i.kind === 'dgu' && i.pos === exhaust.pos && i.unit === exhaust.unit);
      if (!dgu) continue;
      this.outfit.walls.busy('back', exhaust.u - 200, exhaust.u + 200, exhaust.z - 200, exhaust.z + 200);
      this.outfit.outer('back', exhaust.u - 250, exhaust.u + 250, exhaust.z - 500, exhaust.z + 250);
      if (this.outfit.inside) {
        const start = scene.point(exhaust.u, dgu.y + dgu.ly * 0.5, dgu.h);
        const turn = scene.point(exhaust.u, dgu.y + dgu.ly * 0.5, exhaust.z);
        const end = scene.point(exhaust.u, wid, exhaust.z);
        wrap.tube(start, turn, (radius / 1000) * 1.15, 18);
        wrap.sphere(turn, (radius / 1000) * 1.15, 14);
        wrap.tube(turn, end, (radius / 1000) * 1.15, 18);
      }
      const outlet = scene.point(exhaust.u, wid, exhaust.z);
      const y = scene.We;
      outlet[1] = y;
      const bend = [outlet[0], y + 0.25, outlet[2]];
      const tip = [outlet[0], y + 0.42, outlet[2] - 0.17];
      dark.tube([outlet[0], y - 0.03, outlet[2]], [outlet[0], y + 0.02, outlet[2]], (radius / 1000) * 1.9, 20); // гильза-проходка
      steel.tube([outlet[0], y, outlet[2]], bend, radius / 1000, 18);
      steel.sphere(bend, radius / 1000, 14);
      steel.tube(bend, tip, radius / 1000, 18); // отвод вниз под 45°
      dark.tube(tip, [tip[0], tip[1] + 0.04, tip[2] - 0.04], (radius / 1000) * 1.5, 18); // колпак
      this.outfit.log.push({ kind: 'exhaust', wall: 'back', u: exhaust.u, z: exhaust.z });
    }
  }
}
