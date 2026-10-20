import { EskdSheet } from './eskd-sheet.js';
import { IconParts } from './icon-parts.js';

/** Рисунки шкафов, ДГУ с глушителем, насосов и баков (спереди и сверху). */
export class IconUnits {
  /** Шкаф: дверь на петлях, ручка, панель оператора, лампы, вводной выключатель; сбоку — торец. */
  static cabinet(frame, floor) {
    const { sheet, scale, x0, width, height } = frame;
    const plinthH = floor ? Math.min(scale(100, 0.6), height * 0.08) : 0;
    const baseY = frame.y1 - plinthH;
    sheet.rect([x0, frame.y0, width, baseY - frame.y0], 'main', '#fff');
    if (plinthH) sheet.rect([x0, baseY, width, plinthH], 'thin', '#fff');
    if (frame.minSide < 2.5) return;
    if (frame.side) IconUnits.cabinetEnd(frame, baseY);
    else IconUnits.cabinetDoor(frame, baseY);
    if (!floor)
      for (const frac of [0.25, 0.5, 0.75])
        sheet.rect(
          [x0 + width * frac - Math.max(0.2, scale(15)), baseY, Math.max(0.4, scale(30)), Math.max(0.4, scale(45))],
          'thin',
          '#fff',
        ); // кабельные вводы
  }

  /** Сбоку — торец шкафа. */
  static cabinetEnd(frame, baseY) {
    const { sheet, scale, x1, width } = frame;
    const edge = Math.min(width * 0.2, Math.max(0.3, scale(25)));
    sheet.line(x1 - edge, frame.y0, x1 - edge, baseY, 'thin');
    sheet.rect([x1 - edge * 0.6, frame.y0 + (baseY - frame.y0) * 0.45, edge * 1.2, (baseY - frame.y0) * 0.1], 'thin');
  }

  /** Дверь на петлях с ручкой; на двери — панель оператора, лампы, вводной выключатель, решётка. */
  static cabinetDoor(frame, baseY) {
    const { sheet, scale, x0, width } = frame;
    const i = Math.max(0.35, Math.min(scale(30), width * 0.06));
    const door = { dx0: x0 + i, dy0: frame.y0 + i, dw: width - 2 * i, dh: baseY - frame.y0 - 2 * i };
    const { dx0, dy0, dw: doorW, dh: doorH } = door;
    sheet.rect([dx0, dy0, doorW, doorH], 'thin');
    for (const frac of [0.15, 0.85])
      sheet.rect(
        [
          x0 - Math.max(0.15, scale(12)),
          dy0 + doorH * frac - Math.max(0.3, scale(40)),
          Math.max(0.3, scale(24)),
          Math.max(0.6, scale(80)),
        ],
        'thin',
        '#fff',
      ); // петли
    const handleX = dx0 + doorW - Math.max(0.6, scale(55));
    sheet.rect(
      [handleX - Math.max(0.2, scale(15)), dy0 + doorH * 0.42, Math.max(0.4, scale(30)), Math.max(0.9, doorH * 0.16)],
      'thin',
      '#fff',
      0.2,
    );
    if (doorW > 3 && doorH > 4) IconUnits._cabinetPanel(frame, door);
  }

  static _cabinetPanel(frame, { dx0, dy0, dw: doorW, dh: doorH }) {
    const { sheet, scale } = frame;
    const panelW = Math.min(doorW * 0.5, scale(200));
    const panelH = Math.min(doorH * 0.16, scale(140));
    sheet.rect([dx0 + doorW * 0.12, dy0 + doorH * 0.08, panelW, panelH], 'thin', IconParts.DARK); // панель оператора
    for (let row = 0; row < 3; row++)
      sheet.circle(
        dx0 + doorW * 0.12 + panelW * (0.15 + row * 0.35),
        dy0 + doorH * 0.08 + panelH + Math.max(0.6, scale(50)),
        Math.min(doorW * 0.05, scale(18, 0.2)),
        'thin',
      );
    const switchR = Math.min(doorW * 0.1, scale(45, 0.35));
    if (doorW > 4) {
      const [switchX, switchY] = [dx0 + doorW * 0.78, dy0 + doorH * 0.14];
      sheet.circle(switchX, switchY, switchR, 'thin', '#fff');
      sheet.line(
        switchX - switchR * 0.8,
        switchY + switchR * 0.8,
        switchX + switchR * 0.8,
        switchY - switchR * 0.8,
        'thin',
      );
    } // вводной выключатель
    IconParts.louver(
      sheet,
      [dx0 + doorW * 0.2, dy0 + doorH * 0.78, dx0 + doorW * 0.7, dy0 + doorH * 0.94],
      scale(30),
      false,
    );
  }

  /** ДГУ: рама, генератор с пультом, двигатель, турбокомпрессор, вентилятор и радиатор (справа — к жалюзи). */
  static dgu(frame) {
    const { sheet, scale, x0, width, height } = frame;
    const baseH = Math.min(height * 0.12, scale(240, 0.8));
    const baseY = frame.y1 - baseH;
    sheet.rect([x0, baseY, width, baseH], 'main', '#fff');
    if (frame.minSide < 4) {
      sheet.rect([x0, frame.y0, width, baseY - frame.y0], 'main', '#fff');
      return;
    }
    for (const frac of [0.04, 0.96])
      sheet.circle(x0 + width * frac, baseY + baseH / 2, Math.min(baseH * 0.25, scale(35, 0.25)), 'thin'); // проушины
    const top = frame.y0;
    const bodyH = baseY - top;
    const geom = { top, H: bodyH, yb: baseY };
    IconUnits.generator(frame, geom);
    IconUnits.engine(frame, geom);
    IconUnits.turbo(frame, geom);
    IconUnits.radiator(frame, geom);
  }

  /** Генератор: цилиндр с вентиляционными окнами, клеммная коробка, пульт сверху, виброопоры. */
  static generator(frame, geom) {
    const { sheet, scale, x0, width } = frame;
    const { top, H: bodyH, yb: baseY } = geom;
    const gx0 = x0 + width * 0.03;
    const gx1 = x0 + width * 0.33;
    const genTop = top + bodyH * 0.36;
    const gbm = Math.max(0.4, scale(60));
    sheet.rect([gx0, genTop, gx1 - gx0, baseY - gbm - genTop], 'main', '#fff', (baseY - genTop) * 0.12);
    for (const lugX of [gx0 + (gx1 - gx0) * 0.1, gx1 - (gx1 - gx0) * 0.1])
      IconParts.fins(
        sheet,
        [
          lugX - Math.max(0.5, scale(40)),
          genTop + (baseY - genTop) * 0.2,
          lugX + Math.max(0.5, scale(40)),
          baseY - gbm - (baseY - genTop) * 0.2,
        ],
        scale(35),
        true,
      );
    sheet.rect(
      [gx0 + (gx1 - gx0) * 0.45, genTop - Math.max(0.6, bodyH * 0.08), (gx1 - gx0) * 0.3, Math.max(0.6, bodyH * 0.08)],
      'thin',
      '#fff',
    ); // клеммная коробка
    const panelW = (gx1 - gx0) * 0.62;
    const panelH = Math.min(bodyH * 0.24, scale(450, 1.5));
    const px0 = gx0 + (gx1 - gx0) * 0.08;
    const py0 = top + bodyH * 0.02;
    sheet.line(px0 + panelW * 0.5, py0 + panelH, px0 + panelW * 0.5, genTop - Math.max(0.6, bodyH * 0.08), 'thin');
    sheet.rect([px0, py0, panelW, panelH], 'main', '#fff');
    sheet.rect([px0 + panelW * 0.12, py0 + panelH * 0.15, panelW * 0.45, panelH * 0.35], 'thin', IconParts.DARK); // пульт
    for (const frac of [0.75, 0.88])
      sheet.circle(px0 + panelW * frac, py0 + panelH * 0.32, Math.min(panelW * 0.05, scale(20, 0.2)), 'thin');
    for (const frac of [0.08, 0.92])
      sheet.rect(
        [gx0 + (gx1 - gx0) * frac - Math.max(0.4, scale(40)), baseY - gbm, Math.max(0.8, scale(80)), gbm],
        'thin',
        '#fff',
      ); // виброопоры
    Object.assign(geom, { gx1, gt: genTop, gbm });
  }

  /** Картер маховика и двигатель: блок, клапанная крышка с рёбрами, поддон, виброопоры. */
  static engine(frame, geom) {
    const { sheet, scale, x0, width } = frame;
    const { top, H: bodyH, yb: baseY, gx1, gt: genTop, gbm } = geom;
    const ex0 = x0 + width * 0.36;
    const ex1 = x0 + width * 0.76;
    const engineTop = top + bodyH * 0.28;
    const engineBottom = baseY - bodyH * 0.16;
    sheet.poly(
      [
        [gx1, genTop + (baseY - genTop) * 0.12],
        [ex0, engineTop + (engineBottom - engineTop) * 0.05],
        [ex0, engineBottom],
        [gx1, baseY - gbm - (baseY - genTop) * 0.12],
      ],
      'thin',
      '#fff',
    );
    sheet.rect([ex0, engineTop, ex1 - ex0, engineBottom - engineTop], 'main', '#fff');
    sheet.rect(
      [ex0 + (ex1 - ex0) * 0.06, engineTop - bodyH * 0.09, (ex1 - ex0) * 0.84, bodyH * 0.09],
      'main',
      '#fff',
      bodyH * 0.02,
    );
    IconParts.fins(
      sheet,
      [ex0 + (ex1 - ex0) * 0.08, engineTop - bodyH * 0.08, ex0 + (ex1 - ex0) * 0.88, engineTop - bodyH * 0.01],
      scale(60),
      true,
    );
    sheet.rect([ex0 + (ex1 - ex0) * 0.15, engineBottom, (ex1 - ex0) * 0.7, baseY - gbm - engineBottom], 'thin', '#fff'); // поддон
    Object.assign(geom, { ex0, ex1, et: engineTop, eb: engineBottom });
  }

  /** Турбокомпрессор с выхлопом вверх (сильфон, к глушителю), воздушный фильтр с патрубком. */
  static turbo(frame, { top, H: bodyH, yb: baseY, gbm, ex0, ex1, et: engineTop, eb: engineBottom }) {
    const { sheet, scale, x0, width } = frame;
    const turboX = x0 + width * 0.62;
    const turboY = engineTop + (engineBottom - engineTop) * 0.28;
    const turboR = Math.min(bodyH * 0.08, scale(130, 0.6));
    const exhaustW = Math.max(0.6, Math.min(scale(110), turboR * 1.1));
    sheet.rect([turboX - exhaustW / 2, top, exhaustW, turboY - top], 'thin', '#fff'); // выхлоп — вверх, к глушителю
    for (let y = top + bodyH * 0.05; y < top + bodyH * 0.14; y += Math.max(0.35, scale(25)))
      sheet.line(turboX - exhaustW * 0.65, y, turboX + exhaustW * 0.65, y, 'fine'); // сильфон
    sheet.circle(turboX, turboY, turboR, 'thin', '#fff');
    sheet.circle(turboX, turboY, turboR * 0.45, 'thin'); // турбокомпрессор
    const filterH = Math.min(bodyH * 0.1, scale(170, 0.8));
    const ax0 = ex0 + (ex1 - ex0) * 0.04;
    const ax1 = ex0 + (ex1 - ex0) * 0.5;
    const filterY = top + bodyH * 0.04;
    sheet.rect(
      [
        (ax0 + ax1) / 2 - filterH * 0.25,
        filterY + filterH,
        filterH * 0.5,
        engineTop - bodyH * 0.09 - filterY - filterH,
      ],
      'thin',
      '#fff',
    ); // патрубок воздушного фильтра
    sheet.rect([ax0, filterY, ax1 - ax0, filterH], 'main', '#fff', filterH * 0.45); // воздушный фильтр
    for (const frac of [0.15, 0.85])
      sheet.rect(
        [ex0 + (ex1 - ex0) * frac - Math.max(0.4, scale(40)), baseY - gbm, Math.max(0.8, scale(80)), gbm],
        'thin',
        '#fff',
      );
  }

  /** Вентилятор (кожух) и радиатор с бачком. */
  static radiator(frame, { top, H: bodyH, yb: baseY, ex1, et: engineTop, eb: engineBottom }) {
    const { sheet, scale, x1, width } = frame;
    const rx0 = x1 - width * 0.16;
    const radTop = top + bodyH * 0.06;
    sheet.rect(
      [ex1, engineTop + (engineBottom - engineTop) * 0.1, rx0 - ex1, (engineBottom - engineTop) * 0.7],
      'thin',
      '#fff',
    );
    sheet.rect([rx0, radTop, x1 - rx0 - width * 0.01, baseY - radTop], 'main', '#fff');
    IconParts.fins(
      sheet,
      [rx0 + (x1 - rx0) * 0.08, radTop + bodyH * 0.06, x1 - width * 0.02, baseY - bodyH * 0.04],
      scale(35),
      true,
    );
    sheet.rect(
      [rx0 + (x1 - rx0) * 0.15, radTop - Math.max(0.5, bodyH * 0.04), (x1 - rx0) * 0.5, Math.max(0.5, bodyH * 0.04)],
      'thin',
      '#fff',
    ); // бачок с пробкой
  }

  /** Горизонтальный насосный агрегат: двигатель с рёбрами и кожухом вентилятора, муфта под кожухом, насос, патрубки. */
  static pump(frame) {
    const { sheet, scale, x0, x1, width, height } = frame;
    if (frame.minSide < 3) {
      sheet.rect([x0, frame.y0, width, height], 'main', '#fff');
      return;
    }
    const baseH = Math.min(height * 0.14, scale(120, 0.6));
    const baseY = frame.y1 - baseH;
    sheet.rect([x0, baseY, width, baseH], 'main', '#fff');
    const top = frame.y0;
    const bodyH = baseY - top;
    const axisY = baseY - bodyH * 0.42;
    const motorR = Math.min(bodyH * 0.36, scale(240, 1.2));
    // ось вала, радиус двигателя
    sheet.line(x0 - 1, axisY, x1 + 1, axisY, 'axis');
    const geom = { yb: baseY, H: bodyH, ax: axisY, mr: motorR };
    IconUnits.pumpMotor(frame, geom);
    IconUnits.pumpHead(frame, geom);
  }

  /** Двигатель: кожух вентилятора, корпус с рёбрами, клеммная коробка, лапы. */
  static pumpMotor(frame, { yb: baseY, ax: axisY, mr: motorR }) {
    const { sheet, scale, x0, width } = frame;
    const flangeW = Math.max(0.8, width * 0.07);
    const mx0 = x0 + width * 0.03;
    const mx1 = x0 + width * 0.5;
    sheet.rect([mx0, axisY - motorR * 0.82, flangeW, motorR * 1.64], 'thin', '#fff', motorR * 0.3);
    IconParts.fins(
      sheet,
      [mx0 + flangeW * 0.2, axisY - motorR * 0.6, mx0 + flangeW * 0.8, axisY + motorR * 0.6],
      scale(20),
      false,
    ); // кожух вентилятора
    sheet.rect([mx0 + flangeW, axisY - motorR, mx1 - mx0 - flangeW, motorR * 2], 'main', '#fff', motorR * 0.15);
    IconParts.fins(
      sheet,
      [mx0 + flangeW + motorR * 0.1, axisY - motorR * 0.85, mx1 - motorR * 0.1, axisY + motorR * 0.85],
      scale(28),
      false,
    );
    sheet.rect(
      [
        mx0 + flangeW + (mx1 - mx0 - flangeW) * 0.4,
        axisY - motorR - Math.max(0.6, scale(110)),
        (mx1 - mx0 - flangeW) * 0.3,
        Math.max(0.6, scale(110)),
      ],
      'thin',
      '#fff',
    ); // клеммная коробка
    for (const frac of [0.25, 0.8])
      sheet.rect(
        [
          mx0 + flangeW + (mx1 - mx0 - flangeW) * frac - Math.max(0.3, scale(40)),
          axisY + motorR,
          Math.max(0.6, scale(80)),
          baseY - axisY - motorR,
        ],
        'thin',
        '#fff',
      ); // лапы
  }

  /** Кожух муфты; насос: опорный кронштейн, спиральный корпус, напорный патрубок вверх, всасывающий — по оси вправо. */
  static pumpHead(frame, { yb: baseY, H: bodyH, ax: axisY, mr: motorR }) {
    const { sheet, scale, x0, x1, width } = frame;
    const mx1 = x0 + width * 0.5;
    const gx1 = x0 + width * 0.6;
    sheet.poly(
      [
        [mx1, axisY - motorR * 0.55],
        [gx1, axisY - motorR * 0.4],
        [gx1, axisY + motorR * 0.4],
        [mx1, axisY + motorR * 0.55],
      ],
      'thin',
      '#fff',
    );
    const voluteR = Math.min(bodyH * 0.42, (x1 - gx1) * 0.36, scale(300, 1.2));
    const voluteX = x1 - width * 0.04 - Math.max(0.8, scale(120)) - voluteR;
    sheet.rect([gx1, axisY - motorR * 0.35, voluteX - voluteR * 0.6 - gx1, motorR * 0.7], 'thin', '#fff');
    sheet.rect(
      [voluteX - voluteR * 0.5, axisY + voluteR * 0.6, voluteR, baseY - axisY - voluteR * 0.6],
      'thin',
      '#fff',
    ); // опора
    const nozzle = Math.max(0.6, voluteR * 0.55);
    const nozzleL = Math.max(0.8, scale(120));
    const flangeT = Math.max(0.25, scale(20));
    sheet.rect([voluteX - nozzle / 2, axisY - voluteR - nozzleL, nozzle, nozzleL + voluteR * 0.3], 'main', '#fff'); // напорный патрубок
    sheet.rect([voluteX - nozzle * 0.8, axisY - voluteR - nozzleL - flangeT, nozzle * 1.6, flangeT], 'thin', '#fff');
    sheet.circle(voluteX, axisY, voluteR, 'main', '#fff');
    sheet.circle(voluteX, axisY, voluteR * 0.38, 'thin'); // спиральный корпус, глазок колеса
    sheet.rect([voluteX + voluteR * 0.9, axisY - nozzle * 0.6, nozzleL + voluteR * 0.1, nozzle * 1.2], 'main', '#fff'); // всасывающий патрубок
    sheet.rect([voluteX + voluteR + nozzleL, axisY - nozzle * 0.85, flangeT, nozzle * 1.7], 'thin', '#fff');
  }

  /** Вертикальный насос: двигатель с кожухом вентилятора сверху, фонарь, ступени с тягами, основание с патрубками. */
  static vpump(frame) {
    const { sheet, scale, x0, x1, width, height, centerX } = frame;
    const baseH = Math.min(height * 0.06, scale(60, 0.4));
    const baseY = frame.y1 - baseH;
    const chamberH = Math.min(height * 0.12, scale(150, 0.9));
    const chamberY = baseY - chamberH;
    sheet.rect([x0 + width * 0.08, baseY, width * 0.84, baseH], 'main', '#fff'); // плита
    sheet.rect([x0 + width * 0.16, chamberY, width * 0.68, chamberH], 'main', '#fff'); // камера с патрубками в линию
    for (const side of [-1, 1]) {
      const nozzleX = side < 0 ? x0 : x1 - width * 0.16;
      const flangeT = Math.max(0.25, scale(20));
      sheet.rect([nozzleX, chamberY + chamberH * 0.2, width * 0.16, chamberH * 0.6], 'thin', '#fff');
      sheet.rect([side < 0 ? x0 : x1 - flangeT, chamberY + chamberH * 0.05, flangeT, chamberH * 0.9], 'thin', '#fff');
    }
    const stackTop = chamberY - height * 0.36;
    const stackW = width * 0.5;
    sheet.rect([centerX - stackW / 2, stackTop, stackW, chamberY - stackTop], 'main', '#fff');
    sheet.line(centerX - stackW * 0.42, stackTop, centerX - stackW * 0.42, chamberY, 'thin');
    sheet.line(centerX + stackW * 0.42, stackTop, centerX + stackW * 0.42, chamberY, 'thin'); // тяги
    const lanternY = stackTop - height * 0.12;
    sheet.rect([centerX - stackW * 0.4, lanternY, stackW * 0.8, stackTop - lanternY], 'thin', '#fff');
    sheet.rect(
      [centerX - stackW * 0.18, lanternY + (stackTop - lanternY) * 0.25, stackW * 0.36, (stackTop - lanternY) * 0.5],
      'thin',
    ); // фонарь
    const motorW = width * 0.7;
    const motorTop = frame.y0 + height * 0.06;
    sheet.rect([centerX - motorW / 2, motorTop, motorW, lanternY - motorTop], 'main', '#fff', motorW * 0.08);
    IconParts.fins(
      sheet,
      [centerX - motorW * 0.42, motorTop + height * 0.04, centerX + motorW * 0.42, lanternY - height * 0.02],
      scale(28),
      true,
    );
    sheet.rect([centerX - motorW * 0.4, frame.y0, motorW * 0.8, motorTop - frame.y0], 'thin', '#fff', motorW * 0.1); // кожух вентилятора
    sheet.rect(
      [
        centerX + motorW / 2,
        motorTop + (lanternY - motorTop) * 0.3,
        Math.max(0.6, scale(110)),
        (lanternY - motorTop) * 0.25,
      ],
      'thin',
      '#fff',
    ); // клеммная коробка
    sheet.line(centerX, frame.y0 - 1.6, centerX, frame.y1 + 1.2, 'axis');
  }

  /** Топливный бак — вид спереди. */
  static tank(frame) {
    const { top, bodyH, baseY, legH } = IconUnits._tankBody(frame);
    if (frame.minSide < 3) return;
    IconUnits._tankTop(frame, top);
    IconUnits._tankGauge(frame, top, bodyH, baseY);
    IconParts.ball(frame.sheet, frame.x0 + frame.width * 0.3, baseY + legH * 0.3, Math.max(0.4, frame.scale(40)), true); // кран слива
  }

  /** Опоры и корпус бака. */
  static _tankBody(frame) {
    const { sheet, scale, x0, width, height } = frame;
    const legH = Math.min(height * 0.1, scale(100, 0.6));
    const baseY = frame.y1 - legH;
    for (const frac of [0.1, 0.9])
      sheet.rect(
        [x0 + width * frac - Math.max(0.4, scale(40)), baseY - 0.3, Math.max(0.8, scale(80)), legH + 0.3],
        'thin',
        '#fff',
      );
    const top = frame.y0 + Math.min(height * 0.1, scale(120, 0.6));
    sheet.rect([x0, top, width, baseY - top], 'main', '#fff', Math.min(width, height) * 0.06);
    return { top, bodyH: baseY - top, baseY, legH };
  }

  /** Горловина с крышкой, дыхательный клапан, люк. */
  static _tankTop(frame, top) {
    const { sheet, scale, x0, x1, width, height } = frame;
    const neckW = Math.max(0.8, scale(120));
    const neckH = Math.min(height * 0.08, scale(100, 0.5));
    sheet.rect([x0 + width * 0.2 - neckW / 2, top - neckH, neckW, neckH], 'thin', '#fff'); // горловина
    sheet.rect(
      [x0 + width * 0.2 - neckW * 0.7, frame.y0, neckW * 1.4, Math.max(0.3, top - frame.y0 - neckH)],
      'thin',
      '#fff',
    ); // крышка
    const ventX = x1 - width * 0.15;
    const fmt = EskdSheet.fmt;
    const ventH = Math.min(height * 0.1, scale(150, 0.8));
    sheet.path(
      `M${fmt(ventX)},${fmt(top)} L${fmt(ventX)},${fmt(top - ventH)} A${fmt(ventH * 0.3)},${fmt(ventH * 0.3)} 0 0 1 ${fmt(ventX + ventH * 0.6)},${fmt(top - ventH)} L${fmt(ventX + ventH * 0.6)},${fmt(top - ventH * 0.6)}`,
      'thin',
    );
    sheet.rect(
      [x0 + width * 0.45, top - Math.max(0.3, scale(30)), width * 0.2, Math.max(0.3, scale(30))],
      'thin',
      '#fff',
    ); // люк
  }

  /** Указатель уровня. */
  static _tankGauge(frame, top, bodyH, baseY) {
    const { sheet, scale, x0, width } = frame;
    const gaugeX = x0 + width * 0.08;
    const gaugeTop = top + bodyH * 0.15;
    const gaugeBottom = baseY - bodyH * 0.15;
    sheet.rect([gaugeX, gaugeTop, Math.max(0.5, scale(40)), gaugeBottom - gaugeTop], 'thin');
    sheet.rect(
      [
        gaugeX + Math.max(0.1, scale(10)),
        gaugeTop + (gaugeBottom - gaugeTop) * 0.45,
        Math.max(0.3, scale(20)),
        (gaugeBottom - gaugeTop) * 0.5,
      ],
      'fine',
      IconParts.DARK,
    );
  }

  /** Шкаф — вид сверху. */
  static cabinetTop(frame) {
    const { sheet, x0, y0, x1, y1, width, height } = frame;
    const face = frame.front;
    sheet.rect([x0, y0, width, height], 'main', '#fff');
    if (face === 'r') sheet.line(x1 - 0.5, y0 + 0.4, x1 - 0.5, y1 - 0.4, 'thin');
    else if (face === 'l') sheet.line(x0 + 0.5, y0 + 0.4, x0 + 0.5, y1 - 0.4, 'thin');
    else if (face === 't') sheet.line(x0 + 0.4, y0 + 0.5, x1 - 0.4, y0 + 0.5, 'thin');
    else sheet.line(x0 + 0.4, y1 - 0.5, x1 - 0.4, y1 - 0.5, 'thin');
  }
  /** ДГУ с торца генератора (поперёк станции, вид от прохода): рама, генератор (окружность с окнами), пульт сверху. */
  static dguEnd(frame) {
    const { sheet, scale, x0, width, height, centerX } = frame;
    const baseH = Math.min(height * 0.12, scale(240, 0.8));
    const baseY = frame.y1 - baseH;
    sheet.rect([x0, baseY, width, baseH], 'main', '#fff');
    sheet.rect(
      [x0 + width * 0.04, frame.y0 + height * 0.18, width * 0.92, baseY - frame.y0 - height * 0.18],
      'main',
      '#fff',
    );
    if (frame.minSide < 4) return;
    const radius = Math.min(width * 0.36, (baseY - frame.y0) * 0.3);
    const gridY = baseY - radius - Math.max(0.4, scale(60));
    sheet.circle(centerX, gridY, radius, 'main', '#fff');
    sheet.circle(centerX, gridY, radius * 0.35, 'thin', '#fff'); // генератор
    sheet.rect([x0 + width * 0.2, frame.y0, width * 0.6, height * 0.16], 'main', '#fff');
    sheet.rect([x0 + width * 0.28, frame.y0 + height * 0.03, width * 0.3, height * 0.06], 'thin', IconParts.DARK); // пульт
  }
  /** ДГУ — вид сверху. */
  static dguTop(frame) {
    const { sheet, scale, x0, y0, x1, width, height, centerY } = frame;
    sheet.rect([x0, y0, width, height], 'main', '#fff');
    if (frame.minSide < 4) return;
    sheet.rect([x0 + width * 0.03, y0 + height * 0.18, width * 0.3, height * 0.64], 'main', '#fff', height * 0.12); // генератор
    sheet.rect([x0 + width * 0.13, y0 + height * 0.06, width * 0.1, height * 0.12], 'thin', '#fff'); // клеммная коробка
    const ex0 = x0 + width * 0.36;
    const ex1 = x0 + width * 0.76;
    sheet.rect([ex0, y0 + height * 0.22, ex1 - ex0, height * 0.56], 'main', '#fff');
    const count = 6;
    const radius = Math.min((ex1 - ex0) / (count * 2.6), height * 0.06);
    for (let i = 0; i < count; i++)
      sheet.circle(ex0 + ((ex1 - ex0) * (i + 0.5)) / count, centerY - height * 0.08, radius, 'thin'); // цилиндры
    sheet.circle(ex0 + (ex1 - ex0) * 0.3, centerY + height * 0.16, Math.min(height * 0.08, scale(130)), 'thin', '#fff'); // выхлоп (турбокомпрессор)
    sheet.rect(
      [ex0 + (ex1 - ex0) * 0.5, centerY + height * 0.1, (ex1 - ex0) * 0.42, height * 0.12],
      'thin',
      '#fff',
      height * 0.05,
    ); // воздушный фильтр
    const rx0 = x1 - width * 0.16;
    sheet.rect([rx0, y0 + height * 0.04, x1 - rx0 - width * 0.01, height * 0.92], 'main', '#fff');
    IconParts.fins(sheet, [rx0, y0 + height * 0.06, x1 - width * 0.02, frame.y1 - height * 0.06], scale(35), true);
  }
  /** Насос — вид сверху. */
  static pumpTop(frame) {
    const { sheet, scale, x0, y0, x1, width, height, centerY } = frame;
    sheet.rect([x0, y0, width, height], 'thin');
    if (frame.minSide < 3) return;
    const motorR = Math.min(height * 0.34, scale(240));
    sheet.rect([x0 + width * 0.03, centerY - motorR * 0.8, width * 0.07, motorR * 1.6], 'thin', '#fff', motorR * 0.3);
    sheet.rect([x0 + width * 0.1, centerY - motorR, width * 0.4, motorR * 2], 'main', '#fff', motorR * 0.15);
    IconParts.fins(
      sheet,
      [x0 + width * 0.12, centerY - motorR * 0.85, x0 + width * 0.48, centerY + motorR * 0.85],
      scale(28),
      false,
    );
    sheet.rect(
      [x0 + width * 0.3, centerY - motorR - Math.max(0.5, scale(80)), width * 0.12, Math.max(0.5, scale(80))],
      'thin',
      '#fff',
    ); // клеммная коробка
    sheet.rect([x0 + width * 0.5, centerY - motorR * 0.45, width * 0.1, motorR * 0.9], 'thin', '#fff');
    const voluteR = Math.min(height * 0.36, width * 0.14);
    sheet.rect(
      [x1 - width * 0.04 - voluteR * 2.4, centerY - voluteR, voluteR * 2, voluteR * 2],
      'main',
      '#fff',
      voluteR * 0.3,
    );
    sheet.circle(x1 - width * 0.04 - voluteR * 1.4, centerY, voluteR * 0.45, 'thin', '#fff'); // корпус, напорный
    sheet.rect(
      [x1 - width * 0.04 - voluteR * 0.4, centerY - voluteR * 0.5, voluteR * 0.4 + width * 0.03, voluteR],
      'thin',
      '#fff',
    ); // всасывающий
  }
  /** Вертикальный насос сверху: кожух вентилятора двигателя, клеммная коробка, патрубки в линию. */
  static vpumpTop(frame) {
    const { sheet, scale, x0, x1, width, centerX, centerY, minSide } = frame;
    const radius = minSide * 0.36;
    sheet.rect([x0, centerY - minSide * 0.14, width, minSide * 0.28], 'thin', '#fff');
    for (const slotX of [x0, x1 - Math.max(0.25, scale(20))])
      sheet.rect([slotX, centerY - minSide * 0.22, Math.max(0.25, scale(20)), minSide * 0.44], 'thin', '#fff');
    sheet.circle(centerX, centerY, radius, 'main', '#fff');
    IconParts.fan(sheet, centerX, centerY, radius * 0.8);
    sheet.rect(
      [centerX + radius * 0.6, centerY - radius - Math.max(0.5, scale(90)), radius * 0.7, Math.max(0.5, scale(90))],
      'thin',
      '#fff',
    );
  }
  /** Бак — вид сверху. */
  static tankTop(frame) {
    const { sheet, scale, x0, y0, width, height, minSide } = frame;
    sheet.rect([x0, y0, width, height], 'main', '#fff', minSide * 0.06);
    if (minSide < 3) return;
    sheet.circle(x0 + width * 0.2, y0 + height * 0.5, Math.min(minSide * 0.12, scale(80, 0.4)), 'thin', '#fff');
    sheet.rect([x0 + width * 0.45, y0 + height * 0.3, width * 0.2, height * 0.4], 'thin');
    sheet.circle(frame.x1 - width * 0.15, y0 + height * 0.5, Math.min(minSide * 0.06, scale(40, 0.3)), 'thin');
  }
  /** Глушитель ДГУ на крыше: корпус с коническими переходами и хомутами (опоры и вывод выхлопа рисует чертёж). */
  static muffler(sheet, x0, y0, x1, y1) {
    const width = x1 - x0;
    const height = y1 - y0;
    if (!(width > 0.3 && height > 0.3)) return;
    const cone = Math.min(width * 0.12, height * 0.6);
    const midY = (y0 + y1) / 2;
    const pinch = height * 0.22;
    sheet.poly(
      [
        [x0, midY - pinch],
        [x0 + cone, y0],
        [x1 - cone, y0],
        [x1, midY - pinch],
        [x1, midY + pinch],
        [x1 - cone, y1],
        [x0 + cone, y1],
        [x0, midY + pinch],
      ],
      'main',
      '#fff',
    );
    sheet.line(x0 + cone, y0, x0 + cone, y1, 'thin');
    sheet.line(x1 - cone, y0, x1 - cone, y1, 'thin');
    for (const frac of [0.32, 0.68]) sheet.line(x0 + width * frac, y0, x0 + width * frac, y1, 'thin'); // хомуты
    IconParts.shade(sheet, [x0 + cone, y0, x1 - cone, y1], false);
    sheet.line(x0 - 1.6, midY, x1 + 1.6, midY, 'axis');
  }
}
