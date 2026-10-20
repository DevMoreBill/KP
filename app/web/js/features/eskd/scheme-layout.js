/** Раскладка пневмосхемы: столбец компрессоров, узлы строками змейкой, размеры обозначений (при модуле 1). */
export class SchemeLayout {
  static STEP = 25; // шаг аппаратов по линии, мм
  static ROW = 48; // между строками схемы, мм

  /** Раскладка при модулях 0,7…1,6. */
  static layout({ nc: compCount, nodes, wide, outW }, top, bottom) {
    const candidates = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7].map(tenths =>
      SchemeLayout._geo(tenths / 10, { nc: compCount, nodes, wide, outW }, top),
    );
    const fit = candidates.filter(geom => top + geom.h <= bottom);
    const big = fit.filter(geom => geom.m >= 0.9);
    let pool = [candidates[candidates.length - 1]];
    if (big.length) pool = big;
    else if (fit.length) pool = fit;
    return pool.reduce((best, geom) =>
      geom.rows < best.rows || (geom.rows === best.rows && geom.m > best.m) ? geom : best,
    );
  }

  static _geo(scale, { nc: compCount, nodes, wide, outW }, top) {
    const xCol = 25 + (wide ? 54 : 35) * scale;
    const xs0 = xCol + 14 * scale;
    const rightX = 201 - 2 * scale;
    const step = SchemeLayout.STEP * scale;
    const per = Math.max(1, Math.floor((rightX - 9 * scale - xs0) / step) + 1);
    const pos = SchemeLayout.places(nodes, per, (ltr, col) => (ltr ? xs0 + col * step : xs0 + (per - 1 - col) * step));
    const lastRow = pos.length ? pos[pos.length - 1].r : 0;
    const extra = Array.from({ length: lastRow + 2 }, (_, i) =>
      Math.max(0, ...nodes.filter((node, k) => pos[k].r === i).map(node => node.ex || 0)),
    );
    const dy = wide ? 21.5 * scale + 5.5 : 24 * scale;
    const topY = top + 12 + extra[0] * scale;
    const colBot = topY + Math.max(0, compCount - 1) * dy + 15 * scale;
    const rowY = [topY];
    for (let i = 1; i <= lastRow + 1; i++)
      rowY.push(rowY[i - 1] + (SchemeLayout.ROW + extra[i - 1] + extra[i]) * scale);
    const ltr = lastRow % 2 === 0;
    const last = pos[pos.length - 1];
    const lastX = last ? last.x + (ltr ? 1 : -1) * nodes[nodes.length - 1].half * scale : xCol;
    const low = colBot < rowY[lastRow] - 3 ? 26 : xCol + 2;
    const room = ltr ? 200 - lastX : lastX - low;
    const rows = lastRow + 1 + (room >= 14 * scale + 3.8 + outW + 1 ? 0 : 1);
    const height = Math.max(colBot, rowY[rows - 1] + (17 + extra[rows - 1]) * scale + 6) - top;
    return {
      m: scale,
      xCol,
      xs0,
      xR: rightX,
      xL: xs0 - 9 * scale,
      S: step,
      per,
      dy,
      yT: topY,
      rows,
      colBot,
      h: height,
      pos,
      Y: rowY,
      ex: extra,
    };
  }

  /** Места узлов: узел на w мест (группа параллельно — на два), не помещается в строку — с начала следующей. */
  static places(nodes, per, colX) {
    const pos = [];
    let [counter, j] = [0, 0];
    for (const node of nodes) {
      const span = Math.min(node.w || 1, per);
      if (j + span > per) [counter, j] = [counter + 1, 0];
      const ltr = counter % 2 === 0;
      pos.push({ r: counter, ltr, x: colX(ltr, j + (span - 1) / 2) });
      j += span;
    }
    return pos;
  }

  /** Полуширина обозначения по линии. */
  static half(unit) {
    return { receiver: 8, dryer: 6 }[unit.kind] || 5;
  }

  /** Группа k одинаковых параллельно. */
  static par(unit, k) {
    const dryer = unit.kind === 'dryer';
    const halfW = dryer ? 6 : 5;
    let armH = 5;
    if (dryer) armH = (unit.air || {}).type === 'gen' ? 4.5 : 6;
    const dy = 2 * armH + 3;
    const stepX = halfW + 1.5;
    return {
      a: halfW,
      ah: armH,
      dy,
      sx: stepX,
      hw: ((k - 1) / 2) * stepX + halfW + 7.5,
      ex: k > 2 ? Math.max(0, dy + armH + 3 - 17) : 0,
    };
  }

  /** Номер позиции у обозначения: [вправо (flip — влево), вверх от середины]. */
  static lab(unit) {
    if (unit.kind !== 'dryer') return [3.6, 5.4];
    return (unit.air || {}).type === 'gen' ? [6.8, 5.5] : [4, 6.2];
  }
}
