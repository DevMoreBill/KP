import { Mm } from './mm.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Масса при подъёме и центр тяжести (от наружного угла у входа): контейнер (морской — тара ISO 668 и утепление; блок —
 * рама, стены, кровля, пол), оборудование по паспорту, трубы и системы — доля массы оборудования. Строповка: угол ветви с
 * вертикалью — не больше ANGLE (ТОИ Р-66-18-93); длинный блок — с траверсой; морской — только рамной траверсой (ISO 3874).
 */
export class StationMass {
  static _ceil100 = v => Math.ceil(v / 100) * 100;

  static _round10 = v => Math.round(v / 10) * 10;

  static _deg = (dist, height) => Math.round((Math.atan2(dist, height) * 180) / Math.PI);

  static _ceilTenth = v => Math.ceil(v * 10 - 1e-9) / 10;

  /** Правила раздела «Масса» матрицы. */
  static get RULES() {
    return StationMatrix.grp('mass');
  }
  static get _TARE() {
    return StationMatrix.derive('tare', () => {
      const rules = StationMass.RULES;
      return {
        sea10: rules.tare10,
        sea20: rules.tare20,
        sea20hc: rules.tare20hc,
        sea40: rules.tare40,
        sea40hc: rules.tare40hc,
      };
    });
  }
  static get _FRAME() {
    return StationMass.RULES.frame;
  }
  static get _PANEL() {
    return StationMatrix.derive('panel', () => {
      const rules = StationMass.RULES;
      return { block: rules.pBlock, north: rules.pNorth, welded: rules.pWelded };
    });
  }
  /** Масса обшивки, кг/м². */
  static get LINING() {
    return StationMass.RULES.lining;
  }
  static get _FLOOR() {
    return StationMass.RULES.floor;
  }
  /** Прочее: доля от оборудования и постоянная часть, кг. */
  static get OTHER() {
    return [StationMass.RULES.otherK, StationMass.RULES.otherKg];
  }
  /** Наибольший угол стропы, °. */
  static get ANGLE() {
    return StationMass.RULES.angle;
  }
  /** Отступ проушин от торца и края, мм. */
  static get LUG() {
    return [StationMass.RULES.lugL, StationMass.RULES.lugW];
  }
  static get _BEAM() {
    const rules = StationMass.RULES;
    return { L: rules.beamL, z: rules.beamZ, top: rules.beamTop };
  }
  static get _SPREADER() {
    const rules = StationMass.RULES;
    return { z: rules.sprZ, d: rules.sprD, top: rules.sprTop };
  }

  /** {mass, cont, eq, other, cg, missing, sling, max, mods, top}; из модулей — масса и строповка каждого (поднимают по одному). */
  static calc(plan) {
    const geo = plan.geo;
    if (!geo || !geo.ext || !plan.int) return null;
    const [Le, We, He] = geo.ext;
    const modGrid = geo.mods && geo.mods.Lm ? geo.mods : null;
    const cont = StationMass.shell(geo, plan.int, modGrid);
    const points = modGrid
      ? modGrid.cells.map(([i, j]) => ({
          m: cont / modGrid.n,
          x: (i + 0.5) * modGrid.Lm,
          y: (j + 0.5) * modGrid.Wm,
          z: He * 0.42,
          shell: true,
        }))
      : [{ m: cont, x: Le / 2, y: We / 2, z: He * 0.42 }];
    const { eq: equipMass, missing } = StationMass.equipment(plan, geo, points);
    const other = equipMass * StationMass.OTHER[0] + StationMass.OTHER[1];
    points.push({ m: other, x: Le / 2, y: We / 2, z: He * 0.3, other: true });
    const total = points.reduce((acc, point) => acc + point.m, 0);
    const center = k => points.reduce((acc, point) => acc + point.m * point[k], 0) / total;
    const cog = { x: Math.round(center('x')), y: Math.round(center('y')), z: Math.round(center('z')) };
    const mass = StationMass._round10(total);
    const mods = modGrid ? StationMass._modules(modGrid, points, other) : null;
    const top = mods ? mods.reduce((left, right) => (right.mass > left.mass ? right : left)) : null;
    const sling = top ? top.sling : StationMass.sling(Le, We, cog, geo.sea);
    return {
      mass,
      cont: StationMass._round10(cont),
      eq: Math.round(equipMass),
      other: Math.round(other),
      cg: cog,
      missing: missing.sort((left, right) => left - right),
      sling: top ? sling : { ...sling, wll: StationMass.wll(mass, sling) },
      max: geo.sea ? StationMass.max(geo.type) : null,
      mods,
      top,
    };
  }

  /** Масса контейнера, кг: из модулей — каждый модуль со своими стенами. */
  static shell(geo, [Li, Wi], mods) {
    const [Le, We, He] = geo.ext;
    if (geo.sea) {
      const lining =
        geo.t > 0
          ? StationMass.LINING *
            2 *
            (Mm.meters(Li) * Mm.meters(Wi) + Mm.meters(Li) * Mm.meters(He) + Mm.meters(Wi) * Mm.meters(He))
          : 0;
      return (StationMass._TARE[geo.type] || (2250 * Le) / 6058) + lining;
    }
    const panel = StationMass._PANEL[geo.type] || StationMass._PANEL.block;
    const box = (len, wid) =>
      StationMass._FRAME * Mm.meters(len) +
      panel *
        (2 * Mm.meters(len) * Mm.meters(He) + 2 * Mm.meters(wid) * Mm.meters(He) + Mm.meters(len) * Mm.meters(wid)) +
      StationMass._FLOOR * Mm.meters(len) * Mm.meters(wid);
    return mods ? box(mods.Lm, mods.Wm) * mods.n : box(Le, We);
  }

  /** Оборудование внутри и на крыше: точки масс; без паспортной массы — в missing. */
  static equipment(plan, geo, points) {
    const [Le, We, He] = geo.ext;
    const [Li, Wi] = plan.int;
    const ox = (Le - Li) / 2;
    const oy = (We - Wi) / 2;
    const zFloor = StationGeo.zFloor(geo.type);
    const missing = [];
    let equipMass = 0;
    const put = (item, z) => {
      if (!(item.mass > 0)) {
        if (!missing.includes(item.pos)) missing.push(item.pos);
        return;
      }
      equipMass += item.mass;
      points.push({ m: item.mass, x: ox + item.x + item.lx / 2, y: oy + item.y + item.ly / 2, z });
    };
    for (const item of plan.items || [])
      put(item, zFloor + item.z + item.h * (item.mount === 'floor' || item.mount === 'frame' ? 0.4 : 0.5));
    for (const roofItem of plan.roof || []) put(roofItem, He + roofItem.gap + roofItem.d / 2);
    return { eq: equipMass, missing };
  }

  static _modules(mods, points, other) {
    const share = other / mods.n;
    return mods.cells.map(([i, j]) => {
      const x0 = i * mods.Lm;
      const y0 = j * mods.Wm;
      const off = { x: x0, y: y0, z: 0 };
      const inside = points.filter(
        point => !point.other && point.x >= x0 && point.x < x0 + mods.Lm && point.y >= y0 && point.y < y0 + mods.Wm,
      );
      const sum = inside.reduce((acc, point) => acc + point.m, 0) + share;
      const centerOf = k =>
        inside.reduce((acc, point) => acc + point.m * (point[k] - off[k]), 0) / Math.max(1, sum - share);
      const cog = { x: Math.round(centerOf('x')), y: Math.round(centerOf('y')), z: Math.round(centerOf('z')) };
      const mass = StationMass._round10(sum);
      const sling = StationMass.sling(mods.Lm, mods.Wm, cog, false);
      return { i, j, mass, cg: cog, sling: { ...sling, wll: StationMass.wll(mass, sling) } };
    });
  }

  /** Наибольшая масса брутто морского контейнера по типу (правило mass.iso_max), кг. */
  static max(type) {
    const v = StationRules.value('mass.iso_max') || {};
    if (v[type]) return v[type];
    const kind = [
      [/^sea40/, v.sea40],
      [/^sea10/, v.sea10],
    ].find(([pattern]) => pattern.test(type));
    return (kind ? kind[1] : v.sea20) || null;
  }

  /** Грузоподъёмность ветви стропа, т: S = Q / (n · cos α), n — ветвей в расчёте (РД 10-33-93, п. 2.1.4). */
  static wll(mass, sling) {
    const legs = Math.max(1, +StationRules.value('sling.legs') || 2);
    const tonnes = mass / 1000;
    const angle = Math.max(0, ...sling.legs.map(point => point.deg || 0));
    return {
      leg: StationMass._ceilTenth(tonnes / (legs * Math.cos((angle * Math.PI) / 180))),
      top: sling.frame ? StationMass._ceilTenth(tonnes / (2 * Math.cos((sling.frame.deg * Math.PI) / 180))) : null,
      n: legs,
      deg: angle,
    };
  }

  /** Замечание: брутто больше допустимого для морского контейнера. */
  static issues(mass) {
    if (!mass || !(mass.max > 0) || mass.mass <= mass.max) return [];
    return [
      {
        level: 'warn',
        text: `Масса станции около ${Mm.text(mass.mass)} кг — больше наибольшей массы брутто контейнера ${Mm.text(mass.max)} кг (ISO 668, требует подтверждения по табличке CSC): облегчите состав или выберите другой контейнер.`,
      },
    ];
  }

  /** Строповка: {hook, beam, frame, legs}; длины ветвей — с округлением до 100 мм вверх. */
  static sling(Le, We, cog, sea) {
    const [lugX, lugY] = StationMass.LUG;
    const pts = [
      [lugX, lugY],
      [Le - lugX, lugY],
      [lugX, We - lugY],
      [Le - lugX, We - lugY],
    ];
    if (sea) return StationMass.spreader(Le, We, cog, pts);
    const beam = StationMass._BEAM;
    if (Le > beam.L) {
      const legs = pts.map(([x, y]) => {
        const dist = Math.abs(y - cog.y);
        return { x, y, len: StationMass._ceil100(Math.hypot(dist, beam.z)), deg: StationMass._deg(dist, beam.z) };
      });
      return { hook: beam.z + beam.top, beam: { z: beam.z, x0: lugX, x1: Le - lugX }, frame: null, legs };
    }
    const dist = pts.map(([x, y]) => Math.hypot(x - cog.x, y - cog.y));
    const hook = StationMass._ceil100(Math.max(...dist) / Math.tan((StationMass.ANGLE * Math.PI) / 180));
    return {
      hook,
      beam: null,
      frame: null,
      legs: pts.map(([x, y], i) => ({
        x,
        y,
        len: StationMass._ceil100(Math.hypot(dist[i], hook)),
        deg: StationMass._deg(dist[i], hook),
      })),
    };
  }

  /** Морской контейнер — рамной траверсой: вертикальные ветви к фитингам, к крюку — от проушин над центром тяжести. */
  static spreader(Le, We, cog, pts) {
    const [lugX, lugY] = StationMass.LUG;
    const spreader = StationMass._SPREADER;
    const half = Math.min(spreader.d, Math.round(Le / 4));
    const lugs = [Math.max(lugX, cog.x - half), Math.min(Le - lugX, cog.x + half)];
    const arm = Math.max(...lugs.map(x => Math.abs(x - cog.x)));
    return {
      hook: spreader.z + spreader.top,
      beam: null,
      frame: {
        z: spreader.z,
        x0: lugX,
        x1: Le - lugX,
        y0: lugY,
        y1: We - lugY,
        lugs,
        top: spreader.top,
        len: StationMass._ceil100(Math.hypot(arm, spreader.top)),
        deg: StationMass._deg(arm, spreader.top),
      },
      legs: pts.map(([x, y]) => ({ x, y, len: StationMass._ceil100(spreader.z), deg: 0 })),
    };
  }

  /** Строка технической характеристики: масса станции. */
  static text(mass) {
    if (!mass) return '';
    const mod = mass.mods ? ` (модуль — до ${Mm.text(mass.top.mass)} кг)` : '';
    const miss = mass.missing.length ? ` (без поз. ${mass.missing.join(', ')} — масса не указана)` : '';
    return `Масса станции — около ${Mm.text(mass.mass)} кг${mod}${miss}`;
  }
}
