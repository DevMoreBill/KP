import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { OutfitBase } from './outfit-base.js';

/** Пожарная безопасность: извещатели, модули «Буран-2,5», табло, щит ОПС, огнетушители. */
export class OutfitFire {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /**
   * Пожарная безопасность (plan.fire): извещатели и модули «Буран-2,5» на потолке; табло «Выход» над выходами (при
   * пожаротушении рядом — «Порошок! Уходи!»); щит ОПС, ручной извещатель, оповещатель и огнетушитель — у выхода, второй
   * огнетушитель — у основного оборудования; места — не за оборудованием и не в узком проходе, видимые — в первую очередь.
   */
  fire() {
    const { scene: scene, plan: plan } = this.outfit;
    const fire = plan.fire;
    if (!this.outfit.inside || !fire) return;
    const meshes = {
      red: scene.meshFor(StMat.paint(OutfitBase.RED, 0.4)),
      wh: scene.meshFor(StMat.paint('#f2f3f4', 0.35)),
    };
    this.outfit.walls.shade(plan);
    if (fire.ops) this.detectors(fire.rooms[0], meshes.wh);
    for (const spot of fire.rooms) for (const mod of spot.mods) this.buran(scene.point(mod.x, mod.y, plan.int[2]));
    this.boards(fire);
    const walls = ['back', 'right', 'left', 'front'];
    const door = OutfitFire.door(plan, fire);
    const extTop = OutfitBase.EXT;
    const extBands = [
      [260, extTop - 550, extTop + 340],
      [500, extTop - 550, extTop + 30, 150],
      [260, extTop - 1050, extTop - 160, 400],
      [500, extTop - 1050, extTop - 470, 550],
    ];
    const second = fire.rooms[0].ext > 1 ? this.outfit.near(walls, extBands, OutfitFire.mainAt(plan)) : null;
    if (fire.ops) this.opsPanel(walls, door);
    const first = this.outfit.near(walls, extBands, door, 1500);
    for (const found of [first, second].filter(spot => spot && (spot.w !== 'front' || !scene.cut))) this.extAt(found);
    if (fire.ops) this.alarms(walls, door, meshes);
  }

  /** Извещатели на потолке: не меньше двух, через 3,5 м. */
  detectors(main, white) {
    const scene = this.outfit.scene;
    const [, wid, height] = this.outfit.plan.int;
    const count = Math.max(2, Math.ceil((main.x1 - main.x0) / 3500));
    const led = scene.meshFor(StMat.glow('#ff3b30', 2));
    for (let i = 0; i < count; i++) {
      const center = scene.point(main.x0 + ((main.x1 - main.x0) * (i + 0.5)) / count, wid * 0.28, height);
      white.tube(center, StV.add(center, [0, 0, -0.045]), 0.05, 18);
      white.tube(StV.add(center, [0, 0, -0.045]), StV.add(center, [0, 0, -0.06]), 0.032, 14);
      led.sphere(StV.add(center, [0.036, 0, -0.04]), 0.006, 6);
    }
  }

  /** Табло над выходом (низ — не ниже верха проёма) и над вторым выходом. */
  boards(fire) {
    const height = this.outfit.plan.int[2];
    const exit = fire.exit;
    if (exit) {
      const z = Math.max(exit.top + 90, height - 125);
      const two = fire.auto && exit.w >= 800;
      const du = two ? 200 : 0;
      if (z + 75 < height - 20) {
        this.hang('EXIT', exit.wall, [exit.u - du, z], [360, 130]);
        if (two) this.hang('POW_OUT', exit.wall, [exit.u + du, z], [360, 130]);
      }
    }
    if (fire.exit2) {
      const exit2 = fire.exit2;
      const z = Math.max(exit2.top + 90, height - 125);
      if (z + 75 < height - 20) this.hang('EXIT', exit2.wall, [exit2.u, z], [360, 130]);
    }
  }

  /** Точка плана у выхода: дверь оператора, иначе дверь в стене, иначе середина торца у входа. */
  static door(plan, fire) {
    const exit = fire.exit;
    const x0 = plan.geo.x0 || 0;
    const wid = plan.int[1];
    if (exit) return exit.wall === 'front' ? [exit.u, 0] : [x0, exit.u];
    const service = (plan.doors || []).find(door => door.wall !== 'back');
    return service ? [(service.x0 + service.x1) / 2, 0] : [x0, wid / 2];
  }

  /** Основное оборудование (ДГУ, самый мощный компрессор): точка у его лицевой стороны. */
  static mainAt(plan) {
    const wid = plan.int[1];
    const floor = plan.items.filter(i => !i.tank && (i.mount === 'floor' || i.mount === 'frame'));
    const comp = floor.filter(i => i.kind === 'compressor').sort((left, right) => (right.kw || 0) - (left.kw || 0))[0];
    const big = floor.find(i => i.kind === 'dgu') || comp || floor[0];
    if (!big) return [plan.int[0], wid / 2];
    return [big.x + big.lx / 2, big.y + big.ly / 2 > wid / 2 ? big.y : big.y + big.ly];
  }

  /** Щит ОПС у входа. */
  opsPanel(walls, door) {
    const spot = this.outfit.near(
      walls,
      [
        [340, 1030, 1470],
        [340, 930, 1370, 200],
      ],
      door,
      4500,
    );
    if (spot) this.panel(spot.w, spot.u, spot.z0 + 220);
  }

  /** Огнетушитель: верх — не выше EXT, знак F04 — над ним, на широком месте — сбоку. */
  extAt(spot) {
    const side = spot.wd > 260;
    const u = side ? spot.u - 120 : spot.u;
    this.extinguisher(this.outfit.wallPoint(spot.w, u, spot.z0 + 50), OutfitBase.NORMAL[spot.w]);
    this.outfit.sign(
      { type: 'sign', id: 'F04' },
      spot.w,
      [side ? u + 250 : u, side ? spot.z0 + 430 : spot.z0 + 770],
      [200, 200],
    );
  }

  /** Ручной пожарный извещатель (1,5 м) и оповещатель (под потолком) — у выхода. */
  alarms(walls, door, { red, wh: white }) {
    const height = this.outfit.plan.int[2];
    const spot = this.outfit.near(walls, [[160, 1380, 1620]], door, 0);
    if (spot) {
      this.outfit.log.push({ kind: 'mcp', wall: spot.w, u: spot.u });
      this.outfit.box(red, spot.w, [spot.u, 1500], [95, 95, 45], 0.006);
      this.outfit.box(white, spot.w, [spot.u, 1508], [52, 44, 48], 0.003);
    }
    const signZ = Math.min(2100, height - 190);
    const siren = this.outfit.near(walls, [[170, signZ - 150, signZ + 150]], door, 0);
    if (siren) {
      this.outfit.log.push({ kind: 'sounder', wall: siren.w, u: siren.u });
      this.outfit.box(red, siren.w, [siren.u, signZ], [120, 140, 55], 0.012);
      this.outfit.box(white, siren.w, [siren.u, signZ + 35], [76, 36, 58], 0.008);
    }
  }

  /** Модуль «Буран-2,5» на потолке (c — точка потолка): кронштейн, красный корпус Ø 250 мм с этикеткой, распылитель снизу,
   *  тепловой замок посередине */
  buran(center) {
    const scene = this.outfit.scene;
    const red = scene.meshFor(StMat.paint('#c62d22', 0.35));
    const dark = scene.meshFor(StMat.paint('#2a2e33', 0.5));
    const gray = scene.meshFor(StMat.paint('#d3d6d9', 0.45));
    const label = scene.meshFor(StMat.paint('#f1efe8', 0.6));
    const radius = 0.125;
    const z1 = center[2] - 0.035;
    const z0 = z1 - 0.11;
    const [x, y] = center;
    this.outfit.log.push({ kind: 'buran', at: center });
    dark.box([x - 0.1, y - 0.022, center[2] - 0.008], [x + 0.1, y + 0.022, center[2]]);
    dark.tube([x, y, center[2] - 0.008], [x, y, z1], 0.018, 10); // кронштейн
    red.tube([x, y, z0], [x, y, z1], radius, 32);
    label.tube([x, y, z0 + 0.03], [x, y, z0 + 0.075], radius * 1.006, 32, { caps: [false, false] });
    gray.tube([x, y, z0 - 0.014], [x, y, z0], radius * 0.9, 32, { caps: [true, false] });
    dark.tube([x, y, z0 - 0.04], [x, y, z0 - 0.014], 0.022, 14, { caps: [true, false] });
  }

  /** Щит ОПС на стене (середина u, zc — середина по высоте): корпус, дисплей, индикаторы «Пожар», «Неисправность», «Питание»,
   *  табличка */
  panel(wall, u, midZ) {
    const scene = this.outfit.scene;
    this.outfit.log.push({ kind: 'ops', wall, u, seen: this.outfit.seen(wall, u, midZ) });
    this.outfit.box(scene.meshFor(StMat.paint('#e2e5e8', 0.4)), wall, [u, midZ], [300, 400, 120], 0.012);
    this.outfit.box(scene.meshFor(StMat.paint('#1d2226', 0.35)), wall, [u, midZ + 105], [200, 80, 123], 0.004);
    scene
      .meshFor(StMat.glow('#9fe6b3', 1.2))
      .box(this.outfit.wallPoint(wall, u - 85, midZ + 75, 124), this.outfit.wallPoint(wall, u + 85, midZ + 135, 125)); // экран
    for (const [k, color] of [
      [-1, '#ff3b30'],
      [0, '#ffc21a'],
      [1, '#39d353'],
    ])
      this.outfit.box(scene.meshFor(StMat.glow(color, 2.4)), wall, [u + k * 45, midZ + 30], [22, 22, 128], 0.004);
    this.outfit.sign({ type: 'sign', id: 'OPS' }, wall, [u, midZ - 90], [220, 82], [121, 0]);
  }

  /** Табло под потолком у стены w над проёмом: корпус, надпись с обеих сторон (в разрезе стена срезана — видна и снаружи),
   *  подвес к потолку */
  hang(id, wall, [u, z], [signW, signH]) {
    const scene = this.outfit.scene;
    const [, , height] = this.outfit.plan.int;
    const board = scene.meshFor(StMat.paint('#eceeef', 0.4));
    const dark = scene.meshFor(StMat.paint('#2a2e33', 0.5));
    const nearOff = 20;
    const farOff = 60;
    const normal = OutfitBase.NORMAL[wall];
    const inward = StV.mul(normal, -1);
    const low = this.outfit.wallPoint(wall, u - signW / 2 - 15, z - signH / 2 - 15, nearOff);
    const high = this.outfit.wallPoint(wall, u + signW / 2 + 15, z + signH / 2 + 15, farOff);
    this.outfit.log.push({ kind: 'board', id, wall, u, z0: z - signH / 2 - 15 });
    board.box([low[0], low[1], low[2]], [high[0], high[1], high[2]], 0.006);
    for (const k of [-1, 1]) {
      const hook = this.outfit.wallPoint(wall, u + k * (signW / 2 - 30), z + signH / 2 + 15, (nearOff + farOff) / 2);
      dark.tube(hook, [hook[0], hook[1], scene.base + height / 1000], 0.005, 6);
    }
    scene.sticker(
      { type: 'sign', id },
      this.outfit.wallPoint(wall, u, z, farOff),
      normal,
      [signW / 1000, signH / 1000],
      1.4,
    );
    scene.sticker(
      { type: 'sign', id },
      this.outfit.wallPoint(wall, u, z, nearOff),
      inward,
      [signW / 1000, signH / 1000],
      1.4,
    );
  }

  /** Огнетушитель на стене: base — точка стены на высоте низа корпуса, n — от стены; корпус, головка с рычагом и манометром,
   *  шланг с раструбом, хомут кронштейна, этикетка */
  extinguisher(base, normal) {
    const scene = this.outfit.scene;
    const radius = 0.075;
    const center = StV.add(base, StV.mul(normal, radius + 0.03));
    const side = StV.norm(StV.cross(normal, [0, 0, 1]));
    const z0 = center[2];
    const z1 = z0 + 0.36;
    const headZ = z1 + radius * 0.5 + 0.06;
    const red = scene.meshFor(StMat.paint(OutfitBase.RED, 0.35));
    const dark = scene.meshFor(StMat.paint('#1d2024', 0.5));
    const metal = scene.meshFor(StMat.metal('#b9bfc5', 0.3));
    const label = scene.meshFor(StMat.paint('#f1efe8', 0.6));
    this.outfit.log.push({ kind: 'ext', top: Math.round((headZ + 0.012 - scene.base) * 1000), at: center });
    red.tube([center[0], center[1], z0], [center[0], center[1], z1], radius, 24, { caps: [true, false] });
    red.dish([center[0], center[1], z1], radius, 1, 24);
    label.tube([center[0], center[1], z0 + 0.1], [center[0], center[1], z0 + 0.22], radius * 1.004, 24, {
      caps: [false, false],
    });
    metal.tube([center[0], center[1], z1 + radius * 0.45], [center[0], center[1], headZ - 0.03], 0.018, 12);
    dark.box(
      [center[0] - 0.022, center[1] - 0.022, headZ - 0.03],
      [center[0] + 0.022, center[1] + 0.022, headZ + 0.01],
      0.004,
    );
    dark.obox(
      StV.add([center[0], center[1], headZ], StV.mul(side, -0.02)),
      StV.mul(side, 0.12),
      StV.mul(normal, 0.022),
      [0, 0, 0.012],
    ); // рычаг
    scene
      .meshFor(StMat.paint('#f4f4f2', 0.3))
      .tube(
        StV.add([center[0], center[1], headZ - 0.012], StV.mul(normal, 0.022)),
        StV.add([center[0], center[1], headZ - 0.012], StV.mul(normal, 0.03)),
        0.016,
        14,
      ); // манометр
    this._hose(dark, { center, side, radius }, [z0, z1, headZ]);
    OutfitFire._bracket(dark, { base, center, side, radius }, z0);
  }

  static _bracket(dark, { base, center, side, radius }, z0) {
    dark.tube([center[0], center[1], z0 + 0.27], [center[0], center[1], z0 + 0.3], radius * 1.06, 24, {
      caps: [false, false],
    });
    dark.box(
      [Math.min(base[0], center[0] - side[0] * 0.03), Math.min(base[1], center[1] - side[1] * 0.03), z0 + 0.26],
      [Math.max(base[0], center[0] + side[0] * 0.03), Math.max(base[1], center[1] + side[1] * 0.03), z0 + 0.31],
      0.003,
    );
  }

  _hose(dark, { center, side, radius }, [z0, z1, headZ]) {
    const hoseTop = StV.add([center[0], center[1], headZ - 0.02], StV.mul(side, -0.025));
    const hoseMid = StV.add([center[0], center[1], z1 - 0.04], StV.mul(side, -(radius + 0.014)));
    const hoseLow = StV.add([center[0], center[1], z0 + 0.1], StV.mul(side, -(radius + 0.014)));
    dark.tube(hoseTop, hoseMid, 0.009, 8);
    dark.sphere(hoseMid, 0.009, 8);
    dark.tube(hoseMid, hoseLow, 0.009, 8);
    dark.tube(hoseLow, StV.add(hoseLow, [0, 0, -0.05]), 0.014, 10);
  }
}
