import { EskdSheet } from './eskd-sheet.js';

/** Детали рисунков оборудования: решётки, рёбра, обечайки, приборы, арматура, рама. */
export class IconParts {
  static DARK = '#2b2f33'; // дисплей, окно уровня

  static box(c) {
    c.sh.rect([c.x0, c.y0, c.w, c.h], 'main', '#fff');
    if (c.m > 3) c.sh.rect([c.x0 + c.w * 0.1, c.y0 + c.h * 0.1, c.w * 0.8, c.h * 0.8], 'thin');
  }
  /** Решётка — ламели с шагом step (не чаще 0,6 мм листа). */
  static louver(sh, [x0, y0, x1, y1], step, frame = true) {
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    if (frame) sh.rect([x0, y0, x1 - x0, y1 - y0], 'thin');
    const s = Math.max(0.6, step);
    for (let y = y0 + s * 0.7; y < y1 - s * 0.3; y += s) sh.line(x0 + 0.25, y, x1 - 0.25, y, 'fine');
  }
  /** Перфорированная панель — точки сеткой. */
  static perforated(sh, [x0, y0, x1, y1], step) {
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    sh.rect([x0, y0, x1 - x0, y1 - y0], 'thin');
    const s = Math.max(0.75, step);
    const nx = Math.floor((x1 - x0) / s);
    const ny = Math.floor((y1 - y0) / s);
    const ox = x0 + (x1 - x0 - (nx - 1) * s) / 2;
    const oy = y0 + (y1 - y0 - (ny - 1) * s) / 2;
    if (nx * ny > 1600) return;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) sh.dot(ox + i * s, oy + j * s, Math.min(0.14, s * 0.16));
  }
  /** Решётка вентилятора: кольца, спицы, ступица. */
  static fan(sh, cx, cy, r) {
    if (r < 0.8) return;
    sh.circle(cx, cy, r, 'thin', '#fff');
    sh.circle(cx, cy, r * 0.66, 'fine');
    if (r > 1.8) sh.circle(cx, cy, r * 0.36, 'fine');
    for (let i = 0; i < 4; i++) {
      const t = Math.PI / 4 + (i * Math.PI) / 2;
      sh.line(
        cx + Math.cos(t) * r * 0.16,
        cy + Math.sin(t) * r * 0.16,
        cx + Math.cos(t) * r,
        cy + Math.sin(t) * r,
        'fine',
      );
    }
    sh.circle(cx, cy, r * 0.16, 'thin', '#fff');
  }
  /** Круглый прибор: манометр, индикатор. */
  static gauge(sh, cx, cy, r) {
    sh.circle(cx, cy, r, 'thin', '#fff');
    if (r > 0.5) sh.line(cx, cy, cx + r * 0.55, cy - r * 0.55, 'thin');
  }
  /** Рёбра охлаждения: линии вдоль оси. */
  static fins(sh, [x0, y0, x1, y1], step, vertical) {
    const s = Math.max(0.55, step);
    if (vertical) for (let x = x0 + s * 0.6; x < x1 - s * 0.3; x += s) sh.line(x, y0, x, y1, 'fine');
    else for (let y = y0 + s * 0.6; y < y1 - s * 0.3; y += s) sh.line(x0, y, x1, y, 'fine');
  }
  /** Штрихи светотени на цилиндре (вдоль оси): у левой кромки — два, у правой — один. */
  static shade(sh, [x0, y0, x1, y1], vertical = true) {
    if (vertical) {
      const w = x1 - x0;
      if (w < 2.5 || y1 - y0 < 1) return;
      for (const f of [0.09, 0.17, 0.9]) sh.line(x0 + w * f, y0, x0 + w * f, y1, 'fine');
    } else {
      const h = y1 - y0;
      if (h < 2.5 || x1 - x0 < 1) return;
      for (const f of [0.1, 0.19, 0.88]) sh.line(x0, y0 + h * f, x1, y0 + h * f, 'fine');
    }
  }
  /** Обечайка с эллиптическими днищами (2:1), вертикальная: x0…x1, y0…y1; швы — тонкие. */
  static shell(sh, [x0, y0, x1, y1], seams = true) {
    const w = x1 - x0;
    const h = y1 - y0;
    const rx = w / 2;
    const ry = Math.min(w / 4, h / 4);
    const f = EskdSheet.f;
    sh.path(
      `M${f(x0)},${f(y0 + ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1)},${f(y0 + ry)} L${f(x1)},${f(y1 - ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0)},${f(y1 - ry)} Z`,
      'main',
      '#fff',
    );
    if (seams && h > 4 * ry) {
      sh.line(x0, y0 + ry, x1, y0 + ry, 'thin');
      sh.line(x0, y1 - ry, x1, y1 - ry, 'thin');
    }
    return ry;
  }
  /** Горизонтальная обечайка с днищами. */
  static hshell(sh, [x0, y0, x1, y1], seams = true) {
    const w = x1 - x0;
    const h = y1 - y0;
    const ry = h / 2;
    const rx = Math.min(h / 4, w / 4);
    const f = EskdSheet.f;
    sh.path(
      `M${f(x0 + rx)},${f(y0)} L${f(x1 - rx)},${f(y0)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1 - rx)},${f(y1)} L${f(x0 + rx)},${f(y1)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0 + rx)},${f(y0)} Z`,
      'main',
      '#fff',
    );
    if (seams && w > 4 * rx) {
      sh.line(x0 + rx, y0, x0 + rx, y1, 'thin');
      sh.line(x1 - rx, y0, x1 - rx, y1, 'thin');
    }
    return rx;
  }
  /** Предохранительный клапан (корпус, пружинный колпак, рычаг) — вверх от (x, y). */
  static safety(sh, x, y, s) {
    const b = Math.max(0.5, s);
    sh.rect([x - b * 0.35, y - b * 0.8, b * 0.7, b * 0.8], 'thin', '#fff');
    sh.rect([x - b * 0.22, y - b * 1.9, b * 0.44, b * 1.1], 'thin', '#fff');
    sh.line(x + b * 0.22, y - b * 1.6, x + b * 0.75, y - b * 1.95, 'thin');
    sh.rect([x + b * 0.35, y - b * 0.6, b * 0.45, b * 0.35], 'thin', '#fff');
  }
  /** Шаровой кран с рукояткой: корпус в (x, y) на вертикальной трубе. */
  static ball(sh, x, y, s, horizontal) {
    const b = Math.max(0.45, s);
    if (horizontal) {
      sh.rect([x - b * 0.55, y - b * 0.4, b * 1.1, b * 0.8], 'thin', '#fff');
      sh.line(x, y - b * 0.4, x + b * 1.1, y - b * 0.9, 'thin');
    } else {
      sh.rect([x - b * 0.4, y - b * 0.55, b * 0.8, b * 1.1], 'thin', '#fff');
      sh.line(x + b * 0.4, y, x + b * 1.2, y + b * 0.3, 'thin');
    }
  }
  /** Рама с проёмами под вилы погрузчика. */
  static skid(sh, [x0, x1], [y0, y1], S) {
    const w = x1 - x0;
    const hb = y1 - y0;
    sh.rect([x0, y0, w, hb], 'main', '#fff');
    if (w > 6 && hb > 0.6)
      for (const f of [0.24, 0.76]) {
        const pw = Math.max(1, Math.min(S(220), w * 0.18));
        sh.rect([x0 + w * f - pw / 2, y0 + hb * 0.25, pw, hb * 0.5], 'thin');
      }
  }

  /** Зеркально по горизонтали в пределах x0…x1 листа (рисунок fn). */
  static mirror(sh, x0, x1, fn) {
    const f = EskdSheet.f;
    return sh.group(`translate(${f(x0 + x1)} 0) scale(-1 1)`, fn);
  }
  /** Центровые линии окружности: штрихпунктирные, за контур. */
  static axes(sh, cx, cy, r) {
    sh.line(cx - r, cy, cx + r, cy, 'axis');
    sh.line(cx, cy - r, cx, cy + r, 'axis');
  }
}
