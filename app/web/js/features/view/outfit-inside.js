import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { StScene } from './st-scene.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLight } from '../layout/station-light.js';

/** Внутри помещения: свет, кабельный лоток, конвекторы, розетки, воздуховод радиатора ДГУ. */
export class OutfitInside {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /** Свет (plan.light): светильники в ряд по оси помещения, у аварийных — зелёный индикатор; в отсеке бака и тамбуре — круглый. */
  lights() {
    const scene = this.outfit.scene;
    const plan = this.outfit.plan;
    const [len, wid, height] = plan.int;
    const x0 = scene.geo.x0 || 0;
    const light = plan.light;
    if (!light || !light.on || !this.outfit.inside) return;
    const lamp = scene.meshFor(StMat.glow('#fffdf4', 5));
    const body = scene.meshFor(StMat.paint('#e9ecee', 0.4));
    const led = scene.meshFor(StMat.glow('#39d353', 3));
    const count = light.n;
    const y = wid / 2;
    const halfLen = StationLight.LAMP.len / 2;
    for (let i = 0; i < count; i++) {
      const x = x0 + ((len - x0) * (i + 0.5)) / count;
      body.box(scene.point(x - halfLen, y - 90, height - 60), scene.point(x + halfLen, y + 90, height), 0.01);
      lamp.box(scene.point(x - halfLen + 30, y - 70, height - 62), scene.point(x + halfLen - 30, y + 70, height - 55));
      if (i % 2 === 0 && i / 2 < light.em)
        led.box(
          scene.point(x + halfLen - 80, y - 104, height - 48),
          scene.point(x + halfLen - 35, y - 92, height - 28),
        );
    }
    const fuel = plan.fuel;
    const rooms = [];
    const tankBay = x0 - (fuel ? fuel.x1 + fuel.part : 0);
    if (fuel) rooms.push([0, fuel.x1]);
    if (tankBay > 0) rooms.push([x0 - tankBay, x0 - 60]);
    for (const [from, till] of rooms) {
      const center = scene.point((from + till) / 2, wid / 2, height);
      body.tube(center, StV.add(center, [0, 0, -0.06]), 0.13, 20);
      lamp.tube(StV.add(center, [0, 0, -0.06]), StV.add(center, [0, 0, -0.068]), 0.1, 20);
    }
  }

  /** Кабельный лоток вдоль задней стены под потолком */
  tray() {
    const scene = this.outfit.scene;
    const [len, wid, height] = this.outfit.plan.int;
    const x0 = scene.geo.x0 || 0;
    if (this.outfit.sys.power === false || !this.outfit.inside) return;
    const tray = scene.meshFor(StMat.metal(StScene.GALV, 0.45));
    tray.box(scene.point(x0 + 150, wid - 220, height - 260), scene.point(len - 150, wid - 20, height - 210), 0.003);
    for (let x = x0 + 600; x < len - 300; x += 1500)
      tray.box(scene.point(x, wid - 240, height - 280), scene.point(x + 30, wid, height - 260));
  }

  /** Конвекторы на местах из расчёта: решётка сверху, терморегулятор, кронштейны. */
  heaters() {
    const scene = this.outfit.scene;
    const heat = this.outfit.plan.heat;
    if (!heat || !heat.heaters || !this.outfit.inside) return;
    const cover = scene.meshFor(StMat.paint('#f4f5f6', 0.35));
    const gray = scene.meshFor(StMat.paint('#aab0b6', 0.5));
    const dark = scene.meshFor(StMat.paint('#2b3036', 0.5));
    const depth = StationHeat.CONV.d;
    for (const heater of heat.heaters) {
      if (!this.outfit.shown(heater.wall)) continue;
      const along = heater.wall === 'front' || heater.wall === 'back';
      const u0 = along ? heater.x : heater.y;
      const du = along ? heater.lx : heater.ly;
      const midU = u0 + du / 2;
      const midZ = heater.z + heater.h / 2;
      this.outfit.log.push({ kind: 'heater', wall: heater.wall, u0, u1: u0 + du });
      this.outfit.box(cover, heater.wall, [midU, midZ], [du, heater.h, depth], 0.012);
      for (let k = 0; k < 5; k++)
        this.outfit.box(dark, heater.wall, [midU, heater.z + heater.h - 45 - k * 24], [du - 70, 9, depth + 2], 0); // решётка тёплого воздуха
      this.outfit.box(gray, heater.wall, [u0 + du - 55, heater.z + heater.h - 110], [34, 34, depth + 14], 0.008); // терморегулятор
      for (const u of [u0 + 90, u0 + du - 90])
        this.outfit.box(dark, heater.wall, [u, heater.z + heater.h + 18], [40, 36, 24], 0);
    }
  }

  /** Сервисные розетки на высоте K.z: ЯТП-0,25 и 230 В — у входа, 230 В — вдоль помещения, 380 В — у основного оборудования. */
  sockets() {
    const { scene: scene, plan: plan } = this.outfit;
    const sockets = plan.sockets;
    if (!sockets || !this.outfit.inside) return;
    const [len, wid] = plan.int;
    const x0 = scene.geo.x0 || 0;
    const walls = ['back', 'right', 'left', 'front'];
    const z = sockets.z;
    const door = OutfitInside.door(plan, x0, wid);
    const paint = (color, rough) => scene.meshFor(StMat.paint(color, rough));
    const meshes = {
      gr: paint('#d9dcdf', 0.45),
      lid: paint('#c3c7cb', 0.4),
      red: paint('#c8352c', 0.4),
      dk: paint('#2a2e33', 0.5),
      yl: paint('#f2c230', 0.45),
    };
    const put = (spot, kind) => spot && this.socket(meshes, spot.w, spot.u, kind, z);
    put(this.outfit.near(walls, [[260, z - 140, z + 220]], door, 1500), 'ytp');
    put(this.outfit.near(walls, [[140, z - 50, z + 50]], door, 1500), '230');
    for (let k = 1; k < sockets.n230; k++)
      put(this.outfit.near(walls, [[140, z - 50, z + 50]], [x0 + ((len - x0) * (k + 0.5)) / sockets.n230, wid]), '230');
    put(this.outfit.near(walls, [[160, z - 115, z + 35]], OutfitInside.mainAt(plan, len, wid)), '380');
  }

  /** Выход: дверь оператора в стене прохода или в торце; нет — середина торца у входа. */
  static door(plan, x0, wid) {
    const exit = (plan.fire || {}).exit;
    if (!exit) return [x0, wid / 2];
    return exit.wall === 'front' ? [exit.u, 0] : [x0, exit.u];
  }

  /** Основное оборудование (ДГУ, самый мощный компрессор): точка у его лицевой стороны. */
  static mainAt(plan, len, wid) {
    const floor = plan.items.filter(i => !i.tank && (i.mount === 'floor' || i.mount === 'frame'));
    const comp = floor.filter(i => i.kind === 'compressor').sort((left, right) => (right.kw || 0) - (left.kw || 0))[0];
    const big = floor.find(i => i.kind === 'dgu') || comp || floor[0];
    if (!big) return [len, wid / 2];
    return [big.x + big.lx / 2, big.y + big.ly / 2 > wid / 2 ? big.y : big.y + big.ly];
  }

  /** Розетка 230 В (крышка), 380 В (красная с вилкой) или ящик ЯТП-0,25 со знаком W08. */
  socket(meshes, wall, u, kind, z) {
    if (wall === 'front' && this.outfit.scene.cut) return;
    this.outfit.log.push({ kind: 'socket', type: kind, wall, u });
    if (kind === '230') {
      this.outfit.box(meshes.gr, wall, [u, z], [85, 85, 45], 0.008);
      this.outfit.box(meshes.lid, wall, [u, z + 4], [66, 62, 52], 0.006);
    } else if (kind === '380') {
      this.plug(meshes, wall, u, z - 40);
    } else {
      this.outfit.box(meshes.gr, wall, [u, z + 40], [230, 330, 190], 0.01);
      this.outfit.box(meshes.yl, wall, [u + 60, z - 60], [60, 60, 196], 0.006);
      this.outfit.sign({ type: 'sign', id: 'W08' }, wall, [u - 40, z + 120], [70, 61], [191, 0]);
    }
  }

  /** Вилка в розетке с кабелем. */
  plug({ red, dk: dark }, wall, u, midZ) {
    this.outfit.box(red, wall, [u, midZ], [110, 140, 70], 0.01);
    const start = this.outfit.wallPoint(wall, u, midZ - 30, 70);
    const end = this.outfit.wallPoint(wall, u, midZ - 85, 115);
    red.tube(start, end, 0.032, 16);
    dark.tube(end, StV.add(end, StV.mul(StV.norm(StV.sub(end, start)), 0.01)), 0.026, 14);
  }

  /** Воздуховод от радиатора ДГУ к жалюзи — гибкая вставка из ткани с рамками */
  duct(item) {
    const scene = this.outfit.scene;
    const [len, wid] = this.outfit.plan.int;
    const x0 = scene.geo.x0 || 0;
    const rad = item.rad || 'right';
    if (!this.outfit.inside) return;
    const cloth = scene.meshFor(StMat.paint('#3b4046', 0.85));
    const flange = scene.meshFor(StMat.metal('#8f969d', 0.45));
    const lowZ = item.h * 0.1;
    const topZ = item.h * 0.96;
    if (rad === 'back') {
      const y1 = item.y + item.ly;
      if (wid - y1 < 30) return; // поперёк: радиатор к задней стене
      cloth.box(scene.point(item.x + 60, y1, lowZ), scene.point(item.x + item.lx - 60, wid, topZ), 0.02);
      for (const y of [y1, wid - 40])
        flange.box(
          scene.point(item.x + 50, y, item.h * 0.09),
          scene.point(item.x + item.lx - 50, y + 40, item.h * 0.97),
          0.006,
        );
      return;
    }
    const [from, till] = rad === 'left' ? [x0, item.x] : [item.x + item.lx, len];
    if (till - from < 30) return;
    cloth.box(scene.point(from, item.y + 60, lowZ), scene.point(till, item.y + item.ly - 60, topZ), 0.02);
    for (const x of [from, till - 40])
      flange.box(
        scene.point(x, item.y + 50, item.h * 0.09),
        scene.point(x + 40, item.y + item.ly - 50, item.h * 0.97),
        0.006,
      );
  }
}
