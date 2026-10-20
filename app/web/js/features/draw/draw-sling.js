import { Mm } from '../layout/mm.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { StationMass } from '../layout/station-mass.js';

/** Схема строповки: вид сбоку и с торца, знаки № 9 и № 12 (ГОСТ 14192-96), условные обозначения. */
export class DrawSling {
  constructor(drawing) {
    this.drawing = drawing;
  }

  /** Знак № 12 «Центр тяжести» (ГОСТ 14192-96). */
  static signCog(sheet, midX, midY, size) {
    const fmt = EskdSheet.fmt;
    const bar = size * 0.1;
    const outer = size * 0.31;
    const inner = outer - size * 0.09;
    const gap = Math.asin(Math.min(0.9, (bar / 2 + size * 0.05) / inner));
    const point = (radius, angle) => `${fmt(midX + radius * Math.cos(angle))},${fmt(midY + radius * Math.sin(angle))}`;
    sheet.rect([midX - size / 2, midY - bar / 2, size, bar], 'thin', '#000');
    sheet.rect([midX - bar / 2, midY - size / 2, bar, size], 'thin', '#000');
    for (let k = 0; k < 4; k++) {
      const from = (k * Math.PI) / 2 + gap;
      const till = ((k + 1) * Math.PI) / 2 - gap;
      sheet.path(
        `M${point(outer, from)} A${fmt(outer)},${fmt(outer)} 0 0 1 ${point(outer, till)} L${point(inner, till)} A${fmt(inner)},${fmt(inner)} 0 0 0 ${point(inner, from)} Z`,
        'thin',
        '#000',
      );
    }
  }
  /** Знак № 9 «Место строповки» (ГОСТ 14192-96). */
  static signSling(sheet, midX, midY, size) {
    const fmt = EskdSheet.fmt;
    const loopW = size * 0.42;
    const y0 = midY - size / 2;
    const loopH = size * 0.22;
    const hookH = size * 0.3;
    const stroke = Math.max(0.3, size * 0.07);
    sheet.path(
      `M${fmt(midX - loopW / 2)},${fmt(y0)} V${fmt(y0 + loopH - loopW / 2)} A${fmt(loopW / 2)},${fmt(loopW / 2)} 0 0 0 ${fmt(midX + loopW / 2)},${fmt(y0 + loopH - loopW / 2)} V${fmt(y0)}`,
      'main',
    );
    for (const y of [y0 + size * 0.26, y0 + size * 0.62])
      sheet.rect([midX - loopW / 2, y, loopW, hookH], 'main', 'none', loopW / 2);
    sheet.rect([midX - stroke / 2, y0 + size * 0.08, stroke, size * 0.9], 'thin', '#000');
  }
  /** Крюк над центром тяжести: кольцо стропа и крюк. */
  static hook(sheet, x, y) {
    sheet.circle(x, y, 1.1, 'main');
    sheet.path(`M${EskdSheet.fmt(x)},${EskdSheet.fmt(y - 1.1)} V${EskdSheet.fmt(y - 5)}`, 'main');
    sheet.circle(x, y - 6.2, 1.2, 'main');
  }
  /** Схема строповки — вид со стороны лицевой стены. */
  slingSide(sheet, x0, y0, height, cap) {
    const { scale: k, Le, He, mass: mass } = this.drawing;
    const sling = mass.sling;
    const num = Mm.text;
    const groundY = y0 + height - 23;
    const toX = x => x0 + x * k;
    const toZ = z => groundY - (this.drawing.dz + z) * k;
    const center = mass.cg;
    sheet.text(toX(Le / 2), groundY + 21.5, cap, 2.5, { a: 'middle' });
    this.sideOutline(sheet, { X: toX, Z: toZ, yg: groundY });
    const hookZ = He + sling.hook;
    const hookX = toX(center.x);
    const view = {
      X: toX,
      Z: toZ,
      hx: hookX,
      hz: hookZ,
      ring: x => sheet.circle(toX(x), toZ(He), 0.9, 'main', '#fff'),
    };
    let topZ = toZ(hookZ);
    if (sling.frame) topZ = this.sideFrame(sheet, sling, view);
    else if (sling.beam) topZ = this.sideBeam(sheet, sling, view);
    else this.sideLegs(sheet, sling, view);
    DrawSling.hook(sheet, hookX, toZ(hookZ));
    sheet.line(hookX, topZ, hookX, toZ(center.z) - 4, 'axis');
    DrawSling.signCog(sheet, hookX, toZ(center.z), 8);
    sheet.text(hookX + 5, toZ(center.z) - 2.5, 'ЦТ', 3.5);
    for (const x of [toX(450), toX(Le - 450)]) DrawSling.signSling(sheet, x, toZ(He - 450), 7);
    // размеры (ГОСТ 2.307): меньший — ближе к изображению
    sheet.dimH([toX(0), hookX], groundY + 8, num(center.x), [toZ(0), toZ(center.z)], { out: 'r' });
    sheet.dimH([toX(0), toX(Le)], groundY + 15, num(Le), [toZ(0), toZ(0)]);
    sheet.dimV([toZ(center.z), toZ(0)], toX(0) - 7, num(center.z), [hookX, toX(0)], { out: true });
    sheet.dimV(
      [toZ(hookZ), toZ(He + this.drawing.rise)],
      toX(0) - 14,
      num(sling.hook - this.drawing.rise),
      [hookX, toX(0)],
      { out: true },
    );
  }

  /** Контур сбоку: шасси, корпус, крыша, глушители, земля. */
  sideOutline(sheet, { X: toX, Z: toZ, yg: groundY }) {
    const { scale: k, Le, He, rise } = this.drawing;
    if (this.drawing.dz) sheet.rect([toX(40), toZ(0), (Le - 80) * k, 200 * k], 'thin', '#fff');
    sheet.rect([toX(0), toZ(He), Le * k, He * k], 'main', '#fff');
    if (rise) sheet.rect([toX(0), toZ(He + rise), Le * k, rise * k], 'main', '#fff');
    for (const roofItem of this.drawing.roofItems)
      sheet.rect(
        [toX(this.drawing.ox + roofItem.x), toZ(He + roofItem.gap + roofItem.d), roofItem.lx * k, roofItem.d * k],
        'thin',
        '#fff',
      );
    sheet.line(toX(0) - 4, groundY, toX(Le) + 4, groundY, 'thin');
  }

  /** Рамная траверса: ветви к фитингам вертикальны, рама — на двухветвевом стропе от проушин над центром тяжести. */
  sideFrame(sheet, sling, { X: toX, Z: toZ, hx: hookX, hz: hookZ, ring }) {
    const { scale: k, He } = this.drawing;
    const num = Mm.text;
    const frame = sling.frame;
    const frameZ = toZ(He + frame.z);
    sheet.rect([toX(frame.x0) - 1, frameZ - 1.2, (frame.x1 - frame.x0) * k + 2, 1.2], 'main', '#000');
    for (const x of [frame.x0, frame.x1]) {
      sheet.line(toX(x), toZ(He), toX(x), frameZ, 'main');
      ring(x);
    }
    for (const x of frame.lugs) sheet.line(toX(x), frameZ - 1.2, hookX, toZ(hookZ) + 1.1, 'main');
    const lugX = toX(Math.min(...frame.lugs));
    sheet.text(toX(frame.x0) + 2, (toZ(He) + frameZ) / 2 + 1, `ветви ${num(sling.legs[0].len)} — вертикально`, 2.5);
    sheet.text(toX(frame.x0) + 2, frameZ - 2.4, 'рамная траверса', 2.5);
    sheet.text((lugX + hookX) / 2 - 2, (frameZ + toZ(hookZ)) / 2, `${num(frame.len)} (${frame.deg}°)`, 2.5, {
      a: 'end',
    });
    return frameZ;
  }

  /** Траверса: ветви от точек строповки к ней (на виде сбоку — вертикально), траверса подвешена над центром тяжести. */
  sideBeam(sheet, sling, { X: toX, Z: toZ, hx: hookX, hz: hookZ, ring }) {
    const { scale: k, He } = this.drawing;
    const num = Mm.text;
    const beam = sling.beam;
    const beamZ = toZ(He + beam.z);
    sheet.rect([toX(beam.x0) - 1, beamZ - 1.2, (beam.x1 - beam.x0) * k + 2, 1.2], 'main', '#000');
    sheet.line(hookX, beamZ - 1.2, hookX, toZ(hookZ) + 1.1, 'main');
    for (const leg of sling.legs.filter(leg => leg.y < this.drawing.We / 2)) {
      sheet.line(toX(leg.x), toZ(He), toX(leg.x), beamZ, 'main');
      ring(leg.x);
    }
    const len = Math.max(...sling.legs.map(leg => leg.len));
    const deg = Math.max(...sling.legs.map(leg => leg.deg));
    sheet.text(toX(beam.x0) + 2, (toZ(He) + beamZ) / 2, `ветви ${num(len)} (${deg}°)`, 2.5);
    sheet.text((toX(beam.x0) + hookX) / 2, beamZ - 2.4, 'траверса', 2.5, { a: 'middle' });
    return beamZ;
  }

  /** Четырёхветвевой строп: ветви к крюку с длиной и углом. */
  sideLegs(sheet, sling, { X: toX, Z: toZ, hx: hookX, hz: hookZ, ring }) {
    const { He } = this.drawing;
    const midX = this.drawing.mass.cg.x;
    for (const leg of sling.legs.filter(leg => leg.y < this.drawing.We / 2)) {
      sheet.line(toX(leg.x), toZ(He), hookX, toZ(hookZ), 'main');
      ring(leg.x);
      const x = toX(leg.x) + (hookX - toX(leg.x)) * 0.35;
      const y = toZ(He) + (toZ(hookZ) - toZ(He)) * 0.35;
      const left = leg.x < midX;
      sheet.text(x + (left ? -2 : 2), y, `${Mm.text(leg.len)} (${leg.deg}°)`, 2.5, {
        a: left ? 'end' : 'start',
      });
    }
  }

  /** Схема строповки — вид с торца у входа (лицевая стена справа). */
  slingEnd(sheet, x0, y0, height, cap) {
    const { scale: k, We, He, mass: mass } = this.drawing;
    const sling = mass.sling;
    const num = Mm.text;
    const groundY = y0 + height - 23;
    const endX = y => x0 + (We - y) * k;
    const toZ = z => groundY - (this.drawing.dz + z) * k;
    const center = mass.cg;
    sheet.text(endX(We / 2), groundY + 21.5, cap, 2.5, { a: 'middle' });
    sheet.rect([endX(We), toZ(He), We * k, He * k], 'main', '#fff');
    const roof = this.endRoof(endX, toZ);
    if (roof) sheet.poly(roof, 'main', '#fff');
    sheet.line(endX(We) - 4, groundY, endX(0) + 4, groundY, 'thin');
    const hookZ = He + sling.hook;
    const hookX = endX(center.y);
    const topZ = this.endRig(sheet, sling, { XL: endX, Z: toZ, hx: hookX, hz: hookZ });
    DrawSling.hook(sheet, hookX, toZ(hookZ));
    sheet.line(hookX, topZ, hookX, toZ(center.z) - 4, 'axis');
    DrawSling.signCog(sheet, hookX, toZ(center.z), 8);
    sheet.dimH([hookX, endX(0)], groundY + 8, num(center.y), [toZ(center.z), toZ(0)], { out: 'r' });
    sheet.dimH([endX(We), endX(0)], groundY + 15, num(We), [toZ(0), toZ(0)]);
  }

  /** Крыша с торца: двускатная, арочная или односкатная (плоская — null). */
  endRoof(endX, toZ) {
    const { We, He, rise: rise } = this.drawing;
    if (!rise) return null;
    const roof = this.drawing.geo.roof;
    if (roof === 'gable')
      return [
        [endX(We), toZ(He)],
        [endX(We / 2), toZ(He + rise)],
        [endX(0), toZ(He)],
      ];
    if (roof !== 'arch')
      return [
        [endX(We), toZ(He)],
        [endX(0), toZ(He + rise)],
        [endX(0), toZ(He)],
      ];
    const radius = ((We * We) / 4 + rise * rise) / (2 * rise);
    const points = [];
    for (let j = 0; j <= 16; j++) {
      const y = (We * j) / 16;
      points.push([
        endX(y),
        toZ(He + rise - radius + Math.sqrt(Math.max(0, radius * radius - (y - We / 2) * (y - We / 2)))),
      ]);
    }
    return points;
  }

  /** С торца: рамная траверса или ветви к крюку (с траверсой — к ней); возвращает верх оси центра тяжести. */
  endRig(sheet, sling, { XL: endX, Z: toZ, hx: hookX, hz: hookZ }) {
    const { scale: k, We, He } = this.drawing;
    const ring = y => sheet.circle(endX(y), toZ(He), 0.9, 'main', '#fff');
    const frame = sling.frame;
    if (frame) {
      const frameZ = toZ(He + frame.z);
      sheet.rect([endX(frame.y1) - 1, frameZ - 1.2, (frame.y1 - frame.y0) * k + 2, 1.2], 'main', '#000');
      for (const y of [frame.y0, frame.y1]) {
        sheet.line(endX(y), toZ(He), endX(y), frameZ, 'main');
        ring(y);
      }
      sheet.line(hookX, frameZ - 1.2, hookX, toZ(hookZ) + 1.1, 'main');
      return frameZ;
    }
    const jointZ = sling.beam ? He + sling.beam.z : hookZ;
    for (const y of [StationMass.LUG[1], We - StationMass.LUG[1]]) {
      sheet.line(endX(y), toZ(He), hookX, toZ(jointZ), 'main');
      ring(y);
    }
    if (sling.beam) {
      sheet.circle(hookX, toZ(jointZ), 1.3, 'main', '#000');
      sheet.line(hookX, toZ(jointZ), hookX, toZ(hookZ) + 1.1, 'main');
    }
    return toZ(jointZ) + 1.3;
  }

  /** Подписи под схемой: знаки (что о них сказано в ГОСТ 14192-96), масса и центр тяжести. */
  legendItems() {
    const mass = this.drawing.mass;
    const num = Mm.text;
    const center = mass.cg;
    const wll = mass.sling.wll;
    const dec = value => String(value).replace('.', ',');
    const wllText = wll
      ? [
          `Грузоподъёмность каждой ветви стропа — не менее ${dec(wll.leg)} т${wll.top ? `, ветви стропа рамы траверсы — не менее ${dec(wll.top)} т` : ''}: S = Q / (n · cos α), в расчёте n = ${wll.n} ветви (РД 10-33-93, п. 2.1.4), α = ${wll.deg}°.`,
        ]
      : [];
    return [...this._legend(mass, num, center), ...wllText];
  }
  _legend(mass, num, center) {
    return [
      '№ 9 «Место строповки» — у каждой точки строповки, с двух сторон (ГОСТ 14192-96, п. 5.5.1).',
      '№ 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести (ГОСТ 14192-96, п. 5.5.2).',
      `Масса ${mass.modK ? `модуля М${mass.modK} (самого тяжёлого; модули поднимают по одному)` : 'станции'} — около ${num(mass.mass)} кг; центр тяжести (ЦТ): X = ${num(center.x)}, Y = ${num(center.y)}, Z = ${num(center.z)} мм — от торца у входа, от лицевой стены, от низа${mass.missing.length ? `; без поз. ${mass.missing.join(', ')} (масса не указана) — уточняется` : ''}.`,
    ];
  }
  /** Высота подписей под схемой, мм: строка знака — не ниже самого знака. */
  legendH(sheet) {
    return this.legendItems().reduce(
      (sum, line, i) => sum + Math.max(i < 2 ? 10 : 0, sheet.paras([0, 0, 160], [line], 2.5, false) + 1.5),
      0,
    );
  }
  /** Под схемой: знаки № 9 и № 12 с пояснениями, масса и центр тяжести. */
  signsLegend(sheet, x, y) {
    let rowY = y;
    this.legendItems().forEach((line, i) => {
      if (i === 0) DrawSling.signSling(sheet, x + 4, rowY + 5, 8);
      else if (i === 1) DrawSling.signCog(sheet, x + 4, rowY + 5, 8);
      rowY += Math.max(i < 2 ? 10 : 0, sheet.paras([x + 11, rowY, 160], [line], 2.5) + 1.5);
    });
  }
}
