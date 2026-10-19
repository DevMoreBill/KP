import { RalColor } from '../layout/ral-color.js';
import { StWalls } from '../layout/st-walls.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationMods } from '../layout/station-mods.js';
import { StationVent } from '../layout/station-vent.js';

const END = w => w === 'left' || w === 'right';

/**
 * Основа оснащения 3D-вида: места на стенах внутри (StWalls) и снаружи (O), точки и короба у стен, наклейки, видимость
 * места на картинке, козырьки и маркизы над жалюзи, проекция центра тяжести. u — вдоль стены, z — от пола, мм.
 */
export class OutfitBase {
  static N = { left: [1, 0, 0], right: [-1, 0, 0], back: [0, -1, 0], front: [0, 1, 0] };
  static N_OUT = { left: [-1, 0, 0], right: [1, 0, 0], back: [0, 1, 0], front: [0, -1, 0] };
  static RED = '#c42a20';
  /** Место, невидимое на 3D-виде, — как на 3 м дальше от цели. */
  static HIDE = 3000;
  /** Знак № 9 «Место строповки» и № 12 «Центр тяжести» на стене (ГОСТ 14192-96), мм. */
  static SLING = [180, 300];
  static COG = 300;
  static BRAND = [
    ['ПНЕВМО', '#0B45A0'],
    ['ТЕХ', '#3DA0EE'],
  ];

  /** Огнетушитель: верх — не выше 1,5 м от пола (ППР в РФ). */
  static get EXT() {
    return StationMatrix.grp('fire').ext;
  }

  constructor(scene) {
    this.s = scene;
    this.p = scene.plan;
    this.sys = this.p.sys || {};
    this.walls = new StWalls(this.p);
    this.inside = scene.view === 'in';
    this.log = [];
    this.O = { left: [], right: [], back: [], front: [] };
  }

  /** Станция из модулей: стыки на стенах снаружи заняты (стойки, нащельники); изнутри — StWalls. */
  joints() {
    const J = StationMods.lines(this.p.geo);
    const H = this.p.int[2];
    for (const x of J.x) for (const w of ['front', 'back']) this.outer(w, x - 200, x + 200, -500, H + 500);
    for (const y of J.y) for (const w of ['left', 'right']) this.outer(w, y - 200, y + 200, -500, H + 500);
  }

  /** Снаружи на стене w занят участок u0…u1, z0…z1. */
  outer(w, u0, u1, z0, z1) {
    this.O[w].push([u0, u1, z0, z1]);
  }

  outFree(w, u0, u1, z0, z1) {
    return this.O[w].every(q => !(q[0] < u1 && q[1] > u0 && q[2] < z1 && q[3] > z0));
  }

  /** Точка у стены помещения: u — вдоль стены, z — от пола, o — от стены внутрь, мм → мир, м. */
  at(w, u, z, o = 0) {
    const S = this.s;
    const [L, W] = this.p.int;
    const P = {
      left: () => S.P((S.g.x0 || 0) + o, u, z),
      right: () => S.P(L - o, u, z),
      back: () => S.P(u, W - o, z),
    }[w];
    return P ? P() : S.P(u, o, z);
  }

  /** Короб на стене: середина [u, z]; ширина, высота, глубина от стены [du, dz, d], мм. */
  box(m, w, [u, z], [du, dz, d], r = 0.004) {
    const a = this.at(w, u - du / 2, z - dz / 2, 0);
    const b = this.at(w, u + du / 2, z + dz / 2, d);
    m.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), a[2], Math.max(a[0], b[0]), Math.max(a[1], b[1]), b[2], r);
  }

  /** Наклейка на стене: середина [u, z], размер [sw, sh], [от стены, свечение], мм. */
  sign(d, w, [u, z], [sw, sh], [o, e] = [0, 0]) {
    this.s.sticker(d, this.at(w, u, z, o), OutfitBase.N[w], sw / 1000, sh / 1000, e);
  }

  /** Стена видна: снаружи внутреннего не видно, стена со стороны зрителя в разрезе срезана. */
  shown(w) {
    return this.inside && !(w === 'front' && this.s.cut);
  }

  /** Наружная поверхность обшивки: гофр и профлист выступают. */
  skin() {
    const S = this.s;
    if (S.g.sea) return null;
    return S.g.type === 'welded' ? 0.003 : 0.018;
  }

  /** Стена со стороны зрителя (y). */
  frontY() {
    const k = this.skin();
    return k == null ? -0.008 : k;
  }

  /** Торец у двери (x): с воротами или дверью в торце — по коробке проёма. */
  leftX() {
    const P = this.p;
    if (this.s.g.sea) return -0.034;
    const gate = [P.gates, P.gates2].some(q => q && q.wall === 'left') || !!(P.fuel && P.fuel.gate);
    return P.door === 'end' || gate ? -0.028 : this.skin();
  }

  /** Дальний торец (виден снаружи у ДГУ с дверью-жалюзи). */
  rightX() {
    const S = this.s;
    if (S.g.sea) return S.Le + 0.008;
    const gate = [this.p.gates, this.p.gates2].some(q => q && q.wall === 'right');
    return S.Le + (gate ? 0.028 : -this.skin());
  }

  /** Точка стены видна: луч к камере не упирается в торец, потолок у среза, оборудование; при стоящей стене — через проёмы. */
  seen(w, u, z) {
    if (w === 'front' || !this.inside) return false;
    const S = this.s;
    const p = this.at(w, u, z, 70);
    const az = (StCam.AZ * Math.PI) / 180;
    const el = (StCam.EL * Math.PI) / 180;
    const d = [-Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
    const t0 = -p[1] / d[1];
    const q = StV.add(p, StV.mul(d, t0));
    const tl = (S.ox + (S.g.x0 || 0) / 1000 - p[0]) / d[0];
    if ((tl > 0 && tl < t0) || q[2] > S.ceil - 0.01) return false;
    const open =
      S.cut ||
      S.openF.some(
        c => q[0] > S.ox + c.x0 / 1000 + 0.03 && q[0] < S.ox + c.x1 / 1000 - 0.03 && q[2] < S.base + c.h / 1000 - 0.03,
      );
    return open && !this.p.items.some(it => it.mount !== 'pipe' && !it.tank && OutfitBase.hits(p, d, t0, S.B(it)));
  }

  /** Луч p + t·d (0 < t < t0) пересекает коробку b = [x0, y0, z0, x1, y1, z1]. */
  static hits(p, d, t0, b) {
    let [t1, t2] = [1e-4, t0];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (p[k] < b[k] || p[k] > b[k + 3]) return false;
        continue;
      }
      const a = [(b[k] - p[k]) / d[k], (b[k + 3] - p[k]) / d[k]].sort((x, y) => x - y);
      [t1, t2] = [Math.max(t1, a[0]), Math.min(t2, a[1])];
      if (t1 > t2) return false;
    }
    return true;
  }

  /**
   * Место у точки t = [x, y] плана на стенах ws: свободный участок одной из полос bands ([ширина, z0, z1, штраф]),
   * ближайший; видимое на 3D-виде — в первую очередь (невидимое — как на hide дальше); нет — без «мягких» запретов.
   * Место занимается: {w, u — середина, wd, z0, z1} или null.
   */
  near(ws, bands, t, hide = OutfitBase.HIDE) {
    const best = this.best(ws, bands, t, hide, true) || this.best(ws, bands, t, hide, false);
    if (best) this.walls.busy(best.w, best.u - best.wd / 2, best.u + best.wd / 2, best.z0, best.z1);
    return best;
  }

  best(ws, bands, t, hide, soft) {
    let best = null;
    for (const [wd, z0, z1, pen = 0] of bands) {
      for (const w of ws) {
        const q = this.bestOn(w, { wd, z0, z1, pen }, t, hide, soft);
        if (q && (!best || q.sc < best.sc)) best = q;
      }
    }
    return best;
  }

  bestOn(w, { wd, z0, z1, pen }, t, hide, soft) {
    const [L, W] = this.p.int;
    const [lo, hi] = this.walls.range(w);
    const zv = z0 + Math.min(z1 - z0, 900) * 0.35;
    const xy = c => [{ left: this.s.g.x0 || 0, right: L }[w] ?? c, { back: W, front: 0 }[w] ?? c];
    let best = null;
    for (let u = lo + 120; u + wd <= hi - 120; u += 50) {
      if (!this.walls.free(w, [u, u + wd], [z0, z1], soft)) continue;
      const c = u + wd / 2;
      const [x, y] = xy(c);
      const sc = Math.hypot(x - t[0], y - t[1]) + pen + (this.seen(w, c, zv) ? 0 : hide);
      if (!best || sc < best.sc) best = { w, u: c, wd, z0, z1, sc };
    }
    return best;
  }

  /** Козырёк над жалюзи снаружи (от дождя и снега). */
  hood(w, a, b, zt) {
    const S = this.s;
    const m = S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45));
    const t = [0, 0, 0.006];
    if (w === 'right') m.obox([S.Le, S.oy + a, zt], [0, b - a, 0], [0.14, 0, -0.07], t);
    else if (w === 'left') m.obox([0, S.oy + a, zt], [0, b - a, 0], [-0.14, 0, -0.07], t);
    else if (w === 'back') m.obox([S.ox + a, S.We, zt], [b - a, 0, 0], [0, 0.14, -0.07], t);
    else if (!S.cut) m.obox([S.ox + a, 0, zt], [b - a, 0, 0], [0, -0.14, -0.07], t);
  }

  /** Точка снаружи стены w: u — вдоль, x — от наружной плоскости, z — высота, м. */
  outside(w, u, x, z) {
    const S = this.s;
    if (w === 'right') return [S.Le + x, S.oy + u, z];
    if (w === 'left') return [-x, S.oy + u, z];
    return w === 'back' ? [S.ox + u, S.We + x, z] : [S.ox + u, -x, z];
  }

  /**
   * Маркиза над жалюзи (u a…b, верх Z1, м): откидной козырёк на петлях, открыт на угол H.a; по бокам — треугольные
   * створки-ограничители (воздух только снизу); закрытая ложится на проём как щит. o — от наружной плоскости.
   */
  snow(w, [a, b], Z1, H, o = 0) {
    if (w === 'front' && this.s.cut) return;
    const S = this.s;
    const m = S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45));
    const sd = S.M(StMat.paint(RalColor.shade(S.wall, 0.78), 0.5));
    const dk = S.M(StMat.paint('#24292e', 0.5));
    const t = 0.004;
    const at = (u, q, z) => this.outside(w, u, o + q, z);
    const vec = (du, dq, dz) => at(du, dq, dz).map((v, k) => v - at(0, 0, 0)[k]);
    const r = (H.a * Math.PI) / 180;
    const [d, dr, sw] = [H.d / 1000, H.drop / 1000, StationVent.HOOD_SIDE / 1000];
    const [A, B] = [a - sw, b + sw];
    const zh = Z1 + StationVent.HOOD_LAP / 1000;
    const zl = zh - dr;
    const q0 = 0.012;
    m.obox(at(A, q0, zh), vec(B - A, 0, 0), vec(0, d, -dr), vec(0, t * Math.cos(r), t * Math.sin(r)));
    m.obox(at(A, q0 + d, zl), vec(B - A, 0, 0), vec(0, 0, -0.035), vec(0, t, 0));
    for (const u of [A, B]) {
      const [p1, p2, p3] = [at(u, q0, zh), at(u, q0 + d, zl), at(u, q0, zl)];
      sd.tri(p1, p2, p3);
      sd.tri(p1, p3, p2);
    }
    for (const u of [a, (a + b) / 2 - 0.03, b - 0.06])
      dk.tube(at(u, 0.02, zh + 0.01), at(u + 0.06, 0.02, zh + 0.01), 0.012, 8);
  }

  /** Проекция центра тяжести на стену w: {u, z} — мм, как у StWalls; нет массы — null. */
  cogOn(w) {
    const M = this.p.mass;
    const S = this.s;
    if (!M) return null;
    const c = M.cg;
    return { u: END(w) ? c.y - S.oy * 1000 : c.x - S.ox * 1000, z: c.z - StationGeo.zFloor(S.g.type) };
  }
}
