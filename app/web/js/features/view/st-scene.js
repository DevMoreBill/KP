import { ScenePipes } from './scene-pipes.js';
import { SceneUnits } from './scene-units.js';
import { SceneAir } from './scene-air.js';
import { SceneRoom } from './scene-room.js';
import { SceneHull } from './scene-hull.js';
import { PipeMaterial } from '../layout/pipe-material.js';
import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StCam } from './st-cam.js';
import { StMat } from './st-mat.js';
import { StMesh } from './st-mesh.js';
import { StOutfit } from './st-outfit.js';
import { StV } from './st-v.js';

export class StScene {
  /** Место логотипа на лицевой стороне: u0, u1, v0, v1 (доли длины и высоты). */
  static BADGE = {
    compressor: [0.04, 0.66, 0.76, 0.95],
    dryer: [0.46, 0.94, 0.72, 0.92],
    other: [0.05, 0.5, 0.78, 0.95],
    receiver: [0.25, 0.75, 0.5, 0.78],
  };

  /** Сцена по расстановке plan (StationLayout.solve); meta — {deck, view: 'in' | 'out', az, brand, logos, makers}. */
  constructor(plan, meta = {}) {
    this.hull = new SceneHull(this);
    this.room = new SceneRoom(this);
    this.air = new SceneAir(this);
    this.units = new SceneUnits(this);
    this.pipes = new ScenePipes(this);
    this.plan = plan;
    this.meta = meta;
    this.groups = new Map();
    this.decals = new Map(); // ключ → описание картинки наклейки
    this.geo = plan.geo;
    this.meters = v => v / 1000;
    this.sizes(plan, meta);
    this.colors(plan);
    this.doorSets(plan, meta);
  }

  /** Размеры контейнера, м. */
  sizes(plan, meta) {
    const geo = plan.geo;
    const meters = this.meters;
    [this.Le, this.We, this.He] = geo.ext.map(meters);
    [this.Li, this.Wi, this.Hi] = plan.int.map(meters);
    this.ox = (this.Le - this.Li) / 2;
    this.oy = (this.We - this.Wi) / 2;
    this.dz = plan.chassis ? meters(meta.deck || 1150) : 0;
    this.base = this.dz + meters(StationGeo.zFloor(geo.type));
    this.ceil = this.base + this.Hi;
    this.top = this.dz + this.He;
    this.rise = geo.sea ? 0 : meters(geo.rise || 0);
  }

  /** Крыша — в цвет каркаса, двери и ворота — стен, если не заданы свои. */
  colors(plan) {
    this.wall = plan.wallColor || '#CBD0CC';
    this.frame = plan.frameColor || RalColor.shade(this.wall, 0.72);
    this.roofColor = plan.roofColor || this.frame;
    this.door = plan.doorColor || this.wall;
    this.lining = plan.geo.sea ? '#e3e6e8' : '#eef0f1';
  }

  /** Сервисные двери (закрыты; дверь оператора и дверь отсека бака — отдельно), двери-жалюзи ДГУ поперёк в задней стене; проёмы стены со стороны зрителя. */
  doorSets(plan, meta) {
    const doors = plan.doors || [];
    this.doorsFront = doors.filter(door => door.wall !== 'back');
    this.doorsBack = doors.filter(door => door.wall === 'back');
    for (const door of (plan.dguDoors || []).filter(door => door.wall === 'back'))
      this.doorsBack.push({ wall: 'back', x0: door.x0, x1: door.x1, w: door.w, h: door.h, leaves: 2, kind: 'dgu' });
    this.view = meta.view === 'out' ? 'out' : 'in';
    this.closed = this.view === 'out';
    this.cut = this.view === 'in';
    this.azimuth = meta.az ?? (this.closed && StScene.farEnd(plan) ? -StCam.AZIMUTH : StCam.AZIMUTH);
    this.frontOpenings = this.openings(plan);
  }

  /** Проёмы лицевой стены. */
  openings(plan) {
    if (this.cut) return [];
    const list = this.doorsFront.map(door => ({
      x0: door.x0,
      x1: door.x1,
      h: door.h,
      leaves: door.leaves,
      kind: door.kind || 'service',
      open: false,
    }));
    if (!this.closed) return list;
    const entry = plan.entry;
    if (entry && entry.wall === 'front')
      list.push({ x0: entry.x0, x1: entry.x1, h: entry.h, leaves: 1, kind: 'entry' });
    const fuelDoor = plan.fuel && plan.fuel.door;
    if (fuelDoor) list.push({ x0: fuelDoor.x0, x1: fuelDoor.x1, h: StationLayout.DOOR.h, leaves: 1, kind: 'tank' });
    return list.sort((left, right) => left.x0 - right.x0);
  }

  /** ДГУ с дверью-жалюзи или ворота для демонтажа в дальнем торце: снаружи — вид спереди справа (на этот торец). */
  static farEnd(plan) {
    return (
      (plan.dguDoors || []).some(door => door.wall === 'right') ||
      [plan.gates, plan.gates2].some(gate => gate && gate.wall === 'right' && !gate.sea)
    );
  }

  /** Наклейка. */
  sticker(decal, center, normal, [width, height], glow = 0) {
    const key = JSON.stringify(decal);
    this.decals.set(key, decal);
    const right = StV.norm(StV.cross(StV.mul(normal, -1), [0, 0, 1]));
    const origin = StV.add(center, StV.mul(normal, 0.002));
    const halfU = StV.mul(right, width / 2);
    const halfV = [0, 0, height / 2];
    this.meshFor(StMat.decal(key, glow)).decal(
      StV.sub(StV.sub(origin, halfU), halfV),
      StV.sub(StV.add(origin, halfU), halfV),
      StV.add(StV.add(origin, halfU), halfV),
      StV.add(StV.sub(origin, halfU), halfV),
      normal,
    );
  }

  /** Пропорция таблички логотипа (ширина / высота): картинка из каталога или название производителя. */
  logoAr(maker) {
    const ratio = (this.meta.logos || {})[maker.toLowerCase()];
    return ratio > 0 ? ratio : Math.max(1.6, Math.min(7, 0.62 * maker.length + 0.5));
  }

  /** Логотип производителя на лицевой стороне — там, где он у изделий этого вида. */
  badge(item) {
    const maker = String(item.maker || (this.meta.makers || {})[item.id] || '').trim();
    if (!maker || item.mount === 'pipe' || item.mount === 'wall') return;
    const ratio = this.logoAr(maker);
    const decal = { type: 'logo', maker, bg: item.color, ar: ratio };
    if (item.kind === 'receiver' && item.shape !== 'hcyl') this.badgeRound(item, decal);
    else if (item.kind === 'dgu') this.badgeDgu(item, decal);
    else this.badgeFront(item, decal);
  }

  /** Табличка ar (ширина / высота), вписанная в mw × mh. */
  static fit(ratio, maxW, maxH) {
    const width = Math.min(maxW, maxH * ratio);
    return [width, width / ratio];
  }

  /** На корпусе вертикального ресивера — по дуге. */
  badgeRound(item, decal) {
    const [x0, y0, z0, x1, y1, z1] = this.extent(item);
    const side = this.side(item);
    const radius = Math.min(x1 - x0, y1 - y0) / 2;
    const [width, height] = StScene.fit(decal.ar, radius * 1.6, 0.16);
    const half = (side < 0 ? -width : width) / 2 / radius;
    const mid = (side < 0 ? -Math.PI : Math.PI) / 2;
    const z = z0 + (z1 - z0) * 0.62;
    const key = JSON.stringify(decal);
    this.decals.set(key, decal);
    this.meshFor(StMat.decal(key)).decalArc(
      [(x0 + x1) / 2, (y0 + y1) / 2, radius + 0.003],
      [mid + half, mid - half],
      [z - height / 2, z + height / 2],
    );
  }

  /** На радиаторе ДГУ. */
  badgeDgu(item, decal) {
    const [x0, y0, z0, x1, y1, z1] = this.extent(item);
    const side = this.side(item);
    const height = z1 - z0;
    const radX = x0 + (x1 - x0) * 0.84;
    const [width, plateH] = StScene.fit(decal.ar, (x1 - radX) * 0.92, height * 0.16);
    const y = side < 0 ? y0 + (y1 - y0) * 0.04 : y1 - (y1 - y0) * 0.04;
    this.sticker(decal, [(radX + x1) / 2, y, z0 + height * 0.8], [0, side, 0], [width, plateH]);
  }

  /** На лицевой стороне — крупно, для узнаваемости, на цвете своей части корпуса. */
  badgeFront(item, decal) {
    const place = StScene.BADGE[item.kind];
    if (!place || (item.kind === 'dryer' && StationLayout.twinDryer(item))) return;
    const [x0, y0, z0, x1, y1, z1] = this.extent(item);
    decal.bg = this.toneAt(item, (place[0] + place[1]) / 2, (place[2] + place[3]) / 2);
    const span = this.endwise(item) ? y1 - y0 : x1 - x0;
    const [width, height] = StScene.fit(decal.ar, (place[1] - place[0]) * span, (place[3] - place[2]) * (z1 - z0));
    this.sticker(
      decal,
      this.front(item, (place[0] + place[1]) / 2, (place[2] + place[3]) / 2, 0.001),
      this.out(item, 1),
      [width, height],
    );
  }

  /** Геометрия материала m. */
  meshFor(mat) {
    const k = StMat.key(mat);
    let group = this.groups.get(k);
    if (!group) {
      group = { mat, mesh: new StMesh() };
      this.groups.set(k, group);
    }
    return group.mesh;
  }

  /** Точка внутри контейнера (мм от внутренних стен и пола) → мир, м. */
  point(x, y, z) {
    return [this.ox + x / 1000, this.oy + y / 1000, this.base + z / 1000];
  }

  /** Построить сцену. */
  build() {
    this.ground();
    if (this.dz) this.hull.chassis();
    this.hull.container();
    this.outfit = new StOutfit(this).build();
    if (this.view === 'in') {
      for (const item of this.plan.items) this.air.equip(item);
      for (const piping of this.plan.piping || []) this.pipes.piping(piping);
    } // снаружи внутреннего не видно
    for (const muffler of this.plan.roof || []) this.pipes.muffler(muffler);
    if ((this.plan.outside || []).length) this.outside();
    return this;
  }

  /** Ресиверы снаружи. */
  outside() {
    const outside = this.plan.outside;
    const pad = this.meshFor(StMat.paint('#b9b6ae', 0.95));
    const padH = this.meters(StationLayout.PAD);
    for (const item of outside) {
      const [x0, y0, z0, x1, y1] = this.extent(item);
      pad.box([x0 - 0.2, y0 - 0.2, z0 - padH], [x1 + 0.2, y1 + 0.2, z0], 0.01);
      this.air.equip(item);
    }
    const piping = (this.plan.piping || [])[0];
    const line =
      piping && piping.lines.find(cand => cand.medium === 'air' && !cand.header && cand.x1 >= this.plan.int[0] - 1);
    if (line) this.outPipe(outside, piping, line);
  }

  /** Вход трубы в ресивер: у высокого вертикального — внизу сбоку, иначе посередине. */
  inletZ(item) {
    const [, , z0, , , z1] = this.extent(item);
    return item.shape === 'vcyl' && item.h >= 900 ? z0 + Math.max(0.25, this.meters(item.h) * 0.22) : (z0 + z1) / 2;
  }

  /** Труба к ресиверам снаружи. */
  outPipe(outside, piping, line) {
    const air = { c: PipeMaterial.idColor('air', piping.color), r: 0.38, m: 0.35 };
    const mesh = this.meshFor(piping.mat === 'inox' ? StMat.metal(StMat.INOX, 0.22) : air);
    const red = this.meshFor(StMat.paint('#c83a2e', 0.4));
    const bore = +(String(piping.dn || '').match(/\d+/) || [0])[0];
    const radius = Math.max(0.012, Math.min(0.08, (bore || 50) / 2000 + 0.006));
    const origin = this.point(line.x1, line.y, line.z);
    const midX = (this.Le + 0.07 + Math.min(...outside.map(i => this.extent(i)[0]))) / 2;
    const run = (...points) => {
      for (let k = 1; k < points.length; k++) {
        mesh.tube(points[k - 1], points[k], radius, 18);
        mesh.sphere(points[k], radius * 1.03, 12);
      }
    };
    run([this.Le + 0.07, origin[1], origin[2]], [midX, origin[1], origin[2]]);
    mesh.sphere([midX, origin[1], origin[2]], radius * 1.03, 12);
    red.box(
      [this.Le + 0.25, origin[1] - 0.012, origin[2] + radius * 1.3],
      [this.Le + 0.38, origin[1] + 0.012, origin[2] + radius * 1.3 + 0.018],
      0.004,
    );
    for (const item of outside) {
      const [ix0, iy0, , , iy1] = this.extent(item);
      const y = (iy0 + iy1) / 2;
      const z = this.inletZ(item);
      run([midX, origin[1], origin[2]], [midX, y, origin[2]], [midX, y, z], [ix0, y, z]);
      mesh.tube([ix0 - 0.02, y, z], [ix0 + 0.01, y, z], radius * 1.6, 18);
    }
    const far = outside.reduce((best, other) => (other.x + other.lx > best.x + best.lx ? other : best));
    const [fx0, fy0, , fx1, fy1, fz1] = this.extent(far);
    const midX2 = (fx0 + fx1) / 2;
    const midY = (fy0 + fy1) / 2;
    run([midX2, midY, fz1 + 0.09], [midX2, midY, fz1 + 0.25], [fx1 + 0.4, midY, fz1 + 0.25]);
    mesh.tube([fx1 + 0.38, midY, fz1 + 0.25], [fx1 + 0.42, midY, fz1 + 0.25], radius * 1.7, 20);
  }

  /** Габариты сцены (м): контейнер, глушитель, ресиверы снаружи. */
  bounds() {
    const roof = this.plan.roof || [];
    const above = roof.reduce((acc, muffler) => Math.max(acc, (muffler.gap + muffler.d) / 1000 + 0.05), 0);
    const boxes = (this.plan.outside || []).map(i => this.extent(i));
    const maxX = Math.max(
      this.Le,
      ...boxes.map(box => box[3] + 0.45),
      ...roof.map(muffler => this.ox + (muffler.x + muffler.lx + muffler.outlet) / 1000 + 0.03),
    );
    const minY = Math.min(0, ...boxes.map(box => box[1] - 0.2));
    const maxY = Math.max(this.We, ...boxes.map(box => box[4] + 0.2));
    const maxZ = Math.max(0, ...boxes.map(box => box[5] + 0.3));
    return {
      lo: [-0.15, Math.min(minY, -0.15), 0],
      hi: [maxX + 0.15, Math.max(maxY, this.We + 0.15), Math.max(maxZ, this.top + this.rise + above + 0.05)],
    };
  }

  /** Число треугольников (проверка и замер). */
  tris() {
    let count = 0;
    for (const group of this.groups.values()) count += group.mesh.indices.length / 3;
    return count;
  }

  /** Земля под контейнером. */
  ground() {
    const mesh = this.meshFor({ c: '#e7e8ea', r: 0.9, m: 0, k: 2 });
    const half = Math.max(this.Le, this.We) * 3;
    mesh.quad(
      [this.Le / 2 - half, this.We / 2 - half, 0],
      [this.Le / 2 + half, this.We / 2 - half, 0],
      [this.Le / 2 + half, this.We / 2 + half, 0],
      [this.Le / 2 - half, this.We / 2 + half, 0],
      [0, 0, 1],
    );
  }

  /** Высота крыши над поперечной координатой y (м). */
  roofZ(y) {
    const rise = this.rise;
    const wid = this.We;
    const across = Math.max(0, Math.min(wid, y));
    if (!(rise > 0)) return this.top;
    if (this.geo.roof === 'arch') {
      const radius = this.hull.arcR();
      return (
        this.top + rise - radius + Math.sqrt(Math.max(0, radius * radius - (across - wid / 2) * (across - wid / 2)))
      );
    }
    return (
      this.top +
      (this.geo.roof === 'gable' ? rise * (1 - Math.abs(across - wid / 2) / (wid / 2)) : rise * (1 - across / wid))
    );
  }

  /** Жалюзи в стене: along 1 — в торце (x = w), 0 — в длинной стене (y = w); out — наружу (±1). */
  louver(along, plane, [u0, u1], [z0, z1], out) {
    const frame = this.meshFor(StMat.paint('#8f969d', 0.5));
    const slats = this.meshFor(StMat.paint('#5d646b', 0.55));
    const count = Math.max(3, Math.round((z1 - z0) / 0.07));
    const toWorld = (u, off, z) => (along === 1 ? [plane + out * off, u, z] : [u, plane + out * off, z]);
    frame.box(toWorld(u0 - 0.04, 0, z0 - 0.04), toWorld(u1 + 0.04, 0.03, z0));
    frame.box(toWorld(u0 - 0.04, 0, z1), toWorld(u1 + 0.04, 0.03, z1 + 0.04));
    frame.box(toWorld(u0 - 0.04, 0, z0), toWorld(u0, 0.03, z1));
    frame.box(toWorld(u1, 0, z0), toWorld(u1 + 0.04, 0.03, z1));
    for (let i = 0; i < count; i++) {
      const z = z0 + ((z1 - z0) * (i + 0.5)) / count;
      slats.quad(
        toWorld(u0, 0.035, z + 0.018),
        toWorld(u1, 0.035, z + 0.018),
        toWorld(u1, 0.005, z - 0.018),
        toWorld(u0, 0.005, z - 0.018),
      );
    }
  }

  /** Габарит в мире: [x0, y0, z0, x1, y1, z1] и сторона обслуживания (−1 — к стене прохода, 1 — к задней). */
  extent(item) {
    const low = this.point(item.x, item.y, item.z || 0);
    const high = this.point(item.x + item.lx, item.y + item.ly, (item.z || 0) + item.h);
    return [...low, ...high];
  }

  /** Сторона обслуживания: −1 к проходу, 1 к задней. */
  side(item) {
    return item.face > 0 ? 1 : -1;
  }

  /** Лицевая сторона вдоль торца (шкаф на торцевой стене: face ±2). */
  endwise(item) {
    return Math.abs(item.face) === 2;
  }

  /** Наружу от лицевой стороны на k, м. */
  out(item, k) {
    const shift = this.side(item) * k;
    return this.endwise(item) ? [shift, 0, 0] : [0, shift, 0];
  }

  /** Точка на лицевой стороне: u — доля длины, v — доля высоты, o — выступ наружу, м. */
  front(item, u, v, off = 0) {
    const [x0, y0, z0, x1, y1, z1] = this.extent(item);
    const side = this.side(item);
    return this.endwise(item)
      ? [(side < 0 ? x0 : x1) + side * off, y0 + (y1 - y0) * u, z0 + (z1 - z0) * v]
      : [x0 + (x1 - x0) * u, (side < 0 ? y0 : y1) + side * off, z0 + (z1 - z0) * v];
  }

  /** Прямоугольник на лицевой стороне: u0…u1, v0…v1, толщина o (наружу). */
  panel(mesh, item, [u0, u1], [v0, v1], [off, round = 0.003]) {
    const low = this.front(item, u0, v0, 0);
    const high = this.front(item, u1, v1, off);
    mesh.box([low[0], low[1], low[2]], [high[0], high[1], high[2]], round);
  }

  /** Доля u на лицевой стороне по фото. */
  faceU(item, u) {
    return (this.endwise(item) ? this.side(item) < 0 : this.side(item) > 0) ? 1 - u : u;
  }

  /** Окраска частей по фото (it.tones — зоны других цветов, как в карточке товара). */
  tones(item, [x0, y0, fromZ], [x1, y1, z1], round) {
    const tones = item.tones;
    if (!tones || !tones.length) return;
    const [, , lowZ, , , topZ] = this.extent(item);
    const eps = 0.0015;
    const baseV = (fromZ - lowZ) / (topZ - lowZ || 1);
    for (const tone of tones) {
      const mesh = this.meshFor(StMat.paint(tone.hex, 0.42));
      const v0 = Math.max(baseV, tone.v0);
      const v1 = tone.v1;
      if (v1 - v0 < 0.02) continue;
      if (tone.u0 <= 0.001 && tone.u1 >= 0.999) {
        const zoneLow = lowZ + (topZ - lowZ) * v0;
        const zoneTop = lowZ + (topZ - lowZ) * v1;
        const top = v1 >= 0.999;
        mesh.box(
          [x0 - eps, y0 - eps, zoneLow],
          [x1 + eps, y1 + eps, top ? z1 + eps : zoneTop],
          top ? round : Math.min(round, 0.004),
        );
        continue;
      }
      const from = this.faceU(item, tone.u0);
      const till = this.faceU(item, tone.u1);
      this.panel(mesh, item, [Math.min(from, till), Math.max(from, till)], [v0, v1], [eps, 0]);
    }
  }

  /** Цвет изделия в точке лицевой стороны (u, v): зона по фото или главный. */
  toneAt(item, u, v) {
    const tone = (item.tones || []).find(tone => {
      const from = this.faceU(item, tone.u0),
        till = this.faceU(item, tone.u1);
      return u >= Math.min(from, till) && u <= Math.max(from, till) && v >= tone.v0 && v <= tone.v1;
    });
    return tone ? tone.hex : item.color;
  }
}
