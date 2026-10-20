import { Mm } from '../layout/mm.js';
import { IconParts } from '../eskd/icon-parts.js';
import { IconUnits } from '../eskd/icon-units.js';
import { EquipIcon } from '../eskd/equip-icon.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { PneuSymbol } from '../eskd/pneu-symbol.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationVent } from '../layout/station-vent.js';

/** Разрез А–А: вдоль контейнера у стены прохода — оборудование, трубопровод, выходы, шасси, глушитель. */
export class DrawSide {
  constructor(drawing) {
    this.drawing = drawing;
  }

  /** Разрез А–А: вдоль контейнера у стены прохода, взгляд на заднюю стену. */
  main(sheet, top) {
    const { left: left, right: right } = this.drawing;
    sheet.text((left + right) / 2, top + 5, 'А–А', 5, { a: 'middle' });
    if (this.drawing.hidden.length) {
      // снятое для наглядности — надписью над изображением (ГОСТ Р 2.109)
      const hidden = [...new Set(this.drawing.hidden.map(i => i.pos))];
      const many = hidden.length > 1;
      const note = `${many ? 'Шкафы' : 'Шкаф'} поз. ${hidden.join(', ')} не ${many ? 'показаны' : 'показан'}`;
      sheet.text((left + right) / 2, top + 9.4, note, 2.5, { a: 'middle' });
    }
    if (this.drawing.dz) this.chassisSide(sheet);
    this.shell(sheet);
    this.fuelWall(sheet);
    this.backWall(sheet);
    this.equipment(sheet);
    for (const muffler of this.drawing.roofItems) this.muffler(sheet, muffler);
    const outRes = this.drawing.outside.length ? this.outMain(sheet) : null;
    if (!outRes) for (const out of this.drawing.outs) this.outlet(sheet, out);
    for (const out of this.drawing.souts.filter(sout => sout.wall === 'back'))
      this.flangeFace(
        sheet,
        this.drawing.sheetX(this.drawing.ox + out.x),
        this.drawing.sheetZ(this.drawing.floorZ + out.z),
      );
    // линия сечения Б–Б — под потолком, взгляд вниз
    const labelZ = this.drawing.sheetZ(this.drawing.floorZ + this.drawing.Hi - Math.min(120, this.drawing.Hi * 0.05));
    this.cutMark(sheet, left - 1.5, labelZ, -1, 'Б');
    this.cutMark(sheet, this.drawing.outerRight + 1.5, labelZ, 1, 'Б');
    this.dims(sheet, outRes);
  }

  /** Стенки, пол и кровля в сечении; скатная крыша — конёк за секущей плоскостью; стыки модулей; строповочные петли. */
  shell(sheet) {
    const { scale: k, ox, floorZ: floorZ, Le, He, Hi, Li, left: left } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    sheet.section(left, toZ(He), ox * k, He * k);
    sheet.section(toX(Le - ox), toZ(He), ox * k, He * k);
    sheet.section(toX(ox), toZ(floorZ), Li * k, floorZ * k);
    sheet.section(toX(ox), toZ(He), Li * k, (He - floorZ - Hi) * k);
    sheet.rect([left, toZ(He), Le * k, He * k], 'main');
    if (this.drawing.rise) sheet.rect([left, toZ(He + this.drawing.rise), Le * k, this.drawing.rise * k], 'main');
    const mods = this.drawing.plan.geo.mods;
    if (mods && mods.Lm)
      for (let i = 1; i < mods.a; i++)
        sheet.line(toX(i * mods.Lm), toZ(He) - 2, toX(i * mods.Lm), toZ(0) + 2, 'phantom');
    if (this.drawing.geo.sea) return;
    const lugW = Math.max(0.8, 160 * k);
    const lugH = Math.max(0.6, 120 * k);
    for (const x of [left + 30 * k, left + (Le - 190) * k]) {
      sheet.rect([x, toZ(He) - lugH, lugW, lugH], 'main', '#fff');
      sheet.circle(x + lugW / 2, toZ(He) - lugH * 0.45, Math.max(0.2, lugH * 0.25), 'thin', '#fff');
    }
  }

  /** Тамбур; отсек бака. */
  fuelWall(sheet) {
    const { scale: k, ox, floorZ: floorZ, Hi, left: left } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    const fuel = this.drawing.fuel;
    if (this.drawing.geo.x0 - (fuel ? fuel.x1 + fuel.part : 0) > 0)
      sheet.line(toX(ox + this.drawing.geo.x0), toZ(floorZ), toX(ox + this.drawing.geo.x0), toZ(floorZ + Hi), 'main');
    if (!fuel) return;
    sheet.section(toX(ox + fuel.x1), toZ(floorZ + Hi), fuel.part * k, Hi * k);
    if (fuel.fill.wall !== 'left') return;
    const tank = this.drawing.plan.items.find(i => i.tank);
    const fillZ = toZ(floorZ + fuel.fill.z);
    const barW = Math.max(1.2, 220 * k);
    sheet.rect([left, fillZ - barW / 2, Math.max(barW, ox * k + barW * 0.4), barW], 'main', '#fff');
    if (!tank) return;
    const fmt = EskdSheet.fmt;
    sheet.path(
      `M${fmt(left)},${fmt(fillZ)} H${fmt(toX(ox + tank.x + Math.min(150, tank.lx / 3)))} V${fmt(toZ(floorZ + tank.h))}`,
      'main',
    );
  }

  /** Задняя стена. */
  backWall(sheet) {
    const { scale: k, ox, floorZ: floorZ, He } = this.drawing;
    const toX = louver => this.drawing.sheetX(louver);
    const toZ = louver => this.drawing.sheetZ(louver);
    const { ends } = this.drawing;
    for (const heater of this.drawing.heaters.filter(unit => unit.wall === 'back'))
      sheet.rect([toX(ox + heater.x), toZ(floorZ + heater.z + heater.h), heater.lx * k, heater.h * k], 'thin', '#fff');
    for (const louver of this.drawing.vents('back'))
      ends.louverEnd(
        sheet,
        [toX(ox + louver.u0), toX(ox + louver.u1)],
        [toZ(floorZ + louver.z1), toZ(floorZ + louver.z0)],
        louver.fan,
      );
    for (const door of this.drawing.serviceBack) {
      const [leftX, rightX, topZ, botZ] = [toX(ox + door.x0), toX(ox + door.x1), toZ(floorZ + door.h), toZ(floorZ)];
      sheet.rect([leftX, topZ, rightX - leftX, botZ - topZ], 'main', '#fff');
      for (let i = 1; i < door.leaves; i++)
        sheet.line(
          leftX + ((rightX - leftX) * i) / door.leaves,
          topZ,
          leftX + ((rightX - leftX) * i) / door.leaves,
          botZ,
          'thin',
        );
    }
    for (const door of this.drawing.dguBack)
      ends.dguDoorView(sheet, toX(ox + door.x0), toX(ox + door.x1), toZ(floorZ + door.h), toZ(floorZ));
    for (const exhaust of this.drawing.wallExhausts)
      ends.exhaustView(sheet, toX(ox + exhaust.u), toZ(floorZ + exhaust.z));
    for (const louver of this.drawing.vents('back', true))
      ends.louverEnd(
        sheet,
        [toX(ox + louver.u0), toX(ox + louver.u1)],
        [toZ(floorZ + louver.z1), toZ(floorZ + louver.z0)],
        louver.fan,
      );
    for (const roof of this.drawing.hoods()) {
      const hoodH = Math.max(1, StationVent.HOOD * k);
      sheet.rect([toX(ox + roof.x0), toZ(He) - hoodH, (roof.x1 - roof.x0) * k, hoodH], 'main', '#fff');
      sheet.line(toX(ox + roof.x0) - 0.6, toZ(He) - hoodH, toX(ox + roof.x1) + 0.6, toZ(He) - hoodH, 'main');
    }
  }

  /** Оборудование: за трубопроводом — раньше, перед ним — после; на раме — стойки до пола. */
  equipment(sheet) {
    const { ox, floorZ: floorZ } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    const pipeY = this.drawing.lines.length ? Math.max(...this.drawing.lines.map(line => line.y)) : -Infinity;
    const shown = this.drawing.plan.items
      .filter(i => !this.drawing.hidden.includes(i))
      .sort((first, second) => second.y - first.y);
    const one = item => {
      const x1 = toX(ox + item.x);
      const x2 = toX(ox + item.x + item.lx);
      const footZ = toZ(floorZ + item.z);
      if (item.mount === 'frame')
        for (const legX of [x1 + (x2 - x1) * 0.12, x2 - (x2 - x1) * 0.12])
          sheet.line(legX, footZ, legX, toZ(floorZ), 'main');
      EquipIcon.front(sheet, item, [x1, toZ(floorZ + item.z + item.h), x2, footZ]);
    };
    for (const item of shown.filter(i => i.y > pipeY)) one(item);
    this.pipesMain(sheet);
    for (const item of shown.filter(i => i.y <= pipeY)) one(item);
  }

  /** Глушитель на крыше: опоры, корпус, вывод выхлопа горизонтально в сторону; выхлопная труба от ДГУ сквозь крышу. */
  muffler(sheet, muffler) {
    const { scale: k, ox, floorZ: floorZ, He } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    const [x1, x2] = [toX(ox + muffler.x), toX(ox + muffler.x + muffler.lx)];
    const [botZ, topZ] = [toZ(He + muffler.gap), toZ(He + muffler.gap + muffler.d)];
    const midZ = (botZ + topZ) / 2;
    if (muffler.exhaust) {
      const stackW = Math.max(0.8, 130 * k);
      sheet.rect(
        [toX(ox + muffler.exhaust.x) - stackW / 2, botZ, stackW, toZ(floorZ + muffler.exhaust.z) - botZ],
        'thin',
        '#fff',
      );
    }
    if (muffler.dir === 'y+') {
      const midX = (x1 + x2) / 2;
      sheet.line(midX, toZ(He), midX, botZ, 'main');
      sheet.circle(midX, midZ, (botZ - topZ) / 2, 'main', '#fff');
      sheet.circle(midX, midZ, Math.max(0.6, 60 * k), 'main', '#fff');
      return;
    }
    for (const frac of [0.18, 0.82]) sheet.line(x1 + (x2 - x1) * frac, toZ(He), x1 + (x2 - x1) * frac, botZ, 'main');
    const pipeW = Math.max(0.8, 120 * k);
    const back = muffler.dir === 'x-';
    const outX = toX(back ? ox + muffler.x - muffler.outlet : ox + muffler.x + muffler.lx + muffler.outlet);
    sheet.rect([back ? outX : x2, midZ - pipeW / 2, back ? x1 - outX : outX - x2, pipeW], 'thin', '#fff');
    sheet.line(outX, midZ - pipeW * 0.9, outX, midZ + pipeW * 0.9, 'main');
    IconUnits.muffler(sheet, x1, topZ, x2, botZ);
  }

  /** Выход трубопровода через дальний торец (над проёмом — с подъёмом) с фланцем и стрелкой. */
  outlet(sheet, out) {
    const { scale: k, ox, floorZ: floorZ, right: right } = this.drawing;
    const z = this.drawing.sheetZ(floorZ + out.z);
    const flangeX = right + Math.max(1.2, this.drawing.flange * k);
    if (out.l && out.l.out && out.l.out.rise) {
      const pipeX = this.drawing.sheetX(ox + out.l.x1);
      sheet.line(pipeX, this.drawing.sheetZ(floorZ + out.l.z), pipeX, z, 'pipe');
      sheet.line(pipeX, z, right, z, 'pipe');
    }
    sheet.line(right, z, flangeX + 5, z, 'pipe');
    this.flangeMark(sheet, flangeX, z, 'v');
    sheet.arrow(flangeX + 7.6, z, 1, 0);
  }

  /** Размеры справа. */
  dims(sheet, outRes) {
    const { ox, floorZ: floorZ, He, right: right, outerRight: outerRight } = this.drawing;
    const num = Mm.text;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    let dimX = outerRight + 16;
    const dim = (z, txt, x, x2 = right) => {
      sheet.dimV([z, toZ(0)], dimX, txt, [x, x2]);
      dimX += 7;
    };
    if (outRes) dim(outRes.y, num(outRes.z + this.drawing.dz), outRes.x, outerRight);
    else for (const out of this.drawing.outs) dim(toZ(floorZ + out.z), num(floorZ + out.z), right + 7.6);
    for (const out of this.drawing.souts.filter(sout => sout.wall === 'back'))
      dim(toZ(floorZ + out.z), num(floorZ + out.z), toX(ox + out.x));
    dim(toZ(He), num(He), right);
    if (this.drawing.rise) dim(toZ(He + this.drawing.rise), num(He + this.drawing.rise), right);
    const hoods = this.drawing.hoods();
    if (this.drawing.roofRise) {
      const muffler = this.drawing.roofItems[0];
      dim(toZ(He + this.drawing.roofRise), num(He + this.drawing.roofRise), toX(ox + muffler.x + muffler.lx * 0.86));
    } else if (hoods.length)
      dim(toZ(He + StationVent.HOOD), num(He + StationVent.HOOD), toX(ox + hoods[hoods.length - 1].x1));
    if (this.drawing.dz) {
      const above = Math.max(this.drawing.roofRise, this.drawing.hood);
      sheet.dimV([toZ(He + above), this.drawing.ground], dimX, num(He + above + this.drawing.dz), [null, right]);
    }
  }

  /** Ресиверы снаружи на разрезе А–А. */
  outMain(sheet) {
    const k = this.drawing.scale;
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    const { ox, floorZ: floorZ, right: right } = this.drawing;
    const pad = StationLayout.PAD;
    const fmt = EskdSheet.fmt;
    for (const item of [...this.drawing.outside].sort((first, col) => col.y - first.y)) {
      sheet.rect([toX(ox + item.x - 200), toZ(floorZ + item.z), (item.lx + 400) * k, pad * k], 'main', '#fff');
      EquipIcon.front(sheet, item, [
        toX(ox + item.x),
        toZ(floorZ + item.z + item.h),
        toX(ox + item.x + item.lx),
        toZ(floorZ + item.z),
      ]);
    }
    const out = this.drawing.outs[0];
    if (!out) return null;
    // ряды по удалению от стены; в ряду виден ближний к зрителю
    const cols = [];
    for (const item of [...this.drawing.outside].sort((first, col) => first.x - col.x || first.y - col.y)) {
      const col = cols.find(other => Math.abs(other.x - item.x) < 1);
      if (!col) cols.push(item);
    }
    const zin = unit =>
      floorZ + unit.z + (unit.shape === 'vcyl' && unit.h >= 900 ? Math.max(250, unit.h * 0.22) : unit.h / 2);
    const zout = unit => floorZ + unit.z + unit.h + Math.min(250, unit.h * 0.08);
    let x0 = right;
    let z0 = floorZ + out.z;
    let path = `M${fmt(right)},${fmt(toZ(z0))}`;
    cols.forEach((unit, index) => {
      const colX = toX(ox + unit.x);
      const midX = (x0 + colX) / 2;
      path += ` H${fmt(midX)} V${fmt(toZ(zin(unit)))} H${fmt(colX)}`;
      if (!index) PneuSymbol.flow(sheet, (right + midX) / 2, toZ(z0), 1);
      sheet.path(path, 'pipe');
      const centerX = toX(ox + unit.x + unit.lx / 2);
      x0 = toX(ox + unit.x + unit.lx);
      z0 = zout(unit);
      path = `M${fmt(centerX)},${fmt(toZ(floorZ + unit.z + unit.h))} V${fmt(toZ(z0))}`;
    });
    const endX = x0 + 4;
    sheet.path(`${path} H${fmt(endX)}`, 'pipe');
    sheet.arrow(endX + 2.6, toZ(z0), 1, 0);
    return { x: endX + 2.6, y: toZ(z0), z: z0 };
  }
  /** Трубопровод на разрезе А–А: магистрали (по ходу воздуха — стрелки), спуски к оборудованию. */
  pipesMain(sheet) {
    const toX = value => this.drawing.sheetX(value);
    const toZ = value => this.drawing.sheetZ(value);
    const { ox, floorZ: floorZ } = this.drawing;
    for (const line of this.drawing.lines) {
      const z = toZ(floorZ + line.z);
      for (const branch of line.branches)
        if (branch.z1 < line.z || branch.tee)
          sheet.line(toX(ox + branch.x), z, toX(ox + branch.x), toZ(floorZ + branch.z1), branch.tee ? 'pipe' : 'main');
      for (const [from, till] of StationLayout.runs(line)) {
        sheet.line(toX(ox + from), z, toX(ox + till), z, 'pipe');
        if (line.medium === 'air' && !line.header && (till - from) * this.drawing.scale > 9)
          PneuSymbol.flow(sheet, toX(ox + (from + till) / 2), z, 1);
      }
    }
  }
  /** Линия сечения (ГОСТ 2.305). */
  cutMark(sheet, x, y, dir, letter) {
    const endX = x + dir * 5;
    const arrowX = endX - dir * 1.6;
    sheet.line(x, y, endX, y, 'cut');
    sheet.line(arrowX, y, arrowX, y + 4, 'thin');
    sheet.arrow(arrowX, y + 4.4, 0, 1);
    sheet.text(endX + dir * 0.8, y + 5.6, letter, 5, { a: dir > 0 ? 'start' : 'end' });
  }
  /** То же на плане: стрелки к задней стене (вверх). */
  cutMarkV(sheet, x, y, dir, letter) {
    const endX = x + dir * 5;
    const arrowX = endX - dir * 1.6;
    sheet.line(x, y, endX, y, 'cut');
    sheet.line(arrowX, y, arrowX, y - 4, 'thin');
    sheet.arrow(arrowX, y - 4.4, 0, -1);
    sheet.text(endX + dir * 0.8, y - 1.2, letter, 5, { a: dir > 0 ? 'start' : 'end' });
  }
  /** Шасси под контейнером на разрезе. */
  chassisSide(sheet) {
    const k = this.drawing.scale;
    const left = this.drawing.left;
    const right = this.drawing.right;
    const Le = this.drawing.Le;
    const toZ = value => this.drawing.sheetZ(value);
    const wheel = 420 * k;
    sheet.rect([left + 40 * k, toZ(0), Le * k - 80 * k, 200 * k], 'main', '#fff');
    for (const frac of Le <= 7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86]) {
      const wheelX = left + Le * k * frac;
      sheet.circle(wheelX, this.drawing.ground - wheel, wheel, 'main', '#fff');
      sheet.circle(wheelX, this.drawing.ground - wheel, wheel * 0.45, 'thin');
    }
    sheet.rect(
      [left + Le * k * 0.16, toZ(0) + 200 * k, 60 * k, this.drawing.ground - toZ(0) - 200 * k],
      'thin',
      '#fff',
    );
    sheet.line(left - 4, this.drawing.ground, right + 4, this.drawing.ground, 'thin');
  }

  /** Глушитель поперёк станции (ДГУ поперёк) на виде с торца. */
  mufflerAcross(sheet, toX, muffler) {
    const k = this.drawing.scale;
    const toZ = value => this.drawing.sheetZ(value);
    const He = this.drawing.He;
    const oy = this.drawing.oy;
    const first = toX(oy + muffler.y);
    const second = toX(oy + muffler.y + muffler.ly);
    const botZ = toZ(He + muffler.gap);
    const topZ = toZ(He + muffler.gap + muffler.d);
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    for (const frac of [0.18, 0.82])
      sheet.line(low + (high - low) * frac, toZ(He), low + (high - low) * frac, botZ, 'main');
    const outX = toX(oy + muffler.y + muffler.ly + muffler.outlet);
    const pipeW = Math.max(0.8, 120 * k);
    const midZ = (botZ + topZ) / 2;
    const edge = toX(oy + muffler.y + muffler.ly);
    sheet.rect([Math.min(edge, outX), midZ - pipeW / 2, Math.abs(outX - edge), pipeW], 'thin', '#fff');
    sheet.line(outX, midZ - pipeW * 0.9, outX, midZ + pipeW * 0.9, 'main');
    IconUnits.muffler(sheet, low, topZ, high, botZ);
  }
  /** Станция из модулей на плане. */
  /** Точка выноски номера позиции на плане (аккуратность, п. 8). */

  /** Фланец на виде сбоку (патрубок вдоль листа). */
  flangeMark(sheet, x, y, dir) {
    const half = 2.2;
    const thick = 0.6;
    if (dir === 'v') {
      sheet.line(x, y - half, x, y + half, 'main');
      sheet.line(x + thick, y - half, x + thick, y + half, 'main');
    } else {
      sheet.line(x - half, y, x + half, y, 'main');
      sheet.line(x - half, y + thick, x + half, y + thick, 'main');
    }
  }
  /** Выход с фланцем на виде к стене: труба, фланец, отверстия под болты, осевые линии. */
  flangeFace(sheet, x, y) {
    const inner = Math.max(0.9, 60 * this.drawing.scale);
    const outer = Math.max(inner + 1, inner * 2.2);
    sheet.circle(x, y, outer, 'main', '#fff');
    sheet.circle(x, y, inner, 'main', '#fff');
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = Math.PI / 4 + (quarter * Math.PI) / 2;
      sheet.circle(
        x + (Math.cos(angle) * (inner + outer)) / 2,
        y + (Math.sin(angle) * (inner + outer)) / 2,
        Math.max(0.25, (outer - inner) * 0.18),
        'thin',
      );
    }
    IconParts.axes(sheet, x, y, outer * 1.25);
  }
}
