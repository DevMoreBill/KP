import { RalColor } from '../layout/ral-color.js';
import { StationLayout } from '../layout/station-layout.js';

/** Оборудование на SVG-виде станции: короба, цилиндры, ДГУ, насосы, воздуховоды компрессоров. */
export class View3dUnits {
  static DARK = '#3a3f45';

  /** Верх оборудования, каким оно нарисовано (насос — ниже габарита, горизонтальная ёмкость — на опорах). */
  static top(it) {
    if (it.kind === 'pump') return it.h * 0.85;
    if (it.shape === 'hcyl') return it.h * 0.55 + (Math.min(it.ly, it.h) / 2) * 0.95;
    return it.h;
  }

  /** Габарит изделия на виде: углы, размеры, цвет. */
  static frame(it, base) {
    const z0 = base + (it.z || 0);
    return {
      x0: it.X0,
      x1: it.X1,
      y0: it.Y0,
      y1: it.Y1,
      z0,
      z1: z0 + it.h,
      L: it.X1 - it.X0,
      W: it.Y1 - it.Y0,
      c: it.color,
    };
  }

  /** Оборудование на виде; ctx — {base, ceil, yWall, at}. */
  static equip(V, it, ctx) {
    const b = View3dUnits.frame(it, ctx.base);
    const out = it.mount === 'frame' ? View3dUnits.frameLegs(V, b, ctx.base) : [];
    if (it.mount === 'pipe') return [...out, ...View3dUnits.filter(V, it, b)];
    if (it.shape === 'vcyl') return [...out, ...View3dUnits.vcyl(V, it, b)];
    if (it.shape === 'hcyl') return [...out, ...View3dUnits.hcyl(V, it, b)];
    if (it.kind === 'dgu') return [...out, ...View3dUnits.dgu(V, it, b)];
    if (it.kind === 'pump') return [...out, ...View3dUnits.pump(V, it, b)];
    if (it.kind === 'dryer' && StationLayout.twinDryer(it)) return [...out, ...View3dUnits.twin(V, it, b)];
    out.push(...View3dUnits.body(V, it, b));
    if (it.kind === 'compressor') View3dUnits.duct(V, it, { ...ctx, b, out });
    if (it.kind === 'tank')
      out.push(
        V.vcyl([b.x0 + b.L * 0.2, b.y0 + b.W * 0.5, Math.min(90, b.W * 0.15)], [b.z1, b.z1 + 90], '#5a6168', false),
      );
    return out;
  }

  /** Стойки рамы шкафа. */
  static frameLegs(V, { x0, y0, z0, L, W }, base) {
    return [0.12, 0.82].flatMap(f =>
      V.box([x0 + L * f, y0 + W * 0.3, base], [x0 + L * f + 40, y0 + W * 0.3 + 40, z0], View3dUnits.DARK),
    );
  }

  /** Фильтр на трубе: корпус вниз и головка. */
  static filter(V, it, { x0, x1, y0, y1, z0, z1, L, W, c }) {
    return [
      V.vcyl([(x0 + x1) / 2, (y0 + y1) / 2, (Math.min(L, W) / 2) * 0.8], [z0, z1 - it.h * 0.14], c, false),
      ...V.box([x0, y0 + W * 0.2, z1 - it.h * 0.14], [x1, y1 - W * 0.2, z1], RalColor.shade(c, 0.85)),
    ];
  }

  /** Вертикальная ёмкость (у ресивера — на трёх опорах, с выпуклым днищем). */
  static vcyl(V, it, { x0, x1, y0, y1, z0, z1, L, W, c }) {
    const rec = it.kind === 'receiver';
    const leg = rec ? Math.min(220, it.h * 0.1) : 0;
    const out = [];
    if (leg)
      for (const [dx, dy] of [
        [0.25, 0.3],
        [0.75, 0.3],
        [0.5, 0.85],
      ]) {
        const [x, y] = [x0 + L * dx, y0 + W * dy];
        out.push(...V.box([x - 25, y - 25, z0], [x + 25, y + 25, z0 + leg + 20], View3dUnits.DARK));
      }
    out.push(V.vcyl([(x0 + x1) / 2, (y0 + y1) / 2, Math.min(L, W) / 2], [z0 + leg, z1], c, rec));
    return out;
  }

  /** Горизонтальная ёмкость на двух опорах. */
  static hcyl(V, it, { x0, x1, y0, y1, z0, L, W, c }) {
    const D = View3dUnits.DARK;
    return [
      ...V.box([x0 + L * 0.15, y0 + W * 0.2, z0], [x0 + L * 0.22, y1 - W * 0.2, z0 + it.h * 0.35], D),
      ...V.box([x0 + L * 0.78, y0 + W * 0.2, z0], [x0 + L * 0.85, y1 - W * 0.2, z0 + it.h * 0.35], D),
      V.hcyl([x0, x1], [(y0 + y1) / 2, z0 + it.h * 0.55, (Math.min(W, it.h) / 2) * 0.95], c),
    ];
  }

  /** ДГУ: рама; радиатор к дальнему торцу, к торцу у входа (зеркально) или к задней стене (поперёк). */
  static dgu(V, it, b) {
    const fb = b.z0 + it.h * 0.12;
    const out = V.box([b.x0, b.y0, b.z0], [b.x1, b.y1, fb], View3dUnits.DARK);
    if (it.rad === 'back') return [...out, ...View3dUnits.dguAcross(V, it, b, fb)];
    return [...out, ...View3dUnits.dguAlong(V, it, b, fb)];
  }

  /** Решётка на лицевой грани (deco для V.box). */
  static grilleOn(V, side, [u, v], n, col) {
    return (f, F) => (F === side ? V.grille(f, u, v, n, col) : '');
  }

  /** ДГУ поперёк: радиатор у задней стены, генератор — к проходу. */
  static dguAcross(V, it, { x0, x1, y0, y1, z0, z1, L, W, c }, fb) {
    const g = View3dUnits.grilleOn(
      V,
      'front',
      [
        [0.15, 0.85],
        [0.25, 0.7],
      ],
      5,
      RalColor.shade(c, 0.55),
    );
    return [
      ...V.box([x0 + L * 0.04, y1 - W * 0.14, fb], [x1 - L * 0.04, y1, z1], RalColor.shade(c, 0.75)),
      ...V.box([x0 + L * 0.1, y0 + W * 0.36, fb], [x1 - L * 0.1, y1 - W * 0.14, z0 + it.h * 0.82], c),
      ...V.box(
        [x0 + L * 0.14, y0 + W * 0.04, fb],
        [x1 - L * 0.14, y0 + W * 0.36, z0 + it.h * 0.66],
        RalColor.shade(c, 0.82),
        g,
      ),
    ];
  }

  /** ДГУ вдоль: радиатор, двигатель с пультом, генератор; у торца входа — зеркально (радиатор слева). */
  static dguAlong(V, it, { x0, x1, y0, y1, z0, z1, L, W, c }, fb) {
    const left = it.rad === 'left';
    const X = u => (u === 1 ? x1 : x0 + L * u);
    const [rad, eng, gen] = left
      ? [
          [0, 0.14],
          [0.14, 0.64],
          [0.64, 0.96],
        ]
      : [
          [0.86, 1],
          [0.36, 0.86],
          [0.04, 0.36],
        ];
    const grid = View3dUnits.grilleOn(
      V,
      left ? 'left' : 'front',
      [
        [0.12, 0.88],
        [0.1, 0.9],
      ],
      7,
      '#2d3238',
    );
    const pult = (f, F) =>
      F === 'front' ? V.rectOn(f, left ? [0.42, 0.8] : [0.08, 0.2], [0.5, 0.75], RalColor.shade(c, 0.8)) : '';
    const fan = View3dUnits.grilleOn(
      V,
      'front',
      [
        [0.15, 0.85],
        [0.25, 0.7],
      ],
      5,
      RalColor.shade(c, 0.55),
    );
    return [
      ...V.box([X(rad[0]), y0 + W * 0.04, fb], [X(rad[1]), y1 - W * 0.04, z1], RalColor.shade(c, 0.75), grid),
      ...V.box([X(eng[0]), y0 + W * 0.1, fb], [X(eng[1]), y1 - W * 0.1, z0 + it.h * 0.82], c, pult),
      ...V.box(
        [X(gen[0]), y0 + W * 0.14, fb],
        [X(gen[1]), y1 - W * 0.14, z0 + it.h * 0.66],
        RalColor.shade(c, 0.82),
        fan,
      ),
    ];
  }

  /** Насос: рама, двигатель с рёбрами, корпус насоса. */
  static pump(V, it, { x0, x1, y0, y1, z0, L, W, c }) {
    const fb = z0 + Math.min(120, it.h * 0.15);
    const g = View3dUnits.grilleOn(
      V,
      'front',
      [
        [0.1, 0.9],
        [0.2, 0.8],
      ],
      6,
      RalColor.shade(c, 0.7),
    );
    return [
      ...V.box([x0, y0, z0], [x1, y1, fb], View3dUnits.DARK),
      ...V.box([x0 + L * 0.42, y0 + W * 0.18, fb], [x1 - L * 0.04, y1 - W * 0.18, z0 + it.h * 0.85], c, g),
      ...V.box([x0 + L * 0.04, y0 + W * 0.12, fb], [x0 + L * 0.42, y1 - W * 0.12, z0 + it.h * 0.75], '#6b7886'),
    ];
  }

  /** Адсорбционный осушитель: две колонны на раме, коллекторы, блок управления. */
  static twin(V, it, { x0, x1, y0, y1, z0, z1, L, W, c }) {
    const fb = z0 + Math.min(100, it.h * 0.07);
    const r = Math.min(L / 4.6, W / 2.3);
    const yc = (y0 + y1) / 2;
    const dk = RalColor.shade(c, 0.55);
    return [
      ...V.box([x0, y0, z0], [x1, y1, fb], View3dUnits.DARK),
      ...V.box([x0 + L * 0.18, yc - W * 0.08, fb + it.h * 0.04], [x1 - L * 0.18, yc + W * 0.08, fb + it.h * 0.12], dk),
      ...[0.27, 0.73].map(u => V.vcyl([x0 + L * u, yc, r], [fb, z1 - it.h * 0.1], c, true)),
      ...V.box([x0 + L * 0.18, yc - W * 0.08, z1 - it.h * 0.1], [x1 - L * 0.18, yc + W * 0.08, z1], dk),
      ...V.box([x0 + L * 0.4, y0, z0 + it.h * 0.45], [x1 - L * 0.4, y0 + W * 0.18, z0 + it.h * 0.7], '#d8dcdf'),
    ];
  }

  /** Корпус на цоколе: окраска частей по фото (как в карточке товара) и детали лицевой стороны. */
  static body(V, it, { x0, x1, y0, y1, z0, z1, c }) {
    const zb = z0 + Math.min(80, it.h * 0.06);
    const vb = (zb - z0) / it.h;
    const T = (it.tones || []).filter(t => t.v1 - Math.max(vb, t.v0) >= 0.02);
    const full = t => t.u0 <= 0.001 && t.u1 >= 0.999;
    const zone = (f, F) =>
      T.filter(t => F === 'front' || full(t))
        .map(t => {
          const v = [(Math.max(vb, t.v0) - vb) / (1 - vb), (t.v1 - vb) / (1 - vb)];
          return F === 'front'
            ? V.rectOn(f, [t.u0, t.u1], v, t.hex)
            : V.rectOn(f, [0, 1], v, RalColor.shade(t.hex, 0.8));
        })
        .join('');
    const out = [
      ...V.box([x0, y0, z0], [x1, y1, zb], RalColor.shade(c, 0.6)),
      ...V.box([x0, y0, zb], [x1, y1, z1], c, (f, F) => zone(f, F) + View3dUnits.deco(V, it, f, F)),
    ];
    const top = T.find(t => full(t) && t.v1 >= 0.999);
    if (top)
      out.push(
        V.face(
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
  static louvers(it, at) {
    const Vt = at && at.vent;
    const kk = StationLayout.key(it);
    const to = Vt && Vt.ducts ? Vt.ducts[kk] : 'wall';
    const Ls = Vt && to === 'wall' ? (Vt.louvers || []).filter(q => q.duct === kk) : [];
    const grp = [...new Set(Ls.map(q => q.wall))].map(w => {
      const G = Ls.filter(q => q.wall === w);
      return { wall: w, u0: Math.min(...G.map(q => q.u0)), u1: Math.max(...G.map(q => q.u1)) };
    });
    return { to, grp };
  }

  /** Воздуховод отвода горячего воздуха — под потолком к его жалюзи (короб к каждой стене) или вверх через крышу. */
  static duct(V, it, { ceil, yWall, at, b, out }) {
    const { x0, x1, y0, y1, z1, L, W } = b;
    const dh = Math.min(380, ceil - 90 - z1 - 60);
    if (dh < 180) return;
    const d = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, dw: Math.min(L * 0.45, 900), dd: Math.min(W * 0.45, 650) };
    const { cx, cy, dw, dd } = d;
    const zt = ceil - 90;
    const zd = zt - dh;
    const gal = '#c3c9cf';
    const { to, grp } = View3dUnits.louvers(it, at);
    if (to === 'roof') {
      out.push(...V.box([cx - dw / 2, cy - dd / 2, z1], [cx + dw / 2, cy + dd / 2, ceil], gal));
      return;
    }
    if (!grp.length)
      out.unshift(
        V.louver([cx - dw / 2 - 70, yWall - 2, zd - 70], [cx + dw / 2 + 70, yWall - 2, Math.min(ceil, zt + 70)], 'y'),
      );
    out.push(...V.box([cx - dw / 2, cy - dd / 2, z1], [cx + dw / 2, cy + dd / 2, zd], gal));
    const walls = grp.length ? grp : [{ wall: 'back', u0: cx - dw / 2 - at.ox, u1: cx + dw / 2 - at.ox }];
    for (const Lv of walls) out.push(...View3dUnits.run(V, Lv, { ...d, z: [zd, zt], yWall, at }));
  }

  /** Короб по потолку к стене Lv: к торцу — вдоль контейнера, затем вдоль торца; к длинной стене — поперёк. */
  static run(V, Lv, { cx, cy, dw, dd, z: [zd, zt], yWall, at }) {
    const gal = '#c3c9cf';
    if (Lv.wall === 'left' || Lv.wall === 'right') {
      const rt = Lv.wall === 'right';
      const xW = rt ? at.ox + at.Li : at.ox + at.x0;
      const [a, b] = [at.oy + Lv.u0, at.oy + Lv.u1];
      return [
        ...V.box([Math.min(cx - dw / 2, xW), cy - dd / 2, zd], [Math.max(cx + dw / 2, xW), cy + dd / 2, zt], gal),
        ...V.box(
          [rt ? xW - dw : xW, Math.min(cy - dd / 2, a), zd],
          [rt ? xW : xW + dw, Math.max(cy + dd / 2, b), zt],
          gal,
        ),
      ];
    }
    const yw = Lv.wall === 'front' ? at.oy : yWall;
    const a = Math.min(cx - dw / 2, at.ox + Lv.u0);
    const b = Math.max(cx + dw / 2, at.ox + Lv.u1);
    return V.box([a, Math.min(cy - dd / 2, yw), zd], [b, Math.max(cy + dd / 2, yw), zt], gal);
  }

  /** Детали лицевой стороны: пульт, решётки, двери шкафа. */
  static deco(V, it, f, F) {
    const c = it.color;
    const dk = RalColor.shade(c, 0.62);
    if (F !== 'front')
      return F === 'left' && /compressor|dryer/.test(it.kind) ? V.grille(f, [0.25, 0.75], [0.3, 0.7], 6, dk) : '';
    if (it.kind === 'compressor')
      return (
        V.rectOn(f, [0.06, 0.24], [0.62, 0.86], '#2b3440') +
        V.rectOn(f, [0.085, 0.215], [0.69, 0.81], '#7fb8e3') +
        V.grille(f, [0.52, 0.92], [0.22, 0.72], 8, dk)
      );
    if (it.kind === 'dryer')
      return V.rectOn(f, [0.08, 0.3], [0.68, 0.84], '#2b3440') + V.grille(f, [0.1, 0.9], [0.12, 0.48], 6, dk);
    if (it.kind === 'cabinet')
      return (
        V.lineOn(f, [0.5, 0.04], [0.5, 0.96], dk, 1.4) +
        V.rectOn(f, [0.43, 0.47], [0.46, 0.56], '#3b4148') +
        V.rectOn(f, [0.53, 0.57], [0.46, 0.56], '#3b4148') +
        V.rectOn(f, [0.12, 0.38], [0.8, 0.9], RalColor.shade(c, 0.85))
      );
    if (it.kind === 'filter') return V.rectOn(f, [0.1, 0.9], [0.82, 0.92], dk);
    return V.rectOn(f, [0.1, 0.3], [0.7, 0.85], RalColor.shade(c, 0.8));
  }
}
