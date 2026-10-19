import { RalColor } from '../layout/ral-color.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Насосы, ДГУ (радиатор, генератор, рама), баки, шкафы управления и прочее оборудование. */
export class SceneUnits {
  constructor(s) {
    this.s = s;
  }

  pump(it) {
    const [x0, , z0, x1, , z1] = this.s.B(it);
    const L = x1 - x0;
    const H = z1 - z0;
    const c = it.color;
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const mot = this.s.M(StMat.paint(c, 0.38));
    const cast = this.s.M(StMat.paint(RalColor.shade(c, 0.78), 0.5));
    const fin = this.s.M(StMat.paint(RalColor.shade(c, 0.85), 0.45));
    const m = { dk, mot, cast, fin };
    if (H > L * 1.2) this.pumpV(it, m);
    else this.pumpH(it, m);
  }

  /** Вертикальный многоступенчатый: основание, проточная часть, двигатель сверху. */
  pumpV(it, { dk, mot, cast, fin }) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const L = x1 - x0;
    const W = y1 - y0;
    const H = z1 - z0;
    const cy = (y0 + y1) / 2;
    const r = Math.min(L, W) * 0.32;
    const cx = (x0 + x1) / 2;
    const zb = z0 + H * 0.12;
    const zm = z0 + H * 0.58;
    cast.box([x0 + L * 0.05, y0 + W * 0.1, z0], [x1 - L * 0.05, y1 - W * 0.1, zb], 0.01);
    for (const s of [-1, 1]) {
      cast.tube(
        [cx + s * L * 0.42, cy, zb * 0.5 + z0 * 0.5],
        [cx + s * L * 0.5, cy, zb * 0.5 + z0 * 0.5],
        r * 0.55,
        18,
      );
      cast.tube([cx + s * L * 0.49, cy, zb * 0.5 + z0 * 0.5], [cx + s * L * 0.5, cy, zb * 0.5 + z0 * 0.5], r * 0.8, 18);
    }
    this.s.M(StMat.metal(StScene.INOX, 0.28)).tube([cx, cy, zb], [cx, cy, zm], r * 0.8, 28);
    cast.tube([cx, cy, zm], [cx, cy, zm + H * 0.05], r * 1.05, 28);
    mot.tube([cx, cy, zm + H * 0.05], [cx, cy, z1 - H * 0.06], r * 1.1, 32);
    for (let z = zm + H * 0.09; z < z1 - H * 0.1; z += H * 0.035)
      fin.tube([cx, cy, z], [cx, cy, z + 0.006], r * 1.17, 32);
    dk.tube([cx, cy, z1 - H * 0.06], [cx, cy, z1], r * 1.05, 28);
  }

  /** Горизонтальный: рама, двигатель с рёбрами и кожухом вентилятора, защита муфты, улитка насоса. */
  pumpH(it, { dk, mot, cast, fin }) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const L = x1 - x0;
    const W = y1 - y0;
    const H = z1 - z0;
    const cy = (y0 + y1) / 2;
    dk.box([x0, y0 + W * 0.08, z0], [x1, y1 - W * 0.08, z0 + Math.min(0.12, H * 0.14)], 0.004);
    const zc = z0 + H * 0.52;
    const r = Math.min(W * 0.42, H * 0.36);
    const xm0 = x0 + L * 0.04;
    const xm1 = x0 + L * 0.52;
    mot.tube([xm0 + 0.05, cy, zc], [xm1, cy, zc], r, 32);
    for (let x = xm0 + 0.08; x < xm1 - 0.03; x += 0.045) fin.tube([x, cy, zc], [x + 0.008, cy, zc], r * 1.08, 32);
    dk.tube([xm0, cy, zc], [xm0 + 0.06, cy, zc], r * 1.03, 32);
    mot.box([xm0 + L * 0.12, cy - r * 0.55, zc + r * 0.85], [xm0 + L * 0.24, cy + r * 0.55, zc + r * 1.1], 0.005); // клеммная коробка
    for (const x of [xm0 + 0.08, xm1 - 0.08])
      mot.box([x - 0.03, cy - r * 0.8, z0 + 0.1], [x + 0.03, cy + r * 0.8, zc - r * 0.75], 0.004);
    this.s
      .M(StMat.paint('#e8a317', 0.4))
      .box([xm1, cy - r * 0.45, zc - r * 0.45], [x0 + L * 0.66, cy + r * 0.45, zc + r * 0.45], 0.01);
    const xp = x0 + L * 0.8;
    const rv = Math.min(r * 1.25, H * 0.45);
    cast.tube([xp - L * 0.08, cy, zc], [xp + L * 0.06, cy, zc], rv, 32);
    cast.tube([xp + L * 0.06, cy, zc], [x1 - 0.01, cy, zc], rv * 0.42, 20);
    cast.tube([x1 - 0.04, cy, zc], [x1, cy, zc], rv * 0.62, 20); // всас
    cast.tube([xp, cy, zc + rv * 0.8], [xp, cy, Math.min(z1, zc + rv + 0.12)], rv * 0.36, 20);
    cast.tube([xp, cy, Math.min(z1, zc + rv + 0.12) - 0.03], [xp, cy, Math.min(z1, zc + rv + 0.12)], rv * 0.55, 20); // напор
    dk.box([xp - 0.04, cy - rv * 0.5, z0 + 0.1], [xp + 0.04, cy + rv * 0.5, zc - rv * 0.7], 0.004);
  }

  /** ДГУ открытого исполнения. */
  dgu(it) {
    const rad = it.rad || 'right';
    const B = this.s.B(it);
    if (rad === 'right')
      return this.dgu0(
        it,
        B,
        m => this.s.M(m),
        p => p,
        true,
      );
    const [a0, b0, , a1, b1] = B;
    const f = rad === 'left' ? p => [a0 + a1 - p[0], p[1], p[2]] : p => [p[1], p[0], p[2]];
    return this.dgu0(
      it,
      rad === 'left' ? B : [b0, a0, B[2], b1, a1, B[5]],
      m => StScene.mapMesh(this.s.M(m), f),
      f,
      false,
    );
  }

  /** ДГУ в своей системе (радиатор к +x). */
  dgu0(it, B, M, f, own) {
    const [x0, y0, z0, x1, y1, z1] = B;
    const g = { B, L: x1 - x0, W: y1 - y0, H: z1 - z0, cy: (y0 + y1) / 2, s: own ? this.s.side(it) : -1 };
    g.fb = z0 + g.H * 0.13;
    const c = it.color;
    const m = {
      M,
      body: M(StMat.paint(c, 0.4)),
      dk: M(StMat.paint(StScene.DARK, 0.6)),
      alt: M(StMat.paint('#4a5259', 0.42)),
      cap: M(StMat.paint(RalColor.shade(c, 0.62), 0.42)),
      st: M(StMat.metal('#8d949a', 0.45)),
    };
    m.dk.box([x0, y0, z0], [x1, y1, g.fb], 0.006); // рама-бак
    m.dk.tube([x0 + g.L * 0.08, y0 + g.W * 0.18, g.fb], [x0 + g.L * 0.08, y0 + g.W * 0.18, g.fb + 0.04], 0.05, 16);
    this.dguGen(g, m);
    this.dguEngine(g, m);
    this.dguExhaust(it, g, m, f);
    this.dguRadiator(it, g, m, own);
    this.dguPanel(g, m);
  }

  /** Генератор: лапы, корпус, решётка торца, клеммная коробка. */
  dguGen(g, { dk, alt }) {
    const [x0] = g.B;
    const { L, W, H, cy, fb } = g;
    const xa = x0 + L * 0.03;
    const xb = x0 + L * 0.34;
    const R = Math.min(W * 0.36, H * 0.3);
    const zc = fb + R + 0.04;
    Object.assign(g, { xa, xb, R, zc });
    for (const x of [xa + 0.08, xb - 0.16])
      dk.box([x, cy - R * 0.8, fb], [x + 0.08, cy + R * 0.8, zc - R * 0.5], 0.004);
    alt.tube([xa + 0.03, cy, zc], [xb, cy, zc], R, 36);
    alt.tube([xa, cy, zc], [xa + 0.03, cy, zc], R * 0.86, 36);
    for (let k = 0; k < 5; k++) {
      const z = zc - R * 0.45 + k * R * 0.2;
      dk.box([xa - 0.004, cy - R * 0.5, z], [xa + 0.002, cy + R * 0.5, z + R * 0.08]);
    }
    alt.box(
      [xa + (xb - xa) * 0.35, cy - R * 0.42, zc + R * 0.8],
      [xb - (xb - xa) * 0.12, cy + R * 0.42, zc + R + 0.1],
      0.01,
    );
  }

  /** Двигатель: поддон, блок, головка, крышка клапанов, опоры. */
  dguEngine(g, { body, dk, cap }) {
    const [x0, , z0] = g.B;
    const { L, W, H, cy, fb, xb } = g;
    const xr = x0 + L * 0.84;
    const wb = W * 0.62;
    const zb = z0 + H * 0.6;
    const zh = zb + H * 0.1;
    const zv = zh + H * 0.05;
    Object.assign(g, { xr, wb, zb, zh, zv });
    dk.box([xb + 0.05, cy - wb * 0.38, fb], [xr - 0.06, cy + wb * 0.38, fb + H * 0.1], 0.01);
    body.box([xb, cy - wb / 2, fb + H * 0.08], [xr - 0.02, cy + wb / 2, zb], 0.02);
    body.box([xb + 0.05, cy - wb * 0.38, zb], [xr - 0.08, cy + wb * 0.38, zh], 0.015);
    cap.box([xb + 0.08, cy - wb * 0.26, zh], [xr - 0.12, cy + wb * 0.26, zv], 0.02);
    for (const x of [xb + 0.1, xr - 0.2]) dk.box([x, cy - W * 0.4, fb], [x + 0.1, cy + W * 0.4, fb + H * 0.1], 0.004);
  }

  /** Выхлоп над ДГУ (глушитель на крыше) и место турбины по длине: под выхлопом (f обратна сама себе). */
  dguTurbo(it, g, f) {
    const ex = (this.s.plan.roof || [])
      .map(m => m.exhaust)
      .find(e => e && e.x >= it.x && e.x <= it.x + it.lx && (e.y == null || (e.y >= it.y && e.y <= it.y + it.ly)));
    if (!ex) return [null, g.xr - 0.3];
    const y = ex.y != null ? ex.y : it.y + it.ly / 2;
    const x = f([this.s.ox + ex.x / 1000, this.s.oy + y / 1000, 0])[0];
    return [ex, Math.max(g.xb + 0.15, Math.min(g.xr - 0.1, x))];
  }

  /** Выпуск со стороны от прохода, турбина, сильфон к глушителю, воздушный фильтр. */
  dguExhaust(it, g, { M, st }, f) {
    const z1 = g.B[5];
    const { L, W, H, cy, s, xb, wb, zb, zh, zv } = g;
    const [ex, tx] = this.dguTurbo(it, g, f);
    const yb = cy - s * wb * 0.56;
    const zx = zb + H * 0.02;
    const rt = Math.min(0.12, H * 0.065);
    st.tube([xb + 0.12, yb, zx], [tx, yb, zx], Math.min(0.055, H * 0.03), 16);
    st.sphere([tx, yb, zx], rt * 0.7, 14);
    st.tube([tx, yb, zx], [tx, cy, zv + rt], rt * 0.45, 16);
    st.sphere([tx, cy, zv + rt], rt, 18);
    if (ex)
      for (let z = zv + rt * 1.6; z < z1 - 0.03; z += 0.03) st.tube([tx, cy, z], [tx, cy, z + 0.018], rt * 0.62, 18);
    M(StMat.paint('#1f2328', 0.55)).tube(
      [xb + L * 0.08, cy + s * wb * 0.18, zh],
      [xb + L * 0.08, cy + s * wb * 0.18, zv + H * 0.14],
      Math.min(0.14, W * 0.12),
      24,
    );
  }

  /** Кожух вентилятора, радиатор с решёткой, пробка. */
  dguRadiator(it, g, { body, dk }, own) {
    const [, y0, , x1, y1, z1] = g.B;
    const { L, W, cy, fb, xr } = g;
    dk.tube(
      [xr - 0.06, cy, fb + (z1 - fb) * 0.5],
      [xr, cy, fb + (z1 - fb) * 0.5],
      Math.min(W * 0.42, (z1 - fb) * 0.42),
      32,
    );
    body.box([xr, y0 + W * 0.04, fb], [x1, y1 - W * 0.04, z1], 0.02);
    if (own) this.s.air.grille({ ...it, x: it.x + it.lx * 0.84, lx: it.lx * 0.16 }, [0.08, 0.92], [0.12, 0.92], 12, 1);
    else
      for (let k = 0; k < 12; k++) {
        const z = fb + (z1 - fb) * (0.12 + k * 0.066);
        dk.box([x1, y0 + W * 0.1, z], [x1 + 0.008, y1 - W * 0.1, z + 0.012]);
      }
    dk.tube([x1 - L * 0.08, cy, z1], [x1 - L * 0.08, cy, z1 + 0.04], 0.04, 14);
  }

  /** Пульт на стойке над генератором. */
  dguPanel(g, { M, dk }) {
    const [, y0, z0, , y1] = g.B;
    const { L, W, H, s, xa, R, zc } = g;
    const py = s < 0 ? y0 + W * 0.12 : y1 - W * 0.12;
    dk.box([xa + L * 0.06, py - 0.02, zc + R], [xa + L * 0.08, py + 0.02, z0 + H * 0.78]);
    dk.box([xa + L * 0.02, py, z0 + H * 0.78], [xa + L * 0.2, py + s * 0.14, z0 + H * 0.97], 0.01);
    const sc = s < 0 ? [py - 0.002 + s * 0.14, py + s * 0.14] : [py + 0.14, py + 0.142];
    M(StMat.glow('#9fd4ff', 1.2)).box([xa + L * 0.05, sc[0], z0 + H * 0.86], [xa + L * 0.13, sc[1], z0 + H * 0.93]);
  }

  tank(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const m = this.s.M(StMat.paint(it.color, 0.42));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    dk.box([x0 - 0.02, y0 - 0.02, z0], [x1 + 0.02, y1 + 0.02, z0 + 0.06], 0.004);
    m.box([x0, y0, z0 + 0.06], [x1, y1, z1], 0.03);
    this.s.tones(it, [x0, y0, z0 + 0.06], [x1, y1, z1], 0.03);
    dk.tube([x0 + (x1 - x0) * 0.2, (y0 + y1) / 2, z1], [x0 + (x1 - x0) * 0.2, (y0 + y1) / 2, z1 + 0.09], 0.07, 20);
    this.s
      .M(StMat.metal(StScene.GALV, 0.35))
      .tube([x0 + (x1 - x0) * 0.75, (y0 + y1) / 2, z1], [x0 + (x1 - x0) * 0.75, (y0 + y1) / 2, z1 + 0.15], 0.015, 10);
    const lv = this.s.front(it, 0.88, 0.15, 0.015);
    this.s
      .M(StMat.paint('#d9e0e6', 0.15))
      .box([lv[0] - 0.015, lv[1], lv[2]], [lv[0] + 0.015, lv[1] - this.s.side(it) * 0.015, lv[2] + (z1 - z0) * 0.7]);
  }

  /** Шкаф. */
  cabinet(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const body = this.s.M(StMat.paint(c, 0.38));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const st = this.s.M(StMat.metal(StScene.GALV, 0.45));
    if (it.mount === 'floor') dk.box([x0 + 0.01, y0 + 0.01, z0], [x1 - 0.01, y1 - 0.01, z0 + 0.1], 0.004);
    body.box([x0, y0, z0 + (it.mount === 'floor' ? 0.1 : 0)], [x1, y1, z1], 0.012);
    this.s.tones(it, [x0, y0, z0 + (it.mount === 'floor' ? 0.1 : 0)], [x1, y1, z1], 0.012);
    const sm = this.s.M(StMat.paint(RalColor.shade(c, 0.72), 0.5));
    this.s.panel(sm, it, [0.03, 0.97], [0.025, 0.03], [0.002, 0]);
    this.s.panel(sm, it, [0.03, 0.97], [0.97, 0.975], [0.002, 0]);
    this.s.panel(sm, it, [0.03, 0.035], [0.03, 0.97], [0.002, 0]);
    this.s.panel(sm, it, [0.965, 0.97], [0.03, 0.97], [0.002, 0]);
    this.s.panel(dk, it, [0.86, 0.9], [0.42, 0.58], [0.02, 0.003]);
    for (const v of [0.12, 0.85]) this.s.panel(dk, it, [0.03, 0.06], [v, v + 0.06], [0.012, 0.003]);
    if (/асу/i.test(String(it.name || ''))) this.cabinetHmi(it);
    else this.cabinetLamps(it, dk);
    this.cabinetMount(it, dk, st);
  }

  /** АСУ ТП — панель оператора. */
  cabinetHmi(it) {
    this.s.panel(this.s.M(StMat.paint('#1f2429', 0.25)), it, [0.2, 0.75], [0.52, 0.86], [0.008, 0.004]);
    this.s.panel(this.s.M(StMat.glow('#79b8ff', 1.5)), it, [0.24, 0.71], [0.56, 0.82], [0.01, 0]);
  }

  /** Лампы (АВР — три), переключатель, табличка. */
  cabinetLamps(it, dk) {
    const lamps = /авр|резерв/i.test(String(it.name || ''))
      ? ['#3ccf5a', '#e2b33a', '#d84a3a']
      : ['#3ccf5a', '#d84a3a'];
    lamps.forEach((col, k) => {
      const p = this.s.front(it, 0.22 + k * 0.13, 0.76, 0);
      this.s.M(StMat.glow(col, 1.4)).tube(p, StV.add(p, this.s.out(it, 0.022)), 0.018, 14);
    });
    const q = this.s.front(it, 0.32, 0.5, 0);
    const h0 = StV.add(q, this.s.out(it, 0.03));
    const h1 = StV.add(q, this.s.out(it, 0.045));
    const t = this.s.endwise(it) ? [0, 0.008, 0.04] : [0.008, 0, 0.04];
    dk.tube(q, h0, 0.035, 18);
    dk.box(
      [0, 1, 2].map(k => Math.min(h0[k], h1[k]) - t[k]),
      [0, 1, 2].map(k => Math.max(h0[k], h1[k]) + t[k]),
      0.003,
    );
    this.s.panel(this.s.M(StMat.paint('#f2f2ee', 0.4)), it, [0.15, 0.6], [0.86, 0.93], [0.004, 0]);
  }

  /** Настенный — кронштейны у стены, на раме — стойки. */
  cabinetMount(it, dk, st) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const s = this.s.side(it);
    if (it.mount === 'wall') {
      const end = this.s.endwise(it);
      const [bx, by] = s < 0 ? [x1, y1] : [x0, y0];
      const back = end ? bx : by;
      for (const v of [0.08, 0.92]) {
        const za = z0 + (z1 - z0) * v - 0.02;
        if (end) dk.box([back, y0 + 0.03, za], [back + s * 0.03, y1 - 0.03, za + 0.04]);
        else dk.box([x0 + 0.03, back, za], [x1 - 0.03, back + s * 0.03, za + 0.04]);
      }
    } else if (it.mount === 'frame') {
      const yc = (y0 + y1) / 2;
      for (const x of [x0 + (x1 - x0) * 0.12, x1 - (x1 - x0) * 0.12 - 0.042])
        st.box([x, yc - 0.021, this.s.base], [x + 0.042, yc + 0.021, z0], 0.004);
      st.box([x0 + 0.02, yc - 0.15, this.s.base], [x1 - 0.02, yc + 0.15, this.s.base + 0.01]);
    }
  }

  other(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const body = this.s.M(StMat.paint(c, 0.42));
    this.s.M(StMat.paint(StScene.DARK, 0.6)).box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + 0.06], 0.004);
    body.box([x0, y0, z0 + 0.06], [x1, y1, z1], 0.015);
    this.s.tones(it, [x0, y0, z0 + 0.06], [x1, y1, z1], 0.015);
    this.s.panel(this.s.M(StMat.paint(RalColor.shade(c, 0.75), 0.5)), it, [0.08, 0.3], [0.7, 0.85], [0.006, 0.003]);
  }
}
