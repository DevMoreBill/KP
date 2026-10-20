import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';
import { SchemeLayout } from './scheme-layout.js';

/** Аппараты на линии пневмосхемы. */
export class SchemeUnits {
  /** Аппарат на линии. */
  static node(sh, n) {
    const { u } = n;
    const r = u.air || {};
    if (u.kind === 'receiver') return SchemeUnits.receiver(sh, n);
    if (u.kind === 'dryer' && r.type === 'gen') {
      PneuSymbol.generator(sh, n.x, n.y, /кислород|O2|О2/i.test(u.name || '') ? 'O₂' : 'N₂', n.m);
      SchemeUnits.label(sh, n);
      return null;
    }
    if (u.kind === 'dryer') return SchemeUnits.dryer(sh, n);
    const g = r.grade;
    const drain = g === 'carbon' || g === 'dust' ? '' : 'auto';
    const s = PneuSymbol.filter(sh, [n.x, n.y], 5 * n.m, drain, g !== 'sep');
    SchemeUnits.label(sh, n);
    return drain ? s.bot : null;
  }

  /** Номер позиции у обозначения. */
  static label(sh, { u, x, y, m, flip }) {
    const [dx, dl] = SchemeLayout.lab(u);
    sh.text(flip ? x - dx * m : x + dx * m, y - dl * m, String(u.pos), 3.5, flip ? { a: 'end' } : undefined);
  }

  /** Ресивер: предохранительный клапан, манометр, кран слива. */
  static receiver(sh, { u, x, y, m }) {
    const s = PneuSymbol.receiver(sh, x, y, 16 * m, 7 * m);
    sh.line(x + 3.5 * m, s.top, x + 3.5 * m, s.top - 2.6 * m, 'bold');
    PneuSymbol.safety(sh, x + 3.5 * m, s.top - 2.6 * m, 1.8 * m);
    sh.line(x - 4 * m, s.top, x - 4 * m, s.top - 2.2 * m, 'bold');
    PneuSymbol.gauge(sh, x - 4 * m, s.top - 2.2 * m - 1.8 * m, 1.8 * m);
    sh.line(x, y + 3.5 * m, x, y + 6 * m, 'bold');
    PneuSymbol.valve(sh, [x, y + 7.8 * m], 1.6 * m, { vertical: true });
    sh.text(x - 8.5 * m, y - 4.5 * m, String(u.pos), 3.5, { a: 'end' });
    return [x, y + 9.4 * m];
  }

  /** Осушитель: вне группы — байпас (обвод с нормально закрытым краном); у адсорбционного слива нет. */
  static dryer(sh, n) {
    const { x, y, m } = n;
    const ads = (n.u.air || {}).type === 'ads';
    const s = PneuSymbol.dryer(sh, x, y, 6 * m);
    SchemeUnits.label(sh, n);
    if (!n.bare) {
      const xa = n.ltr ? x - 8.5 * m : x + 8.5 * m;
      const xb = n.ltr ? x + 8.5 * m : x - 8.5 * m;
      const yb = y - 12.5 * m;
      sh.dot(xa, y, 0.6);
      sh.dot(xb, y, 0.6);
      sh.line(xa, y, xa, yb, 'bold');
      sh.line(xb, y, xb, yb, 'bold');
      sh.line(xa, yb, x - 1.8 * m, yb, 'bold');
      sh.line(x + 1.8 * m, yb, xb, yb, 'bold');
      PneuSymbol.valve(sh, [x, yb], 1.8 * m, { closed: true });
    }
    return ads ? null : s.bot;
  }

  /** Одинаковые аппараты параллельно. */
  static group(sh, n) {
    const { x, y, m, ltr, r, par: U } = n;
    const k = U.length;
    const g = SchemeLayout.par(U[0], k);
    const d = ltr ? 1 : -1;
    const xs = x - d * g.hw * m;
    const xe = x + d * g.hw * m;
    const ys = U.map((u, i) => y + (i - (k - 1) / 2) * g.dy * m);
    const xc = U.map((u, i) => x + d * (i - (k - 1) / 2) * g.sx * m);
    sh.line(xs, ys[0], xs, ys[k - 1], 'bold');
    sh.line(xe, ys[0], xe, ys[k - 1], 'bold');
    sh.dot(xs, y, 0.6);
    sh.dot(xe, y, 0.6);
    const out = [];
    U.forEach((u, i) => {
      SchemeUnits.branch(sh, { xs, xe, d, yi: ys[i], xi: xc[i], a: g.a * m, m });
      const p = SchemeUnits.node(sh, { u, x: xc[i], y: ys[i], m, ltr, bare: true, flip: !ltr });
      if (p) out.push({ x: p[0], y: p[1], r });
    });
    if (n.n > k) {
      const [dx, dl] = SchemeLayout.lab(U[0]);
      const w = EskdSheet.tw(String(U[0].pos), 3.5) + 1.2;
      sh.text(xc[0] + d * (dx * m + w), ys[0] - dl * m, `${n.n} шт.`, 2.5, { a: ltr ? 'start' : 'end' });
    }
    return out;
  }

  /** Ветвь группы: линия с кранами до и после аппарата (xi ± a). */
  static branch(sh, { xs, xe, d, yi, xi, a, m }) {
    const v = 1.8 * m;
    const xv0 = xs + d * 4 * m;
    const xv1 = xe - d * 4 * m;
    sh.line(xs, yi, xv0 - d * v, yi, 'bold');
    PneuSymbol.valve(sh, [xv0, yi], v);
    sh.line(xv0 + d * v, yi, xi - d * a, yi, 'bold');
    sh.line(xi + d * a, yi, xv1 - d * v, yi, 'bold');
    PneuSymbol.valve(sh, [xv1, yi], v);
    sh.line(xv1 + d * v, yi, xe, yi, 'bold');
  }
}
