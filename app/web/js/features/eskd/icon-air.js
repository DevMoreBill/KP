import { EskdSheet } from './eskd-sheet.js';
import { IconParts } from './icon-parts.js';

/** Рисунки компрессорного оборудования: компрессоры, ресиверы, осушители, фильтры (спереди и сверху). */
export class IconAir {
  /** Винтовой (спиральный) компрессор в шумозащитном кожухе; tankH — высота ресивера под ним. */
  static screw(c, tankH = 0) {
    const { sh, S, x0, x1, w } = c;
    const y0 = c.y0;
    const y1 = c.y1 - tankH;
    const h = y1 - y0;
    if (Math.min(w, h) < 3) {
      sh.rect([x0, y0, w, h], 'main', '#fff');
      return;
    }
    const hb = Math.min(S(110, 0.7), h * 0.12);
    const yb = y1 - hb;
    const H = yb - y0;
    if (!tankH) IconParts.skid(sh, [x0, x1], [yb, y1], S);
    else sh.rect([x0, yb, w, hb], 'main', '#fff');
    sh.rect([x0, y0, w, H], 'main', '#fff');
    sh.line(x0, y0 + S(45, 0.35), x1, y0 + S(45, 0.35), 'thin'); // кромка крыши
    let n = c.it.lx >= 1700 ? 3 : 2;
    if (w < 6) n = 1;
    const pw = w / n;
    for (let i = 1; i < n; i++) sh.line(x0 + pw * i, y0 + S(45, 0.35), x0 + pw * i, yb, 'thin'); // стыки панелей
    const g = { top: y0, H, yb, n, pw };
    if (c.rear || c.side) IconAir.screwBack(c, g);
    else {
      if (h > 8) IconAir.locks(c, g);
      IconAir.screwFront(c, g);
    }
  }

  /** Сзади и сбоку — решётка охладителя (рёбра) и жалюзи забора воздуха. */
  static screwBack(c, { top, H, yb }) {
    const { sh, S, x0, x1, w } = c;
    const gx0 = x0 + w * 0.12;
    const gx1 = x1 - w * 0.12;
    const gy0 = top + H * 0.12;
    const gy1 = top + H * (c.side ? 0.5 : 0.62);
    sh.rect([gx0, gy0, gx1 - gx0, gy1 - gy0], 'thin', '#fff');
    IconParts.fins(sh, [gx0, gy0, gx1, gy1], S(28), true);
    IconParts.louver(sh, [gx0, top + H * 0.68, gx1, yb - H * 0.08], S(45));
  }

  /** Замки панелей — у стыков (у одной панели — у края). */
  static locks(c, { top, H, n, pw }) {
    const { sh, S, x0 } = c;
    for (let i = 0; i < n; i++) {
      if (!(i < n - 1 || n === 1)) continue;
      const lx = x0 + pw * (i + 1) - S(70, 0.6);
      for (const fy of [0.2, 0.8])
        sh.rect([lx - S(15, 0.15), top + H * fy - S(35, 0.35), S(30, 0.3), S(70, 0.7)], 'thin');
    }
  }

  /** Спереди: пульт (дисплей, кнопки, аварийная кнопка), жалюзи забора воздуха — под пультом и на соседних панелях. */
  static screwFront(c, { top, H, yb, n, pw }) {
    const { sh, S, x0, x1 } = c;
    const cw = Math.min(S(430, 2.4), pw * 0.72);
    const ch = Math.min(S(300, 1.8), H * 0.26);
    const cx0 = x1 - pw / 2 - cw / 2;
    const cy0 = top + Math.max(S(140, 0.9), H * 0.08);
    sh.rect([cx0, cy0, cw, ch], 'thin', '#fff', S(20));
    sh.rect([cx0 + cw * 0.1, cy0 + ch * 0.14, cw * 0.48, ch * 0.42], 'thin', IconParts.DARK); // дисплей
    for (const fx of [0.16, 0.32, 0.48])
      sh.circle(cx0 + cw * fx, cy0 + ch * 0.78, Math.min(ch * 0.09, S(18, 0.18)), 'thin');
    const er = Math.min(ch * 0.2, S(40, 0.3));
    sh.circle(cx0 + cw * 0.8, cy0 + ch * 0.42, er, 'thin', '#fff');
    sh.circle(cx0 + cw * 0.8, cy0 + ch * 0.42, er * 0.55, 'thin'); // аварийная
    const step = S(45);
    IconParts.louver(sh, [x1 - pw + pw * 0.12, cy0 + ch + H * 0.1, x1 - pw * 0.12, yb - H * 0.1], step);
    if (n > 1) IconParts.louver(sh, [x0 + pw * 0.12, top + H * 0.32, x0 + pw * 0.88, yb - H * 0.1], step);
    if (n > 2) IconParts.louver(sh, [x0 + pw * 1.12, top + H * 0.32, x0 + pw * 1.88, yb - H * 0.1], step);
  }

  /** Компрессор на горизонтальном ресивере: внизу — ресивер на опорах, на нём кожух. */
  static tankMounted(c) {
    const th = Math.min(c.h * 0.42, c.S(650));
    const y = c.y1 - th;
    this.htank(c, c.x0, y, c.x1, c.y1);
    this.screw(Object.assign({}, c, { y1: c.y1 }), th);
  }
  /** Горизонтальный ресивер под компрессором: обечайка на опорах, кран слива. */
  static htank(c, x0, y0, x1, y1) {
    const { sh, S } = c;
    const w = x1 - x0;
    const hl = Math.min((y1 - y0) * 0.22, S(140, 0.6));
    const yb = y1 - hl;
    for (const f of [0.18, 0.82]) {
      const lw = Math.max(0.6, S(70));
      sh.rect([x0 + w * f - lw / 2, yb - 0.4, lw, hl + 0.4], 'thin', '#fff');
      sh.rect([x0 + w * f - lw * 1.1, y1 - Math.max(0.25, S(15)), lw * 2.2, Math.max(0.25, S(15))], 'thin', '#fff');
    }
    IconParts.hshell(sh, [x0 + w * 0.02, y0, x1 - w * 0.02, yb]);
    IconParts.shade(sh, [x0 + w * 0.12, y0, x1 - w * 0.12, yb], false);
    IconParts.ball(sh, x0 + w * 0.5, yb + Math.max(0.5, S(45)), S(40), true);
  }
  /** Поршневой компрессор на ресивере: двигатель, кожух ремня, головка с оребрёнными цилиндрами. */
  static piston(c) {
    const { sh, S, x0, w, h } = c;
    const th = Math.min(h * 0.45, S(560, 3));
    const ty = c.y1 - th;
    IconAir.htank(c, c.x0, ty, c.x1, c.y1);
    if (h - th < 2.5) return;
    const pl = ty + Math.max(0.3, S(20));
    const top = c.y0;
    const H = pl - top;
    // площадка на ресивере
    sh.rect([x0 + w * 0.08, pl - Math.max(0.35, S(30)), w * 0.84, Math.max(0.35, S(30))], 'thin', '#fff');
    const p0 = pl - Math.max(0.35, S(30));
    // кожух ремённой передачи — слева, во всю высоту
    const gw = Math.max(1.2, w * 0.16);
    sh.rect([x0 + w * 0.06, top + H * 0.05, gw, p0 - top - H * 0.05], 'main', '#fff', gw * 0.35);
    for (let y = top + H * 0.18; y < p0 - H * 0.1; y += Math.max(0.6, S(40)))
      sh.line(x0 + w * 0.06 + gw * 0.2, y, x0 + w * 0.06 + gw * 0.8, y, 'fine');
    IconAir.motor(c, [x0 + w * 0.06 + gw + w * 0.02, x0 + w * 0.5], H, p0);
    IconAir.head(c, { H, p0, ty });
  }

  /** Двигатель — справа от кожуха, низко: рёбра вдоль оси, клеммная коробка. */
  static motor(c, [mx0, mx1], H, p0) {
    const { sh, S } = c;
    const mh = Math.min(H * 0.45, S(320, 1.5));
    const my0 = p0 - mh;
    sh.rect([mx0, my0, mx1 - mx0, mh], 'main', '#fff', mh * 0.2);
    IconParts.fins(sh, [mx0 + mh * 0.2, my0 + mh * 0.12, mx1 - mh * 0.2, p0 - mh * 0.12], S(30), false);
    const bh = Math.max(0.5, S(70));
    sh.rect([mx0 + (mx1 - mx0) * 0.35, my0 - bh, (mx1 - mx0) * 0.3, bh], 'thin', '#fff');
  }

  /** Головка: картер и два цилиндра V-образно с рёбрами; нагнетание в ресивер, реле с манометром. */
  static head(c, { H, p0, ty }) {
    const { sh, S, x0, x1, w } = c;
    const hx = x0 + w * 0.72;
    const cw = Math.max(1, w * 0.13);
    const crank = Math.min(H * 0.3, S(220, 1));
    const cy0 = p0 - crank;
    sh.rect([hx - cw * 1.1, cy0, cw * 2.2, crank], 'main', '#fff', cw * 0.2);
    for (const s of [-1, 1])
      IconAir.cylinder(sh, [hx + s * cw * 0.55, cy0], s * 0.45, { cw, L: Math.min(H * 0.5, S(300, 1.6)) });
    const rx = x1 - w * 0.1;
    const f = EskdSheet.f;
    const yr = cy0 + crank * 0.4;
    sh.path(`M${f(hx + cw * 1.1)},${f(yr)} L${f(rx)},${f(yr)} L${f(rx)},${f(ty)}`, 'thin');
    IconParts.gauge(sh, rx, yr - Math.max(0.6, S(60)), Math.max(0.45, S(45)));
  }

  /** Оребрённый цилиндр от (bx, by) под углом ang к вертикали, длиной L, с фильтром на конце. */
  static cylinder(sh, [bx, by], ang, { cw, L }) {
    const ex = bx + Math.sin(ang) * L;
    const ey = by - Math.cos(ang) * L;
    const nx = Math.cos(ang) * cw * 0.45;
    const ny = Math.sin(ang) * cw * 0.45;
    sh.poly(
      [
        [bx - nx, by - ny],
        [bx + nx, by + ny],
        [ex + nx, ey + ny],
        [ex - nx, ey - ny],
      ],
      'main',
      '#fff',
    );
    for (let t = 0.25; t < 0.95; t += Math.max(0.12, 0.5 / Math.max(1, L))) {
      const px = bx + (ex - bx) * t;
      const py = by + (ey - by) * t;
      sh.line(px - nx * 1.35, py - ny * 1.35, px + nx * 1.35, py + ny * 1.35, 'fine');
    }
    sh.circle(ex + Math.sin(ang) * cw * 0.4, ey - Math.cos(ang) * cw * 0.4, cw * 0.42, 'thin', '#fff');
  }

  /** Вертикальный сосуд на опорах. receiver — люк, табличка, предохранительный клапан и манометр сверху, кран слива; housing — корпус фильтра/сепаратора. */
  static vreceiver(c, kind) {
    const { sh, S, x0, x1, w, h, cx } = c;
    const rec = kind === 'receiver';
    const hl = Math.min(h * 0.14, S(Math.min(320, Math.max(140, c.it.h * 0.1)), 0.8));
    const sb = c.y1 - hl;
    const fit = rec && w > 2.5 ? Math.min(h * 0.12, S(260, 1.6)) : Math.min(h * 0.06, S(80, 0.5));
    const top = c.y0 + fit;
    // опоры с плитами
    for (const f of [0.14, 0.86]) {
      const lx = x0 + w * f;
      const lw = Math.max(0.5, Math.min(w * 0.08, S(60)));
      sh.rect([lx - lw / 2, sb - Math.min(hl, w * 0.18), lw, c.y1 - sb + Math.min(hl, w * 0.18)], 'thin', '#fff');
      sh.rect([lx - lw * 1.2, c.y1 - Math.max(0.25, S(14)), lw * 2.4, Math.max(0.25, S(14))], 'thin', '#fff');
    }
    const ry = IconParts.shell(sh, [x0, top, x1, sb], true);
    IconParts.shade(sh, [x0, top + ry, x1, sb - ry]);
    sh.line(cx, c.y0 - 1.6, cx, c.y1 + 1.2, 'axis');
    if (w < 2.5) return;
    if (rec) IconAir.recvFittings(c, { top, sb, ry, hl });
    else IconAir.housing(c, { top, sb, ry, hl });
  }

  /** Ресивер: табличка, люк, сверху — штуцер с предохранительным клапаном и манометром, снизу — кран слива. */
  static recvFittings(c, { top, sb, ry, hl }) {
    const { sh, S, w, cx } = c;
    const L = sb - top - 2 * ry;
    if (w > 4)
      sh.rect(
        [cx - w * 0.32, top + ry + L * 0.16, Math.min(w * 0.22, S(150)), Math.min(L * 0.08, S(100))],
        'thin',
        '#fff',
      );
    const mr = Math.min(w * 0.17, S(120, 0.6));
    if (L > 4 * mr) IconAir.manhole(sh, [cx, sb - ry - L * 0.22], mr);
    const st = Math.max(0.5, S(70));
    const b = Math.max(0.45, Math.min(S(55), w * 0.12));
    sh.line(cx, top, cx, top - st, 'thin');
    sh.line(cx - b * 1.6, top - st, cx + b * 1.6, top - st, 'thin');
    IconParts.safety(sh, cx + b * 1.6, top - st, b);
    IconParts.gauge(sh, cx - b * 1.6, top - st - b * 0.9, b * 0.85);
    const dy = sb + Math.min(hl * 0.45, Math.max(0.6, S(60)));
    sh.line(cx, sb, cx, dy + b * 0.5, 'thin');
    IconParts.ball(sh, cx, dy, b * 0.8);
  }

  /** Люк: кольцо, крышка, болты. */
  static manhole(sh, [cx, my], mr) {
    sh.circle(cx, my, mr, 'thin', '#fff');
    sh.circle(cx, my, mr * 0.7, 'thin');
    if (mr <= 1.4) return;
    for (let i = 0; i < 8; i++) {
      const t = (i * Math.PI) / 4;
      sh.dot(cx + Math.cos(t) * mr * 0.85, my + Math.sin(t) * mr * 0.85, 0.1);
    }
  }

  /** Корпус фильтра: фланцевая крышка, индикатор перепада, слив. */
  static housing(c, { top, sb, ry, hl }) {
    const { sh, S, x0, w, cx } = c;
    const fl = Math.max(0.4, S(40));
    sh.rect([x0 - fl * 0.6, top + ry * 0.9, w + fl * 1.2, fl], 'thin', '#fff');
    IconParts.gauge(sh, cx + w * 0.22, top - Math.max(0.4, S(30)), Math.max(0.4, Math.min(S(40), w * 0.1)));
    sh.line(cx, sb, cx, sb + Math.min(hl * 0.6, S(80, 0.5)), 'thin');
  }

  /** Горизонтальный сосуд на седловых опорах; receiver — с арматурой сверху и сливом. */
  static hreceiver(c, rec) {
    const { sh, S, x0, x1, w, h } = c;
    const hs = Math.min(h * 0.2, S(220, 0.8));
    const yb = c.y1 - hs;
    const fit = rec && h > 3 ? Math.min(h * 0.18, S(240, 1.4)) : 0;
    const top = c.y0 + fit;
    for (const f of [0.2, 0.8]) {
      const sx = x0 + w * f;
      const sw = Math.max(0.8, w * 0.08);
      sh.poly(
        [
          [sx - sw, c.y1],
          [sx + sw, c.y1],
          [sx + sw * 0.7, yb - 0.4],
          [sx - sw * 0.7, yb - 0.4],
        ],
        'thin',
        '#fff',
      );
    }
    const rx = IconParts.hshell(sh, [x0, top, x1, yb], true);
    IconParts.shade(sh, [x0 + rx, top, x1 - rx, yb], false);
    sh.line(x0 - 1.6, (top + yb) / 2, x1 + 1.6, (top + yb) / 2, 'axis');
    if (!rec || h < 3) return;
    const b = Math.max(0.45, Math.min(S(55), h * 0.1));
    const st = Math.max(0.4, S(60));
    const xa = x0 + w * 0.42;
    sh.line(xa, top, xa, top - st, 'thin');
    sh.line(xa - b * 1.6, top - st, xa + b * 1.6, top - st, 'thin');
    IconParts.safety(sh, xa + b * 1.6, top - st, b);
    IconParts.gauge(sh, xa - b * 1.6, top - st - b * 0.9, b * 0.85);
    if (w > 8)
      sh.rect(
        [x0 + w * 0.62, top + (yb - top) * 0.3, Math.min(w * 0.1, S(150)), Math.min((yb - top) * 0.2, S(100))],
        'thin',
        '#fff',
      ); // табличка
    IconParts.ball(sh, x0 + w * 0.5, yb + Math.min(hs * 0.5, Math.max(0.6, S(60))), b * 0.8, true);
  }

  /** Рефрижераторный осушитель: панель с индикатором точки росы, решётка конденсатора с вентилятором, патрубки. */
  static refrig(c) {
    const { sh, S, x0, x1, w, h } = c;
    if (c.m < 3) {
      sh.rect([x0, c.y0, w, h], 'main', '#fff');
      return;
    }
    const hb = Math.min(S(60, 0.5), h * 0.08);
    const yb = c.y1 - hb;
    const st = Math.min(S(110, 0.8), h * 0.12);
    const top = c.y0 + st;
    const H = yb - top;
    for (const f of [0.25, 0.75]) {
      const pw = Math.max(0.6, S(55));
      sh.rect([x0 + w * f - pw / 2, c.y0, pw, st], 'thin', '#fff');
      sh.rect([x0 + w * f - pw * 0.85, c.y0, pw * 1.7, Math.max(0.25, S(18))], 'thin', '#fff');
    } // вход, выход
    for (const f of [0.1, 0.9])
      sh.rect([x0 + w * f - Math.max(0.4, S(40)), yb, Math.max(0.8, S(80)), hb], 'thin', '#fff'); // опоры
    sh.rect([x0, top, w, H], 'main', '#fff', S(20));
    if (c.rear || c.side) {
      IconParts.perforated(sh, [x0 + w * 0.1, top + H * 0.1, x1 - w * 0.1, yb - H * 0.1], S(32));
      IconParts.fan(sh, (x0 + x1) / 2, top + H / 2, Math.min(w, H) * 0.3);
      return;
    }
    // панель управления сверху: индикатор точки росы, дисплей, выключатель
    const ph = Math.min(H * 0.24, S(200, 1.6));
    sh.rect([x0 + w * 0.06, top + H * 0.05, w * 0.88, ph], 'thin', '#fff');
    const gr = Math.min(ph * 0.36, S(55, 0.5));
    IconParts.gauge(sh, x0 + w * 0.2, top + H * 0.05 + ph / 2, gr);
    sh.circle(x0 + w * 0.2, top + H * 0.05 + ph / 2, gr * 0.7, 'fine');
    sh.rect([x0 + w * 0.36, top + H * 0.05 + ph * 0.3, w * 0.26, ph * 0.4], 'thin', IconParts.DARK);
    sh.rect([x0 + w * 0.74, top + H * 0.05 + ph * 0.3, Math.max(0.5, w * 0.08), ph * 0.4], 'thin');
    // решётка конденсатора (перфорация) и вентилятор
    const gy0 = top + H * 0.05 + ph + H * 0.06;
    const gy1 = yb - H * 0.07;
    IconParts.perforated(sh, [x0 + w * 0.08, gy0, x1 - w * 0.08, gy1], S(32));
    IconParts.fan(sh, (x0 + x1) / 2, (gy0 + gy1) / 2, Math.min(w * 0.84, gy1 - gy0) * 0.4);
  }
  /** Адсорбционный осушитель (генератор): две колонны, коллекторы, клапаны, глушители, блок управления, манометры. */
  static twin(c) {
    const { sh, S, x0, x1, w, h } = c;
    if (c.m < 3) {
      sh.rect([x0, c.y0, w, h], 'main', '#fff');
      return;
    }
    const hb = Math.min(S(90, 0.6), h * 0.07);
    const yb = c.y1 - hb;
    sh.rect([x0, yb, w, hb], 'main', '#fff'); // рама
    const cw = Math.min(w * 0.3, S(420, 1.5));
    const xa = x0 + w * 0.24;
    const xb = x1 - w * 0.24;
    const mt = Math.min(h * 0.08, S(130, 0.9));
    const mb = Math.min(h * 0.2, S(380, 1.8));
    const ct = c.y0 + mt;
    const cb = yb - mb;
    for (const xc of [xa, xb]) {
      IconParts.shell(sh, [xc - cw / 2, ct, xc + cw / 2, cb], false);
      IconParts.shade(sh, [xc - cw / 2, ct + cw / 4, xc + cw / 2, cb - cw / 4]);
    }
    const g = { xa, xb, cw, ct, cb, mt, mb, yb };
    IconAir.twinUpper(c, g);
    IconAir.twinLower(c, g);
    IconAir.twinPanel(c, g);
  }

  /** Верхний коллектор с выходом и обратными клапанами, манометры. */
  static twinUpper(c, { xa, xb, cw, ct, mt }) {
    const { sh, S } = c;
    const uh = Math.max(0.6, Math.min(S(90), mt * 0.55));
    const uy = c.y0 + mt * 0.1;
    for (const xc of [xa, xb]) sh.rect([xc - cw * 0.12, uy + uh, cw * 0.24, ct - uy - uh + cw * 0.05], 'thin', '#fff'); // стояки
    sh.rect([xa - cw * 0.25, uy, xb - xa + cw * 0.5, uh], 'main', '#fff');
    sh.rect([xb + cw * 0.25, uy + uh * 0.2, Math.max(0.6, S(80)), uh * 0.6], 'thin', '#fff'); // выход
    for (const xc of [xa, xb])
      IconParts.gauge(
        sh,
        xc + (xc < (xa + xb) / 2 ? cw * 0.62 : -cw * 0.62),
        ct + cw * 0.5 + Math.max(0.5, S(50)),
        Math.max(0.45, Math.min(S(50), cw * 0.2)),
      );
  }

  /** Нижний коллектор: входные клапаны, глушители продувки. */
  static twinLower(c, { xa, xb, cw, cb, mb, yb }) {
    const { sh, S } = c;
    const lh = Math.max(0.7, Math.min(S(120), mb * 0.35));
    const ly = cb + Math.max(0.2, S(25));
    for (const xc of [xa, xb])
      sh.rect([xc - cw * 0.12, cb - cw * 0.05, cw * 0.24, ly - cb + cw * 0.05], 'thin', '#fff');
    sh.rect([xa - cw * 0.3, ly, xb - xa + cw * 0.6, lh], 'main', '#fff');
    sh.rect([xa - cw * 0.3 - Math.max(0.6, S(80)), ly + lh * 0.2, Math.max(0.6, S(80)), lh * 0.6], 'thin', '#fff'); // вход
    for (const xc of [xa + (xb - xa) * 0.3, xa + (xb - xa) * 0.7]) {
      const vw = Math.max(0.6, Math.min(S(80), lh * 0.9));
      sh.rect([xc - vw / 2, ly + lh * 0.1, vw, lh * 0.8], 'thin', '#fff');
      sh.line(xc, ly + lh * 0.1, xc, ly - vw * 0.5, 'thin');
      sh.line(xc - vw * 0.4, ly - vw * 0.5, xc + vw * 0.4, ly - vw * 0.5, 'thin');
    } // клапаны
    for (const xc of [xa + (xb - xa) * 0.4, xa + (xb - xa) * 0.6]) {
      const gw = Math.max(0.6, S(70));
      const gh = yb - (ly + lh) - Math.max(0.2, S(20));
      // глушители продувки
      if (gh > 0.6) {
        sh.rect([xc - gw / 2, ly + lh, gw, gh], 'thin', '#fff', gw * 0.3);
        IconParts.fins(sh, [xc - gw / 2 + 0.1, ly + lh, xc + gw / 2 - 0.1, ly + lh + gh], S(22), false);
      }
    }
  }

  /** Блок управления между колоннами. */
  static twinPanel(c, { xa, xb, cw, ct, cb }) {
    const { sh, S } = c;
    const gap = xb - xa - cw;
    const bw = Math.min(gap * 0.8, S(300, 1.4));
    const bh = Math.min((cb - ct) * 0.28, S(380, 1.6));
    const bx = (xa + xb) / 2 - bw / 2;
    const by = ct + (cb - ct) * 0.25;
    if (gap > 1.2) {
      sh.rect([bx, by, bw, bh], 'main', '#fff');
      sh.rect([bx + bw * 0.15, by + bh * 0.15, bw * 0.7, bh * 0.3], 'thin', IconParts.DARK);
      for (const f of [0.3, 0.5, 0.7]) sh.circle(bx + bw * f, by + bh * 0.7, Math.min(bw * 0.07, S(15, 0.15)), 'thin');
    }
  }

  /** Магистральный фильтр на трубе: головка с патрубками и индикатором перепада, стакан с окном уровня, слив. */
  static filter(c) {
    const { sh, S, x0, x1, w, h, cx } = c;
    const hh = Math.max(0.6, Math.min(h * 0.22, S(120)));
    const y0 = c.y0;
    const port = Math.max(0.35, S(35));
    sh.rect([x0 - port, y0 + hh * 0.25, w + 2 * port, hh * 0.5], 'thin', '#fff'); // патрубки
    sh.rect([x0, y0, w, hh], 'main', '#fff', Math.min(w, hh) * 0.15);
    const gr = Math.max(0.3, Math.min(S(35), w * 0.22));
    sh.line(cx, y0, cx, y0 - gr * 0.6, 'thin');
    IconParts.gauge(sh, cx, y0 - gr * 1.6, gr); // индикатор перепада
    const dr = Math.max(0.4, Math.min(h * 0.1, S(60)));
    const bx0 = x0 + w * 0.12;
    const bx1 = x1 - w * 0.12;
    const by1 = c.y1 - dr;
    sh.rect([bx0, y0 + hh, bx1 - bx0, by1 - y0 - hh], 'main', '#fff', (bx1 - bx0) * 0.35); // стакан
    if (by1 - y0 - hh > 3 && w > 1.2)
      sh.rect(
        [
          cx - Math.max(0.12, w * 0.05),
          y0 + hh + (by1 - y0 - hh) * 0.3,
          Math.max(0.24, w * 0.1),
          (by1 - y0 - hh) * 0.4,
        ],
        'fine',
        IconParts.DARK,
      ); // окно уровня
    sh.rect([cx - Math.max(0.25, w * 0.12), by1, Math.max(0.5, w * 0.24), dr * 0.6], 'thin', '#fff'); // автоматический слив
    sh.line(cx, by1 + dr * 0.6, cx, c.y1 + Math.max(0.3, S(40)), 'thin');
  }
  /** Сепаратор конденсата (водомасляный): ёмкость, колонны с картриджами, ввод конденсата. */
  static separator(c) {
    const { sh, S, x0, x1, w, h } = c;
    const th = h * 0.55;
    const ty = c.y1 - th;
    sh.rect([x0, ty, w, th], 'main', '#fff', S(30));
    for (const f of [0.3, 0.7]) {
      const cw = Math.max(0.8, w * 0.2);
      sh.rect([x0 + w * f - cw / 2, c.y0 + h * 0.08, cw, ty - c.y0 - h * 0.08], 'main', '#fff', cw * 0.2);
      sh.rect([x0 + w * f - cw * 0.6, c.y0 + h * 0.05, cw * 1.2, Math.max(0.4, S(40))], 'thin', '#fff');
    }
    sh.line(x0 + w * 0.12, ty + th * 0.25, x1 - w * 0.12, ty + th * 0.25, 'thin');
    sh.rect([x1 - w * 0.12, ty + th * 0.55, Math.max(0.5, S(60)), Math.max(0.4, S(40))], 'thin', '#fff'); // выход очищенной воды
  }

  static screwTop(c) {
    const { sh, S, x0, y0, w, h } = c;
    sh.rect([x0, y0, w, h], 'main', '#fff');
    if (c.m < 3) return;
    const i = Math.max(0.3, S(45));
    sh.rect([x0 + i, y0 + i, w - 2 * i, h - 2 * i], 'thin'); // кромка крыши
    const back = c.front === 't' ? 'b' : 't';
    const gx0 = x0 + w * 0.12;
    const gx1 = x0 + w * 0.62;
    const gy0 = back === 't' ? y0 + h * 0.12 : y0 + h * 0.35;
    const gy1 = back === 't' ? y0 + h * 0.65 : y0 + h * 0.88;
    sh.rect([gx0, gy0, gx1 - gx0, gy1 - gy0], 'thin', '#fff');
    IconParts.fins(sh, [gx0, gy0, gx1, gy1], S(40), true);
    IconParts.fan(sh, x0 + w * 0.8, y0 + h / 2, Math.min(w * 0.14, h * 0.3));
    const pf = Math.max(0.4, S(60));
    if (c.front === 'b') sh.line(x0 + w * 0.62, y0 + h - pf, x0 + w * 0.97, y0 + h - pf, 'thin');
    else sh.line(x0 + w * 0.62, y0 + pf, x0 + w * 0.97, y0 + pf, 'thin');
  }
  static pistonTop(c) {
    const { sh, S, x0, y0, x1, w, h, cy } = c;
    sh.rect([x0 + w * 0.03, y0 + h * 0.1, w * 0.94, h * 0.8], 'main', '#fff', h * 0.4);
    if (c.m < 3) return; // ресивер
    sh.rect([x0 + w * 0.06, y0 + h * 0.15, w * 0.16, h * 0.7], 'main', '#fff', 0.3); // кожух ремня
    sh.rect([x0 + w * 0.24, cy - h * 0.22, w * 0.26, h * 0.44], 'main', '#fff', 0.3);
    IconParts.fins(sh, [x0 + w * 0.26, cy - h * 0.18, x0 + w * 0.48, cy + h * 0.18], S(30), true);
    for (const s of [-1, 1]) IconParts.fan(sh, x0 + w * 0.72 + s * w * 0.08, cy, Math.min(w * 0.08, h * 0.22)); // цилиндры (фильтры на всасывании)
    IconParts.gauge(sh, x1 - w * 0.1, cy, Math.max(0.45, S(45)));
  }
  static vesselTop(c, rec) {
    const { sh, S, cx, cy, m } = c;
    sh.circle(cx, cy, m / 2, 'main', '#fff');
    IconParts.axes(sh, cx, cy, m / 2 + 1.6);
    if (!rec || m < 3) return;
    const b = Math.max(0.4, Math.min(S(50), m * 0.1));
    sh.circle(cx - b * 1.6, cy, b * 0.85, 'thin', '#fff');
    sh.rect([cx + b * 1.6 - b * 0.35, cy - b * 0.35, b * 0.7, b * 0.7], 'thin', '#fff'); // манометр, клапан
  }
  static hvesselTop(c) {
    const { sh, x0, y0, w, h, cx, cy } = c;
    const hz = w >= h;
    sh.rect([x0, y0, w, h], 'main', '#fff', Math.min(w, h) / 2);
    sh.line(hz ? x0 - 1.6 : cx, hz ? cy : y0 - 1.6, hz ? c.x1 + 1.6 : cx, hz ? cy : c.y1 + 1.6, 'axis');
    if (hz && w > 6) {
      sh.line(x0 + h / 4, y0, x0 + h / 4, c.y1, 'thin');
      sh.line(c.x1 - h / 4, y0, c.x1 - h / 4, c.y1, 'thin');
    }
  }
  static refrigTop(c) {
    const { sh, S, x0, y0, w, h } = c;
    sh.rect([x0, y0, w, h], 'main', '#fff', S(20));
    if (c.m < 3) return;
    IconParts.fan(sh, x0 + w * 0.5, y0 + h * 0.5, Math.min(w, h) * 0.3);
    for (const f of [0.25, 0.75])
      sh.circle(x0 + w * f, c.front === 't' ? c.y1 - h * 0.2 : y0 + h * 0.2, Math.max(0.35, S(40)), 'thin', '#fff'); // вход, выход
  }
  static twinTop(c) {
    const { sh, S, x0, y0, w, h, cy } = c;
    sh.rect([x0, y0, w, h], 'thin');
    if (c.m < 3) return;
    const r = Math.min(w * 0.15, h * 0.36, S(210));
    for (const f of [0.24, 0.76]) {
      sh.circle(x0 + w * f, cy, r, 'main', '#fff');
      sh.circle(x0 + w * f, cy, r * 0.35, 'thin');
    }
    sh.rect([x0 + w * 0.24, cy - Math.max(0.3, S(45)), w * 0.52, Math.max(0.6, S(90))], 'thin', '#fff'); // верхний коллектор
  }
  static filterTop(c) {
    const { sh, S, x0, y0, w, h, cx, cy, m } = c;
    const port = Math.max(0.35, S(35));
    sh.rect([x0 - port, cy - m * 0.18, w + 2 * port, m * 0.36], 'thin', '#fff');
    sh.rect([x0, y0, w, h], 'main', '#fff', m * 0.15);
    if (m > 1.6) sh.circle(cx, cy, m * 0.2, 'thin', '#fff');
  }
}
