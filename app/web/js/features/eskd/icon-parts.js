import { EskdSheet } from './eskd-sheet.js';

/** Детали рисунков оборудования: решётки, рёбра, обечайки, приборы, арматура, рама. */
export class IconParts {
  static DARK = '#2b2f33'; // дисплей, окно уровня

  /** Простой корпус по рамке. */
  static box(frame) {
    frame.sheet.rect([frame.x0, frame.y0, frame.width, frame.height], 'main', '#fff');
    if (frame.minSide > 3)
      frame.sheet.rect(
        [frame.x0 + frame.width * 0.1, frame.y0 + frame.height * 0.1, frame.width * 0.8, frame.height * 0.8],
        'thin',
      );
  }
  /** Решётка — ламели с шагом step (не чаще 0,6 мм листа). */
  static louver(sheet, [x0, y0, x1, y1], step, frame = true) {
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    if (frame) sheet.rect([x0, y0, x1 - x0, y1 - y0], 'thin');
    const pitch = Math.max(0.6, step);
    for (let y = y0 + pitch * 0.7; y < y1 - pitch * 0.3; y += pitch) sheet.line(x0 + 0.25, y, x1 - 0.25, y, 'fine');
  }
  /** Перфорированная панель — точки сеткой. */
  static perforated(sheet, [x0, y0, x1, y1], step) {
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    sheet.rect([x0, y0, x1 - x0, y1 - y0], 'thin');
    const pitch = Math.max(0.75, step);
    const countX = Math.floor((x1 - x0) / pitch);
    const countY = Math.floor((y1 - y0) / pitch);
    const offsetX = x0 + (x1 - x0 - (countX - 1) * pitch) / 2;
    const offsetY = y0 + (y1 - y0 - (countY - 1) * pitch) / 2;
    if (countX * countY > 1600) return;
    for (let i = 0; i < countX; i++)
      for (let j = 0; j < countY; j++)
        sheet.dot(offsetX + i * pitch, offsetY + j * pitch, Math.min(0.14, pitch * 0.16));
  }
  /** Решётка вентилятора: кольца, спицы, ступица. */
  static fan(sheet, centerX, centerY, radius) {
    if (radius < 0.8) return;
    sheet.circle(centerX, centerY, radius, 'thin', '#fff');
    sheet.circle(centerX, centerY, radius * 0.66, 'fine');
    if (radius > 1.8) sheet.circle(centerX, centerY, radius * 0.36, 'fine');
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      sheet.line(
        centerX + Math.cos(angle) * radius * 0.16,
        centerY + Math.sin(angle) * radius * 0.16,
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
        'fine',
      );
    }
    sheet.circle(centerX, centerY, radius * 0.16, 'thin', '#fff');
  }
  /** Круглый прибор: манометр, индикатор. */
  static gauge(sheet, centerX, centerY, radius) {
    sheet.circle(centerX, centerY, radius, 'thin', '#fff');
    if (radius > 0.5) sheet.line(centerX, centerY, centerX + radius * 0.55, centerY - radius * 0.55, 'thin');
  }
  /** Рёбра охлаждения: линии вдоль оси. */
  static fins(sheet, [x0, y0, x1, y1], step, vertical) {
    const pitch = Math.max(0.55, step);
    if (vertical) for (let x = x0 + pitch * 0.6; x < x1 - pitch * 0.3; x += pitch) sheet.line(x, y0, x, y1, 'fine');
    else for (let y = y0 + pitch * 0.6; y < y1 - pitch * 0.3; y += pitch) sheet.line(x0, y, x1, y, 'fine');
  }
  /** Штрихи светотени на цилиндре (вдоль оси): у левой кромки — два, у правой — один. */
  static shade(sheet, [x0, y0, x1, y1], vertical = true) {
    if (vertical) {
      const width = x1 - x0;
      if (width < 2.5 || y1 - y0 < 1) return;
      for (const frac of [0.09, 0.17, 0.9]) sheet.line(x0 + width * frac, y0, x0 + width * frac, y1, 'fine');
    } else {
      const height = y1 - y0;
      if (height < 2.5 || x1 - x0 < 1) return;
      for (const frac of [0.1, 0.19, 0.88]) sheet.line(x0, y0 + height * frac, x1, y0 + height * frac, 'fine');
    }
  }
  /** Обечайка с эллиптическими днищами (2:1), вертикальная: x0…x1, y0…y1; швы — тонкие. */
  static shell(sheet, [x0, y0, x1, y1], seams = true) {
    const width = x1 - x0;
    const height = y1 - y0;
    const radiusX = width / 2;
    const radiusY = Math.min(width / 4, height / 4);
    const fmt = EskdSheet.fmt;
    sheet.path(
      `M${fmt(x0)},${fmt(y0 + radiusY)} A${fmt(radiusX)},${fmt(radiusY)} 0 0 1 ${fmt(x1)},${fmt(y0 + radiusY)} L${fmt(x1)},${fmt(y1 - radiusY)} A${fmt(radiusX)},${fmt(radiusY)} 0 0 1 ${fmt(x0)},${fmt(y1 - radiusY)} Z`,
      'main',
      '#fff',
    );
    if (seams && height > 4 * radiusY) {
      sheet.line(x0, y0 + radiusY, x1, y0 + radiusY, 'thin');
      sheet.line(x0, y1 - radiusY, x1, y1 - radiusY, 'thin');
    }
    return radiusY;
  }
  /** Горизонтальная обечайка с днищами. */
  static hshell(sheet, [x0, y0, x1, y1], seams = true) {
    const width = x1 - x0;
    const height = y1 - y0;
    const radiusY = height / 2;
    const radiusX = Math.min(height / 4, width / 4);
    const fmt = EskdSheet.fmt;
    sheet.path(
      `M${fmt(x0 + radiusX)},${fmt(y0)} L${fmt(x1 - radiusX)},${fmt(y0)} A${fmt(radiusX)},${fmt(radiusY)} 0 0 1 ${fmt(x1 - radiusX)},${fmt(y1)} L${fmt(x0 + radiusX)},${fmt(y1)} A${fmt(radiusX)},${fmt(radiusY)} 0 0 1 ${fmt(x0 + radiusX)},${fmt(y0)} Z`,
      'main',
      '#fff',
    );
    if (seams && width > 4 * radiusX) {
      sheet.line(x0 + radiusX, y0, x0 + radiusX, y1, 'thin');
      sheet.line(x1 - radiusX, y0, x1 - radiusX, y1, 'thin');
    }
    return radiusX;
  }
  /** Предохранительный клапан (корпус, пружинный колпак, рычаг) — вверх от (x, y). */
  static safety(sheet, x, y, size) {
    const bolt = Math.max(0.5, size);
    sheet.rect([x - bolt * 0.35, y - bolt * 0.8, bolt * 0.7, bolt * 0.8], 'thin', '#fff');
    sheet.rect([x - bolt * 0.22, y - bolt * 1.9, bolt * 0.44, bolt * 1.1], 'thin', '#fff');
    sheet.line(x + bolt * 0.22, y - bolt * 1.6, x + bolt * 0.75, y - bolt * 1.95, 'thin');
    sheet.rect([x + bolt * 0.35, y - bolt * 0.6, bolt * 0.45, bolt * 0.35], 'thin', '#fff');
  }
  /** Шаровой кран с рукояткой: корпус в (x, y) на вертикальной трубе. */
  static ball(sheet, x, y, size, horizontal) {
    const bolt = Math.max(0.45, size);
    if (horizontal) {
      sheet.rect([x - bolt * 0.55, y - bolt * 0.4, bolt * 1.1, bolt * 0.8], 'thin', '#fff');
      sheet.line(x, y - bolt * 0.4, x + bolt * 1.1, y - bolt * 0.9, 'thin');
    } else {
      sheet.rect([x - bolt * 0.4, y - bolt * 0.55, bolt * 0.8, bolt * 1.1], 'thin', '#fff');
      sheet.line(x + bolt * 0.4, y, x + bolt * 1.2, y + bolt * 0.3, 'thin');
    }
  }
  /** Рама с проёмами под вилы погрузчика. */
  static skid(sheet, [x0, x1], [y0, y1], scale) {
    const width = x1 - x0;
    const baseH = y1 - y0;
    sheet.rect([x0, y0, width, baseH], 'main', '#fff');
    if (width > 6 && baseH > 0.6)
      for (const frac of [0.24, 0.76]) {
        const panelW = Math.max(1, Math.min(scale(220), width * 0.18));
        sheet.rect([x0 + width * frac - panelW / 2, y0 + baseH * 0.25, panelW, baseH * 0.5], 'thin');
      }
  }

  /** Зеркально по горизонтали в пределах x0…x1 листа (рисунок fn). */
  static mirror(sheet, x0, x1, draw) {
    const fmt = EskdSheet.fmt;
    return sheet.group(`translate(${fmt(x0 + x1)} 0) scale(-1 1)`, draw);
  }
  /** Центровые линии окружности: штрихпунктирные, за контур. */
  static axes(sheet, centerX, centerY, radius) {
    sheet.line(centerX - radius, centerY, centerX + radius, centerY, 'axis');
    sheet.line(centerX, centerY - radius, centerX, centerY + radius, 'axis');
  }
}
