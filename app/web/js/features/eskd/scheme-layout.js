/** Раскладка пневмосхемы: столбец компрессоров, узлы строками змейкой, размеры обозначений (при модуле 1). */
export class SchemeLayout {
  static STEP = 25; // шаг аппаратов по линии, мм
  static ROW = 48; // между строками схемы, мм

  /** Раскладка при модулях 0,7…1,6. */
  static layout({ nc, nodes, wide, outW }, top, bottom) {
    const C = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7].map(v => SchemeLayout.geo(v / 10, { nc, nodes, wide, outW }, top));
    const fit = C.filter(g => top + g.h <= bottom);
    const big = fit.filter(g => g.m >= 0.9);
    let pool = [C[C.length - 1]];
    if (big.length) pool = big;
    else if (fit.length) pool = fit;
    return pool.reduce((b, g) => (g.rows < b.rows || (g.rows === b.rows && g.m > b.m) ? g : b));
  }

  static geo(m, { nc, nodes, wide, outW }, top) {
    const xCol = 25 + (wide ? 54 : 35) * m;
    const xs0 = xCol + 14 * m;
    const xR = 201 - 2 * m;
    const S = SchemeLayout.STEP * m;
    const per = Math.max(1, Math.floor((xR - 9 * m - xs0) / S) + 1);
    const pos = SchemeLayout.places(nodes, per, (ltr, c) => (ltr ? xs0 + c * S : xs0 + (per - 1 - c) * S));
    const lr = pos.length ? pos[pos.length - 1].r : 0;
    const ex = Array.from({ length: lr + 2 }, (_, i) =>
      Math.max(0, ...nodes.filter((n, k) => pos[k].r === i).map(n => n.ex || 0)),
    );
    const dy = wide ? 21.5 * m + 5.5 : 24 * m;
    const yT = top + 12 + ex[0] * m;
    const colBot = yT + Math.max(0, nc - 1) * dy + 15 * m;
    const Y = [yT];
    for (let i = 1; i <= lr + 1; i++) Y.push(Y[i - 1] + (SchemeLayout.ROW + ex[i - 1] + ex[i]) * m);
    const ltr = lr % 2 === 0;
    const last = pos[pos.length - 1];
    const px = last ? last.x + (ltr ? 1 : -1) * nodes[nodes.length - 1].half * m : xCol;
    const lo = colBot < Y[lr] - 3 ? 26 : xCol + 2;
    const room = ltr ? 200 - px : px - lo;
    const rows = lr + 1 + (room >= 14 * m + 3.8 + outW + 1 ? 0 : 1);
    const h = Math.max(colBot, Y[rows - 1] + (17 + ex[rows - 1]) * m + 6) - top;
    return { m, xCol, xs0, xR, xL: xs0 - 9 * m, S, per, dy, yT, rows, colBot, h, pos, Y, ex };
  }

  /** Места узлов: узел на w мест (группа параллельно — на два), не помещается в строку — с начала следующей. */
  static places(nodes, per, X) {
    const pos = [];
    let [r, j] = [0, 0];
    for (const n of nodes) {
      const w = Math.min(n.w || 1, per);
      if (j + w > per) [r, j] = [r + 1, 0];
      const ltr = r % 2 === 0;
      pos.push({ r, ltr, x: X(ltr, j + (w - 1) / 2) });
      j += w;
    }
    return pos;
  }

  /** Полуширина обозначения по линии. */
  static half(u) {
    return { receiver: 8, dryer: 6 }[u.kind] || 5;
  }

  /** Группа k одинаковых параллельно. */
  static par(u, k) {
    const dryer = u.kind === 'dryer';
    const a = dryer ? 6 : 5;
    let ah = 5;
    if (dryer) ah = (u.air || {}).type === 'gen' ? 4.5 : 6;
    const dy = 2 * ah + 3;
    const sx = a + 1.5;
    return { a, ah, dy, sx, hw: ((k - 1) / 2) * sx + a + 7.5, ex: k > 2 ? Math.max(0, dy + ah + 3 - 17) : 0 };
  }

  /** Номер позиции у обозначения: [вправо (flip — влево), вверх от середины]. */
  static lab(u) {
    if (u.kind !== 'dryer') return [3.6, 5.4];
    return (u.air || {}).type === 'gen' ? [6.8, 5.5] : [4, 6.2];
  }
}
