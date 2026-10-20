import { EskdSheet } from '../eskd/eskd-sheet.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMass } from '../layout/station-mass.js';

/** Схема строповки: вид сбоку и с торца, знаки № 9 и № 12 (ГОСТ 14192-96), условные обозначения. */
export class DrawSling {
  constructor(o) {
    this.o = o;
  }

  /** Знак № 12 «Центр тяжести» (ГОСТ 14192-96). */
  static signCog(sh, cx, cy, B) {
    const f = EskdSheet.f;
    const a = B * 0.1;
    const R = B * 0.31;
    const r = R - B * 0.09;
    const g = Math.asin(Math.min(0.9, (a / 2 + B * 0.05) / r));
    const P = (rr, t) => `${f(cx + rr * Math.cos(t))},${f(cy + rr * Math.sin(t))}`;
    sh.rect([cx - B / 2, cy - a / 2, B, a], 'thin', '#000');
    sh.rect([cx - a / 2, cy - B / 2, a, B], 'thin', '#000');
    for (let k = 0; k < 4; k++) {
      const t0 = (k * Math.PI) / 2 + g;
      const t1 = ((k + 1) * Math.PI) / 2 - g;
      sh.path(
        `M${P(R, t0)} A${f(R)},${f(R)} 0 0 1 ${P(R, t1)} L${P(r, t1)} A${f(r)},${f(r)} 0 0 0 ${P(r, t0)} Z`,
        'thin',
        '#000',
      );
    }
  }
  /** Знак № 9 «Место строповки» (ГОСТ 14192-96). */
  static signSling(sh, cx, cy, H) {
    const f = EskdSheet.f;
    const lw = H * 0.42;
    const y0 = cy - H / 2;
    const uh = H * 0.22;
    const oh = H * 0.3;
    const t = Math.max(0.3, H * 0.07);
    sh.path(
      `M${f(cx - lw / 2)},${f(y0)} V${f(y0 + uh - lw / 2)} A${f(lw / 2)},${f(lw / 2)} 0 0 0 ${f(cx + lw / 2)},${f(y0 + uh - lw / 2)} V${f(y0)}`,
      'main',
    );
    for (const y of [y0 + H * 0.26, y0 + H * 0.62]) sh.rect([cx - lw / 2, y, lw, oh], 'main', 'none', lw / 2);
    sh.rect([cx - t / 2, y0 + H * 0.08, t, H * 0.9], 'thin', '#000');
  }
  /** Крюк над центром тяжести: кольцо стропа и крюк. */
  static hook(sh, x, y) {
    sh.circle(x, y, 1.1, 'main');
    sh.path(`M${EskdSheet.f(x)},${EskdSheet.f(y - 1.1)} V${EskdSheet.f(y - 5)}`, 'main');
    sh.circle(x, y - 6.2, 1.2, 'main');
  }
  /** Схема строповки — вид со стороны лицевой стены. */
  slingSide(sh, x0, y0, hv, cap) {
    const { k, Le, He, ms: M } = this.o;
    const S = M.sling;
    const n = StationLayout.n;
    const yg = y0 + hv - 23;
    const X = x => x0 + x * k;
    const Z = z => yg - (this.o.dz + z) * k;
    const cg = M.cg;
    sh.text(X(Le / 2), yg + 21.5, cap, 2.5, { a: 'middle' });
    this.sideOutline(sh, { X, Z, yg });
    const hz = He + S.hook;
    const hx = X(cg.x);
    const v = { X, Z, hx, hz, ring: x => sh.circle(X(x), Z(He), 0.9, 'main', '#fff') };
    let zt = Z(hz);
    if (S.frame) zt = this.sideFrame(sh, S, v);
    else if (S.beam) zt = this.sideBeam(sh, S, v);
    else this.sideLegs(sh, S, v);
    DrawSling.hook(sh, hx, Z(hz));
    sh.line(hx, zt, hx, Z(cg.z) - 4, 'axis');
    DrawSling.signCog(sh, hx, Z(cg.z), 8);
    sh.text(hx + 5, Z(cg.z) - 2.5, 'ЦТ', 3.5);
    for (const x of [X(450), X(Le - 450)]) DrawSling.signSling(sh, x, Z(He - 450), 7);
    // размеры (ГОСТ 2.307): меньший — ближе к изображению
    sh.dimH([X(0), hx], yg + 8, n(cg.x), [Z(0), Z(cg.z)], { out: 'r' });
    sh.dimH([X(0), X(Le)], yg + 15, n(Le), [Z(0), Z(0)]);
    sh.dimV([Z(cg.z), Z(0)], X(0) - 7, n(cg.z), [hx, X(0)], { out: true });
    sh.dimV([Z(hz), Z(He + this.o.rise)], X(0) - 14, n(S.hook - this.o.rise), [hx, X(0)], { out: true });
  }

  /** Контур сбоку: шасси, корпус, крыша, глушители, земля. */
  sideOutline(sh, { X, Z, yg }) {
    const { k, Le, He, rise } = this.o;
    if (this.o.dz) sh.rect([X(40), Z(0), (Le - 80) * k, 200 * k], 'thin', '#fff');
    sh.rect([X(0), Z(He), Le * k, He * k], 'main', '#fff');
    if (rise) sh.rect([X(0), Z(He + rise), Le * k, rise * k], 'main', '#fff');
    for (const m of this.o.rf) sh.rect([X(this.o.ox + m.x), Z(He + m.gap + m.d), m.lx * k, m.d * k], 'thin', '#fff');
    sh.line(X(0) - 4, yg, X(Le) + 4, yg, 'thin');
  }

  /** Рамная траверса: ветви к фитингам вертикальны, рама — на двухветвевом стропе от проушин над центром тяжести. */
  sideFrame(sh, S, { X, Z, hx, hz, ring }) {
    const { k, He } = this.o;
    const n = StationLayout.n;
    const F = S.frame;
    const zf = Z(He + F.z);
    sh.rect([X(F.x0) - 1, zf - 1.2, (F.x1 - F.x0) * k + 2, 1.2], 'main', '#000');
    for (const x of [F.x0, F.x1]) {
      sh.line(X(x), Z(He), X(x), zf, 'main');
      ring(x);
    }
    for (const x of F.lugs) sh.line(X(x), zf - 1.2, hx, Z(hz) + 1.1, 'main');
    const lx = X(Math.min(...F.lugs));
    sh.text(X(F.x0) + 2, (Z(He) + zf) / 2 + 1, `ветви ${n(S.legs[0].len)} — вертикально`, 2.5);
    sh.text(X(F.x0) + 2, zf - 2.4, 'рамная траверса', 2.5);
    sh.text((lx + hx) / 2 - 2, (zf + Z(hz)) / 2, `${n(F.len)} (${F.deg}°)`, 2.5, { a: 'end' });
    return zf;
  }

  /** Траверса: ветви от точек строповки к ней (на виде сбоку — вертикально), траверса подвешена над центром тяжести. */
  sideBeam(sh, S, { X, Z, hx, hz, ring }) {
    const { k, He } = this.o;
    const n = StationLayout.n;
    const B = S.beam;
    const zb = Z(He + B.z);
    sh.rect([X(B.x0) - 1, zb - 1.2, (B.x1 - B.x0) * k + 2, 1.2], 'main', '#000');
    sh.line(hx, zb - 1.2, hx, Z(hz) + 1.1, 'main');
    for (const q of S.legs.filter(q => q.y < this.o.We / 2)) {
      sh.line(X(q.x), Z(He), X(q.x), zb, 'main');
      ring(q.x);
    }
    const len = Math.max(...S.legs.map(q => q.len));
    const deg = Math.max(...S.legs.map(q => q.deg));
    sh.text(X(B.x0) + 2, (Z(He) + zb) / 2, `ветви ${n(len)} (${deg}°)`, 2.5);
    sh.text((X(B.x0) + hx) / 2, zb - 2.4, 'траверса', 2.5, { a: 'middle' });
    return zb;
  }

  /** Четырёхветвевой строп: ветви к крюку с длиной и углом. */
  sideLegs(sh, S, { X, Z, hx, hz, ring }) {
    const { He } = this.o;
    const cx = this.o.ms.cg.x;
    for (const q of S.legs.filter(q => q.y < this.o.We / 2)) {
      sh.line(X(q.x), Z(He), hx, Z(hz), 'main');
      ring(q.x);
      const x = X(q.x) + (hx - X(q.x)) * 0.35;
      const y = Z(He) + (Z(hz) - Z(He)) * 0.35;
      const left = q.x < cx;
      sh.text(x + (left ? -2 : 2), y, `${StationLayout.n(q.len)} (${q.deg}°)`, 2.5, { a: left ? 'end' : 'start' });
    }
  }

  /** Схема строповки — вид с торца у входа (лицевая стена справа). */
  slingEnd(sh, x0, y0, hv, cap) {
    const { k, We, He, ms: M } = this.o;
    const S = M.sling;
    const n = StationLayout.n;
    const yg = y0 + hv - 23;
    const XL = y => x0 + (We - y) * k;
    const Z = z => yg - (this.o.dz + z) * k;
    const cg = M.cg;
    sh.text(XL(We / 2), yg + 21.5, cap, 2.5, { a: 'middle' });
    sh.rect([XL(We), Z(He), We * k, He * k], 'main', '#fff');
    const roof = this.endRoof(XL, Z);
    if (roof) sh.poly(roof, 'main', '#fff');
    sh.line(XL(We) - 4, yg, XL(0) + 4, yg, 'thin');
    const hz = He + S.hook;
    const hx = XL(cg.y);
    const zt = this.endRig(sh, S, { XL, Z, hx, hz });
    DrawSling.hook(sh, hx, Z(hz));
    sh.line(hx, zt, hx, Z(cg.z) - 4, 'axis');
    DrawSling.signCog(sh, hx, Z(cg.z), 8);
    sh.dimH([hx, XL(0)], yg + 8, n(cg.y), [Z(cg.z), Z(0)], { out: 'r' });
    sh.dimH([XL(We), XL(0)], yg + 15, n(We), [Z(0), Z(0)]);
  }

  /** Крыша с торца: двускатная, арочная или односкатная (плоская — null). */
  endRoof(XL, Z) {
    const { We, He, rise: rz } = this.o;
    if (!rz) return null;
    const roof = this.o.g.roof;
    if (roof === 'gable')
      return [
        [XL(We), Z(He)],
        [XL(We / 2), Z(He + rz)],
        [XL(0), Z(He)],
      ];
    if (roof !== 'arch')
      return [
        [XL(We), Z(He)],
        [XL(0), Z(He + rz)],
        [XL(0), Z(He)],
      ];
    const rc = ((We * We) / 4 + rz * rz) / (2 * rz);
    const P = [];
    for (let j = 0; j <= 16; j++) {
      const y = (We * j) / 16;
      P.push([XL(y), Z(He + rz - rc + Math.sqrt(Math.max(0, rc * rc - (y - We / 2) * (y - We / 2))))]);
    }
    return P;
  }

  /** С торца: рамная траверса или ветви к крюку (с траверсой — к ней); возвращает верх оси центра тяжести. */
  endRig(sh, S, { XL, Z, hx, hz }) {
    const { k, We, He } = this.o;
    const ring = y => sh.circle(XL(y), Z(He), 0.9, 'main', '#fff');
    const F = S.frame;
    if (F) {
      const zf = Z(He + F.z);
      sh.rect([XL(F.y1) - 1, zf - 1.2, (F.y1 - F.y0) * k + 2, 1.2], 'main', '#000');
      for (const y of [F.y0, F.y1]) {
        sh.line(XL(y), Z(He), XL(y), zf, 'main');
        ring(y);
      }
      sh.line(hx, zf - 1.2, hx, Z(hz) + 1.1, 'main');
      return zf;
    }
    const zj = S.beam ? He + S.beam.z : hz;
    for (const y of [StationMass.LUG[1], We - StationMass.LUG[1]]) {
      sh.line(XL(y), Z(He), hx, Z(zj), 'main');
      ring(y);
    }
    if (S.beam) {
      sh.circle(hx, Z(zj), 1.3, 'main', '#000');
      sh.line(hx, Z(zj), hx, Z(hz) + 1.1, 'main');
    }
    return Z(zj) + 1.3;
  }

  /** Подписи под схемой: знаки (что о них сказано в ГОСТ 14192-96), масса и центр тяжести. */
  legendItems() {
    const M = this.o.ms;
    const n = StationLayout.n;
    const c = M.cg;
    const W = M.sling.wll;
    const t = v => String(v).replace('.', ',');
    const wl = W
      ? [
          `Грузоподъёмность каждой ветви стропа — не менее ${t(W.leg)} т${W.top ? `, ветви стропа рамы траверсы — не менее ${t(W.top)} т` : ''}: S = Q / (n · cos α), в расчёте n = ${W.n} ветви (РД 10-33-93, п. 2.1.4), α = ${W.deg}°.`,
        ]
      : [];
    return [...this._legend(M, n, c), ...wl];
  }
  _legend(M, n, c) {
    return [
      '№ 9 «Место строповки» — у каждой точки строповки, с двух сторон (ГОСТ 14192-96, п. 5.5.1).',
      '№ 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести (ГОСТ 14192-96, п. 5.5.2).',
      `Масса ${M.modK ? `модуля М${M.modK} (самого тяжёлого; модули поднимают по одному)` : 'станции'} — около ${n(M.mass)} кг; центр тяжести (ЦТ): X = ${n(c.x)}, Y = ${n(c.y)}, Z = ${n(c.z)} мм — от торца у входа, от лицевой стены, от низа${M.missing.length ? `; без поз. ${M.missing.join(', ')} (масса не указана) — уточняется` : ''}.`,
    ];
  }
  /** Высота подписей под схемой, мм: строка знака — не ниже самого знака. */
  legendH(sh) {
    return this.legendItems().reduce(
      (h, t, i) => h + Math.max(i < 2 ? 10 : 0, sh.paras([0, 0, 160], [t], 2.5, false) + 1.5),
      0,
    );
  }
  /** Под схемой: знаки № 9 и № 12 с пояснениями, масса и центр тяжести. */
  signsLegend(sh, x, y) {
    let yy = y;
    this.legendItems().forEach((t, i) => {
      if (i === 0) DrawSling.signSling(sh, x + 4, yy + 5, 8);
      else if (i === 1) DrawSling.signCog(sh, x + 4, yy + 5, 8);
      yy += Math.max(i < 2 ? 10 : 0, sh.paras([x + 11, yy, 160], [t], 2.5) + 1.5);
    });
  }
}
