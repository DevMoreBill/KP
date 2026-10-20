import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { RalColor } from '../layout/ral-color.js';

const POW = [
  ['POW_NO', 0.06],
  ['AUTO_OFF', -0.14],
];

/**
 * Двери снаружи: над каждой — съёмный козырёк (водостоков нет), под ним — светодиодный прожектор; на входной двери —
 * табличка категории помещения (кроме Д; ППР в РФ, п. 12), знаки W08 и P06, при пожаротушении рядом — табло «Порошок! Не
 * входи!» и «Автоматика отключена»; на двери отсека бака — табличка категории, W01 и P02. Места снаружи занимаются.
 */
export class OutfitDoors {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /** Двери, ворота и знаки у них. */
  doors() {
    const { scene: scene, plan: plan } = this.outfit;
    const fire = plan.fire || {};
    const rooms = OutfitDoors.rooms(fire);
    for (const gate of [plan.gates, plan.gates2].filter(cand => cand && !cand.sea)) this.gate(gate);
    if (plan.entry && plan.entry.wall === 'left') this.endEntry(plan.entry, rooms.main, fire);
    if (plan.fuel && plan.fuel.gate) this.tankGate(plan.fuel.gate, rooms.tank);
    if (plan.exit) this.endExit(plan.exit);
    for (const door of scene.doorsBack) this.outfit.outer('back', door.x0 - 170, door.x1 + 170, 0, door.h + 620);
    if (!scene.closed) {
      for (const opening of scene.frontOpenings)
        this.outfit.outer('front', opening.x0 - 60, opening.x1 + 60, 0, opening.h + 620);
      return;
    }
    for (const opening of scene.frontOpenings) this.front(opening, rooms, fire);
  }

  /** Помещения по пожарной категории: основное и отсек бака. */
  static rooms(fire) {
    const rooms = fire.rooms || [];
    return { main: rooms[0], tank: rooms.find(room => room.id === 'tank') };
  }

  /** Табличка категории помещения по пожарной опасности (кроме категории Д). */
  static cat(room) {
    return room && room.cat && room.cat !== 'Д'
      ? { type: 'sign', id: 'CAT', cat: room.cat, zone: room.zone || '' }
      : null;
  }

  /** Монтажные ворота в торце: козырёк над ними. */
  gate(gate) {
    const scene = this.outfit.scene;
    const x = gate.wall === 'left' ? this.outfit.leftX() : this.outfit.rightX();
    this.canopy(
      [x, scene.oy + (gate.y0 + gate.y1) / 2000, scene.base + gate.h / 1000],
      [gate.wall === 'left' ? -1 : 1, 0, 0],
      (gate.y1 - gate.y0) / 1000 + 0.24,
    );
    this.outfit.outer(gate.wall, gate.y0 - 100, gate.y1 + 100, 0, gate.h + 620);
  }

  /** Дверь оператора в торце: козырёк, прожектор; таблички и знаки — на полотне (у морского — на его дверях). */
  endEntry(entry, main, fire) {
    const scene = this.outfit.scene;
    const x = this.outfit.leftX();
    const normal = [-1, 0, 0];
    const midY = scene.oy + (entry.y0 + entry.y1) / 2000;
    const topZ = scene.base + entry.h / 1000;
    this.outfit.outer('left', entry.y0 - 100, entry.y1 + 100, 0, entry.h + 620);
    if (!entry.sea) {
      this.canopy([x, midY, topZ], normal, entry.w / 1000 + 0.24);
      if (this.room(topZ)) this.flood([x, midY, topZ + 0.17], normal);
    }
    this.endSigns(entry, main, [x, midY]);
    if (fire.auto && !entry.sea && topZ + 0.2 < scene.top - 0.04) this.endBoards(entry, x, topZ);
  }

  /** Табличка категории и знаки W08, P06 на двери в торце (у морского — на его дверях, выше и в столбик). */
  endSigns(entry, main, [x, midY]) {
    const scene = this.outfit.scene;
    const normal = [-1, 0, 0];
    const sea = !!entry.sea;
    const signZ = scene.base + (sea ? 1.62 : 1.38);
    const dy = sea ? 0.3 : 0.12;
    const category = OutfitDoors.cat(main);
    const spots = sea
      ? { cat: [midY + 0.3, signZ + 0.06], w08: signZ + 0.06, p06: [midY - dy, signZ - 0.19] }
      : { cat: [midY, scene.base + 1.72], w08: signZ, p06: [midY + dy, signZ] };
    if (category) scene.sticker(category, [x - 0.004, ...spots.cat], normal, [0.3, 0.2]);
    scene.sticker({ type: 'sign', id: 'W08' }, [x - 0.004, midY - dy, spots.w08], normal, [0.2, 0.175]);
    scene.sticker({ type: 'sign', id: 'P06' }, [x - 0.004, ...spots.p06], normal, [0.2, 0.2]);
  }

  /** Табло у двери в торце: справа от неё, у края — слева. */
  endBoards(entry, x, topZ) {
    const scene = this.outfit.scene;
    const wid = scene.Wi * 1000;
    const board = scene.meshFor(StMat.paint('#eceeef', 0.4));
    const right = entry.y1 + 560 <= wid - 100;
    if (!right && entry.y0 - 530 < 100) return;
    const from = scene.oy + (right ? entry.y1 + 140 : entry.y0 - 530) / 1000;
    const till = from + 0.39;
    for (const [id, dz] of POW) {
      const z = topZ + dz;
      board.box([x - 0.04, from, z - 0.08], [x, till, z + 0.08], 0.006);
      scene.sticker({ type: 'sign', id }, [x - 0.04, (from + till) / 2, z], [-1, 0, 0], [0.36, 0.13], 0.8);
    }
  }

  /** Ворота отсека бака: козырёк, таблички на левой створке. */
  tankGate(gate, tank) {
    const scene = this.outfit.scene;
    const x = this.outfit.leftX();
    const normal = [-1, 0, 0];
    const leafW = (gate.y1 - gate.y0) / 2000;
    const signY = scene.oy + gate.y0 / 1000 + leafW / 2;
    const signZ = scene.base + 1.38;
    this.canopy(
      [x, scene.oy + (gate.y0 + gate.y1) / 2000, scene.base + gate.h / 1000],
      normal,
      (gate.y1 - gate.y0) / 1000 + 0.24,
    );
    this.outfit.outer('left', gate.y0 - 100, gate.y1 + 100, 0, gate.h + 620);
    const category = OutfitDoors.cat(tank);
    if (category) scene.sticker(category, [x - 0.03, signY, scene.base + 1.72], normal, [0.3, 0.2]);
    scene.sticker({ type: 'sign', id: 'W01' }, [x - 0.03, signY - 0.12, signZ], normal, [0.2, 0.175]);
    scene.sticker({ type: 'sign', id: 'P02' }, [x - 0.03, signY + 0.12, signZ], normal, [0.2, 0.2]);
  }

  /** Вторая дверь оператора в дальнем торце. */
  endExit(exit) {
    const scene = this.outfit.scene;
    const x = this.outfit.rightX();
    const normal = [1, 0, 0];
    const midY = scene.oy + (exit.y0 + exit.y1) / 2000;
    const topZ = scene.base + exit.h / 1000;
    this.outfit.outer('right', exit.y0 - 100, exit.y1 + 100, 0, exit.h + 620);
    this.canopy([x, midY, topZ], normal, exit.w / 1000 + 0.24);
    if (this.room(topZ)) this.flood([x, midY, topZ + 0.17], normal);
  }

  /** Дверь в стене со стороны зрителя (стена не срезана): козырёк, прожектор, занятые места, таблички и табло. */
  front(opening, rooms, fire) {
    const scene = this.outfit.scene;
    const normal = [0, -1, 0];
    const faceY = this.outfit.frontY();
    const [from, till] = [scene.ox + opening.x0 / 1000, scene.ox + opening.x1 / 1000];
    const midX = (from + till) / 2;
    const topZ = scene.base + opening.h / 1000;
    this.canopy([midX, faceY, topZ], normal, till - from + 0.24);
    if (opening.kind !== 'service' && this.room(topZ)) this.flood([midX, faceY, topZ + 0.17], normal);
    const signX = OutfitDoors.signX(opening, from, till, midX);
    const right = till + 0.56 < scene.ox + scene.Li - 0.05;
    this.frontBusy(opening, signX * 1000 - scene.ox * 1000, right, fire);
    const sign = opening.kind === 'entry';
    let plate = null;
    if (opening.kind === 'tank') plate = OutfitDoors.cat(rooms.tank);
    else if (sign) plate = OutfitDoors.cat(rooms.main);
    if (plate) scene.sticker(plate, [signX, -0.052, scene.base + 1.72], normal, [0.3, 0.2]);
    if (sign) this.entrySigns(signX, topZ, { tb: right ? till + 0.14 : from - 0.53, fy: faceY }, fire);
    if (opening.kind === 'tank') this.tankSigns(midX);
  }

  /** У сервисной двери — мимо запорных штанг. */
  static signX(opening, from, till, midX) {
    if (opening.kind !== 'service') return midX;
    return (opening.leaves || 1) > 1 ? from + (till - from) * 0.75 : midX - 0.08;
  }

  /** Снаружи занято: козырёк и прожектор, края полотна, ручка (у сервисной — штанги), таблички, табло, решётка отсека бака. */
  frontBusy(opening, midU, right, fire) {
    const out = (u0, u1, z0, z1) => this.outfit.outer('front', u0, u1, z0, z1);
    const two = (opening.leaves || 1) > 1;
    const centerU = (opening.x0 + opening.x1) / 2;
    out(opening.x0 - 170, opening.x1 + 170, opening.h - 60, opening.h + 620);
    for (const edge of [opening.x0, opening.x1]) out(edge - 30, edge + 30, 0, opening.h);
    if (opening.kind === 'service')
      out(...(two ? [centerU - 160, centerU + 160] : [opening.x1 - 200, opening.x1 + 20]), 0, opening.h);
    else out(two ? centerU - 160 : opening.x1 - 260, two ? centerU + 160 : opening.x1 + 60, 800, 1200);
    this.signsBusy(opening, midU, right, fire);
  }

  /** Таблички, табло справа от входа (у дальнего края — слева), решётка внизу двери отсека бака. */
  signsBusy(opening, midU, right, fire) {
    const out = (u0, u1, z0, z1) => this.outfit.outer('front', u0, u1, z0, z1);
    if (opening.kind === 'entry' || opening.kind === 'tank') out(midU - 290, midU + 290, 1240, 1850);
    if (opening.kind === 'entry' && fire.auto)
      out(
        ...(right ? [opening.x1 + 120, opening.x1 + 560] : [opening.x0 - 560, opening.x0 - 120]),
        opening.h - 260,
        opening.h + 170,
      );
    if (opening.kind === 'tank') out(opening.x0, opening.x1, 0, 520);
  }

  /** Знаки W08 и P06 на входной двери; при пожаротушении — табло справа от двери (у дальнего края — слева). */
  entrySigns(signX, topZ, { tb: boardX, fy: faceY }, fire) {
    const scene = this.outfit.scene;
    const normal = [0, -1, 0];
    const signZ = scene.base + 1.38;
    scene.sticker({ type: 'sign', id: 'W08' }, [signX - 0.12, -0.052, signZ], normal, [0.2, 0.175]);
    scene.sticker({ type: 'sign', id: 'P06' }, [signX + 0.12, -0.052, signZ], normal, [0.2, 0.2]);
    if (!fire.auto || topZ + 0.2 >= scene.top - 0.04) return;
    const board = scene.meshFor(StMat.paint('#eceeef', 0.4));
    for (const [id, dz] of POW) {
      const z = topZ + dz;
      board.box([boardX, faceY - 0.04, z - 0.08], [boardX + 0.39, faceY, z + 0.08], 0.006);
      scene.sticker({ type: 'sign', id }, [boardX + 0.195, faceY - 0.04, z], normal, [0.36, 0.13], 0.8);
    }
  }

  /** Знаки у двери отсека бака. */
  tankSigns(midX) {
    const scene = this.outfit.scene;
    const normal = [0, -1, 0];
    const signZ = scene.base + 1.38;
    scene.sticker({ type: 'sign', id: 'W01' }, [midX - 0.12, -0.052, signZ], normal, [0.2, 0.175]);
    scene.sticker({ type: 'sign', id: 'P02' }, [midX + 0.12, -0.052, signZ], normal, [0.2, 0.2]);
  }

  /** Над дверью хватает места для прожектора под козырьком. */
  room(topZ) {
    return topZ + 0.34 < this.outfit.scene.top - 0.04;
  }

  /** Съёмный козырёк над дверью: лист с уклоном наружу и бортом, два кронштейна; c — середина над проёмом, n — наружу. */
  canopy(center, normal, width) {
    const scene = this.outfit.scene;
    const right = StV.norm(StV.cross(StV.mul(normal, -1), [0, 0, 1]));
    const z = Math.min(scene.top - 0.07, center[2] + 0.42);
    const depth = 0.32;
    const sheet = scene.meshFor(StMat.paint(RalColor.shade(scene.wall, 0.9), 0.45));
    const bracket = scene.meshFor(StMat.paint(RalColor.shade(scene.frame, 0.85), 0.5));
    const origin = StV.sub([center[0], center[1], z], StV.mul(right, width / 2));
    const v = StV.add(StV.mul(normal, depth), [0, 0, -0.06]);
    sheet.obox(origin, StV.mul(right, width), v, [0, 0, 0.008]);
    sheet.obox(StV.add(origin, v), StV.mul(right, width), StV.mul(normal, 0.008), [0, 0, -0.05]);
    for (const k of [0.06, width - 0.06]) {
      const point = StV.add(origin, StV.mul(right, k));
      bracket.tube(
        StV.add(point, [0, 0, -0.2]),
        StV.add(StV.add(point, StV.mul(normal, depth * 0.85)), [0, 0, -0.05]),
        0.01,
        8,
      );
    }
  }

  /** Светодиодный прожектор над дверью: корпус с рёбрами на скобе, наклонён вниз на 30°, светящееся стекло. */
  flood(center, normal) {
    const scene = this.outfit.scene;
    const right = StV.norm(StV.cross(StV.mul(normal, -1), [0, 0, 1]));
    const tilt = (30 * Math.PI) / 180;
    const forward = StV.norm(StV.add(StV.mul(normal, Math.cos(tilt)), [0, 0, -Math.sin(tilt)]));
    const upward = StV.cross(forward, right);
    const body = scene.meshFor(StMat.paint('#2d3237', 0.45));
    const [wid, height, depth] = [0.2, 0.15, 0.05];
    const origin = StV.add(center, StV.mul(normal, 0.08));
    const corner = StV.sub(
      StV.sub(StV.sub(origin, StV.mul(right, wid / 2)), StV.mul(upward, height / 2)),
      StV.mul(forward, depth / 2),
    );
    body.obox(corner, StV.mul(right, wid), StV.mul(upward, height), StV.mul(forward, depth));
    scene
      .meshFor(StMat.glow('#fff6dc', 3.4))
      .obox(
        StV.add(corner, StV.add(StV.add(StV.mul(right, 0.016), StV.mul(upward, 0.016)), StV.mul(forward, depth))),
        StV.mul(right, wid - 0.032),
        StV.mul(upward, height - 0.032),
        StV.mul(forward, 0.004),
      );
    for (let k = 1; k < 6; k++)
      body.obox(
        StV.add(corner, StV.add(StV.mul(right, (wid * k) / 6 - 0.003), StV.mul(forward, -0.018))),
        StV.mul(right, 0.006),
        StV.mul(upward, height),
        StV.mul(forward, 0.018),
      );
    for (const k of [-1, 1]) {
      const point = [0, 1, 2].map(i => center[i] + right[i] * k * (wid / 2 + 0.008));
      const low = [0, 1, 2].map(i => Math.min(point[i], point[i] + normal[i] * 0.09) - (i === 2 ? 0.015 : 0));
      const high = [0, 1, 2].map(i => Math.max(point[i], point[i] + normal[i] * 0.09) + (i === 2 ? 0.015 : 0.004));
      body.box(low, high);
    }
  }
}
