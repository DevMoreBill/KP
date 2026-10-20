import { StationLayout } from '../layout/station-layout.js';
import { StationVent } from '../layout/station-vent.js';

/** Разрез А–А: вдоль контейнера у стены прохода — оборудование, трубопровод, выходы, шасси, глушитель. */
export class DrawSide {
  constructor(o) {
    this.o = o;
  }

  /** Разрез А–А: вдоль контейнера у стены прохода, взгляд на заднюю стену. */
  main(sh, yA) {
    const { xL, xR } = this.o;
    sh.text((xL + xR) / 2, yA + 5, 'А–А', 5, { a: 'middle' });
    if (this.o.hidden.length) {
      // снятое для наглядности — надписью над изображением (ГОСТ Р 2.109)
      const H = [...new Set(this.o.hidden.map(i => i.pos))];
      const many = H.length > 1;
      const t = `${many ? 'Шкафы' : 'Шкаф'} поз. ${H.join(', ')} не ${many ? 'показаны' : 'показан'}`;
      sh.text((xL + xR) / 2, yA + 9.4, t, 2.5, { a: 'middle' });
    }
    if (this.o.dz) this.chassisSide(sh);
    this.shell(sh);
    this.fuelWall(sh);
    this.backWall(sh);
    this.equipment(sh);
    for (const m of this.o.rf) this.muffler(sh, m);
    const ro = this.o.ext.length ? this.outMain(sh) : null;
    if (!ro) for (const o of this.o.outs) this.outlet(sh, o);
    for (const o of this.o.souts.filter(q => q.wall === 'back'))
      this.flangeFace(sh, this.o.X(this.o.ox + o.x), this.o.Z(this.o.zf + o.z));
    // линия сечения Б–Б — под потолком, взгляд вниз
    const zc = this.o.Z(this.o.zf + this.o.Hi - Math.min(120, this.o.Hi * 0.05));
    this.cutMark(sh, xL - 1.5, zc, -1, 'Б');
    this.cutMark(sh, this.o.xE + 1.5, zc, 1, 'Б');
    this.dims(sh, ro);
  }

  /** Стенки, пол и кровля в сечении; скатная крыша — конёк за секущей плоскостью; стыки модулей; строповочные петли. */
  shell(sh) {
    const { k, ox, zf, Le, He, Hi, Li, xL } = this.o;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    sh.section(xL, Z(He), ox * k, He * k);
    sh.section(X(Le - ox), Z(He), ox * k, He * k);
    sh.section(X(ox), Z(zf), Li * k, zf * k);
    sh.section(X(ox), Z(He), Li * k, (He - zf - Hi) * k);
    sh.rect(xL, Z(He), Le * k, He * k, 'main');
    if (this.o.rise) sh.rect(xL, Z(He + this.o.rise), Le * k, this.o.rise * k, 'main');
    const md = this.o.p.geo.mods;
    if (md && md.Lm) for (let i = 1; i < md.a; i++) sh.line(X(i * md.Lm), Z(He) - 2, X(i * md.Lm), Z(0) + 2, 'phantom');
    if (this.o.g.sea) return;
    const lw = Math.max(0.8, 160 * k);
    const lh = Math.max(0.6, 120 * k);
    for (const x of [xL + 30 * k, xL + (Le - 190) * k]) {
      sh.rect(x, Z(He) - lh, lw, lh, 'main', '#fff');
      sh.circle(x + lw / 2, Z(He) - lh * 0.45, Math.max(0.2, lh * 0.25), 'thin', '#fff');
    }
  }

  /** Тамбур; отсек бака. */
  fuelWall(sh) {
    const { k, ox, zf, Hi, xL } = this.o;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const fu = this.o.fuel;
    if (this.o.g.x0 - (fu ? fu.x1 + fu.part : 0) > 0)
      sh.line(X(ox + this.o.g.x0), Z(zf), X(ox + this.o.g.x0), Z(zf + Hi), 'main');
    if (!fu) return;
    sh.section(X(ox + fu.x1), Z(zf + Hi), fu.part * k, Hi * k);
    if (fu.fill.wall !== 'left') return;
    const t = this.o.p.items.find(i => i.tank);
    const zb = Z(zf + fu.fill.z);
    const b = Math.max(1.2, 220 * k);
    sh.rect(xL, zb - b / 2, Math.max(b, ox * k + b * 0.4), b, 'main', '#fff');
    if (!t) return;
    const f = EskdSheet.f;
    sh.path(`M${f(xL)},${f(zb)} H${f(X(ox + t.x + Math.min(150, t.lx / 3)))} V${f(Z(zf + t.h))}`, 'main');
  }

  /** Задняя стена. */
  backWall(sh) {
    const { k, ox, zf, He } = this.o;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const { ends } = this.o;
    for (const h of this.o.heaters.filter(q => q.wall === 'back'))
      sh.rect(X(ox + h.x), Z(zf + h.z + h.h), h.lx * k, h.h * k, 'thin', '#fff');
    for (const v of this.o.vents('back'))
      ends.louverEnd(sh, [X(ox + v.u0), X(ox + v.u1)], [Z(zf + v.z1), Z(zf + v.z0)], v.fan);
    for (const d of this.o.sdB) {
      const [xa, xb, za, zb] = [X(ox + d.x0), X(ox + d.x1), Z(zf + d.h), Z(zf)];
      sh.rect(xa, za, xb - xa, zb - za, 'main', '#fff');
      for (let i = 1; i < d.leaves; i++)
        sh.line(xa + ((xb - xa) * i) / d.leaves, za, xa + ((xb - xa) * i) / d.leaves, zb, 'thin');
    }
    for (const d of this.o.dgB) ends.dguDoorView(sh, X(ox + d.x0), X(ox + d.x1), Z(zf + d.h), Z(zf));
    for (const e of this.o.exW) ends.exhaustView(sh, X(ox + e.u), Z(zf + e.z));
    for (const v of this.o.vents('back', true))
      ends.louverEnd(sh, [X(ox + v.u0), X(ox + v.u1)], [Z(zf + v.z1), Z(zf + v.z0)], v.fan);
    for (const R of this.o.hoods()) {
      const hz = Math.max(1, StationVent.HOOD * k);
      sh.rect(X(ox + R.x0), Z(He) - hz, (R.x1 - R.x0) * k, hz, 'main', '#fff');
      sh.line(X(ox + R.x0) - 0.6, Z(He) - hz, X(ox + R.x1) + 0.6, Z(He) - hz, 'main');
    }
  }

  /** Оборудование: за трубопроводом — раньше, перед ним — после; на раме — стойки до пола. */
  equipment(sh) {
    const { ox, zf } = this.o;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const py = this.o.lines.length ? Math.max(...this.o.lines.map(l => l.y)) : -Infinity;
    const shown = this.o.p.items.filter(i => !this.o.hidden.includes(i)).sort((a, c) => c.y - a.y);
    const one = it => {
      const x1 = X(ox + it.x);
      const x2 = X(ox + it.x + it.lx);
      const fz = Z(zf + it.z);
      if (it.mount === 'frame')
        for (const xx of [x1 + (x2 - x1) * 0.12, x2 - (x2 - x1) * 0.12]) sh.line(xx, fz, xx, Z(zf), 'main');
      EquipIcon.front(sh, it, x1, Z(zf + it.z + it.h), x2, fz);
    };
    for (const it of shown.filter(i => i.y > py)) one(it);
    this.pipesMain(sh);
    for (const it of shown.filter(i => i.y <= py)) one(it);
  }

  /** Глушитель на крыше: опоры, корпус, вывод выхлопа горизонтально в сторону; выхлопная труба от ДГУ сквозь крышу. */
  muffler(sh, m) {
    const { k, ox, zf, He } = this.o;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const [x1, x2] = [X(ox + m.x), X(ox + m.x + m.lx)];
    const [zb, zt] = [Z(He + m.gap), Z(He + m.gap + m.d)];
    const zm = (zb + zt) / 2;
    if (m.exhaust) {
      const pw = Math.max(0.8, 130 * k);
      sh.rect(X(ox + m.exhaust.x) - pw / 2, zb, pw, Z(zf + m.exhaust.z) - zb, 'thin', '#fff');
    }
    if (m.dir === 'y+') {
      const xc = (x1 + x2) / 2;
      sh.line(xc, Z(He), xc, zb, 'main');
      sh.circle(xc, zm, (zb - zt) / 2, 'main', '#fff');
      sh.circle(xc, zm, Math.max(0.6, 60 * k), 'main', '#fff');
      return;
    }
    for (const f of [0.18, 0.82]) sh.line(x1 + (x2 - x1) * f, Z(He), x1 + (x2 - x1) * f, zb, 'main');
    const w = Math.max(0.8, 120 * k);
    const back = m.dir === 'x-';
    const xo = X(back ? ox + m.x - m.outlet : ox + m.x + m.lx + m.outlet);
    sh.rect(back ? xo : x2, zm - w / 2, back ? x1 - xo : xo - x2, w, 'thin', '#fff');
    sh.line(xo, zm - w * 0.9, xo, zm + w * 0.9, 'main');
    EquipIcon.muffler(sh, x1, zt, x2, zb);
  }

  /** Выход трубопровода через дальний торец (над проёмом — с подъёмом) с фланцем и стрелкой. */
  outlet(sh, o) {
    const { k, ox, zf, xR } = this.o;
    const z = this.o.Z(zf + o.z);
    const xf = xR + Math.max(1.2, this.o.flg * k);
    if (o.l && o.l.out && o.l.out.rise) {
      const xa = this.o.X(ox + o.l.x1);
      sh.line(xa, this.o.Z(zf + o.l.z), xa, z, 'pipe');
      sh.line(xa, z, xR, z, 'pipe');
    }
    sh.line(xR, z, xf + 5, z, 'pipe');
    this.flangeMark(sh, xf, z, 'v');
    sh.arrow(xf + 7.6, z, 1, 0);
  }

  /** Размеры справа. */
  dims(sh, ro) {
    const { ox, zf, He, xR, xE } = this.o;
    const n = StationLayout.n;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    let xd = xE + 16;
    const dim = (z, txt, x, x2 = xR) => {
      sh.dimV(z, Z(0), xd, txt, x, x2);
      xd += 7;
    };
    if (ro) dim(ro.y, n(ro.z + this.o.dz), ro.x, xE);
    else for (const o of this.o.outs) dim(Z(zf + o.z), n(zf + o.z), xR + 7.6);
    for (const o of this.o.souts.filter(q => q.wall === 'back')) dim(Z(zf + o.z), n(zf + o.z), X(ox + o.x));
    dim(Z(He), n(He), xR);
    if (this.o.rise) dim(Z(He + this.o.rise), n(He + this.o.rise), xR);
    const H = this.o.hoods();
    if (this.o.up) {
      const m = this.o.rf[0];
      dim(Z(He + this.o.up), n(He + this.o.up), X(ox + m.x + m.lx * 0.86));
    } else if (H.length) dim(Z(He + StationVent.HOOD), n(He + StationVent.HOOD), X(ox + H[H.length - 1].x1));
    if (this.o.dz) {
      const u = Math.max(this.o.up, this.o.hood);
      sh.dimV(Z(He + u), this.o.Yg, xd, n(He + u + this.o.dz), null, xR);
    }
  }

  /** Ресиверы снаружи на разрезе А–А. */
  outMain(sh) {
    const k = this.o.k;
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const { ox, zf, xR } = this.o;
    const P = StationLayout.PAD;
    const f = EskdSheet.f;
    for (const it of [...this.o.ext].sort((a, c) => c.y - a.y)) {
      sh.rect(X(ox + it.x - 200), Z(zf + it.z), (it.lx + 400) * k, P * k, 'main', '#fff');
      EquipIcon.front(sh, it, X(ox + it.x), Z(zf + it.z + it.h), X(ox + it.x + it.lx), Z(zf + it.z));
    }
    const o = this.o.outs[0];
    if (!o) return null;
    // ряды по удалению от стены; в ряду виден ближний к зрителю
    const cols = [];
    for (const it of [...this.o.ext].sort((a, c) => a.x - c.x || a.y - c.y)) {
      const c = cols.find(q => Math.abs(q.x - it.x) < 1);
      if (!c) cols.push(it);
    }
    const zin = r => zf + r.z + (r.shape === 'vcyl' && r.h >= 900 ? Math.max(250, r.h * 0.22) : r.h / 2);
    const zout = r => zf + r.z + r.h + Math.min(250, r.h * 0.08);
    let x0 = xR;
    let z0 = zf + o.z;
    let d = `M${f(xR)},${f(Z(z0))}`;
    cols.forEach((r, n) => {
      const xa = X(ox + r.x);
      const xm = (x0 + xa) / 2;
      d += ` H${f(xm)} V${f(Z(zin(r)))} H${f(xa)}`;
      if (!n) PneuSymbol.flow(sh, (xR + xm) / 2, Z(z0), 1);
      sh.path(d, 'pipe');
      const xc = X(ox + r.x + r.lx / 2);
      x0 = X(ox + r.x + r.lx);
      z0 = zout(r);
      d = `M${f(xc)},${f(Z(zf + r.z + r.h))} V${f(Z(z0))}`;
    });
    const xe = x0 + 4;
    sh.path(`${d} H${f(xe)}`, 'pipe');
    sh.arrow(xe + 2.6, Z(z0), 1, 0);
    return { x: xe + 2.6, y: Z(z0), z: z0 };
  }
  /** Трубопровод на разрезе А–А: магистрали (по ходу воздуха — стрелки), спуски к оборудованию. */
  pipesMain(sh) {
    const X = v => this.o.X(v);
    const Z = v => this.o.Z(v);
    const { ox, zf } = this.o;
    for (const l of this.o.lines) {
      const z = Z(zf + l.z);
      for (const br of l.branches)
        if (br.z1 < l.z || br.tee) sh.line(X(ox + br.x), z, X(ox + br.x), Z(zf + br.z1), br.tee ? 'pipe' : 'main');
      for (const [a, c] of StationLayout.runs(l)) {
        sh.line(X(ox + a), z, X(ox + c), z, 'pipe');
        if (l.medium === 'air' && !l.header && (c - a) * this.o.k > 9) PneuSymbol.flow(sh, X(ox + (a + c) / 2), z, 1);
      }
    }
  }
  /** Линия сечения (ГОСТ 2.305). */
  cutMark(sh, x, y, dir, ch) {
    const xe = x + dir * 5;
    const xa = xe - dir * 1.6;
    sh.line(x, y, xe, y, 'cut');
    sh.line(xa, y, xa, y + 4, 'thin');
    sh.arrow(xa, y + 4.4, 0, 1);
    sh.text(xe + dir * 0.8, y + 5.6, ch, 5, { a: dir > 0 ? 'start' : 'end' });
  }
  /** То же на плане: стрелки к задней стене (вверх). */
  cutMarkV(sh, x, y, dir, ch) {
    const xe = x + dir * 5;
    const xa = xe - dir * 1.6;
    sh.line(x, y, xe, y, 'cut');
    sh.line(xa, y, xa, y - 4, 'thin');
    sh.arrow(xa, y - 4.4, 0, -1);
    sh.text(xe + dir * 0.8, y - 1.2, ch, 5, { a: dir > 0 ? 'start' : 'end' });
  }
  chassisSide(sh) {
    const k = this.o.k;
    const xL = this.o.xL;
    const xR = this.o.xR;
    const Le = this.o.Le;
    const Z = v => this.o.Z(v);
    const r = 420 * k;
    sh.rect(xL + 40 * k, Z(0), Le * k - 80 * k, 200 * k, 'main', '#fff');
    for (const f of Le <= 7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86]) {
      const cx = xL + Le * k * f;
      sh.circle(cx, this.o.Yg - r, r, 'main', '#fff');
      sh.circle(cx, this.o.Yg - r, r * 0.45, 'thin');
    }
    sh.rect(xL + Le * k * 0.16, Z(0) + 200 * k, 60 * k, this.o.Yg - Z(0) - 200 * k, 'thin', '#fff');
    sh.line(xL - 4, this.o.Yg, xR + 4, this.o.Yg, 'thin');
  }

  /** Глушитель поперёк станции (ДГУ поперёк) на виде с торца. */
  mufflerAcross(sh, X, m) {
    const k = this.o.k;
    const Z = v => this.o.Z(v);
    const He = this.o.He;
    const oy = this.o.oy;
    const a = X(oy + m.y);
    const b = X(oy + m.y + m.ly);
    const zb = Z(He + m.gap);
    const zt = Z(He + m.gap + m.d);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (const f of [0.18, 0.82]) sh.line(lo + (hi - lo) * f, Z(He), lo + (hi - lo) * f, zb, 'main');
    const xo = X(oy + m.y + m.ly + m.outlet);
    const w = Math.max(0.8, 120 * k);
    const zm = (zb + zt) / 2;
    const e = X(oy + m.y + m.ly);
    sh.rect(Math.min(e, xo), zm - w / 2, Math.abs(xo - e), w, 'thin', '#fff');
    sh.line(xo, zm - w * 0.9, xo, zm + w * 0.9, 'main');
    EquipIcon.muffler(sh, lo, zt, hi, zb);
  }
  /** Станция из модулей на плане. */
  /** Точка выноски номера позиции на плане (аккуратность, п. 8). */

  /** Фланец на виде сбоку (патрубок вдоль листа). */
  flangeMark(sh, x, y, dir) {
    const h = 2.2;
    const t = 0.6;
    if (dir === 'v') {
      sh.line(x, y - h, x, y + h, 'main');
      sh.line(x + t, y - h, x + t, y + h, 'main');
    } else {
      sh.line(x - h, y, x + h, y, 'main');
      sh.line(x - h, y + t, x + h, y + t, 'main');
    }
  }
  /** Выход с фланцем на виде к стене: труба, фланец, отверстия под болты, осевые линии. */
  flangeFace(sh, x, y) {
    const r = Math.max(0.9, 60 * this.o.k);
    const R = Math.max(r + 1, r * 2.2);
    sh.circle(x, y, R, 'main', '#fff');
    sh.circle(x, y, r, 'main', '#fff');
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      sh.circle(
        x + (Math.cos(a) * (r + R)) / 2,
        y + (Math.sin(a) * (r + R)) / 2,
        Math.max(0.25, (R - r) * 0.18),
        'thin',
      );
    }
    EquipIcon.axes(sh, x, y, R * 1.25);
  }
}
