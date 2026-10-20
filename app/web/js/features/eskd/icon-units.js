import { EskdSheet } from './eskd-sheet.js';
import { IconParts } from './icon-parts.js';

/** Рисунки шкафов, ДГУ с глушителем, насосов и баков (спереди и сверху). */
export class IconUnits {
  /** Шкаф: дверь на петлях, ручка, панель оператора, лампы, вводной выключатель; сбоку — торец. */
  static cabinet(c, floor) {
    const { sh, S, x0, w, h } = c;
    const pl = floor ? Math.min(S(100, 0.6), h * 0.08) : 0;
    const yb = c.y1 - pl;
    sh.rect([x0, c.y0, w, yb - c.y0], 'main', '#fff');
    if (pl) sh.rect([x0, yb, w, pl], 'thin', '#fff');
    if (c.m < 2.5) return;
    if (c.side) IconUnits.cabinetEnd(c, yb);
    else IconUnits.cabinetDoor(c, yb);
    if (!floor)
      for (const f of [0.25, 0.5, 0.75])
        sh.rect([x0 + w * f - Math.max(0.2, S(15)), yb, Math.max(0.4, S(30)), Math.max(0.4, S(45))], 'thin', '#fff'); // кабельные вводы
  }

  /** Сбоку — торец шкафа. */
  static cabinetEnd(c, yb) {
    const { sh, S, x1, w } = c;
    const e = Math.min(w * 0.2, Math.max(0.3, S(25)));
    sh.line(x1 - e, c.y0, x1 - e, yb, 'thin');
    sh.rect([x1 - e * 0.6, c.y0 + (yb - c.y0) * 0.45, e * 1.2, (yb - c.y0) * 0.1], 'thin');
  }

  /** Дверь на петлях с ручкой; на двери — панель оператора, лампы, вводной выключатель, решётка. */
  static cabinetDoor(c, yb) {
    const { sh, S, x0, w } = c;
    const i = Math.max(0.35, Math.min(S(30), w * 0.06));
    const d = { dx0: x0 + i, dy0: c.y0 + i, dw: w - 2 * i, dh: yb - c.y0 - 2 * i };
    const { dx0, dy0, dw, dh } = d;
    sh.rect([dx0, dy0, dw, dh], 'thin');
    for (const f of [0.15, 0.85])
      sh.rect(
        [x0 - Math.max(0.15, S(12)), dy0 + dh * f - Math.max(0.3, S(40)), Math.max(0.3, S(24)), Math.max(0.6, S(80))],
        'thin',
        '#fff',
      ); // петли
    const hx = dx0 + dw - Math.max(0.6, S(55));
    sh.rect(
      [hx - Math.max(0.2, S(15)), dy0 + dh * 0.42, Math.max(0.4, S(30)), Math.max(0.9, dh * 0.16)],
      'thin',
      '#fff',
      0.2,
    );
    if (dw > 3 && dh > 4) IconUnits.cabinetPanel(c, d);
  }

  static cabinetPanel(c, { dx0, dy0, dw, dh }) {
    const { sh, S } = c;
    const pw = Math.min(dw * 0.5, S(200));
    const ph = Math.min(dh * 0.16, S(140));
    sh.rect([dx0 + dw * 0.12, dy0 + dh * 0.08, pw, ph], 'thin', IconParts.DARK); // панель оператора
    for (let q = 0; q < 3; q++)
      sh.circle(
        dx0 + dw * 0.12 + pw * (0.15 + q * 0.35),
        dy0 + dh * 0.08 + ph + Math.max(0.6, S(50)),
        Math.min(dw * 0.05, S(18, 0.2)),
        'thin',
      );
    const sr = Math.min(dw * 0.1, S(45, 0.35));
    if (dw > 4) {
      const [sx, sy] = [dx0 + dw * 0.78, dy0 + dh * 0.14];
      sh.circle(sx, sy, sr, 'thin', '#fff');
      sh.line(sx - sr * 0.8, sy + sr * 0.8, sx + sr * 0.8, sy - sr * 0.8, 'thin');
    } // вводной выключатель
    IconParts.louver(sh, [dx0 + dw * 0.2, dy0 + dh * 0.78, dx0 + dw * 0.7, dy0 + dh * 0.94], S(30), false);
  }

  /** ДГУ: рама, генератор с пультом, двигатель, турбокомпрессор, вентилятор и радиатор (справа — к жалюзи). */
  static dgu(c) {
    const { sh, S, x0, w, h } = c;
    const hb = Math.min(h * 0.12, S(240, 0.8));
    const yb = c.y1 - hb;
    sh.rect([x0, yb, w, hb], 'main', '#fff');
    if (c.m < 4) {
      sh.rect([x0, c.y0, w, yb - c.y0], 'main', '#fff');
      return;
    }
    for (const f of [0.04, 0.96]) sh.circle(x0 + w * f, yb + hb / 2, Math.min(hb * 0.25, S(35, 0.25)), 'thin'); // проушины
    const top = c.y0;
    const H = yb - top;
    const g = { top, H, yb };
    IconUnits.generator(c, g);
    IconUnits.engine(c, g);
    IconUnits.turbo(c, g);
    IconUnits.radiator(c, g);
  }

  /** Генератор: цилиндр с вентиляционными окнами, клеммная коробка, пульт сверху, виброопоры. */
  static generator(c, g) {
    const { sh, S, x0, w } = c;
    const { top, H, yb } = g;
    const gx0 = x0 + w * 0.03;
    const gx1 = x0 + w * 0.33;
    const gt = top + H * 0.36;
    const gbm = Math.max(0.4, S(60));
    sh.rect([gx0, gt, gx1 - gx0, yb - gbm - gt], 'main', '#fff', (yb - gt) * 0.12);
    for (const xx of [gx0 + (gx1 - gx0) * 0.1, gx1 - (gx1 - gx0) * 0.1])
      IconParts.fins(
        sh,
        [xx - Math.max(0.5, S(40)), gt + (yb - gt) * 0.2, xx + Math.max(0.5, S(40)), yb - gbm - (yb - gt) * 0.2],
        S(35),
        true,
      );
    sh.rect(
      [gx0 + (gx1 - gx0) * 0.45, gt - Math.max(0.6, H * 0.08), (gx1 - gx0) * 0.3, Math.max(0.6, H * 0.08)],
      'thin',
      '#fff',
    ); // клеммная коробка
    const pw = (gx1 - gx0) * 0.62;
    const ph = Math.min(H * 0.24, S(450, 1.5));
    const px0 = gx0 + (gx1 - gx0) * 0.08;
    const py0 = top + H * 0.02;
    sh.line(px0 + pw * 0.5, py0 + ph, px0 + pw * 0.5, gt - Math.max(0.6, H * 0.08), 'thin');
    sh.rect([px0, py0, pw, ph], 'main', '#fff');
    sh.rect([px0 + pw * 0.12, py0 + ph * 0.15, pw * 0.45, ph * 0.35], 'thin', IconParts.DARK); // пульт
    for (const f of [0.75, 0.88]) sh.circle(px0 + pw * f, py0 + ph * 0.32, Math.min(pw * 0.05, S(20, 0.2)), 'thin');
    for (const f of [0.08, 0.92])
      sh.rect([gx0 + (gx1 - gx0) * f - Math.max(0.4, S(40)), yb - gbm, Math.max(0.8, S(80)), gbm], 'thin', '#fff'); // виброопоры
    Object.assign(g, { gx1, gt, gbm });
  }

  /** Картер маховика и двигатель: блок, клапанная крышка с рёбрами, поддон, виброопоры. */
  static engine(c, g) {
    const { sh, S, x0, w } = c;
    const { top, H, yb, gx1, gt, gbm } = g;
    const ex0 = x0 + w * 0.36;
    const ex1 = x0 + w * 0.76;
    const et = top + H * 0.28;
    const eb = yb - H * 0.16;
    sh.poly(
      [
        [gx1, gt + (yb - gt) * 0.12],
        [ex0, et + (eb - et) * 0.05],
        [ex0, eb],
        [gx1, yb - gbm - (yb - gt) * 0.12],
      ],
      'thin',
      '#fff',
    );
    sh.rect([ex0, et, ex1 - ex0, eb - et], 'main', '#fff');
    sh.rect([ex0 + (ex1 - ex0) * 0.06, et - H * 0.09, (ex1 - ex0) * 0.84, H * 0.09], 'main', '#fff', H * 0.02);
    IconParts.fins(sh, [ex0 + (ex1 - ex0) * 0.08, et - H * 0.08, ex0 + (ex1 - ex0) * 0.88, et - H * 0.01], S(60), true);
    sh.rect([ex0 + (ex1 - ex0) * 0.15, eb, (ex1 - ex0) * 0.7, yb - gbm - eb], 'thin', '#fff'); // поддон
    Object.assign(g, { ex0, ex1, et, eb });
  }

  /** Турбокомпрессор с выхлопом вверх (сильфон, к глушителю), воздушный фильтр с патрубком. */
  static turbo(c, { top, H, yb, gbm, ex0, ex1, et, eb }) {
    const { sh, S, x0, w } = c;
    const tx = x0 + w * 0.62;
    const ty = et + (eb - et) * 0.28;
    const tr = Math.min(H * 0.08, S(130, 0.6));
    const ew = Math.max(0.6, Math.min(S(110), tr * 1.1));
    sh.rect([tx - ew / 2, top, ew, ty - top], 'thin', '#fff'); // выхлоп — вверх, к глушителю
    for (let y = top + H * 0.05; y < top + H * 0.14; y += Math.max(0.35, S(25)))
      sh.line(tx - ew * 0.65, y, tx + ew * 0.65, y, 'fine'); // сильфон
    sh.circle(tx, ty, tr, 'thin', '#fff');
    sh.circle(tx, ty, tr * 0.45, 'thin'); // турбокомпрессор
    const af = Math.min(H * 0.1, S(170, 0.8));
    const ax0 = ex0 + (ex1 - ex0) * 0.04;
    const ax1 = ex0 + (ex1 - ex0) * 0.5;
    const ay = top + H * 0.04;
    sh.rect([(ax0 + ax1) / 2 - af * 0.25, ay + af, af * 0.5, et - H * 0.09 - ay - af], 'thin', '#fff'); // патрубок воздушного фильтра
    sh.rect([ax0, ay, ax1 - ax0, af], 'main', '#fff', af * 0.45); // воздушный фильтр
    for (const f of [0.15, 0.85])
      sh.rect([ex0 + (ex1 - ex0) * f - Math.max(0.4, S(40)), yb - gbm, Math.max(0.8, S(80)), gbm], 'thin', '#fff');
  }

  /** Вентилятор (кожух) и радиатор с бачком. */
  static radiator(c, { top, H, yb, ex1, et, eb }) {
    const { sh, S, x1, w } = c;
    const rx0 = x1 - w * 0.16;
    const rt = top + H * 0.06;
    sh.rect([ex1, et + (eb - et) * 0.1, rx0 - ex1, (eb - et) * 0.7], 'thin', '#fff');
    sh.rect([rx0, rt, x1 - rx0 - w * 0.01, yb - rt], 'main', '#fff');
    IconParts.fins(sh, [rx0 + (x1 - rx0) * 0.08, rt + H * 0.06, x1 - w * 0.02, yb - H * 0.04], S(35), true);
    sh.rect(
      [rx0 + (x1 - rx0) * 0.15, rt - Math.max(0.5, H * 0.04), (x1 - rx0) * 0.5, Math.max(0.5, H * 0.04)],
      'thin',
      '#fff',
    ); // бачок с пробкой
  }

  /** Горизонтальный насосный агрегат: двигатель с рёбрами и кожухом вентилятора, муфта под кожухом, насос, патрубки. */
  static pump(c) {
    const { sh, S, x0, x1, w, h } = c;
    if (c.m < 3) {
      sh.rect([x0, c.y0, w, h], 'main', '#fff');
      return;
    }
    const hb = Math.min(h * 0.14, S(120, 0.6));
    const yb = c.y1 - hb;
    sh.rect([x0, yb, w, hb], 'main', '#fff');
    const top = c.y0;
    const H = yb - top;
    const ax = yb - H * 0.42;
    const mr = Math.min(H * 0.36, S(240, 1.2));
    // ось вала, радиус двигателя
    sh.line(x0 - 1, ax, x1 + 1, ax, 'axis');
    const g = { yb, H, ax, mr };
    IconUnits.pumpMotor(c, g);
    IconUnits.pumpHead(c, g);
  }

  /** Двигатель: кожух вентилятора, корпус с рёбрами, клеммная коробка, лапы. */
  static pumpMotor(c, { yb, ax, mr }) {
    const { sh, S, x0, w } = c;
    const fc = Math.max(0.8, w * 0.07);
    const mx0 = x0 + w * 0.03;
    const mx1 = x0 + w * 0.5;
    sh.rect([mx0, ax - mr * 0.82, fc, mr * 1.64], 'thin', '#fff', mr * 0.3);
    IconParts.fins(sh, [mx0 + fc * 0.2, ax - mr * 0.6, mx0 + fc * 0.8, ax + mr * 0.6], S(20), false); // кожух вентилятора
    sh.rect([mx0 + fc, ax - mr, mx1 - mx0 - fc, mr * 2], 'main', '#fff', mr * 0.15);
    IconParts.fins(sh, [mx0 + fc + mr * 0.1, ax - mr * 0.85, mx1 - mr * 0.1, ax + mr * 0.85], S(28), false);
    sh.rect(
      [
        mx0 + fc + (mx1 - mx0 - fc) * 0.4,
        ax - mr - Math.max(0.6, S(110)),
        (mx1 - mx0 - fc) * 0.3,
        Math.max(0.6, S(110)),
      ],
      'thin',
      '#fff',
    ); // клеммная коробка
    for (const f of [0.25, 0.8])
      sh.rect(
        [mx0 + fc + (mx1 - mx0 - fc) * f - Math.max(0.3, S(40)), ax + mr, Math.max(0.6, S(80)), yb - ax - mr],
        'thin',
        '#fff',
      ); // лапы
  }

  /** Кожух муфты; насос: опорный кронштейн, спиральный корпус, напорный патрубок вверх, всасывающий — по оси вправо. */
  static pumpHead(c, { yb, H, ax, mr }) {
    const { sh, S, x0, x1, w } = c;
    const mx1 = x0 + w * 0.5;
    const gx1 = x0 + w * 0.6;
    sh.poly(
      [
        [mx1, ax - mr * 0.55],
        [gx1, ax - mr * 0.4],
        [gx1, ax + mr * 0.4],
        [mx1, ax + mr * 0.55],
      ],
      'thin',
      '#fff',
    );
    const vr = Math.min(H * 0.42, (x1 - gx1) * 0.36, S(300, 1.2));
    const vx = x1 - w * 0.04 - Math.max(0.8, S(120)) - vr;
    sh.rect([gx1, ax - mr * 0.35, vx - vr * 0.6 - gx1, mr * 0.7], 'thin', '#fff');
    sh.rect([vx - vr * 0.5, ax + vr * 0.6, vr, yb - ax - vr * 0.6], 'thin', '#fff'); // опора
    const dn = Math.max(0.6, vr * 0.55);
    const nl = Math.max(0.8, S(120));
    const fl = Math.max(0.25, S(20));
    sh.rect([vx - dn / 2, ax - vr - nl, dn, nl + vr * 0.3], 'main', '#fff'); // напорный патрубок
    sh.rect([vx - dn * 0.8, ax - vr - nl - fl, dn * 1.6, fl], 'thin', '#fff');
    sh.circle(vx, ax, vr, 'main', '#fff');
    sh.circle(vx, ax, vr * 0.38, 'thin'); // спиральный корпус, глазок колеса
    sh.rect([vx + vr * 0.9, ax - dn * 0.6, nl + vr * 0.1, dn * 1.2], 'main', '#fff'); // всасывающий патрубок
    sh.rect([vx + vr + nl, ax - dn * 0.85, fl, dn * 1.7], 'thin', '#fff');
  }

  /** Вертикальный насос: двигатель с кожухом вентилятора сверху, фонарь, ступени с тягами, основание с патрубками. */
  static vpump(c) {
    const { sh, S, x0, x1, w, h, cx } = c;
    const hb = Math.min(h * 0.06, S(60, 0.4));
    const yb = c.y1 - hb;
    const ch = Math.min(h * 0.12, S(150, 0.9));
    const yc = yb - ch;
    sh.rect([x0 + w * 0.08, yb, w * 0.84, hb], 'main', '#fff'); // плита
    sh.rect([x0 + w * 0.16, yc, w * 0.68, ch], 'main', '#fff'); // камера с патрубками в линию
    for (const s of [-1, 1]) {
      const nx = s < 0 ? x0 : x1 - w * 0.16;
      const fl = Math.max(0.25, S(20));
      sh.rect([nx, yc + ch * 0.2, w * 0.16, ch * 0.6], 'thin', '#fff');
      sh.rect([s < 0 ? x0 : x1 - fl, yc + ch * 0.05, fl, ch * 0.9], 'thin', '#fff');
    }
    const st = yc - h * 0.36;
    const sw = w * 0.5;
    sh.rect([cx - sw / 2, st, sw, yc - st], 'main', '#fff');
    sh.line(cx - sw * 0.42, st, cx - sw * 0.42, yc, 'thin');
    sh.line(cx + sw * 0.42, st, cx + sw * 0.42, yc, 'thin'); // тяги
    const ln = st - h * 0.12;
    sh.rect([cx - sw * 0.4, ln, sw * 0.8, st - ln], 'thin', '#fff');
    sh.rect([cx - sw * 0.18, ln + (st - ln) * 0.25, sw * 0.36, (st - ln) * 0.5], 'thin'); // фонарь
    const mw = w * 0.7;
    const mt = c.y0 + h * 0.06;
    sh.rect([cx - mw / 2, mt, mw, ln - mt], 'main', '#fff', mw * 0.08);
    IconParts.fins(sh, [cx - mw * 0.42, mt + h * 0.04, cx + mw * 0.42, ln - h * 0.02], S(28), true);
    sh.rect([cx - mw * 0.4, c.y0, mw * 0.8, mt - c.y0], 'thin', '#fff', mw * 0.1); // кожух вентилятора
    sh.rect([cx + mw / 2, mt + (ln - mt) * 0.3, Math.max(0.6, S(110)), (ln - mt) * 0.25], 'thin', '#fff'); // клеммная коробка
    sh.line(cx, c.y0 - 1.6, cx, c.y1 + 1.2, 'axis');
  }

  static tank(c) {
    const { sh, S, x0, x1, w, h } = c;
    const hl = Math.min(h * 0.1, S(100, 0.6));
    const yb = c.y1 - hl;
    for (const f of [0.1, 0.9])
      sh.rect([x0 + w * f - Math.max(0.4, S(40)), yb - 0.3, Math.max(0.8, S(80)), hl + 0.3], 'thin', '#fff');
    sh.rect(
      [x0, c.y0 + Math.min(h * 0.1, S(120, 0.6)), w, yb - c.y0 - Math.min(h * 0.1, S(120, 0.6))],
      'main',
      '#fff',
      Math.min(w, h) * 0.06,
    );
    const top = c.y0 + Math.min(h * 0.1, S(120, 0.6));
    const H = yb - top;
    if (c.m < 3) return;
    const nw = Math.max(0.8, S(120));
    sh.rect(
      [x0 + w * 0.2 - nw / 2, top - Math.min(h * 0.08, S(100, 0.5)), nw, Math.min(h * 0.08, S(100, 0.5))],
      'thin',
      '#fff',
    ); // горловина
    sh.rect(
      [x0 + w * 0.2 - nw * 0.7, c.y0, nw * 1.4, Math.max(0.3, top - c.y0 - Math.min(h * 0.08, S(100, 0.5)))],
      'thin',
      '#fff',
    ); // крышка
    const bx = x1 - w * 0.15;
    const f = EskdSheet.f;
    const bh = Math.min(h * 0.1, S(150, 0.8));
    // дыхательный клапан
    sh.path(
      `M${f(bx)},${f(top)} L${f(bx)},${f(top - bh)} A${f(bh * 0.3)},${f(bh * 0.3)} 0 0 1 ${f(bx + bh * 0.6)},${f(top - bh)} L${f(bx + bh * 0.6)},${f(top - bh * 0.6)}`,
      'thin',
    );
    sh.rect([x0 + w * 0.45, top - Math.max(0.3, S(30)), w * 0.2, Math.max(0.3, S(30))], 'thin', '#fff'); // люк
    const gx = x0 + w * 0.08;
    const gt = top + H * 0.15;
    const gb = yb - H * 0.15;
    sh.rect([gx, gt, Math.max(0.5, S(40)), gb - gt], 'thin');
    sh.rect(
      [gx + Math.max(0.1, S(10)), gt + (gb - gt) * 0.45, Math.max(0.3, S(20)), (gb - gt) * 0.5],
      'fine',
      IconParts.DARK,
    ); // указатель уровня
    IconParts.ball(sh, x0 + w * 0.3, yb + hl * 0.3, Math.max(0.4, S(40)), true); // кран слива
  }

  static cabinetTop(c) {
    const { sh, x0, y0, x1, y1, w, h } = c;
    const f = c.front;
    sh.rect([x0, y0, w, h], 'main', '#fff');
    if (f === 'r') sh.line(x1 - 0.5, y0 + 0.4, x1 - 0.5, y1 - 0.4, 'thin');
    else if (f === 'l') sh.line(x0 + 0.5, y0 + 0.4, x0 + 0.5, y1 - 0.4, 'thin');
    else if (f === 't') sh.line(x0 + 0.4, y0 + 0.5, x1 - 0.4, y0 + 0.5, 'thin');
    else sh.line(x0 + 0.4, y1 - 0.5, x1 - 0.4, y1 - 0.5, 'thin');
  }
  /** ДГУ с торца генератора (поперёк станции, вид от прохода): рама, генератор (окружность с окнами), пульт сверху. */
  static dguEnd(c) {
    const { sh, S, x0, w, h, cx } = c;
    const hb = Math.min(h * 0.12, S(240, 0.8));
    const yb = c.y1 - hb;
    sh.rect([x0, yb, w, hb], 'main', '#fff');
    sh.rect([x0 + w * 0.04, c.y0 + h * 0.18, w * 0.92, yb - c.y0 - h * 0.18], 'main', '#fff');
    if (c.m < 4) return;
    const r = Math.min(w * 0.36, (yb - c.y0) * 0.3);
    const gy = yb - r - Math.max(0.4, S(60));
    sh.circle(cx, gy, r, 'main', '#fff');
    sh.circle(cx, gy, r * 0.35, 'thin', '#fff'); // генератор
    sh.rect([x0 + w * 0.2, c.y0, w * 0.6, h * 0.16], 'main', '#fff');
    sh.rect([x0 + w * 0.28, c.y0 + h * 0.03, w * 0.3, h * 0.06], 'thin', IconParts.DARK); // пульт
  }
  static dguTop(c) {
    const { sh, S, x0, y0, x1, w, h, cy } = c;
    sh.rect([x0, y0, w, h], 'main', '#fff');
    if (c.m < 4) return;
    sh.rect([x0 + w * 0.03, y0 + h * 0.18, w * 0.3, h * 0.64], 'main', '#fff', h * 0.12); // генератор
    sh.rect([x0 + w * 0.13, y0 + h * 0.06, w * 0.1, h * 0.12], 'thin', '#fff'); // клеммная коробка
    const ex0 = x0 + w * 0.36;
    const ex1 = x0 + w * 0.76;
    sh.rect([ex0, y0 + h * 0.22, ex1 - ex0, h * 0.56], 'main', '#fff');
    const n = 6;
    const r = Math.min((ex1 - ex0) / (n * 2.6), h * 0.06);
    for (let i = 0; i < n; i++) sh.circle(ex0 + ((ex1 - ex0) * (i + 0.5)) / n, cy - h * 0.08, r, 'thin'); // цилиндры
    sh.circle(ex0 + (ex1 - ex0) * 0.3, cy + h * 0.16, Math.min(h * 0.08, S(130)), 'thin', '#fff'); // выхлоп (турбокомпрессор)
    sh.rect([ex0 + (ex1 - ex0) * 0.5, cy + h * 0.1, (ex1 - ex0) * 0.42, h * 0.12], 'thin', '#fff', h * 0.05); // воздушный фильтр
    const rx0 = x1 - w * 0.16;
    sh.rect([rx0, y0 + h * 0.04, x1 - rx0 - w * 0.01, h * 0.92], 'main', '#fff');
    IconParts.fins(sh, [rx0, y0 + h * 0.06, x1 - w * 0.02, c.y1 - h * 0.06], S(35), true);
  }
  static pumpTop(c) {
    const { sh, S, x0, y0, x1, w, h, cy } = c;
    sh.rect([x0, y0, w, h], 'thin');
    if (c.m < 3) return;
    const mr = Math.min(h * 0.34, S(240));
    sh.rect([x0 + w * 0.03, cy - mr * 0.8, w * 0.07, mr * 1.6], 'thin', '#fff', mr * 0.3);
    sh.rect([x0 + w * 0.1, cy - mr, w * 0.4, mr * 2], 'main', '#fff', mr * 0.15);
    IconParts.fins(sh, [x0 + w * 0.12, cy - mr * 0.85, x0 + w * 0.48, cy + mr * 0.85], S(28), false);
    sh.rect([x0 + w * 0.3, cy - mr - Math.max(0.5, S(80)), w * 0.12, Math.max(0.5, S(80))], 'thin', '#fff'); // клеммная коробка
    sh.rect([x0 + w * 0.5, cy - mr * 0.45, w * 0.1, mr * 0.9], 'thin', '#fff');
    const vr = Math.min(h * 0.36, w * 0.14);
    sh.rect([x1 - w * 0.04 - vr * 2.4, cy - vr, vr * 2, vr * 2], 'main', '#fff', vr * 0.3);
    sh.circle(x1 - w * 0.04 - vr * 1.4, cy, vr * 0.45, 'thin', '#fff'); // корпус, напорный
    sh.rect([x1 - w * 0.04 - vr * 0.4, cy - vr * 0.5, vr * 0.4 + w * 0.03, vr], 'thin', '#fff'); // всасывающий
  }
  /** Вертикальный насос сверху: кожух вентилятора двигателя, клеммная коробка, патрубки в линию. */
  static vpumpTop(c) {
    const { sh, S, x0, x1, w, cx, cy, m } = c;
    const r = m * 0.36;
    sh.rect([x0, cy - m * 0.14, w, m * 0.28], 'thin', '#fff');
    for (const xx of [x0, x1 - Math.max(0.25, S(20))])
      sh.rect([xx, cy - m * 0.22, Math.max(0.25, S(20)), m * 0.44], 'thin', '#fff');
    sh.circle(cx, cy, r, 'main', '#fff');
    IconParts.fan(sh, cx, cy, r * 0.8);
    sh.rect([cx + r * 0.6, cy - r - Math.max(0.5, S(90)), r * 0.7, Math.max(0.5, S(90))], 'thin', '#fff');
  }
  static tankTop(c) {
    const { sh, S, x0, y0, w, h, m } = c;
    sh.rect([x0, y0, w, h], 'main', '#fff', m * 0.06);
    if (m < 3) return;
    sh.circle(x0 + w * 0.2, y0 + h * 0.5, Math.min(m * 0.12, S(80, 0.4)), 'thin', '#fff');
    sh.rect([x0 + w * 0.45, y0 + h * 0.3, w * 0.2, h * 0.4], 'thin');
    sh.circle(c.x1 - w * 0.15, y0 + h * 0.5, Math.min(m * 0.06, S(40, 0.3)), 'thin');
  }
  /** Глушитель ДГУ на крыше: корпус с коническими переходами и хомутами (опоры и вывод выхлопа рисует чертёж). */
  static muffler(sh, x0, y0, x1, y1) {
    const w = x1 - x0;
    const h = y1 - y0;
    if (!(w > 0.3 && h > 0.3)) return;
    const cone = Math.min(w * 0.12, h * 0.6);
    const ym = (y0 + y1) / 2;
    const p = h * 0.22;
    sh.poly(
      [
        [x0, ym - p],
        [x0 + cone, y0],
        [x1 - cone, y0],
        [x1, ym - p],
        [x1, ym + p],
        [x1 - cone, y1],
        [x0 + cone, y1],
        [x0, ym + p],
      ],
      'main',
      '#fff',
    );
    sh.line(x0 + cone, y0, x0 + cone, y1, 'thin');
    sh.line(x1 - cone, y0, x1 - cone, y1, 'thin');
    for (const t of [0.32, 0.68]) sh.line(x0 + w * t, y0, x0 + w * t, y1, 'thin'); // хомуты
    IconParts.shade(sh, [x0 + cone, y0, x1 - cone, y1], false);
    sh.line(x0 - 1.6, ym, x1 + 1.6, ym, 'axis');
  }
}
