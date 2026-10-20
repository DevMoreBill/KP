import { Mm } from '../layout/mm.js';
import { EquipIcon } from '../eskd/equip-icon.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { PneuSymbol } from '../eskd/pneu-symbol.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMods } from '../layout/station-mods.js';
import { StationVent } from '../layout/station-vent.js';

/** Разрез Б–Б (план): расстановка, двери с дугами открывания, позиции, цепочка размеров, модули. */
export class DrawPlan {
  constructor(drawing) {
    this.drawing = drawing;
  }

  /** Границы модулей и стойки стыков на плане. */
  modsPlan(sheet, toY) {
    const mods = this.drawing.plan.geo.mods;
    if (!mods || !mods.Lm) return;
    const k = this.drawing.scale;
    const toX = value => this.drawing.sheetX(value);
    const { Le, We } = this.drawing;
    const post = StationMods.M.post;
    for (let i = 1; i < mods.a; i++) {
      const x = toX(i * mods.Lm);
      sheet.line(x, toY(We) - 2, x, toY(0) + 2, 'phantom');
    }
    for (let j = 1; j < mods.b; j++) {
      const y = toY(j * mods.Wm);
      sheet.line(toX(0) - 2, y, toX(Le) + 2, y, 'phantom');
    }
    mods.cells.forEach(([i, j], cell) =>
      sheet.text(toX(i * mods.Lm) + 2, toY((j + 1) * mods.Wm) + 4.2, `М${cell + 1}`, 3.5),
    );
    for (const postAt of StationMods.posts(this.drawing.plan.geo)) {
      const size = Math.max(0.8, post * k);
      sheet.rect(
        [toX(this.drawing.ox + postAt.x) - size / 2, toY(this.drawing.oy + postAt.y) - size / 2, size, size],
        'thin',
        '#000',
      );
    }
  }
  /** Маркизы на плане: открытый козырёк за наружной стеной (тонкой штрихпунктирной — откидные). */
  hoodsPlan(sheet, toY) {
    const k = this.drawing.scale;
    const toX = value => this.drawing.sheetX(value);
    const { ox, oy, Le, We } = this.drawing;
    const side = StationVent.HOOD_SIDE;
    for (const louver of ((this.drawing.plan.vent && this.drawing.plan.vent.louvers) || []).filter(
      louver => louver.hood,
    )) {
      const depth = louver.hood.d;
      if (louver.wall === 'front')
        sheet.rect([toX(ox + louver.u0 - side), toY(0), (louver.u1 - louver.u0 + 2 * side) * k, depth * k], 'phantom');
      else if (louver.wall === 'back')
        sheet.rect(
          [toX(ox + louver.u0 - side), toY(We + depth), (louver.u1 - louver.u0 + 2 * side) * k, depth * k],
          'phantom',
        );
      else if (louver.wall === 'left')
        sheet.rect(
          [toX(-depth), toY(oy + louver.u1 + side), depth * k, (louver.u1 - louver.u0 + 2 * side) * k],
          'phantom',
        );
      else
        sheet.rect([toX(Le), toY(oy + louver.u1 + side), depth * k, (louver.u1 - louver.u0 + 2 * side) * k], 'phantom');
    }
  }
  /** Разрез Б–Б: план под потолком. */
  plan(sheet, top, col, denom) {
    const { scale: k, We, left: left } = this.drawing;
    const toY = y => this.drawing.planTop + (We - y) * k;
    sheet.text((left + this.drawing.right) / 2, top + 4.6, this.drawing.layout.label('Б–Б', denom), 5, { a: 'middle' });
    // направления взгляда на торцы
    this.drawing.ends.viewArrow(sheet, left - 3 - this.drawing.hoodLeft * k, toY(We * 0.72), 1, 'В');
    this.drawing.ends.viewArrow(sheet, this.drawing.outerRight + 3 + this.drawing.swingR * k, toY(We * 0.72), -1, 'Г');
    this.walls(sheet, toY);
    this.doorsPlan(sheet, toY);
    this.hoodsPlan(sheet, toY);
    // оборудование — по высоте
    const { ox, oy } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    for (const item of [...this.drawing.plan.items].sort((first, second) => first.z + first.h - (second.z + second.h)))
      EquipIcon.plan(sheet, item, [
        toX(ox + item.x),
        toY(oy + item.y + item.ly),
        toX(ox + item.x + item.lx),
        toY(oy + item.y),
      ]);
    this.pipesPlan(sheet, toY);
    // глушитель на крыше — над секущей плоскостью: штриховой
    for (const muffler of this.drawing.roofItems)
      sheet.rect(
        [toX(ox + muffler.x), toY(oy + muffler.y + muffler.ly), muffler.lx * k, muffler.ly * k],
        'dash',
        'none',
        (muffler.ly * k) / 2,
      );
    this.modsPlan(sheet, toY);
    this.fittings(sheet, toY);
    const aisleY = toY(oy + Math.min(60, this.drawing.Wi * 0.03));
    this.drawing.side.cutMarkV(sheet, left - 1.5 - this.drawing.hoodLeft * k, aisleY, -1, 'А');
    this.drawing.side.cutMarkV(sheet, this.drawing.outerRight + 1.5 + this.drawing.hoodRight * k, aisleY, 1, 'А');
    // цепочка размеров у задней стены (установочные размеры оборудования)
    this.chain(sheet, toY(We) - this.drawing.swingB * k - 8, toY(oy + this.drawing.Wi));
    this.dimsH(sheet, toY, col);
    const dimX = this.dimsV(sheet, toY);
    const labels = this.labels(sheet, toY, { col, yB: top, xo: dimX });
    this.aisleLabel(sheet, toY, labels);
    if (this.drawing.highlight) this.hlPlan(sheet, toY);
  }

  /** Стены в сечении, помещение, тамбур, отсек бака с нишей горловины, конвекторы. */
  walls(sheet, toY) {
    const { scale: k, ox, oy, Le, We, Li, Wi, left: left, geo: geo } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    sheet.section(left, toY(oy), Le * k, oy * k);
    sheet.section(left, toY(We), Le * k, oy * k);
    sheet.section(left, toY(We - oy), ox * k, Wi * k);
    sheet.section(toX(Le - ox), toY(We - oy), ox * k, Wi * k);
    sheet.rect([left, toY(We), Le * k, We * k], 'main');
    sheet.rect([toX(ox), toY(oy + Wi), Li * k, Wi * k], 'thin');
    const fuel = this.drawing.fuel;
    if ((geo.x0 || 0) - (fuel ? fuel.x1 + fuel.part : 0) > 0)
      sheet.rect(
        [toX(ox + geo.x0) - Math.max(0.5, 30 * k), toY(oy + Wi), Math.max(1, 60 * k), (Wi - 1000) * k],
        'thin',
        '#000',
      );
    if (fuel) {
      sheet.section(toX(ox + fuel.x1), toY(oy + Wi), fuel.part * k, Wi * k);
      const barW = Math.max(1.2, 220 * k);
      const depth = oy * k + barW * 0.5;
      if (fuel.fill.wall === 'left')
        sheet.rect([left, toY(oy + fuel.fill.y) - barW / 2, ox * k + barW * 0.5, barW], 'main', '#fff');
      else if (fuel.fill.wall === 'back')
        sheet.rect([toX(ox + fuel.fill.x) - barW / 2, toY(We), barW, depth], 'main', '#fff');
      else sheet.rect([toX(ox + fuel.fill.x) - barW / 2, toY(0) - depth, barW, depth], 'main', '#fff');
    }
    for (const heater of this.drawing.heaters)
      sheet.rect([toX(ox + heater.x), toY(oy + heater.y + heater.ly), heater.lx * k, heater.ly * k], 'main', '#fff');
  }

  /** Трубопровод со стрелками потока; выходы через дальний торец и боковые стены (с фланцем); к ресиверам снаружи. */
  pipesPlan(sheet, toY) {
    const { scale: k, ox, oy } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    for (const line of this.drawing.lines) {
      const y = toY(oy + line.y);
      for (const branch of line.branches)
        sheet.line(
          toX(ox + branch.x),
          toY(oy + branch.y0),
          toX(ox + branch.x),
          toY(oy + branch.y1),
          branch.tee ? 'pipe' : 'main',
        );
      for (const [first, second] of StationLayout.runs(line)) {
        sheet.line(toX(ox + first), y, toX(ox + second), y, 'pipe');
        if (line.medium === 'air' && !line.header && (second - first) * k > 9)
          PneuSymbol.flow(sheet, toX(ox + (first + second) / 2), y, 1);
      }
    }
    if (this.drawing.outside.length) this.outPlan(sheet, toY);
    else this.outlets(sheet, toY);
    this.sideOuts(sheet, toY);
  }

  /** Выходы через дальний торец — с фланцем и стрелкой. */
  outlets(sheet, toY) {
    const { scale: k, oy, right: right } = this.drawing;
    const flangeX = right + Math.max(1.2, this.drawing.flange * k);
    for (const out of this.drawing.outs) {
      const y = toY(oy + out.y);
      sheet.line(right, y, flangeX + 5, y, 'pipe');
      this.drawing.side.flangeMark(sheet, flangeX, y, 'v');
      sheet.arrow(flangeX + 7.6, y, 1, 0);
    }
  }

  /** Выходы через боковые стены. */
  sideOuts(sheet, toY) {
    const { scale: k, ox, oy } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    for (const out of this.drawing.souts) {
      const x = toX(ox + out.x);
      const back = out.wall === 'back';
      const sign = back ? -1 : 1;
      const flangeY = toY(back ? this.drawing.We : 0) + sign * Math.max(1.2, this.drawing.flange * k);
      sheet.line(x, toY(oy + out.y), x, flangeY + sign * 5, 'pipe');
      this.drawing.side.flangeMark(sheet, x, flangeY, 'h');
      sheet.arrow(x, flangeY + sign * 7.6, 0, sign);
    }
  }

  /** Угловые фитинги морского контейнера. */
  fittings(sheet, toY) {
    if (!this.drawing.fit) return;
    const { scale: k, Le, We } = this.drawing;
    const [fitL, fitW] = this.drawing.fit;
    const [edgeX, edgeY] = [(Le - fitL) / 2, (We - fitW) / 2];
    const size = Math.max(0.8, 170 * k);
    for (const [x, y] of [
      [edgeX, edgeY],
      [Le - edgeX, edgeY],
      [edgeX, We - edgeY],
      [Le - edgeX, We - edgeY],
    ])
      sheet.rect([this.drawing.sheetX(x) - size / 2, toY(y) - size / 2, size, size], 'thin');
  }

  /** Размеры под планом: габаритная длина, до ресивера снаружи, между фитингами, выходы через боковую стену. */
  dimsH(sheet, toY, col) {
    const { scale: k, ox, oy, Le, We, left: left, right: right } = this.drawing;
    const num = Mm.text;
    const toX = value => this.drawing.sheetX(value);
    let dimY = toY(0) + this.drawing.swing * k + (col ? 0 : 11) + 8;
    sheet.dimH([left, right], dimY, num(Le), [toY(0), toY(0)]);
    if (this.drawing.outside.length) {
      const nearest = this.drawing.outside.reduce((best, other) => (other.x < best.x ? other : best));
      sheet.dimH([right, toX(ox + nearest.x)], dimY, num(ox + nearest.x - Le), [null, toY(oy + nearest.y)]);
    }
    if (this.drawing.fit) {
      const [fitL, fitW] = this.drawing.fit;
      const [edgeX, edgeY] = [(Le - fitL) / 2, (We - fitW) / 2];
      dimY += 7;
      sheet.dimH([toX(edgeX), toX(Le - edgeX)], dimY, num(fitL), [toY(edgeY), toY(edgeY)]);
    }
    for (const out of this.drawing.souts) {
      dimY += 7;
      sheet.dimH(
        [toX(ox + out.x), right],
        dimY,
        num(Le - ox - out.x),
        [out.wall === 'back' ? toY(We) : toY(0), toY(0)],
        { out: 'l' },
      );
    }
  }

  /** Размеры слева (ширина, между фитингами), ширина прохода, справа — привязки выходов; возвращает x следующего справа. */
  dimsV(sheet, toY) {
    const { scale: k, ox, oy, Le, We, left: left, right: right, aisle: aisle } = this.drawing;
    const num = Mm.text;
    const toX = value => this.drawing.sheetX(value);
    let dimX = left - 14 - this.drawing.hoodLeft * k;
    sheet.dimV([toY(We), toY(0)], dimX, num(We), [left, left]);
    if (this.drawing.fit) {
      const [fitL, fitW] = this.drawing.fit;
      const [edgeX, edgeY] = [(Le - fitL) / 2, (We - fitW) / 2];
      dimX -= 7;
      sheet.dimV([toY(We - edgeY), toY(edgeY)], dimX, num(fitW), [toX(edgeX), toX(edgeX)]);
    }
    if (aisle) sheet.dimV([toY(oy + aisle.y1), toY(oy + aisle.y0)], toX(ox + aisle.xm), num(aisle.w), [null, null]);
    const outRows = this.drawing.outside.length
      ? []
      : [...new Set(this.drawing.outs.map(out => out.y))].sort((first, second) => second - first);
    let outX = this.drawing.outerRight + 16 + this.drawing.hoodRight * k; // правее буквы линии сечения А–А
    for (const y of outRows) {
      sheet.dimV([toY(We), toY(oy + y)], outX, num(We - oy - y), [right, right + 7.6]);
      outX += 7;
    }
    return outRows.length ? outX : null;
  }

  /** Номера позиций: строкой под планом или колонкой справа (выноски не пересекаются); возвращает полки. */
  labels(sheet, toY, { col, yB: top, xo: outX }) {
    const { scale: k, ox, oy } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const anchors = this.drawing.posPlan
      .map(item => ({ ...this.anchor(item, toX, toY), n: item.pos }))
      .concat(
        this.drawing.posRoof.map(roofItem => ({
          x: toX(ox + roofItem.x + roofItem.lx * 0.25),
          y: toY(oy + roofItem.y + roofItem.ly / 2),
          n: roofItem.pos,
        })),
      );
    if (this.drawing.pipePos) {
      const line = this.drawing.lines.find(label => !label.header) || this.drawing.lines[0];
      const run = line
        ? [...StationLayout.runs(line)].sort((first, second) => second[1] - second[0] - (first[1] - first[0]))[0]
        : null;
      if (run) anchors.push({ x: toX(ox + (run[0] + run[1]) / 2), y: toY(oy + line.y), n: this.drawing.pipePos.pos });
    }
    const y0 = toY(0) + this.drawing.swing * k;
    const labelX = (outX != null ? outX - 7 + 5 : this.drawing.outerRight + 10 + this.drawing.hoodRight * k) + 2;
    const labels = col
      ? EskdSheet.shelves(anchors, 'y', [top + 8, y0 + 4], [labelX], 7)
      : EskdSheet.shelves(anchors, 'x', [this.drawing.field.L0 + 2, this.drawing.field.L1 - 8], [y0 + 8, y0 + 15], 9);
    for (const label of labels) sheet.pos([label.px, label.py], [label.sx, label.sy], label.n, 1);
    return labels;
  }

  /** Надпись «Проход обслуживания» — в свободной от выносок и шкафов части прохода. */
  aisleLabel(sheet, toY, labels) {
    const { scale: k, ox, oy, right: right, aisle: aisle } = this.drawing;
    if (!aisle || (aisle.y1 - aisle.y0) * k <= 3.5) return;
    const toX = value => this.drawing.sheetX(value);
    const lab = 'Проход обслуживания';
    const labelW = EskdSheet.textWidth(lab, 2.5);
    const labelY = toY(oy + (aisle.y0 + aisle.y1) / 2) + 1.2;
    const midX = toX(ox + aisle.xm);
    const wallIt = this.drawing.plan.items.filter(
      i => i.mount === 'wall' && i.wall === 'front' && toY(oy + i.y + i.ly) < labelY + 1,
    );
    const hit = (from, till) =>
      labels.some(label => DrawPlan.crosses(label, [from, till], labelY)) ||
      (midX > from - 4 && midX < till + 4) ||
      wallIt.some(i => toX(ox + i.x) - 1 < till && toX(ox + i.x + i.lx) + 1 > from);
    for (let from = toX(ox + (this.drawing.geo.x0 || 0)) + 2; from + labelW <= right - 2; from += 1)
      if (!hit(from, from + labelW)) {
        sheet.text(from + labelW / 2, labelY, lab, 2.5, { a: 'middle' });
        return;
      }
  }

  /** Выноска q проходит через полосу надписи [a, c] × [yc − 3, yc + 0,6]. */
  static crosses(label, [from, till], textY) {
    const fromT = (textY - 3 - label.py) / (label.sy - label.py);
    const tillT = (textY + 0.6 - label.py) / (label.sy - label.py);
    const fromX = label.px + (label.sx - label.px) * Math.max(0, Math.min(1, fromT));
    const tillX = label.px + (label.sx - label.px) * Math.max(0, Math.min(1, tillT));
    return (
      Math.max(fromX, tillX) > from &&
      Math.min(fromX, tillX) < till &&
      Math.max(label.py, label.sy) > textY - 3 &&
      Math.min(label.py, label.sy) < textY + 0.6
    );
  }

  /** «Показать на чертеже»: рамки вокруг позиций, ворот, дверей, жалюзи или прохода из замечания (meta.hl). */
  hlPlan(sheet, toY) {
    const highlight = this.drawing.highlight;
    const toX = value => this.drawing.sheetX(value);
    const { ox, oy, Le, plan: plan } = this.drawing;
    const pad = 1.2;
    const mark = ([x0, x1, y0, y1]) =>
      sheet.mark(
        Math.min(x0, x1) - pad,
        Math.min(y0, y1) - pad,
        Math.abs(x1 - x0) + 2 * pad,
        Math.abs(y1 - y0) + 2 * pad,
      );
    const pos = new Set(highlight.pos || []);
    for (const item of [...plan.items, ...this.drawing.outside, ...this.drawing.roofItems])
      if (pos.has(item.pos) && item.lx > 0)
        mark([toX(ox + item.x), toX(ox + item.x + item.lx), toY(oy + item.y), toY(oy + item.y + (item.ly || item.lx))]);
    const kinds = new Set(highlight.kinds || []);
    for (const box of this.hlBoxes(kinds, toY)) mark(box);
    if (kinds.has('aisle') && this.drawing.aisle)
      mark([
        toX(ox + (this.drawing.geo.x0 || 0)),
        toX(Le - ox),
        toY(oy + this.drawing.aisle.y0),
        toY(oy + this.drawing.aisle.y1),
      ]);
  }

  /** Рамки дверей: сервисные, оператора в стене прохода, двери-жалюзи ДГУ. */
  hlDoors(box) {
    const { ox, oy, plan: plan, entry: entry } = this.drawing;
    const front = entry && entry.wall === 'front' ? [entry] : [];
    return [
      ...[...(plan.doors || []), ...front].map(door =>
        box(door.wall === 'back' ? 'back' : 'front', [door.x0, door.x1], oy),
      ),
      ...this.drawing.dguDoors.map(door =>
        door.wall === 'back' ? box('back', [door.x0, door.x1], oy) : box(door.wall, [door.y0, door.y1], ox),
      ),
    ];
  }

  /** Рамки проёмов из замечания: ворота, двери, жалюзи. */
  hlBoxes(kinds, toY) {
    const { ox, oy, plan: plan } = this.drawing;
    const box = (wall, [from, till], depth) => this.wallBox(wall, [from, till], depth, toY);
    const louvers = (plan.vent && plan.vent.louvers) || [];
    return [
      ...(kinds.has('gate') ? this.drawing.gates.map(item => box(item.wall, [item.y0, item.y1], ox)) : []),
      ...(kinds.has('door') ? this.hlDoors(box) : []),
      ...(kinds.has('vent') ? louvers.map(item => box(item.wall, [item.u0, item.u1], Math.max(oy, 120))) : []),
    ];
  }

  /** Полоса стены w толщиной t (мм) на участке [a, b] (мм внутри): [x0, x1, y0, y1] на листе. */
  wallBox(wall, [from, till], depth, toY) {
    const toX = value => this.drawing.sheetX(value);
    const { ox, oy, Le, We } = this.drawing;
    if (wall === 'front') return [toX(ox + from), toX(ox + till), toY(0), toY(depth)];
    if (wall === 'back') return [toX(ox + from), toX(ox + till), toY(We), toY(We - depth)];
    if (wall === 'left') return [toX(0), toX(depth), toY(oy + from), toY(oy + till)];
    return [toX(Le - depth), toX(Le), toY(oy + from), toY(oy + till)];
  }
  /** Ресиверы снаружи на плане. */
  outPlan(sheet, toY) {
    const k = this.drawing.scale;
    const toX = value => this.drawing.sheetX(value);
    const { ox, oy, right: right } = this.drawing;
    const outside = this.drawing.outside;
    const out = this.drawing.outs[0];
    const fmt = EskdSheet.fmt;
    for (const item of outside) {
      sheet.rect(
        [toX(ox + item.x - 200), toY(oy + item.y + item.ly + 200), (item.lx + 400) * k, (item.ly + 400) * k],
        'thin',
        '#fff',
      );
      EquipIcon.plan(sheet, item, [
        toX(ox + item.x),
        toY(oy + item.y + item.ly),
        toX(ox + item.x + item.lx),
        toY(oy + item.y),
      ]);
    }
    if (!out) return;
    const x0 = Math.min(...outside.map(i => i.x));
    const midX = (right + toX(ox + x0)) / 2;
    const outY = toY(oy + out.y);
    const itemYs = outside.map(i => toY(oy + i.y + i.ly / 2));
    sheet.line(right, outY, midX, outY, 'pipe');
    PneuSymbol.flow(sheet, (right + midX) / 2, outY, 1);
    const low = Math.min(outY, ...itemYs);
    const high = Math.max(outY, ...itemYs);
    if (high - low > 0.2) sheet.line(midX, low, midX, high, 'pipe');
    for (const item of outside) {
      const y = toY(oy + item.y + item.ly / 2);
      sheet.line(midX, y, toX(ox + item.x), y, 'pipe');
    }
    const far = outside.reduce((best, other) => (other.x + other.lx > best.x + best.lx ? other : best));
    const farY = toY(oy + far.y + far.ly / 2);
    const farX = toX(ox + far.x + far.lx) + 4;
    sheet.path(`M${fmt(toX(ox + far.x + far.lx / 2))},${fmt(farY)} H${fmt(farX)}`, 'pipe');
    sheet.arrow(farX + 2.6, farY, 1, 0);
  }
  /** Двери на плане. */
  doorsPlan(sheet, toY) {
    const { ox, plan: plan, entry: entry } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const front = [plan.fuel && plan.fuel.door, entry && entry.wall === 'front' ? entry : null].filter(Boolean);
    for (const door of front) {
      this.gap(sheet, toY, [ox + door.x0, ox + door.x1], false);
      this.swingArc(sheet, [toX(ox + door.x0), toX(ox + door.x1)], toY(0), 1);
    }
    for (const door of plan.doors || []) this.leaves(sheet, toY, door, door.leaves);
    for (const door of this.drawing.dguDoors.filter(dguDoor => dguDoor.wall !== 'back')) this.dguEnd(sheet, toY, door);
    for (const door of this.drawing.dguBack) this.leaves(sheet, toY, { ...door, wall: 'back' }, 2);
    this.endLeaves(sheet, toY);
  }

  /** В торцах: ворота (у морского — штатные двери), ворота отсека бака, двери оператора — створки в проёме. */
  endLeaves(sheet, toY) {
    const { plan: plan, entry: entry } = this.drawing;
    for (const gate of this.drawing.gates) this.inEnd(sheet, toY, [gate, gate.wall === 'left', 2]);
    if (plan.fuel && plan.fuel.gate) this.inEnd(sheet, toY, [plan.fuel.gate, true, 2]);
    if (plan.exit) this.inEnd(sheet, toY, [plan.exit, plan.exit.wall === 'left', 1]);
    if (entry && entry.wall === 'left' && !entry.sea) this.inEnd(sheet, toY, [entry, true, 1]);
  }

  /** Дуга открывания створки: петля xh, край xf у стены yw, наружу dir. */
  swingArc(sheet, [hingeX, freeX], wallY, dir) {
    const fmt = EskdSheet.fmt;
    const radius = Math.abs(freeX - hingeX);
    const endY = wallY + dir * radius;
    sheet.line(hingeX, wallY, hingeX, endY, 'phantom');
    sheet.path(
      `M${fmt(hingeX)},${fmt(endY)} A${fmt(radius)},${fmt(radius)} 0 0 ${freeX > hingeX === dir > 0 ? 0 : 1} ${fmt(freeX)},${fmt(wallY)}`,
      'phantom',
    );
  }

  /** Проём в длинной стене: x0…x1 (мм), back — в задней. */
  gap(sheet, toY, [x0, x1], back) {
    const { scale: k, oy, We } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const y0 = back ? toY(We) : toY(oy);
    const wallT = oy * k;
    sheet.rect([toX(x0), y0, (x1 - x0) * k, wallT], 'thin', '#fff');
    sheet.line(toX(x0), y0, toX(x0), y0 + wallT, 'main');
    sheet.line(toX(x1), y0, toX(x1), y0 + wallT, 'main');
  }

  /** Сервисные ворота (двери) и двери-жалюзи ДГУ в задней стене: проём и n створок, чётные — от левого края. */
  leaves(sheet, toY, door, count) {
    const { ox, We } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const back = door.wall === 'back';
    const leafW = door.w / count;
    this.gap(sheet, toY, [ox + door.x0, ox + door.x1], back);
    for (let i = 0; i < count; i++) {
      const from = ox + door.x0 + i * leafW;
      const till = from + leafW;
      const left = i % 2 === 0;
      this.swingArc(sheet, [toX(left ? from : till), toX(left ? till : from)], back ? toY(We) : toY(0), back ? -1 : 1);
    }
  }

  /** Дверь-жалюзи ДГУ в торце: проём и две створки наружу. */
  dguEnd(sheet, toY, door) {
    const { ox, oy, Le } = this.drawing;
    const toX = value => this.drawing.sheetX(value);
    const fmt = EskdSheet.fmt;
    const isLeft = door.wall === 'left';
    const [lowY, highY] = [toY(oy + door.y0), toY(oy + door.y1)];
    const [x0, x1] = isLeft ? [toX(0), toX(ox)] : [toX(Le - ox), toX(Le)];
    const hingeX = isLeft ? x0 : x1;
    const sign = isLeft ? -1 : 1;
    const radius = (lowY - highY) / 2;
    sheet.rect([x0, highY, x1 - x0, lowY - highY], 'thin', '#fff');
    sheet.line(x0, lowY, x1, lowY, 'main');
    sheet.line(x0, highY, x1, highY, 'main');
    for (const [midY, sweep] of [
      [lowY, -1],
      [highY, 1],
    ]) {
      sheet.line(hingeX, midY, hingeX + sign * radius, midY, 'phantom');
      sheet.path(
        `M${fmt(hingeX + sign * radius)},${fmt(midY)} A${fmt(radius)},${fmt(radius)} 0 0 ${sweep > 0 === sign > 0 ? 1 : 0} ${fmt(hingeX)},${fmt(midY + sweep * radius)}`,
        'phantom',
      );
    }
  }

  /** Створки в проёме торца: d — проём (y0…y1), left — торец у входа, n — створок. */
  inEnd(sheet, toY, [door, left, count]) {
    const { scale: k, ox, oy, Le } = this.drawing;
    const wallX = left ? this.drawing.left : this.drawing.sheetX(Le - ox);
    const y0 = oy + door.y0;
    const width = door.y1 - door.y0;
    const leafW = width / count;
    sheet.rect([wallX, toY(y0 + width), ox * k, width * k], 'thin', '#fff');
    for (let i = 0; i < count; i++)
      sheet.rect(
        [wallX + ox * k * 0.25, toY(y0 + leafW * (i + 1)), Math.max(0.4, ox * k * 0.5), leafW * k],
        'main',
        '#fff',
      );
  }
  /** Цепочка размеров вдоль задней стены по заднему ряду. */
  chainPlan(k) {
    const x0 = this.drawing.geo.x0 || 0;
    const row = this.drawing.plan.items
      .filter(i => i.row === 0 && i.mount !== 'pipe')
      .sort((from, till) => from.x - till.x);
    if (!row.length) return { segs: [], lift: 0, tick: false, skip: [] };
    const pts = [x0];
    for (const item of row) pts.push(item.x, item.x + item.lx);
    pts.push(this.drawing.Li);
    const marks = [...new Set(pts.map(value => Math.round(value)))]
      .filter(value => value >= x0 && value <= this.drawing.Li)
      .sort((from, till) => from - till);
    const busy = [[], [], [], [], [], []];
    const segs = [];
    const skip = [];
    for (let i = 1; i < marks.length; i++) {
      const from = marks[i - 1] * k;
      const till = marks[i] * k;
      const text = Mm.text(marks[i] - marks[i - 1]);
      const textW = EskdSheet.textWidth(text, 3.5);
      const mid = (from + till) / 2;
      const [lift, x] = textW + 1 > till - from ? DrawPlan.place(busy, mid, textW) : [0, mid];
      if (lift < 0) {
        skip.push(text);
        continue;
      }
      busy[lift].push([x - textW / 2, x + textW / 2]);
      segs.push({ a: marks[i - 1], c: marks[i], t: text, lift, x });
    }
    return {
      segs,
      lift: Math.max(0, ...segs.map(seg => seg.lift)),
      tick: segs.some(seg => (seg.c - seg.a) * k < 2 * EskdSheet.ARROW[0] + 1.5),
      skip,
    };
  }
  /** Тесное число цепочки — выше (уровни 1…5) со сдвигом вбок, где свободно: [уровень, x]; не нашлось — [−1, m]. */
  static place(busy, mid, width) {
    const free = (level, x) =>
      !busy[level].some(([from, till]) => x - width / 2 - 1 < till && x + width / 2 + 1 > from);
    const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
    for (const level of [1, 2, 3, 4, 5]) {
      const step = steps.find(till => free(level, mid + till * (width / 2 + 1.2)));
      if (step !== undefined) return [level, mid + step * (width / 2 + 1.2)];
    }
    return [-1, mid];
  }

  /** Запас над планом под цепочку размеров, мм (и строка «не показаны …»). */
  chainTop(k) {
    const chain = this.chainPlan(k);
    return chain.segs.length ? 8 + 4.6 + chain.lift * 5.1 + (chain.skip.length ? 4.2 : 0) : 4;
  }
  /** Цепочка размеров вдоль ряда оборудования. */
  chain(sheet, y, from) {
    const toX = value => this.drawing.sheetX(value);
    const ox = this.drawing.ox;
    const chain = this.chainPlan(this.drawing.scale);
    const base = toX(ox);
    chain.segs.forEach((seg, i) =>
      sheet.dimH([toX(ox + seg.a), toX(ox + seg.c)], y, seg.t, [i ? null : from, from], {
        lift: seg.lift,
        tick: chain.tick,
        tx: base + seg.x,
      }),
    );
    if (chain.skip.length)
      sheet.text(
        base,
        y - 0.8 - chain.lift * 5.1 - 5,
        `Мелкие размеры цепочки не показаны в масштабе: ${chain.skip.join('; ')} мм`,
        2.5,
      );
  }
  /** Проход: [y0, y1] поперёк контейнера, ширина в самом узком месте и где мерить. */
  static aisle(plan) {
    const floor = plan.items.filter(i => i.mount === 'floor' || i.mount === 'frame');
    if (!floor.length) return null;
    if (plan.rows === 2) {
      const back = floor.filter(i => i.row === 1);
      const front = floor.filter(i => i.row === 0);
      if (!back.length || !front.length) return null;
      const y0 = Math.max(...back.map(i => i.y + i.ly));
      const y1 = Math.min(...front.map(i => i.y));
      const match = front.find(i => i.y === y1);
      return { y0, y1, w: y1 - y0, xm: match.x + match.lx / 2 };
    }
    const y1 = Math.min(...floor.map(i => i.y));
    const match = floor.find(i => i.y === y1);
    return { y0: 0, y1, w: y1, xm: match.x + match.lx / 2, dgu: match.kind === 'dgu' };
  }

  /** Отрезки трубопровода на плане (лист). */
  pipeSegs(toX, toY) {
    const { ox, oy } = this.drawing;
    const segs = [];
    for (const line of this.drawing.lines) {
      for (const [from, till] of StationLayout.runs(line))
        segs.push([toX(ox + from), toY(oy + line.y), toX(ox + till), toY(oy + line.y)]);
      for (const branch of line.branches || [])
        segs.push([toX(ox + branch.x), toY(oy + branch.y0), toX(ox + branch.x), toY(oy + branch.y1)]);
      const points = ((line.out && StationLayout.outPath(line, this.drawing.plan.int[1])) || { pts: [] }).pts.map(
        ([x, y]) => [toX(ox + x), toY(oy + y)],
      );
      for (let k = 1; k < points.length; k++) segs.push([...points[k - 1], ...points[k]]);
    }
    return segs;
  }

  /** Расстояние от точки до ближайшего отрезка. */
  static gap(segs, x, y) {
    return Math.min(
      Infinity,
      ...segs.map(([startX, startY, endX, endY]) => {
        const [dx, dy] = [endX - startX, endY - startY];
        const lenSq = dx * dx + dy * dy;
        const frac = lenSq ? Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / lenSq)) : 0;
        return Math.hypot(x - startX - frac * dx, y - startY - frac * dy);
      }),
    );
  }

  /** Точка выноски номера позиции на плане — мимо труб (не ближе 1,5 мм листа), иначе самая далёкая от них. */
  anchor(item, toX, toY) {
    const { ox, oy } = this.drawing;
    const segs = this.pipeSegs(toX, toY);
    const [x0, x1] = [toX(ox + item.x), toX(ox + item.x + item.lx)];
    const [y0, y1] = [toY(oy + item.y + item.ly), toY(oy + item.y)];
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    let [best, found] = [center, DrawPlan.gap(segs, center.x, center.y)];
    if (!segs.length || found >= 1.5) return center;
    for (const fracX of [0.5, 0.35, 0.65, 0.2, 0.8])
      for (const fracY of [0.5, 0.65, 0.35, 0.8, 0.2]) {
        const point = { x: x0 + (x1 - x0) * fracX, y: y0 + (y1 - y0) * fracY };
        const gap = DrawPlan.gap(segs, point.x, point.y);
        if (gap >= 1.5) return point;
        if (gap > found) [best, found] = [point, gap];
      }
    return best;
  }
}
