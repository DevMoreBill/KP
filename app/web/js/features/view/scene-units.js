import { RalColor } from '../layout/ral-color.js';
import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { StMesh } from './st-mesh.js';

/** Насосы, ДГУ (радиатор, генератор, рама), баки, шкафы управления и прочее оборудование. */
export class SceneUnits {
  constructor(scene) {
    this.scene = scene;
  }

  /** Насос. */
  pump(item) {
    const [x0, , z0, x1, , z1] = this.scene.extent(item);
    const len = x1 - x0;
    const height = z1 - z0;
    const color = item.color;
    const dark = this.scene.meshFor(StMat.paint(StMat.DARK, 0.6));
    const mot = this.scene.meshFor(StMat.paint(color, 0.38));
    const cast = this.scene.meshFor(StMat.paint(RalColor.shade(color, 0.78), 0.5));
    const fin = this.scene.meshFor(StMat.paint(RalColor.shade(color, 0.85), 0.45));
    const meshes = { dk: dark, mot, cast, fin };
    if (height > len * 1.2) this.pumpV(item, meshes);
    else this.pumpH(item, meshes);
  }

  /** Вертикальный многоступенчатый: основание, проточная часть, двигатель сверху. */
  pumpV(item, { dk: dark, mot, cast, fin }) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const len = x1 - x0;
    const wid = y1 - y0;
    const height = z1 - z0;
    const midY = (y0 + y1) / 2;
    const radius = Math.min(len, wid) * 0.32;
    const midX = (x0 + x1) / 2;
    const baseZ = z0 + height * 0.12;
    const motorZ = z0 + height * 0.58;
    cast.box([x0 + len * 0.05, y0 + wid * 0.1, z0], [x1 - len * 0.05, y1 - wid * 0.1, baseZ], 0.01);
    for (const sign of [-1, 1]) {
      cast.tube(
        [midX + sign * len * 0.42, midY, baseZ * 0.5 + z0 * 0.5],
        [midX + sign * len * 0.5, midY, baseZ * 0.5 + z0 * 0.5],
        radius * 0.55,
        18,
      );
      cast.tube(
        [midX + sign * len * 0.49, midY, baseZ * 0.5 + z0 * 0.5],
        [midX + sign * len * 0.5, midY, baseZ * 0.5 + z0 * 0.5],
        radius * 0.8,
        18,
      );
    }
    this.scene.meshFor(StMat.metal(StMat.INOX, 0.28)).tube([midX, midY, baseZ], [midX, midY, motorZ], radius * 0.8, 28);
    cast.tube([midX, midY, motorZ], [midX, midY, motorZ + height * 0.05], radius * 1.05, 28);
    mot.tube([midX, midY, motorZ + height * 0.05], [midX, midY, z1 - height * 0.06], radius * 1.1, 32);
    for (let z = motorZ + height * 0.09; z < z1 - height * 0.1; z += height * 0.035)
      fin.tube([midX, midY, z], [midX, midY, z + 0.006], radius * 1.17, 32);
    dark.tube([midX, midY, z1 - height * 0.06], [midX, midY, z1], radius * 1.05, 28);
  }

  /** Горизонтальный: рама, двигатель с рёбрами и кожухом вентилятора, защита муфты, улитка насоса. */
  pumpH(item, { dk: dark, mot, cast, fin }) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const len = x1 - x0;
    const wid = y1 - y0;
    const height = z1 - z0;
    const midY = (y0 + y1) / 2;
    dark.box([x0, y0 + wid * 0.08, z0], [x1, y1 - wid * 0.08, z0 + Math.min(0.12, height * 0.14)], 0.004);
    const axisZ = z0 + height * 0.52;
    const radius = Math.min(wid * 0.42, height * 0.36);
    const xm0 = x0 + len * 0.04;
    const xm1 = x0 + len * 0.52;
    mot.tube([xm0 + 0.05, midY, axisZ], [xm1, midY, axisZ], radius, 32);
    for (let x = xm0 + 0.08; x < xm1 - 0.03; x += 0.045)
      fin.tube([x, midY, axisZ], [x + 0.008, midY, axisZ], radius * 1.08, 32);
    dark.tube([xm0, midY, axisZ], [xm0 + 0.06, midY, axisZ], radius * 1.03, 32);
    mot.box(
      [xm0 + len * 0.12, midY - radius * 0.55, axisZ + radius * 0.85],
      [xm0 + len * 0.24, midY + radius * 0.55, axisZ + radius * 1.1],
      0.005,
    ); // клеммная коробка
    for (const x of [xm0 + 0.08, xm1 - 0.08])
      mot.box([x - 0.03, midY - radius * 0.8, z0 + 0.1], [x + 0.03, midY + radius * 0.8, axisZ - radius * 0.75], 0.004);
    this.scene
      .meshFor(StMat.paint('#e8a317', 0.4))
      .box(
        [xm1, midY - radius * 0.45, axisZ - radius * 0.45],
        [x0 + len * 0.66, midY + radius * 0.45, axisZ + radius * 0.45],
        0.01,
      );
    this._volute(item, { dark, cast }, { axisZ, radius });
  }

  _volute(item, { dark, cast }, { axisZ, radius }) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const len = x1 - x0;
    const height = z1 - z0;
    const midY = (y0 + y1) / 2;
    const pumpX = x0 + len * 0.8;
    const voluteR = Math.min(radius * 1.25, height * 0.45);
    cast.tube([pumpX - len * 0.08, midY, axisZ], [pumpX + len * 0.06, midY, axisZ], voluteR, 32);
    cast.tube([pumpX + len * 0.06, midY, axisZ], [x1 - 0.01, midY, axisZ], voluteR * 0.42, 20);
    cast.tube([x1 - 0.04, midY, axisZ], [x1, midY, axisZ], voluteR * 0.62, 20); // всас
    cast.tube(
      [pumpX, midY, axisZ + voluteR * 0.8],
      [pumpX, midY, Math.min(z1, axisZ + voluteR + 0.12)],
      voluteR * 0.36,
      20,
    );
    cast.tube(
      [pumpX, midY, Math.min(z1, axisZ + voluteR + 0.12) - 0.03],
      [pumpX, midY, Math.min(z1, axisZ + voluteR + 0.12)],
      voluteR * 0.55,
      20,
    ); // напор
    dark.box(
      [pumpX - 0.04, midY - voluteR * 0.5, z0 + 0.1],
      [pumpX + 0.04, midY + voluteR * 0.5, axisZ - voluteR * 0.7],
      0.004,
    );
  }

  /** ДГУ открытого исполнения. */
  dgu(item) {
    const rad = item.rad || 'right';
    const box = this.scene.extent(item);
    if (rad === 'right')
      return this.dgu0(
        item,
        box,
        mat => this.scene.meshFor(mat),
        point => point,
        true,
      );
    const [fromX, fromY, , tillX, tillY] = box;
    const map =
      rad === 'left'
        ? point => [fromX + tillX - point[0], point[1], point[2]]
        : point => [point[1], point[0], point[2]];
    return this.dgu0(
      item,
      rad === 'left' ? box : [fromY, fromX, box[2], tillY, tillX, box[5]],
      mat => StMesh.mapped(this.scene.meshFor(mat), map),
      map,
      false,
    );
  }

  /** ДГУ в своей системе (радиатор к +x). */
  dgu0(item, box, meshFor, map, own) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const geom = { B: box, L: x1 - x0, W: y1 - y0, H: z1 - z0, cy: (y0 + y1) / 2, s: own ? this.scene.side(item) : -1 };
    geom.fb = z0 + geom.H * 0.13;
    const color = item.color;
    const meshes = {
      M: meshFor,
      body: meshFor(StMat.paint(color, 0.4)),
      dk: meshFor(StMat.paint(StMat.DARK, 0.6)),
      alt: meshFor(StMat.paint('#4a5259', 0.42)),
      cap: meshFor(StMat.paint(RalColor.shade(color, 0.62), 0.42)),
      st: meshFor(StMat.metal('#8d949a', 0.45)),
    };
    meshes.dk.box([x0, y0, z0], [x1, y1, geom.fb], 0.006); // рама-бак
    meshes.dk.tube(
      [x0 + geom.L * 0.08, y0 + geom.W * 0.18, geom.fb],
      [x0 + geom.L * 0.08, y0 + geom.W * 0.18, geom.fb + 0.04],
      0.05,
      16,
    );
    this.dguGen(geom, meshes);
    this.dguEngine(geom, meshes);
    this.dguExhaust(item, geom, meshes, map);
    this.dguRadiator(item, geom, meshes, own);
    this.dguPanel(geom, meshes);
  }

  /** Генератор: лапы, корпус, решётка торца, клеммная коробка. */
  dguGen(geom, { dk: dark, alt }) {
    const [x0] = geom.B;
    const { L: len, W: wid, H: height, cy: midY, fb: baseTop } = geom;
    const genX0 = x0 + len * 0.03;
    const genX1 = x0 + len * 0.34;
    const genR = Math.min(wid * 0.36, height * 0.3);
    const midZ = baseTop + genR + 0.04;
    Object.assign(geom, { xa: genX0, xb: genX1, R: genR, zc: midZ });
    for (const x of [genX0 + 0.08, genX1 - 0.16])
      dark.box([x, midY - genR * 0.8, baseTop], [x + 0.08, midY + genR * 0.8, midZ - genR * 0.5], 0.004);
    alt.tube([genX0 + 0.03, midY, midZ], [genX1, midY, midZ], genR, 36);
    alt.tube([genX0, midY, midZ], [genX0 + 0.03, midY, midZ], genR * 0.86, 36);
    for (let k = 0; k < 5; k++) {
      const z = midZ - genR * 0.45 + k * genR * 0.2;
      dark.box([genX0 - 0.004, midY - genR * 0.5, z], [genX0 + 0.002, midY + genR * 0.5, z + genR * 0.08]);
    }
    alt.box(
      [genX0 + (genX1 - genX0) * 0.35, midY - genR * 0.42, midZ + genR * 0.8],
      [genX1 - (genX1 - genX0) * 0.12, midY + genR * 0.42, midZ + genR + 0.1],
      0.01,
    );
  }

  /** Двигатель: поддон, блок, головка, крышка клапанов, опоры. */
  dguEngine(geom, { body, dk: dark, cap }) {
    const [x0, , z0] = geom.B;
    const { L: len, W: wid, H: height, cy: midY, fb: baseTop, xb: genX1 } = geom;
    const radX = x0 + len * 0.84;
    const engineW = wid * 0.62;
    const engineZ = z0 + height * 0.6;
    const headZ = engineZ + height * 0.1;
    const valveZ = headZ + height * 0.05;
    Object.assign(geom, { xr: radX, wb: engineW, zb: engineZ, zh: headZ, zv: valveZ });
    dark.box(
      [genX1 + 0.05, midY - engineW * 0.38, baseTop],
      [radX - 0.06, midY + engineW * 0.38, baseTop + height * 0.1],
      0.01,
    );
    body.box([genX1, midY - engineW / 2, baseTop + height * 0.08], [radX - 0.02, midY + engineW / 2, engineZ], 0.02);
    body.box([genX1 + 0.05, midY - engineW * 0.38, engineZ], [radX - 0.08, midY + engineW * 0.38, headZ], 0.015);
    cap.box([genX1 + 0.08, midY - engineW * 0.26, headZ], [radX - 0.12, midY + engineW * 0.26, valveZ], 0.02);
    for (const x of [genX1 + 0.1, radX - 0.2])
      dark.box([x, midY - wid * 0.4, baseTop], [x + 0.1, midY + wid * 0.4, baseTop + height * 0.1], 0.004);
  }

  /** Выхлоп над ДГУ (глушитель на крыше) и место турбины по длине: под выхлопом (f обратна сама себе). */
  dguTurbo(item, geom, map) {
    const exhaust = (this.scene.plan.roof || [])
      .map(muffler => muffler.exhaust)
      .find(
        exhaust0 =>
          exhaust0 &&
          exhaust0.x >= item.x &&
          exhaust0.x <= item.x + item.lx &&
          (exhaust0.y == null || (exhaust0.y >= item.y && exhaust0.y <= item.y + item.ly)),
      );
    if (!exhaust) return [null, geom.xr - 0.3];
    const y = exhaust.y != null ? exhaust.y : item.y + item.ly / 2;
    const x = map([this.scene.ox + exhaust.x / 1000, this.scene.oy + y / 1000, 0])[0];
    return [exhaust, Math.max(geom.xb + 0.15, Math.min(geom.xr - 0.1, x))];
  }

  /** Выпуск со стороны от прохода, турбина, сильфон к глушителю, воздушный фильтр. */
  dguExhaust(item, geom, { M: meshFor, st: steel }, map) {
    const z1 = geom.B[5];
    const {
      L: len,
      W: wid,
      H: height,
      cy: midY,
      s: side,
      xb: genX1,
      wb: engineW,
      zb: engineZ,
      zh: headZ,
      zv: valveZ,
    } = geom;
    const [exhaust, turboX] = this.dguTurbo(item, geom, map);
    const pipeY = midY - side * engineW * 0.56;
    const pipeZ = engineZ + height * 0.02;
    const radius = Math.min(0.12, height * 0.065);
    steel.tube([genX1 + 0.12, pipeY, pipeZ], [turboX, pipeY, pipeZ], Math.min(0.055, height * 0.03), 16);
    steel.sphere([turboX, pipeY, pipeZ], radius * 0.7, 14);
    steel.tube([turboX, pipeY, pipeZ], [turboX, midY, valveZ + radius], radius * 0.45, 16);
    steel.sphere([turboX, midY, valveZ + radius], radius, 18);
    if (exhaust)
      for (let z = valveZ + radius * 1.6; z < z1 - 0.03; z += 0.03)
        steel.tube([turboX, midY, z], [turboX, midY, z + 0.018], radius * 0.62, 18);
    meshFor(StMat.paint('#1f2328', 0.55)).tube(
      [genX1 + len * 0.08, midY + side * engineW * 0.18, headZ],
      [genX1 + len * 0.08, midY + side * engineW * 0.18, valveZ + height * 0.14],
      Math.min(0.14, wid * 0.12),
      24,
    );
  }

  /** Кожух вентилятора, радиатор с решёткой, пробка. */
  dguRadiator(item, geom, { body, dk: dark }, own) {
    const [, y0, , x1, y1, z1] = geom.B;
    const { L: len, W: wid, cy: midY, fb: baseTop, xr: radX } = geom;
    dark.tube(
      [radX - 0.06, midY, baseTop + (z1 - baseTop) * 0.5],
      [radX, midY, baseTop + (z1 - baseTop) * 0.5],
      Math.min(wid * 0.42, (z1 - baseTop) * 0.42),
      32,
    );
    body.box([radX, y0 + wid * 0.04, baseTop], [x1, y1 - wid * 0.04, z1], 0.02);
    if (own)
      this.scene.air.grille(
        { ...item, x: item.x + item.lx * 0.84, lx: item.lx * 0.16 },
        [0.08, 0.92],
        [0.12, 0.92],
        12,
        1,
      );
    else
      for (let k = 0; k < 12; k++) {
        const z = baseTop + (z1 - baseTop) * (0.12 + k * 0.066);
        dark.box([x1, y0 + wid * 0.1, z], [x1 + 0.008, y1 - wid * 0.1, z + 0.012]);
      }
    dark.tube([x1 - len * 0.08, midY, z1], [x1 - len * 0.08, midY, z1 + 0.04], 0.04, 14);
  }

  /** Пульт на стойке над генератором. */
  dguPanel(geom, { M: meshFor, dk: dark }) {
    const [, y0, z0, , y1] = geom.B;
    const { L: len, W: wid, H: height, s: side, xa: genX0, R: genR, zc: midZ } = geom;
    const panelY = side < 0 ? y0 + wid * 0.12 : y1 - wid * 0.12;
    dark.box([genX0 + len * 0.06, panelY - 0.02, midZ + genR], [genX0 + len * 0.08, panelY + 0.02, z0 + height * 0.78]);
    dark.box(
      [genX0 + len * 0.02, panelY, z0 + height * 0.78],
      [genX0 + len * 0.2, panelY + side * 0.14, z0 + height * 0.97],
      0.01,
    );
    const screenY = side < 0 ? [panelY - 0.002 + side * 0.14, panelY + side * 0.14] : [panelY + 0.14, panelY + 0.142];
    meshFor(StMat.glow('#9fd4ff', 1.2)).box(
      [genX0 + len * 0.05, screenY[0], z0 + height * 0.86],
      [genX0 + len * 0.13, screenY[1], z0 + height * 0.93],
    );
  }

  /** Бак. */
  tank(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const mesh = this.scene.meshFor(StMat.paint(item.color, 0.42));
    const dark = this.scene.meshFor(StMat.paint(StMat.DARK, 0.6));
    dark.box([x0 - 0.02, y0 - 0.02, z0], [x1 + 0.02, y1 + 0.02, z0 + 0.06], 0.004);
    mesh.box([x0, y0, z0 + 0.06], [x1, y1, z1], 0.03);
    this.scene.tones(item, [x0, y0, z0 + 0.06], [x1, y1, z1], 0.03);
    dark.tube([x0 + (x1 - x0) * 0.2, (y0 + y1) / 2, z1], [x0 + (x1 - x0) * 0.2, (y0 + y1) / 2, z1 + 0.09], 0.07, 20);
    this.scene
      .meshFor(StMat.metal(StMat.GALV, 0.35))
      .tube([x0 + (x1 - x0) * 0.75, (y0 + y1) / 2, z1], [x0 + (x1 - x0) * 0.75, (y0 + y1) / 2, z1 + 0.15], 0.015, 10);
    const gauge = this.scene.front(item, 0.88, 0.15, 0.015);
    this.scene
      .meshFor(StMat.paint('#d9e0e6', 0.15))
      .box(
        [gauge[0] - 0.015, gauge[1], gauge[2]],
        [gauge[0] + 0.015, gauge[1] - this.scene.side(item) * 0.015, gauge[2] + (z1 - z0) * 0.7],
      );
  }

  /** Шкаф. */
  cabinet(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const body = this.scene.meshFor(StMat.paint(color, 0.38));
    const dark = this.scene.meshFor(StMat.paint(StMat.DARK, 0.6));
    const steel = this.scene.meshFor(StMat.metal(StMat.GALV, 0.45));
    if (item.mount === 'floor') dark.box([x0 + 0.01, y0 + 0.01, z0], [x1 - 0.01, y1 - 0.01, z0 + 0.1], 0.004);
    body.box([x0, y0, z0 + (item.mount === 'floor' ? 0.1 : 0)], [x1, y1, z1], 0.012);
    this.scene.tones(item, [x0, y0, z0 + (item.mount === 'floor' ? 0.1 : 0)], [x1, y1, z1], 0.012);
    const seam = this.scene.meshFor(StMat.paint(RalColor.shade(color, 0.72), 0.5));
    this.scene.panel(seam, item, [0.03, 0.97], [0.025, 0.03], [0.002, 0]);
    this.scene.panel(seam, item, [0.03, 0.97], [0.97, 0.975], [0.002, 0]);
    this.scene.panel(seam, item, [0.03, 0.035], [0.03, 0.97], [0.002, 0]);
    this.scene.panel(seam, item, [0.965, 0.97], [0.03, 0.97], [0.002, 0]);
    this.scene.panel(dark, item, [0.86, 0.9], [0.42, 0.58], [0.02, 0.003]);
    for (const v of [0.12, 0.85]) this.scene.panel(dark, item, [0.03, 0.06], [v, v + 0.06], [0.012, 0.003]);
    if (/асу/i.test(String(item.name || ''))) this.cabinetHmi(item);
    else this.cabinetLamps(item, dark);
    this.cabinetMount(item, dark, steel);
  }

  /** АСУ ТП — панель оператора. */
  cabinetHmi(item) {
    this.scene.panel(this.scene.meshFor(StMat.paint('#1f2429', 0.25)), item, [0.2, 0.75], [0.52, 0.86], [0.008, 0.004]);
    this.scene.panel(this.scene.meshFor(StMat.glow('#79b8ff', 1.5)), item, [0.24, 0.71], [0.56, 0.82], [0.01, 0]);
  }

  /** Лампы (АВР — три), переключатель, табличка. */
  cabinetLamps(item, dark) {
    const lamps = /авр|резерв/i.test(String(item.name || ''))
      ? ['#3ccf5a', '#e2b33a', '#d84a3a']
      : ['#3ccf5a', '#d84a3a'];
    lamps.forEach((col, k) => {
      const point = this.scene.front(item, 0.22 + k * 0.13, 0.76, 0);
      this.scene.meshFor(StMat.glow(col, 1.4)).tube(point, StV.add(point, this.scene.out(item, 0.022)), 0.018, 14);
    });
    const base = this.scene.front(item, 0.32, 0.5, 0);
    const lampIn = StV.add(base, this.scene.out(item, 0.03));
    const lampOut = StV.add(base, this.scene.out(item, 0.045));
    const halfSize = this.scene.endwise(item) ? [0, 0.008, 0.04] : [0.008, 0, 0.04];
    dark.tube(base, lampIn, 0.035, 18);
    dark.box(
      [0, 1, 2].map(k => Math.min(lampIn[k], lampOut[k]) - halfSize[k]),
      [0, 1, 2].map(k => Math.max(lampIn[k], lampOut[k]) + halfSize[k]),
      0.003,
    );
    this.scene.panel(this.scene.meshFor(StMat.paint('#f2f2ee', 0.4)), item, [0.15, 0.6], [0.86, 0.93], [0.004, 0]);
  }

  /** Настенный — кронштейны у стены, на раме — стойки. */
  cabinetMount(item, dark, steel) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const side = this.scene.side(item);
    if (item.mount === 'wall') {
      const end = this.scene.endwise(item);
      const [backX, backY] = side < 0 ? [x1, y1] : [x0, y0];
      const back = end ? backX : backY;
      for (const v of [0.08, 0.92]) {
        const bracketZ = z0 + (z1 - z0) * v - 0.02;
        if (end) dark.box([back, y0 + 0.03, bracketZ], [back + side * 0.03, y1 - 0.03, bracketZ + 0.04]);
        else dark.box([x0 + 0.03, back, bracketZ], [x1 - 0.03, back + side * 0.03, bracketZ + 0.04]);
      }
    } else if (item.mount === 'frame') {
      const midY = (y0 + y1) / 2;
      for (const x of [x0 + (x1 - x0) * 0.12, x1 - (x1 - x0) * 0.12 - 0.042])
        steel.box([x, midY - 0.021, this.scene.base], [x + 0.042, midY + 0.021, z0], 0.004);
      steel.box([x0 + 0.02, midY - 0.15, this.scene.base], [x1 - 0.02, midY + 0.15, this.scene.base + 0.01]);
    }
  }

  /** Прочее изделие — короб с лицевой стороной. */
  other(item) {
    const [x0, y0, z0, x1, y1, z1] = this.scene.extent(item);
    const color = item.color;
    const body = this.scene.meshFor(StMat.paint(color, 0.42));
    this.scene
      .meshFor(StMat.paint(StMat.DARK, 0.6))
      .box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + 0.06], 0.004);
    body.box([x0, y0, z0 + 0.06], [x1, y1, z1], 0.015);
    this.scene.tones(item, [x0, y0, z0 + 0.06], [x1, y1, z1], 0.015);
    this.scene.panel(
      this.scene.meshFor(StMat.paint(RalColor.shade(color, 0.75), 0.5)),
      item,
      [0.08, 0.3],
      [0.7, 0.85],
      [0.006, 0.003],
    );
  }
}
