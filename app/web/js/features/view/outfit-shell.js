import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { OutfitBase } from './outfit-base.js';

/** Снаружи: отсек топливного бака, двери с козырьками и прожекторами, рисунки заказчика, маркировка для подъёма, логотип. */
export class OutfitShell {
  constructor(o) {
    this.o = o;
  }

  /**
   * Маркировка для подъёма (ГОСТ 14192-96, plan.mass): № 9 «Место строповки» у верхних углов на длинных стенах (где у
   * угла дверь с козырьком — на торце), № 12 «Центр тяжести» в проекции центра тяжести на каждой свободной стене, рядом
   * со стороны зрителя — «Масса брутто». На тёмной стене — белые; места мало — знак на 1–2 градации меньше.
   */
  lift() {
    const S = this.o.s;
    const M = this.o.p.mass;
    if (!M) return;
    const rgb = RalColor.rgb(S.wall);
    const light = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.45;
    if (S.g.sea)
      for (const f of [0.14, 0.36, 0.64, 0.86])
        this.o.outer(
          'left',
          S.We * 1000 * f - S.oy * 1000 - 180,
          S.We * 1000 * f - S.oy * 1000 + 180,
          -500,
          S.He * 1000,
        );
    for (const [w, e] of [
      ['front', 'left'],
      ['front', 'right'],
      ['back', 'left'],
      ['back', 'right'],
    ]) {
      this.sling(w, e, light);
    }
    const mass = ['front', 'back', 'left', 'right'].map(w => this.cog(w, light, M.mass)).some(Boolean);
    if (!mass) this.massFront(light, M.mass);
  }

  /** Точка на наружной поверхности стены: u — вдоль стены помещения, z — от пола, мм; на закрытой двери — на полотне. */
  wallAt(w, u, z) {
    const S = this.o.s;
    const ox = S.ox * 1000;
    const leaf = S.closed && S.openF.some(c => u > c.x0 && u < c.x1);
    let xy = [w === 'left' ? this.o.leftX() : this.o.rightX(), (u + S.oy * 1000) / 1000];
    if (w === 'front') xy = [(u + ox) / 1000, leaf ? -0.052 : this.o.frontY()];
    else if (w === 'back') xy = [(u + ox) / 1000, S.We - this.o.frontY()];
    return [...xy, S.base + z / 1000];
  }

  /** Место a × b с зазором 40 мм свободно снаружи (стена со стороны зрителя в разрезе срезана). */
  free(w, [u, z], [a, b]) {
    return (
      (w !== 'front' || !this.o.s.cut) &&
      this.o.outFree(w, u - a / 2 - 40, u + a / 2 + 40, z - b / 2 - 40, z + b / 2 + 40)
    );
  }

  put(d, w, [u, z], [a, b]) {
    this.o.s.sticker(d, this.wallAt(w, u, z), OutfitBase.N_OUT[w], a / 1000, b / 1000);
    this.o.outer(w, u - a / 2 - 40, u + a / 2 + 40, z - b / 2 - 40, z + b / 2 + 40);
    this.o.log.push({ kind: d.id, wall: w, u, z });
  }

  /** № 9 у угла: верх — на 130 мм ниже верха контейнера; на длинной стене, иначе на торце у того же угла. */
  sling(w, e, light) {
    const S = this.o.s;
    const [sw, sh] = OutfitBase.SLING;
    const [ox, oy] = [S.ox * 1000, S.oy * 1000];
    const zf = StationGeo.zFloor(S.g.type);
    const tries = [1, 0.7, 0.5].flatMap(k => [300, 220, 160].map(c => [k, c]));
    for (const [k, c] of tries) {
      const size = [sw * k, sh * k];
      const z = S.He * 1000 - zf - size[1] / 2 - 130;
      const u = e === 'left' ? c - ox : S.Le * 1000 - c - ox;
      const v = w === 'front' ? c - oy : S.We * 1000 - c - oy;
      if (this.free(w, [u, z], size)) {
        this.put({ type: 'sign', id: 'SLING', light }, w, [u, z], size);
        return;
      }
      if (this.free(e, [v, z], size)) {
        this.put({ type: 'sign', id: 'SLING', light }, e, [v, z], size);
        if (e === 'left') this.o.slingL = { ...this.o.slingL, [w]: true };
        return;
      }
    }
  }

  /** № 12 в проекции центра тяжести; со стороны зрителя рядом — «Масса брутто» (справа, слева, ниже, выше). */
  cog(w, light, kg) {
    const S = this.o.s;
    const cs = OutfitBase.COG;
    const c = this.o.cogOn(w);
    const k = [1, 0.7, 0.5].find(q => this.free(w, [c.u, c.z], [cs * q, cs * q]));
    if (!k) return false;
    const a = cs * k;
    this.put({ type: 'sign', id: 'COG', light }, w, [c.u, c.z], [a, a]);
    if (w !== 'front') return false;
    const ox = S.ox * 1000;
    const spot = [
      [c.u + a / 2 + 325, c.z],
      [c.u - a / 2 - 325, c.z],
      [c.u, c.z - a / 2 - 210],
      [c.u, c.z + a / 2 + 210],
    ].find(([u, z]) => u - 225 > -ox && u + 225 < S.Le * 1000 - ox && z > 250 && this.free(w, [u, z], [450, 170]));
    if (spot) this.put({ type: 'sign', id: 'MASS', kg, light }, w, spot, [450, 170]);
    return !!spot;
  }

  /** «Масса брутто» рядом не встала — на стене со стороны зрителя, ближе к дальнему торцу. */
  massFront(light, kg) {
    const S = this.o.s;
    const ox = S.ox * 1000;
    for (let u = S.Le * 1000 - ox - 600; u > 600 - ox; u -= 100) {
      const z = [1300, 900].find(q => this.free('front', [u, q], [450, 170]));
      if (z) {
        this.put({ type: 'sign', id: 'MASS', kg, light }, 'front', [u, z], [450, 170]);
        return;
      }
    }
  }

  /**
   * Рисунки заказчика (StationPaint.arts): снаружи на выбранной стене как можно ближе к заданному месту, мимо дверей,
   * ворот, жалюзи и знаков (не помещается — меньше, до половины ширины); знаки строповки и логотип — мимо рисунков.
   */
  arts() {
    const S = this.o.s;
    this.o.artF = [];
    this.o.artL = false;
    for (const a of (this.o.p.arts || []).filter(q => q.wall !== 'front' || !S.cut)) this.art(a);
  }

  art(a) {
    const S = this.o.s;
    const end = a.wall === 'left' || a.wall === 'right';
    const g = {
      len: (end ? S.We : S.Le) * 1000,
      off: (end ? S.oy : S.ox) * 1000,
      zlo: (S.dz + 0.15 - S.base) * 1000,
      zhi: (S.top - 0.15 - S.base) * 1000,
    };
    let best = null;
    let first = null;
    for (const k of [1, 0.8, 0.65, 0.5]) {
      const q = this.artSize(a, k, g);
      first = first || { u: q.u0, z: q.z0, w: q.w, h: q.h };
      best = this.artSpot(a, q, g);
      if (best) break;
    }
    this.artPut(a, best || first, !!best, g.off);
  }

  /** Размер рисунка (доля k от заданной ширины, не шире и не выше стены) и желаемое место u0, z0. */
  artSize(a, k, { len, off, zlo, zhi }) {
    const S = this.o.s;
    let w = Math.min(a.w * k, len - 300);
    let h = w / a.ar;
    if (h > zhi - zlo) {
      h = zhi - zlo;
      w = h * a.ar;
    }
    const f = a.wall === 'back' || a.wall === 'left' ? 1 - a.x : a.x;
    const lo = 150 + w / 2 - off;
    const hi = len - 150 - w / 2 - off;
    return {
      w,
      h,
      lo,
      hi,
      u0: Math.min(hi, Math.max(lo, f * len - off)),
      z0: Math.min(zhi - h / 2, Math.max(zlo + h / 2, (S.dz + S.He * a.z - S.base) * 1000)),
    };
  }

  /** Ближайшее свободное место (по длине — вес 1, по высоте — 1,5). */
  artSpot(a, { w, h, lo, hi, u0, z0 }, { zlo, zhi }) {
    let best = null;
    for (let u = lo; u <= hi + 1e-6; u += 50) {
      for (let z = zlo + h / 2; z <= zhi - h / 2 + 1e-6; z += 50) {
        const cost = Math.abs(u - u0) + 1.5 * Math.abs(z - z0);
        const ok =
          (!best || cost < best.cost) &&
          this.o.outFree(a.wall, u - w / 2 - 40, u + w / 2 + 40, z - h / 2 - 40, z + h / 2 + 40);
        if (ok) best = { u, z, w, h, cost };
      }
    }
    return best;
  }

  artPut(a, q, free, off) {
    const S = this.o.s;
    const [wm, hm] = [q.w / 1000, q.h / 1000];
    const x = (q.u + off) / 1000;
    const zc = S.base + q.z / 1000;
    let c = [a.wall === 'left' ? this.o.leftX() : this.o.rightX(), x, zc];
    if (a.wall === 'front') c = [x, this.o.frontY(), zc];
    else if (a.wall === 'back') c = [x, S.We - this.o.frontY(), zc];
    S.sticker({ type: 'art', src: a.src, ar: wm / hm }, c, OutfitBase.N_OUT[a.wall], wm, hm);
    this.o.outer(a.wall, q.u - q.w / 2 - 40, q.u + q.w / 2 + 40, q.z - q.h / 2 - 40, q.z + q.h / 2 + 40);
    this.o.log.push({ kind: 'art', wall: a.wall, u: Math.round(q.u), z: Math.round(q.z), w: Math.round(q.w), free });
    if (a.wall === 'front') this.o.artF.push([x - wm / 2 - 0.1, x + wm / 2 + 0.1]);
    if (a.wall === 'left') this.o.artL = true;
  }

  /** Логотип организации: на торце у двери (виден и в разрезе); снаружи — ещё на длинной стене в самом широком простенке. */
  brand() {
    const S = this.o.s;
    const d = OutfitShell.brandDecal(S);
    const top = S.top - (S.g.sea ? 0.22 : 0.15);
    const [y0, y1] = this.endSpan();
    const w = Math.min(1.9, (y1 - y0) * 0.92, 0.42 * d.ar);
    const h = w / d.ar;
    if (w >= 0.6 && !this.o.artL) S.sticker(d, [this.o.leftX(), (y0 + y1) / 2, top - 0.1 - h / 2], [-1, 0, 0], w, h);
    if (S.closed) this.frontBrand(d, top);
  }

  /** Надпись частями своих цветов (на тёмной стене — белыми); у ПНЕВМОТЕХ — глобус и «группа компаний». */
  static brandDecal(S) {
    const m = S.meta.brand;
    const parts = Array.isArray(m) && m.length ? m : OutfitBase.BRAND;
    const txt = parts.map(p => p[0]).join('');
    const own = /^пневмотех$/i.test(txt);
    const rgb = RalColor.rgb(S.wall);
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return {
      type: 'brand',
      parts,
      tag: own ? 'ГРУППА КОМПАНИЙ' : '',
      globe: own,
      light: lum < 0.5,
      ar: Math.max(2.6, Math.min(8, (own ? 0.5 : 0.7) * txt.length)),
    };
  }

  /** Место на торце у входа: мимо жалюзи отсека бака, знаков строповки, двери оператора и ворот. */
  endSpan() {
    const S = this.o.s;
    const P = this.o.p;
    const sl = this.o.slingL || {};
    let y1 = P.fuel && !S.g.sea ? S.We - 0.62 : S.We - (sl.back ? 0.5 : 0.12);
    let y0 = sl.front ? 0.5 : 0.12;
    for (const q of [P.entry, P.gates, P.gates2].filter(o => o && o.wall === 'left' && !o.sea)) {
      const a = S.oy + q.y0 / 1000 - 0.15;
      const b = S.oy + q.y1 / 1000 + 0.15;
      if (a - y0 >= y1 - b) y1 = Math.min(y1, a);
      else y0 = Math.max(y0, b);
    }
    return [y0, y1];
  }

  /** На стене со стороны зрителя: мимо дверей и рисунков; жалюзи под логотипом — он выше их козырьков, иначе мимо жалюзи. */
  frontBrand(d, top) {
    const S = this.o.s;
    const L = ((this.o.p.vent && this.o.p.vent.louvers) || [])
      .filter(q => q.wall === 'front')
      .map(q => ({ a: S.ox + q.u0 / 1000 - 0.15, b: S.ox + q.u1 / 1000 + 0.15, t: S.base + q.z1 / 1000 + 0.3 }));
    const doors = [...S.openF.map(c => [S.ox + c.x0 / 1000 - 0.3, S.ox + c.x1 / 1000 + 0.75]), ...(this.o.artF || [])];
    const A = this.widest(doors, L, d, top);
    const B = this.widest([...doors, ...L.filter(q => q.t > top - 0.72).map(q => [q.a, q.b])], L, d, top);
    const f = A && (!B || A.w >= B.w * 0.8) ? A : B;
    if (!f) return;
    const h = f.w / d.ar;
    S.sticker(d, [(f.g[0] + f.g[1]) / 2, this.o.frontY(), top - 0.12 - h / 2], [0, -1, 0], f.w, h);
  }

  /** Самый широкий логотип в простенках между вырезами cuts (над жалюзи — по высоте над их козырьками). */
  widest(cuts, L, d, top) {
    const S = this.o.s;
    const gaps = [];
    let x = 0.5;
    for (const [a, b] of cuts.sort((p, q) => p[0] - q[0])) {
      if (a > x) gaps.push([x, a]);
      x = Math.max(x, b);
    }
    if (S.Le - 0.5 > x) gaps.push([x, S.Le - 0.5]);
    let best = null;
    for (const g of gaps.filter(q => q[1] - q[0] >= 0.9)) {
      const under = L.filter(q => q.a < g[1] && q.b > g[0]);
      const room = top - 0.12 - Math.max(0, ...under.map(q => q.t));
      const w = Math.min((g[1] - g[0]) * 0.85, 3.2, 0.6 * d.ar, (under.length ? room : 9) * d.ar);
      if (w >= 0.6 && (!best || w > best.w)) best = { g, w };
    }
    return best;
  }
}
