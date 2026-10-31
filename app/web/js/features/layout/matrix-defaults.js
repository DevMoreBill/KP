/** Числа расстановки по умолчанию; действующие — правило layout.matrix («Настройки → Правила компоновки»). */
export class MatrixDefaults {
  // prettier-ignore
  static DEF = {
  gap: { v: 50 },
  pair: {
    rows: [
      { a: 'compressor', b: 'compressor', base: 1000, k: 0.3, of: 'compressor.w', min: 700 },
      { a: 'compressor', b: 'dryer', base: 800, k: 0.5, of: 'dryer.w', min: 600 },
      { a: 'dryer', b: 'receiver', base: 700, k: 0.5, of: 'receiver.w', min: 500 },
      { a: 'compressor', b: 'receiver', base: 700, k: 0.5, of: 'receiver.w', min: 500 },
      { a: 'receiver', b: 'receiver', base: 300, k: 0.4, of: 'receiver.w', min: 300, close: true },
      { a: 'filter', b: 'filter', base: 300, k: 0, of: '', min: 150, close: true },
      { a: 'dryer', b: 'dryer', base: 800, k: 0.5, of: 'dryer.w', min: 600 },
    ],
  },
  wall: {
    rows: [
      { kind: 'compressor', base: 500, k: 0.4, tight: 100 },
      { kind: 'dryer', base: 300, k: 0.4, tight: 150 },
      { kind: 'receiver', base: 300, k: 0, tight: 300 },
      { kind: 'pump', base: 300, k: 0.4, tight: 100 },
      { kind: 'other', base: 300, k: 0.4, tight: 100 },
    ],
  },
  access: { back: 500, side: 600 },
  sides: {
    rows: [
      { kind: 'compressor', s: 'ФЗЛП' },
      { kind: 'dryer', s: 'Ф', door: false },
      { kind: 'receiver', s: 'Ф', door: false, tilt: true },
      { kind: 'pump', s: 'ФЛП' },
      { kind: 'dgu', s: 'ФЛП' },
      { kind: 'cabinet', s: 'Ф', tilt: true },
      { kind: 'other', s: 'Ф' },
      { kind: 'tank', s: 'Ф', tilt: true },
      { kind: 'filter', s: 'Ф', tilt: true },
    ],
  },
  rotate: {
    rows: [
      { kind: 'compressor', on: true },
      { kind: 'dryer', on: true },
      { kind: 'receiver', on: true },
      { kind: 'pump', on: true },
      { kind: 'other', on: true },
      { kind: 'dgu', on: false },
      { kind: 'cabinet', on: false },
    ],
  },
  gate: { addW: 200, addH: 200, full: 0.75, twoAt: 8000, minW: 1500, minH: 2100, top: 100 },
  service: { addW: 200, addH: 200, minH: 1500, min: 800, max: 2400, leaf: 1200, step: 100, wall: 1 },
  door: { w: 900, h: 2000, gap: 300, edge: 300, pad: 100 },
  aisle: { service: 600 },
  exits: { dist: 5000, far: 7000 },
  exhaust: { louvre: 300, over: 300 },
  fit: {
    dense: 1, roadW: 2550, wide: 1, maxL: 12000, minL: 2000, minW: 1500, minH: 2000, hWalk: 2100, maxW: 3500,
    maxH: 3200, step: 100, two: 25, ends: 10, recv2: 1000, growVent: 3000, growHeat: 500,
  },
  modes: { ends: 1, tight: 1, cross: 1, next: 1000 },
  recv: { pairSide: 300, outGap: 1000, outStep: 600, pad: 100, upright: 1, close: 1, pairWall: 100 },
  cab: { top: 1900, low: 300 },
  move: { pass: 25 },
  tank: {
    pad: 300, gap: 300, back: 100, aisle: 600, part: 100, door: 800, fill: 1000, max: 4500, gates: 1, h1: 1000,
    h2: 1500, big: 2000, w1: 800, w2: 1000, step: 50, wall: 4, top: 300, wMax: 3000, room: 2290,
  },
  conv: { z: 150, gap: 100, edge: 100, front: 150, h: 400, d: 90 },
  dgu: { rad: 50, rot: 1, two: 1, across: 3, pass: 400, convGap: 50, convEdge: 50, convFront: 100 },
  muffler: { gap: 200, outlet: 300 },
  mods: { max: 9, post: 200, wMin: 2448, wMax: 2550, lMin: 7000 },
  look: { align: 600, even: 1, lines: 1, modStep: 2, tidy: 1 },
  shell: {
    ins: 100, seaLining: 15, seaFloor: 50, blockWall: 20, blockFloor: 150, blockRoof: 60, weldWall: 10,
    weldFloor: 160, weldRoof: 60, northWall: 20, northFloor: 200, northRoof: 80, tambour: 1200, gable: 8, mono: 5,
  },
  pick: { max: 4, over: 30, recvFit: 300, dryerFit: 100, recvFree: 6, recvAny: 4, oneSup: 10 },
  pipe: { airY: 150, pad: 60, outGap: 150, outEdge: 300, flange: 150 },
  pumps: { kw: 22, len: 1200, back: 300, backMin: 100, side: 700, sideMin: 250, top: 300, topMin: 100 },
  grille: {
    step: 50, gap: 200, near: 450, inZ: 200, inHmin: 300, inHmax: 1200, inWmin: 400, inWmax: 1500, whole: 2400,
    maxn: 4, outTop: 420, outHmin: 300, outHmax: 800, outWmin: 400, outWmax: 1500, piece: 600, lift: 750,
    fanMin: 500, roofHood: 420, hoodSide: 80, hoodLap: 50, hoodAng0: 30, hoodAng1: 75, hoodLow: 100, hoodGap: 300,
    radV: 7.5,
  },
  mass: {
    frame: 110, pBlock: 22, pNorth: 27, pWelded: 38, lining: 12, floor: 45, otherK: 0.05, otherKg: 100, angle: 45,
    lugL: 90, lugW: 60, beamL: 6500, beamZ: 2000, beamTop: 1500, sprZ: 1500, sprD: 1500, sprTop: 2000,
    tare10: 1300, tare20: 2250, tare20hc: 2350, tare40: 3750, tare40hc: 3900,
  },
  light: { plane: 800, lampW: 36, lampLm: 3600, lampLen: 1200, small: 15, flood: 30, exit: 3, fuelPump: 2.4 },
  fire: {
    modArea: 7, modVolA: 18, modVolB: 16, modSide: 2640, modZ0: 2500, modZ1: 3500, k1: 1, k3: 1, k4: 1,
    shadeH: 600, shadeGap: 150, ext: 1500, modD: 250, modH: 154, modKg: 3,
  },
  power: {
    dryerK: 0.2, dryerMin: 0.3, dryerAds: 0.1, dguHeat: 2, dguHeatBig: 3, dguHeatKw: 250, charger: 0.1,
    fuelPumpKw: 0.37, s230: 3.5, s230k: 0.3, s380: 11, s380k: 0.2, ytp: 0.25, ytpK: 0.5, valves: 0.05, ops: 0.05,
    asu: 0.3, sockStep: 4000, sockMin: 2, sock380: 1, sockZ: 1000,
  },
};
}
