import { RalColor } from '../layout/ral-color.js';
import { StationGeo } from '../layout/station-geo.js';
import { OutfitBase } from './outfit-base.js';

/** Снаружи: отсек топливного бака, двери с козырьками и прожекторами, рисунки заказчика, маркировка для подъёма, логотип. */
export class OutfitShell {
  constructor(outfit) {
    this.outfit = outfit;
  }

  /**
   * Маркировка для подъёма (ГОСТ 14192-96, plan.mass): № 9 «Место строповки» у верхних углов на длинных стенах (где у
   * угла дверь с козырьком — на торце), № 12 «Центр тяжести» в проекции центра тяжести на каждой свободной стене, рядом
   * со стороны зрителя — «Масса брутто». На тёмной стене — белые; места мало — знак на 1–2 градации меньше.
   */
  lift() {
    const scene = this.outfit.scene;
    const weight = this.outfit.plan.mass;
    if (!weight) return;
    const rgb = RalColor.rgb(scene.wall);
    const light = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.45;
    if (scene.geo.sea)
      for (const frac of [0.14, 0.36, 0.64, 0.86])
        this.outfit.outer(
          'left',
          scene.We * 1000 * frac - scene.oy * 1000 - 180,
          scene.We * 1000 * frac - scene.oy * 1000 + 180,
          -500,
          scene.He * 1000,
        );
    for (const [wall, end] of [
      ['front', 'left'],
      ['front', 'right'],
      ['back', 'left'],
      ['back', 'right'],
    ]) {
      this.sling(wall, end, light);
    }
    const mass = ['front', 'back', 'left', 'right'].map(wall => this.cog(wall, light, weight.mass)).some(Boolean);
    if (!mass) this.massFront(light, weight.mass);
  }

  /** Точка на наружной поверхности стены: u — вдоль стены помещения, z — от пола, мм; на закрытой двери — на полотне. */
  wallAt(wall, u, z) {
    const scene = this.outfit.scene;
    const ox = scene.ox * 1000;
    const leaf = scene.closed && scene.frontOpenings.some(opening => u > opening.x0 && u < opening.x1);
    let point = [wall === 'left' ? this.outfit.leftX() : this.outfit.rightX(), (u + scene.oy * 1000) / 1000];
    if (wall === 'front') point = [(u + ox) / 1000, leaf ? -0.052 : this.outfit.frontY()];
    else if (wall === 'back') point = [(u + ox) / 1000, scene.We - this.outfit.frontY()];
    return [...point, scene.base + z / 1000];
  }

  /** Место a × b с зазором 40 мм свободно снаружи (стена со стороны зрителя в разрезе срезана). */
  free(wall, [u, z], [width, height]) {
    return (
      (wall !== 'front' || !this.outfit.scene.cut) &&
      this.outfit.outFree(wall, u - width / 2 - 40, u + width / 2 + 40, z - height / 2 - 40, z + height / 2 + 40)
    );
  }

  /** Наклейка на стене снаружи. */
  put(decal, wall, [u, z], [width, height]) {
    this.outfit.scene.sticker(decal, this.wallAt(wall, u, z), OutfitBase.N_OUT[wall], [width / 1000, height / 1000]);
    this.outfit.outer(wall, u - width / 2 - 40, u + width / 2 + 40, z - height / 2 - 40, z + height / 2 + 40);
    this.outfit.log.push({ kind: decal.id, wall, u, z });
  }

  /** № 9 у угла: верх — на 130 мм ниже верха контейнера; на длинной стене, иначе на торце у того же угла. */
  sling(wall, end, light) {
    const scene = this.outfit.scene;
    const [signW, signH] = OutfitBase.SLING;
    const [ox, oy] = [scene.ox * 1000, scene.oy * 1000];
    const floorZ = StationGeo.zFloor(scene.geo.type);
    const tries = [1, 0.7, 0.5].flatMap(k => [300, 220, 160].map(offset => [k, offset]));
    for (const [k, offset] of tries) {
      const size = [signW * k, signH * k];
      const z = scene.He * 1000 - floorZ - size[1] / 2 - 130;
      const u = end === 'left' ? offset - ox : scene.Le * 1000 - offset - ox;
      const v = wall === 'front' ? offset - oy : scene.We * 1000 - offset - oy;
      if (this.free(wall, [u, z], size)) {
        this.put({ type: 'sign', id: 'SLING', light }, wall, [u, z], size);
        return;
      }
      if (this.free(end, [v, z], size)) {
        this.put({ type: 'sign', id: 'SLING', light }, end, [v, z], size);
        if (end === 'left') this.outfit.slingL = { ...this.outfit.slingL, [wall]: true };
        return;
      }
    }
  }

  /** № 12 в проекции центра тяжести; со стороны зрителя рядом — «Масса брутто» (справа, слева, ниже, выше). */
  cog(wall, light, massKg) {
    const scene = this.outfit.scene;
    const size = OutfitBase.COG;
    const center = this.outfit.cogOn(wall);
    const k = [1, 0.7, 0.5].find(scale => this.free(wall, [center.u, center.z], [size * scale, size * scale]));
    if (!k) return false;
    const side = size * k;
    this.put({ type: 'sign', id: 'COG', light }, wall, [center.u, center.z], [side, side]);
    if (wall !== 'front') return false;
    const ox = scene.ox * 1000;
    const spot = [
      [center.u + side / 2 + 325, center.z],
      [center.u - side / 2 - 325, center.z],
      [center.u, center.z - side / 2 - 210],
      [center.u, center.z + side / 2 + 210],
    ].find(
      ([u, z]) => u - 225 > -ox && u + 225 < scene.Le * 1000 - ox && z > 250 && this.free(wall, [u, z], [450, 170]),
    );
    if (spot) this.put({ type: 'sign', id: 'MASS', kg: massKg, light }, wall, spot, [450, 170]);
    return !!spot;
  }

  /** «Масса брутто» рядом не встала — на стене со стороны зрителя, ближе к дальнему торцу. */
  massFront(light, massKg) {
    const scene = this.outfit.scene;
    const ox = scene.ox * 1000;
    for (let u = scene.Le * 1000 - ox - 600; u > 600 - ox; u -= 100) {
      const z = [1300, 900].find(cand => this.free('front', [u, cand], [450, 170]));
      if (z) {
        this.put({ type: 'sign', id: 'MASS', kg: massKg, light }, 'front', [u, z], [450, 170]);
        return;
      }
    }
  }

  /**
   * Рисунки заказчика (StationPaint.arts): снаружи на выбранной стене как можно ближе к заданному месту, мимо дверей,
   * ворот, жалюзи и знаков (не помещается — меньше, до половины ширины); знаки строповки и логотип — мимо рисунков.
   */
  arts() {
    const scene = this.outfit.scene;
    this.outfit.artF = [];
    this.outfit.artL = false;
    for (const art of (this.outfit.plan.arts || []).filter(art0 => art0.wall !== 'front' || !scene.cut)) this.art(art);
  }

  /** Рисунок заказчика на стене. */
  art(art) {
    const scene = this.outfit.scene;
    const end = art.wall === 'left' || art.wall === 'right';
    const wallBox = {
      len: (end ? scene.We : scene.Le) * 1000,
      off: (end ? scene.oy : scene.ox) * 1000,
      zlo: (scene.dz + 0.15 - scene.base) * 1000,
      zhi: (scene.top - 0.15 - scene.base) * 1000,
    };
    let best = null;
    let first = null;
    for (const k of [1, 0.8, 0.65, 0.5]) {
      const size = this.artSize(art, k, wallBox);
      first = first || { u: size.u0, z: size.z0, w: size.w, h: size.h };
      best = this.artSpot(art, size, wallBox);
      if (best) break;
    }
    this.artPut(art, best || first, !!best, wallBox.off);
  }

  /** Размер рисунка (доля k от заданной ширины, не шире и не выше стены) и желаемое место u0, z0. */
  artSize(art, k, { len, off, zlo, zhi }) {
    const scene = this.outfit.scene;
    let width = Math.min(art.w * k, len - 300);
    let height = width / art.ar;
    if (height > zhi - zlo) {
      height = zhi - zlo;
      width = height * art.ar;
    }
    const frac = art.wall === 'back' || art.wall === 'left' ? 1 - art.x : art.x;
    const low = 150 + width / 2 - off;
    const high = len - 150 - width / 2 - off;
    return {
      w: width,
      h: height,
      lo: low,
      hi: high,
      u0: Math.min(high, Math.max(low, frac * len - off)),
      z0: Math.min(zhi - height / 2, Math.max(zlo + height / 2, (scene.dz + scene.He * art.z - scene.base) * 1000)),
    };
  }

  /** Ближайшее свободное место (по длине — вес 1, по высоте — 1,5). */
  artSpot(art, { w: width, h: height, lo: low, hi: high, u0, z0 }, { zlo, zhi }) {
    let best = null;
    for (let u = low; u <= high + 1e-6; u += 50) {
      for (let z = zlo + height / 2; z <= zhi - height / 2 + 1e-6; z += 50) {
        const cost = Math.abs(u - u0) + 1.5 * Math.abs(z - z0);
        const ok =
          (!best || cost < best.cost) &&
          this.outfit.outFree(
            art.wall,
            u - width / 2 - 40,
            u + width / 2 + 40,
            z - height / 2 - 40,
            z + height / 2 + 40,
          );
        if (ok) best = { u, z, w: width, h: height, cost };
      }
    }
    return best;
  }

  /** Рисунок на найденном месте. */
  artPut(art, spot, free, off) {
    const scene = this.outfit.scene;
    const [widM, heightM] = [spot.w / 1000, spot.h / 1000];
    const x = (spot.u + off) / 1000;
    const midZ = scene.base + spot.z / 1000;
    let center = [art.wall === 'left' ? this.outfit.leftX() : this.outfit.rightX(), x, midZ];
    if (art.wall === 'front') center = [x, this.outfit.frontY(), midZ];
    else if (art.wall === 'back') center = [x, scene.We - this.outfit.frontY(), midZ];
    scene.sticker({ type: 'art', src: art.src, ar: widM / heightM }, center, OutfitBase.N_OUT[art.wall], [
      widM,
      heightM,
    ]);
    this.outfit.outer(
      art.wall,
      spot.u - spot.w / 2 - 40,
      spot.u + spot.w / 2 + 40,
      spot.z - spot.h / 2 - 40,
      spot.z + spot.h / 2 + 40,
    );
    this.outfit.log.push({
      kind: 'art',
      wall: art.wall,
      u: Math.round(spot.u),
      z: Math.round(spot.z),
      w: Math.round(spot.w),
      free,
    });
    if (art.wall === 'front') this.outfit.artF.push([x - widM / 2 - 0.1, x + widM / 2 + 0.1]);
    if (art.wall === 'left') this.outfit.artL = true;
  }

  /** Логотип организации: на торце у двери (виден и в разрезе); снаружи — ещё на длинной стене в самом широком простенке. */
  brand() {
    const scene = this.outfit.scene;
    const decal = OutfitShell.brandDecal(scene);
    const top = scene.top - (scene.geo.sea ? 0.22 : 0.15);
    const [y0, y1] = this.endSpan();
    const width = Math.min(1.9, (y1 - y0) * 0.92, 0.42 * decal.ar);
    const height = width / decal.ar;
    if (width >= 0.6 && !this.outfit.artL)
      scene.sticker(decal, [this.outfit.leftX(), (y0 + y1) / 2, top - 0.1 - height / 2], [-1, 0, 0], [width, height]);
    if (scene.closed) this.frontBrand(decal, top);
  }

  /** Надпись частями своих цветов (на тёмной стене — белыми); у ПНЕВМОТЕХ — глобус и «группа компаний». */
  static brandDecal(scene) {
    const brand = scene.meta.brand;
    const parts = Array.isArray(brand) && brand.length ? brand : OutfitBase.BRAND;
    const txt = parts.map(part => part[0]).join('');
    const own = /^пневмотех$/i.test(txt);
    const rgb = RalColor.rgb(scene.wall);
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
    const scene = this.outfit.scene;
    const plan = this.outfit.plan;
    const slingL = this.outfit.slingL || {};
    let y1 = plan.fuel && !scene.geo.sea ? scene.We - 0.62 : scene.We - (slingL.back ? 0.5 : 0.12);
    let y0 = slingL.front ? 0.5 : 0.12;
    for (const door of [plan.entry, plan.gates, plan.gates2].filter(
      cand => cand && cand.wall === 'left' && !cand.sea,
    )) {
      const from = scene.oy + door.y0 / 1000 - 0.15;
      const till = scene.oy + door.y1 / 1000 + 0.15;
      if (from - y0 >= y1 - till) y1 = Math.min(y1, from);
      else y0 = Math.max(y0, till);
    }
    return [y0, y1];
  }

  /** На стене со стороны зрителя: мимо дверей и рисунков; жалюзи под логотипом — он выше их козырьков, иначе мимо жалюзи. */
  frontBrand(decal, top) {
    const scene = this.outfit.scene;
    const louvers = ((this.outfit.plan.vent && this.outfit.plan.vent.louvers) || [])
      .filter(louver => louver.wall === 'front')
      .map(louver => ({
        a: scene.ox + louver.u0 / 1000 - 0.15,
        b: scene.ox + louver.u1 / 1000 + 0.15,
        t: scene.base + louver.z1 / 1000 + 0.3,
      }));
    const doors = [
      ...scene.frontOpenings.map(opening => [scene.ox + opening.x0 / 1000 - 0.3, scene.ox + opening.x1 / 1000 + 0.75]),
      ...(this.outfit.artF || []),
    ];
    const bySides = this.widest(doors, louvers, decal, top);
    const byTop = this.widest(
      [...doors, ...louvers.filter(louver => louver.t > top - 0.72).map(louver => [louver.a, louver.b])],
      louvers,
      decal,
      top,
    );
    const best = bySides && (!byTop || bySides.w >= byTop.w * 0.8) ? bySides : byTop;
    if (!best) return;
    const height = best.w / decal.ar;
    scene.sticker(
      decal,
      [(best.g[0] + best.g[1]) / 2, this.outfit.frontY(), top - 0.12 - height / 2],
      [0, -1, 0],
      [best.w, height],
    );
  }

  /** Самый широкий логотип в простенках между вырезами cuts (над жалюзи — по высоте над их козырьками). */
  widest(cuts, louvers, decal, top) {
    const scene = this.outfit.scene;
    const gaps = [];
    let x = 0.5;
    for (const [from, till] of cuts.sort((left, other) => left[0] - other[0])) {
      if (from > x) gaps.push([x, from]);
      x = Math.max(x, till);
    }
    if (scene.Le - 0.5 > x) gaps.push([x, scene.Le - 0.5]);
    let best = null;
    for (const gap of gaps.filter(other => other[1] - other[0] >= 0.9)) {
      const under = louvers.filter(other => other.a < gap[1] && other.b > gap[0]);
      const room = top - 0.12 - Math.max(0, ...under.map(other => other.t));
      const width = Math.min((gap[1] - gap[0]) * 0.85, 3.2, 0.6 * decal.ar, (under.length ? room : 9) * decal.ar);
      if (width >= 0.6 && (!best || width > best.w)) best = { g: gap, w: width };
    }
    return best;
  }
}
