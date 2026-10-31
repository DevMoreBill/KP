import { StMat } from './st-mat.js';
import { RalColor } from '../layout/ral-color.js';
import { OutfitBase } from './outfit-base.js';

/**
 * Отсек топливного бака ДГУ: перегородка, поддон, заливная труба к горловине в нише стены (лючок заподлицо — габарит не
 * меняется), насос перекачки в бак ДГУ, дыхательный клапан над крышей, огнетушитель, жалюзи отсека.
 */
export class OutfitFuel {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /** Топливная система: отсек, поддон, заправка, дыхательный клапан. */
  fuel() {
    const { scene: scene, plan: plan } = this.outfit;
    const fuel = plan.fuel;
    if (!fuel) return;
    const tanks = plan.items.filter(i => i.tank);
    const meshes = {
      dk: scene.meshFor(StMat.paint('#2b3036', 0.6)),
      st: scene.meshFor(StMat.metal(StMat.GALV, 0.4)),
    };
    const tank = tanks[0];
    if (this.outfit.inside) this.room(fuel, tanks, meshes);
    if (tank) this.breather(tank, meshes);
    const fill = fuel.fill;
    const fillWall = fill.wall === 'left' || fill.wall === 'back' ? fill.wall : 'front';
    const fillU = fillWall === 'left' ? fill.y : fill.x;
    this.outfit.outer(fillWall, fillU - 260, fillU + 260, fill.z - 260, fill.z + 260);
    if (fillWall !== 'front' || !scene.cut) this.niche(fillWall, fillU, fill.z);
    if (fuel.gate) this.gateLouvers(fuel.gate);
    else if (!scene.geo.sea) this.endLouver();
  }

  /** Внутри: перегородка (в разрезе — утеплитель), поддоны, заливная труба, огнетушитель, насос перекачки. */
  room(fuel, tanks, meshes) {
    const scene = this.outfit.scene;
    const [, wid, height] = this.outfit.plan.int;
    const near = scene.point(fuel.x1, 0, 0);
    const far = scene.point(fuel.x1 + fuel.part, wid, height);
    scene.meshFor(StMat.paint(scene.lining, 0.55)).box(near, far);
    if (scene.cut) {
      const y = scene.oy - 0.001;
      scene
        .meshFor(StMat.paint(StMat.INS, 0.9))
        .quad([near[0], y, near[2]], [far[0], y, near[2]], [far[0], y, far[2]], [near[0], y, far[2]], [0, -1, 0]);
    }
    for (const item of tanks) this.pan(item, meshes.dk, wid);
    const tank = tanks[0];
    if (tank) this.fillPipe(fuel, tank, meshes.st);
    this.outfit.safety.extinguisher(scene.point(fuel.x1, 350, OutfitBase.EXT - 500), [-1, 0, 0]);
    scene.sticker({ type: 'sign', id: 'F04' }, scene.point(fuel.x1, 350, 1720), [-1, 0, 0], [0.2, 0.2]);
    if (tank) this.transfer(tank, fuel, meshes);
  }

  /** Поддон под баком на полный объём. */
  pan(item, dark, wid) {
    const scene = this.outfit.scene;
    const low = scene.point(item.x - 60, item.y - 60, 0);
    const high = scene.point(item.x + item.lx + 60, Math.min(wid - 20, item.y + item.ly + 60), 180);
    const rim = 0.006;
    dark.box([low[0], low[1], low[2]], [high[0], high[1], low[2] + 0.008]);
    for (const [x0, y0, x1, y1] of [
      [low[0], low[1], high[0], low[1] + rim],
      [low[0], high[1] - rim, high[0], high[1]],
      [low[0], low[1], low[0] + rim, high[1]],
      [high[0] - rim, low[1], high[0], high[1]],
    ]) {
      dark.box([x0, y0, low[2]], [x1, y1, high[2]]);
    }
  }

  /** Заливная труба: от горловины в стене — к баку сверху. */
  fillPipe(fuel, tank, steel) {
    const scene = this.outfit.scene;
    const path = this.fillPath(fuel.fill, tank).map(([x, y, z]) => scene.point(x, y, z));
    for (let k = 1; k < path.length; k++) {
      steel.tube(path[k - 1], path[k], 0.026, 12);
      if (k < path.length - 1) steel.sphere(path[k], 0.027, 10);
    }
  }

  /** Трасса трубы заправки от горловины до бака, мм. */
  fillPath(fill, tank) {
    const wid = this.outfit.plan.int[1];
    const top = tank.z + tank.h;
    const tankX = tank.x + tank.lx * 0.25;
    const tankY = tank.y + tank.ly / 2;
    const riseZ = Math.max(fill.z, top + 150);
    const bendX = fill.wall === 'left' ? tankX : Math.max(tank.x + 100, Math.min(tank.x + tank.lx - 100, fill.x));
    const backY = wid - 50;
    const tail = [
      [bendX, tankY, riseZ],
      [bendX, tankY, top],
    ];
    if (fill.wall === 'left')
      return [[0, fill.y, fill.z], [120, fill.y, fill.z], [120, fill.y, riseZ], [bendX, fill.y, riseZ], ...tail];
    if (fill.wall === 'back')
      return [[fill.x, wid, fill.z], [fill.x, backY, fill.z], [fill.x, backY, riseZ], [bendX, backY, riseZ], ...tail];
    return [[fill.x, 0, fill.z], [fill.x, 120, fill.z], [fill.x, 120, riseZ], [fill.x, tankY, riseZ], ...tail];
  }

  /** Дыхательный клапан с огнепреградителем — над крышей. */
  breather(tank, { st: steel, dk: dark }) {
    const scene = this.outfit.scene;
    const top = scene.point(tank.x + tank.lx * 0.8, tank.y + tank.ly * 0.7, tank.z + tank.h);
    const roofZ = scene.roofZ(top[1]) + (scene.rise > 0 ? 0.04 : 0);
    if (this.outfit.inside) steel.tube(top, [top[0], top[1], scene.ceil], 0.02, 10);
    steel.tube([top[0], top[1], roofZ - 0.02], [top[0], top[1], roofZ + 0.32], 0.02, 10);
    steel.tube([top[0], top[1], roofZ + 0.32], [top[0], top[1], roofZ + 0.4], 0.042, 14);
    dark.tube([top[0], top[1], roofZ + 0.42], [top[0], top[1], roofZ + 0.435], 0.075, 18);
    steel.tube([top[0], top[1], roofZ + 0.4], [top[0], top[1], roofZ + 0.42], 0.014, 8);
  }

  /** Ворота отсека в торце: жалюзи внизу и вверху створок (естественная вентиляция отсека). */
  gateLouvers(gate) {
    const scene = this.outfit.scene;
    const meters = scene.meters;
    const leafW = (gate.y1 - gate.y0) / 2;
    const x = -0.027;
    for (let k = 0; k < 2; k++) {
      const from = scene.oy + meters(gate.y0 + k * leafW + 120);
      const till = scene.oy + meters(gate.y0 + (k + 1) * leafW - 120);
      if (till - from < 0.15) continue;
      scene.louver(1, x, [from, till], [scene.base + 0.15, scene.base + 0.45], -1);
      scene.louver(1, x, [from, till], [scene.base + meters(gate.h) - 0.45, scene.base + meters(gate.h) - 0.2], -1);
    }
    this.outfit.outer('left', gate.y0 - 100, gate.y1 + 100, 0, gate.h + 150);
  }

  /** Жалюзи отсека вверху в торце (внизу — решётка в двери отсека). */
  endLouver() {
    const scene = this.outfit.scene;
    const wid = this.outfit.plan.int[1];
    const y0 = scene.oy + scene.meters(wid - 450);
    const y1 = scene.oy + scene.meters(wid - 150);
    scene.louver(1, 0, [y0, y1], [scene.top - 0.65, scene.top - 0.4], -1);
    this.outfit.hood('left', y0 - scene.oy - 0.06, y1 - scene.oy + 0.06, scene.top - 0.34);
    this.outfit.outer(
      'left',
      wid - 510,
      wid - 90,
      (scene.top - 0.7 - scene.base) * 1000,
      (scene.top - 0.3 - scene.base) * 1000,
    );
  }

  /** Насос перекачки: на раме у бака перед перегородкой; всасывание — из нижнего патрубка с краном, нагнетание — вверх. */
  transfer(tank, fuel, { st: steel, dk: dark }) {
    const scene = this.outfit.scene;
    const x = Math.min(fuel.x1 - 130, tank.x + tank.lx + 170);
    const y0 = Math.max(220, tank.y - 330);
    const y1 = y0 + 240;
    const midZ = 170;
    const red = scene.meshFor(StMat.paint('#c83a2e', 0.4));
    const motor = scene.meshFor(StMat.paint('#4f5d6b', 0.45));
    if (x - 100 < tank.x + tank.lx + 40) return;
    this.outfit.log.push({ kind: 'fuelpump', x, y: y0 });
    dark.box(scene.point(x - 100, y0, 0), scene.point(x + 100, y1, 60), 0.006);
    motor.tube(scene.point(x, y0 + 20, midZ), scene.point(x, y0 + 170, midZ), 0.07, 20);
    dark.tube(scene.point(x, y0 + 15, midZ), scene.point(x, y0 + 22, midZ), 0.072, 20);
    red.tube(scene.point(x, y0 + 170, midZ), scene.point(x, y1 - 10, midZ), 0.06, 20);
    dark.box(scene.point(x - 60, y0 + 40, 60), scene.point(x + 60, y0 + 150, midZ - 60));
    this.suction(tank, { x, y1, zc: midZ }, { st: steel, red });
    this.delivery({ x, y0, y1, zc: midZ }, steel);
  }

  /** Всасывание из бака с краном. */
  suction(tank, { x, y1, zc: midZ }, { st: steel, red }) {
    const scene = this.outfit.scene;
    const start = scene.point(tank.x + tank.lx - 120, tank.y - 1, 120);
    const bend = scene.point(tank.x + tank.lx - 120, y1 + 60, 120);
    const turn = scene.point(x, y1 + 60, 120);
    const end = scene.point(x, y1 - 10, midZ);
    steel.tube(start, bend, 0.016, 10);
    steel.sphere(bend, 0.017, 8);
    steel.tube(bend, turn, 0.016, 10);
    steel.sphere(turn, 0.017, 8);
    steel.tube(turn, end, 0.016, 10);
    steel.sphere(bend, 0.026, 10);
    red.box([bend[0] - 0.01, bend[1] - 0.01, bend[2] + 0.03], [bend[0] + 0.09, bend[1] + 0.01, bend[2] + 0.045], 0.003);
  }

  /** Нагнетание — к топливопроводу у задней стены. */
  delivery({ x, y0, y1, zc: midZ }, steel) {
    const scene = this.outfit.scene;
    const line = (this.outfit.plan.lines || []).find(cand => cand.medium === 'fuel');
    const lineZ = line ? line.z : 1150;
    const lineY = line ? line.y : this.outfit.plan.int[1] - 50;
    const u = scene.point(x, (y0 + y1) / 2, midZ + 70);
    const v = scene.point(x, (y0 + y1) / 2, lineZ);
    const target = scene.point(x, lineY, lineZ);
    steel.tube(u, v, 0.016, 10);
    steel.sphere(v, 0.017, 8);
    steel.tube(v, target, 0.016, 10);
    steel.sphere(target, 0.022, 8);
  }

  /** Заливная горловина в нише стены w: снаружи — лючок заподлицо, замок, знаки W01 и «ДТ»; изнутри — короб ниши. */
  niche(wall, u, z) {
    const scene = this.outfit.scene;
    const lid = scene.meshFor(StMat.paint(RalColor.shade(scene.wall, 0.86), 0.45));
    const dark = scene.meshFor(StMat.paint('#24292e', 0.55));
    const metal = scene.meshFor(StMat.metal('#c3c8cd', 0.3));
    const size = 0.2;
    const { spot, normal, slab } = this.nicheFrame(wall, u, z);
    slab(dark, [-size, size], [-size, size], [0, 0.003]);
    slab(lid, [-size + 0.012, size - 0.012], [-size + 0.012, size - 0.012], [0.002, 0.004], 0.003);
    slab(metal, [-0.02, 0.02], [-0.12, -0.08], [0.003, 0.006], 0.004);
    scene.sticker({ type: 'sign', id: 'W01' }, spot(-0.08, 0.06, 0.005), normal, [0.12, 0.105]);
    scene.sticker({ type: 'sign', id: 'DT' }, spot(0.1, 0.06, 0.005), normal, [0.11, 0.06]);
    if (!this.outfit.inside) return;
    const origin = wall === 'left' ? scene.ox : scene.oy;
    slab(lid, [-size, size], [-size, size], [-(origin + 0.15), -origin], 0.01);
    dark.tube(spot(0, -0.02, -origin - 0.02), spot(0, -0.02, -origin - 0.12), 0.04, 14);
  }

  /** Наружная плоскость стены у горловины: at(вдоль, вверх, наружу), нормаль наружу, короб bx([вдоль], [вверх], [наружу]). */
  nicheFrame(wall, u, z) {
    const scene = this.outfit.scene;
    const end = wall === 'left';
    const midZ = scene.base + scene.meters(z);
    const normal = { left: [-1, 0, 0], back: [0, 1, 0] }[wall] || [0, -1, 0];
    const center = end
      ? [this.outfit.leftX(), scene.oy + scene.meters(u), midZ]
      : [scene.ox + scene.meters(u), wall === 'back' ? scene.We : this.outfit.frontY(), midZ];
    const spot = (du, dz, off) =>
      end
        ? [center[0] + normal[0] * off, center[1] + du, center[2] + dz]
        : [center[0] + du, center[1] + normal[1] * off, center[2] + dz];
    const slab = (mesh, [from, till], [z0, z1], [nearOff, farOff], round = 0) => {
      const near = spot(from, z0, nearOff);
      const far = spot(till, z1, farOff);
      mesh.box([near[0], near[1], near[2]], [far[0], far[1], far[2]], round);
    };
    return { spot, normal, slab };
  }
}
