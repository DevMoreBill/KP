import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';
import { SchemeLayout } from './scheme-layout.js';

/** Аппараты на линии пневмосхемы. */
export class SchemeUnits {
  /** Аппарат на линии. */
  static node(sheet, node) {
    const { u: unit } = node;
    const air = unit.air || {};
    if (unit.kind === 'receiver') return SchemeUnits.receiver(sheet, node);
    if (unit.kind === 'dryer' && air.type === 'gen') {
      PneuSymbol.generator(sheet, node.x, node.y, /кислород|O2|О2/i.test(unit.name || '') ? 'O₂' : 'N₂', node.m);
      SchemeUnits.label(sheet, node);
      return null;
    }
    if (unit.kind === 'dryer') return SchemeUnits.dryer(sheet, node);
    const grade = air.grade;
    const drain = grade === 'carbon' || grade === 'dust' ? '' : 'auto';
    const symbol = PneuSymbol.filter(sheet, [node.x, node.y], 5 * node.m, drain, grade !== 'sep');
    SchemeUnits.label(sheet, node);
    return drain ? symbol.bot : null;
  }

  /** Номер позиции у обозначения. */
  static label(sheet, { u: unit, x, y, m: scale, flip }) {
    const [dx, lift] = SchemeLayout.lab(unit);
    sheet.text(
      flip ? x - dx * scale : x + dx * scale,
      y - lift * scale,
      String(unit.pos),
      3.5,
      flip ? { a: 'end' } : undefined,
    );
  }

  /** Ресивер: предохранительный клапан, манометр, кран слива. */
  static receiver(sheet, { u: unit, x, y, m: scale }) {
    const symbol = PneuSymbol.receiver(sheet, x, y, 16 * scale, 7 * scale);
    sheet.line(x + 3.5 * scale, symbol.top, x + 3.5 * scale, symbol.top - 2.6 * scale, 'bold');
    PneuSymbol.safety(sheet, x + 3.5 * scale, symbol.top - 2.6 * scale, 1.8 * scale);
    sheet.line(x - 4 * scale, symbol.top, x - 4 * scale, symbol.top - 2.2 * scale, 'bold');
    PneuSymbol.gauge(sheet, x - 4 * scale, symbol.top - 2.2 * scale - 1.8 * scale, 1.8 * scale);
    sheet.line(x, y + 3.5 * scale, x, y + 6 * scale, 'bold');
    PneuSymbol.valve(sheet, [x, y + 7.8 * scale], 1.6 * scale, { vertical: true });
    sheet.text(x - 8.5 * scale, y - 4.5 * scale, String(unit.pos), 3.5, { a: 'end' });
    return [x, y + 9.4 * scale];
  }

  /** Осушитель: вне группы — байпас (обвод с нормально закрытым краном); у адсорбционного слива нет. */
  static dryer(sheet, node) {
    const { x, y, m: scale } = node;
    const ads = (node.u.air || {}).type === 'ads';
    const symbol = PneuSymbol.dryer(sheet, x, y, 6 * scale);
    SchemeUnits.label(sheet, node);
    if (!node.bare) {
      const inX = node.ltr ? x - 8.5 * scale : x + 8.5 * scale;
      const outX = node.ltr ? x + 8.5 * scale : x - 8.5 * scale;
      const topY = y - 12.5 * scale;
      sheet.dot(inX, y, 0.6);
      sheet.dot(outX, y, 0.6);
      sheet.line(inX, y, inX, topY, 'bold');
      sheet.line(outX, y, outX, topY, 'bold');
      sheet.line(inX, topY, x - 1.8 * scale, topY, 'bold');
      sheet.line(x + 1.8 * scale, topY, outX, topY, 'bold');
      PneuSymbol.valve(sheet, [x, topY], 1.8 * scale, { closed: true });
    }
    return ads ? null : symbol.bot;
  }

  /** Одинаковые аппараты параллельно. */
  static group(sheet, node) {
    const { x, y, m: scale, ltr, r: row, par: units } = node;
    const k = units.length;
    const geom = SchemeLayout.par(units[0], k);
    const dir = ltr ? 1 : -1;
    const startX = x - dir * geom.hw * scale;
    const endX = x + dir * geom.hw * scale;
    const rowsY = units.map((unit, i) => y + (i - (k - 1) / 2) * geom.dy * scale);
    const colsX = units.map((unit, i) => x + dir * (i - (k - 1) / 2) * geom.sx * scale);
    sheet.line(startX, rowsY[0], startX, rowsY[k - 1], 'bold');
    sheet.line(endX, rowsY[0], endX, rowsY[k - 1], 'bold');
    sheet.dot(startX, y, 0.6);
    sheet.dot(endX, y, 0.6);
    const out = [];
    units.forEach((unit, i) => {
      SchemeUnits.branch(sheet, {
        xs: startX,
        xe: endX,
        d: dir,
        yi: rowsY[i],
        xi: colsX[i],
        a: geom.a * scale,
        m: scale,
      });
      const symbol = SchemeUnits.node(sheet, {
        u: unit,
        x: colsX[i],
        y: rowsY[i],
        m: scale,
        ltr,
        bare: true,
        flip: !ltr,
      });
      if (symbol) out.push({ x: symbol[0], y: symbol[1], r: row });
    });
    if (node.n > k) {
      const [dx, lift] = SchemeLayout.lab(units[0]);
      const labelW = EskdSheet.textWidth(String(units[0].pos), 3.5) + 1.2;
      sheet.text(colsX[0] + dir * (dx * scale + labelW), rowsY[0] - lift * scale, `${node.n} шт.`, 2.5, {
        a: ltr ? 'start' : 'end',
      });
    }
    return out;
  }

  /** Ветвь группы: линия с кранами до и после аппарата (xi ± a). */
  static branch(sheet, { xs: startX, xe: endX, d: dir, yi: rowY, xi: inletX, a: arrow, m: scale }) {
    const valveGap = 1.8 * scale;
    const xv0 = startX + dir * 4 * scale;
    const xv1 = endX - dir * 4 * scale;
    sheet.line(startX, rowY, xv0 - dir * valveGap, rowY, 'bold');
    PneuSymbol.valve(sheet, [xv0, rowY], valveGap);
    sheet.line(xv0 + dir * valveGap, rowY, inletX - dir * arrow, rowY, 'bold');
    sheet.line(inletX + dir * arrow, rowY, xv1 - dir * valveGap, rowY, 'bold');
    PneuSymbol.valve(sheet, [xv1, rowY], valveGap);
    sheet.line(xv1 + dir * valveGap, rowY, endX, rowY, 'bold');
  }
}
