import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { RalColor } from '../layout/ral-color.js';
import { StationVent } from '../layout/station-vent.js';

/** Вентиляция: жалюзи с козырьками и маркизами, вентиляторы, колпаки на крыше, двери-жалюзи ДГУ, выхлоп через стену. */
export class OutfitAir {
  constructor(o) {
    this.o = o;
  }

  /** Жалюзи по расчёту вентиляции (plan.vent), колпаки на крыше, воздуховоды радиаторов ДГУ; подписей на 3D-виде нет. */
  vents() {
    const P = this.o.p;
    const V = P.vent;
    const dgu = P.items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');
    if (!V) return;
    for (const L of V.louvers) this.louver(L);
    for (const R of V.roof || []) this.roofHood(R);
    for (const g of dgu) this.o.inner.duct(g);
  }

  louver(L) {
    const P = this.o.p;
    if (L.kind === 'rad' && L.door) {
      const d = (P.dguDoors || []).find(q => q.pos === L.pos && q.unit === L.unit) || P.dguDoor;
      if (d) this.endDoor(d);
    } else if (L.leaf) {
      this.leafVent(L);
    } else {
      this.vent(L);
      if (L.fan) this.fan(L);
    }
  }

  /** Жалюзи снаружи стены w (u a…b, высота Z0…Z1, м); off — поверх полотна створки. */
  outLouver(w, [a, b], [Z0, Z1], off = 0) {
    const S = this.o.s;
    if (w === 'right') S.louver(1, S.Le + off, [S.oy + a, S.oy + b], [Z0, Z1], 1);
    else if (w === 'left') S.louver(1, -off, [S.oy + a, S.oy + b], [Z0, Z1], -1);
    else if (w === 'back') S.louver(0, S.We + off, [S.ox + a, S.ox + b], [Z0, Z1], 1);
    else if (!S.cut) S.louver(0, -off, [S.ox + a, S.ox + b], [Z0, Z1], -1);
  }

  /** Вентилятор в проёме (вытяжной — система «Вытяжные вентиляторы», приточный — если жалюзи притока не встали): изнутри —
   *  монтажная плита с осевыми вентиляторами (обечайка, ступица с двигателем) и датчик температуры рядом; снаружи — те же
   *  жалюзи (гравитационные) с козырьком. Число вентиляторов в проёме — по его форме (ширина / высота) */
  fan(L) {
    if (!this.o.shown(L.wall)) return;
    const S = this.o.s;
    const w = L.wall;
    const n = Math.max(1, Math.round((L.u1 - L.u0) / (L.z1 - L.z0)));
    const du = (L.u1 - L.u0) / n;
    const zc = (L.z0 + L.z1) / 2;
    const r = Math.min(du, L.z1 - L.z0) * 0.42;
    const pl = S.M(StMat.paint('#b9bfc5', 0.45));
    const ring = S.M(StMat.metal(StScene.GALV, 0.35));
    const dk = S.M(StMat.paint('#2a2f34', 0.55));
    this.o.box(pl, w, [(L.u0 + L.u1) / 2, zc], [L.u1 - L.u0 + 40, L.z1 - L.z0 + 40, 30]); // монтажная плита
    for (let i = 0; i < n; i++) {
      const u = L.u0 + du * (i + 0.5);
      ring.tube(this.o.at(w, u, zc, 30), this.o.at(w, u, zc, 190), r / 1000, 28, { caps: [false, false] }); // обечайка
      dk.tube(this.o.at(w, u, zc, 60), this.o.at(w, u, zc, 230), (r * 0.28) / 1000, 18); // ступица с двигателем
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        const e = [Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8];
        // кронштейны двигателя
        dk.tube(this.o.at(w, u, zc, 200), this.o.at(w, u + e[0], zc + e[1], 200), 0.008, 6);
      }
    }
    this.o.box(dk, w, [L.u1 + 120, zc - (L.z1 - L.z0) / 2 + 60], [70, 90, 35], 0.006); // датчик температуры (термостат)
  }

  /** Приток в створке ворот или сервисной двери: жалюзи на полотне (маркиза открывается вместе с ним). */
  leafVent(L) {
    const S = this.o.s;
    const [a, b] = [L.u0 / 1000, L.u1 / 1000];
    const Z1 = S.base + L.z1 / 1000;
    const off = L.wall === 'left' || L.wall === 'right' ? 0.03 : 0.052;
    this.o.outer(L.wall, L.u0 - 60, L.u1 + 60, L.z0 - 60, L.z1 + 60);
    this.outLouver(L.wall, [a, b], [S.base + L.z0 / 1000, Z1], off);
    if (L.hood) this.o.snow(L.wall, [a, b], Z1, L.hood, off);
  }

  /** Выброс через крышу: колпак над проёмом (оцинковка) — жалюзи по сторонам, крышка с выносом; внутри под проёмом —
   *  клапан (у компрессора — его воздуховод доходит до потолка) */
  roofHood(R) {
    const S = this.o.s;
    const g = S.M(StMat.metal(StScene.GALV, 0.38));
    const sl = S.M(StMat.paint('#5d646b', 0.55));
    const c = S.P(R.x0, R.y0, 0);
    const d = S.P(R.x1, R.y1, 0);
    const zr = Math.max(S.roofZ(c[1]), S.roofZ(d[1])) + (S.rise > 0 ? 0.04 : 0);
    const h = 0.36;
    const x0 = c[0];
    const y0 = c[1];
    const x1 = d[0];
    const y1 = d[1];
    g.box([x0 - 0.03, y0 - 0.03, Math.min(S.roofZ(c[1]), S.roofZ(d[1]))], [x1 + 0.03, y1 + 0.03, zr + 0.06], 0.004); // стакан
    for (const [a, b] of [
      [0.02, 0.04],
      [h - 0.04, h - 0.02],
    ])
      g.box([x0, y0, zr + a], [x1, y1, zr + b]);
    for (const k of [0, 1, 2, 3])
      g.box(
        [k % 2 ? x1 - 0.03 : x0, k < 2 ? y0 : y1 - 0.03, zr + 0.04],
        [k % 2 ? x1 : x0 + 0.03, k < 2 ? y0 + 0.03 : y1, zr + h - 0.04],
      ); // стойки по углам
    for (let z = zr + 0.08; z < zr + h - 0.05; z += 0.055) {
      sl.box([x0 + 0.03, y0 - 0.005, z], [x1 - 0.03, y0 + 0.005, z + 0.02]);
      sl.box([x0 + 0.03, y1 - 0.005, z], [x1 - 0.03, y1 + 0.005, z + 0.02]);
      sl.box([x0 - 0.005, y0 + 0.03, z], [x0 + 0.005, y1 - 0.03, z + 0.02]);
      sl.box([x1 - 0.005, y0 + 0.03, z], [x1 + 0.005, y1 - 0.03, z + 0.02]);
    }
    g.box([x0 - 0.09, y0 - 0.09, zr + h], [x1 + 0.09, y1 + 0.09, zr + h + 0.03], 0.006); // крышка с выносом
  }

  /** Проём в стене: снаружи — жалюзи с козырьком (с маркизой — маркиза вместо него), изнутри — решётка и клапан с приводом. */
  vent(L) {
    const { wall: w, u0, u1, z0, z1, hood: mk } = L;
    const S = this.o.s;
    const [a, b] = [u0 / 1000, u1 / 1000];
    const Z1 = S.base + z1 / 1000;
    if (mk) this.o.snow(w, [a, b], Z1, mk);
    this.o.walls.busy(w, u0 - 90, u1 + 260, z0 - 90, z1 + 90);
    const low = mk ? Math.min(z0, z1 + StationVent.HOOD_LAP - mk.drop) : z0;
    this.o.outer(w, u0 - StationVent.HOOD_SIDE - 20, u1 + StationVent.HOOD_SIDE + 20, low - 80, z1 + (mk ? 140 : 220));
    this.outLouver(w, [a, b], [S.base + z0 / 1000, Z1]);
    if (!mk) this.o.hood(w, a - 0.06, b + 0.06, Z1 + 0.06);
    if (this.o.shown(w)) this.grille(L);
  }

  /** Изнутри: рамка, ламели, клапан с электроприводом. */
  grille({ wall: w, u0, u1, z0, z1 }) {
    const S = this.o.s;
    const fr = S.M(StMat.paint('#9aa1a8', 0.5));
    const sl = S.M(StMat.paint('#6b737b', 0.55));
    const dk = S.M(StMat.paint('#202428', 0.6));
    const [uc, zc, du, dz] = [(u0 + u1) / 2, (z0 + z1) / 2, u1 - u0, z1 - z0];
    for (const [u, z, a1, b1] of [
      [uc, z0, du + 60, 30],
      [uc, z1, du + 60, 30],
      [u0, zc, 30, dz + 60],
      [u1, zc, 30, dz + 60],
    ]) {
      this.o.box(fr, w, [u, z], [a1, b1, 25]);
    }
    for (let z = z0 + 40; z < z1 - 20; z += 55) this.o.box(sl, w, [uc, z], [du - 10, 12, 18], 0);
    this.o.box(dk, w, [u1 + 130, zc], [110, 150, 90], 0.008);
    this.o.box(fr, w, [u1 + 50, zc], [50, 20, 40], 0);
  }

  /**
   * ДГУ: напротив радиатора — двустворчатая дверь-жалюзи в торце (d.y0…d.y1) или в задней стене (ДГУ поперёк, d.x0…d.x1):
   * коробка, створки с ламелями, петли, запорные штанги, ручка, козырёк; изнутри — клапан с электроприводом.
   */
  endDoor(d) {
    const S = this.o.s;
    const w = d.wall || 'right';
    const end = w !== 'back';
    const [u0m, u1m] = end ? [d.y0, d.y1] : [d.x0, d.x1];
    const g = this.doorFrame(w, end);
    this.o.walls.busy(w, u0m - 60, u1m + 260, 0, d.h + 120);
    this.o.outer(w, u0m - 100, u1m + 100, 0, d.h + 220);
    const M = {
      fr: S.M(StMat.paint(RalColor.shade(S.frame, 0.9), 0.45)),
      lf: S.M(StMat.paint(S.wall, 0.45)),
      sl: S.M(StMat.paint('#5d646b', 0.55)),
      dk: S.M(StMat.paint('#24292e', 0.55)),
      mt: S.M(StMat.metal('#c3c8cd', 0.3)),
    };
    const [a, b] = [u0m / 1000, u1m / 1000];
    const Z = [S.base + 0.01, S.base + d.h / 1000];
    this.leaves(g, M, [a, b], Z);
    this.o.hood(w, a - 0.08, b + 0.08, Z[1] + 0.08);
    this.o.log.push({ kind: 'dgudoor', wall: w, u: (u0m + u1m) / 2, w: d.w, h: d.h });
    if (!this.o.shown(w)) return;
    this.o.box(M.dk, w, [u1m + 150, d.h / 2], [110, 150, 90], 0.008);
    this.o.box(M.fr, w, [u1m + 70, d.h / 2], [50, 20, 40], 0);
  }

  /** Точки двери в плоскости стены: P(u — вдоль, q — наружу, z), V — вектор, bx — короб. */
  doorFrame(w, end) {
    const S = this.o.s;
    const o = end ? S.oy : S.ox;
    const sg = w === 'left' ? -1 : 1;
    const pl = { left: 0, right: S.Le }[w] ?? S.We;
    const P = (u, q, z) => (end ? [pl + sg * q, o + u, z] : [o + u, pl + sg * q, z]);
    const V = (du, dq, dz) => (end ? [sg * dq, du, dz] : [du, sg * dq, dz]);
    const bx = (mt, [ua, ub], [qa, qb], [za, zb], r = 0) => {
      const [p, q] = [P(ua, qa, za), P(ub, qb, zb)];
      mt.box([p[0], p[1], p[2]], [q[0], q[1], q[2]], r);
    };
    return { P, V, bx };
  }

  /** Коробка, две створки с ламелями и петлями, запорные штанги, ручка с замком. */
  leaves({ P, V, bx }, M, [a, b], [Z0, Z1]) {
    const m = (a + b) / 2;
    bx(M.fr, [a - 0.05, a], [0, 0.03], [Z0 - 0.01, Z1 + 0.05]);
    bx(M.fr, [b, b + 0.05], [0, 0.03], [Z0 - 0.01, Z1 + 0.05]);
    bx(M.fr, [a - 0.05, b + 0.05], [0, 0.03], [Z1, Z1 + 0.05]);
    for (const [u0, u1, hinge] of [
      [a, m - 0.003, a],
      [m + 0.003, b, b],
    ]) {
      bx(M.lf, [u0, u1], [0, 0.022], [Z0, Z1 - 0.004], 0.004);
      for (let z = Z0 + 0.24; z < Z1 - 0.1; z += 0.07)
        M.sl.obox(P(u0 + 0.06, 0.022, z), V(u1 - u0 - 0.12, 0, 0), V(0, 0.03, -0.022), V(0, 0, 0.012));
      const uh = hinge + (hinge === a ? 0.015 : -0.015);
      for (const k of [0.15, 0.5, 0.85])
        M.dk.tube(P(uh, 0.03, Z0 + (Z1 - Z0) * k), P(uh, 0.03, Z0 + (Z1 - Z0) * k + 0.12), 0.016, 10);
    }
    for (const u of [m - 0.07, m + 0.06]) M.mt.tube(P(u, 0.06, Z0 + 0.08), P(u, 0.06, Z1 - 0.08), 0.012, 10);
    bx(M.dk, [m + 0.02, m + 0.1], [0.05, 0.075], [Z0 + 0.95, Z0 + 1.17], 0.005);
  }

  /** Выхлоп ДГУ через стену (plan.exhausts, how 'wall' — глушитель встроен в ДГУ): от турбины вверх и к стене в теплоизоляции,
   *  проходка-гильза, снаружи — отвод вниз под 45° с дождевым колпаком */
  exhausts() {
    const S = this.o.s;
    const P = this.o.p;
    const [, W] = P.int;
    const E = (P.exhausts || []).filter(e => e.how === 'wall');
    if (!E.length) return;
    const wrap = S.M(StMat.metal('#c4c9cd', 0.55));
    const st = S.M(StMat.metal('#a7adb3', 0.4));
    const dk = S.M(StMat.paint(StScene.DARK, 0.55));
    const r = 55;
    for (const e of E) {
      const g = P.items.find(i => i.kind === 'dgu' && i.pos === e.pos && i.unit === e.unit);
      if (!g) continue;
      this.o.walls.busy('back', e.u - 200, e.u + 200, e.z - 200, e.z + 200);
      this.o.outer('back', e.u - 250, e.u + 250, e.z - 500, e.z + 250);
      if (this.o.inside) {
        const a = S.P(e.u, g.y + g.ly * 0.5, g.h);
        const b = S.P(e.u, g.y + g.ly * 0.5, e.z);
        const c = S.P(e.u, W, e.z);
        wrap.tube(a, b, (r / 1000) * 1.15, 18);
        wrap.sphere(b, (r / 1000) * 1.15, 14);
        wrap.tube(b, c, (r / 1000) * 1.15, 18);
      }
      const o = S.P(e.u, W, e.z);
      const y = S.We;
      o[1] = y;
      const p1 = [o[0], y + 0.25, o[2]];
      const p2 = [o[0], y + 0.42, o[2] - 0.17];
      dk.tube([o[0], y - 0.03, o[2]], [o[0], y + 0.02, o[2]], (r / 1000) * 1.9, 20); // гильза-проходка
      st.tube([o[0], y, o[2]], p1, r / 1000, 18);
      st.sphere(p1, r / 1000, 14);
      st.tube(p1, p2, r / 1000, 18); // отвод вниз под 45°
      dk.tube(p2, [p2[0], p2[1] + 0.04, p2[2] - 0.04], (r / 1000) * 1.5, 18); // колпак
      this.o.log.push({ kind: 'exhaust', wall: 'back', u: e.u, z: e.z });
    }
  }
}
