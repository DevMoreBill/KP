import { Mm } from './mm.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';

const m = v => v / 1000;
const r100 = v => Math.ceil(v / 100) * 100;
const r10 = v => Math.round(v / 10) * 10;
const deg = (d, h) => Math.round((Math.atan2(d, h) * 180) / Math.PI);
const up = v => Math.ceil(v * 10 - 1e-9) / 10;

/**
 * Масса при подъёме и центр тяжести (от наружного угла у входа): контейнер (морской — тара ISO 668 и утепление; блок —
 * рама, стены, кровля, пол), оборудование по паспорту, трубы и системы — доля массы оборудования. Строповка: угол ветви с
 * вертикалью — не больше ANGLE (ТОИ Р-66-18-93); длинный блок — с траверсой; морской — только рамной траверсой (ISO 3874).
 */
export class StationMass {
  static get M() {
    return StationMatrix.grp('mass');
  }
  static get TARE() {
    return StationMatrix.derive('tare', () => {
      const s = StationMass.M;
      return { sea10: s.tare10, sea20: s.tare20, sea20hc: s.tare20hc, sea40: s.tare40, sea40hc: s.tare40hc };
    });
  }
  static get FRAME() {
    return StationMass.M.frame;
  }
  static get PANEL() {
    return StationMatrix.derive('panel', () => {
      const s = StationMass.M;
      return { block: s.pBlock, north: s.pNorth, welded: s.pWelded };
    });
  }
  static get LINING() {
    return StationMass.M.lining;
  }
  static get FLOOR() {
    return StationMass.M.floor;
  }
  static get OTHER() {
    return [StationMass.M.otherK, StationMass.M.otherKg];
  }
  static get ANGLE() {
    return StationMass.M.angle;
  }
  static get LUG() {
    return [StationMass.M.lugL, StationMass.M.lugW];
  }
  static get BEAM() {
    const s = StationMass.M;
    return { L: s.beamL, z: s.beamZ, top: s.beamTop };
  }
  static get SPREADER() {
    const s = StationMass.M;
    return { z: s.sprZ, d: s.sprD, top: s.sprTop };
  }

  /** {mass, cont, eq, other, cg, missing, sling, max, mods, top}; из модулей — масса и строповка каждого (поднимают по одному). */
  static calc(plan) {
    const g = plan.geo;
    if (!g || !g.ext || !plan.int) return null;
    const [Le, We, He] = g.ext;
    const MD = g.mods && g.mods.Lm ? g.mods : null;
    const cont = StationMass.shell(g, plan.int, MD);
    const P = MD
      ? MD.cells.map(([i, j]) => ({
          m: cont / MD.n,
          x: (i + 0.5) * MD.Lm,
          y: (j + 0.5) * MD.Wm,
          z: He * 0.42,
          shell: true,
        }))
      : [{ m: cont, x: Le / 2, y: We / 2, z: He * 0.42 }];
    const { eq, missing } = StationMass.equipment(plan, g, P);
    const other = eq * StationMass.OTHER[0] + StationMass.OTHER[1];
    P.push({ m: other, x: Le / 2, y: We / 2, z: He * 0.3, other: true });
    const M = P.reduce((s, q) => s + q.m, 0);
    const c = k => P.reduce((s, q) => s + q.m * q[k], 0) / M;
    const cg = { x: Math.round(c('x')), y: Math.round(c('y')), z: Math.round(c('z')) };
    const mass = r10(M);
    const mods = MD ? StationMass.modules(MD, P, other) : null;
    const top = mods ? mods.reduce((a, b) => (b.mass > a.mass ? b : a)) : null;
    const sling = top ? top.sling : StationMass.sling(Le, We, cg, g.sea);
    return {
      mass,
      cont: r10(cont),
      eq: Math.round(eq),
      other: Math.round(other),
      cg,
      missing: missing.sort((a, b) => a - b),
      sling: top ? sling : { ...sling, wll: StationMass.wll(mass, sling) },
      max: g.sea ? StationMass.max(g.type) : null,
      mods,
      top,
    };
  }

  /** Масса контейнера, кг: из модулей — каждый модуль со своими стенами. */
  static shell(g, [Li, Wi], MD) {
    const [Le, We, He] = g.ext;
    if (g.sea) {
      const lining = g.t > 0 ? StationMass.LINING * 2 * (m(Li) * m(Wi) + m(Li) * m(He) + m(Wi) * m(He)) : 0;
      return (StationMass.TARE[g.type] || (2250 * Le) / 6058) + lining;
    }
    const panel = StationMass.PANEL[g.type] || StationMass.PANEL.block;
    const box = (l, w) =>
      StationMass.FRAME * m(l) +
      panel * (2 * m(l) * m(He) + 2 * m(w) * m(He) + m(l) * m(w)) +
      StationMass.FLOOR * m(l) * m(w);
    return MD ? box(MD.Lm, MD.Wm) * MD.n : box(Le, We);
  }

  /** Оборудование внутри и на крыше: точки масс; без паспортной массы — в missing. */
  static equipment(plan, g, P) {
    const [Le, We, He] = g.ext;
    const [Li, Wi] = plan.int;
    const ox = (Le - Li) / 2;
    const oy = (We - Wi) / 2;
    const zf = StationGeo.zFloor(g.type);
    const missing = [];
    let eq = 0;
    const put = (it, z) => {
      if (!(it.mass > 0)) {
        if (!missing.includes(it.pos)) missing.push(it.pos);
        return;
      }
      eq += it.mass;
      P.push({ m: it.mass, x: ox + it.x + it.lx / 2, y: oy + it.y + it.ly / 2, z });
    };
    for (const it of plan.items || [])
      put(it, zf + it.z + it.h * (it.mount === 'floor' || it.mount === 'frame' ? 0.4 : 0.5));
    for (const r of plan.roof || []) put(r, He + r.gap + r.d / 2);
    return { eq, missing };
  }

  static modules(MD, P, other) {
    const share = other / MD.n;
    return MD.cells.map(([i, j]) => {
      const x0 = i * MD.Lm;
      const y0 = j * MD.Wm;
      const off = { x: x0, y: y0, z: 0 };
      const Q = P.filter(q => !q.other && q.x >= x0 && q.x < x0 + MD.Lm && q.y >= y0 && q.y < y0 + MD.Wm);
      const sum = Q.reduce((s, q) => s + q.m, 0) + share;
      const cm = k => Q.reduce((s, q) => s + q.m * (q[k] - off[k]), 0) / Math.max(1, sum - share);
      const cg = { x: Math.round(cm('x')), y: Math.round(cm('y')), z: Math.round(cm('z')) };
      const mass = r10(sum);
      const sl = StationMass.sling(MD.Lm, MD.Wm, cg, false);
      return { i, j, mass, cg, sling: { ...sl, wll: StationMass.wll(mass, sl) } };
    });
  }

  /** Наибольшая масса брутто морского контейнера по типу (правило mass.iso_max), кг. */
  static max(type) {
    const v = StationRules.v('mass.iso_max') || {};
    if (v[type]) return v[type];
    const kind = [
      [/^sea40/, v.sea40],
      [/^sea10/, v.sea10],
    ].find(([re]) => re.test(type));
    return (kind ? kind[1] : v.sea20) || null;
  }

  /** Грузоподъёмность ветви стропа, т: S = Q / (n · cos α), n — ветвей в расчёте (РД 10-33-93, п. 2.1.4). */
  static wll(mass, S) {
    const n = Math.max(1, +StationRules.v('sling.legs') || 2);
    const t = mass / 1000;
    const a = Math.max(0, ...S.legs.map(q => q.deg || 0));
    return {
      leg: up(t / (n * Math.cos((a * Math.PI) / 180))),
      top: S.frame ? up(t / (2 * Math.cos((S.frame.deg * Math.PI) / 180))) : null,
      n,
      deg: a,
    };
  }

  /** Замечание: брутто больше допустимого для морского контейнера. */
  static issues(Ms) {
    if (!Ms || !(Ms.max > 0) || Ms.mass <= Ms.max) return [];
    return [
      {
        level: 'warn',
        text: `Масса станции около ${Mm.text(Ms.mass)} кг — больше наибольшей массы брутто контейнера ${Mm.text(Ms.max)} кг (ISO 668, требует подтверждения по табличке CSC): облегчите состав или выберите другой контейнер.`,
      },
    ];
  }

  /** Строповка: {hook, beam, frame, legs}; длины ветвей — с округлением до 100 мм вверх. */
  static sling(Le, We, cg, sea) {
    const [a, b] = StationMass.LUG;
    const pts = [
      [a, b],
      [Le - a, b],
      [a, We - b],
      [Le - a, We - b],
    ];
    if (sea) return StationMass.spreader(Le, We, cg, pts);
    const B = StationMass.BEAM;
    if (Le > B.L) {
      const legs = pts.map(([x, y]) => {
        const d = Math.abs(y - cg.y);
        return { x, y, len: r100(Math.hypot(d, B.z)), deg: deg(d, B.z) };
      });
      return { hook: B.z + B.top, beam: { z: B.z, x0: a, x1: Le - a }, frame: null, legs };
    }
    const d = pts.map(([x, y]) => Math.hypot(x - cg.x, y - cg.y));
    const hook = r100(Math.max(...d) / Math.tan((StationMass.ANGLE * Math.PI) / 180));
    return {
      hook,
      beam: null,
      frame: null,
      legs: pts.map(([x, y], i) => ({ x, y, len: r100(Math.hypot(d[i], hook)), deg: deg(d[i], hook) })),
    };
  }

  /** Морской контейнер — рамной траверсой: вертикальные ветви к фитингам, к крюку — от проушин над центром тяжести. */
  static spreader(Le, We, cg, pts) {
    const [a, b] = StationMass.LUG;
    const F = StationMass.SPREADER;
    const d = Math.min(F.d, Math.round(Le / 4));
    const lugs = [Math.max(a, cg.x - d), Math.min(Le - a, cg.x + d)];
    const h = Math.max(...lugs.map(x => Math.abs(x - cg.x)));
    return {
      hook: F.z + F.top,
      beam: null,
      frame: {
        z: F.z,
        x0: a,
        x1: Le - a,
        y0: b,
        y1: We - b,
        lugs,
        top: F.top,
        len: r100(Math.hypot(h, F.top)),
        deg: deg(h, F.top),
      },
      legs: pts.map(([x, y]) => ({ x, y, len: r100(F.z), deg: 0 })),
    };
  }

  /** Строка технической характеристики: масса станции. */
  static text(Ms) {
    if (!Ms) return '';
    const mod = Ms.mods ? ` (модуль — до ${Mm.text(Ms.top.mass)} кг)` : '';
    const miss = Ms.missing.length ? ` (без поз. ${Ms.missing.join(', ')} — масса не указана)` : '';
    return `Масса станции — около ${Mm.text(Ms.mass)} кг${mod}${miss}`;
  }
}
