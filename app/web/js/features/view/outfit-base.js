import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { StCam } from './st-cam.js';
import { RalColor } from '../layout/ral-color.js';
import { StWalls } from '../layout/st-walls.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationMods } from '../layout/station-mods.js';
import { StationVent } from '../layout/station-vent.js';

/**
 * Основа оснащения 3D-вида: места на стенах внутри (StWalls) и снаружи (O), точки и короба у стен, наклейки, видимость
 * места на картинке, козырьки и маркизы над жалюзи, проекция центра тяжести. u — вдоль стены, z — от пола, мм.
 */
export class OutfitBase {
  static NORMAL = { left: [1, 0, 0], right: [-1, 0, 0], back: [0, -1, 0], front: [0, 1, 0] };
  static N_OUT = { left: [-1, 0, 0], right: [1, 0, 0], back: [0, 1, 0], front: [0, -1, 0] };
  static RED = '#c42a20';
  /** Место, невидимое на 3D-виде, — как на 3 м дальше от цели. */
  static HIDE = 3000;
  /** Знак № 9 «Место строповки» и № 12 «Центр тяжести» на стене (ГОСТ 14192-96), мм. */
  static SLING = [180, 300];
  static COG = 300;
  /** Торцевая стена. */
  static isEnd(wall) {
    return wall === 'left' || wall === 'right';
  }
  static BRAND = [
    ['ПНЕВМО', '#0B45A0'],
    ['ТЕХ', '#3DA0EE'],
  ];

  /** Огнетушитель: верх — не выше 1,5 м от пола (ППР в РФ). */
  static get EXT() {
    return StationMatrix.grp('fire').ext;
  }

  constructor(scene) {
    this.scene = scene;
    this.plan = scene.plan;
    this.sys = this.plan.sys || {};
    this.walls = new StWalls(this.plan);
    this.inside = scene.view === 'in';
    this.log = [];
    this.outerBusy = { left: [], right: [], back: [], front: [] };
  }

  /** Станция из модулей: стыки на стенах снаружи заняты (стойки, нащельники); изнутри — StWalls. */
  joints() {
    const joints = StationMods.lines(this.plan.geo);
    const height = this.plan.int[2];
    for (const x of joints.x)
      for (const wall of ['front', 'back']) this.outer(wall, x - 200, x + 200, -500, height + 500);
    for (const y of joints.y)
      for (const wall of ['left', 'right']) this.outer(wall, y - 200, y + 200, -500, height + 500);
  }

  /** Снаружи на стене w занят участок u0…u1, z0…z1. */
  outer(wall, u0, u1, z0, z1) {
    this.outerBusy[wall].push([u0, u1, z0, z1]);
  }

  /** Снаружи на стене свободен участок u0…u1, z0…z1. */
  outFree(wall, u0, u1, z0, z1) {
    return this.outerBusy[wall].every(busy => !(busy[0] < u1 && busy[1] > u0 && busy[2] < z1 && busy[3] > z0));
  }

  /** Точка у стены помещения: u — вдоль стены, z — от пола, o — от стены внутрь, мм → мир, м. */
  wallPoint(wall, u, z, off = 0) {
    const scene = this.scene;
    const [len, wid] = this.plan.int;
    const byWall = {
      left: () => scene.point((scene.geo.x0 || 0) + off, u, z),
      right: () => scene.point(len - off, u, z),
      back: () => scene.point(u, wid - off, z),
    }[wall];
    return byWall ? byWall() : scene.point(u, off, z);
  }

  /** Короб на стене: середина [u, z]; ширина, высота, глубина от стены [du, dz, d], мм. */
  box(mesh, wall, [u, z], [du, dz, depth], round = 0.004) {
    const near = this.wallPoint(wall, u - du / 2, z - dz / 2, 0);
    const far = this.wallPoint(wall, u + du / 2, z + dz / 2, depth);
    mesh.box(
      [Math.min(near[0], far[0]), Math.min(near[1], far[1]), near[2]],
      [Math.max(near[0], far[0]), Math.max(near[1], far[1]), far[2]],
      round,
    );
  }

  /** Наклейка на стене: середина [u, z], размер [sw, sh], [от стены, свечение], мм. */
  sign(decal, wall, [u, z], [signW, signH], [off, glow] = [0, 0]) {
    this.scene.sticker(
      decal,
      this.wallPoint(wall, u, z, off),
      OutfitBase.NORMAL[wall],
      [signW / 1000, signH / 1000],
      glow,
    );
  }

  /** Стена видна: снаружи внутреннего не видно, стена со стороны зрителя в разрезе срезана. */
  shown(wall) {
    return this.inside && !(wall === 'front' && this.scene.cut);
  }

  /** Наружная поверхность обшивки: гофр и профлист выступают. */
  skin() {
    const scene = this.scene;
    if (scene.geo.sea) return null;
    return scene.geo.type === 'welded' ? 0.003 : 0.018;
  }

  /** Стена со стороны зрителя (y). */
  frontY() {
    const k = this.skin();
    return k == null ? -0.008 : k;
  }

  /** Торец у двери (x): с воротами или дверью в торце — по коробке проёма. */
  leftX() {
    const plan = this.plan;
    if (this.scene.geo.sea) return -0.034;
    const gate =
      [plan.gates, plan.gates2].some(pair => pair && pair.wall === 'left') || !!(plan.fuel && plan.fuel.gate);
    return plan.door === 'end' || gate ? -0.028 : this.skin();
  }

  /** Дальний торец (виден снаружи у ДГУ с дверью-жалюзи). */
  rightX() {
    const scene = this.scene;
    if (scene.geo.sea) return scene.Le + 0.008;
    const gate = [this.plan.gates, this.plan.gates2].some(pair => pair && pair.wall === 'right');
    return scene.Le + (gate ? 0.028 : -this.skin());
  }

  /** Точка стены видна: луч к камере не упирается в торец, потолок у среза, оборудование; при стоящей стене — через проёмы. */
  seen(wall, u, z) {
    if (wall === 'front' || !this.inside) return false;
    const scene = this.scene;
    const spot = this.wallPoint(wall, u, z, 70);
    const azimuth = (StCam.AZIMUTH * Math.PI) / 180;
    const el = (StCam.ELEVATION * Math.PI) / 180;
    const dir = [-Math.cos(el) * Math.sin(azimuth), -Math.cos(el) * Math.cos(azimuth), Math.sin(el)];
    const tWall = -spot[1] / dir[1];
    const cross = StV.add(spot, StV.mul(dir, tWall));
    const tLeft = (scene.ox + (scene.geo.x0 || 0) / 1000 - spot[0]) / dir[0];
    if ((tLeft > 0 && tLeft < tWall) || cross[2] > scene.ceil - 0.01) return false;
    const open =
      scene.cut ||
      scene.frontOpenings.some(
        opening =>
          cross[0] > scene.ox + opening.x0 / 1000 + 0.03 &&
          cross[0] < scene.ox + opening.x1 / 1000 - 0.03 &&
          cross[2] < scene.base + opening.h / 1000 - 0.03,
      );
    return (
      open &&
      !this.plan.items.some(
        item => item.mount !== 'pipe' && !item.tank && OutfitBase.hits(spot, dir, tWall, scene.extent(item)),
      )
    );
  }

  /** Луч p + t·d (0 < t < t0) пересекает коробку b = [x0, y0, z0, x1, y1, z1]. */
  static hits(origin, dir, tEnd, box) {
    let [tNear, tFar] = [1e-4, tEnd];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dir[k]) < 1e-9) {
        if (origin[k] < box[k] || origin[k] > box[k + 3]) return false;
        continue;
      }
      const span = [(box[k] - origin[k]) / dir[k], (box[k + 3] - origin[k]) / dir[k]].sort((x, y) => x - y);
      [tNear, tFar] = [Math.max(tNear, span[0]), Math.min(tFar, span[1])];
      if (tNear > tFar) return false;
    }
    return true;
  }

  /**
   * Место у точки t = [x, y] плана на стенах ws: свободный участок одной из полос bands ([ширина, z0, z1, штраф]),
   * ближайший; видимое на 3D-виде — в первую очередь (невидимое — как на hide дальше); нет — без «мягких» запретов.
   * Место занимается: {w, u — середина, wd, z0, z1} или null.
   */
  near(walls, bands, target, hide = OutfitBase.HIDE) {
    const best = this.best(walls, bands, target, hide, true) || this.best(walls, bands, target, hide, false);
    if (best) this.walls.busy(best.w, best.u - best.wd / 2, best.u + best.wd / 2, best.z0, best.z1);
    return best;
  }

  /** Лучшее место на одной из стен walls по полосам высоты bands. */
  best(walls, bands, target, hide, soft) {
    let best = null;
    for (const [width, z0, z1, pen = 0] of bands) {
      for (const wall of walls) {
        const spot = this.bestOn(wall, { wd: width, z0, z1, pen }, target, hide, soft);
        if (spot && (!best || spot.sc < best.sc)) best = spot;
      }
    }
    return best;
  }

  /** Лучшее место на стене wall: ближе к цели, на виду, без наложений. */
  bestOn(wall, { wd: width, z0, z1, pen }, target, hide, soft) {
    const [len, wid] = this.plan.int;
    const [low, high] = this.walls.range(wall);
    const viewZ = z0 + Math.min(z1 - z0, 900) * 0.35;
    const planXY = mid => [
      { left: this.scene.geo.x0 || 0, right: len }[wall] ?? mid,
      { back: wid, front: 0 }[wall] ?? mid,
    ];
    let best = null;
    for (let u = low + 120; u + width <= high - 120; u += 50) {
      if (!this.walls.free(wall, [u, u + width], [z0, z1], soft)) continue;
      const mid = u + width / 2;
      const [x, y] = planXY(mid);
      const score = Math.hypot(x - target[0], y - target[1]) + pen + (this.seen(wall, mid, viewZ) ? 0 : hide);
      if (!best || score < best.sc) best = { w: wall, u: mid, wd: width, z0, z1, sc: score };
    }
    return best;
  }

  /** Козырёк над жалюзи снаружи (от дождя и снега). */
  hood(wall, from, till, topZ) {
    const scene = this.scene;
    const mesh = scene.meshFor(StMat.paint(RalColor.shade(scene.wall, 0.9), 0.45));
    const thick = [0, 0, 0.006];
    if (wall === 'right') mesh.obox([scene.Le, scene.oy + from, topZ], [0, till - from, 0], [0.14, 0, -0.07], thick);
    else if (wall === 'left') mesh.obox([0, scene.oy + from, topZ], [0, till - from, 0], [-0.14, 0, -0.07], thick);
    else if (wall === 'back')
      mesh.obox([scene.ox + from, scene.We, topZ], [till - from, 0, 0], [0, 0.14, -0.07], thick);
    else if (!scene.cut) mesh.obox([scene.ox + from, 0, topZ], [till - from, 0, 0], [0, -0.14, -0.07], thick);
  }

  /** Точка снаружи стены w: u — вдоль, x — от наружной плоскости, z — высота, м. */
  outside(wall, u, x, z) {
    const scene = this.scene;
    if (wall === 'right') return [scene.Le + x, scene.oy + u, z];
    if (wall === 'left') return [-x, scene.oy + u, z];
    return wall === 'back' ? [scene.ox + u, scene.We + x, z] : [scene.ox + u, -x, z];
  }

  /**
   * Маркиза над жалюзи (u a…b, верх Z1, м): откидной козырёк на петлях, открыт на угол H.a; по бокам — треугольные
   * створки-ограничители (воздух только снизу); закрытая ложится на проём как щит. o — от наружной плоскости.
   */
  snow(wall, [from, till], topZ, hood, off = 0) {
    if (wall === 'front' && this.scene.cut) return;
    const scene = this.scene;
    const mesh = scene.meshFor(StMat.paint(RalColor.shade(scene.wall, 0.86), 0.45));
    const side = scene.meshFor(StMat.paint(RalColor.shade(scene.wall, 0.78), 0.5));
    const dark = scene.meshFor(StMat.paint('#24292e', 0.5));
    const thick = 0.004;
    const spot = (u, out, z) => this.outside(wall, u, off + out, z);
    const vec = (du, dOut, dz) => spot(du, dOut, dz).map((value, k) => value - spot(0, 0, 0)[k]);
    const angle = (hood.a * Math.PI) / 180;
    const [depth, drop, overhang] = [hood.d / 1000, hood.drop / 1000, StationVent.HOOD_SIDE / 1000];
    const [start, end] = [from - overhang, till + overhang];
    const hoodZ = topZ + StationVent.HOOD_LAP / 1000;
    const lowZ = hoodZ - drop;
    const gap = 0.012;
    mesh.obox(
      spot(start, gap, hoodZ),
      vec(end - start, 0, 0),
      vec(0, depth, -drop),
      vec(0, thick * Math.cos(angle), thick * Math.sin(angle)),
    );
    mesh.obox(spot(start, gap + depth, lowZ), vec(end - start, 0, 0), vec(0, 0, -0.035), vec(0, thick, 0));
    for (const u of [start, end]) {
      const [top, tip, bottom] = [spot(u, gap, hoodZ), spot(u, gap + depth, lowZ), spot(u, gap, lowZ)];
      side.tri(top, tip, bottom);
      side.tri(top, bottom, tip);
    }
    for (const u of [from, (from + till) / 2 - 0.03, till - 0.06])
      dark.tube(spot(u, 0.02, hoodZ + 0.01), spot(u + 0.06, 0.02, hoodZ + 0.01), 0.012, 8);
  }

  /** Проекция центра тяжести на стену w: {u, z} — мм, как у StWalls; нет массы — null. */
  cogOn(wall) {
    const mass = this.plan.mass;
    const scene = this.scene;
    if (!mass) return null;
    const center = mass.cg;
    return {
      u: OutfitBase.isEnd(wall) ? center.y - scene.oy * 1000 : center.x - scene.ox * 1000,
      z: center.z - StationGeo.zFloor(scene.geo.type),
    };
  }
}
