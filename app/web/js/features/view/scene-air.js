import { RalColor } from '../layout/ral-color.js';
import { StationLayout } from '../layout/station-layout.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Оборудование сжатого воздуха. */
export class SceneAir {
  constructor(scene) {
    this.scene = scene;
  }

  /** Изделие на сцене. */
  equip(item) {
    if (item.mount === 'wall' && item.wall === 'front' && this.scene.cut) return; // на стене со стороны зрителя
    this.body(item);
    this.scene.badge(item);
  }

  /** Корпус изделия по его виду. */
  body(item) {
    const k = item.kind;
    if (k === 'cabinet') return this.scene.units.cabinet(item);
    if (item.mount === 'pipe') return this.filter(item);
    if (k === 'receiver') return item.shape === 'hcyl' ? this.receiverH(item) : this.receiver(item);
    if (k === 'compressor') return this.compressor(item);
    if (k === 'dryer') return StationLayout.twinDryer(item) ? this.dryerAds(item) : this.dryer(item);
    if (k === 'pump') return this.scene.units.pump(item);
    if (k === 'dgu') return this.scene.units.dgu(item);
    if (k === 'tank') return this.scene.units.tank(item);
    if (k === 'filter') return this.receiver(item);
    return this.scene.units.other(item);
  }

  /** Решётка: горизонтальные ламели на лицевой стороне или торце (end: −1 — торец x0, 1 — x1). */
  grille(item, [u0, u1], [v0, v1], count, end) {
    const mesh = this.scene.meshFor(StMat.paint('#24292e', 0.7));
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    for (let i = 0; i < count; i++) {
      const v = v0 + ((v1 - v0) * (i + 0.25)) / count;
      const barV = v0 + ((v1 - v0) * (i + 0.7)) / count;
      if (end) {
        const x = end < 0 ? x0 : x1;
        const off = end * 0.006;
        mesh.box([x, y0 + (y1 - y0) * u0, z0 + (z1 - z0) * v], [x + off, y0 + (y1 - y0) * u1, z0 + (z1 - z0) * barV]);
      } else this.scene.panel(mesh, item, [u0, u1], [v, barV], [0.006, 0]);
    }
  }

  /** Компрессор. */
  compressor(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const body = this.scene.meshFor(StMat.paint(color, 0.42));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.65));
    const baseH = Math.min(0.1, (z1 - z0) * 0.07);
    dark.box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + baseH], 0.005);
    for (const u of [0.18, 0.72])
      this.scene.panel(this.scene.meshFor(StMat.paint('#15181b', 0.8)), item, [u, u + 0.1], [0.012, 0.055], [0.001, 0]); // карманы под вилы
    body.box([x0, y0, z0 + baseH], [x1, y1, z1], 0.018);
    this.scene.tones(item, [x0, y0, z0 + baseH], [x1, y1, z1], 0.018);
    const seam = this.scene.meshFor(StMat.paint(RalColor.shade(color, 0.7), 0.6)); // швы панелей, ручки
    for (const u of [0.34, 0.67]) this.scene.panel(seam, item, [u - 0.002, u + 0.002], [0.08, 0.97], [0.002, 0]);
    for (const u of [0.31, 0.64]) this.scene.panel(dark, item, [u - 0.012, u - 0.004], [0.5, 0.62], [0.012, 0.002]);
    // пульт: экран, кнопка аварийной остановки
    this.scene.panel(this.scene.meshFor(StMat.paint('#30363d', 0.4)), item, [0.72, 0.95], [0.66, 0.9], [0.012, 0.004]);
    this.scene.panel(this.scene.meshFor(StMat.glow('#8fc7ff', 1.6)), item, [0.75, 0.87], [0.73, 0.85], [0.014, 0]);
    const eStop = this.scene.front(item, 0.91, 0.72, 0.012);
    this.scene
      .meshFor(StMat.paint('#c0262d', 0.35))
      .tube(eStop, StV.add(eStop, [0, this.scene.side(item) * 0.025, 0]), 0.02, 14);
    this.grille(item, [0.38, 0.62], [0.15, 0.6], 8);
    this.grille(item, [0.2, 0.8], [0.2, 0.75], 9, -1);
    this.grille(item, [0.2, 0.8], [0.2, 0.75], 9, 1);
    this.duct(item, dark);
  }

  /** Жалюзи компрессора по стенам, сведённые по стене: участок стены под коробом. */
  louvers(item) {
    const vent = this.scene.plan.vent;
    const key = StationLayout.key(item);
    const target = vent && vent.ducts ? vent.ducts[key] : null;
    const list = target === 'wall' ? vent.louvers.filter(louver => louver.duct === key) : [];
    const grp = [...new Set(list.map(louver => louver.wall))].map(wall => {
      const same = list.filter(louver => louver.wall === wall);
      return {
        wall,
        u0: Math.min(...same.map(louver => louver.u0)),
        u1: Math.max(...same.map(louver => louver.u1)),
        z0: Math.min(...same.map(louver => louver.z0)),
        z1: Math.max(...same.map(louver => louver.z1)),
      };
    });
    return { to: target, grp };
  }

  /** Выход горячего воздуха вверху. */
  duct(item, dark) {
    const [x0, y0, , x1, y1, z1] = this.scene.extent(item);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const ductW = Math.min((x1 - x0) * 0.45, 0.9);
    const ductD = Math.min((y1 - y0) * 0.45, 0.65);
    const ductH = Math.min(0.38, this.scene.ceil - 0.09 - z1 - 0.06);
    dark.box([midX - ductW / 2, midY - ductD / 2, z1], [midX + ductW / 2, midY + ductD / 2, z1 + 0.006]);
    const { to: target, grp } = this.louvers(item);
    if (ductH < 0.18 || !target) return;
    const galv = this.scene.meshFor(StMat.metal(StScene.GALV, 0.42));
    const topZ = this.scene.ceil - 0.09;
    const ductZ = topZ - ductH;
    const lowest = grp.length ? Math.min(ductZ, ...grp.map(group => this.scene.base + group.z0 / 1000 + 0.05)) : null;
    const riseZ = z1 + Math.min(0.5, Math.max(0.12, ((lowest ?? ductZ) - z1) * 0.45));
    galv.box(
      [midX - ductW / 2, midY - ductD / 2, z1],
      [midX + ductW / 2, midY + ductD / 2, grp.length ? ductZ : this.scene.ceil],
      0.004,
    );
    const duct = { c: [midX, midY], s: [ductW, ductD], z: [ductZ, topZ] };
    for (const group of grp) {
      if (group.wall === 'left' || group.wall === 'right') this.toEnd(galv, group, duct);
      else this.toSide(galv, group, duct);
    }
    if ((this.scene.plan.sys || {}).rec !== false) this.recirc(item, [midX, midY], [ductW, ductD], riseZ);
  }

  /** Короб к жалюзи в торце: по потолку к торцу, вдоль торца, у жалюзи. */
  toEnd(galv, group, { c: [midX, midY], s: [ductW, ductD], z: [ductZ, topZ] }) {
    const lowZ = this.scene.base + group.z0 / 1000;
    const highZ = this.scene.base + group.z1 / 1000;
    const isRight = group.wall === 'right';
    const wallX = isRight ? this.scene.ox + this.scene.Li : this.scene.ox + (this.scene.geo.x0 || 0) / 1000;
    const from = this.scene.oy + group.u0 / 1000;
    const till = this.scene.oy + group.u1 / 1000;
    galv.box(
      [Math.min(midX - ductW / 2, wallX), midY - ductD / 2, ductZ],
      [Math.max(midX + ductW / 2, wallX), midY + ductD / 2, topZ],
      0.004,
    );
    galv.box(
      [isRight ? wallX - ductW : wallX, Math.min(midY - ductD / 2, from), ductZ],
      [isRight ? wallX : wallX + ductW, Math.max(midY + ductD / 2, till), topZ],
      0.004,
    );
    galv.box([isRight ? wallX - 0.2 : wallX, from, lowZ], [isRight ? wallX : wallX + 0.2, till, highZ], 0.004);
  }

  /** Короб к жалюзи в длинной стене: по потолку к стене, вдоль стены, у жалюзи. */
  toSide(galv, group, { c: [midX, midY], s: [ductW, ductD], z: [ductZ, topZ] }) {
    const lowZ = this.scene.base + group.z0 / 1000;
    const highZ = this.scene.base + group.z1 / 1000;
    const isFront = group.wall === 'front';
    const wallY = isFront ? this.scene.oy : this.scene.oy + this.scene.Wi;
    const from = this.scene.ox + group.u0 / 1000;
    const till = this.scene.ox + group.u1 / 1000;
    galv.box(
      [midX - ductW / 2, isFront ? wallY : midY - ductD / 2, ductZ],
      [midX + ductW / 2, isFront ? midY + ductD / 2 : wallY, topZ],
      0.004,
    );
    galv.box(
      [Math.min(midX - ductW / 2, from), isFront ? wallY : wallY - ductD, ductZ],
      [Math.max(midX + ductW / 2, till), isFront ? wallY + ductD : wallY, topZ],
      0.004,
    );
    galv.box([from, isFront ? wallY : wallY - 0.2, lowZ], [till, isFront ? wallY + 0.2 : wallY, highZ], 0.004);
  }

  /** Клапан рециркуляции на воздуховоде компрессора. */
  recirc(item, [midX, midY], [ductW, ductD], z) {
    const galv = this.scene.meshFor(StMat.metal(StScene.GALV, 0.36));
    const dark = this.scene.meshFor(StMat.paint('#23272b', 0.55));
    const act = this.scene.meshFor(StMat.paint('#3a4048', 0.5));
    const height = 0.22;
    const side = this.scene.side(item);
    const faceY = side > 0 ? midY + ductD / 2 : midY - ductD / 2;
    galv.box(
      [midX - ductW / 2 - 0.03, midY - ductD / 2 - 0.03, z],
      [midX + ductW / 2 + 0.03, midY + ductD / 2 + 0.03, z + height],
      0.004,
    );
    for (let k = 0; k < 4; k++) {
      const slotZ = z + 0.04 + k * 0.045;
      dark.box(
        [midX - ductW / 2 + 0.04, faceY + side * 0.03, slotZ],
        [midX + ductW / 2 - 0.04, faceY + side * 0.04, slotZ + 0.018],
      );
    } // решётка
    act.box([midX + ductW / 2 + 0.03, midY - 0.06, z + 0.04], [midX + ductW / 2 + 0.12, midY + 0.06, z + 0.16], 0.006); // электропривод
  }

  /** Осушитель рефрижераторный. */
  dryer(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const body = this.scene.meshFor(StMat.paint(color, 0.4));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.6));
    dark.box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + 0.05], 0.004);
    body.box([x0, y0, z0 + 0.05], [x1, y1, z1], 0.016);
    this.scene.tones(item, [x0, y0, z0 + 0.05], [x1, y1, z1], 0.016);
    this.scene.panel(this.scene.meshFor(StMat.paint('#2c3238', 0.4)), item, [0.1, 0.42], [0.72, 0.9], [0.01, 0.004]);
    this.scene.panel(this.scene.meshFor(StMat.glow('#9fe0a6', 1.2)), item, [0.13, 0.25], [0.77, 0.85], [0.012, 0]);
    this.grille(item, [0.1, 0.9], [0.12, 0.5], 7);
    this.grille(item, [0.15, 0.85], [0.2, 0.7], 7, 1);
    const galv = this.scene.meshFor(StMat.metal(StScene.GALV, 0.35));
    const side = this.scene.side(item);
    const backY = side < 0 ? y1 - 0.12 : y0 + 0.12;
    for (const u of [0.25, 0.75]) {
      const x = x0 + (x1 - x0) * u;
      galv.tube([x, backY, z1], [x, backY, z1 + 0.08], 0.03, 14);
      galv.tube([x, backY, z1 + 0.06], [x, backY, z1 + 0.08], 0.055, 16);
    }
  }

  /** Осушитель адсорбционный (две колонны). */
  dryerAds(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const tower = this.scene.meshFor(StMat.paint(color, 0.38));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.6));
    const galv = this.scene.meshFor(StMat.metal(StScene.GALV, 0.35));
    dark.box([x0, y0, z0], [x1, y1, z0 + 0.08], 0.004);
    const radius = Math.min((x1 - x0) / 4.6, (y1 - y0) / 2.3);
    const midY = (y0 + y1) / 2;
    for (const u of [0.27, 0.73]) {
      const x = x0 + (x1 - x0) * u;
      tower.tube([x, midY, z0 + 0.15], [x, midY, z1 - radius * 0.5 - 0.12], radius, 28, { caps: [true, false] });
      tower.dish([x, midY, z1 - radius * 0.5 - 0.12], radius, 1);
    }
    galv.box([x0 + (x1 - x0) * 0.2, midY - 0.05, z1 - 0.14], [x0 + (x1 - x0) * 0.8, midY + 0.05, z1 - 0.05], 0.01);
    galv.box([x0 + (x1 - x0) * 0.2, midY - 0.05, z0 + 0.1], [x0 + (x1 - x0) * 0.8, midY + 0.05, z0 + 0.2], 0.01);
    const point = this.scene.front(item, 0.5, 0.55, 0);
    this.scene
      .meshFor(StMat.paint('#d8dcdf', 0.4))
      .box(
        [point[0] - 0.15, point[1], point[2] - 0.2],
        [point[0] + 0.15, point[1] + this.scene.side(item) * 0.15, point[2] + 0.2],
        0.01,
      );
  }

  /** Ресивер вертикальный. */
  receiver(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const mesh = this.scene.meshFor(StMat.paint(color, 0.38));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.6));
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const radius = Math.min(x1 - x0, y1 - y0) / 2;
    const leg = Math.min(0.22, (z1 - z0) * 0.1);
    const bottomZ = z0 + leg + radius * 0.5;
    const topZ = z1 - radius * 0.5;
    for (const angle of [0.5, 2.6, 4.7])
      dark.tube(
        [midX + Math.cos(angle) * radius * 0.7, midY + Math.sin(angle) * radius * 0.7, z0],
        [midX + Math.cos(angle) * radius * 0.7, midY + Math.sin(angle) * radius * 0.7, bottomZ - radius * 0.2],
        0.025,
        10,
      );
    mesh.tube([midX, midY, bottomZ], [midX, midY, topZ], radius, 36, { caps: [false, false] });
    mesh.dish([midX, midY, topZ], radius, 1, 36);
    mesh.dish([midX, midY, bottomZ], radius, -1, 36);
    const side = this.scene.side(item);
    const brass = this.scene.meshFor(StMat.metal('#b8924f', 0.35));
    const galv = this.scene.meshFor(StMat.metal(StScene.GALV, 0.35));
    brass.tube([midX, midY, z1 - 0.02], [midX, midY, z1 + 0.07], 0.02, 12);
    brass.sphere([midX, midY, z1 + 0.09], 0.025, 10); // предохранительный клапан
    galv.tube(
      [midX, midY + side * radius, (bottomZ + topZ) / 2],
      [midX, midY + side * (radius + 0.1), (bottomZ + topZ) / 2],
      0.12,
      20,
    );
    galv.tube(
      [midX, midY + side * (radius + 0.09), (bottomZ + topZ) / 2],
      [midX, midY + side * (radius + 0.11), (bottomZ + topZ) / 2],
      0.15,
      20,
    ); // люк
    const gaugeZ = bottomZ + (topZ - bottomZ) * 0.8;
    const gaugeAt = [midX + radius * 0.7, midY + side * radius * 0.72, gaugeZ];
    dark.tube(gaugeAt, StV.add(gaugeAt, [0, side * 0.03, 0]), 0.05, 18);
    this.scene
      .meshFor(StMat.paint('#f4f4f2', 0.3))
      .tube(StV.add(gaugeAt, [0, side * 0.03, 0]), StV.add(gaugeAt, [0, side * 0.032, 0]), 0.043, 18);
    galv.tube([midX, midY, bottomZ - radius * 0.5], [midX, midY, z0 + 0.03], 0.012, 8);
  }

  /** Ресивер горизонтальный. */
  receiverH(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const mesh = this.scene.meshFor(StMat.paint(item.color, 0.38));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.6));
    const midY = (y0 + y1) / 2;
    const radius = (Math.min(y1 - y0, z1 - z0) / 2) * 0.95;
    const axisZ = z1 - radius;
    for (const u of [0.18, 0.82]) {
      const x = x0 + (x1 - x0) * u;
      dark.box([x - 0.05, midY - radius * 0.7, z0], [x + 0.05, midY + radius * 0.7, axisZ - radius * 0.3], 0.004);
    }
    mesh.tube([x0 + radius * 0.4, midY, axisZ], [x1 - radius * 0.4, midY, axisZ], radius, 36, { caps: [false, false] });
    for (const [x, sign] of [
      [x0 + radius * 0.4, -1],
      [x1 - radius * 0.4, 1],
    ]) {
      const seg = 24;
      const base = mesh.count;
      const rows = 8;
      for (let i = 0; i <= rows; i++) {
        const angle = ((i / rows) * Math.PI) / 2;
        const ringR = radius * Math.cos(angle);
        const ringX = x + sign * radius * 0.4 * Math.sin(angle);
        for (let j = 0; j <= seg; j++) {
          const phi = (j / seg) * Math.PI * 2;
          mesh.vert(
            [ringX, midY + ringR * Math.cos(phi), axisZ + ringR * Math.sin(phi)],
            StV.norm([
              (sign * Math.sin(angle)) / 0.4,
              Math.cos(angle) * Math.cos(phi),
              Math.cos(angle) * Math.sin(phi),
            ]),
          );
        }
      }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < seg; j++) {
          const here = base + i * (seg + 1) + j;
          const below = here + seg + 1;
          mesh.indices.push(here, below, here + 1, here + 1, below, below + 1);
        }
    }
  }

  /** Магистральный фильтр на трубе: головка на оси трубы, колба вниз, дренаж, манометр. */
  filter(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const width = x1 - x0;
    const headH = Math.max(0.05, (z1 - z0) * 0.14);
    const head = this.scene.meshFor(StMat.metal('#b6bcc2', 0.32));
    const bowl = this.scene.meshFor(StMat.paint(item.color, 0.35));
    const dark = this.scene.meshFor(StMat.paint(StScene.DARK, 0.6));
    head.box(
      [midX - width * 0.55, midY - width * 0.45, z1 - headH],
      [midX + width * 0.55, midY + width * 0.45, z1],
      0.006,
    );
    bowl.tube([midX, midY, z1 - headH], [midX, midY, z0 + 0.06], width * 0.4, 24, {
      caps: [false, true],
      r2: width * 0.36,
    });
    this.scene
      .meshFor(StMat.paint('#2f6db3', 0.4))
      .tube([midX, midY, z1 - headH - 0.03], [midX, midY, z1 - headH - 0.07], width * 0.41, 24, {
        caps: [false, false],
      }); // метка ступени очистки
    dark.tube([midX, midY, z0 + 0.06], [midX, midY, z0], 0.012, 10);
    const side = this.scene.side(item);
    const gaugeAt = [midX, midY + side * width * 0.45, z1 - headH / 2];
    dark.tube(gaugeAt, StV.add(gaugeAt, [0, side * 0.02, 0]), Math.min(0.03, headH * 0.4), 14);
  }
}
