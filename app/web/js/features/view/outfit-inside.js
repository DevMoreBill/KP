import { StMat } from './st-mat.js';
import { StV } from './st-v.js';
import { StScene } from './st-scene.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLight } from '../layout/station-light.js';

/** Внутри помещения: свет, кабельный лоток, конвекторы, розетки, воздуховод радиатора ДГУ. */
export class OutfitInside {
  constructor(o) {
    this.o = o;
  }

  /** Свет (plan.light): светильники в ряд по оси помещения, у аварийных — зелёный индикатор; в отсеке бака и тамбуре — круглый. */
  lights() {
    const S = this.o.s;
    const P = this.o.p;
    const [L, W, H] = P.int;
    const x0 = S.g.x0 || 0;
    const Lt = P.light;
    if (!Lt || !Lt.on || !this.o.inside) return;
    const lamp = S.M(StMat.glow('#fffdf4', 5));
    const body = S.M(StMat.paint('#e9ecee', 0.4));
    const led = S.M(StMat.glow('#39d353', 3));
    const n = Lt.n;
    const y = W / 2;
    const hl = StationLight.LAMP.len / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((L - x0) * (i + 0.5)) / n;
      body.box(S.P(x - hl, y - 90, H - 60), S.P(x + hl, y + 90, H), 0.01);
      lamp.box(S.P(x - hl + 30, y - 70, H - 62), S.P(x + hl - 30, y + 70, H - 55));
      if (i % 2 === 0 && i / 2 < Lt.em) led.box(S.P(x + hl - 80, y - 104, H - 48), S.P(x + hl - 35, y - 92, H - 28));
    }
    const fu = P.fuel;
    const rooms = [];
    const tb = x0 - (fu ? fu.x1 + fu.part : 0);
    if (fu) rooms.push([0, fu.x1]);
    if (tb > 0) rooms.push([x0 - tb, x0 - 60]);
    for (const [a, b] of rooms) {
      const c = S.P((a + b) / 2, W / 2, H);
      body.tube(c, StV.add(c, [0, 0, -0.06]), 0.13, 20);
      lamp.tube(StV.add(c, [0, 0, -0.06]), StV.add(c, [0, 0, -0.068]), 0.1, 20);
    }
  }

  /** Кабельный лоток вдоль задней стены под потолком */
  tray() {
    const S = this.o.s;
    const [L, W, H] = this.o.p.int;
    const x0 = S.g.x0 || 0;
    if (this.o.sys.power === false || !this.o.inside) return;
    const tr = S.M(StMat.metal(StScene.GALV, 0.45));
    tr.box(S.P(x0 + 150, W - 220, H - 260), S.P(L - 150, W - 20, H - 210), 0.003);
    for (let x = x0 + 600; x < L - 300; x += 1500) tr.box(S.P(x, W - 240, H - 280), S.P(x + 30, W, H - 260));
  }

  /** Конвекторы на местах из расчёта: решётка сверху, терморегулятор, кронштейны. */
  heaters() {
    const S = this.o.s;
    const h = this.o.p.heat;
    if (!h || !h.heaters || !this.o.inside) return;
    const cv = S.M(StMat.paint('#f4f5f6', 0.35));
    const gr = S.M(StMat.paint('#aab0b6', 0.5));
    const dk = S.M(StMat.paint('#2b3036', 0.5));
    const D = StationHeat.CONV.d;
    for (const q of h.heaters) {
      if (!this.o.shown(q.wall)) continue;
      const al = q.wall === 'front' || q.wall === 'back';
      const u0 = al ? q.x : q.y;
      const du = al ? q.lx : q.ly;
      const uc = u0 + du / 2;
      const zc = q.z + q.h / 2;
      this.o.log.push({ kind: 'heater', wall: q.wall, u0, u1: u0 + du });
      this.o.box(cv, q.wall, [uc, zc], [du, q.h, D], 0.012);
      for (let k = 0; k < 5; k++) this.o.box(dk, q.wall, [uc, q.z + q.h - 45 - k * 24], [du - 70, 9, D + 2], 0); // решётка тёплого воздуха
      this.o.box(gr, q.wall, [u0 + du - 55, q.z + q.h - 110], [34, 34, D + 14], 0.008); // терморегулятор
      for (const u of [u0 + 90, u0 + du - 90]) this.o.box(dk, q.wall, [u, q.z + q.h + 18], [40, 36, 24], 0);
    }
  }

  /** Сервисные розетки на высоте K.z: ЯТП-0,25 и 230 В — у входа, 230 В — вдоль помещения, 380 В — у основного оборудования. */
  sockets() {
    const { s: S, p: P } = this.o;
    const K = P.sockets;
    if (!K || !this.o.inside) return;
    const [L, W] = P.int;
    const x0 = S.g.x0 || 0;
    const ws = ['back', 'right', 'left', 'front'];
    const z = K.z;
    const door = OutfitInside.door(P, x0, W);
    const paint = (c, r) => S.M(StMat.paint(c, r));
    const M = {
      gr: paint('#d9dcdf', 0.45),
      lid: paint('#c3c7cb', 0.4),
      red: paint('#c8352c', 0.4),
      dk: paint('#2a2e33', 0.5),
      yl: paint('#f2c230', 0.45),
    };
    const put = (q, kind) => q && this.socket(M, q.w, q.u, kind, z);
    put(this.o.near(ws, [[260, z - 140, z + 220]], door, 1500), 'ytp');
    put(this.o.near(ws, [[140, z - 50, z + 50]], door, 1500), '230');
    for (let k = 1; k < K.n230; k++)
      put(this.o.near(ws, [[140, z - 50, z + 50]], [x0 + ((L - x0) * (k + 0.5)) / K.n230, W]), '230');
    put(this.o.near(ws, [[160, z - 115, z + 35]], OutfitInside.mainAt(P, L, W)), '380');
  }

  /** Выход: дверь оператора в стене прохода или в торце; нет — середина торца у входа. */
  static door(P, x0, W) {
    const ex = (P.fire || {}).exit;
    if (!ex) return [x0, W / 2];
    return ex.wall === 'front' ? [ex.u, 0] : [x0, ex.u];
  }

  /** Основное оборудование (ДГУ, самый мощный компрессор): точка у его лицевой стороны. */
  static mainAt(P, L, W) {
    const I = P.items.filter(i => !i.tank && (i.mount === 'floor' || i.mount === 'frame'));
    const comp = I.filter(i => i.kind === 'compressor').sort((a, b) => (b.kw || 0) - (a.kw || 0))[0];
    const big = I.find(i => i.kind === 'dgu') || comp || I[0];
    if (!big) return [L, W / 2];
    return [big.x + big.lx / 2, big.y + big.ly / 2 > W / 2 ? big.y : big.y + big.ly];
  }

  /** Розетка 230 В (крышка), 380 В (красная с вилкой) или ящик ЯТП-0,25 со знаком W08. */
  socket(M, w, u, kind, z) {
    if (w === 'front' && this.o.s.cut) return;
    this.o.log.push({ kind: 'socket', type: kind, wall: w, u });
    if (kind === '230') {
      this.o.box(M.gr, w, [u, z], [85, 85, 45], 0.008);
      this.o.box(M.lid, w, [u, z + 4], [66, 62, 52], 0.006);
    } else if (kind === '380') {
      this.plug(M, w, u, z - 40);
    } else {
      this.o.box(M.gr, w, [u, z + 40], [230, 330, 190], 0.01);
      this.o.box(M.yl, w, [u + 60, z - 60], [60, 60, 196], 0.006);
      this.o.sign({ type: 'sign', id: 'W08' }, w, [u - 40, z + 120], [70, 61], [191, 0]);
    }
  }

  plug({ red, dk }, w, u, zc) {
    this.o.box(red, w, [u, zc], [110, 140, 70], 0.01);
    const a = this.o.at(w, u, zc - 30, 70);
    const b = this.o.at(w, u, zc - 85, 115);
    red.tube(a, b, 0.032, 16);
    dk.tube(b, StV.add(b, StV.mul(StV.norm(StV.sub(b, a)), 0.01)), 0.026, 14);
  }

  /** Воздуховод от радиатора ДГУ к жалюзи — гибкая вставка из ткани с рамками */
  duct(it) {
    const S = this.o.s;
    const [L, W] = this.o.p.int;
    const x0 = S.g.x0 || 0;
    const rad = it.rad || 'right';
    if (!this.o.inside) return;
    const cl = S.M(StMat.paint('#3b4046', 0.85));
    const f = S.M(StMat.metal('#8f969d', 0.45));
    const za = it.h * 0.1;
    const zb = it.h * 0.96;
    if (rad === 'back') {
      const y1 = it.y + it.ly;
      if (W - y1 < 30) return; // поперёк: радиатор к задней стене
      cl.box(S.P(it.x + 60, y1, za), S.P(it.x + it.lx - 60, W, zb), 0.02);
      for (const y of [y1, W - 40])
        f.box(S.P(it.x + 50, y, it.h * 0.09), S.P(it.x + it.lx - 50, y + 40, it.h * 0.97), 0.006);
      return;
    }
    const [a, b] = rad === 'left' ? [x0, it.x] : [it.x + it.lx, L];
    if (b - a < 30) return;
    cl.box(S.P(a, it.y + 60, za), S.P(b, it.y + it.ly - 60, zb), 0.02);
    for (const x of rad === 'left' ? [a, b - 40] : [a, b - 40])
      f.box(S.P(x, it.y + 50, it.h * 0.09), S.P(x + 40, it.y + it.ly - 50, it.h * 0.97), 0.006);
  }
}
