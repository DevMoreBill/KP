import { StationLayout } from '../layout/station-layout.js';
import { StationVent } from '../layout/station-vent.js';

/** Виды с торцов: ворота, двери, жалюзи, колпаки, двери-жалюзи и выхлоп ДГУ, размеры. */
export class DrawEnds {
  constructor(o) {
    this.o = o;
  }

  /** Вид слева: торец у двери снаружи. */
  end(sh, x0) {
    const { k, We, oy, zf } = this.o;
    const Z = v => this.o.Z(v);
    const XL = y => x0 + (We - y) * k;
    this.endBody(sh, XL, false);
    const fu = this.o.fuel;
    if (fu && fu.fill.wall === 'left') {
      const b = Math.max(1.2, 220 * k);
      const [yc, zc] = [XL(oy + fu.fill.y), Z(zf + fu.fill.z)];
      sh.rect(yc - b / 2, zc - b / 2, b, b, 'main', '#fff');
      sh.line(yc - b / 2, zc - b / 2 + 0.5, yc + b / 2, zc - b / 2 + 0.5, 'thin');
    }
    const [cw, chh] = this.endCorners(sh, XL);
    if (this.o.g.sea) this.seaDoors(sh, XL, chh);
    else this.leftOpenings(sh, XL, [cw, chh]);
    const vent = v => this.louverEnd(sh, [XL(oy + v.u1), XL(oy + v.u0)], [Z(zf + v.z1), Z(zf + v.z0)], v.fan);
    for (const v of this.o.vents('left', true)) vent(v);
    this.roofHoods(sh, XL);
    for (const v of this.o.vents('left')) vent(v);
    for (const v of [...this.o.vents('left'), ...this.o.vents('left', true)].filter(q => q.hood))
      this.hoodEnd(sh, XL, v);
    this.endMufflers(sh, XL, false);
  }

  /** Шасси, корпус и крыша с торца (P — ширина → лист; rev — порядок вершин крыши для вида справа). */
  endBody(sh, P, rev) {
    const { k, We, He, rise: rz } = this.o;
    const Z = v => this.o.Z(v);
    const x0 = P(rev ? 0 : We);
    if (this.o.dz) {
      const [r, w] = [420 * k, 300 * k];
      sh.rect(x0 + 40 * k, Z(0), We * k - 80 * k, 200 * k, 'main', '#fff');
      for (const x of [x0 + 60 * k, x0 + We * k - 60 * k - w]) sh.rect(x, this.o.Yg - 2 * r, w, 2 * r, 'main', '#fff');
      sh.line(x0 - 3, this.o.Yg, x0 + We * k + 3, this.o.Yg, 'thin');
    }
    sh.rect(x0, Z(He), We * k, He * k, 'main', '#fff');
    if (!rz) return;
    const roof = this.o.g.roof;
    if (roof === 'arch') {
      const rc = ((We * We) / 4 + rz * rz) / (2 * rz);
      const A = [];
      for (let j = 0; j <= 16; j++) {
        const y = (We * j) / 16;
        A.push([P(y), Z(He + rz - rc + Math.sqrt(Math.max(0, rc * rc - (y - We / 2) * (y - We / 2))))]);
      }
      sh.poly(A, 'main', '#fff');
      return;
    }
    // двускатная — конёк посередине; односкатная — выше у стены с дверью
    const T =
      roof === 'gable'
        ? [
            [P(We), Z(He)],
            [P(We / 2), Z(He + rz)],
            [P(0), Z(He)],
          ]
        : [
            [P(We), Z(He)],
            [P(0), Z(He + rz)],
            [P(0), Z(He)],
          ];
    sh.poly(rev ? T.reverse() : T, 'main', '#fff');
  }

  /** Угловые фитинги (стойки) и стыки модулей; возвращает размер фитинга [cw, chh]. */
  endCorners(sh, P) {
    const { k, We, He } = this.o;
    const Z = v => this.o.Z(v);
    const cw = Math.max(0.6, 160 * k);
    const chh = Math.max(0.6, 120 * k);
    const [a, b] = [Math.min(P(0), P(We)), Math.max(P(0), P(We))];
    for (const [x, y] of [
      [a, Z(He)],
      [b - cw, Z(He)],
      [a, Z(0) - chh],
      [b - cw, Z(0) - chh],
    ])
      sh.rect(x, y, cw, chh, 'thin');
    const md = this.o.p.geo.mods;
    if (md && md.Lm) for (let j = 1; j < md.b; j++) sh.line(P(j * md.Wm), Z(He) - 2, P(j * md.Wm), Z(0) + 2, 'phantom');
    return [cw, chh];
  }

  /** Штатные двери морского контейнера: две створки, запорные штанги. */
  seaDoors(sh, XL, chh) {
    const { k, We, He } = this.o;
    const Z = v => this.o.Z(v);
    const xm = (XL(We) + XL(0)) / 2;
    const [y1, y2] = [Z(He) + chh, Z(0) - chh];
    sh.line(xm, y1, xm, y2, 'main');
    for (const f of [0.18, 0.36, 0.64, 0.82]) {
      const x = XL(We) + We * k * f;
      sh.line(x, y1 + 0.6, x, y2 - 0.6, 'thin');
    }
  }

  /** Торец у входа блок-контейнера: стойки, ворота (и отсека бака), дверь оператора, дверь-жалюзи ДГУ. */
  leftOpenings(sh, XL, [cw, chh]) {
    const { We, He, oy, zf } = this.o;
    const Z = v => this.o.Z(v);
    sh.line(XL(We) + cw * 0.5, Z(He) + chh, XL(We) + cw * 0.5, Z(0) - chh, 'thin');
    sh.line(XL(0) - cw * 0.5, Z(He) + chh, XL(0) - cw * 0.5, Z(0) - chh, 'thin');
    for (const q of this.o.gts) if (q.wall === 'left') this.gateEnd(sh, XL, q);
    if (this.o.fuel && this.o.fuel.gate) this.gateEnd(sh, XL, this.o.fuel.gate);
    if (this.o.en && this.o.en.wall === 'left') this.doorEnd(sh, XL, this.o.en);
    const d = this.o.dgL;
    if (d) this.dguDoorView(sh, XL(oy + d.y1), XL(oy + d.y0), Z(zf + d.h), Z(zf));
  }

  /** Колпаки выброса на крыше — с торца. */
  roofHoods(sh, P) {
    const { k, He, oy } = this.o;
    const hz = Math.max(1, StationVent.HOOD * k);
    for (const R of this.o.hoods())
      sh.rect(Math.min(P(oy + R.y0), P(oy + R.y1)), this.o.Z(He) - hz, (R.y1 - R.y0) * k, hz, 'main', '#fff');
  }

  /** Глушители с торца: вдоль — круг корпуса на опоре (справа — с выходом), поперёк — сбоку. */
  endMufflers(sh, P, out) {
    const { k, He, oy } = this.o;
    const Z = v => this.o.Z(v);
    for (const m of this.o.rf) {
      if (m.dir === 'y+') {
        this.o.side.mufflerAcross(sh, P, m);
        continue;
      }
      const xc = P(oy + m.y + m.d / 2);
      const zc = Z(He + m.gap + m.d / 2);
      sh.line(xc, Z(He), xc, Z(He + m.gap), 'main');
      sh.circle(xc, zc, (m.d / 2) * k, 'main', '#fff');
      if (out) sh.circle(xc, zc, Math.max(0.6, 60 * k), 'main', '#fff');
    }
  }

  /** Дверь-жалюзи ДГУ на виде. */
  dguDoorView(sh, xa, xb, za, zb) {
    const k = this.o.k;
    const a = Math.min(xa, xb);
    const b = Math.max(xa, xb);
    const xm = (a + b) / 2;
    this.louverEnd(sh, [a, xm], [za, zb]);
    this.louverEnd(sh, [xm, b], [za, zb]);
    sh.rect(a, za, b - a, zb - za, 'main');
    for (const f of [0.15, 0.5, 0.85]) {
      const z = za + (zb - za) * f;
      const hl = Math.max(0.8, 120 * k);
      sh.rect(a - 0.5, z, 0.8, hl, 'thin', '#000');
      sh.rect(b - 0.3, z, 0.8, hl, 'thin', '#000');
    }
    for (const dx of [-0.7, 0.7]) sh.line(xm + dx, za + 0.6, xm + dx, zb - 0.6, 'thin');
  }
  /** Выхлоп ДГУ через стену на виде снаружи: гильза и отвод (окружности). */
  exhaustView(sh, x, z) {
    const r = Math.max(0.8, 55 * this.o.k);
    sh.circle(x, z, r * 1.9, 'thin', '#fff');
    sh.circle(x, z, r, 'main', '#fff');
  }
  /** Распашные ворота на виде с торца: проём y0…y1 (мм внутри), две створки, запорные штанги; X — y → x на листе. */
  gateEnd(sh, X, d) {
    const Z = v => this.o.Z(v);
    const xa = X(this.o.oy + d.y0);
    const xb = X(this.o.oy + d.y1);
    const za = Z(this.o.zf + d.h);
    const zb = Z(this.o.zf);
    const xm = (xa + xb) / 2;
    const a = Math.min(xa, xb);
    const w = Math.abs(xb - xa);
    sh.rect(a, za, w, zb - za, 'main', '#fff');
    sh.line(xm, za, xm, zb, 'main');
    for (const dx of [-0.7, 0.7]) sh.line(xm + dx, za + 0.6, xm + dx, zb - 0.6, 'thin');
    if (d.wicket) {
      const ya = d.y0 + 80;
      const wa = X(this.o.oy + ya);
      const wb = X(this.o.oy + ya + d.wicket.w);
      const zt = Z(this.o.zf + 60 + d.wicket.h);
      const z0 = Z(this.o.zf + 60);
      // калитка в створке
      sh.rect(Math.min(wa, wb), zt, Math.abs(wb - wa), z0 - zt, 'main');
    }
  }
  /** Одностворчатая дверь оператора на виде с торца: полотно, ручка. */
  doorEnd(sh, X, d) {
    const Z = v => this.o.Z(v);
    const xa = X(this.o.oy + d.y0);
    const xb = X(this.o.oy + d.y1);
    const za = Z(this.o.zf + d.h);
    const zb = Z(this.o.zf);
    const a = Math.min(xa, xb);
    const w = Math.abs(xb - xa);
    sh.rect(a, za, w, zb - za, 'main', '#fff');
    const hx = a + w * 0.85;
    const zh = Z(this.o.zf + 1000);
    sh.line(hx, zh - 0.8, hx, zh + 0.8, 'main');
  }
  /** Маркиза на виде с торца. */
  hoodEnd(sh, X, v) {
    const Z = v => this.o.Z(v);
    const H = v.hood;
    const s = StationVent.HOOD_SIDE;
    const zh = this.o.zf + v.z1 + StationVent.HOOD_LAP;
    const xa = X(this.o.oy + v.u0 - s);
    const xb = X(this.o.oy + v.u1 + s);
    const a = Math.min(xa, xb);
    const w = Math.abs(xb - xa);
    const zt = Z(zh);
    const zl = Z(zh - H.drop);
    const la = Math.min(X(this.o.oy + v.u0), X(this.o.oy + v.u1));
    const lw = Math.abs(X(this.o.oy + v.u1) - X(this.o.oy + v.u0));
    sh.rect(a, zt, w, zl - zt, 'main', '#fff');
    const z0 = Z(this.o.zf + v.z1);
    const z1 = Math.min(zl, Z(this.o.zf + v.z0));
    if (z1 > z0) sh.rect(la, z0, lw, z1 - z0, 'dash'); // жалюзи за козырьком
    sh.line(a, zl - Math.max(0.4, 35 * this.o.k), a + w, zl - Math.max(0.4, 35 * this.o.k), 'thin'); // отбортовка кромки
  }
  /** Жалюзи на виде с торца: рамка и ламели. */
  /** Вентилятор в проёме жалюзи (вид снаружи): окружности осевых вентиляторов (число — по форме проёма). */
  fanEnd(sh, xa, xb, za, zb) {
    const w = Math.abs(xb - xa);
    const h = Math.abs(zb - za);
    const n = Math.max(1, Math.round(w / h));
    const x0 = Math.min(xa, xb);
    const r = Math.min(w / n, h) * 0.42;
    for (let i = 0; i < n; i++) {
      const cx = x0 + (w / n) * (i + 0.5);
      const cz = (za + zb) / 2;
      sh.circle(cx, cz, r, 'thin');
      sh.circle(cx, cz, Math.max(0.3, r * 0.25), 'thin', '#fff');
    }
  }
  louverEnd(sh, [xa, xb], [za, zb], fan) {
    const k = this.o.k;
    sh.rect(Math.min(xa, xb), za, Math.abs(xb - xa), zb - za, 'main', '#fff');
    for (let z = za + Math.max(0.8, 70 * k); z < zb - 0.4; z += Math.max(0.8, 70 * k))
      sh.line(Math.min(xa, xb) + 0.4, z, Math.max(xa, xb) - 0.4, z, 'fine');
    if (fan) this.fanEnd(sh, xa, xb, za, zb);
  }
  /** Вид справа: дальний торец снаружи. */
  endR(sh, x0) {
    const { k, oy, zf } = this.o;
    const Z = v => this.o.Z(v);
    const XR = y => x0 + y * k;
    this.endBody(sh, XR, true);
    this.endCorners(sh, XR);
    const d = this.o.dg;
    if (d) this.dguDoorView(sh, XR(oy + d.y0), XR(oy + d.y1), Z(zf + d.h), Z(zf));
    const vent = v => this.louverEnd(sh, [XR(oy + v.u0), XR(oy + v.u1)], [Z(zf + v.z1), Z(zf + v.z0)], v.fan);
    for (const v of this.o.vents('right')) vent(v);
    for (const q of this.o.gts) if (q.wall === 'right' && !q.sea) this.gateEnd(sh, XR, q);
    if (this.o.p.exit) this.doorEnd(sh, XR, this.o.p.exit);
    for (const v of this.o.vents('right', true)) vent(v);
    for (const v of [...this.o.vents('right'), ...this.o.vents('right', true)].filter(q => q.hood))
      this.hoodEnd(sh, XR, v);
    this.roofHoods(sh, XR);
    for (const o of this.o.outs) this.o.side.flangeFace(sh, XR(oy + o.y), Z(zf + o.z));
    this.endMufflers(sh, XR, true);
    for (const it of [...this.o.ext].sort((a, c) => c.x - a.x))
      EquipIcon.front(sh, it, XR(oy + it.y), Z(zf + it.z + it.h), XR(oy + it.y + it.ly), Z(zf + it.z));
  }
  /** Размеры видов с торцов: ширина — снизу, высота (и с крышей) — слева; у двери-жалюзи ДГУ — её размеры. */
  endDims(sh, x0, left) {
    const k = this.o.k;
    const We = this.o.We;
    const He = this.o.He;
    const Z = v => this.o.Z(v);
    const n = StationLayout.n;
    const X = y => (left ? x0 + (We - y) * k : x0 + y * k);
    const xa = Math.min(X(0), X(We));
    const xb = Math.max(X(0), X(We));
    sh.dimH(xa, xb, this.o.Yg + 8, n(We), this.o.Yg, this.o.Yg);
    let xd = xa - 8;
    sh.dimV(Z(He), Z(0), xd, n(He), xa, xa);
    if (this.o.rise) {
      xd -= 7;
      sh.dimV(Z(He + this.o.rise), Z(0), xd, n(He + this.o.rise), (xa + xb) / 2, xa);
    }
    const d = left ? this.o.dgL : this.o.dg; // у двери-жалюзи ДГУ — её размеры
    if (d) {
      const x1 = X(this.o.oy + d.y0);
      const x2 = X(this.o.oy + d.y1);
      sh.dimH(x1, x2, this.o.Yg + 15, n(d.w), Z(this.o.zf), Z(this.o.zf));
      sh.dimV(Z(this.o.zf + d.h), Z(this.o.zf), xb + 6, n(d.h), x2, x2);
    }
    this.gateDims(sh, X, xb, left);
  }
  /** Ворота в торце: ось торца (штрихпунктирная), ширина и высота проёма; смещённые — ось ворот и размер смещения. */
  gateDims(sh, X, xb, left) {
    const Z = v => this.o.Z(v);
    const n = StationLayout.n;
    const two = !left && this.o.dg;
    const ax = X(this.o.We / 2);
    for (const q of this.o.gts.filter(q => !q.sea && q.wall === (left ? 'left' : 'right'))) {
      const x1 = X(this.o.oy + q.y0);
      const x2 = X(this.o.oy + q.y1);
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      const gx = (lo + hi) / 2;
      const yd = this.o.Yg + (two ? 22 : 15);
      sh.line(ax, Z(this.o.He) - 3, ax, this.o.Yg + 3, 'axis');
      if (!q.full) sh.dimH(lo, hi, yd, n(q.w), Z(this.o.zf), Z(this.o.zf));
      if (q.off) {
        sh.line(gx, Z(this.o.zf + q.h) - 7, gx, this.o.Yg + 3, 'axis');
        sh.dimH(Math.min(ax, gx), Math.max(ax, gx), Z(this.o.zf + q.h) - 4, n(Math.abs(q.off)), null, null, {
          out: gx > ax ? 'r' : 'l',
        });
      } // над проёмом
      sh.dimV(Z(this.o.zf + q.h), Z(this.o.zf), xb + (two ? 12 : 6), n(q.h), hi, hi);
    }
  }
  /** Стрелка направления взгляда с буквой (ГОСТ 2.305): острие у контура, dir — куда смотрит (±1 по x). */
  viewArrow(sh, x, y, dir, ch) {
    const L = 7;
    sh.line(x - dir * L, y, x - dir * EskdSheet.AR[0], y, 'thin');
    sh.arrow(x, y, dir, 0);
    sh.text(x - (dir * L) / 2, y - 1.6, ch, 5, { a: 'middle' });
  }
}
