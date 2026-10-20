import { RalColor } from '../layout/ral-color.js';
import { StationLayout } from '../layout/station-layout.js';

/** Оборудование на SVG-виде станции: короба, цилиндры, ДГУ, насосы, воздуховоды компрессоров. */
export class View3dUnits {
  static DARK = '#3a3f45';

  /** Верх оборудования, каким оно нарисовано (насос — ниже габарита, горизонтальная ёмкость — на опорах). */
  static top(item) {
    if (item.kind === 'pump') return item.h * 0.85;
    if (item.shape === 'hcyl') return item.h * 0.55 + (Math.min(item.ly, item.h) / 2) * 0.95;
    return item.h;
  }

  /** Габарит изделия на виде: углы, размеры, цвет. */
  static frame(item, base) {
    const z0 = base + (item.z || 0);
    return {
      x0: item.X0,
      x1: item.X1,
      y0: item.Y0,
      y1: item.Y1,
      z0,
      z1: z0 + item.h,
      L: item.X1 - item.X0,
      W: item.Y1 - item.Y0,
      c: item.color,
    };
  }

  /** Оборудование на виде; ctx — {base, ceil, yWall, at}. */
  static equip(view, item, ctx) {
    const box = View3dUnits.frame(item, ctx.base);
    const out = item.mount === 'frame' ? View3dUnits.frameLegs(view, box, ctx.base) : [];
    if (item.mount === 'pipe') return [...out, ...View3dUnits.filter(view, item, box)];
    if (item.shape === 'vcyl') return [...out, ...View3dUnits.vcyl(view, item, box)];
    if (item.shape === 'hcyl') return [...out, ...View3dUnits.hcyl(view, item, box)];
    if (item.kind === 'dgu') return [...out, ...View3dUnits.dgu(view, item, box)];
    if (item.kind === 'pump') return [...out, ...View3dUnits.pump(view, item, box)];
    if (item.kind === 'dryer' && StationLayout.twinDryer(item)) return [...out, ...View3dUnits.twin(view, item, box)];
    out.push(...View3dUnits.body(view, item, box));
    if (item.kind === 'compressor') View3dUnits.duct(view, item, { ...ctx, b: box, out });
    if (item.kind === 'tank')
      out.push(
        view.vcyl(
          [box.x0 + box.L * 0.2, box.y0 + box.W * 0.5, Math.min(90, box.W * 0.15)],
          [box.z1, box.z1 + 90],
          '#5a6168',
          false,
        ),
      );
    return out;
  }

  /** Стойки рамы шкафа. */
  static frameLegs(view, { x0, y0, z0, L: len, W: wid }, base) {
    return [0.12, 0.82].flatMap(frac =>
      view.box(
        [x0 + len * frac, y0 + wid * 0.3, base],
        [x0 + len * frac + 40, y0 + wid * 0.3 + 40, z0],
        View3dUnits.DARK,
      ),
    );
  }

  /** Фильтр на трубе: корпус вниз и головка. */
  static filter(view, item, { x0, x1, y0, y1, z0, z1, L: len, W: wid, c: color }) {
    return [
      view.vcyl([(x0 + x1) / 2, (y0 + y1) / 2, (Math.min(len, wid) / 2) * 0.8], [z0, z1 - item.h * 0.14], color, false),
      ...view.box([x0, y0 + wid * 0.2, z1 - item.h * 0.14], [x1, y1 - wid * 0.2, z1], RalColor.shade(color, 0.85)),
    ];
  }

  /** Вертикальная ёмкость (у ресивера — на трёх опорах, с выпуклым днищем). */
  static vcyl(view, item, { x0, x1, y0, y1, z0, z1, L: len, W: wid, c: color }) {
    const rec = item.kind === 'receiver';
    const leg = rec ? Math.min(220, item.h * 0.1) : 0;
    const out = [];
    if (leg)
      for (const [dx, dy] of [
        [0.25, 0.3],
        [0.75, 0.3],
        [0.5, 0.85],
      ]) {
        const [x, y] = [x0 + len * dx, y0 + wid * dy];
        out.push(...view.box([x - 25, y - 25, z0], [x + 25, y + 25, z0 + leg + 20], View3dUnits.DARK));
      }
    out.push(view.vcyl([(x0 + x1) / 2, (y0 + y1) / 2, Math.min(len, wid) / 2], [z0 + leg, z1], color, rec));
    return out;
  }

  /** Горизонтальная ёмкость на двух опорах. */
  static hcyl(view, item, { x0, x1, y0, y1, z0, L: len, W: wid, c: color }) {
    const dark = View3dUnits.DARK;
    return [
      ...view.box([x0 + len * 0.15, y0 + wid * 0.2, z0], [x0 + len * 0.22, y1 - wid * 0.2, z0 + item.h * 0.35], dark),
      ...view.box([x0 + len * 0.78, y0 + wid * 0.2, z0], [x0 + len * 0.85, y1 - wid * 0.2, z0 + item.h * 0.35], dark),
      view.hcyl([x0, x1], [(y0 + y1) / 2, z0 + item.h * 0.55, (Math.min(wid, item.h) / 2) * 0.95], color),
    ];
  }

  /** ДГУ: рама; радиатор к дальнему торцу, к торцу у входа (зеркально) или к задней стене (поперёк). */
  static dgu(view, item, box) {
    const baseTop = box.z0 + item.h * 0.12;
    const out = view.box([box.x0, box.y0, box.z0], [box.x1, box.y1, baseTop], View3dUnits.DARK);
    if (item.rad === 'back') return [...out, ...View3dUnits.dguAcross(view, item, box, baseTop)];
    return [...out, ...View3dUnits.dguAlong(view, item, box, baseTop)];
  }

  /** Решётка на лицевой грани (deco для V.box). */
  static grilleOn(view, side, [spanU, spanV], count, col) {
    return (face, wall) => (wall === side ? view.grille(face, spanU, spanV, count, col) : '');
  }

  /** ДГУ поперёк: радиатор у задней стены, генератор — к проходу. */
  static dguAcross(view, item, { x0, x1, y0, y1, z0, z1, L: len, W: wid, c: color }, baseTop) {
    const grille = View3dUnits.grilleOn(
      view,
      'front',
      [
        [0.15, 0.85],
        [0.25, 0.7],
      ],
      5,
      RalColor.shade(color, 0.55),
    );
    return [
      ...view.box([x0 + len * 0.04, y1 - wid * 0.14, baseTop], [x1 - len * 0.04, y1, z1], RalColor.shade(color, 0.75)),
      ...view.box(
        [x0 + len * 0.1, y0 + wid * 0.36, baseTop],
        [x1 - len * 0.1, y1 - wid * 0.14, z0 + item.h * 0.82],
        color,
      ),
      ...view.box(
        [x0 + len * 0.14, y0 + wid * 0.04, baseTop],
        [x1 - len * 0.14, y0 + wid * 0.36, z0 + item.h * 0.66],
        RalColor.shade(color, 0.82),
        grille,
      ),
    ];
  }

  /** ДГУ вдоль: доли длины радиатора, двигателя и генератора; у торца входа — зеркально. */
  static ALONG = {
    left: [
      [0, 0.14],
      [0.14, 0.64],
      [0.64, 0.96],
    ],
    right: [
      [0.86, 1],
      [0.36, 0.86],
      [0.04, 0.36],
    ],
  };

  /** ДГУ вдоль: радиатор, двигатель с пультом, генератор; у торца входа — зеркально (радиатор слева). */
  static dguAlong(view, item, { x0, x1, y0, y1, z0, z1, L: len, W: wid, c: color }, baseTop) {
    const left = item.rad === 'left';
    const atX = frac => (frac === 1 ? x1 : x0 + len * frac);
    const [rad, eng, gen] = View3dUnits.ALONG[left ? 'left' : 'right'];
    const { grid, pult, fan } = View3dUnits._alongDecor(view, left, color);
    return [
      ...view.box(
        [atX(rad[0]), y0 + wid * 0.04, baseTop],
        [atX(rad[1]), y1 - wid * 0.04, z1],
        RalColor.shade(color, 0.75),
        grid,
      ),
      ...view.box(
        [atX(eng[0]), y0 + wid * 0.1, baseTop],
        [atX(eng[1]), y1 - wid * 0.1, z0 + item.h * 0.82],
        color,
        pult,
      ),
      ...view.box(
        [atX(gen[0]), y0 + wid * 0.14, baseTop],
        [atX(gen[1]), y1 - wid * 0.14, z0 + item.h * 0.66],
        RalColor.shade(color, 0.82),
        fan,
      ),
    ];
  }

  static _alongDecor(view, left, color) {
    const grid = View3dUnits.grilleOn(
      view,
      left ? 'left' : 'front',
      [
        [0.12, 0.88],
        [0.1, 0.9],
      ],
      7,
      '#2d3238',
    );
    const pult = (face, side) =>
      side === 'front'
        ? view.rectOn(face, left ? [0.42, 0.8] : [0.08, 0.2], [0.5, 0.75], RalColor.shade(color, 0.8))
        : '';
    const fan = View3dUnits.grilleOn(
      view,
      'front',
      [
        [0.15, 0.85],
        [0.25, 0.7],
      ],
      5,
      RalColor.shade(color, 0.55),
    );
    return { grid, pult, fan };
  }

  /** Насос: рама, двигатель с рёбрами, корпус насоса. */
  static pump(view, item, { x0, x1, y0, y1, z0, L: len, W: wid, c: color }) {
    const baseTop = z0 + Math.min(120, item.h * 0.15);
    const grille = View3dUnits.grilleOn(
      view,
      'front',
      [
        [0.1, 0.9],
        [0.2, 0.8],
      ],
      6,
      RalColor.shade(color, 0.7),
    );
    return [
      ...view.box([x0, y0, z0], [x1, y1, baseTop], View3dUnits.DARK),
      ...view.box(
        [x0 + len * 0.42, y0 + wid * 0.18, baseTop],
        [x1 - len * 0.04, y1 - wid * 0.18, z0 + item.h * 0.85],
        color,
        grille,
      ),
      ...view.box(
        [x0 + len * 0.04, y0 + wid * 0.12, baseTop],
        [x0 + len * 0.42, y1 - wid * 0.12, z0 + item.h * 0.75],
        '#6b7886',
      ),
    ];
  }

  /** Адсорбционный осушитель: две колонны на раме, коллекторы, блок управления. */
  static twin(view, item, { x0, x1, y0, y1, z0, z1, L: len, W: wid, c: color }) {
    const baseTop = z0 + Math.min(100, item.h * 0.07);
    const radius = Math.min(len / 4.6, wid / 2.3);
    const midY = (y0 + y1) / 2;
    const dark = RalColor.shade(color, 0.55);
    return [
      ...view.box([x0, y0, z0], [x1, y1, baseTop], View3dUnits.DARK),
      ...view.box(
        [x0 + len * 0.18, midY - wid * 0.08, baseTop + item.h * 0.04],
        [x1 - len * 0.18, midY + wid * 0.08, baseTop + item.h * 0.12],
        dark,
      ),
      ...[0.27, 0.73].map(frac =>
        view.vcyl([x0 + len * frac, midY, radius], [baseTop, z1 - item.h * 0.1], color, true),
      ),
      ...view.box(
        [x0 + len * 0.18, midY - wid * 0.08, z1 - item.h * 0.1],
        [x1 - len * 0.18, midY + wid * 0.08, z1],
        dark,
      ),
      ...view.box(
        [x0 + len * 0.4, y0, z0 + item.h * 0.45],
        [x1 - len * 0.4, y0 + wid * 0.18, z0 + item.h * 0.7],
        '#d8dcdf',
      ),
    ];
  }

  /** Корпус на цоколе: окраска частей по фото (как в карточке товара) и детали лицевой стороны. */
  static body(view, item, { x0, x1, y0, y1, z0, z1, c: color }) {
    const baseTop = z0 + Math.min(80, item.h * 0.06);
    const baseV = (baseTop - z0) / item.h;
    const tones = (item.tones || []).filter(tone => tone.v1 - Math.max(baseV, tone.v0) >= 0.02);
    const full = tone => tone.u0 <= 0.001 && tone.u1 >= 0.999;
    const zone = (face, side) =>
      tones
        .filter(tone => side === 'front' || full(tone))
        .map(tone => {
          const span = [(Math.max(baseV, tone.v0) - baseV) / (1 - baseV), (tone.v1 - baseV) / (1 - baseV)];
          return side === 'front'
            ? view.rectOn(face, [tone.u0, tone.u1], span, tone.hex)
            : view.rectOn(face, [0, 1], span, RalColor.shade(tone.hex, 0.8));
        })
        .join('');
    const out = [
      ...view.box([x0, y0, z0], [x1, y1, baseTop], RalColor.shade(color, 0.6)),
      ...view.box(
        [x0, y0, baseTop],
        [x1, y1, z1],
        color,
        (face, side) => zone(face, side) + View3dUnits.deco(view, item, face, side),
      ),
    ];
    const top = tones.find(tone => full(tone) && tone.v1 >= 0.999);
    if (top)
      out.push(
        view.face(
          [
            [x0, y0, z1],
            [x1, y0, z1],
            [x1, y1, z1],
            [x0, y1, z1],
          ],
          RalColor.shade(top.hex, RalColor.light(top.hex) < 0.3 ? 1.25 : 1.1),
          1,
        ),
      );
    return out;
  }

  /** Жалюзи компрессора, сведённые по стенам. */
  static louvers(item, station) {
    const vent = station && station.vent;
    const key = StationLayout.key(item);
    const target = vent && vent.ducts ? vent.ducts[key] : 'wall';
    const list = vent && target === 'wall' ? (vent.louvers || []).filter(louver => louver.duct === key) : [];
    const grp = [...new Set(list.map(louver => louver.wall))].map(wall => {
      const same = list.filter(louver => louver.wall === wall);
      return { wall, u0: Math.min(...same.map(louver => louver.u0)), u1: Math.max(...same.map(louver => louver.u1)) };
    });
    return { to: target, grp };
  }

  /** Воздуховод отвода горячего воздуха — под потолком к его жалюзи (короб к каждой стене) или вверх через крышу. */
  static duct(view, item, { ceil, yWall, at: station, b: box, out }) {
    const { x0, x1, y0, y1, z1, L: len, W: wid } = box;
    const ductH = Math.min(380, ceil - 90 - z1 - 60);
    if (ductH < 180) return;
    const duct = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, dw: Math.min(len * 0.45, 900), dd: Math.min(wid * 0.45, 650) };
    const { cx: midX, cy: midY, dw: ductW, dd: ductD } = duct;
    const topZ = ceil - 90;
    const ductZ = topZ - ductH;
    const gal = '#c3c9cf';
    const { to: target, grp } = View3dUnits.louvers(item, station);
    if (target === 'roof') {
      out.push(...view.box([midX - ductW / 2, midY - ductD / 2, z1], [midX + ductW / 2, midY + ductD / 2, ceil], gal));
      return;
    }
    if (!grp.length)
      out.unshift(
        view.louver(
          [midX - ductW / 2 - 70, yWall - 2, ductZ - 70],
          [midX + ductW / 2 + 70, yWall - 2, Math.min(ceil, topZ + 70)],
          'y',
        ),
      );
    out.push(...view.box([midX - ductW / 2, midY - ductD / 2, z1], [midX + ductW / 2, midY + ductD / 2, ductZ], gal));
    const walls = grp.length
      ? grp
      : [{ wall: 'back', u0: midX - ductW / 2 - station.ox, u1: midX + ductW / 2 - station.ox }];
    for (const group of walls)
      out.push(...View3dUnits.run(view, group, { ...duct, z: [ductZ, topZ], yWall, at: station }));
  }

  /** Короб по потолку к стене Lv: к торцу — вдоль контейнера, затем вдоль торца; к длинной стене — поперёк. */
  static run(view, group, { cx: midX, cy: midY, dw: ductW, dd: ductD, z: [ductZ, topZ], yWall, at: station }) {
    const gal = '#c3c9cf';
    if (group.wall === 'left' || group.wall === 'right') {
      const isRight = group.wall === 'right';
      const wallX = isRight ? station.ox + station.Li : station.ox + station.x0;
      const [from, till] = [station.oy + group.u0, station.oy + group.u1];
      return [
        ...view.box(
          [Math.min(midX - ductW / 2, wallX), midY - ductD / 2, ductZ],
          [Math.max(midX + ductW / 2, wallX), midY + ductD / 2, topZ],
          gal,
        ),
        ...view.box(
          [isRight ? wallX - ductW : wallX, Math.min(midY - ductD / 2, from), ductZ],
          [isRight ? wallX : wallX + ductW, Math.max(midY + ductD / 2, till), topZ],
          gal,
        ),
      ];
    }
    const wallY = group.wall === 'front' ? station.oy : yWall;
    const from = Math.min(midX - ductW / 2, station.ox + group.u0);
    const till = Math.max(midX + ductW / 2, station.ox + group.u1);
    return view.box(
      [from, Math.min(midY - ductD / 2, wallY), ductZ],
      [till, Math.max(midY + ductD / 2, wallY), topZ],
      gal,
    );
  }

  /** Детали лицевой стороны: пульт, решётки, двери шкафа. */
  static deco(view, item, face, side) {
    const color = item.color;
    const dark = RalColor.shade(color, 0.62);
    if (side !== 'front')
      return side === 'left' && /compressor|dryer/.test(item.kind)
        ? view.grille(face, [0.25, 0.75], [0.3, 0.7], 6, dark)
        : '';
    if (item.kind === 'compressor')
      return (
        view.rectOn(face, [0.06, 0.24], [0.62, 0.86], '#2b3440') +
        view.rectOn(face, [0.085, 0.215], [0.69, 0.81], '#7fb8e3') +
        view.grille(face, [0.52, 0.92], [0.22, 0.72], 8, dark)
      );
    if (item.kind === 'dryer')
      return (
        view.rectOn(face, [0.08, 0.3], [0.68, 0.84], '#2b3440') + view.grille(face, [0.1, 0.9], [0.12, 0.48], 6, dark)
      );
    if (item.kind === 'cabinet')
      return (
        view.lineOn(face, [0.5, 0.04], [0.5, 0.96], dark, 1.4) +
        view.rectOn(face, [0.43, 0.47], [0.46, 0.56], '#3b4148') +
        view.rectOn(face, [0.53, 0.57], [0.46, 0.56], '#3b4148') +
        view.rectOn(face, [0.12, 0.38], [0.8, 0.9], RalColor.shade(color, 0.85))
      );
    if (item.kind === 'filter') return view.rectOn(face, [0.1, 0.9], [0.82, 0.92], dark);
    return view.rectOn(face, [0.1, 0.3], [0.7, 0.85], RalColor.shade(color, 0.8));
  }
}
