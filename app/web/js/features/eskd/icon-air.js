import { EskdSheet } from './eskd-sheet.js';
import { IconParts } from './icon-parts.js';

/** Рисунки компрессорного оборудования: компрессоры, ресиверы, осушители, фильтры (спереди и сверху). */
export class IconAir {
  /** Винтовой (спиральный) компрессор в шумозащитном кожухе; tankH — высота ресивера под ним. */
  static screw(frame, tankH = 0) {
    const { sheet, scale, x0, x1, width } = frame;
    const y0 = frame.y0;
    const y1 = frame.y1 - tankH;
    const height = y1 - y0;
    if (Math.min(width, height) < 3) {
      sheet.rect([x0, y0, width, height], 'main', '#fff');
      return;
    }
    const baseH = Math.min(scale(110, 0.7), height * 0.12);
    const baseY = y1 - baseH;
    const bodyH = baseY - y0;
    if (!tankH) IconParts.skid(sheet, [x0, x1], [baseY, y1], scale);
    else sheet.rect([x0, baseY, width, baseH], 'main', '#fff');
    sheet.rect([x0, y0, width, bodyH], 'main', '#fff');
    sheet.line(x0, y0 + scale(45, 0.35), x1, y0 + scale(45, 0.35), 'thin'); // кромка крыши
    let count = frame.item.lx >= 1700 ? 3 : 2;
    if (width < 6) count = 1;
    const panelW = width / count;
    for (let i = 1; i < count; i++) sheet.line(x0 + panelW * i, y0 + scale(45, 0.35), x0 + panelW * i, baseY, 'thin'); // стыки панелей
    const geom = { top: y0, H: bodyH, yb: baseY, n: count, pw: panelW };
    if (frame.rear || frame.side) IconAir.screwBack(frame, geom);
    else {
      if (height > 8) IconAir.locks(frame, geom);
      IconAir.screwFront(frame, geom);
    }
  }

  /** Сзади и сбоку — решётка охладителя (рёбра) и жалюзи забора воздуха. */
  static screwBack(frame, { top, H: bodyH, yb: baseY }) {
    const { sheet, scale, x0, x1, width } = frame;
    const gx0 = x0 + width * 0.12;
    const gx1 = x1 - width * 0.12;
    const gy0 = top + bodyH * 0.12;
    const gy1 = top + bodyH * (frame.side ? 0.5 : 0.62);
    sheet.rect([gx0, gy0, gx1 - gx0, gy1 - gy0], 'thin', '#fff');
    IconParts.fins(sheet, [gx0, gy0, gx1, gy1], scale(28), true);
    IconParts.louver(sheet, [gx0, top + bodyH * 0.68, gx1, baseY - bodyH * 0.08], scale(45));
  }

  /** Замки панелей — у стыков (у одной панели — у края). */
  static locks(frame, { top, H: bodyH, n: count, pw: panelW }) {
    const { sheet, scale, x0 } = frame;
    for (let i = 0; i < count; i++) {
      if (!(i < count - 1 || count === 1)) continue;
      const legX = x0 + panelW * (i + 1) - scale(70, 0.6);
      for (const fracY of [0.2, 0.8])
        sheet.rect(
          [legX - scale(15, 0.15), top + bodyH * fracY - scale(35, 0.35), scale(30, 0.3), scale(70, 0.7)],
          'thin',
        );
    }
  }

  /** Спереди: пульт (дисплей, кнопки, аварийная кнопка), жалюзи забора воздуха — под пультом и на соседних панелях. */
  static screwFront(frame, { top, H: bodyH, yb: baseY, n: count, pw: panelW }) {
    const { sheet, scale, x0, x1 } = frame;
    const coolerW = Math.min(scale(430, 2.4), panelW * 0.72);
    const coolerH = Math.min(scale(300, 1.8), bodyH * 0.26);
    const cx0 = x1 - panelW / 2 - coolerW / 2;
    const cy0 = top + Math.max(scale(140, 0.9), bodyH * 0.08);
    sheet.rect([cx0, cy0, coolerW, coolerH], 'thin', '#fff', scale(20));
    sheet.rect([cx0 + coolerW * 0.1, cy0 + coolerH * 0.14, coolerW * 0.48, coolerH * 0.42], 'thin', IconParts.DARK); // дисплей
    for (const fracX of [0.16, 0.32, 0.48])
      sheet.circle(cx0 + coolerW * fracX, cy0 + coolerH * 0.78, Math.min(coolerH * 0.09, scale(18, 0.18)), 'thin');
    const edgeR = Math.min(coolerH * 0.2, scale(40, 0.3));
    sheet.circle(cx0 + coolerW * 0.8, cy0 + coolerH * 0.42, edgeR, 'thin', '#fff');
    sheet.circle(cx0 + coolerW * 0.8, cy0 + coolerH * 0.42, edgeR * 0.55, 'thin'); // аварийная
    const step = scale(45);
    IconParts.louver(
      sheet,
      [x1 - panelW + panelW * 0.12, cy0 + coolerH + bodyH * 0.1, x1 - panelW * 0.12, baseY - bodyH * 0.1],
      step,
    );
    if (count > 1)
      IconParts.louver(sheet, [x0 + panelW * 0.12, top + bodyH * 0.32, x0 + panelW * 0.88, baseY - bodyH * 0.1], step);
    if (count > 2)
      IconParts.louver(sheet, [x0 + panelW * 1.12, top + bodyH * 0.32, x0 + panelW * 1.88, baseY - bodyH * 0.1], step);
  }

  /** Компрессор на горизонтальном ресивере: внизу — ресивер на опорах, на нём кожух. */
  static tankMounted(frame) {
    const tankH = Math.min(frame.height * 0.42, frame.scale(650));
    const y = frame.y1 - tankH;
    this.htank(frame, frame.x0, y, frame.x1, frame.y1);
    this.screw(Object.assign({}, frame, { y1: frame.y1 }), tankH);
  }
  /** Горизонтальный ресивер под компрессором: обечайка на опорах, кран слива. */
  static htank(frame, x0, y0, x1, y1) {
    const { sheet, scale } = frame;
    const width = x1 - x0;
    const legH = Math.min((y1 - y0) * 0.22, scale(140, 0.6));
    const baseY = y1 - legH;
    for (const frac of [0.18, 0.82]) {
      const legW = Math.max(0.6, scale(70));
      sheet.rect([x0 + width * frac - legW / 2, baseY - 0.4, legW, legH + 0.4], 'thin', '#fff');
      sheet.rect(
        [x0 + width * frac - legW * 1.1, y1 - Math.max(0.25, scale(15)), legW * 2.2, Math.max(0.25, scale(15))],
        'thin',
        '#fff',
      );
    }
    IconParts.hshell(sheet, [x0 + width * 0.02, y0, x1 - width * 0.02, baseY]);
    IconParts.shade(sheet, [x0 + width * 0.12, y0, x1 - width * 0.12, baseY], false);
    IconParts.ball(sheet, x0 + width * 0.5, baseY + Math.max(0.5, scale(45)), scale(40), true);
  }
  /** Поршневой компрессор на ресивере: двигатель, кожух ремня, головка с оребрёнными цилиндрами. */
  static piston(frame) {
    const { sheet, scale, x0, width, height } = frame;
    const tankH = Math.min(height * 0.45, scale(560, 3));
    const tankY = frame.y1 - tankH;
    IconAir.htank(frame, frame.x0, tankY, frame.x1, frame.y1);
    if (height - tankH < 2.5) return;
    const plateY = tankY + Math.max(0.3, scale(20));
    const top = frame.y0;
    const bodyH = plateY - top;
    // площадка на ресивере
    sheet.rect(
      [x0 + width * 0.08, plateY - Math.max(0.35, scale(30)), width * 0.84, Math.max(0.35, scale(30))],
      'thin',
      '#fff',
    );
    const deckY = plateY - Math.max(0.35, scale(30));
    // кожух ремённой передачи — слева, во всю высоту
    const guardW = Math.max(1.2, width * 0.16);
    sheet.rect(
      [x0 + width * 0.06, top + bodyH * 0.05, guardW, deckY - top - bodyH * 0.05],
      'main',
      '#fff',
      guardW * 0.35,
    );
    for (let y = top + bodyH * 0.18; y < deckY - bodyH * 0.1; y += Math.max(0.6, scale(40)))
      sheet.line(x0 + width * 0.06 + guardW * 0.2, y, x0 + width * 0.06 + guardW * 0.8, y, 'fine');
    IconAir.motor(frame, [x0 + width * 0.06 + guardW + width * 0.02, x0 + width * 0.5], bodyH, deckY);
    IconAir.head(frame, { H: bodyH, p0: deckY, ty: tankY });
  }

  /** Двигатель — справа от кожуха, низко: рёбра вдоль оси, клеммная коробка. */
  static motor(frame, [mx0, mx1], bodyH, deckY) {
    const { sheet, scale } = frame;
    const motorH = Math.min(bodyH * 0.45, scale(320, 1.5));
    const my0 = deckY - motorH;
    sheet.rect([mx0, my0, mx1 - mx0, motorH], 'main', '#fff', motorH * 0.2);
    IconParts.fins(
      sheet,
      [mx0 + motorH * 0.2, my0 + motorH * 0.12, mx1 - motorH * 0.2, deckY - motorH * 0.12],
      scale(30),
      false,
    );
    const beltH = Math.max(0.5, scale(70));
    sheet.rect([mx0 + (mx1 - mx0) * 0.35, my0 - beltH, (mx1 - mx0) * 0.3, beltH], 'thin', '#fff');
  }

  /** Головка: картер и два цилиндра V-образно с рёбрами; нагнетание в ресивер, реле с манометром. */
  static head(frame, { H: bodyH, p0: deckY, ty: tankY }) {
    const { sheet, scale, x0, x1, width } = frame;
    const headX = x0 + width * 0.72;
    const cylW = Math.max(1, width * 0.13);
    const crank = Math.min(bodyH * 0.3, scale(220, 1));
    const cy0 = deckY - crank;
    sheet.rect([headX - cylW * 1.1, cy0, cylW * 2.2, crank], 'main', '#fff', cylW * 0.2);
    for (const side of [-1, 1])
      IconAir.cylinder(sheet, [headX + side * cylW * 0.55, cy0], side * 0.45, {
        cw: cylW,
        L: Math.min(bodyH * 0.5, scale(300, 1.6)),
      });
    const rodX = x1 - width * 0.1;
    const fmt = EskdSheet.fmt;
    const rodY = cy0 + crank * 0.4;
    sheet.path(
      `M${fmt(headX + cylW * 1.1)},${fmt(rodY)} L${fmt(rodX)},${fmt(rodY)} L${fmt(rodX)},${fmt(tankY)}`,
      'thin',
    );
    IconParts.gauge(sheet, rodX, rodY - Math.max(0.6, scale(60)), Math.max(0.45, scale(45)));
  }

  /** Оребрённый цилиндр от (bx, by) под углом ang к вертикали, длиной L, с фильтром на конце. */
  static cylinder(sheet, [originX, originY], ang, { cw: cylW, L: length }) {
    const endX = originX + Math.sin(ang) * length;
    const endY = originY - Math.cos(ang) * length;
    const normX = Math.cos(ang) * cylW * 0.45;
    const normY = Math.sin(ang) * cylW * 0.45;
    sheet.poly(
      [
        [originX - normX, originY - normY],
        [originX + normX, originY + normY],
        [endX + normX, endY + normY],
        [endX - normX, endY - normY],
      ],
      'main',
      '#fff',
    );
    for (let ratio = 0.25; ratio < 0.95; ratio += Math.max(0.12, 0.5 / Math.max(1, length))) {
      const pointX = originX + (endX - originX) * ratio;
      const pointY = originY + (endY - originY) * ratio;
      sheet.line(pointX - normX * 1.35, pointY - normY * 1.35, pointX + normX * 1.35, pointY + normY * 1.35, 'fine');
    }
    sheet.circle(endX + Math.sin(ang) * cylW * 0.4, endY - Math.cos(ang) * cylW * 0.4, cylW * 0.42, 'thin', '#fff');
  }

  /** Вертикальный сосуд на опорах. receiver — люк, табличка, предохранительный клапан и манометр сверху, кран слива; housing — корпус фильтра/сепаратора. */
  static vreceiver(frame, kind) {
    const { sheet, scale, x0, x1, width, height, centerX } = frame;
    const rec = kind === 'receiver';
    const legH = Math.min(height * 0.14, scale(Math.min(320, Math.max(140, frame.item.h * 0.1)), 0.8));
    const shellBottom = frame.y1 - legH;
    const fit = rec && width > 2.5 ? Math.min(height * 0.12, scale(260, 1.6)) : Math.min(height * 0.06, scale(80, 0.5));
    const top = frame.y0 + fit;
    // опоры с плитами
    for (const frac of [0.14, 0.86]) {
      const legX = x0 + width * frac;
      const legW = Math.max(0.5, Math.min(width * 0.08, scale(60)));
      sheet.rect(
        [
          legX - legW / 2,
          shellBottom - Math.min(legH, width * 0.18),
          legW,
          frame.y1 - shellBottom + Math.min(legH, width * 0.18),
        ],
        'thin',
        '#fff',
      );
      sheet.rect(
        [legX - legW * 1.2, frame.y1 - Math.max(0.25, scale(14)), legW * 2.4, Math.max(0.25, scale(14))],
        'thin',
        '#fff',
      );
    }
    const capR = IconParts.shell(sheet, [x0, top, x1, shellBottom], true);
    IconParts.shade(sheet, [x0, top + capR, x1, shellBottom - capR]);
    sheet.line(centerX, frame.y0 - 1.6, centerX, frame.y1 + 1.2, 'axis');
    if (width < 2.5) return;
    if (rec) IconAir.recvFittings(frame, { top, sb: shellBottom, ry: capR, hl: legH });
    else IconAir.housing(frame, { top, sb: shellBottom, ry: capR, hl: legH });
  }

  /** Ресивер: табличка, люк, сверху — штуцер с предохранительным клапаном и манометром, снизу — кран слива. */
  static recvFittings(frame, { top, sb: shellBottom, ry: capR, hl: legH }) {
    const { sheet, scale, width, centerX } = frame;
    const length = shellBottom - top - 2 * capR;
    if (width > 4)
      sheet.rect(
        [
          centerX - width * 0.32,
          top + capR + length * 0.16,
          Math.min(width * 0.22, scale(150)),
          Math.min(length * 0.08, scale(100)),
        ],
        'thin',
        '#fff',
      );
    const manholeR = Math.min(width * 0.17, scale(120, 0.6));
    if (length > 4 * manholeR) IconAir.manhole(sheet, [centerX, shellBottom - capR - length * 0.22], manholeR);
    const stub = Math.max(0.5, scale(70));
    const boss = Math.max(0.45, Math.min(scale(55), width * 0.12));
    sheet.line(centerX, top, centerX, top - stub, 'thin');
    sheet.line(centerX - boss * 1.6, top - stub, centerX + boss * 1.6, top - stub, 'thin');
    IconParts.safety(sheet, centerX + boss * 1.6, top - stub, boss);
    IconParts.gauge(sheet, centerX - boss * 1.6, top - stub - boss * 0.9, boss * 0.85);
    const dy = shellBottom + Math.min(legH * 0.45, Math.max(0.6, scale(60)));
    sheet.line(centerX, shellBottom, centerX, dy + boss * 0.5, 'thin');
    IconParts.ball(sheet, centerX, dy, boss * 0.8);
  }

  /** Люк: кольцо, крышка, болты. */
  static manhole(sheet, [centerX, manholeY], manholeR) {
    sheet.circle(centerX, manholeY, manholeR, 'thin', '#fff');
    sheet.circle(centerX, manholeY, manholeR * 0.7, 'thin');
    if (manholeR <= 1.4) return;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      sheet.dot(centerX + Math.cos(angle) * manholeR * 0.85, manholeY + Math.sin(angle) * manholeR * 0.85, 0.1);
    }
  }

  /** Корпус фильтра: фланцевая крышка, индикатор перепада, слив. */
  static housing(frame, { top, sb: shellBottom, ry: capR, hl: legH }) {
    const { sheet, scale, x0, width, centerX } = frame;
    const flangeH = Math.max(0.4, scale(40));
    sheet.rect([x0 - flangeH * 0.6, top + capR * 0.9, width + flangeH * 1.2, flangeH], 'thin', '#fff');
    IconParts.gauge(
      sheet,
      centerX + width * 0.22,
      top - Math.max(0.4, scale(30)),
      Math.max(0.4, Math.min(scale(40), width * 0.1)),
    );
    sheet.line(centerX, shellBottom, centerX, shellBottom + Math.min(legH * 0.6, scale(80, 0.5)), 'thin');
  }

  /** Горизонтальный сосуд на седловых опорах; receiver — с арматурой сверху и сливом. */
  static hreceiver(frame, rec) {
    const { sheet, scale, x0, x1, width, height } = frame;
    const saddleH = Math.min(height * 0.2, scale(220, 0.8));
    const baseY = frame.y1 - saddleH;
    const fit = rec && height > 3 ? Math.min(height * 0.18, scale(240, 1.4)) : 0;
    const top = frame.y0 + fit;
    for (const frac of [0.2, 0.8]) {
      const saddleX = x0 + width * frac;
      const saddleW = Math.max(0.8, width * 0.08);
      sheet.poly(
        [
          [saddleX - saddleW, frame.y1],
          [saddleX + saddleW, frame.y1],
          [saddleX + saddleW * 0.7, baseY - 0.4],
          [saddleX - saddleW * 0.7, baseY - 0.4],
        ],
        'thin',
        '#fff',
      );
    }
    const capR = IconParts.hshell(sheet, [x0, top, x1, baseY], true);
    IconParts.shade(sheet, [x0 + capR, top, x1 - capR, baseY], false);
    sheet.line(x0 - 1.6, (top + baseY) / 2, x1 + 1.6, (top + baseY) / 2, 'axis');
    if (!rec || height < 3) return;
    const boss = Math.max(0.45, Math.min(scale(55), height * 0.1));
    const stub = Math.max(0.4, scale(60));
    const valveX = x0 + width * 0.42;
    sheet.line(valveX, top, valveX, top - stub, 'thin');
    sheet.line(valveX - boss * 1.6, top - stub, valveX + boss * 1.6, top - stub, 'thin');
    IconParts.safety(sheet, valveX + boss * 1.6, top - stub, boss);
    IconParts.gauge(sheet, valveX - boss * 1.6, top - stub - boss * 0.9, boss * 0.85);
    if (width > 8)
      sheet.rect(
        [
          x0 + width * 0.62,
          top + (baseY - top) * 0.3,
          Math.min(width * 0.1, scale(150)),
          Math.min((baseY - top) * 0.2, scale(100)),
        ],
        'thin',
        '#fff',
      ); // табличка
    IconParts.ball(
      sheet,
      x0 + width * 0.5,
      baseY + Math.min(saddleH * 0.5, Math.max(0.6, scale(60))),
      boss * 0.8,
      true,
    );
  }

  /** Рефрижераторный осушитель: панель с индикатором точки росы, решётка конденсатора с вентилятором, патрубки. */
  static refrig(frame) {
    const { sheet, scale, x0, x1, width, height } = frame;
    if (frame.minSide < 3) {
      sheet.rect([x0, frame.y0, width, height], 'main', '#fff');
      return;
    }
    const baseH = Math.min(scale(60, 0.5), height * 0.08);
    const baseY = frame.y1 - baseH;
    const stub = Math.min(scale(110, 0.8), height * 0.12);
    const top = frame.y0 + stub;
    const bodyH = baseY - top;
    for (const frac of [0.25, 0.75]) {
      const postW = Math.max(0.6, scale(55));
      sheet.rect([x0 + width * frac - postW / 2, frame.y0, postW, stub], 'thin', '#fff');
      sheet.rect([x0 + width * frac - postW * 0.85, frame.y0, postW * 1.7, Math.max(0.25, scale(18))], 'thin', '#fff');
    } // вход, выход
    for (const frac of [0.1, 0.9])
      sheet.rect(
        [x0 + width * frac - Math.max(0.4, scale(40)), baseY, Math.max(0.8, scale(80)), baseH],
        'thin',
        '#fff',
      ); // опоры
    sheet.rect([x0, top, width, bodyH], 'main', '#fff', scale(20));
    if (frame.rear || frame.side) {
      IconParts.perforated(
        sheet,
        [x0 + width * 0.1, top + bodyH * 0.1, x1 - width * 0.1, baseY - bodyH * 0.1],
        scale(32),
      );
      IconParts.fan(sheet, (x0 + x1) / 2, top + bodyH / 2, Math.min(width, bodyH) * 0.3);
      return;
    }
    IconAir._refrigPanel(frame, top, bodyH, baseY);
  }
  /** Панель управления (индикатор точки росы, дисплей, выключатель), решётка конденсатора и вентилятор. */
  static _refrigPanel(frame, top, bodyH, baseY) {
    const { sheet, scale, x0, x1, width } = frame;
    const panelH = Math.min(bodyH * 0.24, scale(200, 1.6));
    sheet.rect([x0 + width * 0.06, top + bodyH * 0.05, width * 0.88, panelH], 'thin', '#fff');
    const grilleR = Math.min(panelH * 0.36, scale(55, 0.5));
    IconParts.gauge(sheet, x0 + width * 0.2, top + bodyH * 0.05 + panelH / 2, grilleR);
    sheet.circle(x0 + width * 0.2, top + bodyH * 0.05 + panelH / 2, grilleR * 0.7, 'fine');
    sheet.rect(
      [x0 + width * 0.36, top + bodyH * 0.05 + panelH * 0.3, width * 0.26, panelH * 0.4],
      'thin',
      IconParts.DARK,
    );
    sheet.rect(
      [x0 + width * 0.74, top + bodyH * 0.05 + panelH * 0.3, Math.max(0.5, width * 0.08), panelH * 0.4],
      'thin',
    );
    // решётка конденсатора (перфорация) и вентилятор
    const gy0 = top + bodyH * 0.05 + panelH + bodyH * 0.06;
    const gy1 = baseY - bodyH * 0.07;
    IconParts.perforated(sheet, [x0 + width * 0.08, gy0, x1 - width * 0.08, gy1], scale(32));
    IconParts.fan(sheet, (x0 + x1) / 2, (gy0 + gy1) / 2, Math.min(width * 0.84, gy1 - gy0) * 0.4);
  }

  /** Адсорбционный осушитель (генератор): две колонны, коллекторы, клапаны, глушители, блок управления, манометры. */
  static twin(frame) {
    const { sheet, scale, x0, x1, width, height } = frame;
    if (frame.minSide < 3) {
      sheet.rect([x0, frame.y0, width, height], 'main', '#fff');
      return;
    }
    const baseH = Math.min(scale(90, 0.6), height * 0.07);
    const baseY = frame.y1 - baseH;
    sheet.rect([x0, baseY, width, baseH], 'main', '#fff'); // рама
    const colW = Math.min(width * 0.3, scale(420, 1.5));
    const colA = x0 + width * 0.24;
    const colB = x1 - width * 0.24;
    const marginTop = Math.min(height * 0.08, scale(130, 0.9));
    const marginBottom = Math.min(height * 0.2, scale(380, 1.8));
    const columnTop = frame.y0 + marginTop;
    const columnBottom = baseY - marginBottom;
    for (const colX of [colA, colB]) {
      IconParts.shell(sheet, [colX - colW / 2, columnTop, colX + colW / 2, columnBottom], false);
      IconParts.shade(sheet, [colX - colW / 2, columnTop + colW / 4, colX + colW / 2, columnBottom - colW / 4]);
    }
    const geom = {
      xa: colA,
      xb: colB,
      cw: colW,
      ct: columnTop,
      cb: columnBottom,
      mt: marginTop,
      mb: marginBottom,
      yb: baseY,
    };
    IconAir.twinUpper(frame, geom);
    IconAir.twinLower(frame, geom);
    IconAir.twinPanel(frame, geom);
  }

  /** Верхний коллектор с выходом и обратными клапанами, манометры. */
  static twinUpper(frame, { xa: colA, xb: colB, cw: colW, ct: columnTop, mt: marginTop }) {
    const { sheet, scale } = frame;
    const upperH = Math.max(0.6, Math.min(scale(90), marginTop * 0.55));
    const upperY = frame.y0 + marginTop * 0.1;
    for (const colX of [colA, colB])
      sheet.rect(
        [colX - colW * 0.12, upperY + upperH, colW * 0.24, columnTop - upperY - upperH + colW * 0.05],
        'thin',
        '#fff',
      ); // стояки
    sheet.rect([colA - colW * 0.25, upperY, colB - colA + colW * 0.5, upperH], 'main', '#fff');
    sheet.rect([colB + colW * 0.25, upperY + upperH * 0.2, Math.max(0.6, scale(80)), upperH * 0.6], 'thin', '#fff'); // выход
    for (const colX of [colA, colB])
      IconParts.gauge(
        sheet,
        colX + (colX < (colA + colB) / 2 ? colW * 0.62 : -colW * 0.62),
        columnTop + colW * 0.5 + Math.max(0.5, scale(50)),
        Math.max(0.45, Math.min(scale(50), colW * 0.2)),
      );
  }

  /** Нижний коллектор: входные клапаны, глушители продувки. */
  static twinLower(frame, { xa: colA, xb: colB, cw: colW, cb: columnBottom, mb: marginBottom, yb: baseY }) {
    const { sheet, scale } = frame;
    const lowerH = Math.max(0.7, Math.min(scale(120), marginBottom * 0.35));
    const lowerY = columnBottom + Math.max(0.2, scale(25));
    for (const colX of [colA, colB])
      sheet.rect(
        [colX - colW * 0.12, columnBottom - colW * 0.05, colW * 0.24, lowerY - columnBottom + colW * 0.05],
        'thin',
        '#fff',
      );
    sheet.rect([colA - colW * 0.3, lowerY, colB - colA + colW * 0.6, lowerH], 'main', '#fff');
    sheet.rect(
      [colA - colW * 0.3 - Math.max(0.6, scale(80)), lowerY + lowerH * 0.2, Math.max(0.6, scale(80)), lowerH * 0.6],
      'thin',
      '#fff',
    ); // вход
    for (const colX of [colA + (colB - colA) * 0.3, colA + (colB - colA) * 0.7]) {
      const valveW = Math.max(0.6, Math.min(scale(80), lowerH * 0.9));
      sheet.rect([colX - valveW / 2, lowerY + lowerH * 0.1, valveW, lowerH * 0.8], 'thin', '#fff');
      sheet.line(colX, lowerY + lowerH * 0.1, colX, lowerY - valveW * 0.5, 'thin');
      sheet.line(colX - valveW * 0.4, lowerY - valveW * 0.5, colX + valveW * 0.4, lowerY - valveW * 0.5, 'thin');
    } // клапаны
    for (const colX of [colA + (colB - colA) * 0.4, colA + (colB - colA) * 0.6]) {
      const gaugeW = Math.max(0.6, scale(70));
      const gaugeH = baseY - (lowerY + lowerH) - Math.max(0.2, scale(20));
      // глушители продувки
      if (gaugeH > 0.6) {
        sheet.rect([colX - gaugeW / 2, lowerY + lowerH, gaugeW, gaugeH], 'thin', '#fff', gaugeW * 0.3);
        IconParts.fins(
          sheet,
          [colX - gaugeW / 2 + 0.1, lowerY + lowerH, colX + gaugeW / 2 - 0.1, lowerY + lowerH + gaugeH],
          scale(22),
          false,
        );
      }
    }
  }

  /** Блок управления между колоннами. */
  static twinPanel(frame, { xa: colA, xb: colB, cw: colW, ct: columnTop, cb: columnBottom }) {
    const { sheet, scale } = frame;
    const gap = colB - colA - colW;
    const panelW = Math.min(gap * 0.8, scale(300, 1.4));
    const panelH = Math.min((columnBottom - columnTop) * 0.28, scale(380, 1.6));
    const panelX = (colA + colB) / 2 - panelW / 2;
    const panelY = columnTop + (columnBottom - columnTop) * 0.25;
    if (gap > 1.2) {
      sheet.rect([panelX, panelY, panelW, panelH], 'main', '#fff');
      sheet.rect([panelX + panelW * 0.15, panelY + panelH * 0.15, panelW * 0.7, panelH * 0.3], 'thin', IconParts.DARK);
      for (const frac of [0.3, 0.5, 0.7])
        sheet.circle(panelX + panelW * frac, panelY + panelH * 0.7, Math.min(panelW * 0.07, scale(15, 0.15)), 'thin');
    }
  }

  /** Магистральный фильтр на трубе: головка с патрубками и индикатором перепада, стакан с окном уровня, слив. */
  static filter(frame) {
    const { sheet, scale, x0, x1, width, height, centerX } = frame;
    const headH = Math.max(0.6, Math.min(height * 0.22, scale(120)));
    const y0 = frame.y0;
    const port = Math.max(0.35, scale(35));
    sheet.rect([x0 - port, y0 + headH * 0.25, width + 2 * port, headH * 0.5], 'thin', '#fff'); // патрубки
    sheet.rect([x0, y0, width, headH], 'main', '#fff', Math.min(width, headH) * 0.15);
    const grilleR = Math.max(0.3, Math.min(scale(35), width * 0.22));
    sheet.line(centerX, y0, centerX, y0 - grilleR * 0.6, 'thin');
    IconParts.gauge(sheet, centerX, y0 - grilleR * 1.6, grilleR); // индикатор перепада
    const drainR = Math.max(0.4, Math.min(height * 0.1, scale(60)));
    const bx0 = x0 + width * 0.12;
    const bx1 = x1 - width * 0.12;
    const by1 = frame.y1 - drainR;
    sheet.rect([bx0, y0 + headH, bx1 - bx0, by1 - y0 - headH], 'main', '#fff', (bx1 - bx0) * 0.35); // стакан
    if (by1 - y0 - headH > 3 && width > 1.2)
      sheet.rect(
        [
          centerX - Math.max(0.12, width * 0.05),
          y0 + headH + (by1 - y0 - headH) * 0.3,
          Math.max(0.24, width * 0.1),
          (by1 - y0 - headH) * 0.4,
        ],
        'fine',
        IconParts.DARK,
      ); // окно уровня
    sheet.rect(
      [centerX - Math.max(0.25, width * 0.12), by1, Math.max(0.5, width * 0.24), drainR * 0.6],
      'thin',
      '#fff',
    ); // автоматический слив
    sheet.line(centerX, by1 + drainR * 0.6, centerX, frame.y1 + Math.max(0.3, scale(40)), 'thin');
  }
  /** Сепаратор конденсата (водомасляный): ёмкость, колонны с картриджами, ввод конденсата. */
  static separator(frame) {
    const { sheet, scale, x0, x1, width, height } = frame;
    const tankH = height * 0.55;
    const tankY = frame.y1 - tankH;
    sheet.rect([x0, tankY, width, tankH], 'main', '#fff', scale(30));
    for (const frac of [0.3, 0.7]) {
      const colW = Math.max(0.8, width * 0.2);
      sheet.rect(
        [x0 + width * frac - colW / 2, frame.y0 + height * 0.08, colW, tankY - frame.y0 - height * 0.08],
        'main',
        '#fff',
        colW * 0.2,
      );
      sheet.rect(
        [x0 + width * frac - colW * 0.6, frame.y0 + height * 0.05, colW * 1.2, Math.max(0.4, scale(40))],
        'thin',
        '#fff',
      );
    }
    sheet.line(x0 + width * 0.12, tankY + tankH * 0.25, x1 - width * 0.12, tankY + tankH * 0.25, 'thin');
    sheet.rect(
      [x1 - width * 0.12, tankY + tankH * 0.55, Math.max(0.5, scale(60)), Math.max(0.4, scale(40))],
      'thin',
      '#fff',
    ); // выход очищенной воды
  }

  /** Винтовой компрессор — вид сверху. */
  static screwTop(frame) {
    const { sheet, scale, x0, y0, width, height } = frame;
    sheet.rect([x0, y0, width, height], 'main', '#fff');
    if (frame.minSide < 3) return;
    const i = Math.max(0.3, scale(45));
    sheet.rect([x0 + i, y0 + i, width - 2 * i, height - 2 * i], 'thin'); // кромка крыши
    const back = frame.front === 't' ? 'b' : 't';
    const gx0 = x0 + width * 0.12;
    const gx1 = x0 + width * 0.62;
    const gy0 = back === 't' ? y0 + height * 0.12 : y0 + height * 0.35;
    const gy1 = back === 't' ? y0 + height * 0.65 : y0 + height * 0.88;
    sheet.rect([gx0, gy0, gx1 - gx0, gy1 - gy0], 'thin', '#fff');
    IconParts.fins(sheet, [gx0, gy0, gx1, gy1], scale(40), true);
    IconParts.fan(sheet, x0 + width * 0.8, y0 + height / 2, Math.min(width * 0.14, height * 0.3));
    const padding = Math.max(0.4, scale(60));
    if (frame.front === 'b')
      sheet.line(x0 + width * 0.62, y0 + height - padding, x0 + width * 0.97, y0 + height - padding, 'thin');
    else sheet.line(x0 + width * 0.62, y0 + padding, x0 + width * 0.97, y0 + padding, 'thin');
  }
  /** Поршневой компрессор — вид сверху. */
  static pistonTop(frame) {
    const { sheet, scale, x0, y0, x1, width, height, centerY } = frame;
    sheet.rect([x0 + width * 0.03, y0 + height * 0.1, width * 0.94, height * 0.8], 'main', '#fff', height * 0.4);
    if (frame.minSide < 3) return; // ресивер
    sheet.rect([x0 + width * 0.06, y0 + height * 0.15, width * 0.16, height * 0.7], 'main', '#fff', 0.3); // кожух ремня
    sheet.rect([x0 + width * 0.24, centerY - height * 0.22, width * 0.26, height * 0.44], 'main', '#fff', 0.3);
    IconParts.fins(
      sheet,
      [x0 + width * 0.26, centerY - height * 0.18, x0 + width * 0.48, centerY + height * 0.18],
      scale(30),
      true,
    );
    for (const side of [-1, 1])
      IconParts.fan(sheet, x0 + width * 0.72 + side * width * 0.08, centerY, Math.min(width * 0.08, height * 0.22)); // цилиндры (фильтры на всасывании)
    IconParts.gauge(sheet, x1 - width * 0.1, centerY, Math.max(0.45, scale(45)));
  }
  /** Вертикальный сосуд — вид сверху. */
  static vesselTop(frame, rec) {
    const { sheet, scale, centerX, centerY, minSide } = frame;
    sheet.circle(centerX, centerY, minSide / 2, 'main', '#fff');
    IconParts.axes(sheet, centerX, centerY, minSide / 2 + 1.6);
    if (!rec || minSide < 3) return;
    const boss = Math.max(0.4, Math.min(scale(50), minSide * 0.1));
    sheet.circle(centerX - boss * 1.6, centerY, boss * 0.85, 'thin', '#fff');
    sheet.rect([centerX + boss * 1.6 - boss * 0.35, centerY - boss * 0.35, boss * 0.7, boss * 0.7], 'thin', '#fff'); // манометр, клапан
  }
  /** Горизонтальный сосуд — вид сверху. */
  static hvesselTop(frame) {
    const { sheet, x0, y0, width, height, centerX, centerY } = frame;
    const horizontal = width >= height;
    sheet.rect([x0, y0, width, height], 'main', '#fff', Math.min(width, height) / 2);
    sheet.line(
      horizontal ? x0 - 1.6 : centerX,
      horizontal ? centerY : y0 - 1.6,
      horizontal ? frame.x1 + 1.6 : centerX,
      horizontal ? centerY : frame.y1 + 1.6,
      'axis',
    );
    if (horizontal && width > 6) {
      sheet.line(x0 + height / 4, y0, x0 + height / 4, frame.y1, 'thin');
      sheet.line(frame.x1 - height / 4, y0, frame.x1 - height / 4, frame.y1, 'thin');
    }
  }
  /** Рефрижераторный осушитель — вид сверху. */
  static refrigTop(frame) {
    const { sheet, scale, x0, y0, width, height } = frame;
    sheet.rect([x0, y0, width, height], 'main', '#fff', scale(20));
    if (frame.minSide < 3) return;
    IconParts.fan(sheet, x0 + width * 0.5, y0 + height * 0.5, Math.min(width, height) * 0.3);
    for (const frac of [0.25, 0.75])
      sheet.circle(
        x0 + width * frac,
        frame.front === 't' ? frame.y1 - height * 0.2 : y0 + height * 0.2,
        Math.max(0.35, scale(40)),
        'thin',
        '#fff',
      ); // вход, выход
  }
  /** Адсорбционный осушитель — вид сверху. */
  static twinTop(frame) {
    const { sheet, scale, x0, y0, width, height, centerY } = frame;
    sheet.rect([x0, y0, width, height], 'thin');
    if (frame.minSide < 3) return;
    const radius = Math.min(width * 0.15, height * 0.36, scale(210));
    for (const frac of [0.24, 0.76]) {
      sheet.circle(x0 + width * frac, centerY, radius, 'main', '#fff');
      sheet.circle(x0 + width * frac, centerY, radius * 0.35, 'thin');
    }
    sheet.rect(
      [x0 + width * 0.24, centerY - Math.max(0.3, scale(45)), width * 0.52, Math.max(0.6, scale(90))],
      'thin',
      '#fff',
    ); // верхний коллектор
  }
  /** Фильтр — вид сверху. */
  static filterTop(frame) {
    const { sheet, scale, x0, y0, width, height, centerX, centerY, minSide } = frame;
    const port = Math.max(0.35, scale(35));
    sheet.rect([x0 - port, centerY - minSide * 0.18, width + 2 * port, minSide * 0.36], 'thin', '#fff');
    sheet.rect([x0, y0, width, height], 'main', '#fff', minSide * 0.15);
    if (minSide > 1.6) sheet.circle(centerX, centerY, minSide * 0.2, 'thin', '#fff');
  }
}
