import { RalColor } from '../layout/ral-color.js';
import { StationLayout } from '../layout/station-layout.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Оборудование сжатого воздуха. */
export class SceneAir {
  constructor(s) {
    this.s = s;
  }

  equip(it) {
    if (it.mount === 'wall' && it.wall === 'front' && this.s.cut) return; // на стене со стороны зрителя
    this.body(it);
    this.s.badge(it);
  }

  body(it) {
    const k = it.kind;
    if (k === 'cabinet') return this.s.units.cabinet(it);
    if (it.mount === 'pipe') return this.filter(it);
    if (k === 'receiver') return it.shape === 'hcyl' ? this.receiverH(it) : this.receiver(it);
    if (k === 'compressor') return this.compressor(it);
    if (k === 'dryer') return StationLayout.twinDryer(it) ? this.dryerAds(it) : this.dryer(it);
    if (k === 'pump') return this.s.units.pump(it);
    if (k === 'dgu') return this.s.units.dgu(it);
    if (k === 'tank') return this.s.units.tank(it);
    if (k === 'filter') return this.receiver(it);
    return this.s.units.other(it);
  }

  /** Решётка: горизонтальные ламели на лицевой стороне или торце (end: −1 — торец x0, 1 — x1). */
  grille(it, [u0, u1], [v0, v1], n, end) {
    const m = this.s.M(StMat.paint('#24292e', 0.7));
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    for (let i = 0; i < n; i++) {
      const v = v0 + ((v1 - v0) * (i + 0.25)) / n;
      const v2 = v0 + ((v1 - v0) * (i + 0.7)) / n;
      if (end) {
        const x = end < 0 ? x0 : x1;
        const o = end * 0.006;
        m.box([x, y0 + (y1 - y0) * u0, z0 + (z1 - z0) * v], [x + o, y0 + (y1 - y0) * u1, z0 + (z1 - z0) * v2]);
      } else this.s.panel(m, it, [u0, u1], [v, v2], [0.006, 0]);
    }
  }

  compressor(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const body = this.s.M(StMat.paint(c, 0.42));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.65));
    const hb = Math.min(0.1, (z1 - z0) * 0.07);
    dk.box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + hb], 0.005);
    for (const u of [0.18, 0.72])
      this.s.panel(this.s.M(StMat.paint('#15181b', 0.8)), it, [u, u + 0.1], [0.012, 0.055], [0.001, 0]); // карманы под вилы
    body.box([x0, y0, z0 + hb], [x1, y1, z1], 0.018);
    this.s.tones(it, [x0, y0, z0 + hb], [x1, y1, z1], 0.018);
    const sm = this.s.M(StMat.paint(RalColor.shade(c, 0.7), 0.6)); // швы панелей, ручки
    for (const u of [0.34, 0.67]) this.s.panel(sm, it, [u - 0.002, u + 0.002], [0.08, 0.97], [0.002, 0]);
    for (const u of [0.31, 0.64]) this.s.panel(dk, it, [u - 0.012, u - 0.004], [0.5, 0.62], [0.012, 0.002]);
    // пульт: экран, кнопка аварийной остановки
    this.s.panel(this.s.M(StMat.paint('#30363d', 0.4)), it, [0.72, 0.95], [0.66, 0.9], [0.012, 0.004]);
    this.s.panel(this.s.M(StMat.glow('#8fc7ff', 1.6)), it, [0.75, 0.87], [0.73, 0.85], [0.014, 0]);
    const eb = this.s.front(it, 0.91, 0.72, 0.012);
    this.s.M(StMat.paint('#c0262d', 0.35)).tube(eb, StV.add(eb, [0, this.s.side(it) * 0.025, 0]), 0.02, 14);
    this.grille(it, [0.38, 0.62], [0.15, 0.6], 8);
    this.grille(it, [0.2, 0.8], [0.2, 0.75], 9, -1);
    this.grille(it, [0.2, 0.8], [0.2, 0.75], 9, 1);
    this.duct(it, dk);
  }

  /** Жалюзи компрессора по стенам, сведённые по стене: участок стены под коробом. */
  louvers(it) {
    const V = this.s.plan.vent;
    const kk = StationLayout.key(it);
    const to = V && V.ducts ? V.ducts[kk] : null;
    const Ls = to === 'wall' ? V.louvers.filter(q => q.duct === kk) : [];
    const grp = [...new Set(Ls.map(q => q.wall))].map(w => {
      const G = Ls.filter(q => q.wall === w);
      return {
        wall: w,
        u0: Math.min(...G.map(q => q.u0)),
        u1: Math.max(...G.map(q => q.u1)),
        z0: Math.min(...G.map(q => q.z0)),
        z1: Math.max(...G.map(q => q.z1)),
      };
    });
    return { to, grp };
  }

  /** Выход горячего воздуха вверху. */
  duct(it, dk) {
    const [x0, y0, , x1, y1, z1] = this.s.B(it);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const dw = Math.min((x1 - x0) * 0.45, 0.9);
    const dd = Math.min((y1 - y0) * 0.45, 0.65);
    const dh = Math.min(0.38, this.s.ceil - 0.09 - z1 - 0.06);
    dk.box([cx - dw / 2, cy - dd / 2, z1], [cx + dw / 2, cy + dd / 2, z1 + 0.006]);
    const { to, grp } = this.louvers(it);
    if (dh < 0.18 || !to) return;
    const g = this.s.M(StMat.metal(StScene.GALV, 0.42));
    const zt = this.s.ceil - 0.09;
    const zd = zt - dh;
    const zr = grp.length ? Math.min(zd, ...grp.map(Lv => this.s.base + Lv.z0 / 1000 + 0.05)) : null;
    const zs = z1 + Math.min(0.5, Math.max(0.12, ((zr ?? zd) - z1) * 0.45));
    g.box([cx - dw / 2, cy - dd / 2, z1], [cx + dw / 2, cy + dd / 2, grp.length ? zd : this.s.ceil], 0.004);
    const d = { c: [cx, cy], s: [dw, dd], z: [zd, zt] };
    for (const Lv of grp) {
      if (Lv.wall === 'left' || Lv.wall === 'right') this.toEnd(g, Lv, d);
      else this.toSide(g, Lv, d);
    }
    if ((this.s.plan.sys || {}).rec !== false) this.recirc(it, [cx, cy], [dw, dd], zs);
  }

  /** Короб к жалюзи в торце: по потолку к торцу, вдоль торца, у жалюзи. */
  toEnd(g, Lv, { c: [cx, cy], s: [dw, dd], z: [zd, zt] }) {
    const za = this.s.base + Lv.z0 / 1000;
    const zb = this.s.base + Lv.z1 / 1000;
    const rt = Lv.wall === 'right';
    const xW = rt ? this.s.ox + this.s.Li : this.s.ox + (this.s.g.x0 || 0) / 1000;
    const a = this.s.oy + Lv.u0 / 1000;
    const b = this.s.oy + Lv.u1 / 1000;
    g.box([Math.min(cx - dw / 2, xW), cy - dd / 2, zd], [Math.max(cx + dw / 2, xW), cy + dd / 2, zt], 0.004);
    g.box([rt ? xW - dw : xW, Math.min(cy - dd / 2, a), zd], [rt ? xW : xW + dw, Math.max(cy + dd / 2, b), zt], 0.004);
    g.box([rt ? xW - 0.2 : xW, a, za], [rt ? xW : xW + 0.2, b, zb], 0.004);
  }

  /** Короб к жалюзи в длинной стене: по потолку к стене, вдоль стены, у жалюзи. */
  toSide(g, Lv, { c: [cx, cy], s: [dw, dd], z: [zd, zt] }) {
    const za = this.s.base + Lv.z0 / 1000;
    const zb = this.s.base + Lv.z1 / 1000;
    const fr = Lv.wall === 'front';
    const yW = fr ? this.s.oy : this.s.oy + this.s.Wi;
    const a = this.s.ox + Lv.u0 / 1000;
    const b = this.s.ox + Lv.u1 / 1000;
    g.box([cx - dw / 2, fr ? yW : cy - dd / 2, zd], [cx + dw / 2, fr ? cy + dd / 2 : yW, zt], 0.004);
    g.box([Math.min(cx - dw / 2, a), fr ? yW : yW - dd, zd], [Math.max(cx + dw / 2, b), fr ? yW + dd : yW, zt], 0.004);
    g.box([a, fr ? yW : yW - 0.2, za], [b, fr ? yW + 0.2 : yW, zb], 0.004);
  }

  /** Клапан рециркуляции на воздуховоде компрессора. */
  recirc(it, [cx, cy], [dw, dd], z) {
    const g = this.s.M(StMat.metal(StScene.GALV, 0.36));
    const dk = this.s.M(StMat.paint('#23272b', 0.55));
    const act = this.s.M(StMat.paint('#3a4048', 0.5));
    const h = 0.22;
    const s = this.s.side(it);
    const yf = s > 0 ? cy + dd / 2 : cy - dd / 2;
    g.box([cx - dw / 2 - 0.03, cy - dd / 2 - 0.03, z], [cx + dw / 2 + 0.03, cy + dd / 2 + 0.03, z + h], 0.004);
    for (let k = 0; k < 4; k++) {
      const zz = z + 0.04 + k * 0.045;
      dk.box([cx - dw / 2 + 0.04, yf + s * 0.03, zz], [cx + dw / 2 - 0.04, yf + s * 0.04, zz + 0.018]);
    } // решётка
    act.box([cx + dw / 2 + 0.03, cy - 0.06, z + 0.04], [cx + dw / 2 + 0.12, cy + 0.06, z + 0.16], 0.006); // электропривод
  }

  dryer(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const body = this.s.M(StMat.paint(c, 0.4));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    dk.box([x0 + 0.02, y0 + 0.02, z0], [x1 - 0.02, y1 - 0.02, z0 + 0.05], 0.004);
    body.box([x0, y0, z0 + 0.05], [x1, y1, z1], 0.016);
    this.s.tones(it, [x0, y0, z0 + 0.05], [x1, y1, z1], 0.016);
    this.s.panel(this.s.M(StMat.paint('#2c3238', 0.4)), it, [0.1, 0.42], [0.72, 0.9], [0.01, 0.004]);
    this.s.panel(this.s.M(StMat.glow('#9fe0a6', 1.2)), it, [0.13, 0.25], [0.77, 0.85], [0.012, 0]);
    this.grille(it, [0.1, 0.9], [0.12, 0.5], 7);
    this.grille(it, [0.15, 0.85], [0.2, 0.7], 7, 1);
    const g = this.s.M(StMat.metal(StScene.GALV, 0.35));
    const s = this.s.side(it);
    const yb = s < 0 ? y1 - 0.12 : y0 + 0.12;
    for (const u of [0.25, 0.75]) {
      const x = x0 + (x1 - x0) * u;
      g.tube([x, yb, z1], [x, yb, z1 + 0.08], 0.03, 14);
      g.tube([x, yb, z1 + 0.06], [x, yb, z1 + 0.08], 0.055, 16);
    }
  }

  dryerAds(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const tw = this.s.M(StMat.paint(c, 0.38));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const g = this.s.M(StMat.metal(StScene.GALV, 0.35));
    dk.box([x0, y0, z0], [x1, y1, z0 + 0.08], 0.004);
    const r = Math.min((x1 - x0) / 4.6, (y1 - y0) / 2.3);
    const yc = (y0 + y1) / 2;
    for (const u of [0.27, 0.73]) {
      const x = x0 + (x1 - x0) * u;
      tw.tube([x, yc, z0 + 0.15], [x, yc, z1 - r * 0.5 - 0.12], r, 28, { caps: [true, false] });
      tw.dish([x, yc, z1 - r * 0.5 - 0.12], r, 1);
    }
    g.box([x0 + (x1 - x0) * 0.2, yc - 0.05, z1 - 0.14], [x0 + (x1 - x0) * 0.8, yc + 0.05, z1 - 0.05], 0.01);
    g.box([x0 + (x1 - x0) * 0.2, yc - 0.05, z0 + 0.1], [x0 + (x1 - x0) * 0.8, yc + 0.05, z0 + 0.2], 0.01);
    const p = this.s.front(it, 0.5, 0.55, 0);
    this.s
      .M(StMat.paint('#d8dcdf', 0.4))
      .box([p[0] - 0.15, p[1], p[2] - 0.2], [p[0] + 0.15, p[1] + this.s.side(it) * 0.15, p[2] + 0.2], 0.01);
  }

  receiver(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const c = it.color;
    const m = this.s.M(StMat.paint(c, 0.38));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = Math.min(x1 - x0, y1 - y0) / 2;
    const leg = Math.min(0.22, (z1 - z0) * 0.1);
    const zb = z0 + leg + r * 0.5;
    const zt = z1 - r * 0.5;
    for (const a of [0.5, 2.6, 4.7])
      dk.tube(
        [cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, z0],
        [cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, zb - r * 0.2],
        0.025,
        10,
      );
    m.tube([cx, cy, zb], [cx, cy, zt], r, 36, { caps: [false, false] });
    m.dish([cx, cy, zt], r, 1, 36);
    m.dish([cx, cy, zb], r, -1, 36);
    const s = this.s.side(it);
    const br = this.s.M(StMat.metal('#b8924f', 0.35));
    const g = this.s.M(StMat.metal(StScene.GALV, 0.35));
    br.tube([cx, cy, z1 - 0.02], [cx, cy, z1 + 0.07], 0.02, 12);
    br.sphere([cx, cy, z1 + 0.09], 0.025, 10); // предохранительный клапан
    g.tube([cx, cy + s * r, (zb + zt) / 2], [cx, cy + s * (r + 0.1), (zb + zt) / 2], 0.12, 20);
    g.tube([cx, cy + s * (r + 0.09), (zb + zt) / 2], [cx, cy + s * (r + 0.11), (zb + zt) / 2], 0.15, 20); // люк
    const gz = zb + (zt - zb) * 0.8;
    const gp = [cx + r * 0.7, cy + s * r * 0.72, gz];
    dk.tube(gp, StV.add(gp, [0, s * 0.03, 0]), 0.05, 18);
    this.s
      .M(StMat.paint('#f4f4f2', 0.3))
      .tube(StV.add(gp, [0, s * 0.03, 0]), StV.add(gp, [0, s * 0.032, 0]), 0.043, 18);
    g.tube([cx, cy, zb - r * 0.5], [cx, cy, z0 + 0.03], 0.012, 8);
  }

  receiverH(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const m = this.s.M(StMat.paint(it.color, 0.38));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const cy = (y0 + y1) / 2;
    const r = (Math.min(y1 - y0, z1 - z0) / 2) * 0.95;
    const cz = z1 - r;
    for (const u of [0.18, 0.82]) {
      const x = x0 + (x1 - x0) * u;
      dk.box([x - 0.05, cy - r * 0.7, z0], [x + 0.05, cy + r * 0.7, cz - r * 0.3], 0.004);
    }
    m.tube([x0 + r * 0.4, cy, cz], [x1 - r * 0.4, cy, cz], r, 36, { caps: [false, false] });
    for (const [x, s] of [
      [x0 + r * 0.4, -1],
      [x1 - r * 0.4, 1],
    ]) {
      const seg = 24;
      const k0 = m.count;
      const rows = 8;
      for (let i = 0; i <= rows; i++) {
        const a = ((i / rows) * Math.PI) / 2;
        const rr = r * Math.cos(a);
        const xx = x + s * r * 0.4 * Math.sin(a);
        for (let j = 0; j <= seg; j++) {
          const ph = (j / seg) * Math.PI * 2;
          m.vert(
            [xx, cy + rr * Math.cos(ph), cz + rr * Math.sin(ph)],
            StV.norm([(s * Math.sin(a)) / 0.4, Math.cos(a) * Math.cos(ph), Math.cos(a) * Math.sin(ph)]),
          );
        }
      }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < seg; j++) {
          const a = k0 + i * (seg + 1) + j;
          const b = a + seg + 1;
          m.i.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
  }

  /** Магистральный фильтр на трубе: головка на оси трубы, колба вниз, дренаж, манометр. */
  filter(it) {
    const [x0, y0, z0, x1, y1, z1] = this.s.B(it);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const w = x1 - x0;
    const hh = Math.max(0.05, (z1 - z0) * 0.14);
    const head = this.s.M(StMat.metal('#b6bcc2', 0.32));
    const bowl = this.s.M(StMat.paint(it.color, 0.35));
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    head.box([cx - w * 0.55, cy - w * 0.45, z1 - hh], [cx + w * 0.55, cy + w * 0.45, z1], 0.006);
    bowl.tube([cx, cy, z1 - hh], [cx, cy, z0 + 0.06], w * 0.4, 24, { caps: [false, true], r2: w * 0.36 });
    this.s
      .M(StMat.paint('#2f6db3', 0.4))
      .tube([cx, cy, z1 - hh - 0.03], [cx, cy, z1 - hh - 0.07], w * 0.41, 24, { caps: [false, false] }); // метка ступени очистки
    dk.tube([cx, cy, z0 + 0.06], [cx, cy, z0], 0.012, 10);
    const s = this.s.side(it);
    const gp = [cx, cy + s * w * 0.45, z1 - hh / 2];
    dk.tube(gp, StV.add(gp, [0, s * 0.02, 0]), Math.min(0.03, hh * 0.4), 14);
  }
}
