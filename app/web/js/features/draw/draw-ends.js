import { Mm } from '../layout/mm.js';
import { EquipIcon } from '../eskd/equip-icon.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { StationVent } from '../layout/station-vent.js';

/** Виды с торцов: ворота, двери, жалюзи, колпаки, двери-жалюзи и выхлоп ДГУ, размеры. */
export class DrawEnds {
  constructor(drawing) {
    this.drawing = drawing;
  }

  /** Вид слева: торец у двери снаружи. */
  end(sheet, x0) {
    const { scale: k, We, oy, floorZ: floorZ } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    const toX = y => x0 + (We - y) * k;
    this.endBody(sheet, toX, false);
    const fuel = this.drawing.fuel;
    if (fuel && fuel.fill.wall === 'left') {
      const barW = Math.max(1.2, 220 * k);
      const [fillX, fillZ] = [toX(oy + fuel.fill.y), toZ(floorZ + fuel.fill.z)];
      sheet.rect([fillX - barW / 2, fillZ - barW / 2, barW, barW], 'main', '#fff');
      sheet.line(fillX - barW / 2, fillZ - barW / 2 + 0.5, fillX + barW / 2, fillZ - barW / 2 + 0.5, 'thin');
    }
    const [cornerW, chh] = this.endCorners(sheet, toX);
    if (this.drawing.geo.sea) this.seaDoors(sheet, toX, chh);
    else this.leftOpenings(sheet, toX, [cornerW, chh]);
    const vent = louver =>
      this.louverEnd(
        sheet,
        [toX(oy + louver.u1), toX(oy + louver.u0)],
        [toZ(floorZ + louver.z1), toZ(floorZ + louver.z0)],
        louver.fan,
      );
    for (const louver of this.drawing.vents('left', true)) vent(louver);
    this.roofHoods(sheet, toX);
    for (const louver of this.drawing.vents('left')) vent(louver);
    for (const louver of [...this.drawing.vents('left'), ...this.drawing.vents('left', true)].filter(
      hooded => hooded.hood,
    ))
      this.hoodEnd(sheet, toX, louver);
    this.endMufflers(sheet, toX, false);
  }

  /** Шасси, корпус и крыша с торца (P — ширина → лист; rev — порядок вершин крыши для вида справа). */
  endBody(sheet, toX, rev) {
    const { scale: k, We, He, rise: rise } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    const x0 = toX(rev ? 0 : We);
    if (this.drawing.dz) {
      const [wheel, wheelW] = [420 * k, 300 * k];
      sheet.rect([x0 + 40 * k, toZ(0), We * k - 80 * k, 200 * k], 'main', '#fff');
      for (const x of [x0 + 60 * k, x0 + We * k - 60 * k - wheelW])
        sheet.rect([x, this.drawing.ground - 2 * wheel, wheelW, 2 * wheel], 'main', '#fff');
      sheet.line(x0 - 3, this.drawing.ground, x0 + We * k + 3, this.drawing.ground, 'thin');
    }
    sheet.rect([x0, toZ(He), We * k, He * k], 'main', '#fff');
    if (!rise) return;
    const roof = this.drawing.geo.roof;
    if (roof === 'arch') {
      const radius = ((We * We) / 4 + rise * rise) / (2 * rise);
      const arc = [];
      for (let j = 0; j <= 16; j++) {
        const y = (We * j) / 16;
        arc.push([
          toX(y),
          toZ(He + rise - radius + Math.sqrt(Math.max(0, radius * radius - (y - We / 2) * (y - We / 2)))),
        ]);
      }
      sheet.poly(arc, 'main', '#fff');
      return;
    }
    // двускатная — конёк посередине; односкатная — выше у стены с дверью
    const roofPts =
      roof === 'gable'
        ? [
            [toX(We), toZ(He)],
            [toX(We / 2), toZ(He + rise)],
            [toX(0), toZ(He)],
          ]
        : [
            [toX(We), toZ(He)],
            [toX(0), toZ(He + rise)],
            [toX(0), toZ(He)],
          ];
    sheet.poly(rev ? roofPts.reverse() : roofPts, 'main', '#fff');
  }

  /** Угловые фитинги (стойки) и стыки модулей; возвращает размер фитинга [cw, chh]. */
  endCorners(sheet, toX) {
    const { scale: k, We, He } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    const cornerW = Math.max(0.6, 160 * k);
    const chh = Math.max(0.6, 120 * k);
    const [low, high] = [Math.min(toX(0), toX(We)), Math.max(toX(0), toX(We))];
    for (const [x, y] of [
      [low, toZ(He)],
      [high - cornerW, toZ(He)],
      [low, toZ(0) - chh],
      [high - cornerW, toZ(0) - chh],
    ])
      sheet.rect([x, y, cornerW, chh], 'thin');
    const mods = this.drawing.plan.geo.mods;
    if (mods && mods.Lm)
      for (let j = 1; j < mods.b; j++)
        sheet.line(toX(j * mods.Wm), toZ(He) - 2, toX(j * mods.Wm), toZ(0) + 2, 'phantom');
    return [cornerW, chh];
  }

  /** Штатные двери морского контейнера: две створки, запорные штанги. */
  seaDoors(sheet, toX, chh) {
    const { scale: k, We, He } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    const midX = (toX(We) + toX(0)) / 2;
    const [y1, y2] = [toZ(He) + chh, toZ(0) - chh];
    sheet.line(midX, y1, midX, y2, 'main');
    for (const frac of [0.18, 0.36, 0.64, 0.82]) {
      const x = toX(We) + We * k * frac;
      sheet.line(x, y1 + 0.6, x, y2 - 0.6, 'thin');
    }
  }

  /** Торец у входа блок-контейнера: стойки, ворота (и отсека бака), дверь оператора, дверь-жалюзи ДГУ. */
  leftOpenings(sheet, toX, [cornerW, chh]) {
    const { We, He, oy, floorZ: floorZ } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    sheet.line(toX(We) + cornerW * 0.5, toZ(He) + chh, toX(We) + cornerW * 0.5, toZ(0) - chh, 'thin');
    sheet.line(toX(0) - cornerW * 0.5, toZ(He) + chh, toX(0) - cornerW * 0.5, toZ(0) - chh, 'thin');
    for (const gate of this.drawing.gates) if (gate.wall === 'left') this.gateEnd(sheet, toX, gate);
    if (this.drawing.fuel && this.drawing.fuel.gate) this.gateEnd(sheet, toX, this.drawing.fuel.gate);
    if (this.drawing.entry && this.drawing.entry.wall === 'left') this.doorEnd(sheet, toX, this.drawing.entry);
    const door = this.drawing.dguLeft;
    if (door) this.dguDoorView(sheet, toX(oy + door.y1), toX(oy + door.y0), toZ(floorZ + door.h), toZ(floorZ));
  }

  /** Колпаки выброса на крыше — с торца. */
  roofHoods(sheet, toX) {
    const { scale: k, He, oy } = this.drawing;
    const hoodH = Math.max(1, StationVent.HOOD * k);
    for (const roof of this.drawing.hoods())
      sheet.rect(
        [
          Math.min(toX(oy + roof.y0), toX(oy + roof.y1)),
          this.drawing.sheetZ(He) - hoodH,
          (roof.y1 - roof.y0) * k,
          hoodH,
        ],
        'main',
        '#fff',
      );
  }

  /** Глушители с торца: вдоль — круг корпуса на опоре (справа — с выходом), поперёк — сбоку. */
  endMufflers(sheet, toX, out) {
    const { scale: k, He, oy } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    for (const muffler of this.drawing.roofItems) {
      if (muffler.dir === 'y+') {
        this.drawing.side.mufflerAcross(sheet, toX, muffler);
        continue;
      }
      const midX = toX(oy + muffler.y + muffler.d / 2);
      const midZ = toZ(He + muffler.gap + muffler.d / 2);
      sheet.line(midX, toZ(He), midX, toZ(He + muffler.gap), 'main');
      sheet.circle(midX, midZ, (muffler.d / 2) * k, 'main', '#fff');
      if (out) sheet.circle(midX, midZ, Math.max(0.6, 60 * k), 'main', '#fff');
    }
  }

  /** Дверь-жалюзи ДГУ на виде. */
  dguDoorView(sheet, leftX, rightX, topZ, botZ) {
    const k = this.drawing.scale;
    const low = Math.min(leftX, rightX);
    const high = Math.max(leftX, rightX);
    const midX = (low + high) / 2;
    this.louverEnd(sheet, [low, midX], [topZ, botZ]);
    this.louverEnd(sheet, [midX, high], [topZ, botZ]);
    sheet.rect([low, topZ, high - low, botZ - topZ], 'main');
    for (const frac of [0.15, 0.5, 0.85]) {
      const z = topZ + (botZ - topZ) * frac;
      const pipeW = Math.max(0.8, 120 * k);
      sheet.rect([low - 0.5, z, 0.8, pipeW], 'thin', '#000');
      sheet.rect([high - 0.3, z, 0.8, pipeW], 'thin', '#000');
    }
    for (const dx of [-0.7, 0.7]) sheet.line(midX + dx, topZ + 0.6, midX + dx, botZ - 0.6, 'thin');
  }
  /** Выхлоп ДГУ через стену на виде снаружи: гильза и отвод (окружности). */
  exhaustView(sheet, x, z) {
    const radius = Math.max(0.8, 55 * this.drawing.scale);
    sheet.circle(x, z, radius * 1.9, 'thin', '#fff');
    sheet.circle(x, z, radius, 'main', '#fff');
  }
  /** Распашные ворота на виде с торца: проём y0…y1 (мм внутри), две створки, запорные штанги; X — y → x на листе. */
  gateEnd(sheet, toX, door) {
    const toZ = louver => this.drawing.sheetZ(louver);
    const leftX = toX(this.drawing.oy + door.y0);
    const rightX = toX(this.drawing.oy + door.y1);
    const topZ = toZ(this.drawing.floorZ + door.h);
    const botZ = toZ(this.drawing.floorZ);
    const midX = (leftX + rightX) / 2;
    const low = Math.min(leftX, rightX);
    const width = Math.abs(rightX - leftX);
    sheet.rect([low, topZ, width, botZ - topZ], 'main', '#fff');
    sheet.line(midX, topZ, midX, botZ, 'main');
    for (const dx of [-0.7, 0.7]) sheet.line(midX + dx, topZ + 0.6, midX + dx, botZ - 0.6, 'thin');
    if (door.wicket) {
      const wicketY = door.y0 + 80;
      const wicketL = toX(this.drawing.oy + wicketY);
      const wicketR = toX(this.drawing.oy + wicketY + door.wicket.w);
      const wicketZ = toZ(this.drawing.floorZ + 60 + door.wicket.h);
      const z0 = toZ(this.drawing.floorZ + 60);
      // калитка в створке
      sheet.rect([Math.min(wicketL, wicketR), wicketZ, Math.abs(wicketR - wicketL), z0 - wicketZ], 'main');
    }
  }
  /** Одностворчатая дверь оператора на виде с торца: полотно, ручка. */
  doorEnd(sheet, toX, door) {
    const toZ = louver => this.drawing.sheetZ(louver);
    const leftX = toX(this.drawing.oy + door.y0);
    const rightX = toX(this.drawing.oy + door.y1);
    const topZ = toZ(this.drawing.floorZ + door.h);
    const botZ = toZ(this.drawing.floorZ);
    const low = Math.min(leftX, rightX);
    const width = Math.abs(rightX - leftX);
    sheet.rect([low, topZ, width, botZ - topZ], 'main', '#fff');
    const handleX = low + width * 0.85;
    const handleZ = toZ(this.drawing.floorZ + 1000);
    sheet.line(handleX, handleZ - 0.8, handleX, handleZ + 0.8, 'main');
  }
  /** Маркиза на виде с торца. */
  hoodEnd(sheet, toX, louver) {
    const toZ = louver => this.drawing.sheetZ(louver);
    const hood = louver.hood;
    const side = StationVent.HOOD_SIDE;
    const hoodZ = this.drawing.floorZ + louver.z1 + StationVent.HOOD_LAP;
    const leftX = toX(this.drawing.oy + louver.u0 - side);
    const rightX = toX(this.drawing.oy + louver.u1 + side);
    const low = Math.min(leftX, rightX);
    const width = Math.abs(rightX - leftX);
    const topZ = toZ(hoodZ);
    const lowZ = toZ(hoodZ - hood.drop);
    const louverX = Math.min(toX(this.drawing.oy + louver.u0), toX(this.drawing.oy + louver.u1));
    const louverW = Math.abs(toX(this.drawing.oy + louver.u1) - toX(this.drawing.oy + louver.u0));
    sheet.rect([low, topZ, width, lowZ - topZ], 'main', '#fff');
    const z0 = toZ(this.drawing.floorZ + louver.z1);
    const z1 = Math.min(lowZ, toZ(this.drawing.floorZ + louver.z0));
    if (z1 > z0) sheet.rect([louverX, z0, louverW, z1 - z0], 'dash'); // жалюзи за козырьком
    sheet.line(
      low,
      lowZ - Math.max(0.4, 35 * this.drawing.scale),
      low + width,
      lowZ - Math.max(0.4, 35 * this.drawing.scale),
      'thin',
    ); // отбортовка кромки
  }
  /** Жалюзи на виде с торца: рамка и ламели. */
  /** Вентилятор в проёме жалюзи (вид снаружи): окружности осевых вентиляторов (число — по форме проёма). */
  fanEnd(sheet, leftX, rightX, topZ, botZ) {
    const width = Math.abs(rightX - leftX);
    const height = Math.abs(botZ - topZ);
    const num = Math.max(1, Math.round(width / height));
    const x0 = Math.min(leftX, rightX);
    const radius = Math.min(width / num, height) * 0.42;
    for (let i = 0; i < num; i++) {
      const fanX = x0 + (width / num) * (i + 0.5);
      const fanZ = (topZ + botZ) / 2;
      sheet.circle(fanX, fanZ, radius, 'thin');
      sheet.circle(fanX, fanZ, Math.max(0.3, radius * 0.25), 'thin', '#fff');
    }
  }
  /** Жалюзи на виде с торца (с вентилятором — fan). */
  louverEnd(sheet, [leftX, rightX], [topZ, botZ], fan) {
    const k = this.drawing.scale;
    sheet.rect([Math.min(leftX, rightX), topZ, Math.abs(rightX - leftX), botZ - topZ], 'main', '#fff');
    for (let z = topZ + Math.max(0.8, 70 * k); z < botZ - 0.4; z += Math.max(0.8, 70 * k))
      sheet.line(Math.min(leftX, rightX) + 0.4, z, Math.max(leftX, rightX) - 0.4, z, 'fine');
    if (fan) this.fanEnd(sheet, leftX, rightX, topZ, botZ);
  }
  /** Вид справа: дальний торец снаружи. */
  endR(sheet, x0) {
    const { scale: k, oy, floorZ: floorZ } = this.drawing;
    const toZ = louver => this.drawing.sheetZ(louver);
    const toX = y => x0 + y * k;
    this.endBody(sheet, toX, true);
    this.endCorners(sheet, toX);
    const door = this.drawing.dguRight;
    if (door) this.dguDoorView(sheet, toX(oy + door.y0), toX(oy + door.y1), toZ(floorZ + door.h), toZ(floorZ));
    const vent = louver =>
      this.louverEnd(
        sheet,
        [toX(oy + louver.u0), toX(oy + louver.u1)],
        [toZ(floorZ + louver.z1), toZ(floorZ + louver.z0)],
        louver.fan,
      );
    for (const louver of this.drawing.vents('right')) vent(louver);
    for (const gate of this.drawing.gates) if (gate.wall === 'right' && !gate.sea) this.gateEnd(sheet, toX, gate);
    if (this.drawing.plan.exit) this.doorEnd(sheet, toX, this.drawing.plan.exit);
    for (const louver of this.drawing.vents('right', true)) vent(louver);
    for (const louver of [...this.drawing.vents('right'), ...this.drawing.vents('right', true)].filter(
      gate => gate.hood,
    ))
      this.hoodEnd(sheet, toX, louver);
    this.roofHoods(sheet, toX);
    for (const out of this.drawing.outs) this.drawing.side.flangeFace(sheet, toX(oy + out.y), toZ(floorZ + out.z));
    this.endMufflers(sheet, toX, true);
    for (const item of [...this.drawing.outside].sort((first, second) => second.x - first.x))
      EquipIcon.front(sheet, item, [
        toX(oy + item.y),
        toZ(floorZ + item.z + item.h),
        toX(oy + item.y + item.ly),
        toZ(floorZ + item.z),
      ]);
  }
  /** Размеры видов с торцов: ширина — снизу, высота (и с крышей) — слева; у двери-жалюзи ДГУ — её размеры. */
  endDims(sheet, x0, left) {
    const k = this.drawing.scale;
    const We = this.drawing.We;
    const He = this.drawing.He;
    const toZ = louver => this.drawing.sheetZ(louver);
    const num = Mm.text;
    const toX = y => (left ? x0 + (We - y) * k : x0 + y * k);
    const leftX = Math.min(toX(0), toX(We));
    const rightX = Math.max(toX(0), toX(We));
    sheet.dimH([leftX, rightX], this.drawing.ground + 8, num(We), [this.drawing.ground, this.drawing.ground]);
    let dimX = leftX - 8;
    sheet.dimV([toZ(He), toZ(0)], dimX, num(He), [leftX, leftX]);
    if (this.drawing.rise) {
      dimX -= 7;
      sheet.dimV([toZ(He + this.drawing.rise), toZ(0)], dimX, num(He + this.drawing.rise), [
        (leftX + rightX) / 2,
        leftX,
      ]);
    }
    const door = left ? this.drawing.dguLeft : this.drawing.dguRight; // у двери-жалюзи ДГУ — её размеры
    if (door) {
      const x1 = toX(this.drawing.oy + door.y0);
      const x2 = toX(this.drawing.oy + door.y1);
      sheet.dimH([x1, x2], this.drawing.ground + 15, num(door.w), [toZ(this.drawing.floorZ), toZ(this.drawing.floorZ)]);
      sheet.dimV([toZ(this.drawing.floorZ + door.h), toZ(this.drawing.floorZ)], rightX + 6, num(door.h), [x2, x2]);
    }
    this.gateDims(sheet, toX, rightX, left);
  }
  /** Ворота в торце: ось торца (штрихпунктирная), ширина и высота проёма; смещённые — ось ворот и размер смещения. */
  gateDims(sheet, toX, rightX, left) {
    const toZ = louver => this.drawing.sheetZ(louver);
    const num = Mm.text;
    const two = !left && this.drawing.dguRight;
    const axisX = toX(this.drawing.We / 2);
    for (const gate of this.drawing.gates.filter(gate => !gate.sea && gate.wall === (left ? 'left' : 'right'))) {
      const x1 = toX(this.drawing.oy + gate.y0);
      const x2 = toX(this.drawing.oy + gate.y1);
      const low = Math.min(x1, x2);
      const high = Math.max(x1, x2);
      const gateX = (low + high) / 2;
      const dimY = this.drawing.ground + (two ? 22 : 15);
      sheet.line(axisX, toZ(this.drawing.He) - 3, axisX, this.drawing.ground + 3, 'axis');
      if (!gate.full) sheet.dimH([low, high], dimY, num(gate.w), [toZ(this.drawing.floorZ), toZ(this.drawing.floorZ)]);
      if (gate.off) {
        sheet.line(gateX, toZ(this.drawing.floorZ + gate.h) - 7, gateX, this.drawing.ground + 3, 'axis');
        sheet.dimH(
          [Math.min(axisX, gateX), Math.max(axisX, gateX)],
          toZ(this.drawing.floorZ + gate.h) - 4,
          num(Math.abs(gate.off)),
          [null, null],
          {
            out: gateX > axisX ? 'r' : 'l',
          },
        );
      } // над проёмом
      sheet.dimV([toZ(this.drawing.floorZ + gate.h), toZ(this.drawing.floorZ)], rightX + (two ? 12 : 6), num(gate.h), [
        high,
        high,
      ]);
    }
  }
  /** Стрелка направления взгляда с буквой (ГОСТ 2.305): острие у контура, dir — куда смотрит (±1 по x). */
  viewArrow(sheet, x, y, dir, letter) {
    const len = 7;
    sheet.line(x - dir * len, y, x - dir * EskdSheet.ARROW[0], y, 'thin');
    sheet.arrow(x, y, dir, 0);
    sheet.text(x - (dir * len) / 2, y - 1.6, letter, 5, { a: 'middle' });
  }
}
