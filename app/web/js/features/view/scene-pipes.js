import { PipeMaterial } from '../layout/pipe-material.js';
import { StationLayout } from '../layout/station-layout.js';
import { StMat } from './st-mat.js';
import { StScene } from './st-scene.js';
import { StV } from './st-v.js';

/** Трубопровод (линии, отводы, арматура, выход с фланцем), маркировка потока, глушители ДГУ на крыше. */
export class ScenePipes {
  constructor(s) {
    this.s = s;
  }

  /** Выход трубопровода (решение владельца 19.10). */
  outlet(l, op, m, dk, r) {
    const P = op.pts.map(q => this.s.P(...q));
    const last = P[P.length - 1];
    const [dx, dy] = op.dir;
    const wt = dx ? this.s.ox : this.s.oy;
    const fl = (l.out.flange || 150) / 1000;
    const at = d => [last[0] + dx * d, last[1] + dy * d, last[2]];
    for (let k = 1; k < P.length; k++) {
      m.tube(P[k - 1], P[k], r, 20);
      m.sphere(P[k], r * 1.02, 12);
    }
    if (P.length === 1) m.sphere(P[0], r * 1.02, 12);
    m.tube(last, at(wt + fl), r, 20); // сквозь стену и патрубок снаружи
    dk.tube(at(wt * 0.2), at(wt + 0.03), r * 1.45, 18); // гильза с уплотнением
    const F = this.s.M(StMat.metal('#8d949b', 0.35));
    const t = 0.018;
    const R = Math.max(r * 2.3, r + 0.045);
    F.tube(at(wt + fl - t), at(wt + fl), R, 24);
    F.tube(at(wt + fl), at(wt + fl + t), R, 24); // фланец и заглушка
    for (let q = 0; q < 8; q++) {
      const a = (q * Math.PI) / 4;
      const rr = R * 0.78;
      const o = [Math.cos(a) * rr, Math.sin(a) * rr];
      const c = dx ? [0, o[0], o[1]] : [o[0], 0, o[1]];
      const b = at(wt + fl - t - 0.006);
      dk.tube(
        [b[0] + c[0], b[1] + c[1], b[2] + c[2]],
        [b[0] + c[0] + dx * (2 * t + 0.012), b[1] + c[1] + dy * (2 * t + 0.012), b[2] + c[2]],
        0.005,
        6,
      );
    } // болты
  }

  piping(pp) {
    const dk = this.s.M(StMat.paint(StScene.DARK, 0.6));
    const red = this.s.M(StMat.paint('#c83a2e', 0.4));
    const dn = +(String(pp.dn || '').match(/\d+/) || [0])[0] || (this.s.plan.pipe && this.s.plan.pipe.dn) || 0;
    for (const l of pp.lines) this.line(pp, l, { dk, red }, dn);
  }

  lineMat(pp, l) {
    const id = PipeMaterial.idColor(l.medium, '');
    if (!id && pp.mat === 'inox') return this.s.M(StMat.metal(StScene.INOX, 0.22));
    const c = id || pp.color;
    return this.s.M(pp.mat === 'pp' ? StMat.paint(c, 0.32) : { c, r: 0.38, m: 0.35 });
  }

  static radius(l, dn) {
    const def = { fuel: 25, air: 50 }[l.medium] || 80;
    return Math.max(0.012, Math.min(0.08, (dn || def) / 2000 + 0.006));
  }

  line(pp, l, { dk, red }, dn) {
    const id = PipeMaterial.idColor(l.medium, '');
    const m = this.lineMat(pp, l);
    const r = ScenePipes.radius(l, dn);
    const B = this.s.P(l.x1, l.y, l.z);
    const op = (this.s.plan.outside || []).length ? null : StationLayout.outPath(l, this.s.plan.int[1]);
    const out = !op && l.x1 >= this.s.plan.int[0] - 1;
    const end = out ? [this.s.Le + 0.12, B[1], B[2]] : B;
    this.runs(l, m, r, end);
    if (id) this.marks(l, r);
    if (out) {
      m.tube([this.s.Le + 0.04, B[1], B[2]], [this.s.Le + 0.07, B[1], B[2]], r * 1.7, 20);
      dk.tube([this.s.Le - 0.03, B[1], B[2]], [this.s.Le + 0.03, B[1], B[2]], r * 1.4, 18);
    }
    if (op) this.outlet(l, op, m, dk, r);
    this.supports(l, dk, r);
    for (const bp of l.bypass || []) this.bypass(l, bp, { m, red }, r);
    for (const b of l.branches) this.branch(l, b, { m, red }, r);
  }

  runs(l, m, r, end) {
    for (const [a, b] of StationLayout.runs(l)) {
      const p = this.s.P(a, l.y, l.z);
      const q = b >= l.x1 ? end : this.s.P(b, l.y, l.z);
      m.tube(p, q, r, 20);
      m.sphere(p, r * 1.02, 12);
      if (b < l.x1) m.sphere(q, r * 1.02, 12);
    }
  }

  /** Опоры у стены: кронштейн и хомут. */
  supports(l, dk, r) {
    const A = this.s.P(l.x0, l.y, l.z);
    const B = this.s.P(l.x1, l.y, l.z);
    const yw = this.s.oy + this.s.Wi;
    if (yw - A[1] >= 0.6) return;
    for (let x = A[0] + 0.4; x < Math.min(B[0], this.s.ox + this.s.Li) - 0.2; x += 1.4) {
      dk.box([x - 0.02, A[1] - 0.03, A[2] - r - 0.04], [x + 0.02, yw, A[2] - r - 0.01]);
      dk.tube([x - 0.015, A[1], A[2]], [x + 0.015, A[1], A[2]], r * 1.3, 16, { caps: [false, false] });
    }
  }

  /** Байпас осушителя: обвод под магистралью, ручка крана — вниз. */
  bypass(l, bp, { m, red }, r) {
    const zb = l.z - 260;
    const a = this.s.P(bp.x0, l.y, l.z);
    const b = this.s.P(bp.x1, l.y, l.z);
    const a1 = this.s.P(bp.x0, l.y, zb);
    const b1 = this.s.P(bp.x1, l.y, zb);
    const v = this.s.P((bp.x0 + bp.x1) / 2, l.y, zb);
    for (const [p, q] of [
      [a, a1],
      [b, b1],
      [a1, b1],
    ])
      m.tube(p, q, r * 0.85, 16, { caps: [false, false] });
    for (const q of [a, b, a1, b1]) m.sphere(q, r * 0.92, 12);
    m.sphere(v, r * 1.45, 12);
    red.box([v[0] - 0.012, v[1] - 0.012, v[2] - r * 1.3 - 0.018], [v[0] + 0.13, v[1] + 0.012, v[2] - r * 1.3], 0.004);
  }

  /** Подъём от магистрали к коллектору входов параллельных аппаратов. */
  tee(m, pts, r) {
    const [p0, p1, p2] = pts;
    for (const [a, c] of [
      [p0, p1],
      [p1, p2],
    ])
      if (StV.len(StV.sub(c, a)) > 0.01) {
        m.tube(a, c, r, 16, { caps: [false, false] });
        m.sphere(c, r * 1.02, 12);
      }
    m.sphere(p0, r * 1.02, 12);
  }

  /** Отвод к оборудованию: спуск, вход сбоку (ресивер — внизу), фланец у оборудования, шаровой кран. */
  branch(l, b, { m, red }, r) {
    const pts = [this.s.P(b.x, b.y0, l.z), this.s.P(b.x, b.y1, l.z), this.s.P(b.x, b.y1, b.z1)];
    if (b.tee) {
      this.tee(m, pts, r);
      return;
    }
    const [p0, p1, p2] = pts;
    m.sphere(p0, r * 1.05, 12);
    if (StV.len(StV.sub(p1, p0)) > 0.01) {
      m.tube(p0, p1, r * 0.85, 16, { caps: [false, false] });
      m.sphere(p1, r * 0.88, 12);
    }
    const down = b.z1 < l.z;
    if (down) m.tube(p1, p2, r * 0.85, 16, { caps: [false, false] });
    const hz = StV.sub(p1, p0);
    const hl = StV.len(hz);
    const [last, dir] = this.branchEnd(b, pts, down, m, r);
    m.tube(StV.add(last, StV.mul(dir, -0.02)), last, r * 1.6, 18);
    const v =
      hl > 0.15
        ? StV.add(p0, StV.mul(hz, Math.min(0.12, hl * 0.5) / hl))
        : StV.add(p1, [0, 0, -Math.min(0.12, Math.max(0, ((l.z - b.z1) / 1000) * 0.5))]);
    m.sphere(v, r * 1.45, 12);
    red.box([v[0] - 0.012, v[1] - 0.012, v[2] + r * 1.3], [v[0] + 0.13, v[1] + 0.012, v[2] + r * 1.3 + 0.018], 0.004);
  }

  /** Конец отвода у оборудования и направление входа. */
  branchEnd(b, [p0, p1, p2], down, m, r) {
    const to = this.s.plan.items.find(i => StationLayout.key(i) === b.to);
    if (down && to && b.z1 < to.h - 30) {
      const c = this.s.P(to.x + to.lx / 2, to.y + to.ly / 2, b.z1);
      const v = StV.norm([0, c[1] - p2[1], 0]);
      const q = StV.add(p2, StV.mul(v, 0.07));
      m.sphere(p2, r * 0.88, 12);
      m.tube(p2, q, r * 0.85, 16, { caps: [false, false] });
      return [q, v];
    }
    if (down) return [p2, [0, 0, -1]];
    const hz = StV.sub(p1, p0);
    const hl = StV.len(hz);
    return [p1, hl > 1e-3 ? StV.mul(hz, 1 / hl) : [0, 0, -1]];
  }

  /** Стрелки направления потока (наклейки сбоку, к зрителю). */
  marks(l, r) {
    const B = (l.branches || []).map(b => b.x);
    const by = (l.bypass || []).flatMap(q => [q.x0, q.x1]);
    const h = Math.max(0.035, r * 1.3);
    const w = h * 3.2;
    for (const [a, b] of StationLayout.runs(l)) {
      if (b - a < 500) continue;
      for (let x = a + 450; x <= b - 300; x += 1000) {
        if ([...B, ...by].some(v => Math.abs(v - x) < 200)) continue;
        const p = this.s.P(x, l.y, l.z);
        this.s.sticker(
          { type: 'sign', id: 'FLOW', dir: PipeMaterial.flow(l, x) },
          [p[0], p[1] - r - 0.003, p[2]],
          [0, -1, 0],
          [w, h],
        );
      }
    }
    if (l.medium === 'air') this.dropMarks(l, r);
  }

  dropMarks(l, r) {
    for (const br of l.branches || []) {
      const len = l.z - br.z1;
      if (!br.role || len < 350) continue;
      const p = this.s.P(br.x, br.y1, br.z1 + len / 2);
      const rr = r * 0.85;
      this.s.sticker(
        { type: 'sign', id: 'FLOWV', dir: br.role === 'in' ? -1 : 1 },
        [p[0], p[1] - rr - 0.003, p[2]],
        [0, -1, 0],
        [Math.max(0.03, rr * 1.3), Math.max(0.03, rr * 1.3) * 3.2],
      );
    }
  }

  muffler(m) {
    const mm = this.s.mm;
    const dir = m.dir || 'x+';
    if (dir === 'x+')
      return this.muffler0(
        m,
        [this.s.ox + mm(m.x), this.s.oy + mm(m.y)],
        mm(m.lx),
        [this.s.ox + mm(m.exhaust ? m.exhaust.x : 0), this.s.oy + mm(m.exhaust ? m.exhaust.y : 0)],
        [k => this.s.M(k), null],
      );
    if (dir === 'x-') {
      const a = this.s.ox + mm(m.x);
      const b = a + mm(m.lx);
      const f = p => [a + b - p[0], p[1], p[2]];
      return this.muffler0(
        m,
        [a, this.s.oy + mm(m.y)],
        mm(m.lx),
        m.exhaust ? [a + b - (this.s.ox + mm(m.exhaust.x)), this.s.oy + mm(m.exhaust.y)] : null,
        [k => StScene.mapMesh(this.s.M(k), f), null],
      );
    }
    const f = p => [p[1], p[0], p[2]];
    const ys = [this.s.oy + mm(m.y), this.s.oy + mm(m.y + m.ly)];
    const zr = this.s.rise > 0 ? Math.max(...ys.map(y => this.s.roofZ(y)), this.s.roofZ(this.s.We / 2)) + 0.04 : null;
    return this.muffler0(
      m,
      [ys[0], this.s.ox + mm(m.x)],
      mm(m.ly),
      m.exhaust ? [this.s.oy + mm(m.exhaust.y), this.s.ox + mm(m.exhaust.x)] : null,
      [k => StScene.mapMesh(this.s.M(k), f), zr],
    );
  }

  mufflerRoof(cy, r, zr0) {
    if (zr0 != null) return [zr0, zr0 - 0.04];
    if (!(this.s.rise > 0)) return [this.s.top, this.s.top];
    const a = this.s.roofZ(cy - r);
    const b = this.s.roofZ(cy + r);
    return [Math.max(a, b) + 0.04, Math.min(a, b)];
  }

  /** Глушитель в своей системе (вдоль +x, выхлоп к +x). */
  muffler0(m, [x0, y0], len, ex, [M, zr0]) {
    const mm = this.s.mm;
    const x1 = x0 + len;
    const r = mm(m.d) / 2;
    const cy = y0 + r;
    const body = M(StMat.paint(m.color, 0.5));
    const dk = M(StMat.paint(StScene.DARK, 0.55));
    const own = zr0 == null && (m.dir || 'x+') !== 'y+';
    const [zr, zb] = this.mufflerRoof(cy, r, zr0);
    const cz = zr + mm(m.gap) + r;
    // скатная крыша — опоры от ската
    for (const f of [0.18, 0.82]) {
      const x = x0 + (x1 - x0) * f;
      dk.box([x - 0.05, cy - r * 0.75, zb], [x + 0.05, cy + r * 0.75, cz - r * 0.55], 0.004);
      dk.box([x - 0.06, cy - r * 0.8, zr - 0.02], [x + 0.06, cy + r * 0.8, zr]);
    }
    body.tube([x0 + r * 0.25, cy, cz], [x1 - r * 0.25, cy, cz], r, 32, { caps: [false, false] });
    body.tube([x0, cy, cz], [x0 + r * 0.25, cy, cz], r * 0.7, 32, { caps: [true, false], r2: r });
    body.tube([x1 - r * 0.25, cy, cz], [x1, cy, cz], r, 32, { caps: [false, true], r2: r * 0.7 });
    const st = M(StMat.metal('#a7adb3', 0.4));
    const ro = Math.max(0.05, r * 0.28);
    const xe = x1 + mm(m.outlet);
    // выхлоп — горизонтально в сторону радиатора
    st.tube([x1 - 0.02, cy, cz], [xe, cy, cz], ro, 20);
    st.tube([xe - 0.012, cy, cz], [xe, cy, cz], ro * 1.2, 20, { caps: [false, false] });
    dk.tube([xe - 0.002, cy, cz], [xe, cy, cz], ro * 0.9, 20, { caps: [true, true] });
    if (m.exhaust && ex) {
      const [exx, ey] = ex;
      const wrap = M(StMat.metal('#c4c9cd', 0.55));
      wrap.tube([exx, ey, this.s.base + mm(m.exhaust.z)], [exx, ey, cz - r * 0.8], Math.max(0.06, ro * 1.15), 22);
      const zp = own && this.s.rise > 0 ? this.s.roofZ(ey) + 0.04 : (zr0 ?? this.s.top);
      dk.tube([exx, ey, zp - 0.02], [exx, ey, zp + 0.06], Math.max(0.06, ro * 1.15) * 1.6, 22);
    } // проходка через крышу
  }
}
